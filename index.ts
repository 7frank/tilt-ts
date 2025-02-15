import Docker, { type ImageBuildOptions } from "dockerode";

import { finished } from "stream/promises";

import { $ } from "bun";

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
const cloneDeep = require("clone-deep");
const tiltState = getTiltState();
let oldTiltState = cloneDeep();

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

var lhs = oldTiltState;

var rhs = tiltState;

import { diff as changes, applyChange } from "deep-diff";
var differences = changes(lhs, rhs);
console.log(differences);

import * as jsondiffpatch from "jsondiffpatch";
import { k8s_yaml } from "./k8s_yaml";
import { sync, run } from "./SYNC";
import { getTiltState, updateTileStateFile } from "./getTiltState";
import { docker_build } from "./docker_build";

const diffpatcher = jsondiffpatch.create({
  objectHash: function (obj: any) {
    return obj.name;
  },
});

const delta = diffpatcher.diff(lhs, rhs);
console.log("delta", delta);

updateTileStateFile(tiltState);

/**
 * build tag and push docke rimage to private registry
 */
for await (const [key, d] of Object.entries(tiltState.docker_build)) {
  const [imageName, buildContext, hot] = d;

  const privateRegistry = tiltState.docker.registry;
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
