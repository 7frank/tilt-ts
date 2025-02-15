import { getTiltState } from "./getTiltState";


export function k8s_yaml(yamlFileName: string) {
  getTiltState().k8s_yaml[yamlFileName] = [yamlFileName];
}
