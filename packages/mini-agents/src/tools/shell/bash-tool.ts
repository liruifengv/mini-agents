/**
 * BashTool - Shell 命令执行工具
 * 支持前台/后台执行，跨平台（Unix bash / Windows PowerShell）
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { tool } from '../core/zod-tool';

/**
 * 后台 Shell 进程数据
 */
export interface BackgroundShell {
  bashId: string;
  command: string;
  process: ChildProcess;
  startTime: number;
  outputLines: string[];
  lastReadIndex: number;
  status: 'running' | 'completed' | 'failed' | 'terminated' | 'error';
  exitCode: number | null;
}

/**
 * 后台 Shell 管理器（单例模式）
 */
// biome-ignore lint/complexity/noStaticOnlyClass: intentionally using static-only class for singleton pattern
export class BackgroundShellManager {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed via BackgroundShellManager.shells in static methods
  private static shells: Map<string, BackgroundShell> = new Map();

  /**
   * 添加后台 Shell
   */
  static add(shell: BackgroundShell): void {
    BackgroundShellManager.shells.set(shell.bashId, shell);
  }

  /**
   * 获取后台 Shell
   */
  static get(bashId: string): BackgroundShell | undefined {
    return BackgroundShellManager.shells.get(bashId);
  }

  /**
   * 获取所有可用的 bash ID
   */
  static getAvailableIds(): string[] {
    return Array.from(BackgroundShellManager.shells.keys());
  }

  /**
   * 获取新输出（从上次读取位置开始）
   */
  static getNewOutput(bashId: string, filterPattern?: string): string[] {
    const shell = BackgroundShellManager.shells.get(bashId);
    if (!shell) return [];

    const newLines = shell.outputLines.slice(shell.lastReadIndex);
    shell.lastReadIndex = shell.outputLines.length;

    if (filterPattern) {
      try {
        const regex = new RegExp(filterPattern);
        return newLines.filter((line) => regex.test(line));
      } catch {
        // 无效正则，返回所有行
        return newLines;
      }
    }

    return newLines;
  }

  /**
   * 终止后台 Shell
   */
  static async terminate(bashId: string): Promise<BackgroundShell> {
    const shell = BackgroundShellManager.shells.get(bashId);
    if (!shell) {
      throw new Error(`Shell not found: ${bashId}`);
    }

    // 终止进程
    if (shell.process.exitCode === null) {
      shell.process.kill('SIGTERM');

      // 等待进程结束，超时后强制终止
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          shell.process.kill('SIGKILL');
          resolve();
        }, 5000);

        shell.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    shell.status = 'terminated';
    shell.exitCode = shell.process.exitCode;

    // 从管理器移除
    BackgroundShellManager.shells.delete(bashId);

    return shell;
  }

  /**
   * 清理所有后台 Shell（用于测试）
   */
  static async clearAll(): Promise<void> {
    const ids = BackgroundShellManager.getAvailableIds();
    for (const id of ids) {
      try {
        await BackgroundShellManager.terminate(id);
      } catch {
        // 忽略错误
      }
    }
  }
}

/**
 * 创建 BashTool
 */
export function createBashTool() {
  const isWindows = process.platform === 'win32';
  const shellName = isWindows ? 'PowerShell' : 'bash';

  return tool({
    name: 'bash',
    description: `Execute ${shellName} commands in foreground or background.

For terminal operations like git, npm, docker, etc. DO NOT use for file operations - use specialized tools.

Parameters:
  - command (required): ${shellName} command to execute
  - timeout (optional): Timeout in seconds (default: 120, max: 600) for foreground commands
  - run_in_background (optional): Set true for long-running commands (servers, etc.)

Tips:
  - Quote file paths with spaces: cd "My Documents"
  - Chain dependent commands with ${isWindows ? ';' : '&&'}
  - Use absolute paths instead of cd when possible
  - For background commands, monitor with bash_output and terminate with bash_kill`,
    parameters: z.object({
      command: z.string().describe(`The ${shellName} command to execute`),
      timeout: z
        .number()
        .optional()
        .default(120)
        .describe('Timeout in seconds (default: 120, max: 600)'),
      run_in_background: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set true to run command in background'),
    }),
    async execute({ command, timeout = 120, run_in_background = false }) {
      try {
        // 验证超时范围
        const validTimeout = Math.min(Math.max(timeout, 1), 600);

        if (run_in_background) {
          // 后台执行
          const bashId = randomUUID().slice(0, 8);

          const childProcess = isWindows
            ? spawn('powershell.exe', ['-NoProfile', '-Command', command], {
                stdio: ['ignore', 'pipe', 'pipe'],
              })
            : spawn('bash', ['-c', command], {
                stdio: ['ignore', 'pipe', 'pipe'],
              });

          const shell: BackgroundShell = {
            bashId,
            command,
            process: childProcess,
            startTime: Date.now(),
            outputLines: [],
            lastReadIndex: 0,
            status: 'running',
            exitCode: null,
          };

          // 监听输出
          childProcess.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString('utf-8').split('\n').filter(Boolean);
            shell.outputLines.push(...lines);
          });

          childProcess.stderr?.on('data', (data: Buffer) => {
            const lines = data
              .toString('utf-8')
              .split('\n')
              .filter(Boolean)
              .map((line) => `[stderr] ${line}`);
            shell.outputLines.push(...lines);
          });

          // 监听进程结束
          childProcess.on('exit', (code) => {
            shell.exitCode = code;
            shell.status = code === 0 ? 'completed' : 'failed';
          });

          childProcess.on('error', (err) => {
            shell.status = 'error';
            shell.outputLines.push(`[error] ${err.message}`);
          });

          BackgroundShellManager.add(shell);

          return `Background command started.\nBash ID: ${bashId}\nCommand: ${command}\n\nUse bash_output to monitor, bash_kill to terminate.`;
        }

        // 前台执行
        return new Promise<string | { success: boolean; content: string; error: string }>(
          (resolve) => {
            const childProcess = isWindows
              ? spawn('powershell.exe', ['-NoProfile', '-Command', command], {
                  stdio: ['ignore', 'pipe', 'pipe'],
                })
              : spawn('bash', ['-c', command], {
                  stdio: ['ignore', 'pipe', 'pipe'],
                });

            let stdout = '';
            let stderr = '';
            let killed = false;

            // 超时处理
            const timeoutId = setTimeout(() => {
              killed = true;
              childProcess.kill('SIGKILL');
              resolve({
                success: false,
                content: '',
                error: `Command timed out after ${validTimeout} seconds`,
              });
            }, validTimeout * 1000);

            childProcess.stdout?.on('data', (data: Buffer) => {
              stdout += data.toString('utf-8');
            });

            childProcess.stderr?.on('data', (data: Buffer) => {
              stderr += data.toString('utf-8');
            });

            childProcess.on('exit', (code) => {
              if (killed) return;
              clearTimeout(timeoutId);

              const exitCode = code ?? 0;
              const isSuccess = exitCode === 0;

              // 格式化输出
              let output = stdout;
              if (stderr) {
                output += `\n[stderr]:\n${stderr}`;
              }
              if (exitCode !== 0) {
                output += `\n[exit_code]: ${exitCode}`;
              }

              if (!output.trim()) {
                output = '(no output)';
              }

              if (isSuccess) {
                resolve(output);
              } else {
                resolve({
                  success: false,
                  content: output,
                  error: `Command failed with exit code ${exitCode}`,
                });
              }
            });

            childProcess.on('error', (err) => {
              if (killed) return;
              clearTimeout(timeoutId);
              resolve({
                success: false,
                content: '',
                error: err.message,
              });
            });
          }
        );
      } catch (error) {
        return {
          success: false,
          content: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/**
 * 创建 BashOutputTool - 获取后台 Shell 输出
 */
export function createBashOutputTool() {
  return tool({
    name: 'bash_output',
    description: `Retrieve output from a background shell command.

Parameters:
  - bash_id (required): The bash ID returned by bash command with run_in_background=true
  - filter (optional): Regex pattern to filter output lines

Returns the new output since last read, or status if shell has completed.`,
    parameters: z.object({
      bash_id: z.string().describe('The bash ID of the background shell'),
      filter: z.string().optional().describe('Optional regex pattern to filter output'),
    }),
    async execute({ bash_id, filter }) {
      try {
        const shell = BackgroundShellManager.get(bash_id);
        if (!shell) {
          const availableIds = BackgroundShellManager.getAvailableIds();
          return {
            success: false,
            content: '',
            error: `Shell not found: ${bash_id}. Available IDs: ${availableIds.length > 0 ? availableIds.join(', ') : 'none'}`,
          };
        }

        const newOutput = BackgroundShellManager.getNewOutput(bash_id, filter);
        const runningTime = Math.round((Date.now() - shell.startTime) / 1000);

        let result = `Bash ID: ${bash_id}\n`;
        result += `Command: ${shell.command}\n`;
        result += `Status: ${shell.status}\n`;
        result += `Running time: ${runningTime}s\n`;

        if (shell.exitCode !== null) {
          result += `Exit code: ${shell.exitCode}\n`;
        }

        result += `\n--- New Output (${newOutput.length} lines) ---\n`;
        result += newOutput.length > 0 ? newOutput.join('\n') : '(no new output)';

        return result;
      } catch (error) {
        return {
          success: false,
          content: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/**
 * 创建 BashKillTool - 终止后台 Shell
 */
export function createBashKillTool() {
  return tool({
    name: 'bash_kill',
    description: `Terminate a background shell command.

Parameters:
  - bash_id (required): The bash ID of the background shell to terminate

Sends SIGTERM first, then SIGKILL after 5 seconds if the process doesn't exit.`,
    parameters: z.object({
      bash_id: z.string().describe('The bash ID of the background shell to terminate'),
    }),
    async execute({ bash_id }) {
      try {
        const shell = await BackgroundShellManager.terminate(bash_id);
        const runningTime = Math.round((Date.now() - shell.startTime) / 1000);

        let result = `Shell terminated.\n`;
        result += `Bash ID: ${bash_id}\n`;
        result += `Command: ${shell.command}\n`;
        result += `Running time: ${runningTime}s\n`;
        result += `Exit code: ${shell.exitCode}\n`;
        result += `\n--- Final Output (${shell.outputLines.length} lines) ---\n`;
        result += shell.outputLines.length > 0 ? shell.outputLines.join('\n') : '(no output)';

        return result;
      } catch (error) {
        const availableIds = BackgroundShellManager.getAvailableIds();
        return {
          success: false,
          content: '',
          error: `${error instanceof Error ? error.message : String(error)}. Available IDs: ${availableIds.length > 0 ? availableIds.join(', ') : 'none'}`,
        };
      }
    },
  });
}
