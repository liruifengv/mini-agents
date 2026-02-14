/** 工具基类定义 */
import type {
  Tool as AnthropicTool,
  ToolUnion as AnthropicToolUnion,
} from '@anthropic-ai/sdk/resources';

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 执行是否成功 */
  success: boolean;
  /** 执行结果内容 */
  content: string;
  /** 错误信息（可选） */
  error: string | null;
}

/**
 * 所有工具的基类
 */
export abstract class Tool {
  /**
   * 工具名称
   */
  abstract get name(): string;

  /**
   * 工具描述
   */
  abstract get description(): string;

  /**
   * 工具参数 schema（JSON Schema 格式）
   */
  abstract get parameters(): Record<string, unknown>;

  /**
   * 执行工具（使用任意参数）
   */

  // biome-ignore lint/suspicious/noExplicitAny: <any is ok here>
  abstract execute(...args: any[]): Promise<ToolResult>;

  /**
   * 转换为 Anthropic 工具 schema
   */
  toAnthropicSchema(): AnthropicToolUnion {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters as AnthropicTool.InputSchema,
    };
  }

  /**
   * 转换为 OpenAI Chat Completions 工具 schema（嵌套格式）
   */
  // biome-ignore lint/suspicious/noExplicitAny: OpenAI schema uses any for flexibility
  toOpenAISchema(): Record<string, any> {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  /**
   * 转换为 OpenAI Responses API 工具 schema（扁平格式）
   */
  toResponsesSchema(): {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean | null;
  } {
    return {
      type: 'function' as const,
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      strict: null,
    };
  }

  /**
   * 转换为 Gemini FunctionDeclaration 格式
   *
   * 使用 parametersJsonSchema 字段传递标准 JSON Schema，
   * Gemini SDK 可直接接受此格式。
   */
  toGeminiSchema(): {
    name: string;
    description: string;
    parametersJsonSchema: Record<string, unknown>;
  } {
    return {
      name: this.name,
      description: this.description,
      parametersJsonSchema: this.parameters,
    };
  }
}
