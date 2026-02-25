/**
 * 极简 CLI 实现
 *
 * 使用纯 Node.js API，无第三方渲染库
 */

import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import type { AgentMessageEvent } from 'mini-agents';
import { Agent, LLMClient } from 'mini-agents';
import {
  createBashTool,
  createEditTool,
  createGetSkillTool,
  createReadTool,
  createWriteTool,
  SkillLoader,
  type Tool,
} from 'mini-agents/tools';
import type { Settings } from './config';
import { findConfigFile } from './config';
import { getMemoryInstructions } from './memory';

// ANSI 颜色
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
};

export class SimpleCLI {
  private settings: Settings;
  private workspaceDir: string;
  private agent: Agent;
  private inputBuffer = '';
  private isProcessing = false;
  private abortController: AbortController | null = null;

  constructor(settings: Settings, workspaceDir: string) {
    this.settings = settings;
    this.workspaceDir = workspaceDir;
    this.agent = this.createAgent();
  }

  private createAgent(): Agent {
    const llmClient = new LLMClient({
      apiKey: this.settings.llm.apiKey,
      provider: this.settings.llm.provider,
      apiBaseURL: this.settings.llm.apiBaseURL,
      model: this.settings.llm.model,
    });

    const tools: Tool[] = [];
    if (this.settings.tools.enableFileTools) {
      tools.push(createReadTool(this.workspaceDir));
      tools.push(createWriteTool(this.workspaceDir));
      tools.push(createEditTool(this.workspaceDir));
    }
    if (this.settings.tools.enableBash) {
      tools.push(createBashTool());
    }

    // 加载 Skills
    let skillsMetadata = '';
    if (this.settings.tools.enableSkills) {
      const skillsDir = this.settings.tools.skillsDir;
      const loader = new SkillLoader(skillsDir);
      const skills = loader.discoverSkills();
      if (skills.length > 0) {
        tools.push(createGetSkillTool(loader));
        skillsMetadata = loader.getSkillsMetadataPrompt();
      }
    }

    // 加载系统提示词
    let systemPrompt: string;
    const promptPath = findConfigFile(this.settings.agent.systemPromptPath);
    if (promptPath) {
      systemPrompt = readFileSync(promptPath, 'utf-8');
    } else {
      systemPrompt =
        'You are Mini-Agent, an intelligent AI assistant that helps users complete tasks using available tools. ' +
        'Be concise and helpful.';
    }

    // 注入 Skills 元数据到系统提示词
    if (skillsMetadata) {
      systemPrompt = systemPrompt.replace('{{SKILLS_METADATA}}', skillsMetadata);
    } else {
      systemPrompt = systemPrompt.replace('{{SKILLS_METADATA}}', '');
    }

    // 注入工作区信息
    if (!systemPrompt.includes('Current Workspace')) {
      systemPrompt +=
        `\n\n## Current Workspace\n` +
        `You are currently working in: \`${this.workspaceDir}\`\n` +
        `All relative paths will be resolved relative to this directory.`;
    }

    // 注入记忆管理指令
    systemPrompt += `\n\n${getMemoryInstructions()}`;

    return new Agent(llmClient, systemPrompt, tools);
  }

  private printBanner(): void {
    console.log();
    console.log(`${colors.cyan}${colors.bright}🤖 Mini Agent${colors.reset}`);
    console.log(
      `${colors.gray}${this.settings.llm.model} · ${this.getToolCount()} tools · ${this.workspaceDir}${colors.reset}`
    );
    console.log(`${colors.gray}${'─'.repeat(60)}${colors.reset}`);
    console.log();
  }

  private getToolCount(): number {
    return [
      this.settings.tools.enableFileTools,
      this.settings.tools.enableBash,
      this.settings.tools.enableSkills,
      this.settings.tools.enableMcp,
    ].filter(Boolean).length;
  }

  private printPrompt(): void {
    stdout.write(`${colors.green}You › ${colors.reset}`);
  }

  private printThinking(text: string): void {
    const display = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    console.log(`${colors.gray}  💭 ${display}${colors.reset}`);
  }

  private printToolCall(name: string, args: Record<string, unknown>): void {
    const argsStr = Object.entries(args)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
    const display = argsStr.length > 200 ? `${argsStr.slice(0, 200)}...` : argsStr;
    console.log(`${colors.yellow}  ⚡ ${name}(${display})${colors.reset}`);
  }

  private printToolResult(isError: boolean): void {
    if (isError) {
      console.log(`${colors.red}  ✗ Failed${colors.reset}`);
    } else {
      console.log(`${colors.gray}  ✓ Done${colors.reset}`);
    }
  }

  private printAssistantMessage(content: string): void {
    console.log(`${colors.cyan}Assistant › ${content}${colors.reset}`);
  }

  private printError(error: string): void {
    console.log(`${colors.red}Error: ${error}${colors.reset}`);
  }

  private printHelp(): void {
    console.log();
    console.log(`${colors.bright}Available commands:${colors.reset}`);
    console.log(`  /help    - Show this help message`);
    console.log(`  /clear   - Clear the screen`);
    console.log(`  /exit    - Exit the CLI`);
    console.log();
  }

  /**
   * 处理 AgentMessageEvent，实时打印
   */
  private handleAgentMessageEvent(event: AgentMessageEvent): void {
    switch (event.type) {
      case 'thinking':
        if (event.thinking) {
          this.printThinking(event.thinking);
        }
        break;
      case 'toolCall':
        this.printToolCall(event.toolCall.function.name, event.toolCall.function.arguments);
        break;
      case 'toolResult':
        this.printToolResult(!event.result.success);
        break;
      case 'assistantMessage':
        if (event.content?.trim()) {
          this.printAssistantMessage(event.content);
        }
        break;
      case 'summarized':
        console.log(
          `${colors.yellow}  📝 Messages summarized (${event.beforeTokens} → ${event.afterTokens} tokens)${colors.reset}`
        );
        break;
    }
  }

  private async processMessage(text: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // 创建取消控制器
    this.abortController = new AbortController();

    this.agent.addUserMessage(text);

    // 显示 loading
    let loadingFrame = 0;
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const loadingInterval = setInterval(() => {
      stdout.write(`\r${colors.blue}  ${loadingFrames[loadingFrame]} Thinking...${colors.reset}`);
      loadingFrame = (loadingFrame + 1) % loadingFrames.length;
    }, 100);

    try {
      let hasReceivedEvent = false;

      // 使用 for await...of 消费 async generator，传入取消信号
      for await (const event of this.agent.run({ signal: this.abortController.signal })) {
        // 收到第一个事件后清除 loading
        if (!hasReceivedEvent) {
          clearInterval(loadingInterval);
          stdout.write(`\r${' '.repeat(30)}\r`);
          hasReceivedEvent = true;
        }

        // 处理取消事件
        if (event.type === 'cancelled') {
          console.log(`${colors.yellow}⏹  Task cancelled by user.${colors.reset}`);
          break;
        }

        this.handleAgentMessageEvent(event);
      }

      // 如果没有收到任何事件（异常情况），也要清除 loading
      if (!hasReceivedEvent) {
        clearInterval(loadingInterval);
        stdout.write(`\r${' '.repeat(30)}\r`);
      }

      console.log();
    } catch (err) {
      // 清除 loading
      clearInterval(loadingInterval);
      stdout.write(`\r${' '.repeat(30)}\r`);

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.printError(errorMsg);
      console.log();
    } finally {
      this.abortController = null;
      this.isProcessing = false;
    }
  }

  async start(): Promise<void> {
    this.printBanner();

    // 设置原始模式，自己处理输入
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    this.printPrompt();

    stdin.on('data', async (data: string) => {
      // 处理每个字符（包括多字节UTF-8字符）
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        const charCode = char.charCodeAt(0);

        // Ctrl+C
        if (charCode === 3) {
          console.log();
          console.log(`${colors.cyan}Goodbye!${colors.reset}`);
          process.exit(0);
        }

        // Esc 键：在处理中时取消 Agent 执行
        if (charCode === 27 && this.isProcessing && this.abortController) {
          this.abortController.abort();
          continue;
        }

        // Enter
        if (charCode === 13) {
          console.log();
          const text = this.inputBuffer;
          this.inputBuffer = '';

          if (!text.trim()) {
            this.printPrompt();
            continue;
          }

          // 斜杠命令
          if (text.startsWith('/')) {
            const cmd = text.slice(1).toLowerCase();
            switch (cmd) {
              case 'exit':
              case 'quit': {
                console.log(`${colors.cyan}Goodbye!${colors.reset}`);
                process.exit(0);
              }
              case 'clear':
                console.clear();
                this.printBanner();
                this.printPrompt();
                continue;
              case 'help':
                this.printHelp();
                this.printPrompt();
                continue;
              default:
                console.log(`${colors.red}Unknown command: ${cmd}${colors.reset}`);
                this.printPrompt();
                continue;
            }
          }

          await this.processMessage(text);
          this.printPrompt();
          continue;
        }

        // Backspace (DEL 127 或 BS 8)
        if (charCode === 127 || charCode === 8) {
          if (this.inputBuffer.length > 0) {
            // 获取最后一个字符的显示宽度
            const lastChar = this.inputBuffer[this.inputBuffer.length - 1];
            const charWidth = lastChar && lastChar.charCodeAt(0) > 127 ? 2 : 1;

            this.inputBuffer = this.inputBuffer.slice(0, -1);

            // 根据字符宽度移动光标并清除
            if (charWidth === 2) {
              stdout.write('\b\b  \b\b');
            } else {
              stdout.write('\b \b');
            }
          }
          continue;
        }

        // 忽略控制字符（0-31，除了上面处理的）
        if (charCode < 32) {
          continue;
        }

        // 所有可打印字符（包括中文）
        this.inputBuffer += char;
        stdout.write(char);
      }
    });
  }
}
