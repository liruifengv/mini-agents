/**
 * Skill Loader - 加载和管理 Skills
 *
 * 支持从 SKILL.md 文件加载技能，并提供给 Agent 使用。
 * 采用渐进式披露（Progressive Disclosure）架构：
 * - Level 1: 元数据（名称 + 描述）注入系统提示词
 * - Level 2: 按需加载完整内容（通过 get_skill 工具）
 * - Level 3+: 内容中引用的资源文件（路径自动转绝对路径）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Skill 数据结构
 */
export interface Skill {
  /** 技能名称（小写 + 连字符） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 完整内容（Markdown） */
  content: string;
  /** SKILL.md 文件的绝对路径 */
  skillPath: string;
  /** 许可证（可选） */
  license?: string;
  /** 预授权工具列表（可选） */
  allowedTools?: string[];
  /** 自定义元数据（可选） */
  metadata?: Record<string, string>;
}

/**
 * 解析 YAML frontmatter
 *
 * 支持简单的键值对格式，不依赖第三方 YAML 库。
 * 支持：字符串值、带引号的字符串、JSON 数组。
 */
function parseFrontmatter(
  raw: string
): { frontmatter: Record<string, unknown>; content: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatterText = match[1];
  const content = match[2].trim();

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterText.split('\n')) {
    const kvMatch = line.match(/^([\w][\w-]*)\s*:\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    let value: unknown = kvMatch[2].trim();

    // 去除引号
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    // 解析 JSON 数组
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        // 保持原始字符串
      }
    }

    frontmatter[key] = value;
  }

  return { frontmatter, content };
}

/**
 * 将 Skill 转为 LLM 提示文本（Level 2 完整内容）
 */
function skillToPrompt(skill: Skill): string {
  const skillRoot = dirname(skill.skillPath);

  return `# Skill: ${skill.name}

${skill.description}

**Skill Root Directory:** \`${skillRoot}\`

All files and references in this skill are relative to this directory.

---

${skill.content}`;
}

/**
 * 处理 skill 内容中的相对路径，转为绝对路径（Level 3+）
 *
 * 支持 3 种模式：
 * 1. 目录路径：scripts/xxx, references/xxx, assets/xxx
 * 2. 文档引用：see/read/refer to xxx.md
 * 3. Markdown 链接：[text](path)
 */
function processSkillPaths(content: string, skillDir: string): string {
  let result = content;

  // 模式 1: 目录路径（scripts/, references/, assets/）
  result = result.replace(
    /(python\s+|`)((?:scripts|references|assets)\/[^\s`)]+)/g,
    (match, prefix: string, relPath: string) => {
      const absPath = join(skillDir, relPath);
      if (existsSync(absPath)) {
        return `${prefix}${absPath}`;
      }
      return match;
    }
  );

  // 模式 2: 文档引用（see/read/refer to/check xxx.md）
  result = result.replace(
    /(see|read|refer to|check)\s+([a-zA-Z0-9_-]+\.(?:md|txt|json|yaml))([.,;\s])/gi,
    (match, prefix: string, filename: string, suffix: string) => {
      const absPath = join(skillDir, filename);
      if (existsSync(absPath)) {
        return `${prefix} \`${absPath}\` (use read_file to access)${suffix}`;
      }
      return match;
    }
  );

  // 模式 3: Markdown 链接
  result = result.replace(
    /(?:(Read|See|Check|Refer to|Load|View)\s+)?\[(`?[^`\]]+`?)\]\(((?:\.\/)?[^)]+\.(?:md|txt|json|yaml|js|py|html))\)/gi,
    (match, prefixWord: string | undefined, linkText: string, filepath: string) => {
      const prefix = prefixWord ? `${prefixWord} ` : '';
      // 去除 ./ 前缀
      const cleanPath = filepath.startsWith('./') ? filepath.slice(2) : filepath;
      const absPath = join(skillDir, cleanPath);
      if (existsSync(absPath)) {
        return `${prefix}[${linkText}](\`${absPath}\`) (use read_file to access)`;
      }
      return match;
    }
  );

  return result;
}

/**
 * 递归查找目录下所有 SKILL.md 文件
 */
function findSkillFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry === 'SKILL.md') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Skill 加载器
 */
export class SkillLoader {
  private skillsDir: string;
  private loadedSkills: Map<string, Skill> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = resolve(skillsDir);
  }

  /**
   * 加载单个 SKILL.md 文件
   */
  loadSkill(skillPath: string): Skill | null {
    try {
      const raw = readFileSync(skillPath, 'utf-8');

      // 解析 frontmatter
      const parsed = parseFrontmatter(raw);
      if (!parsed) {
        console.warn(`⚠️  ${skillPath} missing YAML frontmatter`);
        return null;
      }

      const { frontmatter, content } = parsed;

      // 验证必填字段
      if (!frontmatter.name || !frontmatter.description) {
        console.warn(`⚠️  ${skillPath} missing required fields (name or description)`);
        return null;
      }

      // 处理相对路径
      const skillDir = dirname(skillPath);
      const processedContent = processSkillPaths(content, skillDir);

      return {
        name: frontmatter.name as string,
        description: frontmatter.description as string,
        content: processedContent,
        skillPath,
        license: frontmatter.license as string | undefined,
        allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
        metadata: frontmatter.metadata as Record<string, string> | undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to load skill (${skillPath}): ${msg}`);
      return null;
    }
  }

  /**
   * 递归发现并加载 skills 目录下所有 skill
   */
  discoverSkills(): Skill[] {
    const skills: Skill[] = [];

    if (!existsSync(this.skillsDir)) {
      console.warn(`⚠️  Skills directory does not exist: ${this.skillsDir}`);
      return skills;
    }

    const skillFiles = findSkillFiles(this.skillsDir);
    for (const filePath of skillFiles) {
      const skill = this.loadSkill(filePath);
      if (skill) {
        skills.push(skill);
        this.loadedSkills.set(skill.name, skill);
      }
    }

    return skills;
  }

  /**
   * 获取已加载的 skill
   */
  getSkill(name: string): Skill | null {
    return this.loadedSkills.get(name) ?? null;
  }

  /**
   * 列出所有已加载的 skill 名称
   */
  listSkills(): string[] {
    return Array.from(this.loadedSkills.keys());
  }

  /**
   * 生成 Level 1 元数据提示（名称 + 描述）
   *
   * 用于注入系统提示词，让 Agent 知道有哪些 skill 可用，
   * 但不加载完整内容以节省 token。
   */
  getSkillsMetadataPrompt(): string {
    if (this.loadedSkills.size === 0) return '';

    const parts = [
      '## Available Skills\n',
      'You have access to specialized skills. Each skill provides expert guidance for specific tasks.',
      "Load a skill's full content using `get_skill(skill_name)` when needed.\n",
    ];

    for (const skill of this.loadedSkills.values()) {
      parts.push(`- \`${skill.name}\`: ${skill.description}`);
    }

    return parts.join('\n');
  }

  /**
   * 将 skill 转为完整提示文本（Level 2）
   */
  getSkillPrompt(name: string): string | null {
    const skill = this.getSkill(name);
    if (!skill) return null;
    return skillToPrompt(skill);
  }
}
