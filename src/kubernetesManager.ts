// src/kubernetesManager.ts
import type { K8sYamlConfig } from "./types";
import { ShellExecutor } from "./utils/shellExecutor";
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
      // First check if kubectl is available
      const kubectlExists = await ShellExecutor.commandExists("kubectl");
      if (!kubectlExists) {
        console.error(`❌ kubectl command not found. Please install kubectl.`);
        return false;
      }

      // Check if context exists
      const contextsResult = await ShellExecutor.execQuiet("kubectl", [
        "config",
        "get-contexts",
        "-o",
        "name",
      ]);

      if (!contextsResult.success) {
        console.error(
          `❌ Failed to get kubectl contexts: ${contextsResult.stderr}`
        );
        return false;
      }

      const availableContexts = contextsResult.stdout
        .split("\n")
        .filter((ctx) => ctx.trim());

      if (!availableContexts.includes(this.context)) {
        console.error(
          `❌ Context "${this.context}" not found. Available contexts:`
        );
        availableContexts.forEach((ctx) => console.log(`   - ${ctx}`));
        return false;
      }

      // Try to switch to context
      const switchResult = await ShellExecutor.execQuiet("kubectl", [
        "config",
        "use-context",
        this.context,
      ]);

      if (!switchResult.success) {
        console.error(
          `❌ Failed to switch to context "${this.context}": ${switchResult.stderr}`
        );
        return false;
      }

      // Test connectivity with timeout
      const connectTest = await ShellExecutor.execQuiet(
        "kubectl",
        ["cluster-info", "--request-timeout=10s"],
        { timeout: 15000 }
      );

      if (!connectTest.success) {
        console.error(
          `❌ Cannot connect to cluster in context "${this.context}": ${connectTest.stderr}`
        );
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
      const checkResult = await ShellExecutor.execQuiet("kubectl", [
        "get",
        "namespace",
        this.namespace,
      ]);

      if (checkResult.success) {
        console.log(`✅ Namespace "${this.namespace}" already exists`);
        this.namespaceReady = true;
        return true;
      }

      // Create namespace
      console.log(`📝 Creating namespace "${this.namespace}"`);
      const createResult = await ShellExecutor.exec("kubectl", [
        "create",
        "namespace",
        this.namespace,
      ]);

      if (!createResult.success) {
        console.error(
          `❌ Failed to create namespace "${this.namespace}": ${createResult.stderr}`
        );
        return false;
      }

      // Wait for namespace to be ready with timeout
      console.log(
        `⏳ Waiting for namespace "${this.namespace}" to be ready...`
      );
      const waitResult = await ShellExecutor.execQuiet(
        "kubectl",
        [
          "wait",
          "--for=condition=Ready",
          `namespace/${this.namespace}`,
          "--timeout=30s",
        ],
        { timeout: 35000 }
      );

      if (!waitResult.success) {
        console.warn(`⚠️  Namespace may not be fully ready, but proceeding...`);
      }

      console.log(`✅ Namespace "${this.namespace}" is ready`);
      this.namespaceReady = true;
      return true;
    } catch (error) {
      console.error(`❌ Error ensuring namespace "${this.namespace}":`, error);
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
        const validateResult = await ShellExecutor.execQuiet("kubectl", [
          "apply",
          "--dry-run=client",
          "-f",
          file,
          "-n",
          this.namespace,
        ]);

        if (!validateResult.success) {
          console.error(
            `❌ YAML validation failed for ${file}: ${validateResult.stderr}`
          );
          throw new Error(`Invalid YAML in ${file}: ${validateResult.stderr}`);
        }

        // Apply the YAML with streaming output for better feedback
        const applyResult = await ShellExecutor.execStream("kubectl", [
          "apply",
          "-f",
          file,
          "-n",
          this.namespace,
        ]);

        if (!applyResult.success) {
          console.error(`❌ Failed to apply ${file}: ${applyResult.stderr}`);
          throw new Error(`Failed to apply ${file}: ${applyResult.stderr}`);
        }

        if (applyResult.stdout) {
          results.push(applyResult.stdout);
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

        const deleteResult = await ShellExecutor.exec("kubectl", [
          "delete",
          "-f",
          file,
          "-n",
          this.namespace,
          "--ignore-not-found=true",
          "--timeout=30s",
        ]);

        if (!deleteResult.success) {
          console.warn(
            `⚠️  Some resources from ${file} may not have been deleted: ${deleteResult.stderr}`
          );
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
        const getDeploymentsResult = await ShellExecutor.execQuiet("kubectl", [
          "get",
          "-f",
          file,
          "-n",
          this.namespace,
          "-o",
          "jsonpath={.items[?(@.kind=='Deployment')].metadata.name}",
        ]);

        if (
          getDeploymentsResult.success &&
          getDeploymentsResult.stdout.trim()
        ) {
          const deploymentNames = getDeploymentsResult.stdout
            .trim()
            .split(" ")
            .filter((name) => name);
          deployments.push(...deploymentNames);
        }
      }

      if (deployments.length === 0) {
        return; // No deployments to wait for
      }

      console.log(
        `⏳ Waiting for ${deployments.length} deployment(s) to be ready...`
      );

      // Wait for all deployments in parallel with individual timeouts
      const waitPromises = deployments.map(async (deployment) => {
        console.log(`   Waiting for deployment/${deployment}...`);

        const waitResult = await ShellExecutor.execQuiet(
          "kubectl",
          [
            "wait",
            "--for=condition=available",
            `deployment/${deployment}`,
            "-n",
            this.namespace,
            "--timeout=60s",
          ],
          { timeout: 65000 }
        );

        if (waitResult.success) {
          console.log(`   ✅ deployment/${deployment} is ready`);
          return true;
        } else {
          console.warn(
            `   ⚠️  deployment/${deployment} may not be ready yet: ${waitResult.stderr}`
          );
          return false;
        }
      });

      await Promise.allSettled(waitPromises);
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

      // Check if it's a directory using shell command
      const statResult = await ShellExecutor.execQuiet("test", [
        "-d",
        yamlPath,
      ]);

      if (statResult.success) {
        // It's a directory - find all YAML files
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

      const infoResult = await ShellExecutor.exec("kubectl", ["cluster-info"]);
      return infoResult.success
        ? infoResult.stdout
        : `Error: ${infoResult.stderr}`;
    } catch (error) {
      return `Error getting cluster info: ${error}`;
    }
  }

  /**
   * Get all pods in the namespace
   */
  async getPods(): Promise<string[]> {
    try {
      const ready = await this.initialize();
      if (!ready) return [];

      const podsResult = await ShellExecutor.execQuiet("kubectl", [
        "get",
        "pods",
        "-n",
        this.namespace,
        "-o",
        "name",
      ]);

      if (podsResult.success) {
        return podsResult.stdout.split("\n").filter((pod) => pod.trim());
      }
      return [];
    } catch (error) {
      console.warn(`⚠️  Failed to get pods: ${error}`);
      return [];
    }
  }

  /**
   * Get resource status for debugging
   */
  async getResourceStatus(): Promise<{ [key: string]: any }> {
    try {
      const ready = await this.initialize();
      if (!ready) return { error: "Kubernetes not ready" };

      const commands = [
        { name: "pods", args: ["get", "pods", "-n", this.namespace] },
        { name: "services", args: ["get", "services", "-n", this.namespace] },
        {
          name: "deployments",
          args: ["get", "deployments", "-n", this.namespace],
        },
        {
          name: "events",
          args: [
            "get",
            "events",
            "-n",
            this.namespace,
            "--sort-by=.lastTimestamp",
          ],
        },
      ];

      const status: { [key: string]: any } = {};

      for (const { name, args } of commands) {
        const result = await ShellExecutor.execQuiet("kubectl", args);
        status[name] = {
          success: result.success,
          output: result.success ? result.stdout : result.stderr,
        };
      }

      return status;
    } catch (error) {
      return { error: error.toString() };
    }
  }
}
