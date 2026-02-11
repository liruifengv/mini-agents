import type { Tool, ToolResult } from '../tools';
import type { ILLMClient, LLMResponse, Message, ToolCall } from '../types';
import { countTokens } from '../utils/token';

/**
 * Agent 运行选项
 */
export interface RunOptions {
  /** 取消信号，用于中止 Agent 执行 */
  signal?: AbortSignal;
}

/**
 * Agent 执行步骤事件类型
 */
export type AgentMessageEvent =
  | { type: 'thinking'; thinking: string | null | undefined; content: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'toolResult'; toolCall: ToolCall; result: ToolResult }
  | { type: 'assistantMessage'; content: string }
  | { type: 'cancelled' }
  | { type: 'summarized'; beforeTokens: number; afterTokens: number };

export class Agent {
  private llmClient: ILLMClient;
  private tools: Tool[];
  private maxSteps = 50;
  private tokenLimit: number;
  private _apiTotalTokens = 0;
  private _skipNextTokenCheck = false;
  messages: Message[];

  constructor(
    llmClient: ILLMClient,
    systemPrompt: string,
    tools: Tool[],
    options?: { tokenLimit?: number }
  ) {
    this.llmClient = llmClient;
    this.tools = tools;
    this.tokenLimit = options?.tokenLimit ?? 80000;
    this.messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];
  }

  addUserMessage(message: string) {
    this.messages.push({
      role: 'user',
      content: message,
    });
  }

  /**
   * 检查是否已被取消
   */
  private _checkCancelled(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
  }

  /**
   * 清理不完整的 assistant 消息及其后续的 tool 消息
   * 保留已完成步骤的消息，只移除最后一步未完成的部分
   */
  private _cleanupIncompleteMessages(): void {
    // 找到最后一条 assistant 消息的位置
    let lastAssistantIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx === -1) {
      return;
    }

    // 移除最后一条 assistant 消息及其后面所有 tool 消息
    this.messages = this.messages.slice(0, lastAssistantIdx);
  }

  /**
   * 估算当前消息列表的总 token 数
   */
  _estimateTokens(): number {
    let total = 0;
    for (const msg of this.messages) {
      // 文本内容
      if (typeof msg.content === 'string') {
        total += countTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        total += countTokens(JSON.stringify(msg.content));
      }
      // thinking 内容
      if (msg.thinking) {
        total += countTokens(msg.thinking);
      }
      // 工具调用
      if (msg.toolCalls) {
        total += countTokens(JSON.stringify(msg.toolCalls));
      }
      // 每条消息的元数据开销
      total += 4;
    }
    return total;
  }

  /**
   * 检查是否需要摘要，如果需要则执行消息压缩
   * 返回摘要事件（如果发生了摘要），否则返回 null
   */
  async _summarizeMessages(): Promise<AgentMessageEvent | null> {
    // 防抖：上一轮刚摘要过，跳过本次检查
    if (this._skipNextTokenCheck) {
      this._skipNextTokenCheck = false;
      return null;
    }

    const estimatedTokens = this._estimateTokens();
    const shouldSummarize =
      estimatedTokens > this.tokenLimit || this._apiTotalTokens > this.tokenLimit;

    if (!shouldSummarize) {
      return null;
    }

    const beforeTokens = estimatedTokens;

    // 找到所有 user 消息的索引（跳过 system 消息）
    const userIndices: number[] = [];
    for (let i = 1; i < this.messages.length; i++) {
      if (this.messages[i].role === 'user') {
        userIndices.push(i);
      }
    }

    if (userIndices.length === 0) {
      return null;
    }

    // 重组消息：保留 system + 每个 user 消息 + 对应执行过程的摘要
    const newMessages: Message[] = [this.messages[0]]; // system 消息

    for (let u = 0; u < userIndices.length; u++) {
      const userIdx = userIndices[u];
      const nextUserIdx = u + 1 < userIndices.length ? userIndices[u + 1] : this.messages.length;

      // 保留 user 消息
      newMessages.push(this.messages[userIdx]);

      // 提取该轮的 assistant + tool 消息
      const executionMessages = this.messages.slice(userIdx + 1, nextUserIdx);
      if (executionMessages.length === 0) {
        continue;
      }

      // 生成摘要
      const summary = await this._createSummary(executionMessages, u + 1);
      newMessages.push({
        role: 'user',
        content: `[Assistant Execution Summary]\n\n${summary}`,
      });
    }

    this.messages = newMessages;
    this._skipNextTokenCheck = true;

    const afterTokens = this._estimateTokens();
    return { type: 'summarized', beforeTokens, afterTokens };
  }

  /**
   * 调用 LLM 生成单轮执行过程的摘要
   * 如果 LLM 调用失败，降级为简单文本拼接
   */
  private async _createSummary(executionMessages: Message[], roundNum: number): Promise<string> {
    // 构建执行过程描述
    let summaryContent = `Round ${roundNum} execution process:\n\n`;
    for (const msg of executionMessages) {
      if (msg.role === 'assistant') {
        if (typeof msg.content === 'string' && msg.content) {
          summaryContent += `Assistant: ${msg.content}\n`;
        }
        if (msg.toolCalls) {
          const toolNames = msg.toolCalls.map((tc) => tc.function.name).join(', ');
          summaryContent += `Tools called: ${toolNames}\n`;
        }
      } else if (msg.role === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // 截断过长的工具结果
        const truncated = content.length > 500 ? `${content.slice(0, 500)}...` : content;
        summaryContent += `Tool result (${msg.name || 'unknown'}): ${truncated}\n`;
      }
    }

    // 摘要提示词
    const summarizePrompt =
      `Please provide a concise summary of the following Agent execution process:\n\n` +
      `${summaryContent}\n\n` +
      `Requirements:\n` +
      `1. Focus on what tasks were completed and which tools were called\n` +
      `2. Keep key execution results and important findings\n` +
      `3. Be concise and clear, within 1000 words\n` +
      `4. Use English\n` +
      `5. Do not include "user" related content, only summarize the Agent's execution process`;

    try {
      const response = await this.llmClient.generate([
        {
          role: 'system',
          content: 'You are an assistant skilled at summarizing Agent execution processes.',
        },
        { role: 'user', content: summarizePrompt },
      ]);
      return response.content || summaryContent;
    } catch {
      // 降级：直接返回执行过程文本
      return summaryContent;
    }
  }

  /**
   * 将 generate 调用与 AbortSignal 关联
   * 当 signal 触发时立即 reject，不必等待 API 响应返回
   */
  private _generateWithSignal(signal?: AbortSignal): Promise<LLMResponse> {
    const generatePromise = this.llmClient.generate(this.messages, this.tools);

    if (!signal) return generatePromise;

    // 已经取消，直接拒绝
    if (signal.aborted) {
      // 避免悬挂的 Promise 导致 unhandled rejection
      generatePromise.catch(() => {});
      return Promise.reject(signal.reason);
    }

    return new Promise<LLMResponse>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      generatePromise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  /**
   * 运行 Agent，返回 AsyncGenerator 以流式输出每个步骤
   */
  async *run(options?: RunOptions): AsyncGenerator<AgentMessageEvent, string, void> {
    const signal = options?.signal;
    let step = 0;
    while (step < this.maxSteps) {
      try {
        // 检查点 1：每步开始前
        if (this._checkCancelled(signal)) {
          this._cleanupIncompleteMessages();
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }

        // 检查是否需要摘要压缩消息
        const summarizeEvent = await this._summarizeMessages();
        if (summarizeEvent) {
          yield summarizeEvent;
        }

        const response = await this._generateWithSignal(signal);

        // 更新 API 报告的 token 总数
        if (response.usage) {
          this._apiTotalTokens = response.usage.totalTokens;
        }
        const assistantMessage: Message = {
          role: 'assistant',
          content: response.content,
          thinking: response.thinking,
          reasoningItems: response.reasoningItems,
          toolCalls: response.toolCalls,
        };
        this.messages.push(assistantMessage);

        // 发送 thinking 事件
        if (response.thinking) {
          yield {
            type: 'thinking',
            thinking: response.thinking,
            content: response.content,
          };
        }

        // 发送 assistantMessage 事件（如果有内容且没有 toolCalls）
        if (response.content && !response.toolCalls) {
          yield {
            type: 'assistantMessage',
            content: response.content,
          };
        }

        // 如果没有工具调用，任务完成
        if (!response.toolCalls) {
          return response.content;
        }

        // 检查点 2：LLM 返回后、执行工具前
        if (this._checkCancelled(signal)) {
          this._cleanupIncompleteMessages();
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }

        // 处理工具调用
        for (const toolCall of response.toolCalls) {
          // 发送 toolCall 事件
          yield {
            type: 'toolCall',
            toolCall,
          };

          const callId = toolCall.callId;
          const functionName = toolCall.function.name;
          const functionArgs = toolCall.function.arguments;

          let result: ToolResult;
          const tool = this.tools.find((t) => t.name === functionName);
          if (!tool) {
            result = {
              success: false,
              content: '',
              error: `Unknown tool: ${functionName}`,
            };
          } else {
            try {
              result = await tool.execute(functionArgs);
            } catch (error: unknown) {
              // 捕获工具执行期间的所有异常，转换为失败的 ToolResult
              const err = error instanceof Error ? error : new Error(String(error));
              const errorDetail = `${err.name || 'Error'}: ${err.message}`;
              const errorTrace = err.stack || '';
              result = {
                success: false,
                content: '',
                error: `Tool execution failed: ${errorDetail}\n\nTraceback:\n${errorTrace}`,
              };
            }
          }

          // 发送 toolResult 事件
          yield {
            type: 'toolResult',
            toolCall,
            result,
          };

          const toolMsg: Message = {
            role: 'tool',
            content: result.success ? result.content : `Error: ${result.error}`,
            callId: callId,
            name: functionName,
          };
          this.messages.push(toolMsg);

          // 检查点 3：每个工具执行完后
          if (this._checkCancelled(signal)) {
            this._cleanupIncompleteMessages();
            yield { type: 'cancelled' };
            return 'Task cancelled by user.';
          }
        }

        step += 1;
      } catch (error) {
        // 在 LLM 调用期间被取消（AbortError）
        // 此时 assistant 消息尚未 push，无需清理不完整消息
        if (signal?.aborted) {
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }
        throw error;
      }
    }

    const errorMsg = `Task couldn't be completed after ${this.maxSteps} steps.`;
    return errorMsg;
  }
}
