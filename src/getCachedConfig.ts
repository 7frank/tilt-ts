import { promises as fs } from "fs";
import path from "path";
import type { GlobalTiltState } from "./types";

export async function getCachedConfig(
  filePath: string,
  initialTiltState: GlobalTiltState
): Promise<GlobalTiltState> {
  // Ensure the directory exists
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  try {
    // Check if file exists
    await fs.access(filePath);
    
    // Read and parse the file
    const fileContent = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error: any) {
    // If file doesn't exist or can't be read/parsed, return initial state
    if (error.code === 'ENOENT') {
      // File doesn't exist, return initial state
      return initialTiltState;
    } else if (error instanceof SyntaxError) {
      // JSON parsing error, log warning and return initial state
      console.warn(`⚠️  Failed to parse config file ${filePath}, using defaults:`, error.message);
      return initialTiltState;
    } else {
      // Other error (permissions, etc.), log warning and return initial state
      console.warn(`⚠️  Failed to read config file ${filePath}, using defaults:`, error.message);
      return initialTiltState;
    }
  }
}