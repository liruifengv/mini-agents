# Claude 开发指南

## 项目目的

1. **实现 mini-agents 框架** - 将 Python 版本的 mini-agent 复刻为 TypeScript 版本
2. **学习 agent 开发知识** - 通过阅读和理解 Python 代码，学习 AI Agent 的设计与实现

## 开发流程

每次开发新功能时，严格按照以下步骤进行：

### 第一步：阅读 Python 代码
- 找到 Python 版本中对应功能的代码位置
- 给出代码位置（文件路径 + 行号）
- 详细讲解代码逻辑和设计思想
- **不修改 Python 代码，只作为学习参考**

### 第二步：确认理解
- 等待用户确认已理解 Python 版本的实现
- 用户可以提问，Claude 解答

### 第三步：给出 TS 实现计划
- 用户确认理解后，给出 TypeScript 版本的实现计划
- 计划应包含：文件结构、接口设计、实现要点

### 第四步：实施
- 用户同意计划后，开始编写代码
- 按计划逐步实现

### 第五步：新增示例
- 按照 Python 版本的格式，在 `examples/` 目录下更新对应示例
- 示例文件命名：`01_basic_tools.ts`, `02_simple_agent.ts` 等（序号 + 下划线 + 功能名）
- 格式规范：
  - 文件顶部有 JSDoc 注释说明示例内容
  - 每个功能有独立的 demo 函数
  - 使用分隔线和标题输出
  - 有 main 函数统一运行所有 demo
- 参考 Python 版本：`libs/Mini-Agent/examples/`

### 第六步：测试说明
- 实施完成后，告诉用户如何测试
- 包括：运行测试命令、验证方式、预期结果

### 第七步：更新进度
- 每完成一个任务后，更新 `DEVELOPMENT_PLAN.md` 中的实施进度
- 将对应任务的 `[ ]` 改为 `[x]`

## 参考代码位置

- Python 版本：`libs/Mini-Agent/`
- TypeScript 版本：`packages/mini-agents/`

## 实现规范

### 提交前检查
- **每次 git commit 之前，必须先运行 `pnpm check` 确保代码格式和 lint 通过**
- 如果 check 失败，先运行 `pnpm biome check --fix .` 自动修复，再手动处理剩余问题
- 确认 check 通过后再提交

### 通用规范
- 代码风格：遵循 TypeScript 社区的最佳实践
- 注释：每个函数和类都要有清晰的注释说明
- 模块化：保持代码模块化，便于维护和扩展
- 测试覆盖：确保新功能有相应的测试用例覆盖
- 错误处理：合理处理可能出现的错误，保证程序的健壮性
- 不要照搬 Python 代码，要根据 TypeScript 最佳实践进行设计和实现

### 语言规范

| 内容 | 语言 |
|------|------|
| 工具元信息（name、description、参数描述） | 英文 |
| 代码注释 | 中文 |
| 错误消息/返回消息 | 英文 |
| 单元测试描述（describe/it） | 英文 |
| 测试内部注释 | 中文 |

### 工具（Tool）实现规范

使用**函数式工厂模式** + **Zod schema** 创建工具，不使用类继承方式。

**模式示例**：
```typescript
import { z } from 'zod';
import { tool } from './zod-tool';

export function createXxxTool(workspaceDir: string) {
  return tool({
    name: 'xxx',
    description: 'Tool description in English',
    parameters: z.object({
      param1: z.string().describe('Parameter 1 description'),
      param2: z.number().optional().describe('Parameter 2 description (optional)'),
    }),
    async execute({ param1, param2 }) {
      // 实现逻辑（注释用中文）
      // 成功：返回 string（英文消息）
      // 失败：返回 { success: false, content: '', error: 'Error message in English' }
    },
  });
}
```

**关键点**：
1. 工厂函数命名：`createXxxTool(workspaceDir)`
2. 参数验证：使用 Zod schema 定义，自动转换为 JSON Schema
3. 返回值：成功返回 `string`，失败返回 `ToolResult` 对象
4. 路径处理：支持相对路径（基于 workspaceDir）和绝对路径

**参考实现**：`packages/mini-agents/src/tools/filesystem/read-tool.ts`

### 单元测试规范

每个新功能必须编写对应的单元测试，使用 Vitest 框架。

**文件位置**：`packages/mini-agents/tests/` 目录下，与源码结构对应
- 工具测试：`tests/tools/xxx-tool.test.ts`
- 工具函数测试：`tests/utils/xxx.test.ts`
- LLM 测试：`tests/llm/xxx.test.ts`

**测试模板**：
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('FeatureName', () => {
  let tempDir: string;

  beforeAll(async () => {
    // 创建临时目录/初始化资源
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
  });

  afterAll(async () => {
    // 清理临时目录/释放资源
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should do something', async () => {
    // Arrange
    // Act
    // Assert
    expect(result.success).toBe(true);
  });
});
```

**测试覆盖要点**：
1. 正常流程（happy path）
2. 边界条件（空值、大文件等）
3. 错误处理（文件不存在、权限等）
4. 参数组合（可选参数、组合使用）

**运行测试**：
```bash
# 运行所有测试
pnpm test

# 运行单个测试文件
pnpm test packages/mini-agents/tests/tools/xxx-tool.test.ts
```

**参考实现**：`packages/mini-agents/tests/tools/read-tool.test.ts`

## 开发计划

详见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)
