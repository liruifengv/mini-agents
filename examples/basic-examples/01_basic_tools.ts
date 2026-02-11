/**
 * Example 1: Basic Tools Usage
 *
 * This example demonstrates how to use the basic tools:
 * - ReadTool: Read file contents
 * - WriteTool: Write file contents
 * - EditTool: Edit file contents
 * - BashTool: Execute shell commands
 *
 * Based on: packages/mini-agents/tests/tools/read-tool.test.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BackgroundShellManager,
  createBashKillTool,
  createBashOutputTool,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from 'mini-agents/tools';

async function demoReadTool() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Demo: ReadTool - Read file contents');
  console.log('='.repeat(60));

  // 创建临时目录和文件
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-tool-demo-'));
  const testFile = path.join(tmpDir, 'test.txt');
  await fs.writeFile(testFile, 'Line 1: Hello\nLine 2: World\nLine 3: Mini Agent');

  try {
    const tool = createReadTool(tmpDir);

    // Example 1: Read entire file
    console.log('\n1. Read entire file:');
    const result1 = await tool.execute({ path: 'test.txt' });
    if (result1.success) {
      console.log('✅ File read successfully');
      console.log(`Content:\n${result1.content}`);
    } else {
      console.log(`❌ Failed: ${result1.error}`);
    }

    // Example 2: Read with offset and limit
    console.log('\n2. Read with offset=2, limit=1:');
    const result2 = await tool.execute({ path: 'test.txt', offset: 2, limit: 1 });
    if (result2.success) {
      console.log('✅ Partial read successful');
      console.log(`Content:\n${result2.content}`);
    } else {
      console.log(`❌ Failed: ${result2.error}`);
    }

    // Example 3: Read non-existent file
    console.log('\n3. Read non-existent file:');
    const result3 = await tool.execute({ path: 'nonexistent.txt' });
    if (result3.success) {
      console.log('✅ File read successfully');
    } else {
      console.log(`❌ Expected error: ${result3.error}`);
    }
  } finally {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function demoWriteTool() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Demo: WriteTool - Write file contents');
  console.log('='.repeat(60));

  // 创建临时目录
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-tool-demo-'));

  try {
    const writeTool = createWriteTool(tmpDir);
    const readTool = createReadTool(tmpDir);

    // Example 1: Write a new file
    console.log('\n1. Write a new file:');
    const result1 = await writeTool.execute({
      path: 'hello.txt',
      content: 'Hello, Mini Agent!\nThis is a test file.',
    });
    if (result1.success) {
      console.log(`✅ ${result1.content}`);
      // Verify by reading
      const readResult = await readTool.execute({ path: 'hello.txt' });
      console.log(`Verification:\n${readResult.content}`);
    } else {
      console.log(`❌ Failed: ${result1.error}`);
    }

    // Example 2: Overwrite existing file
    console.log('\n2. Overwrite existing file:');
    const result2 = await writeTool.execute({
      path: 'hello.txt',
      content: 'Content has been overwritten!',
    });
    if (result2.success) {
      console.log(`✅ ${result2.content}`);
      const readResult = await readTool.execute({ path: 'hello.txt' });
      console.log(`New content:\n${readResult.content}`);
    } else {
      console.log(`❌ Failed: ${result2.error}`);
    }

    // Example 3: Write to nested directory (auto-create)
    console.log('\n3. Write to nested directory (auto-create parent dirs):');
    const result3 = await writeTool.execute({
      path: 'nested/deep/file.txt',
      content: 'File in nested directory',
    });
    if (result3.success) {
      console.log(`✅ ${result3.content}`);
      const readResult = await readTool.execute({ path: 'nested/deep/file.txt' });
      console.log(`Content:\n${readResult.content}`);
    } else {
      console.log(`❌ Failed: ${result3.error}`);
    }
  } finally {
    // 清理临时目录
    // await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function demoEditTool() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Demo: EditTool - Edit file contents');
  console.log('='.repeat(60));

  // 创建临时目录
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-tool-demo-'));

  try {
    const editTool = createEditTool(tmpDir);
    const readTool = createReadTool(tmpDir);

    // 准备测试文件
    await fs.writeFile(
      path.join(tmpDir, 'code.ts'),
      `function greet(name: string) {
  return 'Hello, ' + name;
}

console.log(greet('World'));`
    );

    // Example 1: Simple text replacement
    console.log('\n1. Simple text replacement:');
    console.log('Before:');
    let readResult = await readTool.execute({ path: 'code.ts' });
    console.log(readResult.content);

    const result1 = await editTool.execute({
      path: 'code.ts',
      old_str: "'Hello, '",
      new_str: "'Hi, '",
    });
    if (result1.success) {
      console.log(`\n✅ ${result1.content}`);
      console.log('After:');
      readResult = await readTool.execute({ path: 'code.ts' });
      console.log(readResult.content);
    } else {
      console.log(`❌ Failed: ${result1.error}`);
    }

    // Example 2: Multiline replacement
    console.log('\n2. Multiline replacement:');
    const result2 = await editTool.execute({
      path: 'code.ts',
      old_str: `function greet(name: string) {
  return 'Hi, ' + name;
}`,
      new_str: `function greet(name: string): string {
  return \`Hi, \${name}!\`;
}`,
    });
    if (result2.success) {
      console.log(`✅ ${result2.content}`);
      console.log('After:');
      readResult = await readTool.execute({ path: 'code.ts' });
      console.log(readResult.content);
    } else {
      console.log(`❌ Failed: ${result2.error}`);
    }

    // Example 3: Text not found error
    console.log('\n3. Text not found error:');
    const result3 = await editTool.execute({
      path: 'code.ts',
      old_str: 'NonExistentText',
      new_str: 'replacement',
    });
    if (result3.success) {
      console.log('✅ Unexpected success');
    } else {
      console.log(`❌ Expected error: ${result3.error}`);
    }
  } finally {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function demoBashTool() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Demo: BashTool - Execute shell commands');
  console.log('='.repeat(60));

  const bashTool = createBashTool();
  const bashOutputTool = createBashOutputTool();
  const bashKillTool = createBashKillTool();

  try {
    // Example 1: Execute simple command
    console.log('\n1. Execute simple command:');
    const result1 = await bashTool.execute({ command: 'echo "Hello from shell!"' });
    if (result1.success) {
      console.log(`✅ Command output:\n${result1.content}`);
    } else {
      console.log(`❌ Failed: ${result1.error}`);
    }

    // Example 2: Execute command and capture stderr
    console.log('\n2. Execute command with stderr:');
    const result2 = await bashTool.execute({ command: 'echo "stdout" && echo "stderr" >&2' });
    if (result2.success) {
      console.log(`✅ Command output:\n${result2.content}`);
    } else {
      console.log(`❌ Failed: ${result2.error}`);
    }

    // Example 3: Execute command with exit code
    console.log('\n3. Execute command that fails:');
    const result3 = await bashTool.execute({ command: 'exit 1' });
    if (result3.success) {
      console.log(`✅ Command output:\n${result3.content}`);
    } else {
      console.log(`❌ Expected error: ${result3.error}`);
    }

    // Example 4: Background command
    console.log('\n4. Background command execution:');
    const result4 = await bashTool.execute({
      command: 'for i in 1 2 3; do echo "Count: $i"; sleep 0.2; done',
      run_in_background: true,
    });
    if (result4.success) {
      console.log(`✅ ${result4.content}`);

      // Extract bash ID
      const match = result4.content.match(/Bash ID: (\w+)/);
      if (match) {
        const bashId = match[1];

        // Wait for command to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Get output
        console.log('\n5. Get background command output:');
        const outputResult = await bashOutputTool.execute({ bash_id: bashId });
        if (outputResult.success) {
          console.log(`✅ Output:\n${outputResult.content}`);
        } else {
          console.log(`❌ Failed: ${outputResult.error}`);
        }
      }
    } else {
      console.log(`❌ Failed: ${result4.error}`);
    }

    // Example 6: Kill background command
    console.log('\n6. Start and kill background command:');
    const result6 = await bashTool.execute({
      command: 'sleep 60',
      run_in_background: true,
    });
    if (result6.success) {
      const match = result6.content.match(/Bash ID: (\w+)/);
      if (match) {
        const bashId = match[1];
        console.log(`Started background sleep command: ${bashId}`);

        const killResult = await bashKillTool.execute({ bash_id: bashId });
        if (killResult.success) {
          console.log(`✅ Kill result:\n${killResult.content}`);
        } else {
          console.log(`❌ Failed: ${killResult.error}`);
        }
      }
    }
  } finally {
    // 清理所有后台进程
    await BackgroundShellManager.clearAll();
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Basic Tools Usage Examples');
  console.log('='.repeat(60));
  console.log('\nThese examples show how to use the core tools directly.');
  console.log('In a real agent scenario, the LLM decides which tools to use.\n');

  await demoReadTool();
  await demoWriteTool();
  await demoEditTool();
  await demoBashTool();

  console.log(`\n${'='.repeat(60)}`);
  console.log('All demos completed! ✅');
  console.log('='.repeat(60));
}

main().catch(console.error);
