import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SkillLoader, createGetSkillTool } from '../../src/tools';

describe('SkillLoader', () => {
  let tempDir: string;

  beforeAll(() => {
    // 创建临时目录结构
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-skills-'));

    // 创建 skill-a
    const skillADir = path.join(tempDir, 'skill-a');
    fs.mkdirSync(skillADir);
    fs.writeFileSync(
      path.join(skillADir, 'SKILL.md'),
      `---
name: skill-a
description: A test skill for demonstration
---

# Skill A Instructions

Use this skill to do task A.
`
    );

    // 创建 skill-b（带可选字段）
    const skillBDir = path.join(tempDir, 'skill-b');
    fs.mkdirSync(skillBDir);
    fs.writeFileSync(
      path.join(skillBDir, 'SKILL.md'),
      `---
name: skill-b
description: Another test skill with extra fields
license: MIT
allowed-tools: ["read_file", "write_file"]
---

# Skill B Instructions

Use this skill to do task B.

## References

See reference.md for more details.
`
    );

    // 创建 skill-b 的 reference.md 文件
    fs.writeFileSync(path.join(skillBDir, 'reference.md'), '# Reference Document');

    // 创建 skill-b 的 scripts 目录
    const scriptsDir = path.join(skillBDir, 'scripts');
    fs.mkdirSync(scriptsDir);
    fs.writeFileSync(path.join(scriptsDir, 'helper.py'), 'print("hello")');

    // 创建无效 skill（缺少 frontmatter）
    const invalidDir = path.join(tempDir, 'invalid-skill');
    fs.mkdirSync(invalidDir);
    fs.writeFileSync(path.join(invalidDir, 'SKILL.md'), '# No frontmatter here');

    // 创建无效 skill（缺少必填字段）
    const missingFieldsDir = path.join(tempDir, 'missing-fields');
    fs.mkdirSync(missingFieldsDir);
    fs.writeFileSync(
      path.join(missingFieldsDir, 'SKILL.md'),
      `---
name: missing-desc
---

# Missing description
`
    );

    // 创建嵌套目录中的 skill
    const nestedDir = path.join(tempDir, 'category', 'nested-skill');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, 'SKILL.md'),
      `---
name: nested-skill
description: A skill in nested directory
---

# Nested Skill
`
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadSkill', () => {
    it('should load a valid skill', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'skill-a', 'SKILL.md'));

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('skill-a');
      expect(skill!.description).toBe('A test skill for demonstration');
      expect(skill!.content).toContain('Skill A Instructions');
    });

    it('should load a skill with optional fields', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'skill-b', 'SKILL.md'));

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('skill-b');
      expect(skill!.license).toBe('MIT');
      expect(skill!.allowedTools).toEqual(['read_file', 'write_file']);
    });

    it('should return null for missing frontmatter', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'invalid-skill', 'SKILL.md'));

      expect(skill).toBeNull();
    });

    it('should return null for missing required fields', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'missing-fields', 'SKILL.md'));

      expect(skill).toBeNull();
    });

    it('should return null for non-existent file', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'no-exist', 'SKILL.md'));

      expect(skill).toBeNull();
    });
  });

  describe('discoverSkills', () => {
    it('should discover all valid skills recursively', () => {
      const loader = new SkillLoader(tempDir);
      const skills = loader.discoverSkills();

      // skill-a, skill-b, nested-skill（invalid 和 missing-fields 被过滤）
      expect(skills.length).toBe(3);

      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(['nested-skill', 'skill-a', 'skill-b']);
    });

    it('should return empty array for non-existent directory', () => {
      const loader = new SkillLoader(path.join(tempDir, 'no-exist'));
      const skills = loader.discoverSkills();

      expect(skills.length).toBe(0);
    });
  });

  describe('getSkill / listSkills', () => {
    it('should get a loaded skill by name', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      const skill = loader.getSkill('skill-a');
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('skill-a');
    });

    it('should return null for unknown skill', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      expect(loader.getSkill('unknown')).toBeNull();
    });

    it('should list all loaded skill names', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      const names = loader.listSkills().sort();
      expect(names).toEqual(['nested-skill', 'skill-a', 'skill-b']);
    });
  });

  describe('getSkillsMetadataPrompt', () => {
    it('should generate metadata prompt with all skills', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      const prompt = loader.getSkillsMetadataPrompt();

      expect(prompt).toContain('## Available Skills');
      expect(prompt).toContain('`skill-a`');
      expect(prompt).toContain('`skill-b`');
      expect(prompt).toContain('`nested-skill`');
      // 不应包含完整内容
      expect(prompt).not.toContain('Skill A Instructions');
    });

    it('should return empty string when no skills loaded', () => {
      const loader = new SkillLoader(path.join(tempDir, 'no-exist'));
      loader.discoverSkills();

      expect(loader.getSkillsMetadataPrompt()).toBe('');
    });
  });

  describe('getSkillPrompt', () => {
    it('should return full skill prompt', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      const prompt = loader.getSkillPrompt('skill-a');

      expect(prompt).not.toBeNull();
      expect(prompt).toContain('# Skill: skill-a');
      expect(prompt).toContain('Skill Root Directory');
      expect(prompt).toContain('Skill A Instructions');
    });

    it('should return null for unknown skill', () => {
      const loader = new SkillLoader(tempDir);
      loader.discoverSkills();

      expect(loader.getSkillPrompt('unknown')).toBeNull();
    });
  });

  describe('path processing', () => {
    it('should convert document references to absolute paths', () => {
      const loader = new SkillLoader(tempDir);
      const skill = loader.loadSkill(path.join(tempDir, 'skill-b', 'SKILL.md'));

      expect(skill).not.toBeNull();
      // "see reference.md" 应被转换为绝对路径
      const skillBDir = path.join(tempDir, 'skill-b');
      expect(skill!.content).toContain(path.join(skillBDir, 'reference.md'));
      expect(skill!.content).toContain('use read_file to access');
    });
  });
});

describe('GetSkillTool', () => {
  let tempDir: string;
  let loader: SkillLoader;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-skill-tool-'));

    // 创建测试 skill
    const skillDir = path.join(tempDir, 'test-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill
---

# Test Skill Content
`
    );

    loader = new SkillLoader(tempDir);
    loader.discoverSkills();
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return full skill content', async () => {
    const tool = createGetSkillTool(loader);
    const result = await tool.execute({ skill_name: 'test-skill' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('# Skill: test-skill');
    expect(result.content).toContain('Test Skill Content');
  });

  it('should return error for non-existent skill', async () => {
    const tool = createGetSkillTool(loader);
    const result = await tool.execute({ skill_name: 'non-existent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
    expect(result.error).toContain('test-skill');
  });

  it('should have correct tool metadata', () => {
    const tool = createGetSkillTool(loader);

    expect(tool.name).toBe('get_skill');
    expect(tool.description).toContain('skill');
  });
});
