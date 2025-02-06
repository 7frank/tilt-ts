import * as k8s from '@kubernetes/client-node';
import * as fs from 'fs';

const kc = new k8s.KubeConfig();
kc.loadFromDefault(); // Uses ~/.kube/config

const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

export async function applyK8sYaml(filePath: string) {
    console.log(`Applying Kubernetes YAML: ${filePath}`);

    const yaml = fs.readFileSync(filePath, 'utf8');
    const manifest = JSON.parse(JSON.stringify(yaml));

    try {
        await k8sApi.createNamespacedDeployment('default', manifest);
        console.log('Kubernetes deployment applied successfully.');
    } catch (error) {
        console.error(`Error applying Kubernetes YAML: ${error}`);
    }
}
