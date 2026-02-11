/**
 * LLM Client 统一接口示例
 *
 * 演示通过 LLMClient 使用不同 provider 的统一接口：
 * - 使用 Anthropic provider 对话
 * - 使用 OpenAI provider 对话
 * - 在 Agent 中使用 LLMClient（Anthropic）
 * - 在 Agent 中使用 LLMClient（OpenAI）
 * - 错误重试演示（RetryExhaustedError）
 *
 * Anthropic 环境变量：
 * - ANTHROPIC_API_KEY
 * - ANTHROPIC_API_BASE_URL
 * - ANTHROPIC_MODEL (默认 claude-sonnet-4-20250514)
 *
 * OpenAI 环境变量：
 * - OPENAI_API_KEY
 * - OPENAI_API_BASE_URL
 * - OPENAI_MODEL (默认 gpt-4o-mini)
 */

import { Agent, LLMClient } from 'mini-agent';
import { getWeatherTool } from 'mini-agent/tools';
import type { LLMProvider, Message } from 'mini-agent/types';
import { RetryExhaustedError } from 'mini-agent/utils';

// ============================================================
// 辅助函数：根据 provider 读取环境变量
// ============================================================

function getConfig(provider: LLMProvider) {
  if (provider === 'anthropic') {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      apiBase: process.env.ANTHROPIC_API_BASE_URL,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    };
  }
  return {
    apiKey: process.env.OPENAI_API_KEY,
    apiBase: process.env.OPENAI_API_BASE_URL,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

// ============================================================
// Demo 1: 使用 Anthropic Provider
// ============================================================

const demoAnthropicProvider = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO: LLMClient with Anthropic Provider');
  console.log('='.repeat(60));

  const { apiKey, apiBase, model } = getConfig('anthropic');
  if (!apiKey || !apiBase) {
    console.log('Skipped: ANTHROPIC_API_KEY or ANTHROPIC_API_BASE_URL not set');
    return;
  }

  const client = new LLMClient({
    apiKey,
    provider: 'anthropic',
    apiBase,
    model,
  });

  console.log(`Provider: ${client.provider}`);
  console.log(`API Base: ${client.apiBase}`);
  console.log(`Model: ${client.model}`);

  const messages: Message[] = [
    { role: 'user', content: "Say 'Hello from Anthropic!' in one sentence." },
  ];
  console.log(`\nUser: ${messages[0].content}`);

  const response = await client.generate(messages);
  if (response.thinking) {
    console.log(`Thinking: ${response.thinking}`);
  }
  console.log(`Model: ${response.content}`);
  console.log('Anthropic provider demo completed');
};

// ============================================================
// Demo 2: 使用 OpenAI Provider
// ============================================================

const demoOpenAIProvider = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO: LLMClient with OpenAI Provider');
  console.log('='.repeat(60));

  const { apiKey, apiBase, model } = getConfig('openai');
  if (!apiKey || !apiBase) {
    console.log('Skipped: OPENAI_API_KEY or OPENAI_API_BASE_URL not set');
    return;
  }

  const client = new LLMClient({
    apiKey,
    provider: 'openai',
    apiBase,
    model,
  });

  console.log(`Provider: ${client.provider}`);
  console.log(`API Base: ${client.apiBase}`);
  console.log(`Model: ${client.model}`);

  const messages: Message[] = [
    { role: 'user', content: "Say 'Hello from OpenAI!' in one sentence." },
  ];
  console.log(`\nUser: ${messages[0].content}`);

  const response = await client.generate(messages);
  if (response.thinking) {
    console.log(`Thinking: ${response.thinking}`);
  }
  console.log(`Model: ${response.content}`);
  console.log('OpenAI provider demo completed');
};

// ============================================================
// Demo 3: 在 Agent 中使用 LLMClient（Anthropic）
// ============================================================

const demoAgentWithAnthropic = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO: Agent with LLMClient (Anthropic)');
  console.log('='.repeat(60));

  const { apiKey, apiBase, model } = getConfig('anthropic');
  if (!apiKey || !apiBase) {
    console.log('Skipped: ANTHROPIC_API_KEY or ANTHROPIC_API_BASE_URL not set');
    return;
  }

  const client = new LLMClient({
    apiKey,
    provider: 'anthropic',
    apiBase,
    model,
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

// ============================================================
// Demo 4: 在 Agent 中使用 LLMClient（OpenAI）
// ============================================================

const demoAgentWithOpenAI = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO: Agent with LLMClient (OpenAI)');
  console.log('='.repeat(60));

  const { apiKey, apiBase, model } = getConfig('openai');
  if (!apiKey || !apiBase) {
    console.log('Skipped: OPENAI_API_KEY or OPENAI_API_BASE_URL not set');
    return;
  }

  const client = new LLMClient({
    apiKey,
    provider: 'openai',
    apiBase,
    model,
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

// ============================================================
// Demo 5: 错误重试演示
// ============================================================

const demoRetryError = async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO: Retry with Invalid API Key');
  console.log('='.repeat(60));

  // 使用无效 API Key 触发重试
  const client = new LLMClient({
    apiKey: 'sk-invalid-key',
    provider: 'openai',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    retryConfig: {
      enabled: true,
      maxRetries: 2,
      initialDelay: 0.5,
      maxDelay: 2,
      exponentialBase: 2,
    },
  });

  // 设置重试回调，观察重试过程
  client.retryCallback = (error, attempt) => {
    console.log(`  [Retry ${attempt}] ${error.message}`);
  };

  const messages: Message[] = [{ role: 'user', content: 'Hello' }];

  try {
    await client.generate(messages);
  } catch (error) {
    if (error instanceof RetryExhaustedError) {
      console.log(`\nRetryExhaustedError caught:`);
      console.log(`  Attempts: ${error.attempts}`);
      console.log(`  Last error: ${error.lastError.message}`);
    } else {
      console.log(`\nUnexpected error:`, error);
    }
  }

  console.log('Retry error demo completed');
};

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('\nLLM Client Demo');
  console.log('Demonstrates using LLMClient with different providers and Agent.');

  try {
    await demoAnthropicProvider();
    await demoOpenAIProvider();
    await demoAgentWithAnthropic();
    await demoAgentWithOpenAI();
    await demoRetryError();

    console.log(`\n${'='.repeat(60)}`);
    console.log('All demos completed!');
  } catch (error) {
    console.error('\nError:', error);
  }
}

main().catch(console.error);
