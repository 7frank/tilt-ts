import path from "node:path";
import { command, run, string, positional, subcommands, flag,option, boolean } from "cmd-ts";
import { tiltConfig } from "./src/tiltState";
import { TiltEngine } from "./src/tiltEngine";

const tiltEngine = new TiltEngine();

async function loadTiltfile() {
  const tiltfilePath = path.resolve("./tiltfile.ts");
  
  try {
    // Clear previous state for fresh load
    tiltConfig.state.docker_build = {};
    tiltConfig.state.k8s_yaml = {};
    
    // Import the Tiltfile to register resources
    delete require.cache[tiltfilePath]; // Clear module cache
    await import(tiltfilePath + `?t=${Date.now()}`); // Cache bust
    
    console.log(`📝 Loaded Tiltfile: ${tiltfilePath}`);
    console.log(`🐳 Docker builds: ${Object.keys(tiltConfig.state.docker_build).length}`);
    console.log(`☸️  K8s resources: ${Object.keys(tiltConfig.state.k8s_yaml).length}`);
  } catch (error) {
    console.error("❌ Failed to load Tiltfile:", error);
    throw error;
  }
}

// Commands
const upCommand = command({
  name: "up",
  description: "Start the Tilt environment",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Show what would be done without actually doing it",
      defaultValue: () =>false
    })
  },
  handler: async ({ dryRun }) => {
    await loadTiltfile();
    await tiltEngine.up(dryRun == true);
  },
});

const downCommand = command({
  name: "down", 
  description: "Stop the Tilt environment",
  args: {},
  handler: async () => {
    await tiltEngine.down();
  },
});

const statusCommand = command({
  name: "status",
  description: "Show current Tilt status",
  args: {},
  handler: async () => {
    await loadTiltfile();
    console.log("📊 Current Tilt State:");
    console.log("Docker Registry:", tiltConfig.state.docker.registry);
    console.log("K8s Context:", tiltConfig.state.k8s.context);
    console.log("K8s Namespace:", tiltConfig.state.k8s.namespace);
    console.log("\n🐳 Docker Builds:");
    Object.entries(tiltConfig.state.docker_build).forEach(([name, config]) => {
      console.log(`  - ${name}: ${config.buildContext.context}`);
    });
    console.log("\n☸️  K8s Resources:");
    Object.entries(tiltConfig.state.k8s_yaml).forEach(([name, config]) => {
      console.log(`  - ${config.yamlPath}`);
    });
  }
});

// Main CLI
const tiltCli = subcommands({
  name: "tilt",
  description: "Tilt - Kubernetes for Development",
  cmds: { 
    up: upCommand,
    down: downCommand, 
    status: statusCommand
  },
});

// Run CLI
run(tiltCli, process.argv.slice(2));