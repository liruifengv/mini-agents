/**
 * Google Gemini API 客户端实现
 *
 * 使用 @google/genai SDK 的 ai.models.generateContent() 接口，支持：
 * - 标准消息格式转换（user/model/system）
 * - Function calling（functionDeclarations + parametersJsonSchema）
 * - Thinking（thought parts 提取）
 * - Token usage 统计
 * - 自定义 base URL（通过 httpOptions.baseUrl）
 */

import type {
  Content,
  FunctionCall as GeminiFunctionCall,
  GenerateContentResponse,
  Part,
  ThinkingConfig,
} from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import type { Tool } from '../tools';
import type { LLMResponse, Message, TokenUsage, ToolCall } from '../types';
import type { RetryConfig } from '../types/retry';
import { asyncRetry } from '../utils/retry';
import { LLMClientBase } from './base';

/**
 * 消息转换结果
 */
interface ConvertMessagesResult {
  /** 系统指令（从 system 消息提取） */
  systemInstruction: string | null;
  /** Gemini Content 列表 */
  contents: Content[];
}

/**
 * Gemini 客户端配置选项
 */
export interface GeminiClientOptions {
  /** Thinking 配置（可选） */
  thinkingConfig?: ThinkingConfig;
}

export class GeminiClient extends LLMClientBase {
  private ai: GoogleGenAI;
  private thinkingConfig: ThinkingConfig | undefined;

  constructor(
    apiKey: string,
    apiBaseURL: string,
    model: string,
    options?: GeminiClientOptions,
    retryConfig?: RetryConfig
  ) {
    super(apiKey, apiBaseURL, model, retryConfig);

    this.thinkingConfig = options?.thinkingConfig;

    // 仅在 apiBaseURL 非空时设置 httpOptions.baseUrl
    // 用户传空字符串则使用 SDK 默认端点
    if (apiBaseURL) {
      this.ai = new GoogleGenAI({
        apiKey,
        httpOptions: { baseUrl: apiBaseURL },
      });
    } else {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  /**
   * 将内部消息格式转换为 Gemini API 格式
   *
   * 转换映射：
   * - system 消息 → 提取为 systemInstruction
   * - user 消息 → { role: 'user', parts: [{ text }] }
   * - assistant 消息 → { role: 'model', parts: [...] }（含 text、functionCall、thought）
   * - tool 消息 → { role: 'user', parts: [{ functionResponse }] }
   */
  _convertMessages(messages: Message[]): ConvertMessagesResult {
    let systemInstruction: string | null = null;
    const contents: Content[] = [];

    for (const msg of messages) {
      // system 消息：提取为 systemInstruction
      if (msg.role === 'system') {
        systemInstruction = msg.content as string;
        continue;
      }

      // user 消息
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content as string }],
        });
        continue;
      }

      // assistant 消息 → Gemini 'model' 角色
      if (msg.role === 'assistant') {
        const parts: Part[] = [];

        // 如果有 thinking 内容，添加 thought part
        if (msg.thinking) {
          parts.push({
            text: msg.thinking,
            thought: true,
          });
        }

        // 如果有文本内容，添加 text part
        if (msg.content) {
          parts.push({ text: msg.content as string });
        }

        // 如果有 toolCalls，添加 functionCall parts
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: tc.function.arguments as Record<string, unknown>,
                id: tc.callId,
              },
            });
          }
        }

        // 确保至少有一个 part（避免空 parts 数组）
        if (parts.length === 0) {
          parts.push({ text: '' });
        }

        contents.push({
          role: 'model',
          parts,
        });
        continue;
      }

      // tool 结果消息 → Gemini 使用 user 角色 + functionResponse
      if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name || '',
                id: msg.callId || undefined,
                response: { output: msg.content as string },
              },
            },
          ],
        });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * 将 Tool 对象转换为 Gemini 的工具声明格式
   */
  _convertTools(
    tools: Tool[]
  ): Array<{ functionDeclarations: ReturnType<Tool['toGeminiSchema']>[] }> {
    return [
      {
        functionDeclarations: tools.map((t) => t.toGeminiSchema()),
      },
    ];
  }

  /**
   * 执行 API 请求
   */
  async _makeApiRequest(params: {
    contents: Content[];
    systemInstruction: string | null;
    tools?: Array<{ functionDeclarations: ReturnType<Tool['toGeminiSchema']>[] }>;
  }): Promise<GenerateContentResponse> {
    // 构建 config 对象
    // biome-ignore lint/suspicious/noExplicitAny: Gemini SDK config 类型灵活，需要动态构建
    const config: Record<string, any> = {};

    // 设置系统指令
    if (params.systemInstruction) {
      config.systemInstruction = params.systemInstruction;
    }

    // 设置工具
    if (params.tools && params.tools.length > 0) {
      config.tools = params.tools;
    }

    // 设置 thinking 配置
    if (this.thinkingConfig) {
      config.thinkingConfig = this.thinkingConfig;
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: params.contents,
      config,
    });

    return response;
  }

  /**
   * 解析 Gemini 响应为内部 LLMResponse 格式
   *
   * 从 response.candidates[0].content.parts 中提取：
   * - text（thought !== true）→ 文本内容
   * - text（thought === true）→ thinking 内容
   * - functionCall → toolCalls
   * - usageMetadata → usage
   */
  _parseResponse(response: GenerateContentResponse): LLMResponse {
    let textContent = '';
    let thinkingContent = '';
    const toolCalls: ToolCall[] = [];

    // 从 candidates 中提取内容
    const parts = response.candidates?.[0]?.content?.parts || [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // 提取 thinking 内容（thought === true 的 text part）
      if (part.thought === true && part.text) {
        thinkingContent += part.text;
        continue;
      }

      // 提取普通文本内容
      if (part.text !== undefined && part.text !== null && !part.thought) {
        textContent += part.text;
        continue;
      }

      // 提取 function calls
      // 注意：Gemini 的 args 已经是解析后的对象，不需要 JSON.parse
      if (part.functionCall) {
        const fc = part.functionCall as GeminiFunctionCall;
        const callId = fc.id || `gemini_call_${Date.now()}_${i}`;
        toolCalls.push({
          callId,
          type: 'function',
          function: {
            name: fc.name || '',
            arguments: (fc.args as Record<string, unknown>) || {},
          },
        });
      }
    }

    // 提取 finish reason（透传）
    const finishReason = response.candidates?.[0]?.finishReason || 'STOP';

    // 提取 token usage
    let usage: TokenUsage | null = null;
    if (response.usageMetadata) {
      usage = {
        promptTokens: response.usageMetadata.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata.totalTokenCount ?? 0,
      };
    }

    return {
      content: textContent,
      thinking: thinkingContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason,
      usage,
      responseId: response.responseId || null,
    };
  }

  /**
   * 生成 LLM 响应
   */
  async generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    // 转换消息格式
    const { systemInstruction, contents } = this._convertMessages(messages);

    // 转换工具格式
    const geminiTools = tools ? this._convertTools(tools) : undefined;

    // 调用 API（带重试）
    const response = await asyncRetry(
      () => this._makeApiRequest({ contents, systemInstruction, tools: geminiTools }),
      this.retryConfig,
      this.retryCallback ?? undefined
    );

    // 解析并返回响应
    return this._parseResponse(response);
  }
}
