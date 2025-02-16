import { file, type BunFile } from "bun";
import { getCachedConfig } from "./getCachedConfig";
import type { docker_build } from "./docker_build";
import type { k8s_yaml } from "./k8s_yaml";

export interface GlobalTiltState {
  k8s: { context: string; namespace: string };
  docker: { registry: string };
  docker_build: Record<string, Parameters<typeof docker_build>>;
  k8s_yaml: Record<string, Parameters<typeof k8s_yaml>>;
}

export class TiltConfig {
  private configFile;
  public state: GlobalTiltState;

  constructor() {
    this.configFile = this.loadFromDisk();
    this.state = {
      docker: { registry: "localhost:36269" },
      k8s: { context: "k3d-ecosys-local-dev", namespace: "eco_test" },
      docker_build: {},
      k8s_yaml: {},
    };
  }

  async init() {
    this.state = await getCachedConfig(this.configFile, this.state);
  }

  loadFromDisk(): BunFile {
    const PORT = 3001;
    return file(`.tilt-ts/state-${PORT}.json`);
  }

  async writeToDisk() {
    await this.configFile.write(JSON.stringify(this.state, null, 2));
  }
}

const tiltConfig = new TiltConfig();
await tiltConfig.init();
export { tiltConfig };
