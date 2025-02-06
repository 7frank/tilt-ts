import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';
import { exec } from 'child_process';

export function watchAndCopy(srcPath: string, containerName: string, destPath: string) {
    console.log(`Watching files in: ${srcPath}`);

    chokidar.watch(srcPath, { ignoreInitial: true }).on('all', (event, filePath) => {
        console.log(`${event} detected in ${filePath}, copying to container...`);

        exec(`docker cp ${filePath} ${containerName}:${destPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error copying file: ${stderr}`);
            } else {
                console.log(`File copied successfully: ${stdout}`);
            }
        });
    });
}
