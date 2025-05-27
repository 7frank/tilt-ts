import { diff as deepDiff, type DiffNew, type DiffDeleted, type DiffEdit, type DiffArray } from "deep-diff";
import type { GlobalTiltState, TiltStateChange, DockerBuildConfig, K8sYamlConfig } from "./types";

export class StateAnalyzer {
  analyzeChanges(oldState: GlobalTiltState, newState: GlobalTiltState): TiltStateChange[] {
    const differences = deepDiff(oldState, newState) || [];
    const changes: TiltStateChange[] = [];

    for (const diff of differences) {
      changes.push(this.convertDiffToChange(diff));
    }

    return changes;
  }

  private convertDiffToChange(diff: any): TiltStateChange {
    const path = diff.path || [];
    
    switch (diff.kind) {
      case 'N': // New
        return {
          type: 'added',
          path,
          value: diff.rhs
        };
      case 'D': // Deleted
        return {
          type: 'removed',
          path,
          oldValue: diff.lhs
        };
      case 'E': // Edited
        return {
          type: 'modified',
          path,
          value: diff.rhs,
          oldValue: diff.lhs
        };
      case 'A': // Array change
        return {
          type: 'modified',
          path: [...path, diff.index],
          value: diff.item?.rhs,
          oldValue: diff.item?.lhs
        };
      default:
        return {
          type: 'modified',
          path,
          value: diff.rhs,
          oldValue: diff.lhs
        };
    }
  }

  getDockerBuildChanges(changes: TiltStateChange[]): {
    added: DockerBuildConfig[];
    removed: string[];
    modified: DockerBuildConfig[];
  } {
    const dockerChanges = changes.filter(change => 
      change.path[0] === 'docker_build'
    );

    const added: DockerBuildConfig[] = [];
    const removed: string[] = [];
    const modified: DockerBuildConfig[] = [];

    for (const change of dockerChanges) {
      if (change.path.length === 2) { // docker_build.<image_name>
        const imageName = change.path[1] as string;
        
        switch (change.type) {
          case 'added':
            added.push(change.value as DockerBuildConfig);
            break;
          case 'removed':
            removed.push(imageName);
            break;
          case 'modified':
            modified.push(change.value as DockerBuildConfig);
            break;
        }
      }
    }

    return { added, removed, modified };
  }

  getK8sYamlChanges(changes: TiltStateChange[]): {
    added: K8sYamlConfig[];
    removed: string[];
    modified: K8sYamlConfig[];
  } {
    const k8sChanges = changes.filter(change => 
      change.path[0] === 'k8s_yaml'
    );

    const added: K8sYamlConfig[] = [];
    const removed: string[] = [];
    const modified: K8sYamlConfig[] = [];

    for (const change of k8sChanges) {
      if (change.path.length === 2) { // k8s_yaml.<yaml_path>
        const yamlPath = change.path[1] as string;
        
        switch (change.type) {
          case 'added':
            added.push(change.value as K8sYamlConfig);
            break;
          case 'removed':
            removed.push(yamlPath);
            break;
          case 'modified':
            modified.push(change.value as K8sYamlConfig);
            break;
        }
      }
    }

    return { added, removed, modified };
  }
}