// src/liveUpdateManager.ts
import * as chokidar from "chokidar";
import * as path from "path";
import { glob } from "glob";
import { ShellExecutor } from "./utils/shellExecutor";
import type { LiveUpdateStep, SYNC, RUN, DockerBuildConfig } from "./types";

export interface LiveUpdateSession {
  imageName: string;
  containerName?: string;
  podName?: string;
  namespace: string;
  watcher?: chokidar.FSWatcher;
  isActive: boolean;
}

export class LiveUpdateManager {
  private sessions: Map<string, LiveUpdateSession> = new Map();
  private namespace: string;
  private context: string;

  constructor(context: string, namespace: string) {
    this.context = context;
    this.namespace = namespace;
  }

  /**
   * Start live update session for a Docker build configuration
   */
  async startLiveUpdate(config: DockerBuildConfig): Promise<void> {
    const { imageName, hot } = config;

    if (!hot?.live_update || hot.live_update.length === 0) {
      console.log(`📝 No live updates configured for ${imageName}`);
      return;
    }

    // Stop existing session if any
    await this.stopLiveUpdate(imageName);

    console.log(`🔄 Starting live updates for ${imageName}...`);

    try {
      // Find the pod/container for this image
      const podInfo = await this.findPodForImage(imageName);
      if (!podInfo) {
        console.warn(`⚠️  No running pods found for image ${imageName}`);
        return;
      }

      // Create session
      const session: LiveUpdateSession = {
        imageName,
        podName: podInfo.podName,
        containerName: podInfo.containerName,
        namespace: this.namespace,
        isActive: true,
      };

      // Set up file watching
      const watcher = await this.setupFileWatcher(config, session);
      session.watcher = watcher;

      this.sessions.set(imageName, session);
      console.log(
        `✅ Live updates active for ${imageName} -> ${podInfo.podName}`
      );
    } catch (error) {
      console.error(`❌ Failed to start live updates for ${imageName}:`, error);
      throw error;
    }
  }

  /**
   * Stop live update session for an image
   */
  async stopLiveUpdate(imageName: string): Promise<void> {
    const session = this.sessions.get(imageName);
    if (!session) return;

    console.log(`🛑 Stopping live updates for ${imageName}...`);

    if (session.watcher) {
      await session.watcher.close();
    }

    session.isActive = false;
    this.sessions.delete(imageName);
    console.log(`✅ Stopped live updates for ${imageName}`);
  }

  /**
   * Stop all live update sessions
   */
  async stopAllLiveUpdates(): Promise<void> {
    const imageNames = Array.from(this.sessions.keys());
    await Promise.all(imageNames.map((name) => this.stopLiveUpdate(name)));
  }

  /**
   * Get status of all live update sessions
   */
  getSessionStatus(): Array<{
    imageName: string;
    podName?: string;
    containerName?: string;
    isActive: boolean;
    watchedPaths: string[];
  }> {
    return Array.from(this.sessions.values()).map((session) => ({
      imageName: session.imageName,
      podName: session.podName,
      containerName: session.containerName,
      isActive: session.isActive,
      watchedPaths: session.watcher?.getWatched()
        ? Object.keys(session.watcher.getWatched()).flat()
        : [],
    }));
  }

  /**
   * Find pod and container for a specific image
   */
  private async findPodForImage(imageName: string): Promise<{
    podName: string;
    containerName: string;
  } | null> {
    try {
      // Get pods with the image
      const result = await ShellExecutor.execQuiet("kubectl", [
        "get",
        "pods",
        "-n",
        this.namespace,
        "-o",
        'jsonpath={range .items[*]}{.metadata.name}{"\\t"}{range .spec.containers[*]}{.name}{"\\t"}{.image}{"\\n"}{end}{end}',
      ]);

      if (!result.success) {
        throw new Error(`Failed to get pods: ${result.stderr}`);
      }

      // Parse the output to find matching pods
      const lines = result.stdout.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const [podName, containerName, image] = parts;

          // Check if image matches (handle registry prefixes)
          if (
            image.includes(imageName) ||
            image.endsWith(`/${imageName}:latest`)
          ) {
            // Verify pod is running
            const podStatus = await this.getPodStatus(podName);
            if (podStatus === "Running") {
              return {
                podName: podName.trim(),
                containerName: containerName.trim(),
              };
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Error finding pod for image ${imageName}:`, error);
      return null;
    }
  }

  /**
   * Get pod status
   */
  private async getPodStatus(podName: string): Promise<string> {
    try {
      const result = await ShellExecutor.execQuiet("kubectl", [
        "get",
        "pod",
        podName,
        "-n",
        this.namespace,
        "-o",
        "jsonpath={.status.phase}",
      ]);

      return result.success ? result.stdout.trim() : "Unknown";
    } catch (error) {
      return "Unknown";
    }
  }

  /**
   * Set up file watcher for live updates
   */
  private async setupFileWatcher(
    config: DockerBuildConfig,
    session: LiveUpdateSession
  ): Promise<chokidar.FSWatcher> {
    const { buildContext, hot } = config;
    const contextPath = path.resolve(buildContext.context || ".");

    if (!hot?.live_update) {
      throw new Error("No live update configuration found");
    }

    // Collect all paths to watch from sync steps
    const syncSteps = hot.live_update.filter(
      (step): step is SYNC => step.type === "sync"
    );
    const runSteps = hot.live_update.filter(
      (step): step is RUN => step.type === "run"
    );

    // Build watch patterns
    const watchPatterns: string[] = [];

    for (const sync of syncSteps) {
      // Convert sync src to absolute paths
      const srcPattern = path.resolve(contextPath, sync.src);
      watchPatterns.push(srcPattern);
    }

    // Add trigger patterns from run steps
    for (const runStep of runSteps) {
      for (const trigger of runStep.options.trigger) {
        const triggerPattern = path.resolve(contextPath, trigger);
        watchPatterns.push(triggerPattern);
      }
    }

    console.log(`👀 Watching patterns for ${config.imageName}:`, watchPatterns);

    // Create watcher with appropriate options
    const watcher = chokidar.watch(watchPatterns, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.*",
        "**/*.tmp",
        "**/*.log",
        ...(hot.ignore || []),
      ],
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Set up event handlers
    watcher.on("all", async (event, filePath) => {
      if (!session.isActive) return;

      console.log(`📁 File ${event}: ${filePath}`);

      try {
        await this.handleFileChange(config, session, event, filePath);
      } catch (error) {
        console.error(`❌ Error handling file change for ${filePath}:`, error);
      }
    });

    watcher.on("error", (error) => {
      console.error(`❌ File watcher error for ${config.imageName}:`, error);
    });

    return watcher;
  }

  /**
   * Handle individual file changes
   */
  private async handleFileChange(
    config: DockerBuildConfig,
    session: LiveUpdateSession,
    event: string,
    filePath: string
  ): Promise<void> {
    const { hot } = config;
    if (!hot?.live_update || !session.podName) return;

    const contextPath = path.resolve(config.buildContext.context || ".");
    const relativePath = path.relative(contextPath, filePath);

    console.log(
      `🔄 Processing ${event} for ${relativePath} in ${session.podName}...`
    );

    // Process sync steps
    for (const step of hot.live_update) {
      if (step.type === "sync") {
        await this.handleSyncStep(
          step,
          session,
          filePath,
          relativePath,
          contextPath
        );
      } else if (step.type === "run") {
        await this.handleRunStep(step, session, filePath, relativePath);
      }
    }
  }

  /**
   * Handle sync step
   */
  private async handleSyncStep(
    sync: SYNC,
    session: LiveUpdateSession,
    filePath: string,
    relativePath: string,
    contextPath: string
  ): Promise<void> {
    try {
      // Check if file matches sync pattern
      const syncPattern = sync.src;
      const matches = await this.matchesPattern(relativePath, syncPattern);

      if (!matches) return;

      console.log(`📂 Syncing ${relativePath} -> ${sync.dest}`);

      // Determine target path in container
      let targetPath = sync.dest;

      // If sync.src has wildcards, preserve relative structure
      if (syncPattern.includes("*")) {
        const cleanPattern = syncPattern.replace(/\/?\*+.*$/, "");
        const relativeToPattern = path.relative(cleanPattern, relativePath);
        targetPath = path.posix.join(sync.dest, relativeToPattern);
      }

      // Use kubectl cp to sync file
      const cpResult = await ShellExecutor.exec(
        "kubectl",
        [
          "cp",
          filePath,
          `${session.podName}:${targetPath}`,
          "-n",
          session.namespace,
          "-c",
          session.containerName || "",
        ].filter((arg) => arg !== "")
      );

      if (cpResult.success) {
        console.log(`✅ Synced ${relativePath} -> ${targetPath}`);
      } else {
        console.error(`❌ Failed to sync ${relativePath}: ${cpResult.stderr}`);
      }
    } catch (error) {
      console.error(`❌ Sync error for ${relativePath}:`, error);
    }
  }

  /**
   * Handle run step
   */
  private async handleRunStep(
    runStep: RUN,
    session: LiveUpdateSession,
    filePath: string,
    relativePath: string
  ): Promise<void> {
    try {
      // Check if file matches any trigger pattern
      const triggered = await Promise.all(
        runStep.options.trigger.map((pattern) =>
          this.matchesPattern(relativePath, pattern)
        )
      );

      if (!triggered.some(Boolean)) return;

      console.log(`🚀 Running command: ${runStep.path}`);

      // Execute command in the container
      const execResult = await ShellExecutor.exec(
        "kubectl",
        [
          "exec",
          session.podName!,
          "-n",
          session.namespace,
          "-c",
          session.containerName || "",
          "--",
          "sh",
          "-c",
          runStep.path,
        ].filter((arg) => arg !== "")
      );

      if (execResult.success) {
        console.log(`✅ Command executed successfully`);
        if (execResult.stdout) {
          console.log(`   Output: ${execResult.stdout}`);
        }
      } else {
        console.error(`❌ Command failed: ${execResult.stderr}`);
      }
    } catch (error) {
      console.error(`❌ Run command error:`, error);
    }
  }

  /**
   * Check if a file path matches a pattern
   */
  private async matchesPattern(
    filePath: string,
    pattern: string
  ): Promise<boolean> {
    try {
      // Handle simple wildcard patterns
      if (pattern.includes("*")) {
        const globPattern = pattern.replace(/\\/g, "/");
        const normalizedPath = filePath.replace(/\\/g, "/");

        // Use minimatch-style matching
        const regex = new RegExp(
          "^" +
            globPattern
              .replace(/\*\*/g, "___DOUBLE_STAR___")
              .replace(/\*/g, "[^/]*")
              .replace(/___DOUBLE_STAR___/g, ".*")
              .replace(/\?/g, "[^/]") +
            "$"
        );

        return regex.test(normalizedPath);
      }

      // Exact match or prefix match
      return filePath === pattern || filePath.startsWith(pattern + "/");
    } catch (error) {
      console.warn(`⚠️  Pattern matching error for ${pattern}:`, error);
      return false;
    }
  }

  /**
   * Manually trigger a sync for all files
   */
  async triggerFullSync(imageName: string): Promise<void> {
    const session = this.sessions.get(imageName);
    if (!session || !session.isActive) {
      console.warn(`⚠️  No active session for ${imageName}`);
      return;
    }

    console.log(`🔄 Triggering full sync for ${imageName}...`);
    // Implementation would scan all watched directories and sync everything
    // This is useful for initial sync or manual refresh
  }

  /**
   * Get logs from a container for debugging
   */
  async getContainerLogs(
    imageName: string,
    lines: number = 50
  ): Promise<string> {
    const session = this.sessions.get(imageName);
    if (!session?.podName) {
      return `No active session for ${imageName}`;
    }

    try {
      const result = await ShellExecutor.execQuiet(
        "kubectl",
        [
          "logs",
          session.podName,
          "-n",
          session.namespace,
          "-c",
          session.containerName || "",
          "--tail",
          lines.toString(),
        ].filter((arg) => arg !== "")
      );

      return result.success ? result.stdout : `Error: ${result.stderr}`;
    } catch (error) {
      return `Error getting logs: ${error}`;
    }
  }
}
