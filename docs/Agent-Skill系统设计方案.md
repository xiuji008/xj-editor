# xj-editor Agent Skill 体系 · 设计方案（v1.1 定稿）

> 状态：定稿待开发（未开始编码）
> 日期：2026-11-13
> 适用版本：xj-editor 1.0.0（Electron 33 + Vue 3 + Vite 6）

---

## 一、目标

在 xj-editor 内建立一个 **Agent Skill 体系**：

1. skill 以「目录 + `SKILL.md`」的形式存在（与 Claude Code 的 Agent Skills 生态格式兼容），可以随应用内置，也可以放进任意 workspace；
2. 应用内嵌 agent 运行时，让 skill 真正被 AI 调用起来（含多步工具调用），而不是只做提示词注入；
3. 首个落地 skill：`excalidraw-diagram` —— 在白板里「一句话 → 可编辑的 Excalidraw 图」（流程图 / 架构图 / 时序图 / 泳道图 / 思维导图）；
4. 全链路可观测：请求日志、思考过程、工具调用、skill 归属全部落盘可查。

**非目标（本期不做）**：skill 市场、脚本沙箱执行、多 skill 编排、生成式图像画图、第二引擎（Claude Agent SDK）。

---

## 二、决策记录（已拍板）

| # | 决策项 | 结论 |
|---|---|---|
| 1 | Agent 运行时 | **内嵌 Vercel AI SDK v5**（`ai` + provider 包 + `zod`）。新增 `electron/agent.cjs`，与现有 `ai.cjs`（普通对话/快捷动作）并存互不影响 |
| 2 | 第二引擎 | **不做**。不定义抽象接口、不留占位实现。未来确有需求时再评估，届时重构面仅限 `agent.cjs` |
| 3 | 弱模型兜底 | **P0 不做** JSON 协议兜底 loop；模型不支持工具调用时直接明确报错 |
| 4 | Skill 存放 | **每个打开的目录即一个 workspace，可写 skill 装在 `<workspace>/.xj/skills/`**；应用内置 skill 为只读兜底；取消 `userData/skills` |
| 5 | 可观测性 | 复用 `aiLogger.cjs` 体系扩展：每步一条记录（`runId` 串联），新增 skill 归属、工具调用、思考过程字段 |

---

## 三、现状基础（为何这样设计）

| 能力 | 现状 | 结论 |
|---|---|---|
| AI 调用 | `src/utils/ai.ts:152` `aiChatStream(provider, messages, handlers, temperature, scene)`，经 IPC 到主进程 `electron/ai.cjs`，支持 openai / anthropic / gemini 三种协议，system 角色已支持 | 协议层成熟；但 `buildRequest`（`electron/ai.cjs:105-167`）只发 `model/messages/temperature/stream`，**无 tools / function calling，也无 agent loop** → 由 AI SDK 在新通道补齐，不动现有链路 |
| 白板 | `WhiteboardView.vue` 只接 `onChange`，未接收 `excalidrawAPI`；`ExcalidrawApiLike` 只声明 `getAppState/scrollToContent`（`src/components/whiteboard/excalidrawBridge.ts:32-35`）；`defineExpose` 只有 `saveNow`（`WhiteboardView.vue:180`） | 核心缺口，补 `getSceneElements / updateScene` + 实例句柄即可写入画布 |
| 关键依赖 | `@excalidraw/excalidraw` 0.18.1 已导出 **`convertToExcalidrawElements`**（skeleton → 完整 element，自动处理 text 容器绑定、`boundElements`、`seed/versionNonce` 等） | **不需要让模型手写 Excalidraw element JSON**，这是方案成立的关键 |
| IO 能力 | `mdAPI.readDir/readFile/saveFile/writeBinary/statPath` 齐备 | skill 目录扫描无 IO 障碍 |
| 日志 | `electron/aiLogger.cjs`：按月落盘 `{userData}/ai-logs/`、密钥脱敏、图片不落盘、token 统计、`AiLogDialog` 查询界面 | 可观测性基座现成，按需扩展字段 |

---

## 四、workspace 与 Skill 目录

### 4.1 两级来源（同名时 workspace 覆盖内置）

| 来源 | 路径 | 读写 | 说明 |
|---|---|---|---|
| workspace | `<当前打开目录>/.xj/skills/<name>/` | 可写 | 用户安装/编辑/删除的唯一目标；`.xj/skills` 在首次导入时懒创建 |
| 内置 | dev：`<项目>/skills/`；打包后：`process.resourcesPath/skills/` | 只读 | 随应用发布 `excalidraw-diagram`，空白 workspace 开箱可用 |

- `.xj` 是 workspace 级配置根，P0 只用 `.xj/skills`；`.xj/ai-config.json`（workspace 级厂商覆盖）等是后续自然扩展点，本期不做。
- workspace 根 = 当前窗口打开的目录树根（渲染进程已有），由渲染进程随每个请求传入 `workspaceRoot`，主进程不猜测。
- 多窗口 = 多 workspace：skill 列表、agent 运行、工具调用都按窗口隔离（见 6.3）。
- **兼容预留**（只识别不承诺）：扫描时若发现 `<workspace>/.claude/skills/<name>/SKILL.md`，以只读方式列出并标注「来自 .claude（只读，导入后生效）」，点击导入即复制到 `.xj/skills`。不自动加载执行。

### 4.2 skill 包结构

```
<workspace>/.xj/skills/excalidraw-diagram/
├─ SKILL.md              # frontmatter: name/description/version/allowed-tools/targets
├─ references/*.md       # 渐进披露：模型通过 skill_read_reference 按需读取
└─ scripts/*.mjs         # P0 不执行（保留位置，UI 标注「脚本未启用」）
```

frontmatter 解析自研约 30 行（只支持 `key: value` 与 `key: [a, b]` 两种形态），不引 yaml 依赖。

---

## 五、总体架构

```
渲染进程（每窗口 = 每 workspace）                     主进程
┌──────────────────────────────┐          ┌─────────────────────────────────┐
│ WhiteboardAiPanel            │          │ agent.cjs（唯一 agent 链路）      │
│  输入 → AgentClient.run()    │  IPC     │  ├─ createModel(provider)        │
│ WhiteboardView               │ ───────► │  ├─ TOOLS（zod schema+execute）   │
│  apiRef / applyScene / undo  │          │  ├─ streamText 循环（多步工具调用）│
│ ToolBridge（工具执行器）       │ ◄─────── │  └─ runId→webContents 映射       │
│  wb:getScene / wb:apply      │  反向IPC  │  skills.cjs                     │
│ skillLoader.ts               │          │   ├─ skills:list(workspace)     │
│  扫描 .xj/skills + 内置       │          │   ├─ skills:get / readResource  │
│ sceneCompiler.ts             │          │   └─ skills:import → .xj/skills │
│  DSL→skeleton→convertToEx…   │          │  aiLogger.cjs（扩展字段）         │
└──────────────────────────────┘          └─────────────────────────────────┘
```

**核心取舍：模型输出 DSL，不输出 Excalidraw JSON。**

| 方案 | token/中等图 | 失败率 | 说明 |
|---|---|---|---|
| 模型直出完整 element JSON | 6k–15k | 高（缺 `versionNonce/seed/boundElements/containerId`，箭头绑定易错） | 每次都要重算坐标 |
| 模型直出 skeleton JSON | 3k–8k | 中（仍需自己算 x/y、文本换行） | — |
| **模型出 DSL，本地编译（采用）** | **0.8k–2.5k** | 低 | 坐标/绑定/换行全本地算，排版可复现、可单测 |

---

## 六、运行时设计

### 6.1 `electron/agent.cjs` 职责（单文件）

```
agent.cjs
├─ createModel(provider)        // format → openai / anthropic / google / openai-compatible 工厂
├─ TOOLS                        // 工具表：zod inputSchema + execute（反向 IPC 到发起窗口）
├─ runAgent(req)                // streamText + stopWhen: stepCountIs(maxSteps)
│                               // fullStream → agent:event（text-delta / reasoning-delta / tool-* / finish）
└─ runId → { webContents } 映射 // stop / 窗口销毁清理
```

- provider 工厂映射：`format==='openai' → createOpenAI({baseURL, apiKey})`；`'anthropic' → createAnthropic(...)`；`'gemini' → createGoogleGenerativeAI(...)`；自定义厂商 / Ollama → `createOpenAICompatible({ baseURL, apiKey? })`。
- `toolSupport === false` 的厂商（`ai-config.json` 新增布尔字段，默认 true）：`runAgent` 入口直接报错「当前厂商/模型不支持工具调用，请在 AI 配置中选择支持 tools 的模型」，不降级（决策 #3）。
- `runAgent` 前置校验：skill 的 `allowed-tools` ∩ 已注册工具的交集才注入 system prompt 与 tools 参数。

### 6.2 IPC 设计

**skill 管理**

| channel | 入参 | 返回 |
|---|---|---|
| `skills:list` | `{ workspaceRoot }` | `{ builtin: SkillMeta[], workspace: SkillMeta[], claudeCompat?: SkillMeta[] }` |
| `skills:get` | `{ source, rootPath }` | `{ meta, body, resources[] }` |
| `skills:readResource` | `{ rootPath, relPath }` | `{ content }`（**resolve 后必须 startsWith(rootPath)，防穿越**） |
| `skills:import` | `{ workspaceRoot, fromPath }` | 复制目录到 `<workspace>/.xj/skills/<name>`（重名询问覆盖） |
| `skills:remove` | `{ rootPath }` | 仅允许删除 `.xj/skills` 内 |
| `skills:reveal` | `{ rootPath }` | `shell.openPath` |

**agent 运行**

| channel | 方向 | 说明 |
|---|---|---|
| `agent:run` | R→M | `{ runId, provider, system, messages, tools: [{name,description}], maxSteps }`。工具的 zod schema 与 execute 留在主进程，渲染进程只传工具名，避免序列化函数 |
| `agent:event` | M→R | `{ runId, type: 'text-delta'\|'reasoning-delta'\|'tool-start'\|'tool-result'\|'done'\|'error', … }` |
| `agent:stop` | R→M | 中断（AI SDK stream abort） |

### 6.3 工具反向调用（主进程 → 发起运行的窗口）

- 主进程维护 `runId → { webContents, pendingCalls }`；`tool.execute` 时 `webContents.send('agent:tool-call', { runId, callId, name, args })`；
- 渲染进程 `ToolBridge`（`useAgentToolBridge.ts`）监听，按 name 分发到 `WhiteboardView` 暴露的方法，经 `agent:tool-result` 回传 `{ callId, ok, data|error }`；
- 超时 30s 视为失败并把错误回灌给模型（模型可自行重试/改道）；窗口已关闭 → 立即 fail 并清理映射。

**P0 内置工具**

| 工具 | 输入 schema（zod） | 行为 |
|---|---|---|
| `whiteboard_get_scene` | `{}` | 返回 `{ elementCount, typeCounts, selected:[{id,type,text}], viewport }`（不给全量 JSON，省 token） |
| `whiteboard_apply_elements` | `CanvasSpecZod`（DSL） | 编译并 `updateScene`（append 默认放现有内容右下方避让 / replace），返回 `{ applied: n, bbox }` |
| `skill_read_reference` | `{ name }` | 读 skill `references/` 下文件（路径白名单），返回文本 |

### 6.4 渐进式披露（省 token）

| 阶段 | 加载内容 | 约 token |
|---|---|---|
| 列表 | `name + description` | ~50/个 |
| 选中 skill | SKILL.md body（去 frontmatter） | 1–3k |
| 执行中按需 | `references/*.md`（模型调 `skill_read_reference` 才读） | 每次 ≤2k |

不做「所有 skill 全塞 system prompt」。

---

## 七、白板接入

### 7.1 三个必须补的缺口

1. **扩展 API 类型**（`excalidrawBridge.ts:32`）：`ExcalidrawApiLike` 增 `getSceneElements(): readonly unknown[]`、`updateScene(scene): void`；
2. **接住实例**（`WhiteboardView.vue:123` `mountScene`）：传 `excalidrawAPI: (api) => { apiRef = api }`（`handle.update()` 重渲时回调自然刷新，无需特殊处理）；
3. **暴露写入能力**（`WhiteboardView.vue:180`）：

```ts
defineExpose({
  saveNow,
  applyScene(spec, mode = 'append'),   // 编译 + updateScene + 立即 saveNow
  getSceneSummary(),                   // {counts, selected, viewport}
  undoLastApply(),                     // 自维护快照栈（≤10），不依赖 Excalidraw 内建 history
})
```

`applyScene` 用 `convertToExcalidrawElements(compiled, { regenerateIds: true })`；追加时与新元素做包围盒避让（新图放现有内容右下方 + 80px），然后 `api.updateScene({ elements: next, appState: { scrollToContent: true } })`。

### 7.2 UI：白板专用轻面板

- 位置：`WhiteboardView.vue` 右上角现有 `.wb-export`（`:15-27`）左侧加「AI 画图」按钮（`top:48px; right:96px`），不碰 Excalidraw 工具栏；
- 面板：新组件 `WhiteboardAiPanel.vue`，`position:absolute; right:0; top:0; bottom:0; width:360px` 覆盖抽屉，不挤压画布；
- 内容：描述输入（可粘贴 Markdown 大纲）、布局下拉（自动/流程/架构/时序/泳道/思维导图）、风格（简约/彩色/手绘感）、流式过程（含工具进度与 reasoning 折叠区）、`exportToSvg` 缩略预览、**插入 / 替换 / 重新生成 / 撤销上次插入**；
- 有选中元素时自动进入「改造选中」模式：上下文只传选中元素的 `{id,type,text}`，不是全量 JSON。

### 7.3 编译链（`src/utils/excalidraw/sceneCompiler.ts`，纯函数，可单测）

```
CanvasSpec DSL → 校验（id 唯一 / 边端点存在 / 数量上限）
             → layout（flow-v / flow-h 分层+Barycenter 排序；swimlane 泳道；sequence 等距列；mindmap 放射）
             → measure（canvas.measureText，14px，CJK 1 字宽 ≈ fontSize；自动插 \n 换行）
             → skeleton[]（rect/label 由 convertToExcalidrawElements 自动拆 text，arrow 用 start/end 引用 id）
             → convertToExcalidrawElements(skeleton, { regenerateIds: true })
             → updateScene
```

约 350 行，预计 `specSchema.ts` + `layout.ts` + `sceneCompiler.ts` 三文件。

---

## 八、`excalidraw-diagram` 内置 skill 内容

`skills/excalidraw-diagram/`（随包发布）：

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 触发条件、5 种 layout 选型规则、输出协议（调用 `whiteboard_apply_elements`，不写文件）、检查清单（id 唯一 / 边端点存在 / 上限） |
| `references/layout-recipes.md` | 每种图的节点/边组织范式 + 好例子 |
| `references/style-tokens.md` | `tone → 配色/线型` 映射（professional / hand-drawn / mono） |
| `references/canvas-spec.md` | DSL 全字段说明 |

**DSL（CanvasSpec）示例与约束：**

```json
{
  "layout": "flow-v",
  "theme": "professional",
  "title": "采购审批流程",
  "groups": [{ "id": "g1", "label": "财务环节", "children": ["n3", "n4"] }],
  "nodes": [
    { "id": "n1", "label": "提交申请", "shape": "rounded", "tone": "start" },
    { "id": "n2", "label": "主管审批", "sub": "≤ 2 天", "shape": "rect" },
    { "id": "n3", "label": "金额 > 5 万？", "shape": "diamond" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "提交" },
    { "from": "n3", "to": "n4", "kind": "dashed" }
  ]
}
```

约束写进 SKILL.md：节点 ≤ 40、边 ≤ 80、分组只允许一层、label ≤ 18 字；超出时输出「建议拆成 N 张图」而不是硬画。

**工具契约注入**（宿主动态拼接在 skill body 之后，skill 本体保持宿主无关——这也是复用 Claude Code 生态 skill 的前提）：

```
【本环境适配】不要写文件、不要输出 JSON 给用户。调用 whiteboard_apply_elements 工具，
把 spec 直接画到当前白板；画布已有 N 个元素（…分布…），新图自动避让。
```

---

## 九、可观测性：请求日志 / 思考过程 / 工具调用 / skill 记录

复用 `aiLogger.cjs`（按月落盘 `{userData}/ai-logs/ai-log-YYYY-MM.json`，3000 条/月，密钥脱敏，图片不落盘，写入队列 + 临时文件防半截 JSON），`scene` 分类轴自动接入列表过滤与 byScene 统计（`AI_SCENE_LABELS` 加 `skill: '技能调用'`，`AiLogScene` 加 `'skill'`）。

**记录粒度**：一条 agent 运行 = 多步请求；用 AI SDK 的 `onStepFinish` 回调（每步给 `text / toolCalls / toolResults / usage / finishReason`），**每步一条记录，共享 `runId`，新增 `step` 序号**。每步输入快照含前序工具结果（截断），可还原「模型看到什么才调这个工具」。

**record 新增字段（纯增量，旧记录兼容）：**

```js
{
  runId: 'run-…',                       // 同一次 agent 运行共享
  step: 1,                              // 步序号；普通单次调用无此字段
  skill: { id, name, source } | null,   // 触发的 skill；非 skill 场景为 null
  tools: [                              // 本步工具调用（onStepFinish.toolCalls/toolResults）
    {
      name: 'whiteboard_apply_elements',
      ok: true,
      elapsedMs: 320,                   // agent.cjs 计时（含反向 IPC 往返）
      argsChars: 1240, argsSnippet: '…（CanvasSpec，截 2000 字）',
      resultChars: 60,  resultSnippet: '{"applied":9,"bbox":…}',
      error: '',
    },
  ],
  response: {
    …,
    thinking: '…（思考过程，截 4000 字，无则空）',
  },
}
```

**思考过程**：`fullStream` 的 `reasoning-delta` 块单独累积（DeepSeek-R1 / o 系列 / Gemini thinking / Claude extended thinking 会吐）；流式时在面板折叠区展示（默认收起）；结束后写 `response.thinking`；模型不吐则为空。

**UI 增量**：
- `AiLogDialog` 列表：scene 徽标自动多出「技能调用」；有 `skill.name` 的行加来源角标（内置/工作区）；P0 详情显示 `runId` 文本，P1 做按 runId 分组视图；
- 详情弹窗：新增「工具调用」表格区块（名称/耗时/ok/args 与结果摘要，可展开全文）与「思考过程」折叠区块。

**如实说明的差异**：现有 `request.url/headers` 来自手写 fetch 的 `buildRequest`；AI SDK 内部管理 HTTP 细节，agent 日志的 `request` 区块改为 `model / temperature / maxSteps / tools（名称列表）`，`headers` 留空。密钥零落盘，安全性更好。

---

## 十、设置页与安全

- 设置新增「技能」分类（`SettingsDialog.vue` categories 加一项 → `settings/SkillsPanel.vue`）：
  - 顶部显示**当前 workspace 路径**；
  - workspace 列表（可管理：启用/停用/打开目录/删除/从文件夹导入/重新扫描）；
  - 内置列表（只读）；
  - P0 手动「重新扫描」，P1 加 fs.watch 热更新。
- 安全清单：
  - `skills:readResource` 路径穿越防护（resolve + startsWith）；
  - skill 只能调用其 `allowed-tools` ∩ 已注册工具；
  - **P0 不执行 skill 自带 scripts**，面板对含 scripts 的 skill 标注「脚本未启用」；
  - skill 不引入网络请求，密钥只走应用 AI 配置。

---

## 十一、打包

- `package.json build.extraResources` 增 `{ from: 'skills', to: 'skills' }`（`files` 不含它，避免进 asar 后路径不可控）；
- 内置根路径解析：`app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'skills')`；
- `.xj/skills` 在 workspace 内，与打包无关；确认 afterPack 脚本不受影响。

---

## 十二、实施清单（P0，估 3.5 人日）

| 模块 | 文件 | 内容 |
|---|---|---|
| 引擎层 | `electron/agent.cjs` | 决策 #1/#3 落点：provider 工厂 + streamText 循环 + 工具表 + 反向 IPC + onStepFinish 日志 |
| 依赖 | `package.json` | `ai`、`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`、`zod`；`extraResources` |
| Skill | `electron/skills.cjs`、`src/utils/skills.ts` | workspace/内置两级扫描 + frontmatter 解析 |
| 编译器 | `src/utils/excalidraw/specSchema.ts`、`layout.ts`、`sceneCompiler.ts` | DSL→elements（纯函数，可单测） |
| 白板 | `excalidrawBridge.ts`、`WhiteboardView.vue` | apiRef + applyScene/getSceneSummary/undoLastApply + 按钮 |
| UI | `WhiteboardAiPanel.vue`、`src/composables/useAgentToolBridge.ts` | 面板 + 反向 IPC 分发 + reasoning 折叠展示 |
| 设置 | `SettingsDialog.vue`（+1 行）、`settings/SkillsPanel.vue` | workspace 技能管理 |
| 日志 | `electron/aiLogger.cjs`、`AiLogDialog.vue` | runId/step/skill/tools/thinking 字段 + 展示 |
| 杂项 | `env.d.ts`（mdAPI/类型）、`src/utils/ai.ts`、`AiConfigPanel.vue`（toolSupport 开关） | `skill` 场景、类型声明 |
| skill 包 | `skills/excalidraw-diagram/`（4 个文件） | 内置内容 |
| 文档 | `CHANGELOG.md` | 记录本次改造 |

### P1（≈2 天）
fs.watch 热更新、AiPanel skill 下拉（markdown 场景）、`/skill` 显式触发、选中元素改造、```whiteboard 代码块生成、按 runId 分组日志视图。

### P2（≈3 天）
MCP server 对外暴露白板（让外部 Claude Code 等 agent 也能画到本应用白板）、skill 运行历史与可回放、（视需求）Claude Agent SDK 第二引擎评估。

---

## 十三、验证方案（开发完成后执行）

1. `npx vue-tsc --noEmit`（关注是否引入新错）+ espree 校验新增 ts/vue 的 script；
2. `npm run dev:electron`（dev 下内置根 = 项目 `skills/`，无需打包即可测）；
3. 端到端（用现有 AI 配置）：新建 `.board` → AI 画图 → 输入「画一个三步审批流程图」→ 流式过程可见（含工具调用与思考折叠）→ 预览缩略图 → 插入 → 撤销 → 替换 → Ctrl+S 落盘 → 重开文件验证；
4. 日志：AI 调用日志中出现 `scene=技能调用` 记录，详情含 skill 名称、每步工具调用、thinking；一次运行的多条记录 `runId` 一致；
5. 边界：空画布插入定位、有内容时避让、中文长 label 换行、节点超 40 的拒绝话术、不支持 tools 的厂商报错文案、`skills:readResource` 传 `../` 被拒、窗口中途关闭 run 清理；
6. 打包验证：`extraResources` 后 `process.resourcesPath/skills` 可扫描。

---

## 十四、遗留风险（已知、可接受）

| 风险 | 处置 |
|---|---|
| `ai` v5 在 CJS 主进程（`main.cjs`）的模块格式待实测 | **P0 开工第一件事验证**。预案：`await import('ai')` 动态加载，或主进程入口迁 `.mjs`（Electron 28+ 支持） |
| AI SDK 版本迭代快 | 锁定 minor 版本；agent 链路集中在 `agent.cjs` 单文件，升级影响面可控 |
| gpt-4o-mini 等小模型 tool calling 质量一般 | zod schema 严格校验 + 工具错误回灌（AI SDK 自带）；**预览确认后才落画布**，坏结果不污染文件 |
| 中文字宽估算偏差导致文字溢出框 | `canvas.measureText` 精确测 + 行高 1.25 + 框宽按行数回填（先测后定宽） |
| Excalidraw 升级破坏兼容 | 只用 `convertToExcalidrawElements` 公开 API，不手写 element 内部字段 |
| workspace 关闭时 agent 运行中 | `runId → webContents` 映射监听销毁事件，立即 fail 并记日志 |
| skill 无 skills 市场质量参差 | `allowed-tools` 白名单 + 只读导入流程兜底；脚本执行 P0 关闭 |
