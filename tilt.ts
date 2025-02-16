import Docker, { type ImageBuildOptions } from "dockerode";
import { finished } from "stream/promises";
import { $ } from "bun";
import cloneDeep from "clone-deep";
import { diff as changes, applyChange } from "deep-diff";
import * as jsondiffpatch from "jsondiffpatch";
import { tiltConfig } from "./src/tiltState";
import path from "node:path";
import { command, run, string, positional, subcommands } from "cmd-ts";

const dryRun = true;

async function tiltUp() {
  const tiltfilePath = path.resolve("./tiltfile.ts");

  const tiltState = tiltConfig.state;
  let oldTiltState = cloneDeep(tiltState);
  await import(tiltfilePath);
  let newTiltState = cloneDeep(tiltState);

  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  // TODO get differences and create TempState that has relevant changes so that later stages can apply then
  // for docker build this means we only need "N" new or changed
  // vfor k8s_yaml we should distigniush betweenadd new and remove
  var lhs = oldTiltState;
  var rhs = newTiltState;
  var differences = changes(lhs, rhs);
  console.log(differences);

  // const diffpatcher = jsondiffpatch.create({
  //   objectHash: function (obj: any) {
  //     return obj.name;
  //   },
  // });
  // const delta = diffpatcher.diff(lhs, rhs);
  // console.log("delta", delta);

  tiltConfig.writeToDisk();
  if (dryRun) return;
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
}

// "up" command
const upCommand = command({
  name: "up",
  description: "Start the Tilt environment.",
  args: {},
  handler: ({}) => {
    tiltUp();
  },
});

// Define the CLI with subcommands
const tiltCli = subcommands({
  name: "tilt",
  cmds: { up: upCommand },
});

// Run the CLI
run(tiltCli, process.argv.slice(2));
