import Docker, { type ImageBuildOptions } from "dockerode";
import { finished } from "stream/promises";
import { $ } from "bun";
import cloneDeep from "clone-deep";
import { diff as changes, applyChange } from "deep-diff";
import * as jsondiffpatch from "jsondiffpatch";
import { tiltConfig } from "./src/tiltState";
import path from "node:path";

async function tiltUp() {
  const tiltfilePath = path.resolve("./tiltfile.ts");

  await import(tiltfilePath);

  const tiltState = tiltConfig.state;
  let oldTiltState = cloneDeep(tiltState);

  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  var lhs = oldTiltState;

  var rhs = tiltState;

  var differences = changes(lhs, rhs);
  console.log(differences);

  const diffpatcher = jsondiffpatch.create({
    objectHash: function (obj: any) {
      return obj.name;
    },
  });

  const delta = diffpatcher.diff(lhs, rhs);
  console.log("delta", delta);

  tiltConfig.writeToDisk();

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


import { command, run, string, positional, subcommands } from "cmd-ts";

// "up" command
const upCommand = command({
  name: "up",
  description: "Start the Tilt environment.",
  args: {},
  handler: ({}) => {
   tiltUp()
  },
});

// Define the CLI with subcommands
const tiltCli = subcommands({
  name: "tilt",
  cmds: { up: upCommand },
});

// Run the CLI
run(tiltCli, process.argv.slice(2));
