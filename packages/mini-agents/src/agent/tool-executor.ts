import type { Tool, ToolResult } from '../tools/core/base';

/**
 * 执行单个工具调用
 * 包括：工具查找、参数传递、异常捕获与包装
 *
 * @param tools - 已注册的工具列表
 * @param functionName - 要执行的工具名称
 * @param functionArgs - 工具参数
 * @returns 工具执行结果（永远不抛异常，错误封装在 ToolResult 中）
 */
export async function executeTool(
  tools: Tool[],
  functionName: string,
  functionArgs: Record<string, unknown>
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === functionName);
  if (!tool) {
    return {
      success: false,
      content: '',
      error: `Unknown tool: ${functionName}`,
    };
  }

  try {
    return await tool.execute(functionArgs);
  } catch (error: unknown) {
    // 捕获工具执行期间的所有异常，转换为失败的 ToolResult
    const err = error instanceof Error ? error : new Error(String(error));
    const errorDetail = `${err.name || 'Error'}: ${err.message}`;
    const errorTrace = err.stack || '';
    return {
      success: false,
      content: '',
      error: `Tool execution failed: ${errorDetail}\n\nTraceback:\n${errorTrace}`,
    };
  }
}
