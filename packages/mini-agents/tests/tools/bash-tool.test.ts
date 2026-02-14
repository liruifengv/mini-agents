/**
 * BashTool 单元测试
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../src/tools';
import {
  BackgroundShellManager,
  createBashKillTool,
  createBashOutputTool,
  createBashTool,
} from '../../src/tools';

/**
 * 从 ToolResult 中提取 content
 */
function getContent(result: ToolResult): string {
  return result.content;
}

describe('BashTool', () => {
  const bashTool = createBashTool();

  describe('foreground execution', () => {
    it('should execute simple command', async () => {
      // 执行简单命令
      const result = await bashTool.execute({ command: 'echo hello' });
      expect(getContent(result)).toContain('hello');
    });

    it('should return exit code on failure', async () => {
      // 执行失败的命令
      const result = await bashTool.execute({ command: 'exit 1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('exit code 1');
    });

    it('should capture stderr', async () => {
      // 捕获标准错误
      const result = await bashTool.execute({ command: 'echo error >&2' });
      expect(getContent(result)).toContain('stderr');
      expect(getContent(result)).toContain('error');
    });

    it('should timeout long running commands', async () => {
      // 超时测试（设置 1 秒超时）
      const result = await bashTool.execute({
        command: 'sleep 10',
        timeout: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 10000);
  });

  describe('background execution', () => {
    // 每次测试后清理后台进程
    afterEach(async () => {
      await BackgroundShellManager.clearAll();
    });

    it('should start background command and return bash_id', async () => {
      // 启动后台命令
      const result = await bashTool.execute({
        command: 'sleep 5',
        run_in_background: true,
      });

      expect(result.success).toBe(true);
      expect(getContent(result)).toContain('Background command started');
      expect(getContent(result)).toContain('Bash ID:');
    });
  });
});

describe('BashOutputTool', () => {
  const bashTool = createBashTool();
  const bashOutputTool = createBashOutputTool();

  afterEach(async () => {
    await BackgroundShellManager.clearAll();
  });

  it('should retrieve output from background shell', async () => {
    // 启动后台命令
    const startResult = await bashTool.execute({
      command: 'echo line1 && echo line2',
      run_in_background: true,
    });

    // 提取 bash ID
    const match = getContent(startResult).match(/Bash ID: (\w+)/);
    expect(match).not.toBeNull();
    const bashId = match![1];

    // 等待命令执行
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 获取输出
    const result = await bashOutputTool.execute({ bash_id: bashId });
    expect(getContent(result)).toContain('line1');
    expect(getContent(result)).toContain('line2');
  });

  it('should return error for non-existent shell', async () => {
    // 查询不存在的 shell
    const result = await bashOutputTool.execute({ bash_id: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Shell not found');
  });

  it('should filter output with regex', async () => {
    // 启动后台命令
    const startResult = await bashTool.execute({
      command: 'echo apple && echo banana && echo apricot',
      run_in_background: true,
    });

    const match = getContent(startResult).match(/Bash ID: (\w+)/);
    const bashId = match![1];

    await new Promise((resolve) => setTimeout(resolve, 500));

    // 使用过滤器获取输出
    const result = await bashOutputTool.execute({
      bash_id: bashId,
      filter: '^ap',
    });
    const content = getContent(result);
    expect(content).toContain('apple');
    expect(content).toContain('apricot');
    // 输出区域只有 apple 和 apricot（过滤了 banana）
    // 注意：Command 行包含原始命令，但 New Output 部分只有过滤后的结果
    const outputSection = content.split('--- New Output')[1];
    expect(outputSection).toContain('apple');
    expect(outputSection).toContain('apricot');
    expect(outputSection).not.toContain('banana');
  });
});

describe('BashKillTool', () => {
  const bashTool = createBashTool();
  const bashKillTool = createBashKillTool();

  afterEach(async () => {
    await BackgroundShellManager.clearAll();
  });

  it('should terminate background shell', async () => {
    // 启动后台命令
    const startResult = await bashTool.execute({
      command: 'sleep 60',
      run_in_background: true,
    });

    const match = getContent(startResult).match(/Bash ID: (\w+)/);
    const bashId = match![1];

    // 终止进程
    const result = await bashKillTool.execute({ bash_id: bashId });
    expect(result.success).toBe(true);
    expect(getContent(result)).toContain('Shell terminated');
    expect(getContent(result)).toContain(bashId);
  });

  it('should return error for non-existent shell', async () => {
    // 终止不存在的 shell
    const result = await bashKillTool.execute({ bash_id: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Shell not found');
  });
});

describe('BackgroundShellManager', () => {
  beforeEach(async () => {
    await BackgroundShellManager.clearAll();
  });

  afterEach(async () => {
    await BackgroundShellManager.clearAll();
  });

  it('should track available shell IDs', async () => {
    const bashTool = createBashTool();

    // 初始应该为空
    expect(BackgroundShellManager.getAvailableIds()).toHaveLength(0);

    // 启动后台命令
    await bashTool.execute({
      command: 'sleep 5',
      run_in_background: true,
    });

    // 应该有一个 shell
    expect(BackgroundShellManager.getAvailableIds()).toHaveLength(1);
  });
});
