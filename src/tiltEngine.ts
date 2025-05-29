// src/tiltEngine.ts
import { tiltConfig } from "./tiltState";
import { StateAnalyzer } from "./stateAnalyzer";
import { DockerManager } from "./dockerManager";
import { KubernetesManager } from "./kubernetesManager";
import { LiveUpdateManager } from "./liveUpdateManager";
import type { GlobalTiltState } from "./types";

export class TiltEngine {
  private stateAnalyzer: StateAnalyzer;
  private dockerManager: DockerManager | null = null;
  private kubernetesManager: KubernetesManager | null = null;
  private liveUpdateManager: LiveUpdateManager | null = null;
  private isRunning: boolean = false;
  private isDevMode: boolean = false;

  constructor() {
    this.stateAnalyzer = new StateAnalyzer();
  }

  /**
   * Initialize managers with current tilt config
   */
  private async initializeManagers(): Promise<void> {
    const state = await tiltConfig.getState();

    this.dockerManager = new DockerManager(state.docker.registry);
    this.kubernetesManager = new KubernetesManager(
      state.k8s.context,
      state.k8s.namespace
    );
    this.liveUpdateManager = new LiveUpdateManager(
      state.k8s.context,
      state.k8s.namespace
    );
  }

  async up(dryRun: boolean = false, devMode: boolean = true): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️  Tilt is already running");
      return;
    }

    this.isRunning = true;
    this.isDevMode = devMode;
    console.log(`🚀 Starting Tilt${devMode ? " (dev mode)" : ""}...`);

    try {
      // Initialize managers
      await this.initializeManagers();

      // Pre-flight checks
      const preflight = await this.preflightChecks();
      if (!preflight.success) {
        throw new Error(`Pre-flight checks failed: ${preflight.error}`);
      }

      const oldState = await tiltConfig.getInitialState();
      const newState = structuredClone(await tiltConfig.getState());

      // Analyze changes
      const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
      console.log(`📊 Detected ${changes.length} changes`);

      if (dryRun) {
        await this.showDryRunChanges(changes);
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

      // Start live updates in dev mode
      if (devMode && dockerSuccess && k8sSuccess) {
        await this.setupLiveUpdates();
      }

      // Save state only if at least one operation succeeded
      if (dockerSuccess || k8sSuccess) {
        await tiltConfig.writeToDisk();
        await tiltConfig.reset();
      }

      if (dockerSuccess && k8sSuccess) {
        console.log("✅ Tilt up completed successfully!");
        if (devMode) {
          console.log(
            "🔄 Live updates are active - edit files to see changes!"
          );
          await this.printDevModeInstructions();
        }
      } else {
        console.warn("⚠️  Tilt up completed with some errors");
        if (!dockerSuccess) console.warn("   - Docker operations failed");
        if (!k8sSuccess) console.warn("   - Kubernetes operations failed");
      }
    } catch (error) {
      console.error("❌ Tilt up failed:", error);
      throw error;
    } finally {
      if (!this.isDevMode) {
        this.isRunning = false;
      }
    }
  }

  async down(): Promise<void> {
    console.log("🛑 Stopping Tilt...");

    // Initialize managers if not already done
    if (
      !this.kubernetesManager ||
      !this.dockerManager ||
      !this.liveUpdateManager
    ) {
      await this.initializeManagers();
    }

    // Stop live updates first
    if (this.isDevMode && this.liveUpdateManager) {
      console.log("🔄 Stopping live updates...");
      await this.liveUpdateManager.stopAllLiveUpdates();
    }

    let k8sSuccess = true;
    let dockerSuccess = true;

    try {
      // Remove Kubernetes resources first (graceful shutdown)
      console.log("🔄 Removing Kubernetes resources...");
      const state = await tiltConfig.getState();
      const k8sPromises = Object.entries(state.k8s_yaml).map(
        async ([yamlPath, config]) => {
          try {
            await this.kubernetesManager!.deleteYaml(config.yamlPath);
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
      const state = await tiltConfig.getState();
      const dockerPromises = Object.entries(state.docker_build).map(
        async ([imageName, config]) => {
          try {
            await this.dockerManager!.removeImage(config.imageName);
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

    this.isRunning = false;
    this.isDevMode = false;

    if (k8sSuccess && dockerSuccess) {
      console.log("✅ Tilt down completed successfully!");
    } else {
      console.warn("⚠️  Tilt down completed with some cleanup issues");
    }
  }

  /**
   * Get status of live updates
   */
  getLiveUpdateStatus() {
    return this.liveUpdateManager?.getSessionStatus() || [];
  }

  /**
   * Manually trigger sync for an image
   */
  async triggerSync(imageName: string): Promise<void> {
    if (!this.liveUpdateManager) {
      await this.initializeManagers();
    }
    await this.liveUpdateManager!.triggerFullSync(imageName);
  }

  /**
   * Get container logs for debugging
   */
  async getLogs(imageName: string, lines: number = 50): Promise<string> {
    if (!this.liveUpdateManager) {
      await this.initializeManagers();
    }
    return await this.liveUpdateManager!.getContainerLogs(imageName, lines);
  }

  /**
   * Set up live updates for all configured Docker builds
   */
  private async setupLiveUpdates(): Promise<void> {
    console.log("🔄 Setting up live updates...");

    const state = await tiltConfig.getState();
    const dockerBuilds = Object.values(state.docker_build);
    const liveUpdateBuilds = dockerBuilds.filter(
      (config) => config.hot?.live_update && config.hot.live_update.length > 0
    );

    if (liveUpdateBuilds.length === 0) {
      console.log("📝 No live updates configured");
      return;
    }

    console.log(
      `🔄 Starting live updates for ${liveUpdateBuilds.length} image(s)...`
    );

    // Start live updates for each build with a delay to allow pods to be ready
    const startPromises = liveUpdateBuilds.map(async (config, index) => {
      // Stagger the start to avoid overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, index * 2000));

      try {
        await this.liveUpdateManager!.startLiveUpdate(config);
      } catch (error) {
        console.warn(
          `⚠️  Failed to start live updates for ${config.imageName}:`,
          error
        );
      }
    });

    await Promise.allSettled(startPromises);

    const activeSessions = this.getLiveUpdateStatus().filter((s) => s.isActive);
    console.log(
      `✅ Live updates active for ${activeSessions.length}/${liveUpdateBuilds.length} image(s)`
    );
  }

  /**
   * Show dry run changes
   */
  private async showDryRunChanges(changes: any[]): Promise<void> {
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
    console.log(`   Removed: ${dockerChanges.removed.join(", ") || "none"}`);

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

    // Show live update configurations
    console.log("\n🔄 Live Update Configurations:");
    const state = await tiltConfig.getState();
    Object.entries(state.docker_build).forEach(([name, config]) => {
      if (config.hot?.live_update && config.hot.live_update.length > 0) {
        console.log(`   ${name}:`);
        config.hot.live_update.forEach((step, index) => {
          if (step.type === "sync") {
            console.log(
              `      ${index + 1}. SYNC: ${step.src} -> ${step.dest}`
            );
          } else if (step.type === "run") {
            console.log(
              `      ${index + 1}. RUN: ${
                step.path
              } (triggers: ${step.options.trigger.join(", ")})`
            );
          }
        });
      } else {
        console.log(`   ${name}: No live updates configured`);
      }
    });
  }

  /**
   * Print instructions for dev mode
   */
  private async printDevModeInstructions(): Promise<void> {
    console.log("\n📋 Development Mode Instructions:");
    console.log("   - Edit files in your project directories");
    console.log(
      "   - Changes will be automatically synced to running containers"
    );
    console.log("   - Run commands will be triggered based on file patterns");
    console.log("   - Use 'tilt down' to stop and clean up");
    console.log("   - Use 'tilt status' to see current live update status");

    const state = await tiltConfig.getState();
    const liveUpdateBuilds = Object.values(state.docker_build).filter(
      (config) => config.hot?.live_update && config.hot.live_update.length > 0
    );

    if (liveUpdateBuilds.length > 0) {
      console.log("\n🔄 Active Live Updates:");
      liveUpdateBuilds.forEach((config) => {
        console.log(`   📦 ${config.imageName}:`);
        config.hot?.live_update?.forEach((step) => {
          if (step.type === "sync") {
            console.log(`      📂 ${step.src} -> ${step.dest}`);
          } else if (step.type === "run") {
            console.log(
              `      🚀 "${step.path}" on ${step.options.trigger.join(", ")}`
            );
          }
        });
      });
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
      const k8sReady = await this.kubernetesManager!.isReady();
      if (!k8sReady) {
        const state = await tiltConfig.getState();
        return {
          success: false,
          error: `Kubernetes cluster not accessible (context: ${state.k8s.context})`,
        };
      }

      // Check Docker connectivity
      try {
        await this.dockerManager!.checkConnection();
      } catch (error) {
        return {
          success: false,
          error: `Docker not accessible: ${error}`,
        };
      }

      // Validate configurations
      const state = await tiltConfig.getState();
      const dockerBuilds = Object.keys(state.docker_build);
      const k8sResources = Object.keys(state.k8s_yaml);

      if (dockerBuilds.length === 0 && k8sResources.length === 0) {
        return {
          success: false,
          error:
            "No resources defined. Add docker_build() or k8s_yaml() calls to your Tiltfile.",
        };
      }

      console.log(`✅ Pre-flight checks passed`);
      console.log(`   - Context: ${state.k8s.context}`);
      console.log(`   - Namespace: ${this.kubernetesManager!.getNamespace()}`);
      console.log(`   - Registry: ${state.docker.registry}`);
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
        await this.dockerManager!.removeImage(imageName);
      } catch (error) {
        console.warn(`⚠️  Failed to remove ${imageName}:`, error);
      }
    }

    // Build new and modified images
    const imagesToBuild = [...dockerChanges.added, ...dockerChanges.modified];
    const buildPromises = imagesToBuild.map(async (config) => {
      try {
        await this.dockerManager!.buildImage(config);
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
        await this.kubernetesManager!.deleteYaml(yamlPath);
      } catch (error) {
        console.warn(`⚠️  Failed to delete ${yamlPath}:`, error);
      }
    }

    // Apply new and modified YAML
    const yamlToApply = [...k8sChanges.added, ...k8sChanges.modified];
    for (const config of yamlToApply) {
      try {
        await this.kubernetesManager!.applyYaml(config);
      } catch (error) {
        console.error(`❌ Failed to apply ${config.yamlPath}:`, error);
        throw error;
      }
    }
  }
}
