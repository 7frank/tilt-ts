import { file } from "bun";
import { getCachedConfig } from "./getCachedConfig";


import type { docker_build } from "./docker_build";
import type { k8s_yaml } from "./k8s_yaml";

export interface GlobalTiltState {
  k8s: { context: string; namespace: string; };
  docker: { registry: string; };
  docker_build: Record<string, Parameters<typeof docker_build>>;
  k8s_yaml: Record<string, Parameters<typeof k8s_yaml>>;
}


const PORT = 3001;

const initialTiltState: GlobalTiltState = {
  docker: { registry: "localhost:36269" },
  k8s: { context: "k3d-ecosys-local-dev", namespace: "eco_test" },
  docker_build: {},
  k8s_yaml: {},
};

const configFile = file(`.tilt-ts/state-${PORT}.json`);

export async function updateTileStateFile(tiltState: GlobalTiltState) {
  await configFile.write(JSON.stringify(tiltState, null, 2));
}

export const tiltState = await getCachedConfig(configFile, initialTiltState);

export function getTiltState():GlobalTiltState {
  return tiltState;
}
