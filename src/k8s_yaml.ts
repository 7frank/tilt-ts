import { tiltConfig } from "./tiltState";

export function k8s_yaml(yamlPath: string) {
  tiltConfig.addK8sYaml(yamlPath);
}

