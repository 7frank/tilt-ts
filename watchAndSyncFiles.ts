import { exec } from "child_process";
import * as chokidar from "chokidar";


export function watchAndSyncFiles(
  containerName: string,
  srcPath: string,
  destPath: string
) {
  chokidar
    .watch(srcPath, { ignoreInitial: true })
    .on("all", (event, filePath) => {
      console.log(`Detected ${event} in ${filePath}, syncing to container...`);
      exec(
        `kubectl cp ${filePath} ${containerName}:${destPath}`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(`Error syncing file: ${stderr}`);
          } else {
            console.log(`File synced successfully.`);
          }
        }
      );
    });
}
