import { tiltConfig } from "./tiltState";

export function k8s_yaml(yamlFileName: string) {
  tiltConfig.state.k8s_yaml[yamlFileName] = [yamlFileName];
}
