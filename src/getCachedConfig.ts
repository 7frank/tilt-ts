import { type FileBlob, $ } from "bun";
import type { GlobalTiltState } from "./types";

export async function getCachedConfig(
  fp: FileBlob,
  initialTiltState: GlobalTiltState
): Promise<GlobalTiltState> {
  await $`mkdir -p .tilt-ts`;

  return (await fp.exists()) ? await fp.json() : initialTiltState;
}
