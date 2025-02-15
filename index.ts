import Docker, {
  type ImageBuildContext,
  type ImageBuildOptions,
} from "dockerode";

import { finished } from "stream/promises";

import { $, file } from "bun";

import type { GlobalTiltState } from "./GlobalTiltState";

const PORT = 3001;

const initialTiltState: GlobalTiltState = {
  docker: { registry: "localhost:5000" },
  k8s: { context: "k3d-ecosys-local-dev  ", namespace: "eco_test" },
  docker_build: {},
  k8s_yaml: {},
};

const configFile = file(`.tilt-ts/state-${PORT}.json`);

export const tiltState = await getCachedConfig(configFile, initialTiltState);

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

k8s_yaml("./example/deployment.yaml");

/**
 * Below should be part of the tilt cli
 */

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

var lhs = oldTiltState;

var rhs = tiltState;

import { diff as changes, applyChange } from "deep-diff";
var differences = changes(lhs, rhs);
console.log(differences);

import * as jsondiffpatch from "jsondiffpatch";
import { getCachedConfig } from "./getCachedConfig";
import { k8s_yaml } from "./k8s_yaml";
import { type SYNC, type RUN, sync, run } from "./SYNC";

const diffpatcher = jsondiffpatch.create({
  objectHash: function (obj: any) {
    return obj.name;
  },
});

const delta = diffpatcher.diff(lhs, rhs);
console.log("delta", delta);

await configFile.write(JSON.stringify(tiltState, null, 2));

/**
 * build tag and push docke rimage to private registry
 */
for await (const [key, d] of Object.entries(tiltState.docker_build)) {
  const [imageName, buildContext, hot] = d;

  const privateRegistry = "localhost:36269";
  const privateTag = privateRegistry + "/" + imageName;

  console.log("Building ", imageName);
  const stream = await docker.buildImage(buildContext!, {
    t: imageName,
  } satisfies ImageBuildOptions);

  stream.pipe(process.stdout);
  await finished(stream);

  await docker.getImage(imageName).tag({ repo: privateTag });
  console.log("Tagged", privateTag);

  // Push the image
  const pushStream = await docker
    .getImage(privateTag)
    .push({ authconfig: { serveraddress: privateRegistry } });

  pushStream.pipe(process.stdout);
  await finished(pushStream);

  // const paths = (hot?.live_update ?? []).filter(
  //   (it) => it.type == "sync"
  // ) as SYNC[];
  // for (const p of paths) {
  //   watchAndSyncFiles("TODOContainerName after k8s_yaml()", p.src, p.dest);
  // }
}

await $`kubectl config set-context k3d-ecosys-local-dev`;

for await (const [key, d] of Object.entries(tiltState.k8s_yaml)) {
  const [yamlFileName] = d;

  const res = await $`kubectl apply -f ${yamlFileName}`.text();
  console.log(res);
}
