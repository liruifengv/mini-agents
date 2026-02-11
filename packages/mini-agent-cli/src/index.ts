#!/usr/bin/env node

/**
 * Mini Agent CLI - 极简版本
 *
 * 纯 Node.js 实现，无第三方渲染库
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import { SimpleCLI } from './cli';
import { findSettingsFile, loadSettingsFromFile, type Settings } from './config';

const program = new Command();

program
  .name('mini-agent-cli')
  .description('Mini Agent - AI assistant with tool support')
  .version('0.3.0')
  .option('-w, --workspace <dir>', 'Workspace directory', process.cwd())
  .action(async (options) => {
    // 查找配置文件，未找到则进入 onboarding
    let settingsPath = findSettingsFile();
    if (!settingsPath) {
      const { runOnboarding } = await import('./onboarding');
      settingsPath = await runOnboarding();
    }

    // 加载配置
    let settings: Settings;
    try {
      settings = loadSettingsFromFile(settingsPath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }

    // 解析工作目录
    const workspaceDir = resolve(options.workspace);

    // 启动 CLI
    const cli = new SimpleCLI(settings, workspaceDir);
    await cli.start();
  });

program.parse();
