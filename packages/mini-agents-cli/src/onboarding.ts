/**
 * 首次使用引导流程
 *
 * 交互式询问用户配置 LLM provider、API Key、API URL、Model，
 * 保存到 ~/.mini-agents-cli/settings.json。
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { createDefaultSettings } from './config';

// ANSI 颜色
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Provider 预设 */
const PROVIDER_PRESETS: Record<string, { apiBaseURL: string; model: string }> = {
  anthropic: {
    apiBaseURL: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
  },
  openai: {
    apiBaseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
  },
  'openai-chat': {
    apiBaseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
  },
  gemini: {
    apiBaseURL: '',
    model: 'gemini-2.5-flash',
  },
};

/**
 * 运行 onboarding 流程
 *
 * @returns 配置文件路径
 */
export async function runOnboarding(): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log();
  console.log(`${BOLD}${CYAN}🤖 Welcome to Mini Agent CLI!${RESET}`);
  console.log(`${DIM}Let's set up your configuration.${RESET}`);
  console.log();

  try {
    // 1. 选择 Provider
    console.log(`${BOLD}${YELLOW}[1/4] LLM Provider${RESET}`);
    console.log(`  ${GREEN}1${RESET}) Anthropic (Claude)`);
    console.log(`  ${GREEN}2${RESET}) OpenAI (Responses API)`);
    console.log(`  ${GREEN}3${RESET}) OpenAI Chat (Chat Completions API)`);
    console.log(`  ${GREEN}4${RESET}) Gemini`);
    const providerChoice = await rl.question(`${DIM}Choose [1/2/3/4] (default: 1): ${RESET}`);
    const providerMap: Record<string, string> = {
      '1': 'anthropic',
      '2': 'openai',
      '3': 'openai-chat',
      '4': 'gemini',
    };
    const provider = providerMap[providerChoice.trim()] || 'anthropic';
    const preset = PROVIDER_PRESETS[provider];
    console.log(`  → ${CYAN}${provider}${RESET}`);
    console.log();

    // 2. API Key
    console.log(`${BOLD}${YELLOW}[2/4] API Key${RESET}`);
    const apiKey = await rl.question(`${DIM}Enter your API key: ${RESET}`);
    if (!apiKey.trim()) {
      console.log(`${YELLOW}⚠ No API key provided. You can edit the config later.${RESET}`);
    }
    console.log();

    // 3. API Base URL
    console.log(`${BOLD}${YELLOW}[3/4] API Base URL${RESET}`);
    const defaultURLHint = preset.apiBaseURL || 'Google default endpoint';
    const apiBaseURLInput = await rl.question(`${DIM}URL (default: ${defaultURLHint}): ${RESET}`);
    const apiBaseURL = apiBaseURLInput.trim() || preset.apiBaseURL;
    console.log(`  → ${CYAN}${apiBaseURL || '(Google default endpoint)'}${RESET}`);
    console.log();

    // 4. Model
    console.log(`${BOLD}${YELLOW}[4/4] Model${RESET}`);
    const modelInput = await rl.question(`${DIM}Model name (default: ${preset.model}): ${RESET}`);
    const model = modelInput.trim() || preset.model;
    console.log(`  → ${CYAN}${model}${RESET}`);
    console.log();

    // 保存配置
    const settingsPath = createDefaultSettings();

    // 用用户输入覆写
    const { writeFileSync } = await import('node:fs');
    const settings = {
      llm: {
        apiKey: apiKey.trim() || 'YOUR_API_KEY_HERE',
        apiBaseURL,
        model,
        provider,
      },
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    console.log(`${GREEN}✅ Config saved to: ${settingsPath}${RESET}`);
    console.log();

    return settingsPath;
  } finally {
    rl.close();
  }
}
