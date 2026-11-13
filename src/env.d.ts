/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** pako（PlantUML 编码用，无内置类型声明） */
declare module 'pako' {
  const pako: {
    deflate(data: Uint8Array, options?: { level?: number }): Uint8Array
    deflateRaw(data: Uint8Array, options?: { level?: number }): Uint8Array
  }
  export default pako
}

/** 目录项 */
interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  ext: string
  size: number
  mtime: number
}

/** 目录搜索命中项 */
interface DirSearchHit {
  name: string
  path: string
  isDirectory: boolean
  ext: string
  /** 文件名是否包含关键字 */
  nameMatch: boolean
  /** 文件内容命中次数（目录恒为 0） */
  contentMatches: number
  /** 内容命中位置的上下文片段（用于悬浮提示） */
  snippet: string
}

/** 图片导入结果 */
interface ImageImportResult {
  sourcePath: string
  targetPath: string
  fileName: string
}

interface MdAPI {
  /** 当前窗口 id（主进程分配，首个主窗口为 1；非桌面环境为 0） */
  windowId: number
  /** 窗口初始上下文：新建窗口时带上发起窗口的目录 / 文件；slot 为跨重启稳定的工作区槽位号 */
  windowInit: { id: number; slot: number; dir: string; file: string }
  // 多窗口：新建窗口 / 在新窗口打开文件
  newWindow: (payload?: { dirPath?: string }) => Promise<{ ok: boolean; id?: number; error?: string }>
  openInNewWindow: (payload: {
    filePath: string
    dirPath?: string
  }) => Promise<{ ok: boolean; id?: number; reused?: boolean; error?: string }>
  /** 上报窗口上下文（当前文件 / 目录 / 是否有未保存修改），供主进程路由与关闭确认使用 */
  setWindowContext: (payload: { filePath?: string; dirPath?: string; dirty?: boolean }) => void
  /**
   * 订阅窗口关闭确认请求（有未保存修改时触发），返回取消订阅函数。
   * quitting 表示正在退出应用，remaining 表示仍未处理的窗口数量。
   */
  onRequestClose: (callback: (payload: { quitting: boolean; remaining: number }) => void) => () => void
  /** 答复关闭确认：save 已保存 / discard 放弃 / cancel 取消关闭 */
  replyWindowClose: (action: 'save' | 'discard' | 'cancel') => void
  /** 订阅「该文件已在另一个窗口打开」通知，返回取消订阅函数 */
  onFileConflict: (callback: (payload: { filePath: string }) => void) => () => void
  /** 聚焦正在编辑该文件的另一个窗口（冲突提示后切换过去） */
  focusFile: (filePath: string) => Promise<{ ok: boolean; id?: number; error?: string }>
  // 文件
  openFile: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>
  openDirectory: (payload?: {
    /** 对话框标题 */
    title?: string
    /** 起始路径 */
    defaultPath?: string
  }) => Promise<{ canceled: boolean; path?: string }>
  selectImages: () => Promise<{ canceled: boolean; filePaths?: string[] }>
  readDir: (dirPath: string) => Promise<{ ok: boolean; path?: string; children?: DirEntry[]; error?: string }>
  /** 目录搜索：文件名或文本内容包含 keyword 的文件 / 目录 */
  searchText: (
    rootPath: string,
    keyword: string,
  ) => Promise<{
    ok: boolean
    hits?: DirSearchHit[]
    truncated?: boolean
    scannedFiles?: number
    error?: string
  }>
  readFile: (filePath: string) => Promise<{ ok: boolean; path?: string; isText?: boolean; content?: string; encoding?: string; size?: number; error?: string }>
  readDataUrl: (filePath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  saveFile: (args: { filePath: string; content: string }) => Promise<{ canceled: boolean; filePath?: string }>
  saveAs: (args: {
    content: string
    defaultPath?: string
    /** 可选文件类型过滤（如代码块导出时按语言限定扩展名）；缺省用默认过滤器 */
    filters?: Array<{ name: string; extensions: string[] }>
  }) => Promise<{ canceled: boolean; filePath?: string }>
  exportHtml: (args: { html: string; defaultPath?: string }) => Promise<{ canceled: boolean; filePath?: string }>
  /**
   * 导出 PDF。
   * html 与 sourceFile 二选一：前者是渲染好的打印用 HTML，后者直接打印源文件
   * （HTML / 图片，相对资源天然可用）；injectCss 为打印前追加的样式。
   */
  exportPdf: (args: {
    html?: string
    sourceFile?: string
    injectCss?: string
    defaultPath?: string
    options?: {
      pageSize?: 'A3' | 'A4' | 'A5' | 'Letter'
      /** 自定义纸张宽高（毫米），与 pageSize 互斥、优先级更高 */
      customWidthMm?: number
      customHeightMm?: number
      landscape?: boolean
      marginMm?: number
      showPageNumber?: boolean
    }
  }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>
  /** 导出 Word：data 为渲染进程生成的 docx 二进制 */
  exportDocx: (args: {
    data: Uint8Array
    defaultPath?: string
  }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>
  /** 静默写入二进制文件；目标已存在且未允许覆盖时返回 needConfirm: true */
  writeBinary: (args: {
    filePath: string
    data: Uint8Array
    overwrite?: boolean
  }) => Promise<{ ok: boolean; filePath?: string; needConfirm?: boolean; error?: string }>
  /** 读取本地文件二进制（导出 Word 嵌入本地图片用） */
  readBinary: (filePath: string) => Promise<{ ok: boolean; data?: Uint8Array; error?: string }>
  /** 下载远程资源为二进制（图床 / PlantUML 图片，绕开渲染进程 CORS） */
  fetchBinary: (args: {
    url: string
    timeout?: number
  }) => Promise<{ ok: boolean; data?: Uint8Array; contentType?: string; error?: string }>
  convertToMarkdown: (
    filePath: string,
    imageConfig?: {
      type: 'none' | 'picgo' | 'custom'
      picgoUrl?: string
      customUrl?: string
      customToken?: string
      customUrlField?: string
    }
  ) => Promise<{
    ok: boolean
    targetPath?: string
    exportedAssets?: Array<{
      id: number
      mediaType: string
      fileName: string
      ref?: string | null
      uploaded?: boolean
    }>
    warnings?: string[]
    error?: string
    code?: string
  }>
  // 文件管理（目录树增删改）
  renameFile: (args: { oldPath: string; newName: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
  createFile: (dirPath: string, fileName: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  createDir: (dirPath: string, dirName: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  deletePath: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  copyPath: (args: { srcPath: string; destDir: string }) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  // 暂存文件（内置草稿本，不在目录树中展示）
  getScratchFile: () => Promise<{ ok: boolean; path?: string; error?: string }>
  /** 打开暂存区并占用编辑归属：已被其它窗口打开时 locked 为 true */
  openScratchFile: () => Promise<{ ok: boolean; path?: string; locked?: boolean; error?: string }>
  clearScratchFile: () => Promise<{ ok: boolean; path?: string; content?: string; error?: string }>
  // 应用图片目录（集中管理嵌入图片）
  getAppImagesDir: () => Promise<{ ok: boolean; path?: string; error?: string }>
  importAppImages: (sourcePaths: string[]) => Promise<{ ok: boolean; results?: Array<{ sourcePath: string; targetPath: string; fileName: string }>; error?: string }>
  saveAppImage: (dataUrl: string, fileName?: string) => Promise<{ ok: boolean; targetPath?: string; fileName?: string; error?: string }>
  // 图片
  importImages: (sourcePaths: string[], targetDir: string) => Promise<{ ok: boolean; results?: ImageImportResult[]; error?: string }>
  saveImageData: (dataUrl: string, targetDir: string, fileName: string) => Promise<{ ok: boolean; targetPath?: string; fileName?: string; error?: string }>
  saveImageAs: (payload: {
    source:
      | { type: 'local'; path: string }
      | { type: 'url'; url: string }
      | { type: 'data'; dataUrl: string }
    defaultName?: string
  }) => Promise<{ canceled: boolean; filePath?: string; ok?: boolean; error?: string }>
  // 系统
  revealFile: (filePath: string) => void
  openWithDefault: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  /** 用系统默认浏览器打开链接（Markdown 预览中的超链接） */
  openUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
  // 系统剪贴板 / 系统拖拽（可复制到桌面等系统位置）
  writeFilesToClipboard: (paths: string[]) => Promise<{ ok: boolean; count?: number; error?: string }>
  /** 读取系统剪贴板中复制的文件 / 文件夹路径（资源管理器 Ctrl+C 后粘贴进目录树） */
  readFilesFromClipboard: () => Promise<{ ok: boolean; paths: string[]; error?: string }>
  /** 富文本复制：主进程直写 text/html + text/plain（桌面端富文本复制主路径） */
  writeRichHtml: (html: string, text: string) => Promise<{ ok: boolean; error?: string }>
  startFileDrag: (paths: string[]) => void
  statPath: (filePath: string) => Promise<{ ok: boolean; path?: string; isDirectory?: boolean; size?: number; mtime?: number; error?: string }>
  getPathForFile: (file: File) => string
  setWindowTitle: (title: string) => void
  setModified: (modified: boolean) => void
  // 外部文件打开（双击关联 / 拖拽到快捷方式 / 命令行传入）
  getStartupFiles: () => Promise<{ ok: boolean; paths: string[] }>
  onOpenExternalFiles: (callback: (paths: string[]) => void) => () => void
  // 文件关联（打开方式 / 默认程序）
  registerFileAssociations: () => Promise<{ ok: boolean; error?: string }>
  unregisterFileAssociations: () => Promise<{ ok: boolean; error?: string }>
  isFileAssociationsRegistered: () => Promise<{ ok: boolean; registered: boolean; error?: string }>
  // 版本与更新（关于 / 检查更新）
  /** 当前应用信息：版本号 / 项目主页（非桌面环境返回 null） */
  appVersion: () => Promise<{ ok: boolean; name: string; version: string; projectUrl: string } | null>
  /** 检查更新：请求 GitHub Releases 最新版本并与当前版本比较 */
  checkUpdate: () => Promise<{
    ok: boolean
    currentVersion: string
    latestVersion?: string
    hasUpdate?: boolean
    releaseUrl?: string
    releaseName?: string
    notes?: string
    publishedAt?: string
    error?: string
  } | null>
  /** 在系统默认浏览器打开外部链接（仅 http/https） */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
  // AI 配置与对话
  aiGetConfig: () => Promise<AiConfig>
  aiSetConfig: (config: AiConfig) => Promise<{ ok: boolean; error?: string }>
  aiChat: (payload: {
    provider: AiProvider
    messages: AiMessage[]
    temperature?: number
    /** 业务场景（用于调用日志归类，如 polish / outline / diagram / commit） */
    scene?: AiLogScene
    requestId?: string
  }) => Promise<{ ok: boolean; content?: string; error?: string }>
  // AI 流式对话：增量文本通过 onDelta 回调实时返回
  aiChatStream: (
    payload: {
      requestId: string
      provider: AiProvider
      messages: AiMessage[]
      temperature?: number
      /** 业务场景（用于调用日志归类） */
      scene?: AiLogScene
    },
    handlers: AiStreamHandlers,
  ) => Promise<AiStreamSession>
  aiTest: (provider: AiProvider) => Promise<{ ok: boolean; reply?: string; elapsed?: number; error?: string }>
  // AI 对话会话（多会话：新建对话 / 历史对话）
  aiChats: AiChatsApi
  // 打开独立「AI 对话」窗口
  openAiChatWindow: () => Promise<{ ok: boolean }>
  // AI 调用日志（按月 JSON 落盘）
  aiLogMonths: () => Promise<{ ok: boolean; months: AiLogMonth[]; error?: string }>
  aiLogList: (query: AiLogQuery) => Promise<AiLogListResult>
  aiLogDetail: (payload: { id: string; month?: string }) => Promise<{ ok: boolean; record?: AiLogRecord; error?: string }>
  aiLogDelete: (payload: { ids: string[]; month?: string }) => Promise<{ ok: boolean; removed?: number; error?: string }>
  aiLogClear: (payload: { month?: string }) => Promise<{ ok: boolean; removed?: number; error?: string }>
  aiLogOpenDir: () => Promise<{ ok: boolean; dir?: string; error?: string }>
  // AI 文件引用
  extractFileForAi: (filePath: string) => Promise<AiFileAttachment>
  selectAiFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>
  // 调试（开发者工具）
  toggleDevTools: () => Promise<{ ok: boolean }>
  isDebugMode: () => Promise<{ ok: boolean; debug: boolean }>
  // 终端（命令行）
  terminal: TerminalApi
  // JS 脚本运行（.js 文件 / Markdown ```js 代码块）
  script: ScriptApi
  // Git 版本管理（打开的目录为 Git 仓库时可用）
  git: GitApi
  // Git 提交规范（内置默认 + 页面可编辑，用于 AI 生成提交信息）
  commitSpec: CommitSpecApi
  // 快捷 AI 动作（内置生成类型与提示词，可定制修改）
  quickAi: QuickAiApi
  // 进程管理（按端口 / 服务名查询进程并结束）
  process: ProcessApi
}

/** 进程占用的一个端口 */
interface ProcPortItem {
  /** 协议（TCP / UDP） */
  proto: string
  /** 端口号 */
  port: number
  /** 本地地址，如 0.0.0.0:8080 */
  local: string
  /** 远端地址 */
  remote: string
  /** 连接状态，如 LISTENING；UDP 为空 */
  state: string
  /** 是否为监听中（即端口被该进程占用） */
  listening: boolean
}

/** 进程条目 */
interface ProcItem {
  /** 进程 ID */
  pid: number
  /** 进程名，如 java.exe */
  name: string
  /** 可执行文件路径（可能为空） */
  exe: string
  /** 启动命令行（可能为空，超长已截断） */
  commandLine: string
  /** 内存占用（KB） */
  memory: number
  /** 占用的端口列表 */
  ports: ProcPortItem[]
  /** 是否存在监听中的端口 */
  listening: boolean
  /** 命中方式：all / port / pid / name / cmdline */
  matchedBy: string
  /** 是否为受保护进程（系统关键进程 / 本应用自身），禁止结束 */
  critical: boolean
}

/** 进程查询结果 */
interface ProcSearchResult {
  ok: boolean
  /** 操作系统标识，如 win32 */
  platform?: string
  /** 命中的进程条目 */
  items?: ProcItem[]
  /** 扫描到的进程总数 */
  scanned?: number
  /** 命中的进程数 */
  total?: number
  /** 查询耗时（毫秒） */
  elapsedMs?: number
  /** 本次是否取到了命令行（决定能否按启动参数搜索） */
  cmdlineAvailable?: boolean
  error?: string
  message?: string
}

/** 结束进程结果 */
interface ProcKillResult {
  ok: boolean
  /** 进程 ID */
  pid?: number
  /** 成功提示 */
  message?: string
  /** 失败原因 */
  error?: string
}

/** 进程管理能力接口（window.mdAPI.process） */
interface ProcessApi {
  /** 按关键字查询进程 */
  search: (payload: {
    /** 关键字：端口 / 进程名 / PID / 启动参数片段 */
    keyword?: string
    /** 匹配模式：auto 自动 / port 端口 / name 进程名 / pid / cmdline 命令行 */
    mode?: string
    /** 是否采集启动命令行（关闭时更快，但搜不到 jar 包名） */
    deep?: boolean
    /** 是否只返回占用端口的进程 */
    onlyPorts?: boolean
    /** 是否忽略命令行缓存重新采集 */
    refresh?: boolean
  }) => Promise<ProcSearchResult>
  /** 结束进程 */
  kill: (payload: {
    /** 进程 ID */
    pid: number
    /** 进程名，用于拦截系统关键进程 */
    name?: string
    /** 是否连同子进程一起结束 */
    tree?: boolean
  }) => Promise<ProcKillResult>
}

/** 终端 shell 类型：决定提示符样式与换行符 */
type TerminalShellKind = 'powershell' | 'cmd' | 'bash' | 'other'

/** 可选 shell 信息 */
interface ShellOption {
  /** shell 标识，如 powershell / cmd / gitbash */
  id: string
  /** 展示名，如 PowerShell */
  name: string
  /** shell 类型，决定提示符与换行符 */
  kind: TerminalShellKind
}

/** 终端启动结果 */
interface TerminalStartResult {
  ok: boolean
  /** 会话 id */
  id?: string
  /** 实际工作目录 */
  cwd?: string
  shellId?: string
  shellName?: string
  kind?: TerminalShellKind
  /** 行结束符（Windows 为 \r\n） */
  eol?: string
  /** shell 是否自带提示符输出（cmd 自带） */
  echoesPrompt?: boolean
  error?: string
}

/** 终端补全候选项 */
interface TerminalCompletionItem {
  /** 用于替换输入片段的完整文本（目录会带路径分隔符，命令会带空格） */
  insert: string
  /** 展示名 */
  name: string
  /** 类型：目录 / 文件 / 命令 */
  kind: 'dir' | 'file' | 'command'
}

/** 终端补全结果 */
interface TerminalCompleteResult {
  ok: boolean
  /** 待补全片段在输入行中的起始下标 */
  start?: number
  /** 待补全片段原文 */
  token?: string
  /** 候选列表 */
  candidates?: TerminalCompletionItem[]
  /** 候选公共前缀 */
  commonPrefix?: string
  error?: string
}

/** 可选系统外部终端信息 */
interface ExternalTerminalOption {
  /** 终端标识，如 wt / ghostty / powershell */
  id: string
  /** 展示名，如 Windows Terminal */
  name: string
}

/** 终端能力接口（window.mdAPI.terminal） */
interface TerminalApi {
  /** 列出可用的系统外部终端（另开真实终端窗口，拥有 TTY） */
  externalList: () => Promise<{
    ok: boolean
    terminals?: ExternalTerminalOption[]
    defaultId?: string
  }>
  /** 在系统外部终端中打开目录（terminalId 省略时取优先级最高的可用终端） */
  openExternal: (args: { dir: string; terminalId?: string }) => Promise<{
    ok: boolean
    name?: string
    id?: string
    dir?: string
    error?: string
  }>
  shells: () => Promise<{ ok: boolean; shells?: ShellOption[]; defaultShellId?: string; error?: string }>
  start: (args: { cwd?: string; shellId?: string }) => Promise<TerminalStartResult>
  write: (args: { id: string; data: string }) => void
  resize: (args: { id: string; cols: number; rows: number }) => void
  kill: (id: string) => Promise<{ ok: boolean }>
  /** 只关闭本窗口创建的终端（多窗口下不影响其它窗口） */
  killOwn: () => Promise<{ ok: boolean; killed?: number }>
  killAll: () => Promise<{ ok: boolean }>
  complete: (args: {
    id: string
    cwd?: string
    kind?: TerminalShellKind
    input: string
    cursor: number
  }) => Promise<TerminalCompleteResult>
  onData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onExit: (callback: (payload: { id: string; code: number }) => void) => () => void
}

/** 脚本运行启动参数 */
interface ScriptRunPayload {
  /** 代码片段（与 filePath 二选一；写入临时文件后执行） */
  code?: string
  /** 脚本文件路径（与 code 二选一；直接执行） */
  filePath?: string
  /** 工作目录（filePath 模式默认取文件所在目录，code 模式默认家目录） */
  cwd?: string
  /** 超时时间（毫秒），默认 60000 */
  timeoutMs?: number
}

/** 脚本运行启动结果 */
interface ScriptRunResult {
  ok: boolean
  /** 会话 id */
  id?: string
  /** 实际工作目录 */
  cwd?: string
  error?: string
}

/** 脚本输出事件负载 */
interface ScriptDataPayload {
  /** 会话 id */
  id: string
  /** 输出流：stdout 标准输出 / stderr 标准错误 / system 系统提示 */
  stream: 'stdout' | 'stderr' | 'system'
  /** 输出文本 */
  data: string
}

/** 脚本退出事件负载 */
interface ScriptExitPayload {
  /** 会话 id */
  id: string
  /** 退出码（-1 表示被主动终止） */
  code: number
}

/** JS 脚本运行能力接口（window.mdAPI.script） */
interface ScriptApi {
  /** 运行脚本（code 代码片段 或 filePath 文件） */
  run: (payload: ScriptRunPayload) => Promise<ScriptRunResult>
  /** 停止指定脚本 */
  kill: (id: string) => Promise<{ ok: boolean }>
  /** 只停止本窗口创建的脚本（多窗口下不影响其它窗口） */
  killOwn: () => Promise<{ ok: boolean; killed?: number }>
  killAll: () => Promise<{ ok: boolean }>
  onData: (callback: (payload: ScriptDataPayload) => void) => () => void
  onExit: (callback: (payload: ScriptExitPayload) => void) => () => void
}

/** Git 文件状态码（沿用 git porcelain 语义） */
type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'

/** 单个文件的变更信息 */
interface GitFileChange {
  /** 仓库内相对路径（正斜杠） */
  path: string
  /** 文件名 */
  name: string
  /** 所在目录（相对仓库根，正斜杠） */
  dir: string
  /** 状态码 */
  status: GitStatusCode
  /** 是否已暂存 */
  staged: boolean
  /** 重命名 / 复制前的原路径 */
  renamedFrom?: string
}

/** 仓库状态（分支信息 + 变更分组） */
interface GitStatus {
  /** 仓库根目录 */
  repoRoot: string
  /** 当前分支名（游离 HEAD 时为 HEAD） */
  branch: string
  /** 上游分支名，无上游时为空 */
  upstream: string
  /** 上游是否已失效（配置了上游但远端还没有该分支，如空仓库首推） */
  upstreamGone: boolean
  /** 领先上游的提交数 */
  ahead: number
  /** 落后上游的提交数 */
  behind: number
  /** 是否处于游离 HEAD */
  detached: boolean
  /** 已暂存的变更 */
  staged: GitFileChange[]
  /** 未暂存的变更（含未跟踪文件） */
  unstaged: GitFileChange[]
  /** 冲突文件 */
  conflicted: GitFileChange[]
  /** 变更过多时列表被截断 */
  truncated: boolean
}

/** 提交历史条目 */
interface GitCommitInfo {
  /** 完整 SHA */
  sha: string
  /** 短 SHA（7 位） */
  shortSha: string
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  email: string
  /** 提交时间（ISO 字符串） */
  date: string
  /** 提交标题 */
  message: string
  /** 引用信息，如 (HEAD -> main, origin/main) */
  refs: string
}

/** diff 行类型 */
type GitDiffLineType = 'add' | 'del' | 'ctx'

/** 差异中的一行 */
interface GitDiffLine {
  type: GitDiffLineType
  /** 旧文件行号，新增行为 null */
  oldNo: number | null
  /** 新文件行号，删除行为 null */
  newNo: number | null
  /** 行内容 */
  text: string
}

/** 差异中的一个 hunk（改动块） */
interface GitDiffHunk {
  /** hunk 头，如 @@ -1,5 +1,7 @@ */
  header: string
  /** hunk 内的行 */
  lines: GitDiffLine[]
}

/** 差异查看请求参数 */
interface GitDiffPayload {
  /** 文件路径（仓库内相对路径），为空表示整个仓库 */
  paths: string[]
  /** 是否查看暂存区差异 */
  staged?: boolean
  /** 指定提交的 SHA */
  sha?: string
  /** 弹窗标题后缀 */
  title?: string
}

/** 分支信息（本地或远程分支） */
interface GitBranchInfo {
  /** 分支名（本地为 master，远程为 origin/master） */
  name: string
  /** 分支指向的短 SHA */
  sha: string
  /** 上游分支名，无上游时为空 */
  upstream: string
  /** 领先上游的提交数 */
  ahead: number
  /** 落后上游的提交数 */
  behind: number
  /** 是否为当前分支 */
  current: boolean
  /** 分支最后一次提交时间（ISO 字符串） */
  date: string
  /** 分支最后一次提交标题 */
  subject: string
}

/** 远程仓库信息 */
interface GitRemoteInfo {
  /** 远程仓库名，如 origin */
  name: string
  /** 远程仓库地址 */
  url: string
}

/** 储藏（stash）条目 */
interface GitStashEntry {
  /** 储藏序号，如 0 表示 stash@{0} */
  index: number
  /** 完整选择器，如 stash@{0} */
  selector: string
  /** 创建该储藏时所在的分支 */
  branch: string
  /** 储藏说明 */
  message: string
  /** 对应提交的完整 SHA */
  sha: string
  /** 创建时间（ISO 字符串） */
  date: string
}

/** Git 能力接口（window.mdAPI.git） */
interface GitApi {
  checkAvailable: () => Promise<{ ok: boolean; available: boolean; version?: string; path?: string }>
  getConfig: () => Promise<{ ok: boolean; gitPath?: string }>
  setConfig: (config: { gitPath?: string }) => Promise<{ ok: boolean; error?: string; message?: string }>
  detect: (dirPath: string) => Promise<{
    ok: boolean
    isRepo: boolean
    repoRoot?: string
    gitAvailable: boolean
    gitVersion?: string
    message?: string
  }>
  status: (repoRoot: string) => Promise<{ ok: boolean; status?: GitStatus; error?: string; message?: string }>
  add: (args: { repoRoot: string; paths: string[] }) => Promise<{ ok: boolean; error?: string; message?: string }>
  unstage: (args: { repoRoot: string; paths: string[] }) => Promise<{ ok: boolean; error?: string; message?: string }>
  commit: (args: {
    repoRoot: string
    message: string
  }) => Promise<{ ok: boolean; sha?: string; error?: string; message?: string }>
  diff: (args: {
    repoRoot: string
    paths?: string[]
    staged?: boolean
    sha?: string
    revRange?: string
  }) => Promise<{ ok: boolean; diff?: string; truncated?: boolean; binary?: boolean; error?: string; message?: string }>
  log: (args: {
    repoRoot: string
    path?: string
    limit?: number
    skip?: number
    follow?: boolean
  }) => Promise<{ ok: boolean; commits?: GitCommitInfo[]; error?: string; message?: string }>
  restore: (args: { repoRoot: string; paths: string[] }) => Promise<{ ok: boolean; error?: string; message?: string }>
  // 克隆远程仓库（从 Git 打开）
  clone: (args: {
    /** 仓库地址（HTTPS / SSH / 本地路径） */
    url: string
    /** 存放该仓库的父目录 */
    targetDir: string
    /** 项目目录名，缺省按仓库地址推导 */
    dirName?: string
    /** 指定分支，缺省用远程默认分支 */
    branch?: string
    /** 浅克隆深度（提交数），缺省完整克隆 */
    depth?: number
  }) => Promise<{ ok: boolean; path?: string; branch?: string; error?: string; message?: string }>
  /** 订阅克隆进度，返回取消订阅函数 */
  onCloneProgress: (
    callback: (info: { phase: string; percent: number; text: string }) => void,
  ) => () => void
  // P1：分支 / 远程同步 / 储藏 / 忽略规则
  branches: (repoRoot: string) => Promise<{
    ok: boolean
    current?: string
    local?: GitBranchInfo[]
    remote?: GitBranchInfo[]
    error?: string
    message?: string
  }>
  checkout: (args: {
    repoRoot: string
    branch: string
    create?: boolean
    from?: string
  }) => Promise<{ ok: boolean; branch?: string; error?: string; message?: string }>
  deleteBranch: (args: {
    repoRoot: string
    branch: string
    force?: boolean
  }) => Promise<{ ok: boolean; error?: string; message?: string }>
  remotes: (repoRoot: string) => Promise<{ ok: boolean; remotes?: GitRemoteInfo[]; error?: string; message?: string }>
  fetch: (args: {
    repoRoot: string
    remote?: string
    prune?: boolean
  }) => Promise<{ ok: boolean; error?: string; message?: string }>
  pull: (args: {
    repoRoot: string
    remote?: string
    branch?: string
    rebase?: boolean
  }) => Promise<{ ok: boolean; summary?: string; error?: string; message?: string }>
  push: (args: {
    repoRoot: string
    remote?: string
    branch?: string
    setUpstream?: boolean
    forceWithLease?: boolean
  }) => Promise<{ ok: boolean; summary?: string; error?: string; message?: string }>
  stashList: (repoRoot: string) => Promise<{ ok: boolean; stashes?: GitStashEntry[]; error?: string; message?: string }>
  stashSave: (args: {
    repoRoot: string
    message?: string
    includeUntracked?: boolean
  }) => Promise<{ ok: boolean; empty?: boolean; error?: string; message?: string }>
  stashApply: (args: {
    repoRoot: string
    index: number
    pop?: boolean
  }) => Promise<{ ok: boolean; error?: string; message?: string }>
  stashDrop: (args: { repoRoot: string; index: number }) => Promise<{ ok: boolean; error?: string; message?: string }>
  readGitignore: (
    repoRoot: string,
  ) => Promise<{ ok: boolean; path?: string; content?: string; error?: string; message?: string }>
  writeGitignore: (args: {
    repoRoot: string
    content: string
  }) => Promise<{ ok: boolean; path?: string; error?: string; message?: string }>
  ignorePath: (args: {
    repoRoot: string
    path: string
  }) => Promise<{ ok: boolean; added?: boolean; rule?: string; tracked?: boolean; error?: string; message?: string }>
}

/** AI 厂商协议格式 */
type AiFormat = 'openai' | 'anthropic' | 'gemini'

/** AI 厂商配置 */
interface AiProvider {
  id: string
  name: string
  format: AiFormat
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  builtin?: boolean
  custom?: boolean
}

/** AI 整体配置 */
interface AiConfig {
  activeProviderId: string
  providers: AiProvider[]
}

/** AI 对话消息（content 支持文本或包含图片的多模态 parts） */
interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AiChatPart[]
}

/** 多模态消息片段 */
interface AiChatPart {
  type: 'text' | 'image'
  text?: string
  mime?: string
  dataUrl?: string
}

/** 引用给 AI 的文件（提取后的结果） */
interface AiFileAttachment {
  ok: boolean
  kind: 'text' | 'image' | 'unsupported'
  name: string
  path: string
  ext: string
  size: number
  content?: string
  truncated?: boolean
  dataUrl?: string
  mime?: string
  error?: string
}

/** AI 流式对话回调（增量 / 完成 / 失败） */
interface AiStreamHandlers {
  /** 收到一段增量文本 */
  onDelta?: (delta: string) => void
  /** 生成完成（fallback 表示厂商不支持流式、已降级为一次性返回；stopped 表示用户主动停止） */
  onDone?: (content: string, payload?: { fallback?: boolean; stopped?: boolean }) => void
  /** 生成失败（content 可能包含已生成的片段） */
  onError?: (error: string, payload?: { content?: string }) => void
}

/** AI 流式会话句柄：stop 用于中断生成 */
interface AiStreamSession {
  ok: boolean
  requestId?: string
  error?: string
  stop: () => void
}

/** AI 对话消息类型：自由对话 / 快捷动作 / 图表生成 */
type AiChatKind = 'chat' | 'quick' | 'diagram'

/** 对话会话中的一条消息（持久化到 ai-chats.json） */
interface AiChatMessage {
  /** 消息 id */
  id: string
  /** 角色 */
  role: 'user' | 'assistant'
  /** 消息类型（决定展示样式与日志场景） */
  kind: AiChatKind
  /** 正文：user 为提问文本（快捷动作为完整提示词），assistant 为回复内容 */
  content: string
  /** 展示标签（快捷动作 / 图表生成），存在时优先展示 */
  label?: string
  /** 引用的文件名 */
  files?: string[]
  /** 结果应用方式（快捷动作 / 图表生成，决定展示哪些结果按钮） */
  applyMode?: 'replace' | 'append' | 'caret' | 'prepend' | 'outline' | 'metadata'
  /** 失败原因（失败消息） */
  error?: string
  /** 创建时间（毫秒时间戳） */
  createdAt: number
}

/** 一个 AI 对话会话（多会话：可新建、切换、重命名、删除） */
interface AiChatSession {
  /** 会话 id */
  id: string
  /** 会话标题（默认取首条提问） */
  title: string
  /** 标题是否被用户手动改过（是则不再自动推导） */
  titleEdited?: boolean
  /** 最近使用的厂商 id */
  providerId?: string
  /** 创建时间（毫秒时间戳） */
  createdAt: number
  /** 最后更新时间（毫秒时间戳，用于排序展示） */
  updatedAt: number
  /** 会话消息（按时间正序） */
  messages: AiChatMessage[]
}

/** AI 对话会话能力接口（window.mdAPI.aiChats） */
interface AiChatsApi {
  list: () => Promise<{ ok: boolean; sessions?: AiChatSession[]; error?: string }>
  upsert: (session: AiChatSession) => Promise<{ ok: boolean; sessions?: AiChatSession[]; error?: string }>
  remove: (payload: { ids: string[] }) => Promise<{ ok: boolean; sessions?: AiChatSession[]; removed?: number; error?: string }>
  /** 订阅会话变更（其它窗口写入本窗口也会收到），返回取消订阅函数 */
  onChanged: (callback: () => void) => () => void
}

/** AI 调用场景（用于调用日志归类） */
type AiLogScene = 'chat' | 'polish' | 'expand' | 'outline' | 'diagram' | 'commit' | 'quick' | 'test' | 'pdf'

/** 调用日志月份条目 */
interface AiLogMonth {
  /** 月份标识 YYYY-MM */
  month: string
  /** 该月记录数 */
  count: number
  /** 最后更新时间（ISO 字符串） */
  updatedAt: string
}

/** 调用日志查询条件 */
interface AiLogQuery {
  /** 月份 YYYY-MM，缺省查全部月份 */
  month?: string
  /** 场景过滤 */
  scene?: AiLogScene | ''
  /** 状态过滤：all 全部 / ok 成功 / fail 失败 */
  status?: 'all' | 'ok' | 'fail'
  /** 关键字（厂商 / 模型 / 场景 / 错误 / 响应预览） */
  keyword?: string
  /** 页码（1 起） */
  page?: number
  /** 每页条数（最大 200） */
  pageSize?: number
}

/** 调用日志列表条目（不含完整请求 / 响应正文） */
interface AiLogSummary {
  id: string
  month: string
  ts: number
  /** ISO 时间字符串 */
  time: string
  scene: AiLogScene | string
  ok: boolean
  error: string
  /** 是否被用户中断 */
  stopped: boolean
  /** 是否由流式降级为一次性请求 */
  fallback: boolean
  providerId: string
  providerName: string
  model: string
  format: string
  stream: boolean
  messageCount: number
  promptChars: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Token 是否为估算值（服务端未返回用量） */
  estimated: boolean
  elapsedMs: number | null
  /** 响应内容预览 */
  preview: string
}

/** 调用日志统计 */
interface AiLogStats {
  total: number
  okCount: number
  failCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  elapsedMs: number
  avgElapsedMs: number
  byProvider: Array<{ key: string; name: string; model: string; count: number; totalTokens: number; elapsedMs: number }>
  byScene: Array<{ scene: string; count: number; totalTokens: number }>
}

/** 调用日志查询结果 */
interface AiLogListResult {
  ok: boolean
  page: number
  pageSize: number
  total: number
  items: AiLogSummary[]
  stats?: AiLogStats
  error?: string
}

/** 调用日志消息快照（文本已按上限裁剪，图片只保留元信息） */
interface AiLogMessage {
  role: string
  chars: number
  truncated?: boolean
  text?: string
  parts?: Array<{
    type: 'text' | 'image'
    chars?: number
    truncated?: boolean
    text?: string
    mime?: string
    bytes?: number
    note?: string
  }>
}

/** 调用日志完整记录 */
interface AiLogRecord {
  id: string
  month: string
  ts: number
  time: string
  scene: AiLogScene | string
  ok: boolean
  error: string
  provider: {
    id: string
    name: string
    format: string
    /** 服务地址（密钥参数已脱敏） */
    baseUrl: string
    model: string
  }
  request: {
    url: string
    method: string
    /** 请求头（密钥已脱敏） */
    headers: Record<string, string>
    /** 请求参数（不含消息体） */
    params: Record<string, unknown>
    temperature: number | null
    stream: boolean
    messageCount: number
    promptChars: number
    messages: AiLogMessage[]
  }
  response: {
    content: string
    contentChars: number
    truncated: boolean
    finishReason: string
    status: number | null
  }
  usage: { input: number; output: number; total: number; estimated: boolean }
  elapsedMs: number | null
  stopped: boolean
  fallback: boolean
  preview: string
}

/** 提交规范预设：full 完整版 / brief 精简版 */
type CommitSpecPreset = 'full' | 'brief'

/** Git 提交规范配置（内置默认，可在页面编辑） */
interface CommitSpecConfig {
  /** 配置结构版本号 */
  version: number
  /** 当前规范预设 */
  preset: CommitSpecPreset
  /** 提交规范正文（写入 AI 提示词） */
  spec: string
  /** AI 生成提交信息的提示词模板，支持 ${spec} ${branch} ${files} ${recentCommits} ${diff} 占位符 */
  promptTemplate: string
  /** 提交前是否校验提交信息格式（不合规时提示，可继续提交） */
  validateBeforeCommit: boolean
  /** 生成时是否附带最近提交标题作为风格参考 */
  includeRecentCommits: boolean
}

/** 快捷 AI 动作适用范围：doc 全文 / selection 选中文本 / auto 自动（有选中用选中，否则全文） */
type QuickAiScope = 'doc' | 'selection' | 'auto'

/**
 * 快捷 AI 动作结果处理方式
 * replace 替换全文 / append 追加文末 / caret 插入光标处 / prepend 插入文首
 * outline 插入概要提示块 / metadata 合并到文档头部元数据 / auto 自动（有选中用光标处，否则替换全文）
 */
type QuickAiApply = 'replace' | 'append' | 'caret' | 'prepend' | 'outline' | 'metadata' | 'auto'

/** 快捷 AI 动作（内置类型 + 自定义类型，提示词可编辑） */
interface QuickAiAction {
  /** 动作唯一标识（内置为 polish / expand …，自定义为 custom-xxx） */
  id: string
  /** 展示名称 */
  name: string
  /** 用途说明 */
  desc: string
  /** 图标名（渲染进程映射为组件） */
  icon: string
  /** 适用范围 */
  scope: QuickAiScope
  /** 结果处理方式 */
  apply: QuickAiApply
  /** 提示词模板，{content} 在发送前替换为待处理内容 */
  prompt: string
  /** 是否为内置动作（内置不可删除，只能恢复默认） */
  builtin?: boolean
  /** 是否在 AI 面板快捷区展示 */
  enabled?: boolean
}

/** 快捷 AI 配置 */
interface QuickAiConfig {
  version: number
  actions: QuickAiAction[]
}

/** 快捷 AI 能力接口（window.mdAPI.quickAi） */
interface QuickAiApi {
  get: () => Promise<QuickAiConfig>
  set: (config: { actions: QuickAiAction[] }) => Promise<{ ok: boolean; config?: QuickAiConfig; error?: string }>
  reset: (payload?: { id?: string }) => Promise<{ ok: boolean; config?: QuickAiConfig; error?: string }>
}

/** 提交规范能力接口（window.mdAPI.commitSpec） */
interface CommitSpecApi {
  get: () => Promise<CommitSpecConfig>
  set: (
    config: Partial<CommitSpecConfig>,
  ) => Promise<{ ok: boolean; config?: CommitSpecConfig; error?: string }>
  reset: (
    preset?: CommitSpecPreset,
  ) => Promise<{ ok: boolean; config?: CommitSpecConfig; error?: string }>
}

interface Window {
  mdAPI?: MdAPI
}
