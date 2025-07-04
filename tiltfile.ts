import { k8s_yaml } from "./src/k8s_yaml";
import { docker_build } from "./src/docker_build";
import { sync, run } from "./src/SYNC";

docker_build(
  "ecosystem/nginx",
  {
    context: "./example",
    src: ["Dockerfile"],
  },
  {
    ignore: [],
    live_update: [
      //sync("src/*", "/app/src"),
      sync("example/*", "/usr/share/nginx/html"),
      //run("bun install", { trigger: ["package.json"] }),
    ],
  }
);

k8s_yaml("./example");

docker_build(
  "ecosystem/app-test",
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
