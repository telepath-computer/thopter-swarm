// Shell command execution utilities
import { spawn, SpawnOptions } from 'child_process';
import { ExternalToolError } from './types';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // in milliseconds
  input?: string; // stdin input
  silent?: boolean; // don't log command execution
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeout,
    input,
    silent = false
  } = options;

  if (!silent) {
    console.log(`> ${command} ${args.join(' ')}`);
  }

  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    };

    const child = spawn(command, args, spawnOptions);
    
    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

    // Set up timeout if specified
    if (timeout) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new ExternalToolError(command, `Command timed out after ${timeout}ms`));
      }, timeout);
    }

    // Collect output
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle input if provided
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.on('close', (exitCode) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const result: CommandResult = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode || 0,
        success: exitCode === 0
      };

      resolve(result);
    });

    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(new ExternalToolError(command, error.message));
    });
  });
}

// Helper for commands that should throw on failure
export async function runCommandOrThrow(
  command: string,
  args: string[] = [],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  
  if (!result.success) {
    throw new ExternalToolError(
      command,
      result.stderr || result.stdout || 'Command failed',
      result.exitCode
    );
  }
  
  return result;
}

// JSON parsing helper for commands that return JSON
export async function runCommandJson<T = any>(
  command: string,
  args: string[] = [],
  options: CommandOptions = {}
): Promise<T> {
  const result = await runCommandOrThrow(command, args, options);
  
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new ExternalToolError(
      command,
      `Failed to parse JSON output: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Check if a command exists in PATH
export async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand('which', [command], { silent: true });
    return true;
  } catch {
    return false;
  }
}

// Helper for running multiple commands in sequence
export async function runSequence(
  commands: Array<{ command: string; args?: string[]; options?: CommandOptions }>,
  stopOnError: boolean = true
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  
  for (const { command, args = [], options = {} } of commands) {
    const result = await runCommand(command, args, options);
    results.push(result);
    
    if (!result.success && stopOnError) {
      throw new ExternalToolError(
        command,
        result.stderr || result.stdout || 'Command in sequence failed',
        result.exitCode
      );
    }
  }
  
  return results;
}