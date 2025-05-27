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
      const oldState = tiltConfig.getInitialState();
      const newState = structuredClone(tiltConfig.state);

      // Analyze changes
      const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
      console.log(`📊 Detected ${changes.length} changes`);

      if (dryRun) {
        console.log("🔍 Dry run mode - changes that would be applied:");
        console.log(JSON.stringify(changes, null, 2));
        return;
      }

      // Apply Docker changes
      await this.applyDockerChanges(oldState, newState);
      
      // Apply Kubernetes changes  
      await this.applyK8sChanges(oldState, newState);

      // Save state
      await tiltConfig.writeToDisk();
      tiltConfig.reset();

      console.log("✅ Tilt up completed successfully!");
    } catch (error) {
      console.error("❌ Tilt up failed:", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async down(): Promise<void> {
    console.log("🛑 Stopping Tilt...");

    try {
      // Remove all Kubernetes resources
      for (const [yamlPath, config] of Object.entries(tiltConfig.state.k8s_yaml)) {
        await this.kubernetesManager.deleteYaml(config.yamlPath);
      }

      // Remove all Docker images
      for (const [imageName, config] of Object.entries(tiltConfig.state.docker_build)) {
        await this.dockerManager.removeImage(config.imageName);
      }

      console.log("✅ Tilt down completed successfully!");
    } catch (error) {
      console.error("❌ Tilt down failed:", error);
      throw error;
    }
  }

  private async applyDockerChanges(oldState: GlobalTiltState, newState: GlobalTiltState): Promise<void> {
    const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
    const dockerChanges = this.stateAnalyzer.getDockerBuildChanges(changes);

    // Remove deleted images
    for (const imageName of dockerChanges.removed) {
      await this.dockerManager.removeImage(imageName);
    }

    // Build new and modified images
    const imagesToBuild = [...dockerChanges.added, ...dockerChanges.modified];
    for (const config of imagesToBuild) {
      await this.dockerManager.buildImage(config);
    }
  }

  private async applyK8sChanges(oldState: GlobalTiltState, newState: GlobalTiltState): Promise<void> {
    const changes = this.stateAnalyzer.analyzeChanges(oldState, newState);
    const k8sChanges = this.stateAnalyzer.getK8sYamlChanges(changes);

    // Remove deleted YAML
    for (const yamlPath of k8sChanges.removed) {
      await this.kubernetesManager.deleteYaml(yamlPath);
    }

    // Apply new and modified YAML
    const yamlToApply = [...k8sChanges.added, ...k8sChanges.modified];
    for (const config of yamlToApply) {
      await this.kubernetesManager.applyYaml(config);
    }
  }
}
