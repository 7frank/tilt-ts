import type { ImageBuildContext } from "dockerode";
import { tiltConfig } from "./tiltState";
import type { HotReloadConfig } from "./types";

export function docker_build(
  imageName: string,
  buildContext: ImageBuildContext = {
    context: ".",
    src: ["Dockerfile"],
  },
  hot?: HotReloadConfig
) {
  // Call the synchronous method - initialization will happen when state is accessed
  tiltConfig.addDockerBuild(imageName, buildContext, hot);
}