// tiltfile.ts
import { docker_build, k8s_yaml, sync, run } from '@nk11/tilt-ts';

// Build Express.js application with live updates
docker_build(
  "express-app",
  {
    context: ".",
    dockerfile: "Dockerfile",
  },
  {
    // Ignore files that shouldn't trigger rebuilds
    ignore: [
      "*.log",
      "*.md", 
      "node_modules",
      ".git/**",
      "*.test.js",
      "coverage/**",
      ".tilt-ts/**"
    ],
    live_update: [
      // Sync server code changes
      sync("server.js", "/app/server.js"),
      
      // Sync source directory
      sync("src/**/*", "/app/src/"),
      
      // Sync public assets
      sync("public/**/*", "/app/public/"),
      
      // Restart server when main files change
      run("pkill -f 'node.*server.js' || true", { 
        trigger: ["server.js"] 
      }),
      
      // Start server in background after restart
      run("node server.js &", { 
        trigger: ["server.js"] 
      }),
      
      // Reinstall dependencies when package.json changes
      run("npm ci --only=production", { 
        trigger: ["package.json", "package-lock.json"] 
      }),
      
      // Log changes for debugging
      run("echo '🔄 Code updated at $(date)'", { 
        trigger: ["src/**/*", "public/**/*"] 
      }),
    ],
  }
);

// Deploy Kubernetes resources
k8s_yaml([
  "./deployment.yaml",
  "./service.yaml"
]);

console.log("🎯 Tilt configuration loaded!");
console.log("📝 Express.js app will be available at http://localhost:30080");
console.log("🔄 Live updates enabled for:");
console.log("   - server.js");
console.log("   - src/ directory");
console.log("   - public/ directory");