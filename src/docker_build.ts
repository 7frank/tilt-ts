import type { ImageBuildContext } from "dockerode";
import {tiltConfig  } from "./tiltState";
import type { SYNC, RUN } from "./SYNC";


export function docker_build(
  imageName: string,
  buildContext: ImageBuildContext = {
    context: ".",
    src: ["Dockerfile"],
  },
  hot?: {
    ignore?: string[];
    live_update?: (SYNC | RUN)[];
  }
) {
  tiltConfig.state.docker_build[imageName] = [imageName, buildContext, hot];
}
