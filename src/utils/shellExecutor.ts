// src/utils/shellExecutor.ts
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  silent?: boolean;
  streamOutput?: boolean;
  input?: string;
}

export class ShellExecutor {
  /**
   * Execute a shell command and return the result
   */
  static async exec(
    command: string,
    args: string[] = [],
    options: ShellOptions = {}
  ): Promise<ShellResult> {
    const {
      cwd = process.cwd(),
      env = {},
      timeout = 30000,
      silent = false,
      streamOutput = false,
      input
    } = options;

    return new Promise((resolve, reject) => {
      if (!silent) {
        console.log(`🔧 Executing: ${command} ${args.join(' ')}`);
      }

      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: streamOutput ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
        }, timeout);
      }

      // Handle input if provided
      if (input && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }

      // Collect output if not streaming
      if (!streamOutput) {
        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
      }

      child.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const result: ShellResult = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
          success: code === 0
        };

        if (!silent && !result.success) {
          console.error(`❌ Command failed (exit code ${result.exitCode}): ${command} ${args.join(' ')}`);
          if (result.stderr) {
            console.error(`   stderr: ${result.stderr}`);
          }
        }

        resolve(result);
      });

      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }

  /**
   * Execute a shell command with streaming output
   */
  static async execStream(
    command: string,
    args: string[] = [],
    options: ShellOptions = {}
  ): Promise<ShellResult> {
    return this.exec(command, args, { ...options, streamOutput: true });
  }

  /**
   * Execute a shell command quietly (no output)
   */
  static async execQuiet(
    command: string,
    args: string[] = [],
    options: ShellOptions = {}
  ): Promise<ShellResult> {
    return this.exec(command, args, { ...options, silent: true });
  }

  /**
   * Execute a simple shell command using exec (for simple string commands)
   */
  static async execSimple(
    command: string,
    options: ShellOptions = {}
  ): Promise<ShellResult> {
    const {
      cwd = process.cwd(),
      env = {},
      timeout = 30000,
      silent = false
    } = options;

    try {
      if (!silent) {
        console.log(`🔧 Executing: ${command}`);
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env: { ...process.env, ...env },
        timeout,
        encoding: 'utf8'
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        success: true
      };
    } catch (error: any) {
      if (!silent) {
        console.error(`❌ Command failed: ${command}`);
        if (error.stderr) {
          console.error(`   stderr: ${error.stderr}`);
        }
      }

      return {
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || error.message,
        exitCode: error.code || 1,
        success: false
      };
    }
  }

  /**
   * Check if a command exists in PATH
   */
  static async commandExists(command: string): Promise<boolean> {
    const result = await this.execQuiet(
      process.platform === 'win32' ? 'where' : 'which',
      [command]
    );
    return result.success;
  }

  /**
   * Execute multiple commands in sequence
   */
  static async execSequence(
    commands: Array<{ command: string; args?: string[]; options?: ShellOptions }>,
    stopOnError: boolean = true
  ): Promise<ShellResult[]> {
    const results: ShellResult[] = [];

    for (const { command, args = [], options = {} } of commands) {
      const result = await this.exec(command, args, options);
      results.push(result);

      if (!result.success && stopOnError) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple commands in parallel
   */
  static async execParallel(
    commands: Array<{ command: string; args?: string[]; options?: ShellOptions }>,
    maxConcurrency: number = 3
  ): Promise<ShellResult[]> {
    const chunks: typeof commands[] = [];
    
    // Split commands into chunks based on maxConcurrency
    for (let i = 0; i < commands.length; i += maxConcurrency) {
      chunks.push(commands.slice(i, i + maxConcurrency));
    }

    const allResults: ShellResult[] = [];

    // Execute chunks sequentially, but commands within chunks in parallel
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(({ command, args = [], options = {} }) =>
        this.exec(command, args, options)
      );
      
      const chunkResults = await Promise.all(chunkPromises);
      allResults.push(...chunkResults);
    }

    return allResults;
  }

  /**
   * Test if a service is reachable
   */
  static async testConnection(
    host: string,
    port: number,
    timeout: number = 5000
  ): Promise<boolean> {
    const command = process.platform === 'win32' 
      ? 'powershell' 
      : 'timeout';
    
    const args = process.platform === 'win32'
      ? ['-Command', `Test-NetConnection -ComputerName ${host} -Port ${port} -InformationLevel Quiet`]
      : [`${timeout / 1000}`, 'bash', '-c', `echo >/dev/tcp/${host}/${port}`];

    const result = await this.execQuiet(command, args, { timeout });
    return result.success;
  }

  /**
   * Kill process by name or PID
   */
  static async killProcess(nameOrPid: string | number): Promise<boolean> {
    const isWindows = process.platform === 'win32';
    
    let command: string;
    let args: string[];

    if (typeof nameOrPid === 'number') {
      // Kill by PID
      command = isWindows ? 'taskkill' : 'kill';
      args = isWindows ? ['/F', '/PID', nameOrPid.toString()] : ['-9', nameOrPid.toString()];
    } else {
      // Kill by name
      command = isWindows ? 'taskkill' : 'pkill';
      args = isWindows ? ['/F', '/IM', nameOrPid] : ['-f', nameOrPid];
    }

    const result = await this.execQuiet(command, args);
    return result.success;
  }
}