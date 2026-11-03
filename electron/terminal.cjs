/**
 * 终端（命令行）会话管理
 *
 * 在主进程中启动 shell 子进程（PowerShell / 命令提示符 / Git Bash / WSL / 系统默认 shell），
 * 通过管道与渲染进程双向传输数据：渲染进程写入命令，主进程把 shell 输出回传。
 *
 * 说明：
 * - 不依赖 node-pty 等原生模块，使用 child_process 管道方式启动，避免打包时的本地编译问题；
 *   代价是不支持 vim / less 等需要真实 TTY 的全屏程序，普通命令、交互式 REPL（python / node）可正常使用。
 * - Windows 中文环境下 shell 输出可能是 GBK（如 PowerShell 格式化日期），
 *   若按 UTF-8 解码出现非法序列则回退 GB18030，保证中文不乱码。
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { StringDecoder } = require('string_decoder')

/** 是否 Windows 平台（决定可选 shell 与编码回退策略） */
const IS_WIN = process.platform === 'win32'

/** Windows PowerShell 5.1 默认安装路径 */
const WIN_PS5_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** 会话集合：id -> 会话对象 */
const sessions = new Map()

/** 会话自增序号，用于生成会话 id */
let seq = 0

/** 向渲染进程推送事件的回调（由 main.cjs 注入） */
let sendEvent = () => {}

/** 可用 shell 探测结果缓存（探测涉及子进程调用，只做一次） */
let shellCache = null

/**
 * 注入事件发送器：主进程负责把事件转发给渲染进程窗口。
 * 第三个参数 ownerId 为创建该会话的窗口 id（多窗口下用于定向推送，避免输出串台）。
 * @param {(channel: string, payload: object, ownerId?: number) => void} fn 事件发送函数
 */
function setEventSender(fn) {
  if (typeof fn === 'function') sendEvent = fn
}

/**
 * 查找可执行文件路径（Windows 用 where，其它平台用 which）
 * @param {string} cmd 命令名，如 pwsh.exe
 * @returns {string} 绝对路径，未找到时返回空串
 */
function which(cmd) {
  try {
    const tool = IS_WIN ? 'where' : 'which'
    const res = spawnSync(tool, [cmd], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (res.status !== 0 || !res.stdout) return ''
    const list = String(res.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return list[0] || ''
  } catch {
    return ''
  }
}

/**
 * 定位 Git Bash（Git for Windows 自带的 bash.exe）
 * @returns {string} bash.exe 绝对路径，未安装 Git 时返回空串
 */
function findGitBash() {
  if (!IS_WIN) return ''
  const candidates = []
  const git = which('git.exe')
  if (git) {
    // git.exe 位于 <Git>/cmd/，bash 位于 <Git>/bin/
    const cmdDir = path.dirname(git)
    candidates.push(path.join(path.dirname(cmdDir), 'bin', 'bash.exe'))
  }
  candidates.push('C:\\Program Files\\Git\\bin\\bash.exe')
  candidates.push('C:\\Program Files (x86)\\Git\\bin\\bash.exe')
  for (const item of candidates) {
    if (item && fs.existsSync(item)) return item
  }
  return ''
}

/**
 * 判断 WSL 是否可用（安装了 Linux 发行版）
 * @returns {boolean} 可用返回 true
 */
function hasWsl() {
  if (!IS_WIN) return false
  try {
    const res = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (res.status !== 0) return false
    return String(res.stdout || '').trim().length > 0
  } catch {
    return false
  }
}

/**
 * 构造 PowerShell 会话参数：
 * -NoLogo 去掉版权头，-NoExit 保持会话，-Command - 表示从标准输入逐行读取命令
 * @returns {string[]} 启动参数
 */
function powershellArgs() {
  return ['-NoLogo', '-NoExit', '-Command', '-']
}

/**
 * 探测当前系统可用的 shell 列表（结果缓存）
 * @returns {Array<{id: string, name: string, file: string, args: string[], eol: string, kind: string, echoesPrompt: boolean}>} shell 列表
 */
function detectShells() {
  if (shellCache) return shellCache
  const list = []
  if (IS_WIN) {
    // PowerShell 7（pwsh）优先，其次 Windows PowerShell 5.1
    const pwsh = which('pwsh.exe')
    if (pwsh) {
      list.push({
        id: 'pwsh',
        name: 'PowerShell 7',
        file: pwsh,
        args: powershellArgs(),
        eol: '\r\n',
        kind: 'powershell',
        echoesPrompt: false,
      })
    }
    const ps5 = fs.existsSync(WIN_PS5_PATH) ? WIN_PS5_PATH : which('powershell.exe')
    if (ps5) {
      list.push({
        id: 'powershell',
        name: 'PowerShell',
        file: ps5,
        args: powershellArgs(),
        eol: '\r\n',
        kind: 'powershell',
        echoesPrompt: false,
      })
    }
    // 命令提示符：自带提示符输出（D:\dir>），渲染层不再补提示符
    list.push({
      id: 'cmd',
      name: '命令提示符',
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/Q', '/K'],
      eol: '\r\n',
      kind: 'cmd',
      echoesPrompt: true,
    })
    const bash = findGitBash()
    if (bash) {
      list.push({
        id: 'gitbash',
        name: 'Git Bash',
        file: bash,
        args: ['-l'],
        eol: '\n',
        kind: 'bash',
        echoesPrompt: false,
      })
    }
    if (hasWsl()) {
      list.push({
        id: 'wsl',
        name: 'WSL',
        file: which('wsl.exe') || 'wsl.exe',
        args: [],
        eol: '\n',
        kind: 'bash',
        echoesPrompt: false,
      })
    }
  } else {
    // macOS / Linux：优先用户默认 shell（常见为 zsh / bash）
    const envShell = process.env.SHELL || ''
    const candidates = []
    if (envShell) candidates.push(envShell)
    candidates.push('/bin/zsh', '/bin/bash')
    let picked = ''
    for (const item of candidates) {
      if (item && fs.existsSync(item)) {
        picked = item
        break
      }
    }
    if (picked) {
      list.push({
        id: 'default',
        name: path.basename(picked),
        file: picked,
        args: ['-l'],
        eol: '\n',
        kind: 'bash',
        echoesPrompt: false,
      })
    }
  }
  shellCache = list
  return list
}

/**
 * 计算缓冲区末尾未闭合的 UTF-8 序列长度
 * @param {Buffer} buf 缓冲区
 * @returns {number} 需要留到下一块的字节数（0 表示序列完整）
 */
function incompleteUtf8Tail(buf) {
  const max = Math.min(4, buf.length)
  for (let n = 1; n <= max; n++) {
    const start = buf.length - n
    const b = buf[start]
    let need = 0
    if (b >= 0xf0) need = 4
    else if (b >= 0xe0) need = 3
    else if (b >= 0xc0) need = 2
    else continue // 非多字节首字节，继续向前查找
    for (let i = 1; i < need; i++) {
      // 序列尚未接收完整：整段留到下一块
      if (start + i >= buf.length) return n
      const c = buf[start + i]
      if (c < 0x80 || c > 0xbf) return 0 // 非法序列，交给解码器输出替换字符
    }
    return 0
  }
  return 0
}

/**
 * 创建增量解码器：优先 UTF-8，出现非法序列时回退 GB18030（Windows 中文环境）
 * @returns {(buf: Buffer) => string} 解码函数（同一流需复用同一个解码器）
 */
function createDecoder() {
  const utf8 = new StringDecoder('utf8')
  let gbk = null
  try {
    gbk = new TextDecoder('gb18030')
  } catch {
    /* 运行环境不支持时忽略，仅按 UTF-8 解码 */
  }
  let pending = null
  return function decode(buf) {
    let data = pending && pending.length ? Buffer.concat([pending, buf]) : buf
    const tail = incompleteUtf8Tail(data)
    if (tail > 0) {
      pending = Buffer.from(data.subarray(data.length - tail))
      data = data.subarray(0, data.length - tail)
    } else {
      pending = null
    }
    const text = utf8.write(data)
    if (gbk && text.includes('\uFFFD')) return gbk.decode(data, { stream: true })
    return text
  }
}

/**
 * 规范化工作目录：为空或不存在时回退到家目录，传入文件路径时取其所在目录
 * @param {string} cwd 期望的工作目录
 * @returns {string} 可用的目录路径
 */
function resolveCwd(cwd) {
  let dir = typeof cwd === 'string' ? cwd.trim() : ''
  if (dir) {
    try {
      const stat = fs.statSync(dir)
      if (!stat.isDirectory()) dir = path.dirname(dir)
    } catch {
      dir = ''
    }
  }
  if (!dir) dir = os.homedir()
  // Windows 下统一为反斜杠：部分 shell（PowerShell）对正斜杠路径支持不佳
  if (IS_WIN) dir = dir.replace(/\//g, '\\')
  return dir
}

/**
 * 启动一个终端会话
 * @param {{cwd?: string, shellId?: string, ownerId?: number}} payload 启动参数：工作目录、shell id、归属窗口 id
 * @returns {{ok: boolean, id?: string, cwd?: string, shellId?: string, shellName?: string, kind?: string, eol?: string, echoesPrompt?: boolean, error?: string}} 启动结果
 */
function start(payload = {}) {
  const shells = detectShells()
  if (!shells.length) return { ok: false, error: '未检测到可用的命令行程序' }
  const shell = shells.find((s) => s.id === payload.shellId) || shells[0]
  const cwd = resolveCwd(payload.cwd)
  const id = `term-${++seq}`
  let proc = null
  try {
    proc = spawn(shell.file, shell.args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '120', LINES: '30' },
    })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }

  // ownerId：创建该会话的窗口 id，用于把输出定向回该窗口（多窗口下互不干扰）
  const ownerId = payload.ownerId ?? null
  const session = { id, shell, proc, cwd, alive: true, ownerId }
  sessions.set(id, session)

  // stdout / stderr 各自独立解码，避免半个字符被拆到两条流
  const outDecoder = createDecoder()
  const errDecoder = createDecoder()
  proc.stdout.on('data', (chunk) => {
    if (!session.alive) return
    sendEvent('terminal:data', { id, data: outDecoder(chunk) }, ownerId)
  })
  proc.stderr.on('data', (chunk) => {
    if (!session.alive) return
    sendEvent('terminal:data', { id, data: errDecoder(chunk) }, ownerId)
  })
  // 输入流异常（如进程已退出）不应导致主进程报错
  if (proc.stdin) proc.stdin.on('error', () => {})
  proc.on('error', (err) => {
    sendEvent('terminal:data', { id, data: `\r\n[终端启动失败] ${err?.message || String(err)}\r\n` }, ownerId)
    session.alive = false
    sessions.delete(id)
    sendEvent('terminal:exit', { id, code: -1 }, ownerId)
  })
  proc.on('exit', (code) => {
    if (!session.alive) return
    session.alive = false
    sessions.delete(id)
    sendEvent('terminal:exit', { id, code: code ?? 0 }, ownerId)
  })

  return {
    ok: true,
    id,
    cwd,
    shellId: shell.id,
    shellName: shell.name,
    kind: shell.kind,
    eol: shell.eol,
    echoesPrompt: !!shell.echoesPrompt,
  }
}

/**
 * 向终端写入输入（命令文本 / 控制字符）
 * @param {string} id 会话 id
 * @param {string} data 输入内容
 * @returns {{ok: boolean, error?: string}} 写入结果
 */
function write(id, data) {
  const session = sessions.get(id)
  if (!session || !session.alive || !session.proc) return { ok: false, error: '终端会话不存在' }
  try {
    session.proc.stdin.write(data)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/**
 * 终止进程树：先杀 shell 进程，Windows 下再用 taskkill 清理其子进程
 * @param {object} proc 子进程
 */
function killTree(proc) {
  if (!proc) return
  const pid = proc.pid
  try {
    proc.kill()
  } catch {
    /* 进程已退出 */
  }
  if (IS_WIN && pid) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    } catch {
      /* taskkill 不可用时忽略 */
    }
  }
}

/**
 * 关闭指定终端会话
 * @param {string} id 会话 id
 * @returns {{ok: boolean}} 关闭结果
 */
function kill(id) {
  const session = sessions.get(id)
  if (!session) return { ok: true }
  session.alive = false
  killTree(session.proc)
  sessions.delete(id)
  // 主动关闭时同步通知渲染进程，便于界面标记会话已结束
  sendEvent('terminal:exit', { id, code: -1 }, session.ownerId)
  return { ok: true }
}

/**
 * 关闭指定窗口创建的全部终端会话（多窗口下关闭某个窗口时调用，不影响其它窗口）
 * @param {number} ownerId 窗口 id
 * @returns {{ok: boolean, killed: number}} 关闭结果与被清理的会话数
 */
function killByOwner(ownerId) {
  if (ownerId === null || ownerId === undefined) return { ok: true, killed: 0 }
  let killed = 0
  for (const session of [...sessions.values()]) {
    if (session.ownerId !== ownerId) continue
    session.alive = false
    killTree(session.proc)
    sessions.delete(session.id)
    killed++
  }
  return { ok: true, killed }
}

/** 关闭全部终端会话（应用退出 / 所有窗口关闭时调用） */
function killAll() {
  for (const session of sessions.values()) {
    session.alive = false
    killTree(session.proc)
  }
  sessions.clear()
}

/**
 * 列出可用 shell（供渲染进程下拉选择）
 * @returns {{ok: boolean, shells: Array<{id: string, name: string, kind: string}>, defaultShellId: string}} shell 列表
 */
function listShells() {
  const shells = detectShells()
  return {
    ok: true,
    shells: shells.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    defaultShellId: shells.length ? shells[0].id : '',
  }
}

/**
 * 记录终端尺寸变化：管道模式下无法真正改变子进程窗口大小，
 * 仅用于让渲染层行为与终端一致（返回成功）
 * @returns {{ok: boolean}} 处理结果
 */
function resize() {
  return { ok: true }
}

/* ==================== 命令补全 ==================== */

/** PATH 目录 -> 文件名列表 缓存（PATH 目录内容变动很少，避免每次补全都扫描） */
const pathEntryCache = new Map()

/**
 * 读取目录中的文件名（带缓存，读取失败时返回空数组）
 * @param {string} dir 目录
 * @returns {string[]} 文件名列表
 */
function cachedDirEntries(dir) {
  if (pathEntryCache.has(dir)) return pathEntryCache.get(dir)
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    names = []
  }
  pathEntryCache.set(dir, names)
  return names
}

/**
 * 计算补全上下文：定位光标所在片段及其目录部分与待补全前缀
 * @param {string} input 当前输入行
 * @param {number} cursor 光标位置
 * @returns {{start: number, token: string, dirPart: string, prefix: string, isCommandPos: boolean}} 补全上下文
 */
function completionContext(input, cursor) {
  const text = typeof input === 'string' ? input : ''
  let pos = Number.isInteger(cursor) ? cursor : text.length
  if (pos < 0) pos = 0
  if (pos > text.length) pos = text.length
  const upto = text.slice(0, pos)
  let start = 0
  let quote = ''
  for (let i = 0; i < upto.length; i++) {
    const ch = upto[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') start = i + 1
  }
  const token = upto.slice(start)
  const before = upto.slice(0, start).trimEnd()
  // 命令位置：行首，或管道 / 逻辑运算 / 子 shell 之后
  const isCommandPos = before === '' || /(?:^|\s)(?:\||\|\||&&|;|\()$/.test(before)
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : ''
  const prefix = slash >= 0 ? token.slice(slash + 1) : token
  return { start, token, dirPart, prefix, isCommandPos }
}

/**
 * 规范化补全所用的工作目录：渲染层在 bash 会话下可能给出 /d/work 这类 POSIX 路径
 * @param {string} cwd 工作目录
 * @returns {string} 本地风格的目录
 */
function normalizeCompletionCwd(cwd) {
  let dir = typeof cwd === 'string' ? cwd.trim() : ''
  if (!dir) return ''
  if (IS_WIN) {
    const posix = /^\/([A-Za-z])(?:\/(.*))?$/.exec(dir)
    if (posix) return `${posix[1].toUpperCase()}:\\${(posix[2] || '').replace(/\//g, '\\')}`
    const win = /^\/?([A-Za-z]:)(?:[\\/](.*))?$/.exec(dir)
    if (win) return `${win[1].toUpperCase()}${win[2] ? `\\${win[2].replace(/\//g, '\\')}` : '\\'}`
  }
  return dir
}

/**
 * 前缀是否匹配（Windows 下不区分大小写）
 * @param {string} name 名称
 * @param {string} prefix 前缀
 * @returns {boolean} 匹配返回 true
 */
function prefixMatches(name, prefix) {
  if (!prefix) return true
  return IS_WIN ? name.toLowerCase().startsWith(prefix.toLowerCase()) : name.startsWith(prefix)
}

/**
 * 计算字符串数组的公共前缀
 * @param {string[]} list 字符串数组
 * @returns {string} 公共前缀
 */
function commonPrefixOf(list) {
  if (!list.length) return ''
  let prefix = list[0]
  for (const item of list) {
    let i = 0
    const max = Math.min(prefix.length, item.length)
    while (i < max && prefix[i] === item[i]) i += 1
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}

/**
 * 文件系统补全候选（目录 / 文件）
 * @param {string} baseDir 基准目录（会话当前目录）
 * @param {string} dirPart 待补全片段中的目录部分
 * @param {string} prefix 待补全前缀
 * @param {string} sep 路径分隔符
 * @param {number} limit 最大返回数量
 * @returns {Array<{insert: string, name: string, kind: string}>} 候选列表
 */
function fileCandidates(baseDir, dirPart, prefix, sep, limit) {
  const dir = dirPart ? path.resolve(baseDir, dirPart) : baseDir
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    const name = entry.name
    if (!prefixMatches(name, prefix)) continue
    // 无前缀时不列出隐藏项（. / .. 等）
    if (!prefix && name.startsWith('.')) continue
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink && entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dir, name)).isDirectory()
      } catch {
        /* 链接失效时按文件处理 */
      }
    }
    // Windows 非 bash 会话下统一为反斜杠，避免出现 src/utils\ 这类混合分隔符
    const insert = IS_WIN && sep !== '/' ? (dirPart + name + (isDir ? sep : '')).replace(/\//g, '\\') : dirPart + name + (isDir ? sep : '')
    out.push({ insert, name, kind: isDir ? 'dir' : 'file' })
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out.slice(0, limit)
}

/**
 * 命令补全候选：扫描 PATH 中的可执行文件
 * @param {string} prefix 待补全前缀
 * @param {number} limit 最大返回数量
 * @returns {Array<{insert: string, name: string, kind: string}>} 候选列表
 */
function commandCandidates(prefix, limit) {
  if (!prefix) return []
  const dirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  const exts = IS_WIN
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : []
  const seen = new Set()
  const out = []
  for (const dir of dirs) {
    for (const name of cachedDirEntries(dir)) {
      let cmd = name
      if (IS_WIN) {
        const ext = path.extname(name).toLowerCase()
        if (exts.length && !exts.includes(ext)) continue
        cmd = name.slice(0, name.length - path.extname(name).length)
      }
      if (!cmd || cmd.startsWith('.') || !prefixMatches(cmd, prefix)) continue
      const key = cmd.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      // 命令补全后追加空格，便于直接输入参数
      out.push({ insert: `${cmd} `, name: cmd, kind: 'command' })
      if (out.length >= limit) return out
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 计算输入行的补全候选
 * @param {{id?: string, cwd?: string, kind?: string, input?: string, cursor?: number}} payload 补全请求
 * @returns {{ok: boolean, start?: number, token?: string, candidates?: Array<{insert: string, name: string, kind: string}>, commonPrefix?: string, error?: string}} 补全结果
 */
function complete(payload = {}) {
  const session = sessions.get(payload.id)
  const cwd = normalizeCompletionCwd(payload.cwd || (session && session.cwd) || '')
  const ctx = completionContext(payload.input, payload.cursor)
  const kind = payload.kind || (session && session.shell ? session.shell.kind : '')
  const sep = kind === 'bash' ? '/' : path.sep
  const limit = 200
  // 形如 ./x、dir/x、..\x 的片段一律按路径补全；命令位置同时给出 PATH 中的命令与当前目录条目
  const looksLikePath =
    !!ctx.dirPart ||
    ctx.prefix.startsWith('.') ||
    ctx.prefix.includes('/') ||
    ctx.prefix.includes('\\')
  let candidates = []
  if (looksLikePath || !ctx.isCommandPos) {
    candidates = fileCandidates(cwd, ctx.dirPart, ctx.prefix, sep, limit)
  } else {
    const commands = commandCandidates(ctx.prefix, limit)
    const files = fileCandidates(cwd, '', ctx.prefix, sep, limit)
    const seen = new Set(commands.map((c) => c.name.toLowerCase()))
    candidates = commands.concat(files.filter((f) => !seen.has(f.name.toLowerCase())))
  }
  return {
    ok: true,
    start: ctx.start,
    token: ctx.token,
    candidates,
    commonPrefix: commonPrefixOf(candidates.map((c) => c.insert)),
  }
}

/* ==================== 外部终端（在系统自己的终端窗口中打开） ==================== */

/** 外部终端探测结果缓存 */
let externalCache = null

/**
 * 定位 Windows Terminal：wt.exe 是 MSIX 应用执行别名（%LOCALAPPDATA%\Microsoft\WindowsApps），
 * 部分机器无法直接用 CreateProcess 启动，因此额外准备了 cmd start 的兜底方式。
 * @returns {string} wt.exe 绝对路径，未安装时返回空串
 */
function resolveWindowsTerminal() {
  const appsDir = process.env.LOCALAPPDATA || ''
  if (appsDir) {
    const candidate = path.join(appsDir, 'Microsoft', 'WindowsApps', 'wt.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return which('wt.exe')
}

/**
 * 构造外部终端的启动描述
 *
 * Windows 关键点：控制台类终端（cmd / PowerShell / Git Bash）不能以 detached 方式直接 spawn——
 * detached 对应 DETACHED_PROCESS，系统不会为它分配控制台，stdin 拿不到输入会立刻退出（表现为窗口闪退）。
 * 因此统一经 `cmd /C start "" <target> <args>` 启动：由 start 负责创建一个真正的控制台窗口。
 * wt.exe 是 MSIX 应用执行别名，直接 CreateProcess 也可能失败，走 start 同样更稳。
 * @param {string} target 目标终端可执行文件（可为命令名，交给系统解析）
 * @param {string[]} args 传给目标终端的参数
 * @returns {{file: string, args: string[]}} 实际要启动的文件与参数
 */
function startInfo(target, args) {
  if (IS_WIN) return { file: process.env.ComSpec || 'cmd.exe', args: ['/C', 'start', '', target, ...args] }
  return { file: target, args }
}

/**
 * 外部终端定义表（按优先级排序，取第一个可用的）
 *
 * 与内置终端的区别：这里不走管道，而是让系统终端程序自己开一个窗口，
 * 因此拥有真实 TTY，vim / less / tmux / Claude Code 等全屏程序都能正常运行。
 * - resolve / file：用于判定该终端是否存在（trustFile 表示目标为命令名，跳过存在性校验）
 * - spawn：构造实际启动描述（第二个参数为 resolve 到的绝对路径）
 */
const EXTERNAL_TERMINALS = [
  {
    id: 'wt',
    name: 'Windows Terminal',
    platforms: ['win32'],
    resolve: () => resolveWindowsTerminal(),
    spawn: (dir) => startInfo('wt', ['-d', dir]),
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    platforms: ['win32', 'darwin', 'linux'],
    resolve: () => which(IS_WIN ? 'ghostty.exe' : 'ghostty'),
    spawn: (dir, file) => startInfo(file, [`--working-directory=${dir}`]),
  },
  {
    id: 'pwsh',
    name: 'PowerShell 7',
    platforms: ['win32'],
    resolve: () => which('pwsh.exe'),
    spawn: (dir, file) => startInfo(file, ['-NoLogo', '-NoExit']),
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    platforms: ['win32'],
    resolve: () => (fs.existsSync(WIN_PS5_PATH) ? WIN_PS5_PATH : which('powershell.exe')),
    spawn: (dir, file) => startInfo(file, ['-NoLogo', '-NoExit']),
  },
  {
    id: 'cmd',
    name: '命令提示符',
    platforms: ['win32'],
    trustFile: true,
    file: () => process.env.ComSpec || 'cmd.exe',
    spawn: (dir, file) => startInfo(file, ['/K']),
  },
  {
    id: 'gitbash',
    name: 'Git Bash',
    platforms: ['win32'],
    resolve: () => findGitBash(),
    spawn: (dir, file) => startInfo(file, []),
  },
  {
    id: 'iterm',
    name: 'iTerm',
    platforms: ['darwin'],
    trustFile: true,
    file: () => (fs.existsSync('/Applications/iTerm.app') ? 'open' : ''),
    spawn: (dir) => ({ file: 'open', args: ['-a', 'iTerm', dir] }),
  },
  {
    id: 'terminalapp',
    name: 'Terminal',
    platforms: ['darwin'],
    trustFile: true,
    file: () => (fs.existsSync('/Applications/Utilities/Terminal.app') ? 'open' : ''),
    spawn: (dir) => ({ file: 'open', args: ['-a', 'Terminal', dir] }),
  },
  // Linux：各家终端模拟器的「指定工作目录」参数不统一，逐个列出
  {
    id: 'gnome-terminal',
    name: 'GNOME Terminal',
    platforms: ['linux'],
    resolve: () => which('gnome-terminal'),
    spawn: (dir, file) => ({ file, args: ['--working-directory', dir] }),
  },
  {
    id: 'konsole',
    name: 'Konsole',
    platforms: ['linux'],
    resolve: () => which('konsole'),
    spawn: (dir, file) => ({ file, args: ['--workdir', dir] }),
  },
  {
    id: 'xfce4-terminal',
    name: 'Xfce Terminal',
    platforms: ['linux'],
    resolve: () => which('xfce4-terminal'),
    spawn: (dir, file) => ({ file, args: ['--working-directory', dir] }),
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    platforms: ['linux', 'darwin'],
    resolve: () => which('alacritty'),
    spawn: (dir, file) => ({ file, args: ['--working-directory', dir] }),
  },
  {
    id: 'kitty',
    name: 'Kitty',
    platforms: ['linux', 'darwin'],
    resolve: () => which('kitty'),
    spawn: (dir, file) => ({ file, args: ['--directory', dir] }),
  },
  {
    id: 'x-terminal-emulator',
    name: '系统默认终端',
    platforms: ['linux'],
    resolve: () => which('x-terminal-emulator'),
    spawn: (dir, file) => ({ file, args: [] }),
  },
]

/**
 * 探测当前系统可用的外部终端（结果缓存）
 * @returns {Array<{id: string, name: string, spawn: Function}>} 外部终端列表
 */
function detectExternalTerminals() {
  if (externalCache) return externalCache
  const platform = process.platform
  const list = []
  for (const item of EXTERNAL_TERMINALS) {
    if (item.platforms && !item.platforms.includes(platform)) continue
    const resolver = item.file || item.resolve
    const file = (resolver ? resolver() : '') || ''
    if (!file) continue
    // trustFile：目标为命令名或系统 open 命令，跳过存在性校验
    if (!item.trustFile && !fs.existsSync(file)) continue
    list.push({ id: item.id, name: item.name, spawn: (dir) => item.spawn(dir, file) })
  }
  externalCache = list
  return list
}

/**
 * 启动外部进程：脱离本进程独立运行（unref 后主进程退出不影响它）
 *
 * 注意：这里绝不能设置 windowsHide，否则终端窗口会被隐藏。
 * @param {string} file 可执行文件
 * @param {string[]} args 参数
 * @param {string} cwd 工作目录
 */
function launchExternal(file, args, cwd) {
  try {
    const proc = spawn(file, args, { cwd, detached: true, stdio: 'ignore' })
    proc.on('error', (err) => console.warn('[terminal] 外部终端启动失败', file, err?.message || err))
    proc.unref()
  } catch (err) {
    console.warn('[terminal] 外部终端启动失败', file, err?.message || err)
  }
}

/**
 * 列出可用的系统外部终端
 * @returns {{ok: boolean, terminals: Array<{id: string, name: string}>, defaultId: string}} 列表与默认项
 */
function listExternalTerminals() {
  const list = detectExternalTerminals()
  return {
    ok: true,
    terminals: list.map((item) => ({ id: item.id, name: item.name })),
    defaultId: list.length ? list[0].id : '',
  }
}

/**
 * 在系统自己的终端窗口中打开指定目录
 * @param {{dir?: string, cwd?: string, terminalId?: string}} payload 目标目录与外部终端 id（不指定则取优先级最高的）
 * @returns {{ok: boolean, name?: string, id?: string, dir?: string, error?: string}} 打开结果
 */
function openExternalTerminal(payload = {}) {
  const list = detectExternalTerminals()
  if (!list.length) return { ok: false, error: '未检测到可用的系统终端程序' }
  const target = list.find((item) => item.id === payload.terminalId) || list[0]
  const dir = resolveCwd(payload.dir || payload.cwd)
  const info = target.spawn(dir)
  launchExternal(info.file, info.args, dir)
  return { ok: true, name: target.name, id: target.id, dir }
}

module.exports = {
  setEventSender,
  listShells,
  start,
  write,
  kill,
  killByOwner,
  killAll,
  resize,
  complete,
  listExternalTerminals,
  openExternalTerminal,
}
