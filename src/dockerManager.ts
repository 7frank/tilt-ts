import Docker, { type ImageBuildOptions } from "dockerode";
import { finished } from "stream/promises";
import type { DockerBuildConfig } from "./types";

export class DockerManager {
  private docker: Docker;
  private registry: string;

  constructor(registry: string) {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
    this.registry = registry;
  }

  async buildImage(config: DockerBuildConfig): Promise<void> {
    const { imageName, buildContext } = config;
    const privateTag = `${this.registry}/${imageName}`;

    console.log(`🐳 Building image: ${imageName}`);
    
    try {
      // Build the image
      const stream = await this.docker.buildImage(buildContext, {
        t: imageName,
      } as ImageBuildOptions);

      stream.pipe(process.stdout);
      await finished(stream);

      // Tag for private registry
      await this.docker.getImage(imageName).tag({ repo: privateTag });
      console.log(`📦 Tagged: ${privateTag}`);

      // Push to registry
      const pushStream = await this.docker
        .getImage(privateTag)
        .push({ authconfig: { serveraddress: this.registry } });

      pushStream.pipe(process.stdout);
      await finished(pushStream);

      console.log(`✅ Successfully built and pushed: ${imageName}`);
    } catch (error) {
      console.error(`❌ Failed to build ${imageName}:`, error);
      throw error;
    }
  }

  async removeImage(imageName: string): Promise<void> {
    try {
      const privateTag = `${this.registry}/${imageName}`;
      
      // Remove both local and registry tags
      await this.docker.getImage(imageName).remove();
      await this.docker.getImage(privateTag).remove({ force: true });
      
      console.log(`🗑️  Removed image: ${imageName}`);
    } catch (error) {
      console.warn(`⚠️  Failed to remove ${imageName}:`, error);
    }
  }
}