import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReadTool } from '../../src/tools/read-tool';

describe('ReadTool', () => {
  let tempDir: string;
  let readTool: ReturnType<typeof createReadTool>;

  beforeAll(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-tool-test-'));
    readTool = createReadTool(tempDir);

    // 创建测试文件
    const testContent = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
    await fs.writeFile(path.join(tempDir, 'test.txt'), testContent);
  });

  afterAll(async () => {
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should read entire file with line numbers', async () => {
    const result = await readTool.execute({ path: 'test.txt' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('     1|line 1');
    expect(result.content).toContain('     2|line 2');
    expect(result.content).toContain('     5|line 5');
  });

  it('should support offset parameter (1-indexed)', async () => {
    const result = await readTool.execute({ path: 'test.txt', offset: 2 });

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('     1|line 1');
    expect(result.content).toContain('     2|line 2');
    expect(result.content).toContain('     5|line 5');
  });

  it('should support limit parameter', async () => {
    const result = await readTool.execute({ path: 'test.txt', limit: 2 });

    expect(result.success).toBe(true);
    expect(result.content).toContain('     1|line 1');
    expect(result.content).toContain('     2|line 2');
    expect(result.content).not.toContain('     3|line 3');
  });

  it('should support offset + limit combination', async () => {
    const result = await readTool.execute({ path: 'test.txt', offset: 2, limit: 2 });

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('     1|line 1');
    expect(result.content).toContain('     2|line 2');
    expect(result.content).toContain('     3|line 3');
    expect(result.content).not.toContain('     4|line 4');
  });

  it('should resolve relative paths', async () => {
    const result = await readTool.execute({ path: 'test.txt' });
    expect(result.success).toBe(true);
  });

  it('should support absolute paths', async () => {
    const absolutePath = path.join(tempDir, 'test.txt');
    const result = await readTool.execute({ path: absolutePath });
    expect(result.success).toBe(true);
    expect(result.content).toContain('     1|line 1');
  });

  it('should return error when file not found', async () => {
    const result = await readTool.execute({ path: 'nonexistent.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('should truncate large files by token limit', async () => {
    // 创建一个大文件（超过 32000 tokens）
    const largeContent = Array(50000).fill('This is a test line with some content.').join('\n');
    await fs.writeFile(path.join(tempDir, 'large.txt'), largeContent);

    const result = await readTool.execute({ path: 'large.txt' });

    expect(result.success).toBe(true);
    // 截断后应该包含截断提示
    expect(result.content).toContain('Content truncated');
  });
});
