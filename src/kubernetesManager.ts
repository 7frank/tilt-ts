import { $ } from "bun";
import type { K8sYamlConfig } from "./types";
import { glob } from "glob";
import path from "path";

export class KubernetesManager {
  private context: string;
  private namespace: string;

  constructor(context: string, namespace: string) {
    this.context = context;
    this.namespace = namespace;
  }

  async applyYaml(config: K8sYamlConfig): Promise<void> {
    const { yamlPath } = config;
    
    try {
      // Set context
      await $`kubectl config use-context ${this.context}`;
      
      // Create namespace if it doesn't exist
      await $`kubectl create namespace ${this.namespace} --dry-run=client -o yaml | kubectl apply -f -`;
      
      // Apply YAML files
      const yamlFiles = await this.resolveYamlFiles(yamlPath);
      
      for (const file of yamlFiles) {
        console.log(`☸️  Applying: ${file}`);
        const result = await $`kubectl apply -f ${file} -n ${this.namespace}`.text();
        console.log(result);
      }
      
      console.log(`✅ Successfully applied: ${yamlPath}`);
    } catch (error) {
      console.error(`❌ Failed to apply ${yamlPath}:`, error);
      throw error;
    }
  }

  async deleteYaml(yamlPath: string): Promise<void> {
    try {
      const yamlFiles = await this.resolveYamlFiles(yamlPath);
      
      for (const file of yamlFiles) {
        console.log(`🗑️  Deleting: ${file}`);
        await $`kubectl delete -f ${file} -n ${this.namespace} --ignore-not-found=true`;
      }
      
      console.log(`✅ Successfully deleted: ${yamlPath}`);
    } catch (error) {
      console.warn(`⚠️  Failed to delete ${yamlPath}:`, error);
    }
  }

  private async resolveYamlFiles(yamlPath: string): Promise<string[]> {
    const stats = await Bun.file(yamlPath).exists();
    
    if (!stats) {
      throw new Error(`YAML path does not exist: ${yamlPath}`);
    }

    // Check if it's a directory
    try {
      const dirStats = await $`test -d ${yamlPath}`.quiet();
      if (dirStats.exitCode === 0) {
        // It's a directory, find all YAML files
        const pattern = path.join(yamlPath, "**/*.{yaml,yml}");
        return glob.sync(pattern);
      }
    } catch {
      // Not a directory, treat as file
    }
    
    return [yamlPath];
  }
}
