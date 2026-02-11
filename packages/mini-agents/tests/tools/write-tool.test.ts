import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWriteTool } from '../../src/tools/write-tool';

describe('WriteTool', () => {
  let tempDir: string;
  let writeTool: ReturnType<typeof createWriteTool>;

  beforeAll(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-tool-test-'));
    writeTool = createWriteTool(tempDir);
  });

  afterAll(async () => {
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should write a new file', async () => {
    const content = 'Hello, World!';
    const result = await writeTool.execute({ path: 'new-file.txt', content });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Successfully wrote to');

    // 验证文件内容
    const written = await fs.readFile(path.join(tempDir, 'new-file.txt'), 'utf-8');
    expect(written).toBe(content);
  });

  it('should overwrite existing file', async () => {
    const filePath = path.join(tempDir, 'existing.txt');
    await fs.writeFile(filePath, 'old content');

    const newContent = 'new content';
    const result = await writeTool.execute({ path: 'existing.txt', content: newContent });

    expect(result.success).toBe(true);

    // 验证内容被覆盖
    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toBe(newContent);
  });

  it('should auto-create parent directories', async () => {
    const content = 'nested file content';
    const result = await writeTool.execute({
      path: 'nested/deep/dir/file.txt',
      content,
    });

    expect(result.success).toBe(true);

    // 验证文件和目录被创建
    const written = await fs.readFile(path.join(tempDir, 'nested/deep/dir/file.txt'), 'utf-8');
    expect(written).toBe(content);
  });

  it('should resolve relative paths', async () => {
    const result = await writeTool.execute({
      path: 'relative-path.txt',
      content: 'test',
    });

    expect(result.success).toBe(true);

    // 验证文件在 tempDir 下
    const exists = await fs
      .access(path.join(tempDir, 'relative-path.txt'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('should support absolute paths', async () => {
    const absolutePath = path.join(tempDir, 'absolute-path.txt');
    const content = 'absolute path content';
    const result = await writeTool.execute({ path: absolutePath, content });

    expect(result.success).toBe(true);

    const written = await fs.readFile(absolutePath, 'utf-8');
    expect(written).toBe(content);
  });

  it('should write with UTF-8 encoding', async () => {
    const content = '中文内容 🎉 特殊字符';
    const result = await writeTool.execute({ path: 'utf8-test.txt', content });

    expect(result.success).toBe(true);

    const written = await fs.readFile(path.join(tempDir, 'utf8-test.txt'), 'utf-8');
    expect(written).toBe(content);
  });

  it('should write empty file', async () => {
    const result = await writeTool.execute({ path: 'empty.txt', content: '' });

    expect(result.success).toBe(true);

    const written = await fs.readFile(path.join(tempDir, 'empty.txt'), 'utf-8');
    expect(written).toBe('');
  });

  it('should preserve newlines', async () => {
    const content = 'line1\nline2\nline3';
    const result = await writeTool.execute({ path: 'multiline.txt', content });

    expect(result.success).toBe(true);

    const written = await fs.readFile(path.join(tempDir, 'multiline.txt'), 'utf-8');
    expect(written).toBe(content);
  });
});
