#!/usr/bin/env node
import path from "node:path";
import {
  command,
  run,
  string,
  positional,
  subcommands,
  flag,
  option,
  boolean,
} from "cmd-ts";
import { tiltConfig } from "./src/tiltState";
import { TiltEngine } from "./src/tiltEngine";

const tiltEngine = new TiltEngine();

async function loadTiltfile() {
  const tiltfilePath = path.resolve("./tiltfile.ts");

  try {
    // Ensure tiltConfig is initialized first
    await tiltConfig.init();

    // Clear previous state for fresh load
    const state = await tiltConfig.getState();
    state.docker_build = {};
    state.k8s_yaml = {};

    // Import the Tiltfile to register resources
    delete require.cache[tiltfilePath]; // Clear module cache
    await import(tiltfilePath + `?t=${Date.now()}`); // Cache bust

    console.log(`📝 Loaded Tiltfile: ${tiltfilePath}`);
    const updatedState = await tiltConfig.getState();
    console.log(
      `🐳 Docker builds: ${Object.keys(updatedState.docker_build).length}`
    );
    console.log(
      `☸️  K8s resources: ${Object.keys(updatedState.k8s_yaml).length}`
    );
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
      defaultValue: () => false,
    }),
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

const validateCommand = command({
  name: "validate",
  description: "Validate Tiltfile and YAML resources",
  args: {},
  handler: async () => {
    try {
      await loadTiltfile();

      console.log("🔍 Validating Tiltfile configuration...");

      const state = await tiltConfig.getState();

      // Validate Docker builds
      const dockerBuilds = Object.entries(state.docker_build);
      console.log(`\n🐳 Docker Builds (${dockerBuilds.length}):`);

      for (const [name, config] of dockerBuilds) {
        console.log(`   ✅ ${name}`);
        console.log(`      Context: ${config.buildContext.context}`);
        console.log(
          `      Dockerfile: ${config.buildContext.dockerfile || "Dockerfile"}`
        );

        if (config.hot?.live_update) {
          console.log(
            `      Live updates: ${config.hot.live_update.length} step(s)`
          );
        }
      }

      // Validate K8s YAML files
      const k8sResources = Object.entries(state.k8s_yaml);
      console.log(`\n☸️  Kubernetes Resources (${k8sResources.length}):`);

      let totalFiles = 0;
      let validFiles = 0;
      let invalidFiles = 0;

      for (const [_, config] of k8sResources) {
        console.log(`   📄 ${config.yamlPath}`);

        // Validate the YAML file
        const { validateYamlFile } = await import("./src/k8s_yaml");
        const validation = validateYamlFile(config.yamlPath);

        totalFiles++;

        if (validation.valid) {
          console.log(`      ✅ Valid YAML`);
          validFiles++;
        } else {
          console.log(`      ❌ Invalid YAML: ${validation.error}`);
          invalidFiles++;
        }
      }

      // Summary
      console.log(`\n📊 Validation Summary:`);
      console.log(`   Docker builds: ${dockerBuilds.length}`);
      console.log(`   YAML files: ${totalFiles}`);
      console.log(`   Valid YAML: ${validFiles}`);
      console.log(`   Invalid YAML: ${invalidFiles}`);

      if (invalidFiles > 0) {
        console.log(`\n⚠️  Found ${invalidFiles} invalid YAML file(s)`);
        process.exit(1);
      } else {
        console.log(`\n✅ All configurations are valid!`);
      }
    } catch (error) {
      console.error("❌ Validation failed:", error);
      process.exit(1);
    }
  },
});

const statusCommand = command({
  name: "status",
  description: "Show current Tilt status",
  args: {},
  handler: async () => {
    await loadTiltfile();
    const state = await tiltConfig.getState();

    console.log("📊 Current Tilt State:");
    console.log("Docker Registry:", state.docker.registry);
    console.log("K8s Context:", state.k8s.context);
    console.log("K8s Namespace:", state.k8s.namespace);
    console.log("\n🐳 Docker Builds:");
    Object.entries(state.docker_build).forEach(([name, config]) => {
      console.log(`  - ${name}: ${config.buildContext.context}`);
    });
    console.log("\n☸️  K8s Resources:");
    Object.entries(state.k8s_yaml).forEach(([name, config]) => {
      console.log(`  - ${config.yamlPath}`);
    });
  },
});

// Main CLI
const tiltCli = subcommands({
  name: "tilt-ts",
  description: "Tilt TypeScript - Kubernetes for Development",
  cmds: {
    up: upCommand,
    down: downCommand,
    status: statusCommand,
    validate: validateCommand,
  },
});

// Run CLI
run(tiltCli, process.argv.slice(2));
