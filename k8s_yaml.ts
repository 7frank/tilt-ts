import { tiltState } from ".";


export function k8s_yaml(yamlFileName: string) {
  tiltState.k8s_yaml[yamlFileName] = [yamlFileName];
}
