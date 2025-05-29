// src/tiltState.ts
import { promises as fs } from "fs";
import path from "path";
import { getCachedConfig } from "./getCachedConfig";
import type {
  GlobalTiltState,
  DockerBuildConfig,
  K8sYamlConfig,
  HotReloadConfig,
} from "./types";
import type { ImageBuildContext } from "dockerode";

export class TiltConfig {
  private configFilePath: string;
  public state: GlobalTiltState;
  private initialState: GlobalTiltState;
  private _initialized: boolean = false;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    this.configFilePath = this.getConfigFilePath();
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

  /**
   * Ensure the configuration is initialized
   * This method is called automatically by other methods
   */
  private async ensureInitialized(): Promise<void> {
    if (this._initialized) {
      return;
    }

    // If already initializing, wait for it to complete
    if (this._initPromise) {
      return this._initPromise;
    }

    // Start initialization
    this._initPromise = this.init();
    return this._initPromise;
  }

  async init(): Promise<void> {
    if (this._initialized) {
      return;
    }

    this.state = await getCachedConfig(this.configFilePath, this.state);
    // Ensure namespace is always normalized, even if loaded from cache
    this.state.k8s.namespace = this.normalizeNamespace(
      this.state.k8s.namespace
    );
    this.initialState = structuredClone(this.state);
    this._initialized = true;
    this._initPromise = null;
  }

  private getConfigFilePath(): string {
    const PORT = process.env.TILT_PORT || 3001;
    return path.join(process.cwd(), ".tilt-ts", `state-${PORT}.json`);
  }

  async writeToDisk(): Promise<void> {
    await this.ensureInitialized();

    try {
      // Ensure directory exists
      const dirPath = path.dirname(this.configFilePath);
      await fs.mkdir(dirPath, { recursive: true });

      // Write the file
      await fs.writeFile(
        this.configFilePath,
        JSON.stringify(this.state, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error(
        `❌ Failed to write config to ${this.configFilePath}:`,
        error
      );
      throw error;
    }
  }

  addDockerBuild(
    imageName: string,
    buildContext: ImageBuildContext,
    hot?: HotReloadConfig
  ): void {
    // For synchronous calls from tiltfile, we queue the operation
    // and ensure initialization happens when the state is accessed
    this.state.docker_build[imageName] = {
      imageName,
      buildContext,
      hot,
    };
  }

  addK8sYaml(yamlPath: string): void {
    // For synchronous calls from tiltfile, we queue the operation
    // and ensure initialization happens when the state is accessed
    this.state.k8s_yaml[yamlPath] = { yamlPath };
  }

  async getInitialState(): Promise<GlobalTiltState> {
    await this.ensureInitialized();
    return structuredClone(this.initialState);
  }

  async reset(): Promise<void> {
    await this.ensureInitialized();
    this.initialState = structuredClone(this.state);
  }

  /**
   * Update Kubernetes context with validation
   */
  async setK8sContext(context: string): Promise<void> {
    await this.ensureInitialized();
    if (!context || context.trim().length === 0) {
      throw new Error("Kubernetes context cannot be empty");
    }
    this.state.k8s.context = context.trim();
  }

  /**
   * Update Kubernetes namespace with normalization
   */
  async setK8sNamespace(namespace: string): Promise<void> {
    await this.ensureInitialized();
    if (!namespace || namespace.trim().length === 0) {
      throw new Error("Kubernetes namespace cannot be empty");
    }
    this.state.k8s.namespace = this.normalizeNamespace(namespace);
  }

  /**
   * Update Docker registry with validation
   */
  async setDockerRegistry(registry: string): Promise<void> {
    await this.ensureInitialized();
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

  /**
   * Get the current state, ensuring initialization
   */
  async getState(): Promise<GlobalTiltState> {
    await this.ensureInitialized();
    return this.state;
  }

  /**
   * Check if the config is initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Get the config file path for debugging
   */
  getConfigPath(): string {
    return this.configFilePath;
  }

  /**
   * Check if config file exists
   */
  async configExists(): Promise<boolean> {
    try {
      await fs.access(this.configFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the config file
   */
  async deleteConfig(): Promise<void> {
    try {
      await fs.unlink(this.configFilePath);
      console.log(`🗑️  Deleted config file: ${this.configFilePath}`);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        console.warn(`⚠️  Failed to delete config file: ${error.message}`);
      }
    }
  }
}

// Create singleton instance without top-level await
const tiltConfig = new TiltConfig();

export { tiltConfig };
