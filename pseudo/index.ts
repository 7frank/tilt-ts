import { dockerBuild, restartContainer } from './docker';
import { applyK8sYaml } from './kubernetes';
import { watchAndCopy } from './fileWatcher';
import { portForward } from './portForward';

const IMAGE_NAME = "myrepo/user-service";
const CONTAINER_NAME = "user-service";
const K8S_YAML_PATH = "./k8s/user-deployment.yaml";
const FILES_TO_WATCH = "./user-service/src";
const DEST_PATH_IN_CONTAINER = "/app/src";

// Build image
dockerBuild(IMAGE_NAME, './user-service')
    .then(() => restartContainer(CONTAINER_NAME))
    .catch(err => console.error(err));

// Apply Kubernetes YAML
applyK8sYaml(K8S_YAML_PATH);

// Watch files and sync changes
watchAndCopy(FILES_TO_WATCH, CONTAINER_NAME, DEST_PATH_IN_CONTAINER);

// Port forwarding
portForward(CONTAINER_NAME, 5000, 5000);
