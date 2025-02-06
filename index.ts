import Docker, {
  type ImageBuildContext,
  type ImageBuildOptions,
} from "dockerode";

/*
 bun run --watch index.ts
 load previous "state"
 run all commands and update state
 diff state
 run actual commands from the diff
 */

interface GlobalTiltState {
  docker_build: Parameters<typeof docker_build>[];
}

const tiltState: GlobalTiltState = { docker_build: [] };

const sync = (src: string, dest: string) => {
  return { type: "sync", src, dest };
};
type SYNC = ReturnType<typeof sync>;

const run = (fileOrPath: string, options: { trigger: string[] }) => {
  return { type: "run", path: fileOrPath, options };
};

type RUN = ReturnType<typeof run>;

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
  tiltState.docker_build.push([imageName, buildContext, hot]);
}

docker_build(
  "ecosystem/dashie",
  {
    context: ".",
    src: ["Dockerfile"],
  },
  {
    ignore: [],
    live_update: [
      sync("src/*", "/app/src"),
      run("bun install", { trigger: ["package.json"] }),
    ],
  }
);

import * as chokidar from "chokidar";
import { exec } from "child_process";

export function watchAndSyncFiles(
  containerName: string,
  srcPath: string,
  destPath: string
) {
  chokidar
    .watch(srcPath, { ignoreInitial: true })
    .on("all", (event, filePath) => {
      console.log(`Detected ${event} in ${filePath}, syncing to container...`);
      exec(
        `kubectl cp ${filePath} ${containerName}:${destPath}`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(`Error syncing file: ${stderr}`);
          } else {
            console.log(`File synced successfully.`);
          }
        }
      );
    });
}

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

for await (const d of tiltState.docker_build) {
  const [imageName, buildContext, hot] = d;
  await docker.buildImage(buildContext!, {
    t: imageName,
  } satisfies ImageBuildOptions);

  const paths = (hot?.live_update ?? []).filter(
    (it) => it.type == "sync"
  ) as SYNC[];
  for (const p of paths) {
    watchAndSyncFiles("TODOContainerName after k8s_yaml()", p.src, p.dest);
  }
}
