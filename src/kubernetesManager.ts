// src/kubernetesManager.ts
import { $ } from "bun";
import type { K8sYamlConfig } from "./types";
import { glob } from "glob";
import path from "path";

export class KubernetesManager {
  private context: string;
  private namespace: string;
  private contextAvailable: boolean = false;
  private namespaceReady: boolean = false;

  constructor(context: string, namespace: string) {
    this.context = context;
    this.namespace = this.normalizeNamespace(namespace);
  }

  /**
   * Normalize namespace name to be RFC 1123 compliant
   */
  private normalizeNamespace(namespace: string): string {
    // Convert to lowercase and replace invalid characters with hyphens
    let normalized = namespace
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
      .replace(/-+/g, "-"); // Collapse multiple hyphens

    // Ensure it starts and ends with alphanumeric
    if (!/^[a-z0-9]/.test(normalized)) {
      normalized = "ns-" + normalized;
    }
    if (!/[a-z0-9]$/.test(normalized)) {
      normalized = normalized + "-ns";
    }

    // Ensure it's not empty and not longer than 63 characters
    if (!normalized || normalized.length === 0) {
      normalized = "default-ns";
    }
    if (normalized.length > 63) {
      normalized = normalized.substring(0, 60) + "-ns";
    }

    if (normalized !== namespace) {
      console.log(`📝 Normalized namespace "${namespace}" to "${normalized}"`);
    }

    return normalized;
  }

  /**
   * Verify Kubernetes context is available and accessible
   */
  private async verifyContext(): Promise<boolean> {
    if (this.contextAvailable) return true;

    try {
      // Check if context exists
      const contexts = await $`kubectl config get-contexts -o name`.text();
      const availableContexts = contexts.trim().split("\n");

      if (!availableContexts.includes(this.context)) {
        console.error(
          `❌ Context "${this.context}" not found. Available contexts:`
        );
        availableContexts.forEach((ctx) => console.log(`   - ${ctx}`));
        return false;
      }

      // Try to switch to context
      const switchResult =
        await $`kubectl config use-context ${this.context}`.quiet();
      if (switchResult.exitCode !== 0) {
        console.error(`❌ Failed to switch to context "${this.context}"`);
        console.error(switchResult.stderr.toString());
        return false;
      }

      // Test connectivity
      const connectTest =
        await $`kubectl cluster-info --request-timeout=5s`.quiet();
      if (connectTest.exitCode !== 0) {
        console.error(
          `❌ Cannot connect to cluster in context "${this.context}"`
        );
        console.error(connectTest.stderr.toString());
        return false;
      }

      console.log(`✅ Successfully connected to context "${this.context}"`);
      this.contextAvailable = true;
      return true;
    } catch (error) {
      console.error(`❌ Error verifying context "${this.context}":`, error);
      return false;
    }
  }

  /**
   * Ensure namespace exists and is ready
   */
  private async ensureNamespace(): Promise<boolean> {
    if (this.namespaceReady) return true;

    try {
      // Check if namespace already exists
      const checkNs = await $`kubectl get namespace ${this.namespace}`.quiet();

      if (checkNs.exitCode === 0) {
        console.log(`✅ Namespace "${this.namespace}" already exists`);
        this.namespaceReady = true;
        return true;
      }

      // Create namespace
      console.log(`📝 Creating namespace "${this.namespace}"`);
      const createResult = await $`kubectl create namespace ${this.namespace}`;

      if (createResult.exitCode !== 0) {
        console.error(`❌ Failed to create namespace "${this.namespace}"`);
        console.error(createResult.stderr.toString());
        return false;
      }

      // Wait for namespace to be ready
      console.log(
        `⏳ Waiting for namespace "${this.namespace}" to be ready...`
      );
      const waitResult =
        await $`kubectl wait --for=condition=Ready namespace/${this.namespace} --timeout=30s`.quiet();

      if (waitResult.exitCode !== 0) {
        console.warn(`⚠️  Namespace may not be fully ready, but proceeding...`);
      }

      console.log(`✅ Namespace "${this.namespace}" is ready`);
      this.namespaceReady = true;
      return true;
    } catch (error) {
      console.error(
        `❌ Error ensuring namespace exists and is ready "${this.namespace}"`
      );
      return false;
    }
  }

  /**
   * Initialize Kubernetes connection and namespace
   */
  private async initialize(): Promise<boolean> {
    const contextReady = await this.verifyContext();
    if (!contextReady) return false;

    const namespaceReady = await this.ensureNamespace();
    if (!namespaceReady) return false;

    return true;
  }

  async applyYaml(config: K8sYamlConfig): Promise<void> {
    const { yamlPath } = config;

    try {
      // Initialize connection
      const ready = await this.initialize();
      if (!ready) {
        throw new Error("Failed to initialize Kubernetes connection");
      }

      // Resolve YAML files
      const yamlFiles = await this.resolveYamlFiles(yamlPath);
      if (yamlFiles.length === 0) {
        console.warn(`⚠️  No YAML files found at: ${yamlPath}`);
        return;
      }

      // Apply each YAML file
      const results: string[] = [];
      for (const file of yamlFiles) {
        console.log(`☸️  Applying: ${file}`);

        // Validate YAML before applying
        const validateResult =
          await $`kubectl apply --dry-run=client -f ${file} -n ${this.namespace}`.quiet();
        if (validateResult.exitCode !== 0) {
          console.error(`❌ YAML validation failed for ${file}:`);
          console.error(validateResult.stderr.toString());
          throw new Error(`Invalid YAML in ${file}`);
        }

        // Apply the YAML
        const applyResult =
          await $`kubectl apply -f ${file} -n ${this.namespace}`;
        if (applyResult.exitCode !== 0) {
          console.error(`❌ Failed to apply ${file}:`);
          console.error(applyResult.stderr.toString());
          throw new Error(`Failed to apply ${file}`);
        }

        const output = applyResult.stdout.toString().trim();
        if (output) {
          results.push(output);
          console.log(`   ${output}`);
        }
      }

      console.log(`✅ Successfully applied: ${yamlPath}`);

      // Wait for deployments to be ready (optional, with timeout)
      await this.waitForDeployments(yamlFiles);
    } catch (error) {
      console.error(`❌ Failed to apply ${yamlPath}:`, error);
      throw error;
    }
  }

  async deleteYaml(yamlPath: string): Promise<void> {
    try {
      const ready = await this.initialize();
      if (!ready) {
        console.warn(
          `⚠️  Skipping deletion of ${yamlPath} - Kubernetes not ready`
        );
        return;
      }

      const yamlFiles = await this.resolveYamlFiles(yamlPath);

      for (const file of yamlFiles) {
        console.log(`🗑️  Deleting: ${file}`);

        const deleteResult =
          await $`kubectl delete -f ${file} -n ${this.namespace} --ignore-not-found=true --timeout=30s`;
        if (deleteResult.exitCode !== 0) {
          console.warn(
            `⚠️  Some resources from ${file} may not have been deleted:`
          );
          console.warn(deleteResult.stderr.toString());
        } else {
          const output = deleteResult.stdout.toString().trim();
          if (output) {
            console.log(`   ${output}`);
          }
        }
      }

      console.log(`✅ Successfully deleted: ${yamlPath}`);
    } catch (error) {
      console.warn(`⚠️  Failed to delete ${yamlPath}:`, error);
    }
  }

  /**
   * Wait for deployments to be ready (optional with timeout)
   */
  private async waitForDeployments(yamlFiles: string[]): Promise<void> {
    try {
      // Get all deployments from applied files
      const deployments: string[] = [];

      for (const file of yamlFiles) {
        const getDeployments =
          await $`kubectl get -f ${file} -n ${this.namespace} -o jsonpath='{.items[?(@.kind=="Deployment")].metadata.name}'`.quiet();
        if (getDeployments.exitCode === 0) {
          const deploymentNames = getDeployments.stdout.toString().trim();
          if (deploymentNames) {
            deployments.push(...deploymentNames.split(" "));
          }
        }
      }

      if (deployments.length === 0) {
        return; // No deployments to wait for
      }

      console.log(
        `⏳ Waiting for ${deployments.length} deployment(s) to be ready...`
      );

      for (const deployment of deployments) {
        console.log(`   Waiting for deployment/${deployment}...`);
        const waitResult =
          await $`kubectl wait --for=condition=available deployment/${deployment} -n ${this.namespace} --timeout=60s`.quiet();

        if (waitResult.exitCode === 0) {
          console.log(`   ✅ deployment/${deployment} is ready`);
        } else {
          console.warn(`   ⚠️  deployment/${deployment} may not be ready yet`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error waiting for deployments:`, error);
    }
  }

  private async resolveYamlFiles(yamlPath: string): Promise<string[]> {
    try {
      // Check if path exists
      const fileExists = await Bun.file(yamlPath).exists();
      if (!fileExists) {
        throw new Error(`YAML path does not exist: ${yamlPath}`);
      }

      // Check if it's a directory
      const stat = await Bun.file(yamlPath).stat();

      if (stat.isDirectory) {
        // Find all YAML files in directory
        const patterns = [
          path.join(yamlPath, "*.yaml"),
          path.join(yamlPath, "*.yml"),
          path.join(yamlPath, "**/*.yaml"),
          path.join(yamlPath, "**/*.yml"),
        ];

        const files: string[] = [];
        for (const pattern of patterns) {
          const matches = glob.sync(pattern, {
            ignore: ["**/node_modules/**", "**/.git/**"],
            absolute: true,
          });
          files.push(...matches);
        }

        // Remove duplicates and sort
        const uniqueFiles = [...new Set(files)].sort();

        if (uniqueFiles.length === 0) {
          console.warn(`⚠️  No YAML files found in directory: ${yamlPath}`);
        } else {
          console.log(
            `📁 Found ${uniqueFiles.length} YAML file(s) in ${yamlPath}`
          );
        }

        return uniqueFiles;
      } else {
        // Single file
        const ext = path.extname(yamlPath).toLowerCase();
        if (ext !== ".yaml" && ext !== ".yml") {
          console.warn(`⚠️  File ${yamlPath} does not have a YAML extension`);
        }
        return [path.resolve(yamlPath)];
      }
    } catch (error) {
      throw new Error(
        `Failed to resolve YAML files from ${yamlPath}: ${error}`
      );
    }
  }

  /**
   * Get current namespace (normalized)
   */
  getNamespace(): string {
    return this.namespace;
  }

  /**
   * Get current context
   */
  getContext(): string {
    return this.context;
  }

  /**
   * Check if Kubernetes is ready
   */
  async isReady(): Promise<boolean> {
    return await this.initialize();
  }

  /**
   * Get cluster info for debugging
   */
  async getClusterInfo(): Promise<string> {
    try {
      const ready = await this.initialize();
      if (!ready) return "Cluster not accessible";

      const info = await $`kubectl cluster-info`.text();
      return info;
    } catch (error) {
      return `Error getting cluster info: ${error}`;
    }
  }
}
