const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, clipboard, nativeImage } = require('electron')
const { spawnSync } = require('child_process')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { pathToFileURL, fileURLToPath } = require('url')
const fileassoc = require('./fileassoc.cjs')
const docConvert = require('./docConvert.cjs')
const terminal = require('./terminal.cjs')
const scriptRunner = require('./script.cjs')

/** 独立的「AI 对话」窗口（与主窗口共享会话数据，最多一个） */
let aiChatWindow = null

/* ==================== 窗口注册表（多窗口：一窗口一文档 / 目录） ==================== */
/**
 * 窗口注册表：windowId -> 窗口条目
 * @typedef {{ id: number, win: Electron.BrowserWindow, role: 'main'|'ai-chat',
 *   filePath: string, dirPath: string, dirty: boolean, closeConfirmed: boolean,
 *   closePending: boolean, isPrimary: boolean }} WindowEntry
 */
/** @type {Map<number, WindowEntry>} */
const windows = new Map()
/** 窗口 id 自增序号（每次启动从 1 开始，首个主窗口即为 1） */
let windowSeq = 0
/** 最近一次获得焦点的主窗口 id */
let activeWindowId = null
/** 主窗口数量上限：避免无限开窗口拖垮内存 */
const MAX_MAIN_WINDOWS = 8
/** 应用是否正在退出（退出阶段不再逐个窗口弹未保存确认） */
let isQuitting = false
/** 暂存区当前归属窗口 id（同一时间只允许一个窗口编辑暂存区，避免互相覆盖） */
let scratchOwnerId = null

/**
 * 窗口是否仍然可用
 * @param {Electron.BrowserWindow | null} win 窗口
 * @returns {boolean} 可用返回 true
 */
function isAlive(win) {
  return !!win && !win.isDestroyed()
}

/** 全部可用的主窗口条目 */
function mainWindows() {
  return [...windows.values()].filter((e) => e.role === 'main' && isAlive(e.win))
}

/** 当前可用的主窗口数量 */
function countMainWindows() {
  return mainWindows().length
}

/** 最近活动的主窗口条目（聚焦窗口优先，其次首个主窗口） */
function activeEntry() {
  const focused = windows.get(activeWindowId)
  if (focused && focused.role === 'main' && isAlive(focused.win)) return focused
  return mainWindows()[0] || null
}

/** 最近活动的主窗口（系统对话框的宿主窗口） */
function activeWindow() {
  return activeEntry()?.win || null
}

/**
 * 由 IPC 事件反查发起请求的窗口条目：多窗口下所有窗口级操作都必须基于它，不能写死某个窗口
 * @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent | undefined} event IPC 事件
 * @returns {WindowEntry | null} 窗口条目
 */
function entryOfEvent(event) {
  const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
  if (!isAlive(win)) return null
  return [...windows.values()].find((e) => e.win === win) || null
}

/**
 * 由 IPC 事件取发起请求的窗口，取不到时回退到活动窗口
 * @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent | undefined} event IPC 事件
 * @returns {Electron.BrowserWindow | null} 窗口
 */
function winOfEvent(event) {
  return entryOfEvent(event)?.win || activeWindow()
}

/**
 * 前置并聚焦指定窗口（最小化时先还原）
 * @param {WindowEntry | null} entry 窗口条目
 */
function focusEntry(entry) {
  if (!entry || !isAlive(entry.win)) return
  activeWindowId = entry.id
  if (entry.win.isMinimized()) entry.win.restore()
  entry.win.show()
  entry.win.focus()
}

/** 路径比较：忽略大小写与分隔符差异（Windows 下路径分隔符可能混用） */
function samePath(a, b) {
  if (!a || !b) return false
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * 终端事件转发：把 shell 输出 / 退出事件推送给创建该会话的窗口
 * @param {string} channel 事件通道
 * @param {object} payload 事件数据
 * @param {number | null} ownerId 归属窗口 id
 */
function sendTerminalEvent(channel, payload, ownerId) {
  const entry = ownerId != null ? windows.get(ownerId) : null
  const win = entry && isAlive(entry.win) ? entry.win : activeWindow()
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
}
terminal.setEventSender(sendTerminalEvent)

/**
 * 脚本运行事件转发：把脚本输出 / 退出事件推送给创建该会话的窗口
 * @param {string} channel 事件通道
 * @param {object} payload 事件数据
 * @param {number | null} ownerId 归属窗口 id
 */
function sendScriptEvent(channel, payload, ownerId) {
  const entry = ownerId != null ? windows.get(ownerId) : null
  const win = entry && isAlive(entry.win) ? entry.win : activeWindow()
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
}
scriptRunner.setEventSender(sendScriptEvent)

/** 待打开的外部文件队列（活动主窗口挂载后通过 app:getStartupFiles 拉取） */
let pendingOpenFiles = []

/* ==================== 窗口会话记忆（重启后恢复多窗口） ==================== */
/** 窗口会话持久化路径（应用数据目录） */
const workspacePath = () => path.join(app.getPath('userData'), 'workspace.json')
/** 会话缓存：{ slotSeq, windows: [{ slot, filePath, dirPath, bounds, maximized, active }] } */
let workspaceCache = null
/** 会话写盘防抖定时器 */
let workspaceTimer = null
/** 已分配的最大槽位号：槽位是持久化的工作区编号，跨重启保持稳定，渲染进程按它读写本窗口状态 */
let slotSeq = 0

/**
 * 读取窗口会话记录（首次读取后缓存）
 * @returns {{slotSeq: number, windows: Array<object>}} 会话记录
 */
function readWorkspace() {
  if (workspaceCache) return workspaceCache
  try {
    const raw = JSON.parse(fs.readFileSync(workspacePath(), 'utf-8'))
    const list = Array.isArray(raw?.windows) ? raw.windows : []
    workspaceCache = {
      slotSeq: Number(raw?.slotSeq) || 0,
      windows: list.filter((w) => w && typeof w === 'object').slice(0, MAX_MAIN_WINDOWS),
    }
  } catch {
    workspaceCache = { slotSeq: 0, windows: [] }
  }
  slotSeq = Math.max(slotSeq, workspaceCache.slotSeq || 0)
  return workspaceCache
}

/** 分配一个新的持久化槽位号 */
function allocSlot() {
  return ++slotSeq
}

/** 立即写入会话记录：仅在仍有窗口时写入，全部关闭时保留上次记录，下次启动可恢复 */
function flushWorkspace() {
  try {
    const list = mainWindows()
    if (!list.length) return
    const ws = readWorkspace()
    ws.slotSeq = slotSeq
    ws.windows = list.map((e) => ({
      slot: e.slot,
      filePath: e.filePath || '',
      dirPath: e.dirPath || '',
      bounds: isAlive(e.win) && !e.win.isDestroyed() ? e.win.getBounds() : null,
      maximized: isAlive(e.win) && !e.win.isDestroyed() ? e.win.isMaximized() : false,
      active: e.id === activeWindowId,
    }))
    fs.writeFileSync(workspacePath(), JSON.stringify({ slotSeq, windows: ws.windows }, null, 2))
  } catch {
    /* 会话写入失败不影响使用 */
  }
}

/** 防抖写入会话记录（窗口上下文变化 / 移动缩放时调用） */
function scheduleWorkspaceSave() {
  if (workspaceTimer) clearTimeout(workspaceTimer)
  workspaceTimer = setTimeout(() => {
    workspaceTimer = null
    flushWorkspace()
  }, 800)
}

/**
 * 按会话记录重建窗口（上次关闭前的多个窗口）
 * @returns {boolean} 是否恢复了至少一个窗口
 */
function restoreWorkspace() {
  const ws = readWorkspace()
  if (!ws.windows.length) return false
  let restored = 0
  for (const w of ws.windows) {
    // 记录的文件已不存在时降级为该目录（或空窗口），避免新窗口打开失败
    const filePath = w.filePath && fs.existsSync(w.filePath) ? w.filePath : ''
    const created = createWindow({
      slot: Number(w.slot) || undefined,
      filePath,
      dirPath: w.dirPath || '',
      bounds: w.bounds,
      maximized: !!w.maximized,
    })
    if (!created) break
    restored++
  }
  if (!restored) return false
  // 聚焦上次活动的窗口
  const list = mainWindows()
  const idx = Math.max(0, ws.windows.findIndex((w) => w.active))
  focusEntry(list[idx] || list[0] || null)
  return true
}

/**
 * 调试模式判定：启动参数含 --debug / -d，或环境变量 MD_DEBUG=1 / true。
 * 调试模式下启动即自动打开开发者工具（类似浏览器 F12）。
 */
function isDebugMode() {
  if (process.env.MD_DEBUG === '1' || process.env.MD_DEBUG === 'true') return true
  return process.argv.some((arg) => arg === '--debug' || arg === '-d')
}

/** 从启动参数中提取待打开的文件路径（跳过应用自身、flag 与目录参数） */
function extractFilePaths(argv) {
  const list = []
  for (const arg of Array.isArray(argv) ? argv.slice(1) : []) {
    if (!arg || arg.startsWith('-') || arg === '.' || arg === '..') continue
    try {
      if (fs.statSync(arg).isFile()) list.push(path.resolve(arg))
    } catch {
      /* 非文件参数，忽略 */
    }
  }
  return list
}

/**
 * 向指定窗口推送待打开文件；窗口仍在加载时等加载完成后再推，避免事件丢失
 * @param {WindowEntry | null} entry 目标窗口条目
 * @param {string[]} paths 文件路径列表
 */
function sendOpenFiles(entry, paths) {
  if (!entry || !isAlive(entry.win) || !paths || !paths.length) return
  const wc = entry.win.webContents
  if (wc.isDestroyed()) return
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => {
      if (!wc.isDestroyed()) wc.send('app:open-files', paths)
    })
    return
  }
  wc.send('app:open-files', paths)
}

/**
 * 路由单个待打开文件：
 * - 文件已在某个窗口打开 -> 直接聚焦该窗口（不重复加载）
 * - 否则交给最近活动的窗口（渲染进程内部已有未保存确认）
 * @param {string} filePath 文件绝对路径
 */
function routeOpenFile(filePath) {
  if (!filePath) return
  // 没有任何主窗口：入队，等首个主窗口挂载后主动拉取
  if (!countMainWindows()) {
    pendingOpenFiles.push(filePath)
    return
  }
  const opened = mainWindows().find((e) => samePath(e.filePath, filePath))
  if (opened) {
    focusEntry(opened)
    return
  }
  const target = activeEntry()
  if (!target) {
    pendingOpenFiles.push(filePath)
    return
  }
  sendOpenFiles(target, [filePath])
}

/**
 * 将外部文件派发给渲染进程（双击关联文件 / 拖拽到快捷方式 / open-file 事件）
 * @param {string[]} paths 文件路径列表
 */
function deliverOpenFiles(paths) {
  if (!paths || !paths.length) return
  for (const p of paths) routeOpenFile(p)
}

// 自定义协议 mdlocal:// 用于在渲染进程中直接访问本地文件（图片 / PDF / Office 预览）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mdlocal',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

/* ==================== 文件归属（同一文件只允许一个窗口编辑） ==================== */
/** 文件路径 -> 占用它的窗口 id，避免两个窗口同时编辑同一文件互相覆盖 */
const fileOwners = new Map()

/** 生成文件归属表的键：统一分隔符并小写（Windows 路径不区分大小写） */
function fileKey(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase()
}

/** 释放指定窗口占用的全部文件（窗口关闭时调用） */
function releaseFileOwners(winId) {
  for (const [key, id] of [...fileOwners]) {
    if (id === winId) fileOwners.delete(key)
  }
}

/* ==================== 退出流程（有未保存修改时逐个窗口确认） ==================== */
/** 是否正在走「退出前逐个确认」流程 */
let quitPending = false

/** 询问下一个仍有未保存修改的窗口；全部处理完才真正退出 */
function nextQuitWindow() {
  const dirty = mainWindows().filter((e) => e.dirty && !e.closeConfirmed)
  const entry = dirty[0]
  if (!entry) {
    finishQuit()
    return
  }
  focusEntry(entry)
  if (!isAlive(entry.win) || entry.win.webContents.isDestroyed()) {
    entry.closeConfirmed = true
    nextQuitWindow()
    return
  }
  // quitting=true 时渲染进程会提示"还有几个窗口未保存"，避免用户以为是关窗口
  entry.win.webContents.send('app:request-close', { quitting: true, remaining: dirty.length })
}

/** 所有窗口都已确认（保存 / 放弃），真正退出应用 */
function finishQuit() {
  quitPending = false
  isQuitting = true
  // 退出前同步落盘完整会话，供下次启动恢复（防抖写入可能还没触发）
  flushWorkspace()
  terminal.killAll()
  scriptRunner.killAll()
  app.quit()
}

/**
 * 创建主窗口（多窗口：每个窗口拥有独立的渲染进程，各自编辑一个文件 / 目录）
 * @param {{dirPath?: string, filePath?: string, refEntry?: WindowEntry | null, slot?: number,
 *   bounds?: Electron.Rectangle | null, maximized?: boolean}} options 初始上下文
 * @returns {WindowEntry | null} 窗口条目（已达上限时返回 null）
 */
function createWindow(options = {}) {
  if (countMainWindows() >= MAX_MAIN_WINDOWS) return null
  const isPrimary = countMainWindows() === 0
  const id = ++windowSeq
  // 槽位：持久化的工作区编号，重启恢复时沿用，保证每窗口状态（目录 / 布局）不串
  const slot = Number(options.slot) || allocSlot()
  // 初始上下文通过 additionalArguments 注入渲染进程（新窗口据此打开指定文件 / 目录）
  const init = { id, slot, dir: options.dirPath || '', file: options.filePath || '' }
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Markdown 编辑器',
    icon: path.join(__dirname, '../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--md-win-id=${id}`, `--md-init=${encodeURIComponent(JSON.stringify(init))}`],
    },
  })

  // 位置：恢复会话时用记录的位置，否则相对参照窗口级联偏移，避免多窗口完全重叠
  if (options.bounds && Number.isFinite(options.bounds.x) && Number.isFinite(options.bounds.width)) {
    win.setBounds(options.bounds)
    if (options.maximized) win.maximize()
  } else {
    const ref = options.refEntry && isAlive(options.refEntry.win) ? options.refEntry.win : activeWindow()
    if (ref && !ref.isDestroyed()) {
      const [x, y] = ref.getPosition()
      win.setPosition(x + 30, y + 30)
    }
  }

  // 开发模式加载 dev server，生产模式加载打包文件
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 调试模式：自动打开开发者工具（分离窗口，类似浏览器 F12）
  if (isDebugMode()) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  /** @type {WindowEntry} */
  const entry = {
    id,
    slot,
    win,
    role: 'main',
    filePath: '',
    dirPath: options.dirPath || '',
    dirty: false,
    closeConfirmed: false,
    closePending: false,
    isPrimary,
  }
  windows.set(id, entry)
  if (!activeWindowId) activeWindowId = id

  win.on('focus', () => {
    activeWindowId = id
    scheduleWorkspaceSave()
  })

  // 移动 / 缩放后记忆位置，供下次启动恢复
  const onBoundsChanged = () => scheduleWorkspaceSave()
  win.on('moved', onBoundsChanged)
  win.on('resized', onBoundsChanged)
  win.on('maximize', onBoundsChanged)
  win.on('unmaximize', onBoundsChanged)
  scheduleWorkspaceSave()

  // 关闭前拦截：有未保存修改时交由渲染进程确认（保存 / 放弃 / 取消）
  win.on('close', (e) => {
    if (isQuitting || !entry.dirty || entry.closeConfirmed) return
    if (!isAlive(win) || win.webContents.isDestroyed()) return
    e.preventDefault()
    entry.closePending = true
    win.webContents.send('app:request-close', { quitting: false, remaining: 1 })
  })

  win.on('closed', () => {
    windows.delete(id)
    if (activeWindowId === id) activeWindowId = null
    // 暂存区归属随窗口释放，其它窗口才能继续编辑
    if (scratchOwnerId === id) scratchOwnerId = null
    // 释放本窗口占用的文件，其它窗口才能重新打开
    releaseFileOwners(id)
    // 只回收本窗口的终端会话，不影响其它窗口
    terminal.killByOwner(id)
    // 只回收本窗口的脚本运行会话，不影响其它窗口
    scriptRunner.killByOwner(id)
    // 中断本窗口发起的 agent 运行（skill 执行），不影响其它窗口
    if (agentRunner) agentRunner.disposeSender(win.webContents)
    // 摘除本窗口后重新记录会话；退出阶段不重写，否则窗口逐个关闭会把会话缩减成只剩一个
    if (!isQuitting && !quitPending) flushWorkspace()
    // 退出流程中：继续询问下一个仍有未保存修改的窗口
    if (quitPending) nextQuitWindow()
    // 所有主窗口都关闭后：兜底清理终端，并关闭独立对话窗口
    if (!countMainWindows()) {
      terminal.killAll()
      scriptRunner.killAll()
      if (aiChatWindow && !aiChatWindow.isDestroyed()) aiChatWindow.close()
    }
  })

  return entry
}

/**
 * 独立「AI 对话」窗口：与主窗口共享同一份会话数据（ai-chats.json）。
 * 通过 URL hash（#ai-chat）让渲染进程只渲染聊天界面。
 * @returns {Electron.BrowserWindow} 对话窗口（已存在时直接复用并前置）
 */
function createAiChatWindow() {
  if (aiChatWindow && !aiChatWindow.isDestroyed()) {
    if (aiChatWindow.isMinimized()) aiChatWindow.restore()
    aiChatWindow.show()
    aiChatWindow.focus()
    return aiChatWindow
  }
  const chatId = ++windowSeq
  aiChatWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 380,
    minHeight: 480,
    title: 'AI 对话',
    icon: path.join(__dirname, '../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--md-win-id=${chatId}`, `--md-init=${encodeURIComponent(JSON.stringify({ id: chatId }))}`],
    },
  })
  // 对话窗口同样纳入注册表（role 区分，不计入主窗口数量）
  windows.set(chatId, {
    id: chatId,
    win: aiChatWindow,
    role: 'ai-chat',
    filePath: '',
    dirPath: '',
    dirty: false,
    closeConfirmed: false,
    closePending: false,
    isPrimary: false,
  })

  // 开发模式加载 dev server，生产模式加载打包文件（hash 决定渲染聊天界面）
  if (process.env.VITE_DEV_SERVER_URL) {
    const base = String(process.env.VITE_DEV_SERVER_URL).replace(/\/$/, '')
    aiChatWindow.loadURL(`${base}#ai-chat`)
  } else {
    aiChatWindow.loadURL(`${pathToFileURL(path.join(__dirname, '../dist/index.html')).href}#ai-chat`)
  }

  aiChatWindow.on('closed', () => {
    windows.delete(chatId)
    aiChatWindow = null
  })
  return aiChatWindow
}

/**
 * 构建应用菜单：提供刷新 / 开发者工具（F12 调试）等入口。
 * 菜单栏默认隐藏（autoHideMenuBar），按 Alt 唤出；调试入口对日常用户不可见。
 */
function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          click: () => createWindow({ dirPath: activeEntry()?.dirPath || '' }),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 注册 mdlocal:// 协议：mdlocal:///C:/path/to/file.png -> 返回本地文件内容
function registerLocalProtocol() {
  protocol.handle('mdlocal', (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)
      // mdlocal:///C:/a/b.png -> pathname=/C:/a/b.png，去掉前导斜杠
      if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1)
      else if (filePath.startsWith('/')) filePath = filePath.slice(1)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      return new Response('Not Found', { status: 404 })
    }
  })
}

// 单实例锁：应用已运行时，双击关联文件 / 拖拽文件到快捷方式会触发 second-instance
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // 已有实例：把新实例收到的文件按路由策略转发给现有窗口
    deliverOpenFiles(extractFilePaths(argv))
  })

  // macOS：Finder 中双击关联文件 / 拖拽到 Dock 图标
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    deliverOpenFiles([filePath])
  })

  app.whenReady().then(() => {
    registerLocalProtocol()
    buildAppMenu()
    // AI 调用日志：按月写入应用数据目录下的 ai-logs
    aiLogger.initAiLogger(app.getPath('userData'))
    aiChats.setChatsPath(aiChatsPath())
    // Agent Skill：内置目录（dev 用项目 skills/，打包用 resources/skills）+ 启用状态文件
    skillsMod.initSkillsBuiltinDir(
      app.isPackaged
        ? path.join(process.resourcesPath, 'skills')
        : path.join(app.getAppPath(), 'skills'),
    )
    skillsMod.initSkillsState(app.getPath('userData'))
    // 启动参数携带的文件（双击关联文件 / 拖拽到快捷方式）：先入队，首个窗口挂载后主动拉取
    deliverOpenFiles(extractFilePaths(process.argv))
    // 优先按上次会话重建多个窗口，失败（首次启动 / 无记录）时只建一个窗口
    if (!restoreWorkspace()) createWindow()

    app.on('activate', () => {
      if (countMainWindows() === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出：还有未保存修改时逐个窗口确认（任一窗口选择"取消"则中断退出）
app.on('before-quit', (e) => {
  // 已在确认流程中（finishQuit 再次调用）→ 放行
  if (quitPending) {
    isQuitting = true
    flushWorkspace()
    terminal.killAll()
    scriptRunner.killAll()
    return
  }
  const dirty = mainWindows().filter((en) => en.dirty && !en.closeConfirmed)
  if (!dirty.length) {
    isQuitting = true
    // 退出前同步落盘完整会话，保证重启能恢复全部窗口
    flushWorkspace()
    terminal.killAll()
    scriptRunner.killAll()
    return
  }
  e.preventDefault()
  quitPending = true
  nextQuitWindow()
})

/* ==================== IPC：文件操作 ==================== */

// 打开文件（任意类型，具体内容由 file:read 读取）
ipcMain.handle('dialog:open', async (event) => {
  const result = await dialog.showOpenDialog(winOfEvent(event), {
    title: '打开文件',
    filters: [
      {
        name: '支持的文件',
        extensions: [
          'md', 'markdown', 'mdown', 'mkd', 'txt', 'sql', 'log', 'json', 'xml', 'yaml', 'yml', 'csv',
          'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
          'rtf', 'epub', 'odt', 'ods', 'odp',
          'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
          'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz',
        ],
      },
      { name: '压缩包', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'] },
      {
        name: '文本文件',
        extensions: [
          'md', 'markdown', 'mdown', 'mkd', 'txt', 'sql', 'log', 'json', 'xml', 'yaml', 'yml', 'csv',
          'ini', 'conf', 'properties', 'java', 'py', 'js', 'ts', 'jsx', 'tsx', 'c', 'cpp', 'h', 'cs',
          'go', 'rs', 'rb', 'php', 'sh', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'vue',
        ],
      },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  return { canceled: false, filePath: result.filePaths[0] }
})

// 打开目录（可选：自定义标题与起始路径）
ipcMain.handle('dialog:openDirectory', async (event, payload = {}) => {
  const result = await dialog.showOpenDialog(winOfEvent(event), {
    title: payload.title || '打开目录',
    defaultPath: payload.defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
})

// 选择图片（可多选）
ipcMain.handle('dialog:selectImages', async (event) => {
  const result = await dialog.showOpenDialog(winOfEvent(event), {
    title: '选择图片',
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) return { canceled: true }
  return { canceled: false, filePaths: result.filePaths }
})

// 目录树中需要忽略的文件：系统隐藏文件、Office/WPS 打开时生成的临时锁文件
function isIgnoredEntry(name) {
  if (name.startsWith('.')) return true
  if (name.startsWith('~$')) return true
  return false
}

// 读取目录（单层）
ipcMain.handle('dir:read', async (_event, { dirPath }) => {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const children = []
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue // 跳过隐藏文件与 ~$ 临时文件
      const full = path.join(dirPath, entry.name)
      let size = 0
      let mtime = 0
      try {
        const stat = await fsp.stat(full)
        size = stat.size
        mtime = stat.mtime.getTime()
      } catch {
        /* 忽略无权限文件 */
      }
      children.push({
        name: entry.name,
        path: full,
        isDirectory: entry.isDirectory(),
        ext: entry.isDirectory() ? '' : path.extname(entry.name).replace(/^\./, '').toLowerCase(),
        size,
        mtime,
      })
    }
    children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return { ok: true, path: dirPath, children }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ========== 目录搜索：文件名 + 文本内容 ========== */
/** 可参与内容搜索的文本类扩展名（二进制容器格式如 pdf/docx/xlsx 不解析） */
const SEARCH_TEXT_EXTS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'log', 'json', 'jsonc', 'json5',
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'vue', 'svelte',
  'css', 'scss', 'sass', 'less', 'styl', 'html', 'htm', 'xhtml', 'xml', 'svg',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env',
  'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'py', 'rb', 'php', 'pl', 'lua', 'r',
  'java', 'kt', 'kts', 'scala', 'groovy', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift',
  'csv', 'tsv', 'tex', 'gradle', 'dockerfile', 'gitignore', 'editorconfig',
])
/** 单个文件参与内容搜索的体积上限（2MB，避免读取超大文件拖慢搜索） */
const SEARCH_TEXT_MAX_FILE_BYTES = 2 * 1024 * 1024
/** 最多扫描的文件数 / 最多返回的命中数 / 最多递归层级 / 总耗时预算 */
const SEARCH_TEXT_MAX_FILES = 3000
const SEARCH_TEXT_MAX_MATCHES = 300
const SEARCH_TEXT_MAX_DEPTH = 12
const SEARCH_TEXT_BUDGET_MS = 8000
/** 搜索时直接跳过的重型目录 */
const SEARCH_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.cache', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'out', 'release', 'coverage', 'target', 'vendor',
])

/** 统计关键字在文本中出现的次数（最多统计 99 次，防止恶意大文本空转） */
function countOccurrences(haystackLower, needleLower) {
  if (!needleLower) return 0
  let count = 0
  let from = 0
  while (count < 99) {
    const idx = haystackLower.indexOf(needleLower, from)
    if (idx < 0) break
    count++
    from = idx + needleLower.length
  }
  return count
}

/** 取命中位置前后的上下文片段，压缩空白后用作悬浮提示 */
function buildSnippet(content, index, length) {
  const start = Math.max(0, index - 40)
  const end = Math.min(content.length, index + length + 40)
  return content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 目录搜索：遍历 rootPath，文件名包含关键字或文本内容包含关键字都算命中。
 * 单次 IPC 完成整棵树的遍历，避免前端逐文件往返。
 */
/** 最新一次搜索的序号：新搜索发起后，仍在遍历中的旧搜索自行中止 */
let latestSearchId = 0

ipcMain.handle('dir:searchText', async (_event, { rootPath, keyword }) => {
  const kw = String(keyword || '')
  if (!rootPath || !kw) return { ok: true, hits: [], truncated: false, scannedFiles: 0 }
  const searchId = ++latestSearchId
  const lower = kw.toLowerCase()
  const hits = []
  let scannedFiles = 0
  let truncated = false
  const started = Date.now()

  const walk = async (dirPath, depth) => {
    // 已有更新的搜索发起：立即停止，避免多路遍历叠加占用 CPU
    if (truncated || searchId !== latestSearchId) return
    if (depth > SEARCH_TEXT_MAX_DEPTH || Date.now() - started > SEARCH_TEXT_BUDGET_MS) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true })
    } catch {
      return // 无权限目录直接跳过
    }
    for (const entry of entries) {
      if (truncated || searchId !== latestSearchId) return
      if (isIgnoredEntry(entry.name)) continue
      const full = path.join(dirPath, entry.name)
      const nameLower = entry.name.toLowerCase()

      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(nameLower)) continue
        if (nameLower.includes(lower)) {
          hits.push({
            name: entry.name,
            path: full,
            isDirectory: true,
            ext: '',
            nameMatch: true,
            contentMatches: 0,
            snippet: '',
          })
          if (hits.length >= SEARCH_TEXT_MAX_MATCHES) {
            truncated = true
            return
          }
        }
        await walk(full, depth + 1)
        continue
      }

      scannedFiles++
      if (scannedFiles > SEARCH_TEXT_MAX_FILES) {
        truncated = true
        return
      }

      const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase()
      const nameMatch = nameLower.includes(lower)
      let contentMatches = 0
      let snippet = ''
      if (SEARCH_TEXT_EXTS.has(ext) || !ext) {
        try {
          const stat = await fsp.stat(full)
          if (stat.size > 0 && stat.size <= SEARCH_TEXT_MAX_FILE_BYTES) {
            const buf = await fsp.readFile(full)
            // 前 8KB 含 NUL 视为二进制，跳过内容匹配
            if (!buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) {
              const { content } = decodeText(buf)
              const idx = content.toLowerCase().indexOf(lower)
              if (idx >= 0) {
                contentMatches = countOccurrences(content.toLowerCase(), lower)
                snippet = buildSnippet(content, idx, kw.length)
              }
            }
          }
        } catch {
          /* 读取失败（占用 / 无权限）按未命中处理 */
        }
      }

      if (nameMatch || contentMatches > 0) {
        hits.push({ name: entry.name, path: full, isDirectory: false, ext, nameMatch, contentMatches, snippet })
        if (hits.length >= SEARCH_TEXT_MAX_MATCHES) {
          truncated = true
          return
        }
      }
    }
  }

  try {
    await walk(rootPath, 1)
    return { ok: true, hits, truncated, scannedFiles }
  } catch (err) {
    return { ok: false, error: err.message, hits: [], truncated, scannedFiles }
  }
})

// 文本解码：UTF-8 / UTF-16LE / UTF-16BE BOM 检测，默认 UTF-8
function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: buf.subarray(3).toString('utf8'), encoding: 'utf-8' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: buf.subarray(2).toString('utf16le'), encoding: 'utf-16le' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]
      swapped[i] = swapped[i + 1]
      swapped[i + 1] = t
    }
    return { content: swapped.toString('utf16le'), encoding: 'utf-16be' }
  }
  return { content: buf.toString('utf8'), encoding: 'utf-8' }
}

// 读取文件：自动区分文本 / 二进制
ipcMain.handle('file:read', async (_event, { filePath }) => {
  try {
    const buf = await fsp.readFile(filePath)
    const sample = buf.subarray(0, Math.min(buf.length, 8192))
    const isText = !sample.includes(0) // 二进制文件前 8KB 大概率包含 NUL
    if (!isText) {
      return { ok: true, path: filePath, isText: false, content: '', size: buf.length }
    }
    const { content, encoding } = decodeText(buf)
    return { ok: true, path: filePath, isText: true, content, encoding, size: buf.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 读取文件为 base64 data URL（用于图床上传）
ipcMain.handle('file:readDataUrl', async (_event, { filePath }) => {
  try {
    const buf = await fsp.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.avif': 'image/avif',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 直接保存文本文件（不弹对话框）
ipcMain.handle('file:save', async (_event, { filePath, content }) => {
  try {
    await fsp.writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 保存文件（指定路径）
ipcMain.handle('dialog:save', async (_event, { filePath, content }) => {
  fs.writeFileSync(filePath, content, 'utf-8')
  return { canceled: false, filePath }
})

// 另存为（filters 可缺省：代码块导出等场景会按扩展名传入自定义过滤器）
const DEFAULT_SAVE_FILTERS = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown'] },
  { name: 'HTML 文件', extensions: ['html', 'htm'] },
  { name: '文本文件', extensions: ['txt', 'sql', 'log', 'json'] },
  { name: '所有文件', extensions: ['*'] },
]

ipcMain.handle('dialog:saveAs', async (event, { content, defaultPath, filters }) => {
  const result = await dialog.showSaveDialog(winOfEvent(event), {
    title: '另存为',
    defaultPath: defaultPath || '未命名.md',
    filters: Array.isArray(filters) && filters.length ? filters : DEFAULT_SAVE_FILTERS,
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  fs.writeFileSync(result.filePath, content, 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

// 导出 HTML
ipcMain.handle('dialog:exportHtml', async (event, { html, defaultPath }) => {
  const result = await dialog.showSaveDialog(winOfEvent(event), {
    title: '导出为 HTML',
    defaultPath: defaultPath || '未命名.html',
    filters: [{ name: 'HTML 文件', extensions: ['html'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  fs.writeFileSync(result.filePath, html, 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

/* ==================== 导出 PDF ==================== */

/** printToPDF 支持的内置纸张尺寸白名单 */
const PDF_PAGE_SIZES = new Set(['A3', 'A4', 'A5', 'Letter'])
/** 自定义纸张的毫米边界（太小无法排版，太大浏览器会拒绝） */
const PDF_CUSTOM_MIN_MM = 50
const PDF_CUSTOM_MAX_MM = 1200

/** 把任意输入钳制到 [min, max] 的有限数字，非法值回退 */
function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

/**
 * 打印基础样式：所有导出都会注入。
 * sourceFile 模式（HTML / 图片直接打印源文件）尤其需要，避免滚动条、深色背景、
 * 默认外边距混进 PDF。
 */
const PRINT_BASE_CSS = `
html, body { background: #fff !important; }
body { margin: 0 !important; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
::-webkit-scrollbar { display: none !important; }
`

/**
 * 打印前等待页面就绪：字体加载完成 + 所有图片解码完成 + 两帧布局稳定。
 * 不等待会出现 PDF 里图片空白、公式字体未生效、图表尺寸未收敛等问题。
 */
const PDF_READY_SCRIPT = `(async () => {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready } catch (e) {}
  try {
    await Promise.all(Array.from(document.images).map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()))
  } catch (e) {}
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return true
})()`

/**
 * 组装 printToPDF 参数。
 * 纸张尺寸与页边距由主进程统一控制（不让 CSS 的 @page 参与，避免两处口径打架）；
 * 页边距单位换算为英寸，页码页脚额外预留底部空间。
 */
function buildPdfPrintOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const marginMm = clampNumber(o.marginMm, 0, 40, 14)
  const marginIn = marginMm / 25.4
  const showPageNumber = o.showPageNumber !== false
  const landscape = !!o.landscape

  // 自定义宽度/高度（毫米）优先；自定义尺寸自行交换宽高，避免与 landscape 参数双重生效
  const customWidthMm = clampNumber(o.customWidthMm, PDF_CUSTOM_MIN_MM, PDF_CUSTOM_MAX_MM, 0)
  const customHeightMm = clampNumber(o.customHeightMm, PDF_CUSTOM_MIN_MM, PDF_CUSTOM_MAX_MM, 0)
  let pageSize
  let useLandscape = landscape
  if (customWidthMm && customHeightMm) {
    const w = (landscape ? customHeightMm : customWidthMm) / 25.4
    const h = (landscape ? customWidthMm : customHeightMm) / 25.4
    pageSize = { width: w, height: h }
    useLandscape = false
  } else {
    pageSize = PDF_PAGE_SIZES.has(o.pageSize) ? o.pageSize : 'A4'
  }

  const footerHtml =
    '<div style="width:100%;padding:0 12mm;font-size:8px;color:#909399;text-align:center;' +
    'font-family:\'Microsoft YaHei\',\'微软雅黑\',sans-serif;">' +
    '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>'
  return {
    pageSize,
    landscape: useLandscape,
    printBackground: true,
    displayHeaderFooter: showPageNumber,
    headerTemplate: '<div></div>',
    footerTemplate: showPageNumber ? footerHtml : '<div></div>',
    margins: {
      top: marginIn,
      // 页脚区域需要独立的底部留白，否则页码会压在正文最后一行上
      bottom: marginIn + (showPageNumber ? 0.28 : 0),
      left: marginIn,
      right: marginIn,
    },
  }
}

/**
 * 导出 PDF：渲染进程生成「打印用 HTML」（已内联 KaTeX 字体、图片换 mdlocal 绝对路径），
 * 主进程写入临时文件后用隐藏窗口的 Chromium 打印成矢量 PDF，再落盘到用户选择的位置。
 *
 * 用隐藏窗口而不是当前窗口打印：避免把工具栏 / 侧边栏 / 主题背景一并打进 PDF。
 */
ipcMain.handle('dialog:exportPdf', async (event, { html, sourceFile, injectCss, defaultPath, options } = {}) => {
  const hasHtml = typeof html === 'string' && !!html.trim()
  const hasSource = typeof sourceFile === 'string' && !!sourceFile.trim()
  if (!hasHtml && !hasSource) {
    return { canceled: false, error: '没有可导出的内容' }
  }
  const result = await dialog.showSaveDialog(winOfEvent(event), {
    title: '导出为 PDF',
    defaultPath: defaultPath || '未命名.pdf',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  // 只有 html 模式需要落临时文件；sourceFile 模式直接打印源文件（相对资源天然可用）
  const tmpPath = hasHtml
    ? path.join(app.getPath('temp'), `xj-print-${process.pid}-${Date.now()}.html`)
    : ''
  /** @type {Electron.BrowserWindow | null} */
  let printer = null
  try {
    if (hasHtml) await fsp.writeFile(tmpPath, html, 'utf-8')
    printer = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // 隐藏窗口默认会被节流，导致字体 / 图片 / rAF 等待变慢
        backgroundThrottling: false,
      },
    })
    // 文档里的外链不应在打印窗口里开新窗口
    printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    printer.webContents.on('will-navigate', (e) => e.preventDefault())
    await printer.loadFile(hasHtml ? tmpPath : sourceFile)
    await printer.webContents.insertCSS(PRINT_BASE_CSS)
    if (typeof injectCss === 'string' && injectCss.trim()) {
      await printer.webContents.insertCSS(injectCss)
    }
    try {
      await Promise.race([
        printer.webContents.executeJavaScript(PDF_READY_SCRIPT, true),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ])
    } catch {
      // 页面脚本异常不应阻断导出，交给 printToPDF 处理
    }
    const pdf = await printer.webContents.printToPDF(buildPdfPrintOptions(options))
    await fsp.writeFile(result.filePath, pdf)
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    return { canceled: false, error: err && err.message ? err.message : String(err) }
  } finally {
    if (printer && !printer.isDestroyed()) printer.destroy()
    if (tmpPath) fsp.unlink(tmpPath).catch(() => {})
  }
})

// 导出 Word（.docx）：二进制由渲染进程生成（docx 库），主进程只负责落盘
ipcMain.handle('dialog:exportDocx', async (event, { data, defaultPath }) => {
  const result = await dialog.showSaveDialog(winOfEvent(event), {
    title: '导出为 Word',
    defaultPath: defaultPath || '未命名.docx',
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    const buf = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []))
    fs.writeFileSync(result.filePath, buf)
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    return { canceled: false, error: err.message }
  }
})

/**
 * 静默写入二进制文件（不弹对话框），用于「转 Word」直接落到 md 同级目录。
 * 目标已存在且未显式允许覆盖时返回 needConfirm，由渲染进程询问用户后再写一次。
 */
ipcMain.handle('file:writeBinary', async (_event, { filePath, data, overwrite }) => {
  try {
    const target = String(filePath || '')
    if (!target) return { ok: false, error: '路径为空' }
    if (fs.existsSync(target) && !overwrite) {
      return { ok: false, needConfirm: true, filePath: target }
    }
    const buf = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []))
    await fsp.writeFile(target, buf)
    return { ok: true, filePath: target }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 读取本地文件的二进制内容（导出 Word 时嵌入本地图片用）
ipcMain.handle('file:readBinary', async (_event, { filePath }) => {
  try {
    const buf = await fsp.readFile(String(filePath || ''))
    return { ok: true, data: new Uint8Array(buf) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 下载远程资源为二进制（图床 / PlantUML 图片等；走主进程可绕开渲染进程 CORS 限制）
ipcMain.handle('net:fetchBinary', async (_event, { url, timeout }) => {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(timeout) || 10000)
    let res
    try {
      res = await net.fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    return { ok: true, data: new Uint8Array(await res.arrayBuffer()), contentType }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 一键转换：将 Office / PDF / RTF / EPUB / ODT / CSV 等文档转为 Markdown 文件
// imageConfig 为渲染进程的图片配置（type: none/picgo/custom），用于按配置处理嵌入图片
ipcMain.handle('file:convertToMarkdown', async (_event, { filePath, imageConfig }) => {
  try {
    const res = await docConvert.convertFileToMarkdown(filePath, { imageConfig })
    if (!res.ok) {
      return { ok: false, error: res.error, code: res.code || '' }
    }
    return {
      ok: true,
      targetPath: res.targetPath,
      exportedAssets: res.exportedAssets || [],
      warnings: res.warnings || [],
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 重命名文件 / 文件夹（保留原目录）
ipcMain.handle('file:rename', async (_event, { oldPath, newName }) => {
  try {
    const name = String(newName || '').trim()
    if (!name) return { ok: false, error: '名称不能为空' }
    if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: '名称包含非法字符 \\ / : * ? " < > |' }
    const newPath = path.join(path.dirname(oldPath), name)
    // Windows 下允许仅大小写不同的改名（如 a.md -> A.md）
    if (fs.existsSync(newPath) && newPath.toLowerCase() !== oldPath.toLowerCase()) {
      return { ok: false, error: '同名文件（或文件夹）已存在' }
    }
    await fsp.rename(oldPath, newPath)
    return { ok: true, path: newPath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 新建文件（空内容）
/** Markdown 扩展名集合（新建这类文件时自动写入元数据块） */
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd'])

/** 将时间格式化为 YYYY-MM-DD HH:mm:ss */
function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 生成新建 Markdown 文件的元数据块：title 取文件名，createDate/lastUpdateDate 取当前时间 */
function buildMarkdownMetadata(fileName) {
  const base = path.basename(fileName, path.extname(fileName))
  const now = formatDateTime()
  return `---\ntitle: ${base}\ncreateDate: ${now}\nlastUpdateDate: ${now}\n---\n`
}

ipcMain.handle('file:create', async (_event, { dirPath, fileName }) => {
  try {
    const name = String(fileName || '').trim()
    if (!name) return { ok: false, error: '文件名不能为空' }
    if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: '文件名包含非法字符 \\ / : * ? " < > |' }
    const target = path.join(dirPath, name)
    if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在' }
    const ext = path.extname(name).toLowerCase()
    const content = MARKDOWN_EXTS.has(ext) ? buildMarkdownMetadata(name) : ''
    await fsp.writeFile(target, content, 'utf-8')
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 复制文件 / 文件夹到目标目录（同名时自动追加"副本"）
ipcMain.handle('file:copy', async (_event, { srcPath, destDir }) => {
  try {
    if (!srcPath || !destDir) return { ok: false, error: '参数不完整' }
    if (!fs.existsSync(srcPath)) return { ok: false, error: '源文件不存在' }
    if (!fs.existsSync(destDir)) return { ok: false, error: '目标目录不存在' }
    const stat = await fsp.stat(srcPath)
    // 目录不能复制到自身或其子目录内
    if (stat.isDirectory()) {
      const srcNorm = path.resolve(srcPath)
      const destNorm = path.resolve(destDir)
      if (destNorm === srcNorm || destNorm.startsWith(srcNorm + path.sep)) {
        return { ok: false, error: '不能复制到自身或其子目录内' }
      }
    }
    const name = path.basename(srcPath)
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    let dest = path.join(destDir, name)
    let i = 1
    while (fs.existsSync(dest)) {
      dest = path.join(destDir, `${base} 副本${i > 1 ? ` ${i}` : ''}${ext}`)
      i++
    }
    if (stat.isDirectory()) await fsp.cp(srcPath, dest, { recursive: true })
    else await fsp.copyFile(srcPath, dest)
    return { ok: true, path: dest, name: path.basename(dest) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 新建文件夹
ipcMain.handle('dir:create', async (_event, { dirPath, dirName }) => {
  try {
    const name = String(dirName || '').trim()
    if (!name) return { ok: false, error: '文件夹名不能为空' }
    if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: '文件夹名包含非法字符 \\ / : * ? " < > |' }
    const target = path.join(dirPath, name)
    if (fs.existsSync(target)) return { ok: false, error: '同名文件夹已存在' }
    await fsp.mkdir(target)
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 删除文件 / 文件夹（文件夹递归删除）
ipcMain.handle('file:delete', async (_event, { filePath }) => {
  try {
    await fsp.rm(filePath, { recursive: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 导入本地图片：复制到目标目录（重名自动加序号）
ipcMain.handle('image:import', async (_event, { sourcePaths, targetDir }) => {
  try {
    await fsp.mkdir(targetDir, { recursive: true })
    const results = []
    for (const src of sourcePaths) {
      const name = path.basename(src)
      const ext = path.extname(name)
      const base = path.basename(name, ext)
      let fileName = name
      let dest = path.join(targetDir, fileName)
      let i = 1
      while (fs.existsSync(dest)) {
        fileName = `${base}-${i}${ext}`
        dest = path.join(targetDir, fileName)
        i++
      }
      await fsp.copyFile(src, dest)
      results.push({ sourcePath: src, targetPath: dest, fileName })
    }
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 保存粘贴的图片（base64 data URL 写入目标目录）
ipcMain.handle('image:saveData', async (_event, { dataUrl, targetDir, fileName }) => {
  try {
    await fsp.mkdir(targetDir, { recursive: true })
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
    const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] || ''
    let name = fileName || `image-${Date.now()}.png`
    if (!/\.\w+$/.test(name)) {
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
        'image/avif': '.avif',
      }
      name += extMap[mime] || '.png'
    }
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    let dest = path.join(targetDir, name)
    let i = 1
    while (fs.existsSync(dest)) {
      dest = path.join(targetDir, `${base}-${i}${ext}`)
      i++
    }
    await fsp.writeFile(dest, Buffer.from(base64, 'base64'))
    return { ok: true, targetPath: dest, fileName: path.basename(dest) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ==================== 应用图片目录（集中管理嵌入图片） ====================
// 优先使用安装/运行目录下的 images 文件夹；若不可写（如 Program Files），回退到应用数据目录
let appImagesDirCache = null
async function getAppImagesDir() {
  if (appImagesDirCache) return appImagesDirCache
  const candidates = [
    path.join(app.getAppPath(), 'images'),
    path.join(app.getPath('userData'), 'images'),
  ]
  for (const dir of candidates) {
    try {
      await fsp.mkdir(dir, { recursive: true })
      const testFile = path.join(dir, `.write-test-${Date.now()}`)
      await fsp.writeFile(testFile, '')
      await fsp.unlink(testFile)
      appImagesDirCache = dir
      return dir
    } catch {
      /* 尝试下一个候选目录 */
    }
  }
  appImagesDirCache = path.join(app.getPath('userData'), 'images')
  return appImagesDirCache
}

// 返回应用图片目录
ipcMain.handle('app:getImagesDir', async () => {
  try {
    const dir = await getAppImagesDir()
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ==================== 版本 / 检查更新（GitHub Releases） ====================
const GITHUB_OWNER = 'xiuji008'
const GITHUB_REPO = 'xj-editor'
const GITHUB_PROJECT_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** 当前应用版本号（package.json version） */
ipcMain.handle('app:getVersion', () => {
  return { ok: true, name: app.getName(), version: app.getVersion(), projectUrl: GITHUB_PROJECT_URL }
})

/**
 * 检查更新：请求 GitHub Releases 最新版本并与当前版本比较。
 * 网络不可用 / 请求失败时返回 ok=false 与错误信息，不弹窗打扰。
 */
ipcMain.handle('app:checkUpdate', async () => {
  const currentVersion = app.getVersion()
  try {
    // 12s 超时：GitHub API 偶发连不上，避免界面一直转圈
    const res = await net.fetch(GITHUB_LATEST_RELEASE_API, {
      headers: { 'User-Agent': `${GITHUB_REPO}-updater`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const error = res.status === 404 ? '项目暂未发布 Release' : `GitHub 返回 ${res.status}`
      return { ok: false, currentVersion, error }
    }
    const data = await res.json()
    const latestVersion = String(data.tag_name || '').replace(/^v/i, '')
    if (!latestVersion) {
      return { ok: false, currentVersion, error: '未获取到最新版本号' }
    }
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: data.html_url || GITHUB_PROJECT_URL,
      releaseName: data.name || '',
      notes: typeof data.body === 'string' ? data.body.slice(0, 4000) : '',
      publishedAt: data.published_at || '',
    }
  } catch (err) {
    return { ok: false, currentVersion, error: err && err.message ? err.message : '网络请求失败' }
  }
})

/**
 * 比较两个点分版本号：a > b 返回 1，a < b 返回 -1，相等返回 0。
 * 仅支持数字段（1.2.10），非数字段按 0 处理。
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** 在系统默认浏览器中打开外部链接（仅允许 http / https） */
ipcMain.handle('app:openExternal', (_event, payload = {}) => {
  const url = String(payload.url || '')
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '不支持的链接' }
  return shell.openExternal(url).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: err && err.message ? err.message : '打开失败' }),
  )
})

// ==================== 暂存文件（内置草稿本） ====================
// 应用内置的固定文件，用于临时拷贝 / 暂存信息：
// 优先放在安装目录（exe 所在目录），不可写（如 Program Files）时回退到应用数据目录。
// 该文件不在左侧目录树中展示，只能通过工具栏「暂存区」按钮打开。
const SCRATCH_FILE_NAME = '暂存区.md'

/** 暂存文件初始内容：带元数据块的说明文档 */
function buildScratchTemplate() {
  const now = formatDateTime()
  return `---\ntitle: 暂存区\ncreateDate: ${now}\nlastUpdateDate: ${now}\n---\n\n# 暂存区\n\n用于临时拷贝、暂存文本与资料。\n\n- 内容自动保存，切换文件或关闭应用无需手动保存\n- 不在左侧目录树中展示，随时点击工具栏「暂存区」按钮即可回到这里\n`
}

let scratchPathCache = null

/** 确定暂存文件路径（不存在则创建），返回可写的文件路径 */
async function resolveScratchPath() {
  if (scratchPathCache && fs.existsSync(scratchPathCache)) return scratchPathCache
  const fallback = path.join(app.getPath('userData'), SCRATCH_FILE_NAME)
  const candidates = []
  // 开发模式：优先应用数据目录，避免在开发依赖目录中生成文件
  if (!app.isPackaged) candidates.push(fallback)
  try {
    candidates.push(path.join(path.dirname(app.getPath('exe')), SCRATCH_FILE_NAME))
  } catch {
    /* 取不到 exe 目录时跳过 */
  }
  try {
    candidates.push(path.join(app.getAppPath(), SCRATCH_FILE_NAME))
  } catch {
    /* 取不到应用目录时跳过 */
  }
  candidates.push(fallback)
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        await fsp.access(file, fs.constants.W_OK)
      } else {
        await fsp.mkdir(path.dirname(file), { recursive: true })
        await fsp.writeFile(file, buildScratchTemplate(), 'utf-8')
      }
      scratchPathCache = file
      return file
    } catch {
      /* 当前位置不可写，尝试下一个候选位置 */
    }
  }
  scratchPathCache = fallback
  return fallback
}

// 获取暂存文件路径（文件被删除时自动重建；仅取路径，不占用编辑归属）
ipcMain.handle('scratch:get', async () => {
  try {
    const filePath = await resolveScratchPath()
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/**
 * 打开暂存区并占用编辑归属：
 * 暂存区是全局单文件，多窗口同时编辑会互相覆盖，因此同一时间只允许一个窗口编辑。
 * 已被其它窗口占用时，前置该窗口并返回 locked，由渲染进程提示用户。
 */
ipcMain.handle('scratch:open', async (event) => {
  try {
    const filePath = await resolveScratchPath()
    const entry = entryOfEvent(event)
    if (scratchOwnerId != null && scratchOwnerId !== (entry?.id ?? null)) {
      const owner = windows.get(scratchOwnerId)
      if (owner && isAlive(owner.win)) focusEntry(owner)
      return { ok: true, path: filePath, locked: true }
    }
    scratchOwnerId = entry?.id ?? null
    return { ok: true, path: filePath, locked: false }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 清空暂存文件（恢复为初始内容），返回清空后的内容
ipcMain.handle('scratch:clear', async () => {
  try {
    const filePath = await resolveScratchPath()
    const content = buildScratchTemplate()
    await fsp.writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath, content }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ==================== 图片另存为（预览区右键保存） ====================
// source 支持三种来源：
//   { type: 'local', path }  -> 直接读取本地文件
//   { type: 'url', url }     -> 由主进程 net.fetch 下载（不受渲染进程 CORS 限制）
//   { type: 'data', dataUrl } -> 渲染进程生成的 base64（SVG/Canvas 导出等）
const MIME_EXT_MAP = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
}

ipcMain.handle('image:saveAs', async (event, { source, defaultName } = {}) => {
  try {
    if (!source || !source.type) return { ok: false, error: '参数不完整' }
    let buffer = null
    let defaultPath = defaultName || 'image.png'
    if (source.type === 'local') {
      buffer = fs.readFileSync(source.path)
      if (!path.extname(defaultPath)) defaultPath = path.basename(source.path)
    } else if (source.type === 'url') {
      const res = await net.fetch(source.url)
      if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
      buffer = Buffer.from(await res.arrayBuffer())
      const ctype = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const ext = MIME_EXT_MAP[ctype]
      if (ext && !path.extname(defaultPath)) defaultPath += ext
    } else if (source.type === 'data') {
      const base64 = String(source.dataUrl || '').replace(/^data:[^;]+;base64,/, '')
      if (!base64) return { ok: false, error: '图片数据为空' }
      buffer = Buffer.from(base64, 'base64')
      const mime = /^data:([^;]+);/.exec(String(source.dataUrl || ''))?.[1] || ''
      const ext = MIME_EXT_MAP[mime]
      if (ext && !path.extname(defaultPath)) defaultPath += ext
    }
    if (!buffer) return { ok: false, error: '无法读取图片数据' }
    const result = await dialog.showSaveDialog(winOfEvent(event), {
      title: '图片另存为',
      defaultPath,
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    await fsp.writeFile(result.filePath, buffer)
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
})

// 导入本地图片到应用图片目录（重名自动加序号）
ipcMain.handle('image:importApp', async (_event, { sourcePaths }) => {
  try {
    const targetDir = await getAppImagesDir()
    await fsp.mkdir(targetDir, { recursive: true })
    const results = []
    for (const src of sourcePaths || []) {
      const name = path.basename(src)
      const ext = path.extname(name)
      const base = path.basename(name, ext)
      let fileName = name
      let dest = path.join(targetDir, fileName)
      let i = 1
      while (fs.existsSync(dest)) {
        fileName = `${base}-${i}${ext}`
        dest = path.join(targetDir, fileName)
        i++
      }
      await fsp.copyFile(src, dest)
      results.push({ sourcePath: src, targetPath: dest, fileName })
    }
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 保存粘贴的图片（base64 data URL）到应用图片目录
ipcMain.handle('image:saveAppData', async (_event, { dataUrl, fileName }) => {
  try {
    const targetDir = await getAppImagesDir()
    await fsp.mkdir(targetDir, { recursive: true })
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
    const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] || ''
    let name = fileName || `image-${Date.now()}.png`
    if (!/\.\w+$/.test(name)) {
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
        'image/avif': '.avif',
      }
      name += extMap[mime] || '.png'
    }
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    let dest = path.join(targetDir, name)
    let i = 1
    while (fs.existsSync(dest)) {
      dest = path.join(targetDir, `${base}-${i}${ext}`)
      i++
    }
    await fsp.writeFile(dest, Buffer.from(base64, 'base64'))
    return { ok: true, targetPath: dest, fileName: path.basename(dest) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 在文件夹中显示
ipcMain.handle('shell:reveal', (_event, { filePath }) => {
  shell.showItemInFolder(filePath)
})

// 用系统默认程序打开
ipcMain.handle('shell:openPath', async (_event, { filePath }) => {
  return { ok: true, error: await shell.openPath(filePath) }
})

// 用系统默认浏览器打开链接（Markdown 预览中的 http/https/mailto/tel 链接）
ipcMain.handle('shell:openUrl', (_event, { url }) => {
  if (!/^(https?:|mailto:|tel:)/i.test(String(url || ''))) {
    return { ok: false, error: '不支持的链接协议' }
  }
  shell.openExternal(url)
  return { ok: true }
})

/* ==================== IPC：系统剪贴板与文件拖拽 ==================== */

/**
 * 拖拽时显示在光标旁的默认图标：内嵌 32×32 PNG，
 * 不依赖磁盘文件，开发模式与打包后均可用。
 */
const DRAG_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAYUlEQVR42mNgGAWDGTj03PpPLMZlRs++D/8HzAEgy/E5jqYOgFk+IA5AtpzuDkC3nK4OwGY53RyAy3K6OYCcLDr0HEAsGL4OGE0Do2lgNA2MpoHRNDCaBkbTAN0dMAroAQCHiw2jqCyY0wAAAABJRU5ErkJggg=='

/** 拖拽图标缓存：目录统一为 ':dir:'，文件按扩展名归类，避免每次拖拽都读取系统图标 */
const dragIconCache = new Map()

/**
 * 拖拽图标缓存 key
 * @param {string} filePath 文件 / 目录绝对路径
 * @param {boolean} isDirectory 是否为目录
 * @returns {string} 缓存 key
 */
function dragIconKey(filePath, isDirectory) {
  return isDirectory ? ':dir:' : path.extname(filePath).toLowerCase() || ':file:'
}

/**
 * 读取文件 / 目录的系统图标，失败时返回 null
 * @param {string} filePath 绝对路径
 * @returns {Promise<Electron.NativeImage|null>} 图标
 */
async function safeFileIcon(filePath) {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' })
    return icon && !icon.isEmpty() ? icon : null
  } catch {
    return null
  }
}

/**
 * 组装拖拽图标：优先使用缓存的系统图标，否则使用内嵌默认图标
 * @param {string} filePath 文件 / 目录绝对路径
 * @param {boolean} isDirectory 是否为目录
 * @returns {Electron.NativeImage} 图标
 */
function buildDragIcon(filePath, isDirectory) {
  const key = dragIconKey(filePath, isDirectory)
  return dragIconCache.get(key) || nativeImage.createFromDataURL(DRAG_ICON_DATA_URL)
}

/**
 * 预取系统图标写入缓存（异步执行，不影响本次拖拽）
 * @param {string} filePath 文件 / 目录绝对路径
 * @param {boolean} isDirectory 是否为目录
 */
function prefetchDragIcon(filePath, isDirectory) {
  const key = dragIconKey(filePath, isDirectory)
  if (dragIconCache.has(key)) return
  safeFileIcon(filePath).then((icon) => {
    if (icon) dragIconCache.set(key, icon)
  })
}

/**
 * 过滤出不重复且真实存在的绝对路径（复制 / 拖拽只接受真实路径）
 * @param {unknown} paths 路径列表
 * @returns {string[]} 合法路径
 */
function normalizeExistingPaths(paths) {
  if (!Array.isArray(paths)) return []
  const list = []
  for (const p of paths) {
    if (typeof p !== 'string' || !p.trim()) continue
    const abs = path.resolve(p)
    if (list.includes(abs)) continue
    if (!fs.existsSync(abs)) continue
    list.push(abs)
  }
  return list
}

/**
 * XML 转义（macOS 剪贴板 plist 使用）
 * @param {string} s 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Windows 兜底方案：调用 PowerShell 把文件列表写入系统剪贴板（CF_HDROP）
 * @param {string[]} paths 绝对路径
 * @returns {{ ok: boolean, count: number, error?: string }} 写入结果
 */
function copyFilesByPowerShell(paths) {
  const items = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  const script = `Add-Type -AssemblyName System.Windows.Forms; $c = New-Object System.Collections.Specialized.StringCollection; [void]$c.AddRange([string[]]@(${items})); [System.Windows.Forms.Clipboard]::SetFileDropList($c)`
  try {
    const res = spawnSync(
      'powershell',
      ['-STA', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { timeout: 5000, windowsHide: true, encoding: 'utf8' },
    )
    if (res.error) return { ok: false, count: 0, error: res.error.message }
    if (res.status !== 0) {
      return { ok: false, count: 0, error: (res.stderr || '').trim() || 'PowerShell 写入剪贴板失败' }
    }
    return { ok: true, count: paths.length }
  } catch (err) {
    return { ok: false, count: 0, error: err.message }
  }
}

/**
 * 把文件 / 文件夹写入系统剪贴板，之后可在资源管理器 / Finder / 桌面按 Ctrl+V 粘贴。
 * Windows 写入 CF_HDROP，macOS 写入 NSFilenamesPboardType，Linux 写入 gnome / uri-list。
 * @param {string[]} paths 文件 / 文件夹绝对路径
 * @returns {{ ok: boolean, count: number, error?: string }} 写入结果
 */
function writeFilesToClipboard(paths) {
  const list = normalizeExistingPaths(paths)
  if (!list.length) return { ok: false, count: 0, error: '文件不存在' }
  try {
    if (process.platform === 'win32') {
      // Electron 内部接口可写入标准 CF_HDROP（公共 API 暂未开放），不可用时走 PowerShell 兜底
      if (typeof clipboard._writeFilesForTesting === 'function') {
        clipboard._writeFilesForTesting(list)
        return { ok: true, count: list.length }
      }
      return copyFilesByPowerShell(list)
    }
    if (process.platform === 'darwin') {
      const items = list.map((p) => `    <string>${escapeXml(p)}</string>`).join('\n')
      const plist = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + '<plist version="1.0">\n  <array>\n'
        + `${items}\n`
        + '  </array>\n</plist>\n'
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'))
      return { ok: true, count: list.length }
    }
    const uris = list.map((p) => pathToFileURL(p).href)
    clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`copy\n${uris.join('\n')}\n`, 'utf8'))
    clipboard.writeBuffer('text/uri-list', Buffer.from(`${uris.join('\r\n')}\r\n`, 'utf8'))
    return { ok: true, count: list.length }
  } catch (err) {
    return { ok: false, count: 0, error: err.message }
  }
}

// 复制文件 / 文件夹到系统剪贴板：可在桌面或任意文件夹按 Ctrl+V 粘贴
ipcMain.handle('clipboard:writeFiles', (_event, payload) => {
  return writeFilesToClipboard(payload?.paths)
})

/**
 * 读取系统剪贴板中复制的文件 / 文件夹路径（资源管理器 Ctrl+C 后粘贴进目录树）。
 * Windows 读 CF_HDROP（'FileNameW'），macOS 读 NSFilenamesPboardType，Linux 读 gnome / uri-list。
 * @returns {{ ok: boolean, paths: string[], error?: string }}
 */
function readFilesFromClipboard() {
  try {
    let paths = []
    if (process.platform === 'win32') {
      // CF_HDROP 的 UTF-16 编码视图：路径以 \0 分隔（Electron 公共 API 未开放，走私有格式名）
      const raw = clipboard.readBuffer('FileNameW').toString('ucs2')
      paths = raw.split('\0').map((p) => p.trim()).filter(Boolean)
    } else if (process.platform === 'darwin') {
      const xml = clipboard.readBuffer('NSFilenamesPboardType').toString('utf8')
      paths = [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1])
    } else {
      const gnome = clipboard.readBuffer('x-special/gnome-copied-files').toString('utf8')
      const uriText = gnome || clipboard.readBuffer('text/uri-list').toString('utf8')
      paths = uriText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line !== 'copy' && line !== 'cut')
        .map((line) => {
          try {
            return line.startsWith('file://') ? fileURLToPath(line) : line
          } catch {
            return ''
          }
        })
        .filter(Boolean)
    }
    const valid = normalizeExistingPaths(paths)
    return { ok: true, paths: valid }
  } catch (err) {
    return { ok: false, paths: [], error: err.message }
  }
}

// 读取系统剪贴板中的文件 / 文件夹路径列表（目录树 Ctrl+V 粘贴外部复制内容用）
ipcMain.handle('clipboard:readFiles', () => {
  return readFilesFromClipboard()
})

// HTML → 纯文本（主进程无 DOM，用正则剥标签），用于富文本剪贴板的 text/plain 兜底
function htmlToPlainText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 富文本复制：直接在主进程写系统剪贴板（text/html + text/plain）。
// 渲染进程的 execCommand('copy') 依赖文档焦点 / 用户手势，任一不满足就会退化成纯文本；
// 主进程 clipboard.write 无此限制，桌面端富文本复制一律优先走这里。
ipcMain.handle('clipboard:writeRich', (_event, payload) => {
  try {
    const html = typeof payload?.html === 'string' ? payload.html : ''
    const text = typeof payload?.text === 'string' ? payload.text : ''
    if (!html && !text) return { ok: false, error: '内容为空' }
    clipboard.write({ html, text: text || htmlToPlainText(html) })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// 目录树节点拖拽：发起系统级文件拖拽，可直接拖到桌面 / 任意文件夹，效果等同复制
ipcMain.on('drag:startFiles', (event, payload) => {
  const list = normalizeExistingPaths(payload?.paths)
  if (!list.length || !event.sender || event.sender.isDestroyed()) return
  const first = list[0]
  let isDirectory = false
  try {
    isDirectory = fs.statSync(first).isDirectory()
  } catch {
    return
  }
  try {
    event.sender.startDrag({ file: first, files: list, icon: buildDragIcon(first, isDirectory) })
  } catch (err) {
    console.error('[drag:startFiles] 启动系统拖拽失败：', err.message)
  }
  prefetchDragIcon(first, isDirectory)
})

// 查询路径是文件还是目录（渲染进程处理系统文件拖入时使用）
ipcMain.handle('file:stat', (_event, { filePath }) => {
  try {
    const stat = fs.statSync(filePath)
    return { ok: true, path: filePath, isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ==================== IPC：调试（开发者工具） ==================== */

// 切换开发者工具（渲染进程按 F12 调用，只作用于调用方所在窗口）
ipcMain.handle('window:toggleDevTools', (event) => {
  const win = winOfEvent(event)
  if (win && !win.isDestroyed()) {
    win.webContents.toggleDevTools()
    return { ok: true }
  }
  return { ok: false }
})

// 查询是否处于调试模式（渲染进程可据此展示调试状态）
ipcMain.handle('app:isDebugMode', () => ({ ok: true, debug: isDebugMode() }))

/**
 * 渲染进程上报窗口上下文（当前文件 / 目录 / 是否有未保存修改）。
 * 主进程据此做外部文件路由与关闭确认，避免多窗口互相干扰。
 */
ipcMain.on('window:setContext', (event, payload = {}) => {
  const entry = entryOfEvent(event)
  if (!entry) return
  const prevPath = entry.filePath
  const nextPath = String(payload.filePath || '')
  entry.filePath = nextPath
  entry.dirPath = String(payload.dirPath || '')
  entry.dirty = !!payload.dirty
  // 暂存区归属窗口切走了该文件：释放归属，其它窗口才能继续编辑暂存区
  if (scratchOwnerId === entry.id && scratchPathCache && nextPath !== scratchPathCache) {
    scratchOwnerId = null
  }
  // 文件归属切换：登记 / 释放，并检测「同一文件在另一个窗口已打开」
  if (!samePath(prevPath, nextPath)) {
    if (prevPath && fileOwners.get(fileKey(prevPath)) === entry.id) fileOwners.delete(fileKey(prevPath))
    if (nextPath) {
      const key = fileKey(nextPath)
      const ownerId = fileOwners.get(key)
      if (ownerId != null && ownerId !== entry.id) {
        // 已被其它窗口占用：通知本窗口提示，由用户决定是否切换过去
        if (isAlive(entry.win) && !entry.win.webContents.isDestroyed()) {
          entry.win.webContents.send('app:file-conflict', { filePath: nextPath })
        }
      } else {
        fileOwners.set(key, entry.id)
      }
    }
  }
  // 会话记录：目录 / 文件变化后更新，供下次启动恢复
  scheduleWorkspaceSave()
})

// 更新窗口标题（作用于调用方所在窗口）
ipcMain.on('window:setTitle', (event, title) => {
  const win = winOfEvent(event)
  if (win && !win.isDestroyed()) {
    win.setTitle(title || 'Markdown 编辑器')
  }
})

// 修改状态（用于 Windows 任务栏/标题闪烁提示，可选）
ipcMain.on('window:setModified', (event, modified) => {
  const entry = entryOfEvent(event)
  const win = entry?.win || winOfEvent(event)
  if (entry) entry.dirty = !!modified
  if (win && !win.isDestroyed()) {
    win.setDocumentEdited(!!modified)
  }
})

/* ==================== IPC：多窗口管理 ==================== */

// 新建窗口（沿用发起窗口的目录），返回新窗口 id
ipcMain.handle('window:new', (event, payload = {}) => {
  const entry = entryOfEvent(event) || activeEntry()
  const created = createWindow({ dirPath: payload?.dirPath || entry?.dirPath || '', refEntry: entry })
  if (!created) return { ok: false, error: `最多同时打开 ${MAX_MAIN_WINDOWS} 个窗口` }
  return { ok: true, id: created.id }
})

// 在新窗口中打开文件（文件已在某窗口打开时聚焦该窗口）
ipcMain.handle('window:openInNew', (event, payload = {}) => {
  const filePath = String(payload?.filePath || '')
  if (!filePath) return { ok: false, error: '文件路径为空' }
  const opened = mainWindows().find((e) => samePath(e.filePath, filePath))
  if (opened) {
    focusEntry(opened)
    return { ok: true, id: opened.id, reused: true }
  }
  const entry = entryOfEvent(event) || activeEntry()
  const created = createWindow({ filePath, dirPath: payload?.dirPath || '', refEntry: entry })
  if (!created) return { ok: false, error: `最多同时打开 ${MAX_MAIN_WINDOWS} 个窗口` }
  return { ok: true, id: created.id }
})

/**
 * 渲染进程对关闭确认的答复：save（已保存）/ discard（放弃）/ cancel（取消关闭）
 * 主进程收到后才会真正关闭窗口
 */
ipcMain.on('window:close:reply', (event, payload = {}) => {
  const entry = entryOfEvent(event)
  if (!entry) return
  entry.closePending = false
  if (payload?.action === 'cancel') {
    // 退出流程中取消：中断整个退出，保留所有窗口
    if (quitPending) quitPending = false
    return
  }
  entry.closeConfirmed = true
  // 关闭后由 closed 事件推进退出流程（继续询问下一个未保存的窗口）
  if (isAlive(entry.win)) entry.win.close()
})

// 聚焦正在编辑指定文件的窗口（文件冲突提示后「切换到该窗口」）
ipcMain.handle('window:focusFile', (_event, payload = {}) => {
  const filePath = String(payload?.filePath || '')
  if (!filePath) return { ok: false, error: '文件路径为空' }
  const entry = mainWindows().find((e) => samePath(e.filePath, filePath))
  if (!entry) return { ok: false, error: '没有窗口打开该文件' }
  focusEntry(entry)
  return { ok: true, id: entry.id }
})

/* ==================== IPC：外部文件打开与文件关联 ==================== */

// 渲染进程挂载时拉取启动参数携带的文件（队列取完即清空）
// 多窗口恢复时仅活动窗口可取，避免后台窗口打开后前台仍显示旧文件
ipcMain.handle('app:getStartupFiles', (event) => {
  const entry = entryOfEvent(event)
  const target = activeEntry()
  if (!entry || !target || entry.id !== target.id) return { ok: true, paths: [] }
  const paths = [...pendingOpenFiles]
  pendingOpenFiles.length = 0
  return { ok: true, paths }
})

// 注册文件关联（写入 HKCU，无需管理员权限）
ipcMain.handle('fileassoc:register', async () => {
  try {
    return await fileassoc.register()
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 取消文件关联
ipcMain.handle('fileassoc:unregister', async () => {
  try {
    return await fileassoc.unregister()
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 查询文件关联状态
ipcMain.handle('fileassoc:status', () => fileassoc.status())

/* ==================== IPC：AI 配置与对话 ==================== */
const ai = require('./ai.cjs')
const aiLogger = require('./aiLogger.cjs')
const aiChats = require('./aiChats.cjs')
/* ==================== Agent Skill（workspace/.xj/skills + 内置） ==================== */
const skillsMod = require('./skills.cjs')
const agentRunner = require('./agent.cjs')

// 读取 skill 列表（顺带记录 workspace 根，供 getSkill / remove 等接口校验归属）
ipcMain.handle('skills:list', (_event, payload) => {
  skillsMod.setLastWorkspaceRoot(payload?.workspaceRoot || '')
  return skillsMod.listSkills(payload)
})
ipcMain.handle('skills:get', (_event, payload) => skillsMod.getSkill(payload))
ipcMain.handle('skills:readResource', (_event, payload) => skillsMod.readSkillResource(payload))
ipcMain.handle('skills:import', (_event, payload) => skillsMod.importSkill(payload))
ipcMain.handle('skills:remove', (_event, payload) => skillsMod.removeSkill(payload))
ipcMain.handle('skills:setEnabled', (_event, payload) => skillsMod.setSkillEnabled(payload))
ipcMain.handle('skills:reveal', async (_event, payload) => {
  try {
    const res = await shell.openPath(String(payload?.rootPath || ''))
    return { ok: !res, error: res || '' }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})
// agent 运行：streamText 多步工具调用，事件经 agent:event 推回发起窗口
agentRunner.registerAgentIpc(ipcMain)

const aiConfigPath = () => path.join(app.getPath('userData'), 'ai-config.json')
/** AI 对话会话持久化路径（多会话：新建对话 / 历史对话，主窗口与独立对话窗口共享） */
const aiChatsPath = () => path.join(app.getPath('userData'), 'ai-chats.json')

/**
 * 记录一次 AI 调用日志（异步落盘，失败不影响主流程）
 * @param {object} entry 调用详情，结构见 aiLogger.logAiCall
 */
function recordAiCall(entry) {
  aiLogger.logAiCall(entry).catch(() => {})
}

// 读取 AI 配置
ipcMain.handle('ai:getConfig', async () => {
  return ai.getAiConfig(aiConfigPath())
})

// 保存 AI 配置
ipcMain.handle('ai:setConfig', async (_event, config) => {
  try {
    await ai.saveAiConfig(aiConfigPath(), config)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// AI 对话（单次请求，返回完整文本）
ipcMain.handle('ai:chat', async (_event, payload) => {
  const provider = payload?.provider
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const scene = payload?.scene || 'chat'
  const started = Date.now()
  try {
    if (!provider?.id) return { ok: false, error: '未选择 AI 厂商' }
    if (!messages.length) return { ok: false, error: '对话内容为空' }
    const result = await ai.chatWithProvider(provider, messages, payload.temperature)
    const content = result.content || ''
    recordAiCall({
      requestId: payload?.requestId,
      scene,
      provider,
      request: result.request,
      messages,
      temperature: payload.temperature,
      stream: false,
      ok: true,
      content,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
      finishReason: result.finishReason,
    })
    return { ok: true, content }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? '请求超时，请检查网络或稍后重试' : err?.message || String(err)
    recordAiCall({
      requestId: payload?.requestId,
      scene,
      provider,
      messages,
      temperature: payload.temperature,
      stream: false,
      ok: false,
      error: msg,
      elapsedMs: Date.now() - started,
    })
    return { ok: false, error: msg }
  }
})

/** 进行中的流式 AI 对话：requestId -> AbortController（用于「停止生成」） */
const aiStreams = new Map()

/**
 * 向发起请求的渲染进程推送流式对话事件
 * @param {Electron.WebContents} sender 发起请求的 webContents
 * @param {string} channel 事件通道
 * @param {object} payload 事件数据（含 requestId）
 */
function sendAiStreamEvent(sender, channel, payload) {
  if (sender && !sender.isDestroyed()) sender.send(channel, payload)
}

/**
 * 统一转换 AI 请求错误为可读提示
 * @param {unknown} err 异常
 * @returns {string} 错误提示
 */
function aiErrorMessage(err) {
  if (err?.name === 'AbortError') return '已停止生成'
  return err?.message || String(err)
}

/**
 * 流式 AI 对话：立即返回，增量文本通过 ai:stream:chunk 事件推送，结束通过 ai:stream:end 推送。
 * 厂商不支持流式且尚未产出任何内容时，自动降级为一次性请求。
 */
ipcMain.handle('ai:stream:start', async (event, payload = {}) => {
  const requestId = String(payload.requestId || '')
  if (!requestId) return { ok: false, error: '缺少请求标识' }
  const provider = payload.provider
  if (!provider?.id) return { ok: false, error: '未选择 AI 厂商' }
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  if (!messages.length) return { ok: false, error: '对话内容为空' }

  const controller = new AbortController()
  aiStreams.set(requestId, controller)
  const sender = event.sender
  const scene = payload?.scene || 'chat'
  let produced = ''
  ;(async () => {
    try {
      const result = await ai.chatStreamWithProvider(provider, messages, payload.temperature, {
        signal: controller.signal,
        onDelta: (delta) => sendAiStreamEvent(sender, 'ai:stream:chunk', { requestId, delta }),
      })
      produced = result.content || ''
      recordAiCall({
        requestId,
        scene,
        provider,
        request: result.request,
        messages,
        temperature: payload.temperature,
        stream: true,
        ok: true,
        content: produced,
        usage: result.usage,
        elapsedMs: result.elapsedMs,
        finishReason: result.finishReason,
      })
      sendAiStreamEvent(sender, 'ai:stream:end', { requestId, ok: true, content: produced })
      return
    } catch (err) {
      const stopped = controller.signal.aborted
      // 用户主动停止：保留已生成内容，不做降级重试
      if (stopped) {
        recordAiCall({
          requestId,
          scene,
          provider,
          messages,
          temperature: payload.temperature,
          stream: true,
          ok: true,
          content: produced,
          stopped: true,
        })
        sendAiStreamEvent(sender, 'ai:stream:end', { requestId, ok: true, content: produced, stopped: true })
        return
      }
      // 已产出内容时直接报错，避免重复请求产生两份内容
      if (produced) {
        recordAiCall({
          requestId,
          scene,
          provider,
          messages,
          temperature: payload.temperature,
          stream: true,
          ok: false,
          content: produced,
          error: aiErrorMessage(err),
        })
        sendAiStreamEvent(sender, 'ai:stream:end', {
          requestId,
          ok: false,
          content: produced,
          error: aiErrorMessage(err),
        })
        return
      }
      try {
        const result = await ai.chatWithProvider(provider, messages, payload.temperature)
        const text = result.content || ''
        recordAiCall({
          requestId,
          scene,
          provider,
          request: result.request,
          messages,
          temperature: payload.temperature,
          stream: false,
          ok: true,
          content: text,
          usage: result.usage,
          elapsedMs: result.elapsedMs,
          finishReason: result.finishReason,
          fallback: true,
        })
        sendAiStreamEvent(sender, 'ai:stream:chunk', { requestId, delta: text })
        sendAiStreamEvent(sender, 'ai:stream:end', { requestId, ok: true, content: text, fallback: true })
      } catch (err2) {
        const msg = aiErrorMessage(err2)
        recordAiCall({
          requestId,
          scene,
          provider,
          messages,
          temperature: payload.temperature,
          stream: true,
          ok: false,
          error: msg,
          fallback: true,
        })
        sendAiStreamEvent(sender, 'ai:stream:end', { requestId, ok: false, error: msg })
      }
    } finally {
      aiStreams.delete(requestId)
    }
  })()

  return { ok: true, requestId }
})

// 停止流式 AI 对话
ipcMain.handle('ai:stream:stop', (_event, payload = {}) => {
  const requestId = String(payload.requestId || '')
  const controller = aiStreams.get(requestId)
  if (!controller) return { ok: false, error: '流式会话不存在或已结束' }
  controller.abort()
  aiStreams.delete(requestId)
  return { ok: true }
})

// 测试连接：发送一句简短问候
ipcMain.handle('ai:test', async (_event, provider) => {
  const messages = [{ role: 'user', content: '你好，请只回复两个字母：OK' }]
  const started = Date.now()
  try {
    if (!provider?.id) return { ok: false, error: '未选择 AI 厂商' }
    const result = await ai.chatWithProvider(provider, messages, 0.2)
    const reply = String(result.content || '')
    recordAiCall({
      scene: 'test',
      provider,
      request: result.request,
      messages,
      temperature: 0.2,
      stream: false,
      ok: true,
      content: reply,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
      finishReason: result.finishReason,
    })
    return { ok: true, reply: reply.slice(0, 100), elapsed: Date.now() - started }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? '请求超时' : err?.message || String(err)
    recordAiCall({
      scene: 'test',
      provider,
      messages,
      temperature: 0.2,
      stream: false,
      ok: false,
      error: msg,
      elapsedMs: Date.now() - started,
    })
    return { ok: false, error: msg }
  }
})

/* ==================== IPC：AI 对话会话（多会话 / 历史对话） ==================== */

/**
 * 会话数据变更后通知所有窗口（主窗口与独立对话窗口共享同一份数据）
 * @param {Electron.WebContents} sender 发起变更的窗口（也会收到通知，自行判断是否刷新）
 */
function notifyChatsChanged(sender) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ai:chats:changed', { by: sender?.id ?? null })
  }
}

// 查询全部会话（按更新时间倒序）
ipcMain.handle('ai:chats:list', async () => {
  try {
    return { ok: true, sessions: await aiChats.listChats() }
  } catch (err) {
    return { ok: false, sessions: [], error: err?.message || String(err) }
  }
})

// 新增 / 更新会话
ipcMain.handle('ai:chats:upsert', async (event, session) => {
  try {
    const res = await aiChats.upsertChat(session)
    if (res.ok) notifyChatsChanged(event.sender)
    return res
  } catch (err) {
    return { ok: false, sessions: [], error: err?.message || String(err) }
  }
})

// 删除会话（可批量）
ipcMain.handle('ai:chats:remove', async (event, payload = {}) => {
  try {
    const res = await aiChats.removeChats(payload?.ids)
    if (res.removed) notifyChatsChanged(event.sender)
    return res
  } catch (err) {
    return { ok: false, sessions: [], removed: 0, error: err?.message || String(err) }
  }
})

// 打开独立「AI 对话」窗口（已打开时前置已有窗口）
ipcMain.handle('window:openAiChat', () => {
  createAiChatWindow()
  return { ok: true }
})

/* ==================== IPC：AI 调用日志 ==================== */

// 列出存在日志的月份
ipcMain.handle('ai:logs:months', async () => {
  try {
    return { ok: true, months: await aiLogger.listMonths() }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), months: [] }
  }
})

// 分页查询日志（含统计）
ipcMain.handle('ai:logs:list', async (_event, query) => {
  try {
    return await aiLogger.queryLogs(query || {})
  } catch (err) {
    return { ok: false, error: err?.message || String(err), items: [], total: 0, page: 1, pageSize: 20 }
  }
})

// 查询单条日志详情（完整请求 / 响应）
ipcMain.handle('ai:logs:detail', async (_event, payload) => {
  try {
    const record = await aiLogger.getLogDetail(payload?.id, payload?.month)
    if (!record) return { ok: false, error: '记录不存在或已被清理' }
    return { ok: true, record }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 删除指定记录
ipcMain.handle('ai:logs:delete', async (_event, payload) => {
  try {
    return await aiLogger.deleteLogs(payload?.ids, payload?.month)
  } catch (err) {
    return { ok: false, error: err?.message || String(err), removed: 0 }
  }
})

// 清空指定月份（缺省清空全部）
ipcMain.handle('ai:logs:clear', async (_event, payload) => {
  try {
    return await aiLogger.clearLogs(payload?.month)
  } catch (err) {
    return { ok: false, error: err?.message || String(err), removed: 0 }
  }
})

// 在系统文件管理器中打开日志目录
ipcMain.handle('ai:logs:openDir', async () => {
  try {
    const dir = aiLogger.getAiLogDir() || path.join(app.getPath('userData'), 'ai-logs')
    fs.mkdirSync(dir, { recursive: true })
    const res = await shell.openPath(dir)
    return { ok: !res, error: res || '', dir }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 提取文件内容供 AI 使用（文本 / Office / 图片）
ipcMain.handle('file:extractForAi', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: '无效的文件路径' }
    if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在' }
    return await ai.extractFileForAi(filePath)
  } catch (err) {
    return {
      ok: true, kind: 'unsupported',
      name: path.basename(String(filePath || '')),
      path: filePath,
      ext: path.extname(String(filePath || '')).replace(/^\./, ''),
      error: err?.message || String(err),
    }
  }
})

// 选择要引用给 AI 的文件（可多选）
ipcMain.handle('dialog:selectAiFiles', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const res = await dialog.showOpenDialog(win, {
    title: '选择要引用给 AI 的文件',
    buttonLabel: '引用',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '文本与代码', extensions: ['txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'csv', 'log', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'php', 'sh', 'sql', 'vue', 'tex', 'ini', 'conf', 'properties'] },
      { name: 'Office 文档', extensions: ['docx', 'xlsx', 'pptx'] },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (res.canceled || !res.filePaths.length) return { canceled: true, filePaths: [] }
  return { canceled: false, filePaths: res.filePaths }
})

/* ==================== IPC：Git 版本管理 ==================== */
const git = require('./git.cjs')

/** Git 配置持久化路径（与 ai-config.json 一致，存放于应用数据目录） */
const gitConfigPath = () => path.join(app.getPath('userData'), 'git-config.json')

/**
 * 统一执行 Git 调用：注入配置路径，并把参数校验异常转换为标准返回
 * @param {() => Promise<object>} fn Git 模块调用
 * @returns {Promise<object>} 调用结果
 */
async function withGit(fn) {
  git.setConfigPath(gitConfigPath())
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: 'GIT_INVALID_PARAM', message: err?.message || String(err) }
  }
}

// 检测 Git 是否可用
ipcMain.handle('git:checkAvailable', () => withGit(() => git.checkAvailable()))

// 读取 Git 设置
ipcMain.handle('git:getConfig', () => withGit(() => git.getConfig()))

// 保存 Git 设置（可手动指定 git.exe 路径）
ipcMain.handle('git:setConfig', async (_event, config) => withGit(() => git.setConfig(config)))

// 检测目录是否位于 Git 仓库内
ipcMain.handle('git:detect', async (_event, { dirPath } = {}) => withGit(() => git.detect(dirPath)))

// 读取仓库状态
ipcMain.handle('git:status', async (_event, { repoRoot } = {}) => withGit(() => git.status(repoRoot)))

// 暂存文件
ipcMain.handle('git:add', async (_event, { repoRoot, paths } = {}) => withGit(() => git.add(repoRoot, paths)))

// 取消暂存
ipcMain.handle('git:unstage', async (_event, { repoRoot, paths } = {}) => withGit(() => git.unstage(repoRoot, paths)))

// 提交
ipcMain.handle('git:commit', async (_event, { repoRoot, message } = {}) => withGit(() => git.commit(repoRoot, message)))

// 查看差异
ipcMain.handle('git:diff', async (_event, payload = {}) =>
  withGit(() => git.diff(payload.repoRoot, payload)),
)

// 查看提交历史
ipcMain.handle('git:log', async (_event, payload = {}) =>
  withGit(() => git.log(payload.repoRoot, payload)),
)

// 克隆远程仓库到本地（「从 Git 打开」入口），通过 git:cloneProgress 回吐进度
ipcMain.handle('git:clone', async (event, payload = {}) => {
  const sender = event.sender
  return withGit(() =>
    git.clone(payload.url, payload.targetDir, {
      dirName: payload.dirName,
      branch: payload.branch,
      depth: payload.depth,
      onProgress: (info) => {
        if (sender && !sender.isDestroyed()) sender.send('git:cloneProgress', info)
      },
    }),
  )
})

// 还原文件（丢弃未提交的修改）
ipcMain.handle('git:restore', async (_event, { repoRoot, paths } = {}) => withGit(() => git.restore(repoRoot, paths)))

/* ---- P1：分支 / 远程同步 / 储藏 / 忽略规则 ---- */

// 分支列表（本地 + 远程）
ipcMain.handle('git:branches', async (_event, { repoRoot } = {}) => withGit(() => git.branches(repoRoot)))

// 切换 / 新建分支
ipcMain.handle('git:checkout', async (_event, payload = {}) =>
  withGit(() => git.checkout(payload.repoRoot, payload)),
)

// 删除本地分支
ipcMain.handle('git:deleteBranch', async (_event, payload = {}) =>
  withGit(() => git.deleteBranch(payload.repoRoot, payload)),
)

// 远程仓库列表
ipcMain.handle('git:remotes', async (_event, { repoRoot } = {}) => withGit(() => git.remotes(repoRoot)))

// 获取远程更新（fetch）
ipcMain.handle('git:fetch', async (_event, payload = {}) =>
  withGit(() => git.fetch(payload.repoRoot, payload)),
)

// 拉取
ipcMain.handle('git:pull', async (_event, payload = {}) => withGit(() => git.pull(payload.repoRoot, payload)))

// 推送
ipcMain.handle('git:push', async (_event, payload = {}) => withGit(() => git.push(payload.repoRoot, payload)))

// 储藏列表
ipcMain.handle('git:stashList', async (_event, { repoRoot } = {}) => withGit(() => git.stashList(repoRoot)))

// 保存储藏
ipcMain.handle('git:stashSave', async (_event, payload = {}) =>
  withGit(() => git.stashSave(payload.repoRoot, payload)),
)

// 应用 / 弹出储藏
ipcMain.handle('git:stashApply', async (_event, payload = {}) =>
  withGit(() => git.stashApply(payload.repoRoot, payload)),
)

// 删除储藏
ipcMain.handle('git:stashDrop', async (_event, payload = {}) =>
  withGit(() => git.stashDrop(payload.repoRoot, payload)),
)

// 读取 .gitignore
ipcMain.handle('git:readGitignore', async (_event, { repoRoot } = {}) =>
  withGit(() => git.readGitignore(repoRoot)),
)

// 写入 .gitignore
ipcMain.handle('git:writeGitignore', async (_event, payload = {}) =>
  withGit(() => git.writeGitignore(payload.repoRoot, payload.content)),
)

// 将指定路径加入 .gitignore
ipcMain.handle('git:ignorePath', async (_event, payload = {}) =>
  withGit(() => git.ignorePath(payload.repoRoot, payload.path)),
)

/* ==================== IPC：Git 提交规范（AI 生成提交信息） ==================== */
const commitSpec = require('./commitSpec.cjs')

/** 提交规范配置持久化路径（存放于应用数据目录） */
const commitSpecPath = () => path.join(app.getPath('userData'), 'commit-spec.json')

// 读取提交规范配置（含内置默认值）
ipcMain.handle('commitSpec:get', () => commitSpec.getCommitSpec(commitSpecPath()))

// 保存提交规范配置
ipcMain.handle('commitSpec:set', async (_event, config) => {
  try {
    const saved = await commitSpec.saveCommitSpec(commitSpecPath(), config)
    return { ok: true, config: saved }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 读取内置提交规范（可指定 full / brief 预设）：只返回默认值，由页面确认保存后才落盘
ipcMain.handle('commitSpec:reset', (_event, payload = {}) => ({
  ok: true,
  config: commitSpec.resetCommitSpec(payload.preset),
}))

/* ==================== IPC：快捷 AI 动作（内置提示词可定制） ==================== */
const quickAi = require('./quickAi.cjs')

/** 快捷 AI 配置持久化路径（存放于应用数据目录） */
const quickAiPath = () => path.join(app.getPath('userData'), 'quick-ai.json')

// 读取快捷 AI 动作配置（含内置默认类型与提示词）
ipcMain.handle('quickAi:get', () => quickAi.getQuickAiConfig(quickAiPath()))

// 保存快捷 AI 动作配置
ipcMain.handle('quickAi:set', async (_event, config) => {
  try {
    const saved = await quickAi.saveQuickAiConfig(quickAiPath(), config)
    return { ok: true, config: saved }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 恢复内置默认提示词（payload.id 为空时恢复全部，否则只恢复指定动作）
ipcMain.handle('quickAi:reset', (_event, payload = {}) => ({
  ok: true,
  config: quickAi.resetQuickAiConfig(quickAiPath(), payload),
}))

/* ==================== IPC：终端（命令行） ==================== */

// 列出可用的 shell（PowerShell / 命令提示符 / Git Bash / WSL 等）
ipcMain.handle('terminal:shells', () => terminal.listShells())

// 启动终端会话：在工作目录（打开的目录或当前文件所在目录）中打开命令行
// ownerId 标记归属窗口，保证输出只回传创建它的窗口
ipcMain.handle('terminal:start', async (event, payload = {}) =>
  terminal.start({ ...payload, ownerId: entryOfEvent(event)?.id ?? null }),
)

// 写入终端输入（命令文本 / Ctrl+C 等控制字符）
ipcMain.on('terminal:write', (_event, payload = {}) => {
  terminal.write(payload.id, payload.data)
})

// 同步终端尺寸（管道模式下不改变子进程窗口，仅保持行为一致）
ipcMain.on('terminal:resize', (_event, payload = {}) => {
  terminal.resize(payload)
})

// 关闭指定终端
ipcMain.handle('terminal:kill', async (_event, id) => terminal.kill(id))

// 关闭指定窗口创建的终端（渲染进程卸载 / 刷新时调用，不影响其它窗口）
ipcMain.handle('terminal:killOwn', (event) => terminal.killByOwner(entryOfEvent(event)?.id ?? null))

// 关闭所有终端（应用退出时调用）
ipcMain.handle('terminal:killAll', () => terminal.killAll())

// 命令补全：按当前输入与工作目录返回文件 / 目录 / 命令候选
ipcMain.handle('terminal:complete', async (_event, payload = {}) => terminal.complete(payload))

// 列出可用的系统外部终端（Windows Terminal / Ghostty / PowerShell 等）
ipcMain.handle('terminal:externalList', () => terminal.listExternalTerminals())

// 在系统自己的终端窗口中打开指定目录：拥有真实 TTY，可运行 vim / tmux 等全屏程序
ipcMain.handle('terminal:openExternal', async (_event, payload = {}) =>
  terminal.openExternalTerminal(payload),
)

/* ==================== IPC：JS 脚本运行（运行 .js 文件 / 代码片段） ==================== */

// 运行脚本：filePath 直接执行文件，code 执行代码片段；ownerId 标记归属窗口
ipcMain.handle('script:run', async (event, payload = {}) =>
  scriptRunner.run({ ...payload, ownerId: entryOfEvent(event)?.id ?? null }),
)

// 停止指定脚本
ipcMain.handle('script:kill', async (_event, id) => scriptRunner.kill(id))

// 停止本窗口创建的全部脚本（多窗口下不影响其它窗口）
ipcMain.handle('script:killOwn', (event) => scriptRunner.killByOwner(entryOfEvent(event)?.id ?? null))

// 停止全部脚本（应用退出时调用）
ipcMain.handle('script:killAll', () => scriptRunner.killAll())

/* ==================== IPC：进程管理（按端口 / 服务名查进程并结束） ==================== */
const processManager = require('./process.cjs')

// 查询进程：支持按端口 / 进程名 / PID / 命令行关键字过滤，并附带端口占用与启动命令行
ipcMain.handle('proc:search', async (_event, payload = {}) => processManager.search(payload))

// 结束进程：tree 为 true 时连同子进程一起结束（系统关键进程与自身进程会被拒绝）
ipcMain.handle('proc:kill', async (_event, payload = {}) => processManager.kill(payload))
