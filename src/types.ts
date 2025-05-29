// src/types.ts
import type { ImageBuildContext } from "dockerode";

export interface SYNC {
  type: "sync";
  src: string;
  dest: string;
}

export interface RUN {
  type: "run";
  path: string;
  options: { trigger: string[] };
}

export type LiveUpdateStep = SYNC | RUN;

export interface HotReloadConfig {
  ignore?: string[];
  live_update?: LiveUpdateStep[];
  build_args?: Record<string, string>;
}

export interface DockerBuildConfig {
  imageName: string;
  buildContext: ImageBuildContext & {
    build_args?: Record<string, string>;
    dockerfile?: string;
  };
  hot?: HotReloadConfig;
}

export interface K8sYamlConfig {
  yamlPath: string;
}

export interface GlobalTiltState {
  k8s: { context: string; namespace: string };
  docker: { registry: string };
  docker_build: Record<string, DockerBuildConfig>;
  k8s_yaml: Record<string, K8sYamlConfig>;
}

export interface TiltStateChange {
  type: "added" | "removed" | "modified";
  path: string[];
  value?: any;
  oldValue?: any;
}

// Shell execution types
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  silent?: boolean;
  streamOutput?: boolean;
  input?: string;
}
