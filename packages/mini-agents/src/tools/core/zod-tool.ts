/** 基于 Zod 的工具 API */

import { z } from 'zod';
import { Tool as BaseTool, type ToolResult } from './base';
/**
 * 工具配置接口
 */
export interface ToolConfig<T extends z.ZodType> {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Zod schema */
  parameters: T;
  /** 执行函数 */
  execute: (params: z.infer<T>) => Promise<string | ToolResult>;
}

/**
 * 基于 Zod 的工具类
 */
export class ZodTool<T extends z.ZodType> extends BaseTool {
  private _name: string;
  private _description: string;
  private _parametersSchema: T;
  private _executeFn: (params: z.infer<T>) => Promise<string | ToolResult>;

  constructor(config: ToolConfig<T>) {
    super();
    this._name = config.name;
    this._description = config.description;
    this._parametersSchema = config.parameters;
    this._executeFn = config.execute;
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get parameters() {
    return z.toJSONSchema(this._parametersSchema);
  }

  // biome-ignore lint/suspicious/noExplicitAny: <any is ok here>
  async execute(...args: any[]): Promise<ToolResult> {
    try {
      // 解析参数（通常第一个参数是参数对象）
      const params = args[0] || {};

      // 使用 Zod 验证参数
      const validatedParams = this._parametersSchema.parse(params);

      // 执行用户提供的函数
      const result = await this._executeFn(validatedParams);

      if (typeof result === 'string') {
        return {
          success: true,
          content: result,
          error: null,
        };
      }

      // 如果已经是 ToolResult，直接返回
      return result;
    } catch (error) {
      console.log('====error====', error);
      // Zod 验证错误
      if (error instanceof z.ZodError) {
        return {
          success: false,
          content: '',
          error: `参数验证失败: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        };
      }

      // 其他错误
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * 创建基于 Zod 的工具
 *
 * @example
 * ```typescript
 * import { tool } from './zod_tool';
 * import { z } from 'zod';
 *
 * const getWeatherTool = tool({
 *   name: 'get_weather',
 *   description: 'Get the weather for a given city',
 *   parameters: z.object({ city: z.string() }),
 *   async execute({ city }) {
 *     return `The weather in ${city} is sunny.`;
 *   },
 * });
 * ```
 */
export function tool<T extends z.ZodType>(config: ToolConfig<T>): ZodTool<T> {
  return new ZodTool(config);
}
