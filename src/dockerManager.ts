// src/dockerManager.ts
import Docker, { type ImageBuildOptions } from "dockerode";
import { finished } from "stream/promises";
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
      // Test Docker daemon connection
      await this.docker.ping();
      
      // Verify we can list images (basic permission check)
      await this.docker.listImages({ limit: 1 });
      
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

      // Build the image
      const buildOptions: ImageBuildOptions = {
        t: imageName,
        dockerfile: dockerfilePath,
        ...buildContext
      };

      const stream = await this.docker.buildImage(buildContext, buildOptions);

      // Stream build output with error detection
      let buildError = false;
      let errorMessage = '';

      stream.on('data', (chunk) => {
        const data = chunk.toString();
        process.stdout.write(data);
        
        // Check for build errors in output
        if (data.includes('ERROR') || data.includes('failed')) {
          buildError = true;
          errorMessage += data;
        }
      });

      await finished(stream);

      if (buildError) {
        throw new Error(`Build failed: ${errorMessage}`);
      }

      // Verify image was created
      const images = await this.docker.listImages({
        filters: { reference: [imageName] }
      });

      if (images.length === 0) {
        throw new Error(`Image ${imageName} was not created successfully`);
      }

      // Tag for private registry
      await this.docker.getImage(imageName).tag({ repo: privateTag });
      console.log(`📦 Tagged: ${privateTag}`);

      // Push to registry (with retry logic)
      await this.pushImageWithRetry(privateTag, 3);

      console.log(`✅ Successfully built and pushed: ${imageName}`);
    } catch (error) {
      console.error(`❌ Failed to build ${imageName}:`, error);
      
      // Cleanup failed build artifacts
      try {
        await this.docker.getImage(imageName).remove({ force: true });
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
        
        const pushStream = await this.docker
          .getImage(imageTag)
          .push({ 
            authconfig: { serveraddress: this.registry },
            // Add timeout for push operations
            timeout: 300000 // 5 minutes
          });

        // Monitor push progress
        let pushError = false;
        let errorDetails = '';

        pushStream.on('data', (chunk) => {
          const data = chunk.toString();
          try {
            const lines = data.trim().split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const parsed = JSON.parse(line);
                if (parsed.error) {
                  pushError = true;
                  errorDetails += parsed.error + ' ';
                }
                // Show progress for large images
                if (parsed.progress && parsed.id) {
                  process.stdout.write(`\r   ${parsed.id}: ${parsed.progress}`);
                }
              }
            }
          } catch {
            // Non-JSON output, just display
            process.stdout.write(data);
          }
        });

        await finished(pushStream);
        console.log(); // New line after progress

        if (pushError) {
          throw new Error(`Push failed: ${errorDetails}`);
        }

        // Success - break retry loop
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
      
      // Remove both local and registry tags
      const images = await this.docker.listImages({
        filters: { reference: [imageName, privateTag] }
      });

      for (const imageInfo of images) {
        try {
          const image = this.docker.getImage(imageInfo.Id);
          await image.remove({ force: true });
        } catch (error) {
          console.warn(`⚠️  Failed to remove image ${imageInfo.Id}:`, error);
        }
      }
      
      console.log(`🗑️  Removed image: ${imageName}`);
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
      
      const images = await this.docker.listImages();
      const tiltImages: string[] = [];

      for (const imageInfo of images) {
        if (imageInfo.RepoTags) {
          for (const tag of imageInfo.RepoTags) {
            if (tag.startsWith(this.registry + '/')) {
              tiltImages.push(tag);
            }
          }
        }
      }

      return tiltImages;
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
      return await this.docker.info();
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
      const danglingImages = await this.docker.listImages({
        filters: { dangling: ['true'] }
      });

      for (const imageInfo of danglingImages) {
        try {
          await this.docker.getImage(imageInfo.Id).remove();
        } catch (error) {
          console.warn(`⚠️  Failed to remove dangling image: ${error}`);
        }
      }

      // Prune build cache
      try {
        await this.docker.pruneImages({
          filters: { dangling: ['true'] }
        });
      } catch (error) {
        console.warn(`⚠️  Failed to prune build cache: ${error}`);
      }

      console.log("✅ Docker cleanup completed");
    } catch (error) {
      console.warn(`⚠️  Docker cleanup failed: ${error}`);
    }
  }
}