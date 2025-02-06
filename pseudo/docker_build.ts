import Docker from 'dockerode';
import { exec } from 'child_process';

const docker = new Docker();

export async function dockerBuild(imageName: string, contextPath: string) {
    console.log(`Building Docker image: ${imageName}`);
    return new Promise((resolve, reject) => {
        exec(`docker build -t ${imageName} ${contextPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error building image: ${stderr}`);
                reject(error);
            } else {
                console.log(stdout);
                resolve(stdout);
            }
        });
    });
}

export async function restartContainer(containerName: string) {
    try {
        console.log(`Restarting container: ${containerName}`);
        const container = docker.getContainer(containerName);
        await container.restart();
        console.log(`Container ${containerName} restarted successfully`);
    } catch (error) {
        console.error(`Error restarting container: ${error}`);
    }
}
