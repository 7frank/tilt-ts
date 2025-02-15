import Docker, {
  type ImageBuildContext,
  type ImageBuildOptions,
} from "dockerode";

import { finished } from "stream/promises";

import { $, file, FileBlob } from "bun";

const PORT = 3001;

interface GlobalTiltState {
  k8s: { context: string; namespace: string };
  docker: { registry: string };
  docker_build: Record<string, Parameters<typeof docker_build>>;
  k8s_yaml: Record<string, Parameters<typeof k8s_yaml>>;
}

const initialTiltState: GlobalTiltState = {
  docker: { registry: "localhost:5000" },
  k8s: { context: "k3d-ecosys-local-dev  ", namespace: "eco_test" },
  docker_build: {},
  k8s_yaml: {},
};

async function getCachedConfig(
  fp: FileBlob,
  initialTiltState: GlobalTiltState
): Promise<GlobalTiltState> {
  await $`mkdir -p .tilt-ts`;

  return (await fp.exists()) ? await fp.json() : initialTiltState;
}

/*

 load previous "state"
 run all commands and update state
 diff state
 run actual commands from the diff
 */

const sync = (src: string, dest: string) => {
  return { type: "sync", src, dest };
};
type SYNC = ReturnType<typeof sync>;

const run = (fileOrPath: string, options: { trigger: string[] }) => {
  return { type: "run", path: fileOrPath, options };
};

type RUN = ReturnType<typeof run>;
const configFile = file(`.tilt-ts/state-${PORT}.json`);

const tiltState = await getCachedConfig(configFile, initialTiltState);

const cloneDeep = require("clone-deep");

let oldTiltState = cloneDeep(tiltState);

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
  tiltState.docker_build[imageName] = [imageName, buildContext, hot];
}

export function k8s_yaml(yamlFileName: string) {
  tiltState.k8s_yaml[yamlFileName] = [yamlFileName];
}

docker_build(
  "ecosystem/nginx",
  {
    context: "./example",
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

var lhs = oldTiltState;

var rhs = tiltState;

import { diff as changes, applyChange } from "deep-diff";
var differences = changes(lhs, rhs);
console.log(differences);

import * as jsondiffpatch from "jsondiffpatch";

const diffpatcher = jsondiffpatch.create({
  objectHash: function (obj: any) {
    return obj.name;
  },
});

const delta = diffpatcher.diff(lhs, rhs);
console.log("delta", delta);

await configFile.write(JSON.stringify(tiltState, null, 2));

const dryRun = true;

const { promisify } = require("util");

const followProgress = promisify(docker.modem.followProgress).bind(
  docker.modem
);

for await (const [key, d] of Object.entries(tiltState.docker_build)) {
  const [imageName, buildContext, hot] = d;

  console.log("Building ", imageName);
  const stream = await docker.buildImage(buildContext!, {
    t: imageName,
  } satisfies ImageBuildOptions);

  stream.pipe(process.stdout);
  await finished(stream);

  const privateRegistry = "localhost:36269";
  const privateTag = privateRegistry + "/" + imageName;

  await docker.getImage(imageName).tag({ repo: privateTag });
  console.log("Tagged", privateTag);

  // Push the image
  const pushStream = await docker
    .getImage(privateTag)
    .push({ authconfig: { serveraddress: privateRegistry } });

  pushStream.pipe(process.stdout);
  await finished(pushStream);

  const paths = (hot?.live_update ?? []).filter(
    (it) => it.type == "sync"
  ) as SYNC[];
  for (const p of paths) {
    watchAndSyncFiles("TODOContainerName after k8s_yaml()", p.src, p.dest);
  }
}
