import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSettingsPath, loadSettingsFromFile, SettingsSchema } from '../src/config';

describe('Config', () => {
  let tempDir: string;

  beforeAll(() => {
    // 创建临时目录
    tempDir = join(tmpdir(), `mini-agent-cli-config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    // 清理临时目录
    rmSync(tempDir, { recursive: true, force: true });
  });

  // 辅助函数：在临时目录写入 JSON 文件
  function writeSettingFile(name: string, data: unknown): string {
    const filePath = join(tempDir, name);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  describe('SettingSchema', () => {
    it('should validate a complete setting', () => {
      const data = {
        llm: {
          apiKey: 'sk-test',
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'anthropic',
        },
      };

      const result = SettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.llm.apiKey).toBe('sk-test');
        expect(result.data.llm.provider).toBe('anthropic');
      }
    });

    it('should fill default values for optional fields', () => {
      const data = {
        llm: {
          apiKey: 'sk-test',
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'openai',
        },
      };

      const result = SettingsSchema.parse(data);

      // agent 默认值
      expect(result.agent.maxSteps).toBe(50);
      expect(result.agent.workspaceDir).toBe('./workspace');
      expect(result.agent.systemPromptPath).toBe('system_prompt.md');

      // tools 默认值
      expect(result.tools.enableFileTools).toBe(true);
      expect(result.tools.enableBash).toBe(true);
      expect(result.tools.enableMcp).toBe(true);
      expect(result.tools.mcp.connectTimeout).toBe(10);
      expect(result.tools.mcp.executeTimeout).toBe(60);

      // retry 默认值
      expect(result.llm.retry.enabled).toBe(true);
      expect(result.llm.retry.maxRetries).toBe(3);
    });

    it('should allow overriding default values', () => {
      const data = {
        llm: {
          apiKey: 'sk-test',
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'anthropic',
          retry: { maxRetries: 5 },
        },
        agent: { maxSteps: 100 },
        tools: { enableBash: false },
      };

      const result = SettingsSchema.parse(data);
      expect(result.llm.retry.maxRetries).toBe(5);
      // 其他 retry 字段保持默认
      expect(result.llm.retry.enabled).toBe(true);
      expect(result.agent.maxSteps).toBe(100);
      expect(result.tools.enableBash).toBe(false);
    });

    it('should reject missing llm field', () => {
      const result = SettingsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject missing llm.apiKey', () => {
      const result = SettingsSchema.safeParse({
        llm: {
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'anthropic',
        },
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = SettingsSchema.safeParse({
        llm: {
          apiKey: 'sk-test',
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'invalid',
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('loadSettingsFromFile', () => {
    it('should load and validate a valid setting file', () => {
      const filePath = writeSettingFile('valid.json', {
        llm: {
          apiKey: 'sk-test',
          apiBase: 'https://api.example.com',
          model: 'test-model',
          provider: 'anthropic',
        },
      });

      const setting = loadSettingsFromFile(filePath);
      expect(setting.llm.apiKey).toBe('sk-test');
      expect(setting.agent.maxSteps).toBe(50);
    });

    it('should throw for non-existent file', () => {
      expect(() => {
        loadSettingsFromFile(join(tempDir, 'not-exist.json'));
      }).toThrow('Settings file not found');
    });

    it('should throw for invalid JSON', () => {
      const filePath = join(tempDir, 'bad.json');
      writeFileSync(filePath, '{ invalid json }', 'utf-8');

      expect(() => {
        loadSettingsFromFile(filePath);
      }).toThrow('Invalid JSON');
    });

    it('should throw for schema validation failure with details', () => {
      const filePath = writeSettingFile('invalid-schema.json', {
        llm: { model: 'test' },
      });

      expect(() => {
        loadSettingsFromFile(filePath);
      }).toThrow('Invalid settings file');
    });
  });

  describe('getSettingsPath', () => {
    it('should return path under ~/.mini-agent-cli', () => {
      const settingPath = getSettingsPath();
      expect(settingPath).toContain('.mini-agent-cli');
      expect(settingPath).toContain('settings.json');
    });
  });
});
