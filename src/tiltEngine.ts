// src/tiltEngine.ts
import { tiltConfig } from "./tiltState";
import { StateAnalyzer } from "./stateAnalyzer";
import { DockerManager } from "./dockerManager";
import { KubernetesManager } from "./kubernetesManager";
import type { GlobalTiltState } from "./types";

export class TiltEngine {
  private stateAnalyzer: StateAnalyzer;
  private dockerManager: DockerManager;
  private kubernetesManager: KubernetesManager;
  private isRunning: boolean = false;

  constructor() {
    this.stateAnalyzer = new StateAnalyzer();
    this.dockerManager = new DockerManager(tiltConfig.state.docker.registry);
    this.kubernetesManager = new KubernetesManager(
      tiltConfig.state.k8s.context,
      tiltConfig.state.k8s.namespace
    );
  }

  async up(dryRun: boolean = false): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️  Tilt is already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Starting Tilt...");

    try {
      // Pre-flight checks
      const preflight = await this.preflightChecks();
      if (!preflight.success) {
        throw new Error(`Pre-flight checks failed: ${preflight.error}`);
      }

      const oldState = tiltConfig.getInitialState();
      const newState = structuredClone(tiltConfig.state);

      // Analyze changes
      const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
      console.log(`📊 Detected ${changes.length} changes`);

      if (dryRun) {
        console.log("🔍 Dry run mode - changes that would be applied:");
        console.log(JSON.stringify(changes, null, 2));

        // Show what resources would be affected
        const dockerChanges = this.stateAnalyzer.getDockerBuildChanges(changes);
        const k8sChanges = this.stateAnalyzer.getK8sYamlChanges(changes);

        console.log("\n🐳 Docker Changes:");
        console.log(
          `   Added: ${
            dockerChanges.added.map((c) => c.imageName).join(", ") || "none"
          }`
        );
        console.log(
          `   Modified: ${
            dockerChanges.modified.map((c) => c.imageName).join(", ") || "none"
          }`
        );
        console.log(
          `   Removed: ${dockerChanges.removed.join(", ") || "none"}`
        );

        console.log("\n☸️  Kubernetes Changes:");
        console.log(
          `   Added: ${
            k8sChanges.added.map((c) => c.yamlPath).join(", ") || "none"
          }`
        );
        console.log(
          `   Modified: ${
            k8sChanges.modified.map((c) => c.yamlPath).join(", ") || "none"
          }`
        );
        console.log(`   Removed: ${k8sChanges.removed.join(", ") || "none"}`);

        return;
      }

      // Apply changes with proper error handling
      let dockerSuccess = true;
      let k8sSuccess = true;

      try {
        await this.applyDockerChanges(oldState, newState);
      } catch (error) {
        console.error("❌ Docker changes failed:", error);
        dockerSuccess = false;
      }

      // Continue with K8s even if Docker failed (might be config-only changes)
      try {
        await this.applyK8sChanges(oldState, newState);
      } catch (error) {
        console.error("❌ Kubernetes changes failed:", error);
        k8sSuccess = false;
      }

      // Save state only if at least one operation succeeded
      if (dockerSuccess || k8sSuccess) {
        await tiltConfig.writeToDisk();
        tiltConfig.reset();
      }

      if (dockerSuccess && k8sSuccess) {
        console.log("✅ Tilt up completed successfully!");
      } else {
        console.warn("⚠️  Tilt up completed with some errors");
        if (!dockerSuccess) console.warn("   - Docker operations failed");
        if (!k8sSuccess) console.warn("   - Kubernetes operations failed");
      }
    } catch (error) {
      console.error("❌ Tilt up failed:", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async down(): Promise<void> {
    console.log("🛑 Stopping Tilt...");

    let k8sSuccess = true;
    let dockerSuccess = true;

    try {
      // Remove Kubernetes resources first (graceful shutdown)
      console.log("🔄 Removing Kubernetes resources...");
      const k8sPromises = Object.entries(tiltConfig.state.k8s_yaml).map(
        async ([yamlPath, config]) => {
          try {
            await this.kubernetesManager.deleteYaml(config.yamlPath);
          } catch (error) {
            console.warn(`⚠️  Failed to delete ${yamlPath}:`, error);
          }
        }
      );
      await Promise.allSettled(k8sPromises);
    } catch (error) {
      console.error("❌ Kubernetes cleanup failed:", error);
      k8sSuccess = false;
    }

    try {
      // Remove Docker images
      console.log("🔄 Removing Docker images...");
      const dockerPromises = Object.entries(tiltConfig.state.docker_build).map(
        async ([imageName, config]) => {
          try {
            await this.dockerManager.removeImage(config.imageName);
          } catch (error) {
            console.warn(`⚠️  Failed to remove ${imageName}:`, error);
          }
        }
      );
      await Promise.allSettled(dockerPromises);
    } catch (error) {
      console.error("❌ Docker cleanup failed:", error);
      dockerSuccess = false;
    }

    if (k8sSuccess && dockerSuccess) {
      console.log("✅ Tilt down completed successfully!");
    } else {
      console.warn("⚠️  Tilt down completed with some cleanup issues");
    }
  }

  /**
   * Pre-flight checks to ensure environment is ready
   */
  private async preflightChecks(): Promise<{
    success: boolean;
    error?: string;
  }> {
    console.log("🔍 Running pre-flight checks...");

    try {
      // Check Kubernetes connectivity
      const k8sReady = await this.kubernetesManager.isReady();
      if (!k8sReady) {
        return {
          success: false,
          error: `Kubernetes cluster not accessible (context: ${tiltConfig.state.k8s.context})`,
        };
      }

      // Check Docker connectivity
      try {
        await this.dockerManager.checkConnection();
      } catch (error) {
        return {
          success: false,
          error: `Docker not accessible: ${error}`,
        };
      }

      // Validate configurations
      const dockerBuilds = Object.keys(tiltConfig.state.docker_build);
      const k8sResources = Object.keys(tiltConfig.state.k8s_yaml);

      if (dockerBuilds.length === 0 && k8sResources.length === 0) {
        return {
          success: false,
          error:
            "No resources defined. Add docker_build() or k8s_yaml() calls to your Tiltfile.",
        };
      }

      console.log(`✅ Pre-flight checks passed`);
      console.log(`   - Context: ${tiltConfig.state.k8s.context}`);
      console.log(`   - Namespace: ${this.kubernetesManager.getNamespace()}`);
      console.log(`   - Registry: ${tiltConfig.state.docker.registry}`);
      console.log(`   - Docker builds: ${dockerBuilds.length}`);
      console.log(`   - K8s resources: ${k8sResources.length}`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Pre-flight check failed: ${error}`,
      };
    }
  }

  private async applyDockerChanges(
    oldState: GlobalTiltState,
    newState: GlobalTiltState
  ): Promise<void> {
    const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
    const dockerChanges = this.stateAnalyzer.getDockerBuildChanges(changes);

    const totalChanges =
      dockerChanges.added.length +
      dockerChanges.modified.length +
      dockerChanges.removed.length;
    if (totalChanges === 0) {
      console.log("🐳 No Docker changes detected");
      return;
    }

    console.log(`🐳 Applying Docker changes (${totalChanges} total)...`);

    // Remove deleted images first
    for (const imageName of dockerChanges.removed) {
      try {
        await this.dockerManager.removeImage(imageName);
      } catch (error) {
        console.warn(`⚠️  Failed to remove ${imageName}:`, error);
      }
    }

    // Build new and modified images
    const imagesToBuild = [...dockerChanges.added, ...dockerChanges.modified];
    const buildPromises = imagesToBuild.map(async (config) => {
      try {
        await this.dockerManager.buildImage(config);
      } catch (error) {
        console.error(`❌ Failed to build ${config.imageName}:`, error);
        throw error;
      }
    });

    // Build images in parallel, but with some concurrency control
    await Promise.all(buildPromises);
  }

  private async applyK8sChanges(
    oldState: GlobalTiltState,
    newState: GlobalTiltState
  ): Promise<void> {
    const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
    const k8sChanges = this.stateAnalyzer.getK8sYamlChanges(changes);

    const totalChanges =
      k8sChanges.added.length +
      k8sChanges.modified.length +
      k8sChanges.removed.length;
    if (totalChanges === 0) {
      console.log("☸️  No Kubernetes changes detected");
      return;
    }

    console.log(`☸️  Applying Kubernetes changes (${totalChanges} total)...`);

    // Remove deleted YAML first
    for (const yamlPath of k8sChanges.removed) {
      try {
        await this.kubernetesManager.deleteYaml(yamlPath);
      } catch (error) {
        console.warn(`⚠️  Failed to delete ${yamlPath}:`, error);
      }
    }

    // Apply new and modified YAML
    const yamlToApply = [...k8sChanges.added, ...k8sChanges.modified];
    for (const config of yamlToApply) {
      try {
        await this.kubernetesManager.applyYaml(config);
      } catch (error) {
        console.error(`❌ Failed to apply ${config.yamlPath}:`, error);
        throw error;
      }
    }
  }
}
