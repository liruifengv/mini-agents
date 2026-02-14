/**
 * GetSkill Tool - Agent 按需加载 Skill 的工具
 *
 * 实现渐进式披露 Level 2：Agent 调用此工具获取 skill 的完整内容。
 */

import { z } from 'zod';
import type { Tool } from '../core/base';
import { tool } from '../core/zod-tool';
import type { SkillLoader } from './skill-loader';

/**
 * 创建 get_skill 工具
 *
 * @param skillLoader - SkillLoader 实例
 */
export function createGetSkillTool(skillLoader: SkillLoader): Tool {
  return tool({
    name: 'get_skill',
    description:
      'Get complete content and guidance for a specified skill, used for executing specific types of tasks',
    parameters: z.object({
      skill_name: z.string().describe('Name of the skill to retrieve'),
    }),
    async execute({ skill_name }) {
      const prompt = skillLoader.getSkillPrompt(skill_name);

      if (!prompt) {
        const available = skillLoader.listSkills().join(', ');
        return {
          success: false,
          content: '',
          error: `Skill '${skill_name}' does not exist. Available skills: ${available}`,
        };
      }

      return prompt;
    },
  });
}
