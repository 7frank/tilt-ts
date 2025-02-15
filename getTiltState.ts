import { file } from "bun";
import { getCachedConfig } from "./getCachedConfig";
import type { GlobalTiltState } from "./GlobalTiltState";

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

export function getTiltState() {
  return tiltState;
}
