/**
 * EditTool - 编辑文件内容（精确字符串替换）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { tool } from '../core/zod-tool';

/**
 * 创建 EditTool
 * @param workspaceDir 工作目录，用于解析相对路径
 */
export function createEditTool(workspaceDir: string) {
  return tool({
    name: 'edit',
    description:
      'Perform exact string replacement in a file. The old_str must match exactly. You must read the file first before editing. Preserve exact indentation from the source.',
    parameters: z.object({
      path: z.string().describe('File path (relative paths resolved from workspace directory)'),
      old_str: z.string().describe('Exact string to find and replace'),
      new_str: z.string().describe('Replacement string'),
    }),
    async execute({ path: filePath, old_str, new_str }) {
      try {
        // 1. 解析路径
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workspaceDir, filePath);

        // 2. 检查文件是否存在
        try {
          await fs.access(absolutePath);
        } catch {
          return {
            success: false,
            content: '',
            error: `File not found: ${filePath}`,
          };
        }

        // 3. 读取文件内容
        const content = await fs.readFile(absolutePath, 'utf-8');

        // 4. 检查 old_str 是否存在
        if (!content.includes(old_str)) {
          return {
            success: false,
            content: '',
            error: `Text not found in file: ${old_str}`,
          };
        }

        // 5. 执行替换
        const newContent = content.replace(old_str, new_str);

        // 6. 写回文件
        await fs.writeFile(absolutePath, newContent, 'utf-8');

        return `Successfully edited: ${absolutePath}`;
      } catch (error) {
        if (error instanceof Error) {
          return {
            success: false,
            content: '',
            error: error.message,
          };
        }
        return {
          success: false,
          content: '',
          error: String(error),
        };
      }
    },
  });
}
