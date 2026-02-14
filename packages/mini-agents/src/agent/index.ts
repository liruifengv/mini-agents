import type { Tool } from '../tools';
import type { ILLMClient, Message } from '../types';
import { checkCancelled, cleanupIncompleteMessages, generateWithSignal } from './cancellation';
import { estimateTokens, summarizeMessages } from './summarizer';
import { executeTool } from './tool-executor';
import type { AgentMessageEvent, RunOptions } from './types';

// 重新导出类型（保持导入路径兼容）
export type { AgentMessageEvent, RunOptions } from './types';

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
   * 代理方法：估算 token（测试兼容）
   */
  _estimateTokens(): number {
    return estimateTokens(this.messages);
  }

  /**
   * 代理方法：摘要消息（测试兼容）
   * summarizeMessages 始终返回对象，无需判空
   */
  async _summarizeMessages(): Promise<AgentMessageEvent | null> {
    const result = await summarizeMessages({
      messages: this.messages,
      tokenLimit: this.tokenLimit,
      apiTotalTokens: this._apiTotalTokens,
      skipNextTokenCheck: this._skipNextTokenCheck,
      llmClient: this.llmClient,
    });
    this.messages = result.messages;
    this._skipNextTokenCheck = result.skipNextTokenCheck;
    return result.event;
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
        if (checkCancelled(signal)) {
          this.messages = cleanupIncompleteMessages(this.messages);
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }

        // 检查是否需要摘要压缩消息
        const summarizeEvent = await this._summarizeMessages();
        if (summarizeEvent) {
          yield summarizeEvent;
        }

        const response = await generateWithSignal(
          this.llmClient,
          this.messages,
          this.tools,
          signal
        );

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
        if (checkCancelled(signal)) {
          this.messages = cleanupIncompleteMessages(this.messages);
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

          const result = await executeTool(
            this.tools,
            toolCall.function.name,
            toolCall.function.arguments
          );

          // 发送 toolResult 事件
          yield {
            type: 'toolResult',
            toolCall,
            result,
          };

          const toolMsg: Message = {
            role: 'tool',
            content: result.success ? result.content : `Error: ${result.error}`,
            callId: toolCall.callId,
            name: toolCall.function.name,
          };
          this.messages.push(toolMsg);

          // 检查点 3：每个工具执行完后
          if (checkCancelled(signal)) {
            this.messages = cleanupIncompleteMessages(this.messages);
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
