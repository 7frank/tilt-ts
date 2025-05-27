// src/tiltState.ts
import { file, type BunFile } from "bun";
import { getCachedConfig } from "./getCachedConfig";
import type {
  GlobalTiltState,
  DockerBuildConfig,
  K8sYamlConfig,
} from "./types";

export class TiltConfig {
  private configFile: BunFile;
  public state: GlobalTiltState;
  private initialState: GlobalTiltState;

  constructor() {
    this.configFile = this.loadFromDisk();
    this.state = {
      docker: { registry: "localhost:36269" },
      k8s: {
        context: "k3d-ecosys-local-dev",
        namespace: this.normalizeNamespace("eco_test"), // Normalize the default namespace
      },
      docker_build: {},
      k8s_yaml: {},
    };
    this.initialState = structuredClone(this.state);
  }

  /**
   * Normalize namespace name to be RFC 1123 compliant
   * Same logic as KubernetesManager to ensure consistency
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

    return normalized;
  }

  async init() {
    this.state = await getCachedConfig(this.configFile, this.state);
    // Ensure namespace is always normalized, even if loaded from cache
    this.state.k8s.namespace = this.normalizeNamespace(
      this.state.k8s.namespace
    );
    this.initialState = structuredClone(this.state);
  }

  loadFromDisk(): BunFile {
    const PORT = process.env.TILT_PORT || 3001;
    return file(`.tilt-ts/state-${PORT}.json`);
  }

  async writeToDisk() {
    await this.configFile.write(JSON.stringify(this.state, null, 2));
  }

  addDockerBuild(
    imageName: string,
    buildContext: ImageBuildContext,
    hot?: HotReloadConfig
  ) {
    this.state.docker_build[imageName] = {
      imageName,
      buildContext,
      hot,
    };
  }

  addK8sYaml(yamlPath: string) {
    this.state.k8s_yaml[yamlPath] = { yamlPath };
  }

  getInitialState(): GlobalTiltState {
    return structuredClone(this.initialState);
  }

  reset() {
    this.initialState = structuredClone(this.state);
  }

  /**
   * Update Kubernetes context with validation
   */
  setK8sContext(context: string) {
    if (!context || context.trim().length === 0) {
      throw new Error("Kubernetes context cannot be empty");
    }
    this.state.k8s.context = context.trim();
  }

  /**
   * Update Kubernetes namespace with normalization
   */
  setK8sNamespace(namespace: string) {
    if (!namespace || namespace.trim().length === 0) {
      throw new Error("Kubernetes namespace cannot be empty");
    }
    this.state.k8s.namespace = this.normalizeNamespace(namespace);
  }

  /**
   * Update Docker registry with validation
   */
  setDockerRegistry(registry: string) {
    
    if (!registry || registry.trim().length === 0) {
      throw new Error("Docker registry cannot be empty");
    }
    // Basic validation for registry format
    const registryPattern =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(:[0-9]+)?$/;
    if (!registryPattern.test(registry)) {
      console.warn(
        `⚠️  Registry "${registry}" may not be in correct format (host:port)`
      );
    }
    this.state.docker.registry = registry.trim();
  }
}

const tiltConfig = new TiltConfig();
await tiltConfig.init();
export { tiltConfig };
