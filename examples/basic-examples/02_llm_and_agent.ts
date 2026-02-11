/**
 * LLM Client & Agent 测试示例
 *
 * 演示 Anthropic / OpenAI 客户端和 Agent 的基本用法：
 * - Anthropic Client: 基本对话 + 工具调用
 * - OpenAI Client (Responses API): 基本对话 + 多轮工具调用
 * - Agent (Anthropic): 自动工具调用循环
 * - Agent (OpenAI): 自动工具调用循环
 *
 * Anthropic 环境变量：
 * - ANTHROPIC_API_KEY
 * - ANTHROPIC_API_BASE_URL
 * - ANTHROPIC_MODEL (默认 kimi-for-coding)
 *
 * OpenAI 环境变量：
 * - OPENAI_API_KEY
 * - OPENAI_API_BASE_URL
 * - OPENAI_MODEL (默认 gpt-5-mini)
 */

import { Agent, AnthropicClient, OpenAIClient } from 'mini-agents';
import { getWeatherTool } from 'mini-agents/tools';
import type { Message } from 'mini-agents/types';

// ============================================================
// Anthropic Client
// ============================================================

const testAnthropicClient = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test: Anthropic Client');
  console.log('='.repeat(60));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;
  const model = process.env.ANTHROPIC_MODEL || 'kimi-for-coding';

  if (!apiKey || !apiBaseUrl) {
    console.log('Skipped: ANTHROPIC_API_KEY or ANTHROPIC_API_BASE_URL not set');
    return;
  }

  const client = new AnthropicClient(apiKey, apiBaseUrl, model);
  const messages: Message[] = [{ role: 'user', content: '北京的天气怎么样' }];
  const response = await client.generate(messages, [getWeatherTool]);
  console.log('Response:', response);
};

// ============================================================
// OpenAI Client - 基本对话（使用 Responses API）
// ============================================================

const testOpenAIBasicChat = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test: OpenAI Client - Basic Chat (Responses API)');
  console.log('='.repeat(60));

  const apiKey = process.env.OPENAI_API_KEY;
  const apiBaseUrl = process.env.OPENAI_API_BASE_URL;
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

  if (!apiKey || !apiBaseUrl) {
    console.log('Skipped: OPENAI_API_KEY or OPENAI_API_BASE_URL not set');
    return;
  }

  const client = new OpenAIClient(apiKey, apiBaseUrl, model, {
    maxOutputTokens: 4096,
  });
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant. Reply concisely.' },
    { role: 'user', content: 'What is TypeScript in one sentence?' },
  ];

  const response = await client.generate(messages);
  console.log('Response content:', response.content);
  console.log('Response ID:', response.responseId ?? '(not available)');
  console.log('Finish reason:', response.finishReason);
  console.log('Thinking:', response.thinking ?? '(none)');
  console.log('Usage:', response.usage ?? '(not available)');
};

// ============================================================
// Agent (使用 Anthropic Client)
// ============================================================

const testAgentWithAnthropic = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test: Agent with Anthropic Client');
  console.log('='.repeat(60));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;
  const model = process.env.ANTHROPIC_MODEL || 'kimi-for-coding';

  if (!apiKey || !apiBaseUrl) {
    console.log('Skipped: ANTHROPIC_API_KEY or ANTHROPIC_API_BASE_URL not set');
    return;
  }

  const client = new AnthropicClient(apiKey, apiBaseUrl, model);
  const systemPrompt = 'You are a helpful assistant.';
  const agent = new Agent(client, systemPrompt, [getWeatherTool]);
  agent.addUserMessage('北京的天气怎么样');

  try {
    const result = await agent.run();
    console.log('Agent result:', result);
  } catch (error) {
    console.error('Agent error:', error);
  }
};

// ============================================================
// Agent (使用 OpenAI Client)
// ============================================================

const testAgentWithOpenAI = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test: Agent with OpenAI Client');
  console.log('='.repeat(60));

  const apiKey = process.env.OPENAI_API_KEY;
  const apiBaseUrl = process.env.OPENAI_API_BASE_URL;
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

  if (!apiKey || !apiBaseUrl) {
    console.log('Skipped: OPENAI_API_KEY or OPENAI_API_BASE_URL not set');
    return;
  }

  const client = new OpenAIClient(apiKey, apiBaseUrl, model, {
    maxOutputTokens: 4096,
    reasoning: { effort: 'medium', summary: 'auto' },
  });
  const systemPrompt = 'You are a helpful assistant.';
  const agent = new Agent(client, systemPrompt, [getWeatherTool]);
  agent.addUserMessage('北京的天气怎么样');

  try {
    const result = await agent.run();
    console.log('Agent result:', result);
  } catch (error) {
    console.error('Agent error:', error);
  }
};

async function main() {
  await testAnthropicClient();
  await testOpenAIBasicChat();
  await testAgentWithAnthropic();
  await testAgentWithOpenAI();

  console.log(`\n${'='.repeat(60)}`);
  console.log('All tests completed!');
}

main().catch(console.error);
