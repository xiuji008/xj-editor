/**
 * JS 脚本运行器（Electron 主进程模块）
 *
 * 在主进程中启动 Node 子进程执行一段 JS 代码或一个 .js 文件，
 * 通过管道把 stdout / stderr 流式回传渲染进程，退出时上报退出码。
 *
 * 说明：
 * - 不要求用户安装 Node：优先使用系统 node（错误栈信息更友好），
 *   未安装时退回 Electron 内置的 Node（process.execPath + ELECTRON_RUN_AS_NODE=1），
 *   打包后依然可用。
 * - 代码片段（code 模式）写入临时文件后执行，避免 -e 在 ESM / 大脚本下的限制；
 *   文件模式（filePath 模式）直接 node <file>，cwd 取文件所在目录。
 * - Windows 中文环境输出可能是 GBK，解码非法序列时回退 GB18030，保证中文不乱码。
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { StringDecoder } = require('string_decoder')

/** 是否 Windows 平台（决定进程树清理方式与编码回退策略） */
const IS_WIN = process.platform === 'win32'

/** 默认超时（毫秒）：避免死循环脚本永久占用 */
const DEFAULT_TIMEOUT_MS = 60000

/** 单次运行 stdout / stderr 累计上限（字节）：超限终止进程，避免内存被打满 */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024

/** 会话集合：id -> 会话对象 */
const sessions = new Map()

/** 会话自增序号 */
let seq = 0

/** 向渲染进程推送事件的回调（由 main.cjs 注入） */
let sendEvent = () => {}

/** Node 可执行文件解析结果缓存 */
let nodeCache = null

/**
 * 注入事件发送器：主进程负责把事件转发给渲染进程窗口。
 * @param {(channel: string, payload: object, ownerId?: number) => void} fn 事件发送函数
 */
function setEventSender(fn) {
  if (typeof fn === 'function') sendEvent = fn
}

/**
 * 解析 Node 可执行文件：优先系统 node，否则退回 Electron 内置 Node。
 * @returns {{ bin: string, env: Record<string, string> }} 启动信息
 */
function resolveNode() {
  if (nodeCache) return nodeCache
  try {
    const cmd = IS_WIN ? 'node.exe' : 'node'
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    if (res.status === 0 && String(res.stdout || '').trim()) {
      nodeCache = { bin: cmd, env: process.env }
      return nodeCache
    }
  } catch {
    /* 系统未安装 node，退回 Electron 内置 Node */
  }
  // Electron 内置 Node：设置 ELECTRON_RUN_AS_NODE 后 execPath 以纯 Node 身份运行
  nodeCache = { bin: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  return nodeCache
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
    else continue
    for (let i = 1; i < need; i++) {
      if (start + i >= buf.length) return n
      const c = buf[start + i]
      if (c < 0x80 || c > 0xbf) return 0
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
  return dir
}

/**
 * 判定代码片段是否为 ESM（含顶层 import / export 语法）
 * @param {string} code 代码
 * @returns {boolean} 是否为 ESM
 */
function detectEsm(code) {
  return /(^|\n)\s*(import\s|export\s)/.test(code || '')
}

/**
 * 终止进程树：先杀主进程，Windows 下再用 taskkill 清理其子进程
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
 * 启动一次脚本运行。
 *
 * @param {{ code?: string, filePath?: string, cwd?: string, timeoutMs?: number, ownerId?: number }} payload
 *   - code：代码片段（写入临时文件后执行）
 *   - filePath：脚本文件路径（直接执行）
 *   - cwd：工作目录（filePath 模式默认取文件所在目录，code 模式默认家目录）
 *   - timeoutMs：超时时间（毫秒），默认 60000
 *   - ownerId：归属窗口 id，用于把输出定向回该窗口
 * @returns {{ ok: boolean, id?: string, cwd?: string, error?: string }} 启动结果
 */
function run(payload = {}) {
  const ownerId = payload.ownerId ?? null
  const cwd = resolveCwd(payload.filePath ? path.dirname(payload.filePath) : payload.cwd)

  let target = ''
  let cleanup = null
  if (typeof payload.filePath === 'string' && payload.filePath.trim()) {
    target = payload.filePath
    if (!fs.existsSync(target)) return { ok: false, error: '脚本文件不存在' }
  } else if (typeof payload.code === 'string') {
    const ext = detectEsm(payload.code) ? '.mjs' : '.js'
    const tmp = path.join(os.tmpdir(), `md-script-${process.pid}-${Date.now()}-${++seq}${ext}`)
    try {
      fs.writeFileSync(tmp, payload.code, 'utf-8')
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
    target = tmp
    cleanup = () => fs.unlink(tmp, () => {})
  } else {
    return { ok: false, error: '缺少要运行的脚本内容或文件' }
  }

  const { bin, env } = resolveNode()
  const id = `script-${++seq}`
  let proc = null
  try {
    proc = spawn(bin, [target], {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
  } catch (err) {
    if (cleanup) cleanup()
    return { ok: false, error: err?.message || String(err) }
  }

  const timeoutMs = Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0 ? payload.timeoutMs : DEFAULT_TIMEOUT_MS
  /** @type {{ id: string, proc: object, cwd: string, alive: boolean, ownerId: number, cleanup: Function|null, outBytes: number, killedByLimit: boolean }} */
  const session = {
    id,
    proc,
    cwd,
    alive: true,
    ownerId,
    cleanup,
    outBytes: 0,
    killedByLimit: false,
  }
  sessions.set(id, session)

  /** 累计输出字节并判断是否超限（超限终止进程并提示） */
  function accumulate(text) {
    session.outBytes += Buffer.byteLength(text, 'utf8')
    if (session.outBytes > MAX_OUTPUT_BYTES && !session.killedByLimit) {
      session.killedByLimit = true
      killTree(proc)
      sendEvent('script:data', { id, stream: 'system', data: '\n[输出超出上限，进程已终止]\n' }, ownerId)
    }
  }

  const outDecoder = createDecoder()
  const errDecoder = createDecoder()
  proc.stdout.on('data', (chunk) => {
    if (!session.alive) return
    const text = outDecoder(chunk)
    if (session.killedByLimit) return
    accumulate(text)
    if (session.killedByLimit) return
    sendEvent('script:data', { id, stream: 'stdout', data: text }, ownerId)
  })
  proc.stderr.on('data', (chunk) => {
    if (!session.alive) return
    const text = errDecoder(chunk)
    if (session.killedByLimit) return
    accumulate(text)
    if (session.killedByLimit) return
    sendEvent('script:data', { id, stream: 'stderr', data: text }, ownerId)
  })
  // 输入流异常（进程已退出）不应导致主进程报错
  if (proc.stdin) proc.stdin.on('error', () => {})

  const finish = (code) => {
    if (!session.alive) return
    session.alive = false
    sessions.delete(id)
    if (session.cleanup) session.cleanup()
    sendEvent('script:exit', { id, code }, ownerId)
  }

  proc.on('error', (err) => {
    sendEvent('script:data', { id, stream: 'system', data: `\n[脚本启动失败] ${err?.message || String(err)}\n` }, ownerId)
    finish(-1)
  })
  proc.on('exit', (code) => {
    finish(code ?? 0)
  })

  // 超时保护
  const timer = setTimeout(() => {
    if (!session.alive) return
    sendEvent('script:data', { id, stream: 'system', data: `\n[运行超时（${Math.round(timeoutMs / 1000)}s），已终止]\n` }, ownerId)
    killTree(proc)
  }, timeoutMs)
  proc.once('exit', () => clearTimeout(timer))

  return { ok: true, id, cwd }
}

/**
 * 终止指定会话
 * @param {string} id 会话 id
 * @returns {{ ok: boolean }} 关闭结果
 */
function kill(id) {
  const session = sessions.get(id)
  if (!session) return { ok: true }
  session.alive = false
  killTree(session.proc)
  if (session.cleanup) session.cleanup()
  sessions.delete(id)
  sendEvent('script:exit', { id, code: -1 }, session.ownerId)
  return { ok: true }
}

/**
 * 关闭指定窗口创建的会话（多窗口下关闭某个窗口时调用）
 * @param {number} ownerId 窗口 id
 * @returns {{ ok: boolean, killed: number }} 关闭结果与被清理的会话数
 */
function killByOwner(ownerId) {
  if (ownerId === null || ownerId === undefined) return { ok: true, killed: 0 }
  let killed = 0
  for (const session of [...sessions.values()]) {
    if (session.ownerId !== ownerId) continue
    session.alive = false
    killTree(session.proc)
    if (session.cleanup) session.cleanup()
    sessions.delete(session.id)
    killed++
  }
  return { ok: true, killed }
}

/** 关闭全部会话（应用退出 / 所有窗口关闭时调用） */
function killAll() {
  for (const session of sessions.values()) {
    session.alive = false
    killTree(session.proc)
    if (session.cleanup) session.cleanup()
  }
  sessions.clear()
}

module.exports = { setEventSender, run, kill, killByOwner, killAll }
