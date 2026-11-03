/**
 * 进程管理（Electron 主进程模块）
 *
 * 设计要点：
 * - 只调用系统自带命令（Windows：netstat / tasklist / taskkill / PowerShell；POSIX：ps / lsof / kill），不引入第三方依赖；
 * - 渲染层只传语义参数（关键字 / 匹配模式 / PID），命令与参数全部在本模块内拼装，PID 一律先转数字，杜绝命令注入；
 * - Java 服务的「服务名」只体现在启动命令行里（jar 包名、--server.port=8080），因此命令行用 PowerShell 一次性取回并缓存，
 *   避免每次搜索都付出约 1 秒的 PowerShell 启动成本；
 * - 结束进程时拦截系统关键进程与应用自身进程，避免误操作把系统搞崩。
 */
const { execFile } = require('child_process')
const fsp = require('fs').promises
const os = require('os')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/** 命令默认超时（毫秒） */
const DEFAULT_TIMEOUT = 15000
/** PowerShell 取命令行的超时（毫秒）：CIM 查询较慢，单独放宽 */
const PS_TIMEOUT = 30000
/** 单次命令 stdout 上限（字节） */
const MAX_BUFFER = 20 * 1024 * 1024
/** 命令行缓存有效期（毫秒） */
const CMDLINE_TTL = 30000
/** 命令行回传给渲染层的最大字符数 */
const MAX_CMD_CHARS = 1000
/** 单次最多返回进程数 */
const MAX_ITEMS = 500
/** 每个进程最多回传的端口条目数 */
const MAX_PORTS = 20
/** 禁止结束的系统关键进程（按进程名小写匹配） */
const CRITICAL_NAMES = new Set([
  'system',
  'system idle process',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'fontdrvhost.exe',
  'registry',
  'memory compression',
  'secure system',
])
/** 视为「监听中」的连接状态 */
const LISTEN_STATES = new Set(['LISTENING', 'LISTEN'])

/** 命令行缓存：{ at, map }，map 为 pid -> 命令行 */
let cmdlineCache = { at: 0, map: new Map() }

/**
 * 执行一条系统命令，失败时不抛异常，交由调用方按 stdout / stderr 解析。
 *
 * @param {string} cmd 命令
 * @param {string[]} args 参数数组
 * @param {number} timeout 超时（毫秒）
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, error: string, code: string }>} 执行结果
 */
async function run(cmd, args, timeout = DEFAULT_TIMEOUT) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
    })
    return { ok: true, stdout: String(stdout || ''), stderr: '', error: '', code: '' }
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout || ''),
      stderr: String(err?.stderr || ''),
      error: err?.message || String(err),
      code: err?.code || '',
    }
  }
}

/**
 * 按上限截断文本。
 *
 * @param {string} text 原文
 * @param {number} max 最大字符数
 * @returns {string} 截断后的文本，超长时追加省略号
 */
function truncate(text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 解析内存字符串（tasklist 输出形如 `1,234 K`）为 KB 数值。
 *
 * @param {string} text 内存文本
 * @returns {number} 内存（KB），解析失败返回 0
 */
function parseMemory(text) {
  const raw = String(text || '').replace(/[,\s]/g, '')
  const matched = raw.match(/^([\d.]+)(K|M|G)?B?$/i)
  if (!matched) return 0
  const value = Number(matched[1])
  if (!Number.isFinite(value)) return 0
  const unit = (matched[2] || 'K').toUpperCase()
  const multiple = unit === 'G' ? 1024 * 1024 : unit === 'M' ? 1024 : 1
  return Math.round(value * multiple)
}

/**
 * 从 `本地地址` 中取端口号（`0.0.0.0:8080` / `[::]:8080` 均可）。
 *
 * @param {string} address 地址文本
 * @returns {number} 端口号，取不到返回 0
 */
function portOf(address) {
  const text = String(address || '')
  const index = text.lastIndexOf(':')
  if (index < 0) return 0
  const port = Number(text.slice(index + 1))
  return Number.isInteger(port) && port > 0 ? port : 0
}

/**
 * 解析 netstat -ano 输出：pid -> 端口条目数组。
 *
 * @param {string} text netstat 输出
 * @returns {Map<number, Array<{ proto: string, port: number, local: string, remote: string, state: string, listening: boolean }>>} 端口映射
 */
function parseNetstat(text) {
  /** @type {Map<number, Array<object>>} */
  const map = new Map()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    const matched = line.match(/^(TCP|UDP|TCPv6|UDPv6)\s+(\S+)\s+(\S+)\s*(.*)$/i)
    if (!matched) continue
    const proto = matched[1].toUpperCase()
    const local = matched[2]
    const remote = matched[3]
    // TCP 行尾部为「状态 PID」，UDP 行只有 PID
    const tail = matched[4] ? matched[4].trim().split(/\s+/) : []
    let state = ''
    let pidText = ''
    if (tail.length >= 2) {
      state = tail[0].toUpperCase()
      pidText = tail[tail.length - 1]
    } else if (tail.length === 1) {
      pidText = tail[0]
    } else {
      continue
    }
    const pid = Number(pidText)
    if (!Number.isInteger(pid) || pid < 0) continue
    const port = portOf(local)
    if (!port) continue
    const item = {
      proto,
      port,
      local,
      remote,
      state,
      listening: state ? LISTEN_STATES.has(state) : false,
    }
    const list = map.get(pid)
    if (list) {
      if (!list.some((p) => p.proto === item.proto && p.port === item.port && p.state === item.state)) {
        list.push(item)
      }
    } else {
      map.set(pid, [item])
    }
  }
  return map
}

/**
 * 解析 tasklist /FO CSV /NH 输出。
 *
 * @param {string} text tasklist 输出
 * @returns {Map<number, { pid: number, name: string, memory: number, commandLine: string, exe: string }>} 进程映射
 */
function parseTasklist(text) {
  /** @type {Map<number, object>} */
  const map = new Map()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('"')) continue
    // CSV 形如："java.exe","1234","Console","1","512,000 K"
    const fields = line.split('","').map((field) => field.replace(/^"|"$/g, ''))
    if (fields.length < 2) continue
    const pid = Number(fields[1])
    if (!Number.isInteger(pid) || pid < 0) continue
    map.set(pid, {
      pid,
      name: fields[0] || '未知进程',
      memory: parseMemory(fields[4]),
      commandLine: '',
      exe: '',
    })
  }
  return map
}

/**
 * 取系统根目录，用于拼接 PowerShell 绝对路径（PATH 被裁剪时的兜底）。
 *
 * @returns {string} 系统根目录，如 C:\Windows
 */
function systemRoot() {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows'
}

/**
 * 构造取命令行的 PowerShell 脚本：结果写临时文件，绕开控制台代码页导致的中文乱码。
 *
 * @param {string} target 临时文件路径
 * @returns {string} PowerShell 脚本
 */
function buildCmdlineScript(target) {
  const escaped = String(target).replace(/'/g, "''")
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$target = '${escaped}'`,
    '$items = @(Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{ ProcessId = [int]$_.ProcessId; CommandLine = [string]$_.CommandLine } })',
    '$json = ConvertTo-Json -InputObject $items -Compress',
    '[System.IO.File]::WriteAllText($target, $json, [System.Text.UTF8Encoding]::new($false))',
  ].join('; ')
}

/**
 * 取全量进程的命令行（Windows），结果缓存 CMDLINE_TTL 毫秒。
 *
 * @param {boolean} force 为 true 时忽略缓存重新采集
 * @returns {Promise<Map<number, string>>} pid -> 命令行
 */
async function fetchCommandLines(force) {
  if (!force && Date.now() - cmdlineCache.at < CMDLINE_TTL) {
    return cmdlineCache.map
  }
  const target = path.join(os.tmpdir(), `md-proc-cmdline-${process.pid}-${Date.now()}.json`)
  const script = buildCmdlineScript(target)
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
  let res = await run('powershell.exe', args, PS_TIMEOUT)
  if (!res.ok && res.code === 'ENOENT') {
    // PATH 里没有 powershell.exe 时退到绝对路径
    res = await run(path.join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args, PS_TIMEOUT)
  }
  /** @type {Map<number, string>} */
  const map = new Map()
  try {
    const text = await fsp.readFile(target, 'utf8')
    const data = JSON.parse(text)
    const list = Array.isArray(data) ? data : [data]
    for (const item of list) {
      if (!item || item.ProcessId == null) continue
      map.set(Number(item.ProcessId), String(item.CommandLine || ''))
    }
    cmdlineCache = { at: Date.now(), map }
  } catch {
    // 命令行仅用于辅助匹配，采集失败时沿用上一次的缓存（可能为空）
  } finally {
    try {
      await fsp.unlink(target)
    } catch {
      /* 临时文件清理失败可忽略 */
    }
  }
  return map
}

/**
 * POSIX：读取进程列表（ps 一次拿到进程名与完整命令行）。
 *
 * @returns {Promise<Map<number, object>>} 进程映射
 */
async function posixProcesses() {
  /** @type {Map<number, object>} */
  const map = new Map()
  const res = await run('ps', ['-eo', 'pid=,comm=,args='], DEFAULT_TIMEOUT)
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    const matched = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/)
    if (!matched) continue
    const pid = Number(matched[1])
    if (!Number.isInteger(pid)) continue
    const commandLine = matched[3] || ''
    map.set(pid, {
      pid,
      name: matched[2] || '未知进程',
      memory: 0,
      commandLine,
      exe: '',
    })
  }
  return map
}

/**
 * POSIX：读取端口占用（lsof 输出按进程分组）。
 *
 * @returns {Promise<Map<number, Array<object>>>} pid -> 端口条目数组
 */
async function posixPorts() {
  /** @type {Map<number, Array<object>>} */
  const map = new Map()
  const res = await run('lsof', ['-nP', '-i', '-F', 'pn'], DEFAULT_TIMEOUT)
  let pid = null
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    if (text[0] === 'p') {
      const value = Number(text.slice(1))
      pid = Number.isInteger(value) ? value : null
      continue
    }
    if (text[0] !== 'n' || pid == null) continue
    // 形如 n*:8080 / n127.0.0.1:54321->10.0.0.1:443
    const address = text.slice(1)
    const local = address.split('->')[0]
    const matched = local.match(/:(\d+)\s*$/)
    if (!matched) continue
    const port = Number(matched[1])
    if (!port) continue
    const item = {
      proto: 'TCP',
      port,
      local,
      remote: address.split('->')[1] || '',
      state: '',
      listening: /\*:/.test(local) || /127\.0\.0\.1:/.test(local) || /\[?::1\]?:/.test(local),
    }
    const list = map.get(pid)
    if (list) {
      if (!list.some((p) => p.port === item.port)) list.push(item)
    } else {
      map.set(pid, [item])
    }
  }
  return map
}

/**
 * 判断进程是否被保护（禁止结束）：系统关键进程、PID ≤ 4、应用自身进程。
 *
 * @param {number} pid 进程 ID
 * @param {string} name 进程名
 * @returns {boolean} 被保护返回 true
 */
function isCritical(pid, name) {
  if (!Number.isInteger(pid) || pid <= 0) return true
  if (pid <= 4) return true
  if (pid === process.pid) return true
  const lower = String(name || '').toLowerCase()
  return lower ? CRITICAL_NAMES.has(lower) : false
}

/**
 * 结束进程前的校验。
 *
 * @param {number} pid 进程 ID
 * @param {string} name 进程名
 * @returns {string} 允许结束时返回空串，否则返回拒绝原因
 */
function guardKill(pid, name) {
  if (!Number.isInteger(pid) || pid <= 0) return '无效的进程 ID'
  if (pid === process.pid) return '不能结束本应用自身进程'
  if (pid <= 4) return '系统关键进程，已阻止结束'
  const lower = String(name || '').toLowerCase()
  if (lower && CRITICAL_NAMES.has(lower)) return '系统关键进程，已阻止结束'
  return ''
}

/**
 * 判断端口条目是否命中关键字（先精确、再包含）。
 *
 * @param {Array<{ port: number }>} ports 端口条目
 * @param {string} keyword 关键字
 * @returns {boolean} 命中返回 true
 */
function matchPorts(ports, keyword) {
  return ports.some((item) => {
    const text = String(item.port)
    return text === keyword || text.includes(keyword)
  })
}

/**
 * 查询进程：按端口 / 进程名 / PID / 命令行关键字过滤，并附带端口占用与命令行。
 *
 * @param {{ keyword?: string, mode?: string, deep?: boolean, onlyPorts?: boolean, refresh?: boolean }} payload 查询参数
 * @returns {Promise<object>} 查询结果
 */
async function search(payload = {}) {
  const started = Date.now()
  const keyword = String(payload.keyword || '').trim()
  const mode = String(payload.mode || 'auto')
  const deep = payload.deep !== false
  const onlyPorts = !!payload.onlyPorts
  const isWin = process.platform === 'win32'

  /** @type {Map<number, object>} */
  let procs = new Map()
  /** @type {Map<number, Array<object>>} */
  let portsMap = new Map()

  if (isWin) {
    const [netRes, listRes] = await Promise.all([
      run('netstat', ['-ano'], DEFAULT_TIMEOUT),
      run('tasklist', ['/FO', 'CSV', '/NH'], DEFAULT_TIMEOUT),
    ])
    portsMap = parseNetstat(netRes.stdout)
    procs = parseTasklist(listRes.stdout)
    if (!procs.size && !portsMap.size) {
      return { ok: false, error: 'PROC_SCAN_FAILED', message: '读取进程列表失败（netstat / tasklist 未返回结果）' }
    }
    // netstat 里出现、但 tasklist 没抓到的 PID（多为已退出或权限受限）补占位行
    for (const pid of portsMap.keys()) {
      if (!procs.has(pid)) {
        procs.set(pid, {
          pid,
          name: pid <= 4 ? 'System' : '未知进程',
          memory: 0,
          commandLine: '',
          exe: '',
        })
      }
    }
  } else {
    const [procResult, portResult] = await Promise.all([posixProcesses(), posixPorts()])
    procs = procResult
    portsMap = portResult
    if (!procs.size) {
      return { ok: false, error: 'PROC_SCAN_FAILED', message: '读取进程列表失败（ps 未返回结果）' }
    }
  }

  // 命令行：Windows 下进程名只有 java.exe，jar 包名 / 启动参数要靠命令行才能搜到
  const commandLines = isWin && deep ? await fetchCommandLines(!!payload.refresh) : new Map()

  const lower = keyword.toLowerCase()
  const numeric = /^\d+$/.test(keyword)
  const scanned = procs.size
  const items = []

  for (const proc of procs.values()) {
    const ports = portsMap.get(proc.pid) || []
    // 「只看占用端口的进程」按监听中判定，避免 TIME_WAIT 之类的无效连接刷屏
    if (onlyPorts && !ports.some((item) => item.listening)) continue
    const commandLine = commandLines.get(proc.pid) || proc.commandLine || ''
    let matchedBy = ''
    if (!keyword) {
      matchedBy = 'all'
    } else if (mode === 'port') {
      matchedBy = matchPorts(ports, keyword) ? 'port' : ''
    } else if (mode === 'pid') {
      matchedBy = String(proc.pid) === keyword ? 'pid' : ''
    } else if (mode === 'name') {
      matchedBy = proc.name.toLowerCase().includes(lower) ? 'name' : ''
    } else if (mode === 'cmdline') {
      matchedBy = commandLine.toLowerCase().includes(lower) ? 'cmdline' : ''
    } else if (numeric) {
      // 自动模式：纯数字按端口匹配，其次按 PID 精确匹配
      matchedBy = matchPorts(ports, keyword) ? 'port' : String(proc.pid) === keyword ? 'pid' : ''
    } else {
      matchedBy = proc.name.toLowerCase().includes(lower)
        ? 'name'
        : commandLine.toLowerCase().includes(lower)
          ? 'cmdline'
          : ''
    }
    if (!matchedBy) continue
    const listening = ports.some((item) => item.listening)
    items.push({
      pid: proc.pid,
      name: proc.name,
      exe: proc.exe || '',
      commandLine: truncate(commandLine, MAX_CMD_CHARS),
      memory: proc.memory,
      ports: ports.slice(0, MAX_PORTS),
      listening,
      matchedBy,
      critical: isCritical(proc.pid, proc.name),
    })
    if (items.length >= MAX_ITEMS) break
  }

  // 监听中的排前面，其次按进程名、PID
  items.sort(
    (a, b) =>
      (b.listening ? 1 : 0) - (a.listening ? 1 : 0) ||
      a.name.localeCompare(b.name) ||
      a.pid - b.pid,
  )

  return {
    ok: true,
    platform: process.platform,
    keyword,
    mode,
    scanned,
    total: items.length,
    elapsedMs: Date.now() - started,
    cmdlineAvailable: commandLines.size > 0,
    lsofAvailable: isWin || portsMap.size > 0,
    items,
  }
}

/**
 * 判断进程是否仍在运行（Windows 用 tasklist 过滤，POSIX 用信号 0 探测）。
 *
 * @param {number} pid 进程 ID
 * @returns {Promise<boolean>} 仍在运行返回 true
 */
async function isAlive(pid) {
  if (process.platform === 'win32') {
    const res = await run('tasklist', ['/FO', 'CSV', '/NH', '/FI', `PID eq ${pid}`], DEFAULT_TIMEOUT)
    return String(res.stdout || '').includes(`","${pid}",`)
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 结束进程。
 *
 * @param {{ pid: number, name?: string, tree?: boolean }} payload 结束参数
 * @returns {Promise<{ ok: boolean, pid: number, message?: string, error?: string }>} 结束结果
 */
async function kill(payload = {}) {
  const pid = Number(payload.pid)
  const reason = guardKill(pid, payload.name)
  if (reason) {
    return { ok: false, pid, error: reason }
  }
  const tree = !!payload.tree
  let message = ''
  if (process.platform === 'win32') {
    const args = ['/F', '/PID', String(pid)]
    if (tree) args.splice(1, 0, '/T')
    const res = await run('taskkill', args, DEFAULT_TIMEOUT)
    if (!(await isAlive(pid))) {
      return { ok: true, pid, message: tree ? '已结束进程及其子进程' : '已结束进程' }
    }
    message = pickTaskkillError(res) || '结束失败，可能是权限不足（可尝试以管理员身份运行本应用）'
  } else {
    const res = await run('kill', ['-9', String(pid)], DEFAULT_TIMEOUT)
    if (!(await isAlive(pid))) {
      return { ok: true, pid, message: tree ? '已结束进程及其子进程' : '已结束进程' }
    }
    message = String(res.stderr || res.error || '').trim() || '结束失败，可能是权限不足'
  }
  // 兜底：直接用 Node 的 TerminateProcess / SIGKILL
  try {
    process.kill(pid)
  } catch {
    /* 忽略：无权限时由下面的存活检测统一报错 */
  }
  if (!(await isAlive(pid))) {
    return { ok: true, pid, message: '已结束进程（备用方式）' }
  }
  return { ok: false, pid, error: message }
}

/**
 * 从 taskkill 输出里提炼错误原因（中英文均可能）。
 *
 * @param {{ stdout: string, stderr: string, error: string }} res 执行结果
 * @returns {string} 错误原因，取不到时返回空串
 */
function pickTaskkillError(res) {
  const text = `${res?.stderr || ''}\n${res?.stdout || ''}`
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /错误|ERROR/i.test(item))
  return line || ''
}

module.exports = { search, kill, isAlive }
