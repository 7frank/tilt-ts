import { k8s_yaml } from "./k8s_yaml";
import { docker_build } from "./docker_build";
import { sync, run } from "./SYNC";

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
