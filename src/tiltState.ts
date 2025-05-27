import { file, type BunFile } from "bun";
import { getCachedConfig } from "./getCachedConfig";
import type { GlobalTiltState, DockerBuildConfig, K8sYamlConfig } from "./types";

export class TiltConfig {
  private configFile: BunFile;
  public state: GlobalTiltState;
  private initialState: GlobalTiltState;

  constructor() {
    this.configFile = this.loadFromDisk();
    this.state = {
      docker: { registry: "localhost:36269" },
      k8s: { context: "k3d-ecosys-local-dev", namespace: "eco_test" },
      docker_build: {},
      k8s_yaml: {},
    };
    this.initialState = structuredClone(this.state);
  }

  async init() {
    this.state = await getCachedConfig(this.configFile, this.state);
    this.initialState = structuredClone(this.state);
  }

  loadFromDisk(): BunFile {
    const PORT = process.env.TILT_PORT || 3001;
    return file(`.tilt-ts/state-${PORT}.json`);
  }

  async writeToDisk() {
    await this.configFile.write(JSON.stringify(this.state, null, 2));
  }

  addDockerBuild(imageName: string, buildContext: ImageBuildContext, hot?: HotReloadConfig) {
    this.state.docker_build[imageName] = {
      imageName,
      buildContext,
      hot
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
}

const tiltConfig = new TiltConfig();
await tiltConfig.init();
export { tiltConfig };