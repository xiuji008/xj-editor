# 左侧目录树 Git 集成 —— 功能设计文档

> 适用模块：`markdown-desktop`（XJ-Editor / Markdown 桌面编辑器）
> 状态：**待确认**（确认后再进入编码）
> 版本：v1.0 ｜ 日期：2026-09-15

---

## 1. 背景与目标

### 1.1 现状

编辑器已具备完整的本地文件工作流：目录树浏览、多格式编辑、一键转 Markdown、AI 助手、图床等。
但**版本管理这一环是断的**——用户写完文档想提交、想看"这版和上版差在哪"、想找回三天前的内容，必须切到命令行或 SourceTree/TortoiseGit，上下文来回切换成本高。

同时，`markdown-desktop` 的目标用户是把整个文档目录（知识库）当工程在用的人，这类目录**大概率本身就是一个 Git 仓库**。

### 1.2 目标（一句话）

> **当左侧打开的目录是 Git 仓库时，在侧边栏内直接完成「看变更 → 暂存 → 提交 → 看差异 → 查历史」这条最短闭环，不离开编辑器。**

### 1.3 成功度量（离线应用，不埋点，以人工验收为准）

| 指标 | 目标值 |
| --- | --- |
| 提交一次文档改动所需操作步数 | ≤ 4 步（勾选文件 → 输入信息 → 提交） |
| 常见操作（status / diff / log）P95 响应 | < 1.5s（1000 文件以内仓库） |
| 打开 Git 仓库目录后，Git 面板正确识别率 | 100%（含子目录打开、worktree） |
| 非 Git 目录的干扰 | 0（完全不显示 Git 区域） |

### 1.4 非目标（明确不做，防止范围蔓延）

- 不做 **rebase / cherry-pick / 交互式变基 / 冲突三方合并**——复杂操作仍交给专业 Git GUI；
- 不做 **submodule 深度管理**；
- 不内置 Git 实现（不引入 `isomorphic-git` 这类纯 JS 实现，见 §4.1 选型）；
- 不做 **git 服务端 / 账号体系**（凭据交给系统 git 的 credential helper）。

---

## 2. 用户与场景

### 2.1 核心用户故事

| # | 用户故事 | 验收点 |
| --- | --- | --- |
| US1 | 作为写作者，打开一个已纳入 Git 的文档目录，我希望侧边栏自动出现 Git 面板，不需要任何配置 | 打开仓库目录 2s 内显示分支名与变更数 |
| US2 | 作为写作者，改完文档后我希望直接在这里提交，不必切窗口 | 勾选文件 → 填信息 → 提交成功，面板状态归零 |
| US3 | 作为写作者，提交前我想确认改了哪些内容 | 点击变更文件可看逐行 diff |
| US4 | 作为写作者，我想查某篇文档改过几次、每次改了什么 | 历史列表 + 选中提交查看该次 diff |
| US5 | 作为写作者，我只想提交部分文件 | 逐文件勾选暂存，未勾选的文件不进提交 |
| US6 | 作为使用者，打开的是普通目录（非仓库）时，我不希望看到无意义的 Git 区域 | Git 区域完全隐藏 |

### 2.2 典型流程（P0 主流程）

```
打开目录 → 检测是否 Git 仓库
   ├─ 否 → 侧边栏保持现状（目录树 + 最近目录）
   └─ 是 → 显示 Git 面板
             → 查看变更（工作区/暂存区分组，文件带状态角标）
             → 勾选要提交的文件（= 暂存）
             → 输入提交信息 → 提交
             → 状态刷新：变更清空，分支 HEAD 更新
   旁路：点击任一变更文件 → 差异弹窗；点击「历史」→ 提交历史弹窗
```

---

## 3. 功能范围与分期

### P0（本期交付）

| 能力 | 说明 |
| --- | --- |
| 仓库检测 | 打开目录后自动检测，支持在**仓库子目录**打开（向上回溯到仓库根） |
| 分支与同步状态 | 当前分支名、有无上游、`↑ahead / ↓behind` 数量 |
| 变更列表 | 分「已暂存 / 未暂存（含未跟踪）」两组，文件级状态角标 `M A D R ? !`，冲突 `U` 单列 |
| 暂存 / 取消暂存 | 逐文件勾选，支持全选组 |
| 提交 | 提交信息输入（多行）+ 提交按钮；提交前校验用户信息与未保存内容 |
| 差异查看 | 工作区 diff / 暂存区 diff / 指定提交 diff；内联 / 并排切换 |
| 历史记录 | 仓库历史（默认 200 条）与**单文件历史**（`--follow`），点击提交看 diff |
| 文件树状态徽标 | 目录树节点上显示该文件/目录的 Git 状态色标 |
| 右键菜单 Git 组 | 查看差异、查看此文件历史、还原此文件（P0 仅「还原」做二次确认，见风险 R5） |
| 刷新 | 手动刷新按钮 + 保存文件后自动刷新 + 窗口重新聚焦刷新 |

### P1（第二期，已交付）

| 能力 | 交付内容 |
| --- | --- |
| 分支管理 | 本地 / 远程分支列表（含上游与 ↑↓）、切换、新建并切换、删除（`-d` 失败可转 `-D`）；远程分支检出为同名本地分支并自动跟踪 |
| 远程同步 | 拉取（默认 `--no-edit`）、推送（无上游时询问是否 `-u`）、获取远程更新（`fetch --prune`）；远程操作 120s 超时 + `GIT_TERMINAL_PROMPT=0`（不弹交互式凭据框、不挂起），认证失败 / 非快进 / 无上游 / 网络不可达 / 冲突 等错误映射为中文可操作提示 |
| 储藏（stash） | 保存（可选含未跟踪 `-u`、支持说明）、列表、应用、弹出、删除（删除二次确认） |
| 忽略规则 | `.gitignore` 读写弹窗（规则计数、未保存提醒）；目录树右键「加入 .gitignore」（目录写 `/dir/`、文件写 `/file`，去重，已跟踪文件提示需 `git rm --cached`） |

**凭据策略**：不内置凭据输入与存储，依赖系统已配置的凭据（SSH agent / credential helper / 系统钥匙串）。远程操作关闭交互式提示，一旦认证失败即返回明确错误，不卡 UI。

仍未实现（留在 P2 / 待评估）：丢弃全部更改、提交作者配置引导、行级 blame、自动刷新开关、提交图可视化、冲突可视化解决。

### P2（远期）

冲突可视化解决、图形化提交图（graph）、标签管理、提交签名（GPG）。

---

## 4. 技术方案

### 4.1 选型：调用系统 Git（推荐）vs 内置纯 JS 实现

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| **A. 主进程 `child_process` 调用系统 `git.exe`**（推荐） | 零新增依赖；打包体积不变；功能与官方 Git 100% 一致；凭据/LFS/hook 全部复用用户既有配置 | 依赖用户机器安装 Git；需处理路径探测与编码 |
| B. 引入 `simple-git` | API 友好 | 本质仍是调 git 二进制，多一层依赖，可控性反而下降 |
| C. 引入 `isomorphic-git` | 不依赖本机 Git | 包体积 + 数 MB；大仓库性能差；push/pull 认证实现复杂；与特殊 `.git` 格式存在兼容风险 |

**结论：采用方案 A**，自研薄封装 `electron/git.cjs`。
理由：项目一贯 0 冗余依赖的风格（现有 `fileassoc.cjs` 已用 `execFile`，有先例）；Windows 上 Git 安装率在目标人群中接近 100%；且**降级路径清晰**——未检测到 Git 时给出明确提示 + 手动指定 `git.exe` 路径的入口。

### 4.2 架构

```
┌── 渲染进程（Vue 3） ─────────────────────────────────────────┐
│  App.vue                                                     │
│   ├─ GitPanel.vue          （侧边栏内嵌：分支/变更/提交）     │
│   ├─ GitDiffDialog.vue     （差异弹窗，内嵌 GitDiffViewer）   │
│   ├─ GitHistoryDialog.vue  （历史列表 + diff）                │
│   ├─ GitDiffViewer.vue     （diff 行模型渲染）                │
│   └─ utils/git.ts          （类型、状态色、diff 解析为行模型） │
└─────────────── window.mdAPI.git.* （contextBridge）───────────┘
                        │ ipcRenderer.invoke('git:*')
┌── 主进程（Electron） ────────────────────────────────────────┐
│  preload.cjs  新增 git 命名空间                               │
│  main.cjs     ipcMain.handle('git:*', ...) → 委托 git.cjs     │
│  git.cjs（新增）                                              │
│   ├─ resolveGit()  探测/缓存 git 可执行文件路径               │
│   ├─ runGit(args, cwd)  spawn 执行（无 shell、UTF-8、超时）    │
│   └─ detect/status/add/unstage/commit/diff/log/show/restore    │
│  配置：app.getPath('userData')/git-config.json（git 路径等）   │
└──────────────────────────────────────────────────────────────┘
```

**安全约束**
1. 渲染层**只能传语义参数**（如 `{ repoRoot, paths, message }`），主进程负责拼装 argv，杜绝命令注入；
2. 所有 `path` 参数必须落在 `repoRoot` 之内（解析后前缀校验），拒绝 `..` 穿越；
3. 用 `spawn` + 参数数组，**不使用 shell**；
4. 提交信息通过 **stdin** 传入（`git commit -F -`），避免转义与换行问题。

### 4.3 主进程 `git.cjs` 设计

**Git 可执行文件探测顺序**（结果缓存，失败可手动指定）

1. 用户在「Git 设置」中指定的路径（存 `git-config.json`）
2. `process.env.GIT_PATH`
3. PATH 中的 `git`（`execFile('git', ['--version'])` 校验）
4. Windows 常见安装位置：
   - `C:\Program Files\Git\cmd\git.exe`
   - `C:\Program Files\Git\bin\git.exe`
   - `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`

**统一执行参数**

```
git -c core.quotepath=false -c i18n.logOutputEncoding=UTF-8 <args>
```

- `core.quotepath=false`：中文文件名不再被转义成 `\344\275\240`；
- `maxBuffer: 10MB`，普通命令超时 **15s**（`push/pull` 预留 120s）；
- 输出统一按 UTF-8 解码；`code !== 0` 时返回 `{ ok:false, error }`，`error` 取 `stderr || stdout` 的首屏文本（截断 500 字）。

**命令映射表**

| 能力 | 命令（均在 `-C <repoRoot>` / cwd 下执行） |
| --- | --- |
| 检测仓库 | `git rev-parse --show-toplevel --is-inside-work-tree` → `{ isRepo, root }` |
| 状态 | `git status --porcelain=v1 -z -uall` + `git status -sb -uall`（首行取分支与 upstream）+ `git rev-list --left-right --count <upstream>...HEAD`（ahead/behind） |
| 暂存 | `git add -- <paths...>`；取消暂存：`git restore --staged -- <paths...>`（旧版 Git 回退 `git reset -q HEAD --`） |
| 提交 | `git commit -F -`（stdin 传信息，`--cleanup=whitespace`）；`--amend` 预留 |
| 差异 | 工作区 `git diff --no-color --no-ext-diff -U3 -- <p>`；暂存 `git diff --cached ...`；指定提交 `git show --no-color --no-ext-diff -U3 <sha> -- <p>` |
| 历史 | `git log --no-color --date=iso --pretty=format:%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%d -n 200 [--follow] -- [<p>]`（`\x1f` 分隔，规避提交信息中的分隔符冲突） |
| 还原（P0 保留） | `git restore -- <p>` / 旧版 `git checkout -- <p>` |
| Git 版本 | `git --version` |

**status 解析（porcelain v1 + `-z`）**

- 每条记录：`XY\0path\0`；`X`=暂存区状态，`Y`=工作区状态；
- 重命名 `R `/`C ` 后紧跟第二个路径（`orig\0new\0`）；
- 未跟踪 `??` 归入「未暂存」分组，角标 `?`；
- 冲突 `UU/AA/DD` 单独归入「冲突」分组，角标 `U`，且**禁止提交**（提交按钮置灰并提示）。

### 4.4 IPC 契约（`preload.cjs` 新增 `git` 命名空间）

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `git.detect(dirPath)` | `{ dirPath }` | `{ ok, isRepo, repoRoot?, gitAvailable, gitVersion?, error? }` |
| `git.status(repoRoot)` | `{ repoRoot }` | `{ ok, status: GitStatus }` |
| `git.add({ repoRoot, paths })` | | `{ ok, error? }` |
| `git.unstage({ repoRoot, paths })` | | `{ ok, error? }` |
| `git.commit({ repoRoot, message, amend? })` | | `{ ok, sha?, error? }` |
| `git.diff({ repoRoot, paths?, staged?, sha?, revRange? })` | | `{ ok, diff: string, truncated }` |
| `git.log({ repoRoot, path?, limit?, skip? })` | | `{ ok, commits: GitCommitInfo[] }` |
| `git.restore({ repoRoot, paths })` | | `{ ok, error? }` |
| `git.getConfig()` / `git.setConfig({ gitPath })` | | 用户级 Git 设置 |
| `git.checkAvailable()` | | `{ ok, available, version?, path? }` |

> `env.d.ts` 同步扩展 `MdAPI` 接口与下列类型（`GitStatus / GitFileChange / GitCommitInfo / GitDiffLine / GitDiffHunk`）。

### 4.5 前端类型（`src/utils/git.ts`）

```ts
/** 文件变更状态码（沿用 Git porcelain 语义） */
export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'

export interface GitFileChange {
  path: string          // 仓库内相对路径（正斜杠）
  name: string          // 文件名
  dir: string           // 所在目录（相对仓库根）
  status: GitStatusCode // 展示用状态（暂存优先取 X，否则取 Y）
  staged: boolean
  renamedFrom?: string
}

export interface GitStatus {
  repoRoot: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  conflicted: GitFileChange[]
  detached?: boolean
}

export interface GitCommitInfo {
  sha: string
  shortSha: string
  author: string
  email: string
  date: string
  message: string
  refs?: string         // (HEAD -> main, origin/main)
}

export interface GitDiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}
```

**状态色（与 VS Code 语义一致，贴合现有浅色主题）**

| 状态 | 含义 | 色值 | 显示 |
| --- | --- | --- | --- |
| `M` | 已修改 | `#e2c08d`（琥珀） | `M` |
| `A` / `?` | 新增 / 未跟踪 | `#81b88b`（绿） | `A` / `U` |
| `D` | 已删除 | `#c74e39`（红） | `D` |
| `R` | 重命名 | `#4d9de0`（蓝） | `R` |
| `U` | 冲突 | `#c74e39`（红，加粗） | `!` |

---

## 5. 交互设计

### 5.1 侧边栏布局（新增区域以 `【新增】` 标注）

```
┌ 侧边栏（260px，可拖动 180–480）────────────────┐
│ 📁 myhub                              ⟳  》   │  ← 现有 header
├───────────────────────────────────────────────┤
│ 目录树                                         │
│  ▾ backend                      M              │  ←【新增】状态角标
│    ▾ src                        A 2            │  ←【新增】目录聚合
│        main.ts                  M              │
│        note.md                  ?              │
├───────────────────────────────────────────────┤
│【新增】Git 面板（可折叠，高度可拖动）          │
│  ⎇ main  ↑2 ↓0                     ⟳  ⋯       │
│  ───────────────────────────────────────────  │
│  更改 (3)                                      │
│  ☑ 已暂存的更改 (1)              −             │
│      M  backend/src/main.ts                    │
│  ☐ 未暂存的更改 (2)              +             │
│      M  docs/guide.md                          │
│      ?  docs/note.md                           │
│  ┌─────────────────────────────────────────┐  │
│  │ 输入提交信息…（Ctrl+Enter 提交）          │  │
│  └─────────────────────────────────────────┘  │
│  [     提交     ]  [ 历史 ]                    │
├───────────────────────────────────────────────┤
│ 最近打开的目录                                 │
└───────────────────────────────────────────────┘
```

### 5.2 元素细则

| 元素 | 行为 |
| --- | --- |
| Git 头部 | 分支名（超长省略 + tooltip）；`↑ahead ↓behind` 仅在上游存在时显示；`⟳` 手动刷新；`⋯` 更多菜单（历史记录、刷新、在终端中打开、Git 设置） |
| 变更列表 | 分组标题带复选框（全选/取消全选该组）；行高 24px；文件名省略、路径 tooltip；**单击行 = 打开该文件；点击状态角标或右键 = 看 diff** |
| 提交框 | 多行输入，最近 10 条提交信息记忆（localStorage `md-git-messages`）；空信息时提交按钮禁用；`Ctrl+Enter` 提交 |
| 提交按钮 | 点击后：若当前编辑器有未保存改动 → 先弹确认「当前文件有未保存内容，是否保存后提交？」（**不静默写盘**）；存在冲突 → 禁用并提示；提交成功 → toast + 刷新状态；失败（如未配 `user.name/email`、hook 失败）→ 展示原始错误并给出修复建议 |
| 历史按钮 | 打开 `GitHistoryDialog`，默认展示仓库历史；从文件右键进入时自动带 `-- <file>` 与 `--follow` |
| 空状态 | 无变更时显示「当前没有更改」，不显示提交框（保持面板紧凑） |

### 5.3 目录树集成

- **文件节点**：文件名右侧显示状态角标（单字母，12px，按 §4.5 配色）；
- **目录节点**：显示其后代变更数量徽标（如 `2`），不展开也能看到"这个目录有东西变了"；
- **右键菜单新增 Git 分组**（仅当该文件属于当前仓库时显示）：
  ```
  ──────────────
  查看差异            （文件）
  查看此文件历史…      （文件，--follow）
  还原此文件…          （文件，二次确认）
  加入 .gitignore      （文件 / 目录，去重，已跟踪时提示需 git rm --cached）
  ```

### 5.4 入口与快捷键

| 入口 | 说明 |
| --- | --- |
| 工具栏新增 Git 按钮 | 图标需新增 `GitIcon.vue`（`@element-plus/icons-vue` 无 Git 图标，用内联 SVG）；点击切换 Git 面板显隐 |
| `Ctrl+Shift+G` | 同上 |
| 侧边栏 header | 仓库内时，在 `⟳` 左侧出现分支小标签，点击定位到 Git 面板 |

### 5.5 弹窗规格

| 弹窗 | 尺寸 | 内容 |
| --- | --- | --- |
| `GitDiffDialog` | 宽 900 / 高 640，可最大化 | 顶部：文件路径 + 变更类型 + 统计（`+12 −3`）；右上：内联 / 并排切换、复制 diff、字体大小；主体：`GitDiffViewer` 虚拟滚动 |
| `GitHistoryDialog` | 宽 880 / 高 620 | 左：提交列表（短 SHA、作者、相对时间、标题，支持加载更多与关键字过滤）；右：选中提交的 diff + 完整提交信息 |

---

## 6. 状态刷新策略

| 触发时机 | 行为 |
| --- | --- |
| 打开 / 切换目录 | 立即 `detect()` → 仓库则 `status()` |
| 手动 `⟳` | 强制刷新（清缓存） |
| 保存文件成功后 | 防抖 **800ms** 刷新 status |
| 窗口重新聚焦 | 距上次刷新 > 5s 才刷新 |
| 提交 / 暂存 / 还原后 | 立即局部刷新 |
| 定时轮询 | **P0 不做**（避免大仓库 CPU 占用），P1 做成可开关（默认 30s，仅当变更文件 < 2000） |

**大仓库保护**
- 变更列表 > 500 条：只渲染前 500 条并提示「仅显示前 500 项」；
- diff > 1MB 或 > 5000 行：截断并提示，提供「在外部工具中打开」；
- `log` 单页 200 条，滚动到底加载更多。

---

## 7. 异常与边界处理

| 场景 | 处理 |
| --- | --- |
| 未安装 Git | Git 面板不出现；首次打开仓库时弹一次提示「未检测到 Git，安装后重启本应用即可使用版本管理」，并提供「手动指定 git.exe」入口（写入 `git-config.json`） |
| 非 Git 目录 | 完全隐藏 Git 区域（不做灰色占位，避免噪音） |
| 打开的是仓库子目录 | 自动回溯到仓库根，变更路径按**仓库根**相对显示，标题提示仓库根路径 |
| 游离 HEAD / 未配置 `user.name` | 头部显示 `⎇ HEAD detached`；提交失败时给出具体 `git config` 命令建议 |
| 冲突状态 | 冲突分组红色高亮，提交按钮禁用，提示「请先解决冲突」 |
| 中文路径 / 文件名 | `core.quotepath=false` + `-z` 解析，避免八进制转义 |
| 文件在外部被修改 | 保存时已有外部变更提示逻辑，Git 状态随刷新同步，不做自动 commit |
| 超大二进制文件 | diff 时检测二进制，显示「二进制文件，无法显示差异」+ 大小信息 |
| 命令超时 / 被取消 | 显示错误 toast，允许重试；不阻塞 UI |

---

## 8. 性能与安全

- **不阻塞 UI**：所有 Git 操作在**主进程**执行（非渲染进程），渲染层只做 loading；
- **并发控制**：同一仓库的写操作（add/commit/restore）串行排队，避免 `.git/index.lock` 冲突；
- **路径校验**：所有 path 参数解析后必须位于 `repoRoot` 内；
- **无 shell**：`spawn` + 参数数组，杜绝注入；提交信息走 stdin；
- **无网络**：P0 不涉及任何网络操作（不 push/pull），符合「数据不出本机」的产品定位。

---

## 9. 验收标准（P0）

1. 打开一个 Git 仓库目录，2s 内侧边栏出现 Git 面板并显示正确分支名；
2. 打开非 Git 目录，Git 区域不出现，其它功能无回归；
3. 打开仓库的深层子目录，可正确识别到仓库根，路径展示正确；
4. 修改一个 md 文件并保存，变更列表在 1s 内出现该文件且角标为 `M`；
5. 勾选文件 → 该文件从「未暂存」移到「已暂存」；取消勾选可回退；
6. 填写提交信息 → 提交成功 → 变更清空、HEAD 更新、`git log` 中可见该提交；
7. 提交信息为空时提交按钮禁用；存在冲突时提交按钮禁用；
8. 点击变更文件可打开 diff 弹窗，内联/并排切换正常，新增/删除行高亮正确；
9. 中文文件名仓库：状态、diff、历史中文均正常显示，无乱码与八进制转义；
10. 历史弹窗：单文件历史（`--follow`）可追到重命名前的提交；点击提交显示对应 diff；
11. 目录树文件角标与目录聚合数量与 `git status` 一致；
12. 未安装 Git 的环境（或临时改名 PATH）：给出明确提示，应用不崩溃、不卡死；
13. 1000+ 文件仓库：status 与打开 diff 的 P95 响应 < 1.5s；
14. 现有功能（目录树、编辑、保存、最近目录、暂存区）无回归。

---

## 10. 影响面与改动清单（预估）

| 文件 | 改动 |
| --- | --- |
| `electron/git.cjs` | **新增**，约 350 行：探测、执行、状态解析、各命令封装 |
| `electron/main.cjs` | 新增 `git:*` IPC 路由 + `git-config.json` 读写（约 60 行） |
| `electron/preload.cjs` | 新增 `git` 命名空间（约 25 行） |
| `src/env.d.ts` | 新增 Git 类型与 `MdAPI.git` 声明（约 60 行） |
| `src/utils/git.ts` | **新增**，类型复用 + 状态色映射 + diff 文本解析为行模型（约 200 行） |
| `src/components/GitPanel.vue` | **新增**（约 350 行） |
| `src/components/GitDiffViewer.vue` | **新增**（约 180 行） |
| `src/components/GitDiffDialog.vue` | **新增**（约 120 行） |
| `src/components/GitHistoryDialog.vue` | **新增**（约 220 行） |
| `src/components/GitIcon.vue` | **新增**，内联 SVG Git 图标（约 10 行） |
| `src/App.vue` | **小改**：引入组件、仓库/状态 ref、watch 刷新、工具栏按钮、树节点角标、右键 Git 分组、快捷键（约 +120 行） |
| `README.md` | 补充「版本管理（Git）」章节与快捷键 `Ctrl+Shift+G` |

**工作量预估**：约 **6–7 人日**（主进程 1.5d / 桥接与类型 0.5d / 面板 1.5d / diff 1d / 历史 1d / App 集成与联调 1d）。

---

## 11. 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | 用户机器未装 Git | 功能不可用 | 手动指定 `git.exe` 路径 + 安装指引；功能降级而非报错 |
| R2 | 中文路径 / 提交信息乱码 | 显示错误 | `core.quotepath=false`、`i18n.logOutputEncoding=UTF-8`、UTF-8 解码、提交信息走 stdin |
| R3 | 大仓库 status/diff 卡顿 | 体验差 | 截断 + 分页 + loading；P1 加自动刷新开关 |
| R4 | `index.lock` 并发冲突 | 操作失败 | 写操作串行队列 + 明确错误提示 |
| R5 | 「还原文件」不可逆 | **数据丢失** | 二次确认 + 红字提示「此操作将丢弃未提交的修改，不可恢复」；P0 默认开放但强提示（也可选择 P0 先隐藏，见 Q4） |
| R6 | Git 版本差异（`restore` 需 2.23+） | 老版本报错 | 检测版本，低于 2.23 回退到 `git checkout --` / `git reset HEAD --` |
| R7 | `App.vue` 已 2382 行，改动引入回归 | 稳定性 | 逻辑一律下沉到新组件，`App.vue` 只做挂载与事件转发 |

---

## 12. 待确认决策点（请逐项确认或调整）

| # | 问题 | 建议默认 |
| --- | --- | --- |
| **Q1** | Git 实现方式：**调用系统 git.exe**（推荐，0 依赖）还是内置纯 JS 实现？ | 调用系统 git |
| **Q2** | P0 是否需要 **推送 / 拉取**？（涉及凭据，建议 P1） | P0 不含，仅展示 `↑↓` 落后/领先数 |
| **Q3** | Git 面板位置：**侧边栏内嵌可折叠**（推荐，与目录树同屏）还是独立底部面板？ | 侧边栏内嵌，位于目录树与最近目录之间 |
| **Q4** | P0 是否开放「还原文件 / 丢弃更改」这类**不可逆**操作？ | P0 开放「还原文件」但强二次确认；「丢弃全部更改」放 P1 |
| **Q5** | diff 默认展示方式：**内联** 还是 **并排**？ | 默认内联（窄屏友好），可切换并排 |
| **Q6** | 目录树是否仍隐藏 `.git` 目录？ | 是，保持现有隐藏文件过滤不变 |
| **Q7** | 非 Git 目录是否需要任何提示？ | 否，完全静默 |
| **Q8** | 是否需要定时自动刷新？ | P0 不做（手动 + 保存后 + 聚焦时刷新），P1 加开关 |
| **Q9** | 快捷键 `Ctrl+Shift+G` 是否与现有冲突？ | 无冲突（现有为 Ctrl+N/O/S/F/H/Z/Y、Ctrl+Shift+O/S/T、F3、F12） |

---

## 13. 后续（P2 预告，尚未实现）

丢弃全部更改、提交作者配置引导、行级 blame、自动刷新开关、提交图可视化、冲突可视化解决、标签管理、GPG 签名。
