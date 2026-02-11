import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEditTool } from '../../src/tools/edit-tool';

describe('EditTool', () => {
  let tempDir: string;
  let editTool: ReturnType<typeof createEditTool>;

  beforeAll(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-tool-test-'));
    editTool = createEditTool(tempDir);
  });

  afterAll(async () => {
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should replace text in file', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await fs.writeFile(filePath, 'Hello World');

    const result = await editTool.execute({
      path: 'test.txt',
      old_str: 'World',
      new_str: 'Mini Agent',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Successfully edited');

    // 验证文件内容
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Hello Mini Agent');
  });

  it('should return error when file not found', async () => {
    const result = await editTool.execute({
      path: 'nonexistent.txt',
      old_str: 'foo',
      new_str: 'bar',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('should return error when old_str not found', async () => {
    const filePath = path.join(tempDir, 'no-match.txt');
    await fs.writeFile(filePath, 'Hello World');

    const result = await editTool.execute({
      path: 'no-match.txt',
      old_str: 'NotExist',
      new_str: 'bar',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Text not found in file');
  });

  it('should replace only first occurrence', async () => {
    const filePath = path.join(tempDir, 'multi.txt');
    await fs.writeFile(filePath, 'foo bar foo bar foo');

    const result = await editTool.execute({
      path: 'multi.txt',
      old_str: 'foo',
      new_str: 'baz',
    });

    expect(result.success).toBe(true);

    // String.replace 只替换第一个匹配
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('baz bar foo bar foo');
  });

  it('should handle multiline replacement', async () => {
    const filePath = path.join(tempDir, 'multiline.txt');
    await fs.writeFile(filePath, 'line1\nline2\nline3');

    const result = await editTool.execute({
      path: 'multiline.txt',
      old_str: 'line1\nline2',
      new_str: 'newline1\nnewline2',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('newline1\nnewline2\nline3');
  });

  it('should preserve indentation', async () => {
    const filePath = path.join(tempDir, 'indent.txt');
    await fs.writeFile(filePath, '  function foo() {\n    return 1;\n  }');

    const result = await editTool.execute({
      path: 'indent.txt',
      old_str: '    return 1;',
      new_str: '    return 2;',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('  function foo() {\n    return 2;\n  }');
  });

  it('should handle UTF-8 content', async () => {
    const filePath = path.join(tempDir, 'utf8.txt');
    await fs.writeFile(filePath, '你好世界');

    const result = await editTool.execute({
      path: 'utf8.txt',
      old_str: '世界',
      new_str: 'World',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('你好World');
  });

  it('should support absolute paths', async () => {
    const filePath = path.join(tempDir, 'absolute.txt');
    await fs.writeFile(filePath, 'Hello');

    const result = await editTool.execute({
      path: filePath,
      old_str: 'Hello',
      new_str: 'Hi',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Hi');
  });

  it('should handle empty new_str (deletion)', async () => {
    const filePath = path.join(tempDir, 'delete.txt');
    await fs.writeFile(filePath, 'Hello World');

    const result = await editTool.execute({
      path: 'delete.txt',
      old_str: ' World',
      new_str: '',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Hello');
  });
});
