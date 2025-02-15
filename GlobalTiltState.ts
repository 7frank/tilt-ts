import type { docker_build } from "./docker_build";
import type { k8s_yaml } from "./k8s_yaml";

export interface GlobalTiltState {
  k8s: { context: string; namespace: string; };
  docker: { registry: string; };
  docker_build: Record<string, Parameters<typeof docker_build>>;
  k8s_yaml: Record<string, Parameters<typeof k8s_yaml>>;
}
