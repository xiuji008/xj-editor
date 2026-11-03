# 路线 B：内置终端接入真实 PTY（node-pty + xterm.js）改造方案

> 目标：把当前「管道 stdio + 自绘 HTML 行缓冲」的内置终端，换成「真实 PTY + 网格渲染」，
> 让 vim / less / tmux / Claude Code 等全屏 TUI 程序能在面板里正常运行。
> 约束：全过程可回滚、可灰度，任一阶段失败都能回到今天的版本。

---

## 0. 现状与目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 进程通道 | `child_process.spawn` + 管道 stdio（`electron/terminal.cjs:294`），无 TTY | node-pty（Windows ConPTY / Unix openpty） |
| 转义序列 | 只解析 SGR/J/K，其余忽略（`src/utils/terminal.ts:320`） | 完整 VT/ANSI（xterm.js） |
| 渲染 | 行式 HTML + `v-html`（`src/components/TerminalView.vue:669`） | xterm.js canvas/webgl 网格渲染 |
| 尺寸同步 | `resize()` 是空实现（`electron/terminal.cjs:446`） | PTY 真实 resize + FitAddon |
| 伪能力（可删） | 假提示符、`busy` 静默 300ms 判定、`resolveCd` 猜目录 | 由 shell 回显与 OSC 1337 接管 |

**验收标准（用户可自测，8 条）**

1. 面板内执行 `less README.md` / `vim` 能全屏并正常退出；
2. `python` / `node` REPL 交互正常，方向键、Ctrl+C 正常；
3. `ping -t 127.0.0.1` 后 Ctrl+C 能中断；
4. 拖拽面板高度 / 缩放窗口后列宽自适应，`echo $COLUMNS` 跟随变化；
5. 中文文件名、`dir` 输出不乱码（含 GB18030 场景）；
6. 关闭标签后任务管理器无残留 powershell / conhost；
7. 多窗口下输出不串台（现有 ownerId 机制保持）；
8. `npm run dist:dir` 打包安装后终端仍可用。

---

## 1. 总体策略：三阶段 + 双实现并存

关键决策：**不做就地重写**。新增一套并行实现，用开关切换，稳定后再删旧代码。

```
阶段 0  Spike      ── 打通 node-pty 构建（不过就没必要往下做）
阶段 1  主进程     ── 管道模式 / PTY 模式双实现共存，用开关切换（功能开关在 main.cjs）
阶段 2  渲染层     ── 新增 TerminalViewXterm.vue，与旧 TerminalView.vue 并存
阶段 3  功能对齐   ── 补全 / Ctrl+R / 历史面板在 xterm 上对齐
阶段 4  打包发版   ── 原生模块打包链路 + 灰度 + 清理旧代码
```

**开关设计（贯穿全程，也是回滚点）**

- 主进程：`terminal.cjs` 顶部 `const pty = loadPty()`，加载失败或 `TERMINAL_PTY=0` → 自动回退管道模式；
- 渲染进程：`winStore.getItem('md-terminal-render') === 'xterm'` 决定加载哪个 TerminalView；
- 两条开关互不耦合：可以「PTY + 旧渲染」「管道 + xterm」任意组合，便于二分定位问题。

---

## 2. 阶段 0：Spike（1 人天）—— 判定可行性

| 项 | 动作 | 结论/风险 |
|---|---|---|
| 依赖选型 | `node-pty@^1.0`（N-API，Windows 走 ConPTY）；备选社区预编译包 `@homebridge/node-pty-prebuilt-multiarch` | node-pty 无 Electron ABI 官方预编译，需 rebuild |
| 本地能编 | `npm i node-pty` → `npm i -D @electron/rebuild` → `npx electron-rebuild -v 33.4.11 -m .` | 需要 Python 3.10+ 与 VS Build Tools 2022（C++ 桌面负载） |
| Demo 验证 | 写一个最小 Electron demo：`pty.spawn('powershell.exe', [], {cols, rows})`，确认 `onData` 中文不乱码、`resize` 生效 | **这一步不过，路线 B 直接降级为路线 A（外部终端）** |
| 交付物 | 一份 3 行结论：能否编译 / 中文是否正常 / resize 是否生效 | — |

---

## 3. 阶段 1：主进程切换 PTY（1.5 人天）

### 3.1 `electron/terminal.cjs`

| # | 改动 | 说明 |
|---|---|---|
| 1 | 顶部新增 `loadPty()`：`try { return require('node-pty') } catch { return null }`，并读 `process.env.TERMINAL_PTY` | 失败一律回退现有管道实现，保证任何环境下不崩 |
| 2 | `start()`（`286-345`）改为双分支：`if (pty && ptyEnabled) {...} else {...}` | 返回的 session 结构、`ok/id/cwd/shellId/...` 字段**保持不变**，渲染层无感 |
| 3 | PTY 分支：`pty.spawn(shell.file, shell.args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true, encoding: 'utf8' })` | `useConpty: true`；`encoding` 决定 `onData` 拿到 string 还是 Buffer |
| 4 | 输出：`proc.onData(chunk => sendEvent('terminal:data',{id,data:chunk}))` | 单流，stdout/stderr 合并；现有 UTF-8→GB18030 回退逻辑（`236-258`）**不再适用**，建议：启动时对 PowerShell 注入 `-NoExit -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8"`、cmd 追加 `/K chcp 65001`，并保留 GB18030 兜底函数以防万一 |
| 5 | `resize()`（`446-448`）改为真实实现：`ptyProcess.resize(cols, rows)`；管道分支仍返回 `{ok:true}` | 会话需缓存 `lastCols/lastRows`，新建会话时要补发一次 |
| 6 | `write()`（`353-362`）：`ptyProcess.write(data)` | 语义不变 |
| 7 | `kill()`（`390-399`）：`ptyProcess.kill()`；Windows 保留 `taskkill /t /f` 兜底清理孙进程 | ConPTY 关闭后子进程可能残留 |
| 8 | `proc.onExit(({exitCode}) => ...)` 替换 `proc.on('exit')` | node-pty 的回调参数是对象 |
| 9 | `detectShells()`（`116-204`）参数适配 PTY | PowerShell 去掉 `-Command -`（PTY 下不再需要「逐行读 stdin」，且会产生二次回显）；`echoesPrompt`、假提示符相关字段可标记为废弃 |
| 10 | `complete()`（`641-670`）**不动** | 补全是纯文件系统逻辑，与 PTY 无关 |

### 3.2 其它主进程文件

| 文件 | 改动 |
|---|---|
| `electron/main.cjs` | IPC 声明（`2313/2323`）**不用改**；仅可选：在 `app.whenReady` 里读 `TERMINAL_PTY` 默认值；`killAll`（`2334`）不变 |
| `electron/preload.cjs` | **不改** |
| `src/env.d.ts` | `TerminalStartResult`（`227-241`）新增 `cols?: number; rows?: number`；`TerminalApi` 不变（`resize` 早已声明但从未被调用） |

### 回滚点 R1

> 提交点：`git commit -m "feat(terminal): 主进程支持 PTY（可用 TERMINAL_PTY=0 回退）"`
> 回滚：`TERMINAL_PTY=0` 重启即可，无需改代码；极端情况 `git revert` 该提交。

---

## 4. 阶段 2：渲染层换 xterm.js（2 人天）

### 4.1 依赖

```jsonc
// package.json dependencies
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0",
"@xterm/addon-web-links": "^0.11.0",
"@xterm/addon-canvas": "^0.7.0",        // 性能；WebGL 版按需
"@xterm/addon-unicode11": "^0.8.0"      // CJK / emoji 宽度
```

> CJK 宽度：中文文件名对齐依赖 unicode11 addon，加载后 `term.unicode.activeVersion = '11'`。

### 4.2 新增文件 `src/components/TerminalViewXterm.vue`（约 350 行）

职责清单：

1. **挂载**：`new Terminal({ fontFamily: "Consolas, 'Microsoft YaHei Mono', monospace", fontSize: 13, theme: 与 `#1e1e1e` 一致, allowProposedApi: true })`；
2. **输入**：`term.onData(data => window.mdAPI.terminal.write({ id, data }))`——**直接发原始字节**，不再 `+ eol`、不再本地回显；
3. **输出**：`mdAPI.terminal.onData` → `term.write(payload.data)`；
4. **尺寸**：`FitAddon`；`ResizeObserver` 观察容器 → `fit()` → `mdAPI.terminal.resize({id, cols, rows})`；`window.resize` 与面板拖拽也要触发；
5. **退出**：`onExit` → `term.write('\r\n[进程已退出]\r\n')`，emit exit；
6. **暴露给父组件**：`defineExpose({ fitToContainer, clearScreen, focusInput, writeToBuffer })`；
7. **补全与 Ctrl+R 的挂点**（阶段 3 实现）：用 `term.attachCustomKeyEventHandler(e => ...)` 拦截 Tab / Ctrl+R / Ctrl+D / Ctrl+L，阻止冒泡后自行处理；
8. **CSS**：`import '@xterm/xterm/css/xterm.css'`，主题色对齐现有 `.term-view`。

### 4.3 `src/components/TerminalPanel.vue`

| # | 改动 | 说明 |
|---|---|---|
| 1 | import 两个 TerminalView，按 `winStore.getItem('md-terminal-render')` 动态选择 | `const TerminalViewImpl = computed(() => renderMode.value === 'xterm' ? TerminalViewXterm : TerminalView)` |
| 2 | `TerminalViewExpose`（`34-39`）增加 `fitToContainer: () => void` | 旧组件实现为空函数即可 |
| 3 | 面板高度拖拽（`324`）与 `watch(() => props.visible)` 的回调里调用 `fitToContainer()` | xterm 必须显式 fit，否则列数不跟宽度走 |
| 4 | `createTerminal`（`86-115`）把 `res.cols/rows` 存进 session | 首帧尺寸同步 |
| 5 | 其余（会话/标签/右键菜单/高度记忆/`killOwn`）**全不动** | 面板层与渲染器解耦良好，这是本次改造成本最低的部分 |

### 4.4 旧代码处置

| 文件 | 处置 | 时机 |
|---|---|---|
| `src/utils/terminal.ts` | 保留；阶段 4 再删 `TerminalBuffer`（约 `-330` 行）与 `resolveCd` | 阶段 4 |
| `src/components/TerminalView.vue` | 保留并存；阶段 4 删除 | 阶段 4 |

### 回滚点 R2

> 提交点：`git commit -m "feat(terminal): 新增 xterm 渲染实现（可切换回行缓冲）"`
> 回滚：在终端面板的「回退到旧渲染」开关置 false（或直接删 `md-terminal-render` 这个 sessionStorage key）→ 立即回到旧实现。

---

## 5. 阶段 3：功能对齐（1.5 人天）

旧组件里有四项「自研能力」必须搬到 xterm 上，否则用户体验倒退。

| 能力 | 现状 | xterm 上的实现 | 风险 |
|---|---|---|---|
| Tab 补全浮层 | 主进程 `terminal:complete` 提供候选（`terminal.cjs:641`），渲染层自绘下拉 | `attachCustomKeyEventHandler` 拦截 Tab → 从 `term.buffer.active` 取当前行文本与 `cursorX` → 调同一个 IPC → 用 `term.write('\x1b[2K\r' + prompt + newValue)` 或直接 `term.paste(insert)` 重绘行 | 重绘行需要自己算提示符宽度；建议用 `term.input()` 发送增量字符而非整行重绘 |
| Ctrl+R 历史搜索 | 自绘浮层 + localStorage（`TerminalView.vue:406-469`） | 原样保留浮层结构，仅把「写入输入框」改为 `term.input(line)` / `term.paste(line)` | 低 |
| 命令历史持久化 | `loadCommandHistory/saveCommandHistory`（`utils/terminal.ts:23-45`） | **完全复用**（xterm 不提供跨会话历史持久化） | 无 |
| 清屏 / 中断 / 目录跟随 | Ctrl+L、Ctrl+C、`resolveCd` | Ctrl+L → `term.clear()`；Ctrl+C → 由 PTY 处理；`cd` 改为读 OSC 1337 `CurrentDir`（需 shell 侧注入配置），拿不到时回退 `resolveCd` | cmd 不支持 OSC，必须保留回退 |

> 顺序建议：先做历史面板与 Ctrl+R（低风险），再做 Tab 补全（高风险，单独一个 commit）。

### 回滚点 R3

> 三个独立提交：历史/Ctrl+R → Tab 补全 → OSC 目录跟随。任一提交单独 revert 不影响其它能力。

---

## 6. 阶段 4：打包与发版（1 人天）

| # | 动作 | 说明 |
|---|---|---|
| 1 | `devDependencies` 加 `@electron/rebuild`；`scripts` 加 `"rebuild": "electron-rebuild -f -w node-pty -v 33.4.11 -m ."` | 或交给 electron-builder 的 `npmRebuild`（默认开启）自动跑 |
| 2 | 构建机要求：Python 3.10+、VS Build Tools 2022（含 C++ 桌面开发） | **这是最大的落地成本**，需在 CI 文档写清 |
| 3 | `package.json` 的 `build.asarUnpack` 增加 `"**/node_modules/node-pty/**"` | `.node` 不在 asar 内才能被 require |
| 4 | 验证 `npm run dist:dir` → 安装到干净机器 → 打开终端（`npm run dist` 前务必先跑一次 `dist:dir`） | 签名场景需额外确认 `.node` 一起被签名（当前 `CSC_IDENTITY_AUTO_DISCOVERY=false`，若后续启用签名要复测） |
| 5 | 灰度：默认保留 10%~20% 用户用 xterm，其余回退，观察崩溃上报 | Electron 升级到 34+ 时必须重编 node-pty，成本已计入长期维护 |
| 6 | 稳定 2 周后：删 `TerminalView.vue`、`TerminalBuffer`、`resolveCd`（净减约 800 行） | 最终清理提交 |

### 回滚点 R4

> 发版前：`TERMINAL_PTY=0` + 关闭渲染开关 = 100% 回到今天的行为。
> 发版后：发现问题时先强制下发开关，再发修复版（不必撤回整个版本）。

---

## 7. 风险登记表

| 风险 | 影响 | 概率 | 对策 |
|---|---|---|---|
| node-pty 编译失败（缺 VS Build Tools / Python） | 阻塞全部 | 中 | 阶段 0 先验证；备选预编译包；最坏降级为「仅外部终端」 |
| Electron 版本升级需重编 | 每次升级 +0.5 天 | 高 | 固定 Electron 版本节奏，rebuild 入 CI |
| 中文/GB18030 乱码（PTY 后不再走自研解码回退） | 观感差 | 中 | 启动时统一 `chcp 65001` / `OutputEncoding=UTF8`，保留回退函数 |
| ConPTY 残留子进程 | 资源泄漏 | 中 | kill 时保留 `taskkill /t /f` |
| asar 打包后 `.node` 加载失败 | 打包版不可用 | 中 | `asarUnpack` + 干净机器实测 |
| Tab 补全在 grid 缓冲下的插入错位 | 功能倒退 | 中 | 单独 commit、可用「先不做 Tab 补全」的低配版上线 |
| 性能（大输出刷屏） | 卡顿 | 低 | 用 canvas/webgl addon，必要时开 `term.options.scrollback` 上限与 `fastScrollSensitivity` |

---

## 8. 工时与排期

| 阶段 | 工时 | 依赖 |
|---|---|---|
| 0 Spike | 1 人天 | — |
| 1 主进程 PTY | 1.5 人天 | 阶段 0 通过 |
| 2 xterm 渲染层 | 2 人天 | 阶段 1（可并行起步） |
| 3 功能对齐 | 1.5 人天 | 阶段 2 |
| 4 打包发版 | 1 人天 | 阶段 3 |
| 缓冲 | 1 人天 | — |
| **合计** | **约 8 人天（单人 1.5~2 周）** | |

## 9. 与「Ghostty」路线的关系

- 本路线不引入 libghostty；收益≈90%，成本≈**1/10**；
- 阶段 2 完成后，渲染层是可插拔的：未来若出现**成熟维护的 libghostty WASM 发行包**，只需新增第二个 `TerminalViewGhostty.vue`，主进程 PTY 与 IPC 完全复用，届时切换成本≈阶段 2 的量级，而不需要重做 PTY 与打包链路；
- 建议长期保持「渲染层可插拔」这条架构约束，不要再把业务逻辑写死进 `TerminalView`。
