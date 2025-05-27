import { k8s_yaml } from "./src/k8s_yaml";
import { docker_build } from "./src/docker_build";
import { sync, run } from "./src/SYNC";

// Build nginx image with live updates
docker_build(
  "ecosystem/nginx",
  {
    context: "./example",
    src: ["Dockerfile"],
  },
  {
    ignore: ["*.log", "tmp/*"],
    live_update: [
      // Sync local files to container
      sync("example/*", "/usr/share/nginx/html"),
      // Could add run commands for more complex updates
      // run("nginx -s reload", { trigger: ["nginx.conf"] }),
    ],
  }
);

// Apply Kubernetes manifests from example directory
k8s_yaml("./example/");

// Build a second test image
docker_build(
  "ecosystem/app-test",
  {
    context: "./example",
    src: ["Dockerfile"],
  },
  {
    ignore: ["node_modules", "*.test.js"],
    live_update: [
      // Sync source code
      sync("src/*", "/app/src"),
      // Re-install dependencies when package.json changes
      run("bun install", { trigger: ["package.json"] }),
      // Restart the application after updates
      run("pkill -f 'node.*app' || true && node /app/src/index.js &", {
        trigger: ["src/**/*.js"],
      }),
    ],
  }
);
