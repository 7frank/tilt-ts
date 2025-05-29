// src/index.ts - Main exports for npm package
export { docker_build } from './docker_build';
export { k8s_yaml, validateYamlFile, getYamlStats } from './k8s_yaml';
export { sync, run } from './SYNC';
export { tiltConfig } from './tiltState';
export { TiltEngine } from './tiltEngine';
export { DockerManager } from './dockerManager';
export { KubernetesManager } from './kubernetesManager';
export { LiveUpdateManager } from './liveUpdateManager';
export { StateAnalyzer } from './stateAnalyzer';
export { ShellExecutor } from './utils/shellExecutor';

// Export types
export type {
  GlobalTiltState,
  DockerBuildConfig,
  K8sYamlConfig,
  HotReloadConfig,
  LiveUpdateStep,
  SYNC,
  RUN,
  TiltStateChange,
  ShellResult,
  ShellOptions
} from './types';