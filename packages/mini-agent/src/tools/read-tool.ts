/**
 * ReadTool - 读取文件内容
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { truncateTextByTokens } from '../utils/token';
import { tool } from './zod-tool';

const MAX_TOKENS = 32000;

/**
 * 创建 ReadTool
 * @param workspaceDir 工作目录，用于解析相对路径
 */
export function createReadTool(workspaceDir: string) {
  return tool({
    name: 'read',
    description:
      'Read file contents with line numbers. Supports partial reading with offset and limit for large files.',
    parameters: z.object({
      path: z.string().describe('File path (relative paths resolved from workspace directory)'),
      offset: z.number().optional().describe('Starting line number (1-indexed, default: 1)'),
      limit: z.number().optional().describe('Number of lines to read (default: all)'),
    }),
    async execute({ path: filePath, offset, limit }) {
      try {
        // 1. 解析路径
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workspaceDir, filePath);

        // 2. 读取文件
        const content = await fs.readFile(absolutePath, 'utf-8');
        const lines = content.split('\n');

        // 3. 行切片 (offset 是 1-indexed)
        const startLine = offset ? offset - 1 : 0;
        const endLine = limit ? startLine + limit : lines.length;
        const selectedLines = lines.slice(startLine, endLine);

        // 4. 添加行号格式
        const formattedLines = selectedLines.map((line, index) => {
          const lineNum = startLine + index + 1; // 转回 1-indexed
          return `${lineNum.toString().padStart(6)}|${line}`;
        });

        let result = formattedLines.join('\n');

        // 5. Token 截断
        result = truncateTextByTokens(result, MAX_TOKENS);

        return result;
      } catch (error) {
        if (error instanceof Error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
              success: false,
              content: '',
              error: `File not found: ${filePath}`,
            };
          }
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
