# Changesets

本仓库使用 [changesets](https://github.com/changesets/changesets) 管理版本发布。

## 包发布策略

本仓库采用**手动管理**策略：

- `mini-agents`（核心库）和 `mini-agents-cli`（CLI）独立发版
- CLI 依赖核心库，但核心库不依赖 CLI
- 当核心库发版时，需要手动给 CLI 也加一个 `patch` changeset 以更新依赖

**示例场景**：
| 变更 | mini-agents | mini-agents-cli | 操作 |
|------|------------|----------------|------|
| 核心库新增功能 | 0.1.0 → 0.2.0 | 0.1.0 → 0.1.1 | 给两个包都加 changeset |
| 只改 CLI | 不变 | 升版本 | 只给 CLI 加 changeset |

## 前置配置：NPM Trusted Publishing (OIDC)

本仓库使用 NPM 的 **Trusted Publishing**（基于 OIDC）进行发布，无需配置 `NPM_TOKEN`。

### 配置步骤

1. **在 NPM 网站配置信任发布者**

   访问每个包的 NPM 页面（如 `https://www.npmjs.com/package/mini-agents`）：
   - 点击 **Settings** → **Publishing access**
   - 找到 **"Automate publishing with GitHub Actions"** 或 **"Add trusted publisher"**
   - 点击 **"Add a new trusted publisher"**

2. **填写配置信息**

   | 字段 | 值 |
   |------|-----|
   | GitHub Organization | `liruifengv`（替换为你的用户名/组织） |
   | GitHub Repository | `mini-agent` |
   | GitHub Workflow | `release.yml` |
   | Environment | 留空（使用默认） |

3. **重复配置每个包**

   对 `mini-agents` 和 `mini-agents-cli` 两个包都要进行上述配置。

## 开发工作流程

### 1. 开发功能

正常开发你的功能或修复。

### 2. 生成 changeset

开发完成后，执行以下命令生成 changeset 文件：

```bash
pnpm changeset
```

按提示选择：
- 选择本次变更涉及的包（使用空格选择）
- 选择版本类型：
  - `patch`：bug 修复、小改动
  - `minor`：新功能，向后兼容
  - `major`：破坏性变更
- 输入变更描述

这会生成一个 `.changeset/*.md` 文件，需要提交到仓库。

### 3. 提交 changeset

```bash
git add .changeset/
git commit -m "chore: add changeset for xxx"
git push
```

### 4. CI 自动生成发布 PR

当 changeset 文件合并到 main/master 分支后，GitHub Actions 会自动创建一个 "[CI]: Release packages" PR。

这个 PR 会：
- 更新包的版本号
- 更新 CHANGELOG.md
- 删除已处理的 changeset 文件

### 5. 合并发布 PR

审核并合并 "[CI]: Release packages" PR 后，CI 会自动：
- 发布包到 NPM（使用 Trusted Publishing）
- 创建 GitHub Release

## 手动发布（不推荐）

如果需要手动发布：

```bash
# 版本更新
pnpm version-packages

# 构建并发布（需要 npm login）
pnpm release
```

## 注意事项

- 每个有代码变更的 PR 都应该包含对应的 changeset
- changeset 文件必须提交到仓库才能触发发布流程
- 发布 PR 需要手动合并，不会自动发布
- 确保在 NPM 上为每个包都配置了 Trusted Publisher

## 参考资料

- [NPM Trusted Publishing 文档](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Blog: npm classic tokens revoked](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/)
- [Changesets GitHub Action](https://github.com/changesets/action)
