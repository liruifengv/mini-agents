/**
 * WriteTool - 写入文件内容
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { tool } from '../core/zod-tool';

/**
 * 创建 WriteTool
 * @param workspaceDir 工作目录，用于解析相对路径
 */
export function createWriteTool(workspaceDir: string) {
  return tool({
    name: 'write',
    description:
      'Write content to a file. Overwrites existing files completely. For existing files, read first using read tool. Prefer editing existing files unless explicitly needed.',
    parameters: z.object({
      path: z.string().describe('File path (relative paths resolved from workspace directory)'),
      content: z.string().describe('Complete content to write (replaces existing content)'),
    }),
    async execute({ path: filePath, content }) {
      try {
        // 1. 解析路径
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workspaceDir, filePath);

        // 2. 创建父目录（如果不存在）
        const parentDir = path.dirname(absolutePath);
        await fs.mkdir(parentDir, { recursive: true });

        // 3. 写入文件
        await fs.writeFile(absolutePath, content, 'utf-8');

        return `Successfully wrote to: ${absolutePath}`;
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
