// src/dockerManager.ts
import Docker, { type ImageBuildOptions } from "dockerode";
import { finished } from "stream/promises";
import { ShellExecutor } from "./utils/shellExecutor";
import type { DockerBuildConfig } from "./types";

export class DockerManager {
  private docker: Docker;
  private registry: string;
  private connectionVerified: boolean = false;

  constructor(registry: string) {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
    this.registry = registry;
  }

  /**
   * Check if Docker daemon is accessible
   */
  async checkConnection(): Promise<void> {
    if (this.connectionVerified) return;

    try {
      // First check if docker command is available
      const dockerExists = await ShellExecutor.commandExists('docker');
      if (!dockerExists) {
        throw new Error("Docker command not found. Please install Docker.");
      }

      // Test Docker daemon connection using CLI (more reliable than dockerode)
      const pingResult = await ShellExecutor.execQuiet('docker', ['info'], { timeout: 10000 });
      if (!pingResult.success) {
        throw new Error(`Docker daemon not responding: ${pingResult.stderr}`);
      }

      // Test basic operations
      const versionResult = await ShellExecutor.execQuiet('docker', ['version', '--format', 'json']);
      if (!versionResult.success) {
        throw new Error(`Cannot get Docker version: ${versionResult.stderr}`);
      }

      // Also verify dockerode connection
      await this.docker.ping();
      
      console.log("✅ Docker connection verified");
      this.connectionVerified = true;
    } catch (error) {
      console.error("❌ Docker connection failed:", error);
      throw new Error(`Cannot connect to Docker daemon: ${error}`);
    }
  }

  async buildImage(config: DockerBuildConfig): Promise<void> {
    const { imageName, buildContext } = config;
    const privateTag = `${this.registry}/${imageName}`;

    console.log(`🐳 Building image: ${imageName}`);
    
    try {
      await this.checkConnection();

      // Validate build context
      if (!buildContext.context) {
        throw new Error("Build context is required");
      }

      // Check if build context path exists
      const contextExists = await Bun.file(buildContext.context).exists();
      if (!contextExists) {
        throw new Error(`Build context path does not exist: ${buildContext.context}`);
      }

      // Check if Dockerfile exists
      const dockerfilePath = buildContext.dockerfile || 'Dockerfile';
      const dockerfileFullPath = `${buildContext.context}/${dockerfilePath}`;
      const dockerfileExists = await Bun.file(dockerfileFullPath).exists();
      if (!dockerfileExists) {
        throw new Error(`Dockerfile not found: ${dockerfileFullPath}`);
      }

      console.log(`   Context: ${buildContext.context}`);
      console.log(`   Dockerfile: ${dockerfilePath}`);

      // Use docker CLI for building (more reliable than dockerode for complex builds)
      const buildArgs = [
        'build',
        '-t', imageName,
        '-f', dockerfilePath,
        buildContext.context
      ];

      // Add build args if provided
      if (buildContext.build_args) {
        for (const [key, value] of Object.entries(buildContext.build_args)) {
          buildArgs.push('--build-arg', `${key}=${value}`);
        }
      }

      // Build with streaming output
      const buildResult = await ShellExecutor.execStream('docker', buildArgs, {
        timeout: 600000 // 10 minutes timeout for builds
      });

      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.stderr}`);
      }

      // Verify image was created
      const verifyResult = await ShellExecutor.execQuiet('docker', [
        'images', '--format', 'table {{.Repository}}:{{.Tag}}', imageName
      ]);

      if (!verifyResult.success || !verifyResult.stdout.includes(imageName)) {
        throw new Error(`Image ${imageName} was not created successfully`);
      }

      // Tag for private registry
      const tagResult = await ShellExecutor.exec('docker', ['tag', imageName, privateTag]);
      if (!tagResult.success) {
        throw new Error(`Failed to tag image: ${tagResult.stderr}`);
      }
      console.log(`📦 Tagged: ${privateTag}`);

      // Push to registry (with retry logic)
      await this.pushImageWithRetry(privateTag, 3);

      console.log(`✅ Successfully built and pushed: ${imageName}`);
    } catch (error) {
      console.error(`❌ Failed to build ${imageName}:`, error);
      
      // Cleanup failed build artifacts
      try {
        await ShellExecutor.execQuiet('docker', ['rmi', imageName, '--force']);
        await ShellExecutor.execQuiet('docker', ['rmi', privateTag, '--force']);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to cleanup failed build: ${cleanupError}`);
      }
      
      throw error;
    }
  }

  private async pushImageWithRetry(imageTag: string, maxRetries: number): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 Pushing ${imageTag} (attempt ${attempt}/${maxRetries})`);
        
        // Use docker CLI for pushing (more reliable progress reporting)
        const pushResult = await ShellExecutor.execStream('docker', ['push', imageTag], {
          timeout: 600000 // 10 minutes timeout for push
        });

        if (!pushResult.success) {
          throw new Error(`Push failed: ${pushResult.stderr}`);
        }

        // Success - break retry loop
        console.log(`✅ Successfully pushed: ${imageTag}`);
        return;

      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️  Push attempt ${attempt} failed: ${error}`);
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`⏳ Retrying in ${delay/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to push after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async removeImage(imageName: string): Promise<void> {
    try {
      await this.checkConnection();
      
      const privateTag = `${this.registry}/${imageName}`;
      
      // Remove both local and registry tags using docker CLI
      const images = [imageName, privateTag];
      
      for (const image of images) {
        const removeResult = await ShellExecutor.execQuiet('docker', ['rmi', image, '--force']);
        if (removeResult.success) {
          console.log(`🗑️  Removed: ${image}`);
        }
      }
      
      console.log(`✅ Cleaned up image: ${imageName}`);
    } catch (error) {
      console.warn(`⚠️  Failed to remove ${imageName}:`, error);
    }
  }

  /**
   * List all images built by Tilt
   */
  async listTiltImages(): Promise<string[]> {
    try {
      await this.checkConnection();
      
      const listResult = await ShellExecutor.execQuiet('docker', [
        'images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', `reference=${this.registry}/*`
      ]);

      if (listResult.success) {
        return listResult.stdout.split('\n').filter(line => line.trim());
      }

      return [];
    } catch (error) {
      console.warn(`⚠️  Failed to list images:`, error);
      return [];
    }
  }

  /**
   * Get Docker system info for debugging
   */
  async getSystemInfo(): Promise<any> {
    try {
      await this.checkConnection();
      
      const infoResult = await ShellExecutor.execQuiet('docker', ['system', 'info', '--format', 'json']);
      if (infoResult.success) {
        return JSON.parse(infoResult.stdout);
      }
      
      // Fallback to basic info
      const basicInfoResult = await ShellExecutor.execQuiet('docker', ['info']);
      return { 
        raw: basicInfoResult.stdout,
        error: basicInfoResult.stderr 
      };
    } catch (error) {
      return { error: error.toString() };
    }
  }

  /**
   * Clean up dangling images and build cache
   */
  async cleanup(): Promise<void> {
    try {
      await this.checkConnection();
      
      console.log("🧹 Cleaning up Docker artifacts...");
      
      // Remove dangling images
      const pruneDanglingResult = await ShellExecutor.exec('docker', [
        'image', 'prune', '-f'
      ]);

      if (pruneDanglingResult.success) {
        console.log("   ✅ Removed dangling images");
      } else {
        console.warn(`   ⚠️  Failed to remove dangling images: ${pruneDanglingResult.stderr}`);
      }

      // Prune build cache
      const pruneBuildResult = await ShellExecutor.exec('docker', [
        'builder', 'prune', '-f'
      ]);

      if (pruneBuildResult.success) {
        console.log("   ✅ Cleaned build cache");
      } else {
        console.warn(`   ⚠️  Failed to clean build cache: ${pruneBuildResult.stderr}`);
      }

      // Remove unused volumes (optional)
      const pruneVolumesResult = await ShellExecutor.execQuiet('docker', [
        'volume', 'prune', '-f'
      ]);

      if (pruneVolumesResult.success) {
        console.log("   ✅ Cleaned unused volumes");
      }

      console.log("✅ Docker cleanup completed");
    } catch (error) {
      console.warn(`⚠️  Docker cleanup failed: ${error}`);
    }
  }

  /**
   * Check if an image exists locally
   */
  async imageExists(imageName: string): Promise<boolean> {
    try {
      const inspectResult = await ShellExecutor.execQuiet('docker', [
        'image', 'inspect', imageName
      ]);
      return inspectResult.success;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get image build history
   */
  async getImageHistory(imageName: string): Promise<string[]> {
    try {
      await this.checkConnection();
      
      const historyResult = await ShellExecutor.execQuiet('docker', [
        'history', imageName, '--format', 'table {{.CreatedBy}}'
      ]);

      if (historyResult.success) {
        return historyResult.stdout.split('\n').filter(line => line.trim());
      }
      return [];
    } catch (error) {
      console.warn(`⚠️  Failed to get image history for ${imageName}:`, error);
      return [];
    }
  }

  /**
   * Get container logs for debugging
   */
  async getContainerLogs(containerName: string, lines: number = 100): Promise<string> {
    try {
      const logsResult = await ShellExecutor.execQuiet('docker', [
        'logs', '--tail', lines.toString(), containerName
      ]);

      return logsResult.success ? logsResult.stdout : logsResult.stderr;
    } catch (error) {
      return `Error getting logs: ${error}`;
    }
  }

  /**
   * Check registry connectivity
   */
  async checkRegistryConnection(): Promise<boolean> {
    try {
      // Try to ping the registry
      const registryHost = this.registry.split(':')[0];
      const registryPort = parseInt(this.registry.split(':')[1] || '5000');

      const canConnect = await ShellExecutor.testConnection(registryHost, registryPort, 5000);
      
      if (!canConnect) {
        console.warn(`⚠️  Cannot connect to registry ${this.registry}`);
        return false;
      }

      // Try a simple registry operation
      const testResult = await ShellExecutor.execQuiet('docker', [
        'search', '--limit', '1', 'alpine'
      ], { timeout: 10000 });

      return testResult.success;
    } catch (error) {
      console.warn(`⚠️  Registry connection check failed: ${error}`);
      return false;
    }
  }

  /**
   * Get running containers in our namespace
   */
  async getRunningContainers(): Promise<Array<{ name: string; image: string; status: string }>> {
    try {
      const containersResult = await ShellExecutor.execQuiet('docker', [
        'ps', '--format', 'json'
      ]);

      if (!containersResult.success) {
        return [];
      }

      const containers = containersResult.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            const container = JSON.parse(line);
            return {
              name: container.Names,
              image: container.Image,
              status: container.Status
            };
          } catch {
            return null;
          }
        })
        .filter(container => container !== null)
        .filter(container => container.image.startsWith(this.registry));

      return containers;
    } catch (error) {
      console.warn(`⚠️  Failed to get running containers: ${error}`);
      return [];
    }
  }

  /**
   * Force stop and remove containers by image
   */
  async stopContainersByImage(imageName: string): Promise<void> {
    try {
      const privateTag = `${this.registry}/${imageName}`;
      
      // Find containers using this image
      const containerResult = await ShellExecutor.execQuiet('docker', [
        'ps', '-a', '--filter', `ancestor=${privateTag}`, '--format', '{{.ID}}'
      ]);

      if (!containerResult.success || !containerResult.stdout.trim()) {
        return; // No containers found
      }

      const containerIds = containerResult.stdout.split('\n').filter(id => id.trim());
      
      if (containerIds.length > 0) {
        console.log(`🛑 Stopping ${containerIds.length} container(s) for image ${imageName}`);
        
        // Stop containers
        await ShellExecutor.exec('docker', ['stop', ...containerIds]);
        
        // Remove containers
        await ShellExecutor.exec('docker', ['rm', '--force', ...containerIds]);
        
        console.log(`✅ Cleaned up containers for ${imageName}`);
      }
    } catch (error) {
      console.warn(`⚠️  Failed to stop containers for ${imageName}: ${error}`);
    }
  }
}