/**
 * CLI 配置管理
 *
 * 使用 Zod 定义配置 schema，从 ~/.mini-agent-cli/settings.json 加载配置。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// ============================================================
// Schema 定义
// ============================================================

/** 重试配置 schema */
const RetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxRetries: z.number().default(3),
  initialDelay: z.number().default(1.0),
  maxDelay: z.number().default(60.0),
  exponentialBase: z.number().default(2.0),
});

/** LLM 配置 schema */
const LLMConfigSchema = z.object({
  apiKey: z.string(),
  apiBase: z.string(),
  model: z.string(),
  provider: z.enum(['anthropic', 'openai']),
  retry: z.unknown().default({}).pipe(RetryConfigSchema),
});

/** Agent 配置 schema */
const AgentConfigSchema = z.object({
  maxSteps: z.number().default(50),
  workspaceDir: z.string().default('./workspace'),
  systemPromptPath: z.string().default('system_prompt.md'),
});

/** MCP 超时配置 schema */
const MCPConfigSchema = z.object({
  connectTimeout: z.number().default(10),
  executeTimeout: z.number().default(60),
  sseReadTimeout: z.number().default(120),
});

/** 工具配置 schema */
const ToolsConfigSchema = z.object({
  enableFileTools: z.boolean().default(true),
  enableBash: z.boolean().default(true),
  enableNote: z.boolean().default(true),
  enableSkills: z.boolean().default(true),
  skillsDir: z.string().default('./skills'),
  enableMcp: z.boolean().default(true),
  mcpConfigPath: z.string().default('mcp.json'),
  mcp: z.unknown().default({}).pipe(MCPConfigSchema),
});

/** 顶层配置 schema */
export const SettingsSchema = z.object({
  llm: LLMConfigSchema,
  agent: z.unknown().default({}).pipe(AgentConfigSchema),
  tools: z.unknown().default({}).pipe(ToolsConfigSchema),
});

// ============================================================
// 类型导出
// ============================================================

export type Settings = z.infer<typeof SettingsSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// ============================================================
// 加载函数
// ============================================================

/** 配置文件目录：~/.mini-agent-cli */
const CONFIG_DIR = join(homedir(), '.mini-agent-cli');

/** 用户配置文件路径：~/.mini-agent-cli/settings.json */
const USER_SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');

/** 本地配置文件名（开发模式） */
const LOCAL_SETTINGS_FILE = 'settings.json';

/** 默认配置模板 */
const DEFAULT_SETTINGS = {
  llm: {
    apiKey: 'YOUR_API_KEY_HERE',
    apiBase: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
  },
};

/**
 * 获取用户配置文件路径
 */
export function getSettingsPath(): string {
  return USER_SETTINGS_FILE;
}

/**
 * 按优先级搜索配置文件
 *
 * 搜索顺序：
 * 1. ~/.mini-agent-cli/settings.json（用户自定义）
 * 2. {packageDir}/config/settings.json（包内置，开发模式）
 *
 * @returns 找到的配置文件路径，未找到返回 null
 */
export function findSettingsFile(): string | null {
  return findConfigFile(LOCAL_SETTINGS_FILE);
}

/**
 * 按优先级搜索配置文件（通用版）
 *
 * 搜索顺序：
 * 1. ~/.mini-agent-cli/{filename}（用户自定义）
 * 2. {packageDir}/config/{filename}（包内置默认）
 *
 * @param filename - 要搜索的文件名（如 system_prompt.md）
 * @returns 找到的文件路径，未找到返回 null
 */
export function findConfigFile(filename: string): string | null {
  // 1. 用户主目录
  const userPath = join(CONFIG_DIR, filename);
  if (existsSync(userPath)) return userPath;

  // 2. 包内置 config 目录
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const builtinPath = join(packageDir, 'config', filename);
  if (existsSync(builtinPath)) return builtinPath;

  return null;
}

/**
 * 创建默认配置文件
 *
 * 在 ~/.mini-agent-cli/settings.json 创建模板配置。
 *
 * @returns 创建的配置文件路径
 */
export function createDefaultSettings(): string {
  ensureConfigDir();
  const content = JSON.stringify(DEFAULT_SETTINGS, null, 2);
  writeFileSync(USER_SETTINGS_FILE, content, 'utf-8');
  return USER_SETTINGS_FILE;
}

/**
 * 确保配置目录存在
 */
export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 从指定路径加载并验证配置
 *
 * @param filePath - JSON 配置文件路径
 * @returns 验证后的 Settings 对象
 * @throws 文件不存在、JSON 格式错误、schema 验证失败时抛出错误
 */
export function loadSettingsFromFile(filePath: string): Settings {
  if (!existsSync(filePath)) {
    throw new Error(`Settings file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in settings file: ${filePath}`);
  }

  const result = SettingsSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid settings file:\n${issues}`);
  }

  return result.data;
}

/**
 * 从默认路径加载配置
 *
 * @returns 验证后的 Settings 对象
 */
export function loadSettings(): Settings {
  return loadSettingsFromFile(USER_SETTINGS_FILE);
}
