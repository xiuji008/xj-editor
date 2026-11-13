const { contextBridge, ipcRenderer, webUtils } = require('electron')

/* ==================== 窗口身份（主进程通过 additionalArguments 注入） ==================== */
const WIN_ID_PREFIX = '--md-win-id='
const INIT_PREFIX = '--md-init='
const argv = Array.isArray(process.argv) ? process.argv : []

/** 当前窗口 id（主进程分配，首个主窗口为 1；0 表示未注入，如纯浏览器环境） */
const windowId = (() => {
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(WIN_ID_PREFIX))
  if (!arg) return 0
  return Number(arg.slice(WIN_ID_PREFIX.length)) || 0
})()

/**
 * 窗口初始上下文：{ id, dir, file }
 * 新建窗口时由发起窗口传入，用于让新窗口直接打开指定目录 / 文件
 */
const windowInit = (() => {
  const base = { id: windowId, dir: '', file: '' }
  try {
    const arg = argv.find((a) => typeof a === 'string' && a.startsWith(INIT_PREFIX))
    if (!arg) return base
    return { ...base, ...JSON.parse(decodeURIComponent(arg.slice(INIT_PREFIX.length))) }
  } catch {
    return base
  }
})()

contextBridge.exposeInMainWorld('mdAPI', {
  /** 当前窗口 id（多窗口隔离存储 / 调试用），非桌面环境为 0 */
  windowId,
  /** 窗口初始上下文：新建窗口时带上发起窗口的目录 / 文件 */
  windowInit,
  // 多窗口：新建窗口 / 在新窗口打开文件
  newWindow: (payload) => ipcRenderer.invoke('window:new', payload || {}),
  openInNewWindow: (payload) => ipcRenderer.invoke('window:openInNew', payload || {}),
  /**
   * 上报窗口上下文（当前文件 / 目录 / 是否有未保存修改）：
   * 主进程据此路由外部文件并在关闭窗口前确认保存
   */
  setWindowContext: (payload) => ipcRenderer.send('window:setContext', payload || {}),
  /**
   * 订阅关闭确认请求（窗口有未保存修改时被拦截），返回取消订阅函数。
   * quitting 为 true 表示用户正在退出应用，remaining 为仍未处理的窗口数量。
   * @param {(payload: { quitting: boolean, remaining: number }) => void} callback 收到关闭请求时的回调
   */
  onRequestClose: (callback) => {
    const listener = (_event, payload) => callback(payload || { quitting: false, remaining: 1 })
    ipcRenderer.on('app:request-close', listener)
    return () => ipcRenderer.removeListener('app:request-close', listener)
  },
  /**
   * 答复关闭确认：save 已保存 / discard 放弃 / cancel 取消关闭
   * @param {'save' | 'discard' | 'cancel'} action 用户选择
   */
  replyWindowClose: (action) => ipcRenderer.send('window:close:reply', { action }),
  /**
   * 订阅「该文件已在另一个窗口打开」通知，返回取消订阅函数
   * @param {(payload: { filePath: string }) => void} callback 收到冲突通知时的回调
   */
  onFileConflict: (callback) => {
    const listener = (_event, payload) => callback(payload || {})
    ipcRenderer.on('app:file-conflict', listener)
    return () => ipcRenderer.removeListener('app:file-conflict', listener)
  },
  /** 聚焦正在编辑该文件的另一个窗口（冲突提示后切换过去） */
  focusFile: (filePath) => ipcRenderer.invoke('window:focusFile', { filePath }),
  // 文件
  openFile: () => ipcRenderer.invoke('dialog:open'),
  openDirectory: (payload) => ipcRenderer.invoke('dialog:openDirectory', payload),
  selectImages: () => ipcRenderer.invoke('dialog:selectImages'),
  readDir: (dirPath) => ipcRenderer.invoke('dir:read', { dirPath }),
  /** 目录搜索：文件名或文本内容包含 keyword 的文件 / 目录（单次遍历，主进程完成） */
  searchText: (rootPath, keyword) => ipcRenderer.invoke('dir:searchText', { rootPath, keyword }),
  readFile: (filePath) => ipcRenderer.invoke('file:read', { filePath }),
  readDataUrl: (filePath) => ipcRenderer.invoke('file:readDataUrl', { filePath }),
  saveFile: ({ filePath, content }) => ipcRenderer.invoke('dialog:save', { filePath, content }),
  saveAs: ({ content, defaultPath, filters }) => ipcRenderer.invoke('dialog:saveAs', { content, defaultPath, filters }),
  exportHtml: ({ html, defaultPath }) => ipcRenderer.invoke('dialog:exportHtml', { html, defaultPath }),
  /**
   * 导出 PDF：主进程用隐藏窗口的 Chromium 打印。
   * - html：渲染进程生成的打印用 HTML（Markdown / 文本类）
   * - sourceFile：直接打印源文件（HTML / 图片，相对资源天然可用）
   * - injectCss：打印前追加的样式（如让图片居中缩放）
   */
  exportPdf: ({ html, sourceFile, injectCss, defaultPath, options }) =>
    ipcRenderer.invoke('dialog:exportPdf', { html, sourceFile, injectCss, defaultPath, options }),
  // 导出 Word：data 为渲染进程生成的 docx 二进制（Uint8Array，结构化克隆传输）
  exportDocx: ({ data, defaultPath }) => ipcRenderer.invoke('dialog:exportDocx', { data, defaultPath }),
  // 读取本地文件二进制（导出 Word 嵌入本地图片用）
  readBinary: (filePath) => ipcRenderer.invoke('file:readBinary', { filePath }),
  // 静默写入二进制文件（不弹对话框）：目标已存在且未允许覆盖时返回 needConfirm
  writeBinary: ({ filePath, data, overwrite }) =>
    ipcRenderer.invoke('file:writeBinary', { filePath, data, overwrite }),
  // 下载远程资源为二进制（图床 / PlantUML 图片，绕开渲染进程 CORS）
  fetchBinary: (payload) => ipcRenderer.invoke('net:fetchBinary', payload || {}),
  convertToMarkdown: (filePath, imageConfig) =>
    ipcRenderer.invoke('file:convertToMarkdown', { filePath, imageConfig }),
  // 文件管理（目录树增删改）
  renameFile: ({ oldPath, newName }) => ipcRenderer.invoke('file:rename', { oldPath, newName }),
  createFile: (dirPath, fileName) => ipcRenderer.invoke('file:create', { dirPath, fileName }),
  createDir: (dirPath, dirName) => ipcRenderer.invoke('dir:create', { dirPath, dirName }),
  deletePath: (filePath) => ipcRenderer.invoke('file:delete', { filePath }),
  copyPath: ({ srcPath, destDir }) => ipcRenderer.invoke('file:copy', { srcPath, destDir }),
  // 暂存文件（内置草稿本，不在目录树中展示）
  getScratchFile: () => ipcRenderer.invoke('scratch:get'),
  // 打开暂存区并占用编辑归属（已被其它窗口打开时返回 locked）
  openScratchFile: () => ipcRenderer.invoke('scratch:open'),
  clearScratchFile: () => ipcRenderer.invoke('scratch:clear'),
  // 应用图片目录（集中管理嵌入图片）
  getAppImagesDir: () => ipcRenderer.invoke('app:getImagesDir'),
  importAppImages: (sourcePaths) => ipcRenderer.invoke('image:importApp', { sourcePaths }),
  saveAppImage: (dataUrl, fileName) => ipcRenderer.invoke('image:saveAppData', { dataUrl, fileName }),
  // 图片
  importImages: (sourcePaths, targetDir) => ipcRenderer.invoke('image:import', { sourcePaths, targetDir }),
  saveImageData: (dataUrl, targetDir, fileName) => ipcRenderer.invoke('image:saveData', { dataUrl, targetDir, fileName }),
  saveImageAs: (payload) => ipcRenderer.invoke('image:saveAs', payload),
  // 系统
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', { filePath }),
  openWithDefault: (filePath) => ipcRenderer.invoke('shell:openPath', { filePath }),
  // 用系统默认浏览器打开链接（Markdown 预览中的超链接）
  openUrl: (url) => ipcRenderer.invoke('shell:openUrl', { url }),
  // 系统剪贴板 / 系统拖拽（复制文件到桌面等系统位置）
  writeFilesToClipboard: (paths) => ipcRenderer.invoke('clipboard:writeFiles', { paths }),
  // 读取系统剪贴板中复制的文件 / 文件夹路径（资源管理器 Ctrl+C 后粘贴进目录树）
  readFilesFromClipboard: () => ipcRenderer.invoke('clipboard:readFiles'),
  // 富文本复制：主进程直写 text/html + text/plain（桌面端富文本复制的主路径）
  writeRichHtml: (html, text) => ipcRenderer.invoke('clipboard:writeRich', { html, text }),
  startFileDrag: (paths) => ipcRenderer.send('drag:startFiles', { paths }),
  // 查询路径是文件还是目录
  statPath: (filePath) => ipcRenderer.invoke('file:stat', { filePath }),
  // 系统拖入的文件取其磁盘绝对路径（File.path 已废弃，改用 webUtils）
  getPathForFile: (file) => webUtils.getPathForFile(file),
  setWindowTitle: (title) => ipcRenderer.send('window:setTitle', title),
  setModified: (modified) => ipcRenderer.send('window:setModified', modified),
  // 外部文件打开（双击关联 / 拖拽到快捷方式 / 命令行传入）
  getStartupFiles: () => ipcRenderer.invoke('app:getStartupFiles'),
  onOpenExternalFiles: (callback) => {
    const listener = (_event, paths) => callback(paths)
    ipcRenderer.on('app:open-files', listener)
    return () => ipcRenderer.removeListener('app:open-files', listener)
  },
  // 文件关联（打开方式 / 默认程序）
  registerFileAssociations: () => ipcRenderer.invoke('fileassoc:register'),
  unregisterFileAssociations: () => ipcRenderer.invoke('fileassoc:unregister'),
  isFileAssociationsRegistered: () => ipcRenderer.invoke('fileassoc:status'),
  // 版本与更新（关于 / 检查更新）
  appVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternalUrl: (url) => ipcRenderer.invoke('app:openExternal', { url }),
  // AI 配置与对话
  aiGetConfig: () => ipcRenderer.invoke('ai:getConfig'),
  aiSetConfig: (config) => ipcRenderer.invoke('ai:setConfig', config),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  // 流式 AI 对话：增量通过 onDelta 回调，结束通过 onDone / onError 回调
  aiChatStream: (payload, handlers) => {
    const requestId = String(payload?.requestId || '')
    if (!requestId) return Promise.resolve({ ok: false, error: '缺少请求标识' })
    const onChunk = (_event, data) => {
      if (data?.requestId !== requestId) return
      if (typeof handlers?.onDelta === 'function') handlers.onDelta(data.delta || '')
    }
    const onEnd = (_event, data) => {
      if (data?.requestId !== requestId) return
      cleanup()
      if (data?.ok) {
        if (typeof handlers?.onDone === 'function') handlers.onDone(data.content || '', data)
      } else if (typeof handlers?.onError === 'function') {
        handlers.onError(data?.error || '生成失败', data)
      }
    }
    function cleanup() {
      ipcRenderer.removeListener('ai:stream:chunk', onChunk)
      ipcRenderer.removeListener('ai:stream:end', onEnd)
    }
    // 先注册监听再发起请求，避免首个增量早于监听到达导致丢帧
    ipcRenderer.on('ai:stream:chunk', onChunk)
    ipcRenderer.on('ai:stream:end', onEnd)
    return ipcRenderer.invoke('ai:stream:start', { ...payload, requestId }).then((res) => {
      if (res?.ok) return { ok: true, requestId, stop: () => ipcRenderer.invoke('ai:stream:stop', { requestId }) }
      cleanup()
      return { ok: false, error: res?.error || '流式请求失败', stop: () => {} }
    })
  },
  aiTest: (provider) => ipcRenderer.invoke('ai:test', provider),
  // AI 对话会话（多会话：新建对话 / 历史对话，主窗口与独立对话窗口共享）
  aiChats: {
    list: () => ipcRenderer.invoke('ai:chats:list'),
    upsert: (session) => ipcRenderer.invoke('ai:chats:upsert', session),
    remove: (payload) => ipcRenderer.invoke('ai:chats:remove', payload),
    // 订阅会话变更（其它窗口写入 / 本窗口写入后都会触发），返回取消订阅函数
    onChanged: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('ai:chats:changed', listener)
      return () => ipcRenderer.removeListener('ai:chats:changed', listener)
    },
  },
  // AI 调用日志（按月落盘，可查询 / 查看详情 / 清理）
  aiLogMonths: () => ipcRenderer.invoke('ai:logs:months'),
  aiLogList: (query) => ipcRenderer.invoke('ai:logs:list', query),
  aiLogDetail: (payload) => ipcRenderer.invoke('ai:logs:detail', payload),
  aiLogDelete: (payload) => ipcRenderer.invoke('ai:logs:delete', payload),
  aiLogClear: (payload) => ipcRenderer.invoke('ai:logs:clear', payload),
  aiLogOpenDir: () => ipcRenderer.invoke('ai:logs:openDir'),
  // AI 文件引用（提取文本 / Office / 图片内容）
  extractFileForAi: (filePath) => ipcRenderer.invoke('file:extractForAi', filePath),
  selectAiFiles: () => ipcRenderer.invoke('dialog:selectAiFiles'),
  // 打开独立「AI 对话」窗口（已打开时复用并前置）
  openAiChatWindow: () => ipcRenderer.invoke('window:openAiChat'),
  // 调试（开发者工具）
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
  isDebugMode: () => ipcRenderer.invoke('app:isDebugMode'),
  // 终端（命令行）：在打开的目录 / 文件所在目录下打开 shell，支持多标签
  terminal: {
    shells: () => ipcRenderer.invoke('terminal:shells'),
    start: ({ cwd, shellId }) => ipcRenderer.invoke('terminal:start', { cwd, shellId }),
    write: ({ id, data }) => ipcRenderer.send('terminal:write', { id, data }),
    resize: ({ id, cols, rows }) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    // 只关闭本窗口创建的终端（多窗口下不影响其它窗口）
    killOwn: () => ipcRenderer.invoke('terminal:killOwn'),
    killAll: () => ipcRenderer.invoke('terminal:killAll'),
    complete: ({ id, cwd, kind, input, cursor }) =>
      ipcRenderer.invoke('terminal:complete', { id, cwd, kind, input, cursor }),
    // 系统外部终端：另开一个真实的终端窗口打开指定目录
    externalList: () => ipcRenderer.invoke('terminal:externalList'),
    openExternal: ({ dir, terminalId }) => ipcRenderer.invoke('terminal:openExternal', { dir, terminalId }),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
  },
  // JS 脚本运行：运行 .js 文件或代码片段（Markdown ```js 代码块 / .js 文件编辑器）
  script: {
    run: (payload) => ipcRenderer.invoke('script:run', payload || {}),
    kill: (id) => ipcRenderer.invoke('script:kill', id),
    // 只停止本窗口创建的脚本（多窗口下不影响其它窗口）
    killOwn: () => ipcRenderer.invoke('script:killOwn'),
    killAll: () => ipcRenderer.invoke('script:killAll'),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('script:data', listener)
      return () => ipcRenderer.removeListener('script:data', listener)
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('script:exit', listener)
      return () => ipcRenderer.removeListener('script:exit', listener)
    },
  },
  // Git 版本管理（目录为 Git 仓库时可用）
  git: {
    checkAvailable: () => ipcRenderer.invoke('git:checkAvailable'),
    getConfig: () => ipcRenderer.invoke('git:getConfig'),
    setConfig: (config) => ipcRenderer.invoke('git:setConfig', config),
    detect: (dirPath) => ipcRenderer.invoke('git:detect', { dirPath }),
    status: (repoRoot) => ipcRenderer.invoke('git:status', { repoRoot }),
    add: ({ repoRoot, paths }) => ipcRenderer.invoke('git:add', { repoRoot, paths }),
    unstage: ({ repoRoot, paths }) => ipcRenderer.invoke('git:unstage', { repoRoot, paths }),
    commit: ({ repoRoot, message }) => ipcRenderer.invoke('git:commit', { repoRoot, message }),
    diff: (payload) => ipcRenderer.invoke('git:diff', payload),
    log: (payload) => ipcRenderer.invoke('git:log', payload),
    restore: ({ repoRoot, paths }) => ipcRenderer.invoke('git:restore', { repoRoot, paths }),
    // 克隆远程仓库（从 Git 打开）
    clone: (args) => ipcRenderer.invoke('git:clone', args),
    /**
     * 订阅克隆进度，返回取消订阅函数
     * @param {(info: { phase: string, percent: number, text: string }) => void} callback 进度回调
     * @returns {() => void} 取消订阅
     */
    onCloneProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('git:cloneProgress', listener)
      return () => ipcRenderer.removeListener('git:cloneProgress', listener)
    },
    // P1：分支 / 远程同步 / 储藏 / 忽略规则
    branches: (repoRoot) => ipcRenderer.invoke('git:branches', { repoRoot }),
    checkout: (args) => ipcRenderer.invoke('git:checkout', args),
    deleteBranch: (args) => ipcRenderer.invoke('git:deleteBranch', args),
    remotes: (repoRoot) => ipcRenderer.invoke('git:remotes', { repoRoot }),
    fetch: (args) => ipcRenderer.invoke('git:fetch', args),
    pull: (args) => ipcRenderer.invoke('git:pull', args),
    push: (args) => ipcRenderer.invoke('git:push', args),
    stashList: (repoRoot) => ipcRenderer.invoke('git:stashList', { repoRoot }),
    stashSave: (args) => ipcRenderer.invoke('git:stashSave', args),
    stashApply: (args) => ipcRenderer.invoke('git:stashApply', args),
    stashDrop: (args) => ipcRenderer.invoke('git:stashDrop', args),
    readGitignore: (repoRoot) => ipcRenderer.invoke('git:readGitignore', { repoRoot }),
    writeGitignore: (args) => ipcRenderer.invoke('git:writeGitignore', args),
    ignorePath: (args) => ipcRenderer.invoke('git:ignorePath', args),
  },
  // Git 提交规范（内置默认 + 页面可编辑，用于 AI 生成提交信息）
  commitSpec: {
    get: () => ipcRenderer.invoke('commitSpec:get'),
    set: (config) => ipcRenderer.invoke('commitSpec:set', config),
    reset: (preset) => ipcRenderer.invoke('commitSpec:reset', { preset }),
  },
  // 进程管理（按端口 / 服务名查询进程并结束，解决端口被占用）
  process: {
    /**
     * 查询进程
     * @param {{ keyword?: string, mode?: string, deep?: boolean, onlyPorts?: boolean, refresh?: boolean }} payload 查询条件
     */
    search: (payload) => ipcRenderer.invoke('proc:search', payload || {}),
    /** 结束进程（tree 为 true 时连同子进程一起结束） */
    kill: (payload) => ipcRenderer.invoke('proc:kill', payload || {}),
  },
  // 快捷 AI 动作（内置生成类型与提示词，可定制修改）
  quickAi: {
    get: () => ipcRenderer.invoke('quickAi:get'),
    set: (config) => ipcRenderer.invoke('quickAi:set', config),
    reset: (payload) => ipcRenderer.invoke('quickAi:reset', payload || {}),
  },
  // Agent Skill 管理（workspace/.xj/skills + 内置）
  skills: {
    list: (workspaceRoot) => ipcRenderer.invoke('skills:list', { workspaceRoot }),
    get: (payload) => ipcRenderer.invoke('skills:get', payload || {}),
    readResource: (payload) => ipcRenderer.invoke('skills:readResource', payload || {}),
    import: (payload) => ipcRenderer.invoke('skills:import', payload || {}),
    remove: (payload) => ipcRenderer.invoke('skills:remove', payload || {}),
    setEnabled: (payload) => ipcRenderer.invoke('skills:setEnabled', payload || {}),
    reveal: (payload) => ipcRenderer.invoke('skills:reveal', payload || {}),
  },
  // Agent 运行（skill 执行；事件经 onAgentEvent 推送，工具调用经 onAgentToolCall 反向下发）
  agent: {
    run: (payload) => ipcRenderer.invoke('agent:run', payload || {}),
    stop: (runId) => ipcRenderer.invoke('agent:stop', { runId }),
    /** 渲染进程工具执行完成后回传结果（对应 agent:tool-call 的 callId） */
    toolResult: (payload) => ipcRenderer.send('agent:tool-result', payload || {}),
    /** 订阅 agent 运行事件（text-delta / reasoning-delta / tool-start / tool-result / done / error），返回取消订阅函数 */
    onEvent: (callback) => {
      const listener = (_event, data) => callback(data || {})
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    },
    /** 订阅工具调用请求，返回取消订阅函数 */
    onToolCall: (callback) => {
      const listener = (_event, data) => callback(data || {})
      ipcRenderer.on('agent:tool-call', listener)
      return () => ipcRenderer.removeListener('agent:tool-call', listener)
    },
  },
})
