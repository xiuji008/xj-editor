# Git 提交规范内置 + AI 一键生成 Commit Message —— 功能设计文档

> 适用模块：`markdown-desktop`（XJ-Editor / Markdown 桌面编辑器）
> 版本：v1.0 ｜ 日期：2026-09-20

---

## 1. 背景与目标

编辑器已内置 Git 面板（变更 / 暂存 / 提交 / 差异 / 历史），但**提交信息完全靠人工撰写**，经常出现 `fix`、`update`、`修改` 这类无法追溯的描述。
同时项目已有 AI 能力（多厂商、多协议），但仅支持一次性返回，没有流式体验。

**目标（一句话）**：把 Git 提交规范内置进应用并允许在页面修改，提交信息框旁提供「AI 生成」，基于当前改动**流式**产出符合 Conventional Commits 的提交信息。

### 1.1 成功度量（离线应用，人工验收）

| 指标 | 目标值 |
| --- | --- |
| 生成一条提交信息的操作步数 | ≤ 2 步（勾选文件 → 点 AI 生成） |
| 首个增量文本出现时间 | < 3s（境外模型除外） |
| 生成结果首行符合 `<type>(<scope>): <subject>` | ≥ 90%（人工抽样 10 次） |
| 规范修改后持久化 | 重启应用后仍生效 |

### 1.2 非目标

- 不改动用户仓库：不自动安装 commitlint / husky，不写 `.gitmessage`
- 不做自动创建分支、自动打 Tag
- 不改造现有 AI 面板（`ai:chat` 一次性接口保持不变）

---

## 2. 用户与场景

| # | 用户故事 | 验收点 |
| --- | --- | --- |
| US1 | 作为写作者，改完文档后希望一键得到规范的提交信息 | 勾选文件 → AI 生成 → 信息框流式出现规范文案 |
| US2 | 作为团队成员，希望团队规范可被应用遵守 | 在「提交规范设置」中修改规范，生成结果随之变化 |
| US3 | 作为使用者，AI 生成太长想中断 | 生成中点「停止」，已生成内容保留 |
| US4 | 作为使用者，没配过 AI | 点击后提示并直达 AI 配置弹窗 |

---

## 3. 功能设计

### 3.1 提交规范内置与编辑

- 内置两档规范：`full`（完整版：分支命名 / 提交格式 / 评审 / Tag）与 `brief`（精简版：省 token）
- 内置 AI 提示词模板，支持占位符：`${spec}` `${branch}` `${files}` `${recentCommits}` `${diff}`
- 配置持久化在 `userData/commit-spec.json`，文件缺失或损坏自动回落内置默认
- 入口：Git 面板 `⋯` 菜单 →「提交规范设置…」（`GitCommitSpecDialog.vue`）

### 3.2 AI 生成与流式回显

```
勾选文件 → 点「AI 生成」
   ├─ 未配置 AI → 提示并打开 AI 配置
   ├─ 已暂存为空 → 回落工作区改动并提示
   └─ 正常 → 组装上下文 → 流式写入提交信息框 → 生成中可「停止」
```

- 生成结束后：剥离代码围栏与包裹引号、trim、聚焦输入框
- 已填写内容时先确认覆盖；生成中再次点击为「停止」

### 3.3 上下文裁剪（控制 token 与耗时）

| 项 | 策略 |
| --- | --- |
| 变更文件清单 | 最多 20 个，其余省略计数 |
| diff 总量 | 上限 24000 字符，按文件分配预算 |
| 单文件超长 | 保留文件头与 hunk 头 + 每个 hunk 前 24 行，其余标记省略行数 |
| 二进制 / 超大文件 | 仅保留路径与状态 |
| 最近提交 | 默认附带最近 5 条标题作风格参考，可关闭 |

### 3.4 提交前校验（可选，默认关闭）

开启后 `doCommit` 前用正则校验首行（type 白名单、subject ≤ 50 字符、结尾无句号），不合规弹确认框，**可"仍要提交"**，不强制阻断。

---

## 4. 技术方案

### 4.1 流式通道

```
渲染进程生成 requestId
   → preload 先注册 ai:stream:chunk / ai:stream:end 监听（按 requestId 过滤）
   → invoke('ai:stream:start')
   → 主进程 SSE 解析并 send 增量事件
   → ai:stream:stop 通过 AbortController 中断
```

- `ai.cjs` 新增 `chatStreamWithProvider()`，支持 OpenAI 兼容 / Anthropic / Gemini 三种协议的 SSE 解析
- 请求构造抽取为 `buildRequest()`，与一次性调用共用
- **降级**：厂商不支持流式且尚未产出内容时，自动回落一次性请求

### 4.2 文件清单

| 文件 | 改动 |
| --- | --- |
| `electron/ai.cjs` | 新增 `buildRequest` / `chatStreamWithProvider` / `readSseLines` / `extractStreamDelta` |
| `electron/commitSpec.cjs` | 新增：内置规范（full / brief）、提示词模板、读写与重置 |
| `electron/main.cjs` | 新增 `ai:stream:start` / `ai:stream:stop`、`commitSpec:get|set|reset` |
| `electron/preload.cjs` | 暴露 `aiChatStream`、`commitSpec` |
| `src/env.d.ts` | 新增 `AiStreamHandlers` / `AiStreamSession` / `CommitSpecConfig` / `CommitSpecApi` |
| `src/utils/commitSpec.ts` | 新增：模板渲染、文件清单、diff 裁剪、文案规整、格式校验、配置读写 |
| `src/utils/ai.ts` | 新增 `aiChatStream` / `getActiveProvider` / `createAiRequestId` |
| `src/components/GitCommitSpecDialog.vue` | 新增：规范与提示词设置弹窗 |
| `src/components/GitPanel.vue` | AI 生成 / 停止按钮、流式回显、菜单入口、提交前校验 |

---

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 厂商不支持流式 | 自动降级为一次性返回，提示"已一次性生成" |
| 大仓库 diff 过大 | 24000 字符裁剪 + 按 hunk 省略，超时 180s |
| 生成结果带代码围栏 / 引号 | `normalizeCommitMessage()` 统一清洗 |
| 本地模型（Ollama）无 Key | `getActiveProvider()` 只校验 baseUrl 与 model |
| 组件卸载时回调打到已销毁实例 | `onBeforeUnmount` 调用 `stopGenerate()` |

---

## 6. 验收清单

1. 未配置 AI → 提示并打开 AI 配置
2. 无暂存但有改动 → 回落工作区改动并提示
3. 流式：文字逐段出现；「停止」可中断且保留内容
4. 生成结果无围栏 / 引号，首行符合规范
5. 规范修改后保存 → 重启仍生效；规范预设切换、恢复默认可用
6. OpenAI / Anthropic / Gemini 三种协议流式可用；不支持时降级
