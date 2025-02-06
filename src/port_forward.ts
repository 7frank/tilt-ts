import { exec } from "child_process";

export function portForward(
  containerName: string,
  localPort: number,
  containerPort: number
) {
  console.log(
    `Forwarding port: ${localPort} -> ${containerPort} in container ${containerName}`
  );
  exec(
    `kubectl port-forward pod/${containerName} ${localPort}:${containerPort}`,
    (error, stdout, stderr) => {
      if (error) {
        console.error(`Error forwarding port: ${stderr}`);
      } else {
        console.log(`Port forwarding successful: ${stdout}`);
      }
    }
  );
}
