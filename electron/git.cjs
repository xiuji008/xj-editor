/**
 * Git 版本管理（Electron 主进程模块）
 *
 * 设计要点：
 * - 通过 child_process 调用系统已安装的 git，不引入任何第三方依赖；
 * - 渲染层只传语义参数（repoRoot / path / message），命令与参数全部在本模块内拼装，杜绝命令注入；
 * - 所有写操作（add / unstage / commit / restore）按仓库串行执行，避免 .git/index.lock 冲突；
 * - 统一处理中文路径（core.quotepath=false）与 UTF-8 输出（i18n.logOutputEncoding）。
 */
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const execFileAsync = require('util').promisify(execFile)

/** 配置文件路径（由 main.cjs 注入：app.getPath('userData')/git-config.json） */
let configFilePath = ''
/** git 可执行文件探测结果缓存：{ bin, version } */
let gitBinCache = null
/** 仓库检测结果缓存：dirPath -> result */
const detectCache = new Map()
/** 写操作串行队列：repoRoot -> Promise */
const writeQueues = new Map()

/** 单次执行默认超时（毫秒） */
const DEFAULT_TIMEOUT = 15000
/** 提交等重操作的超时（毫秒） */
const LONG_TIMEOUT = 60000
/** 网络操作（fetch / pull / push）超时（毫秒） */
const NETWORK_TIMEOUT = 120000
/** 克隆操作超时（毫秒）：大仓库耗时可能达数分钟，单独放宽 */
const CLONE_TIMEOUT = 10 * 60 * 1000
/** 单次执行 stdout 上限（字节） */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024
/** 状态列表单组最多返回条数，超出部分截断 */
const MAX_CHANGES = 500
/** diff 文本上限（字符），超出部分截断 */
const MAX_DIFF_CHARS = 1024 * 1024

/**
 * 设置配置文件路径
 * @param {string} p git-config.json 的完整路径
 */
function setConfigPath(p) {
  configFilePath = p || ''
}

/**
 * 读取 Git 配置（目前仅 gitPath：用户手动指定的 git 可执行文件路径）
 * @returns {Promise<{ gitPath?: string }>} 配置对象，读取失败时返回空对象
 */
async function readGitConfig() {
  try {
    if (!configFilePath) return {}
    const text = await fsp.readFile(configFilePath, 'utf8')
    const data = JSON.parse(text)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * 合并写入 Git 配置
 * @param {object} patch 需要合并的配置片段
 * @returns {Promise<object>} 合并后的完整配置
 */
async function writeGitConfig(patch) {
  const current = await readGitConfig()
  const next = { ...current, ...(patch || {}) }
  if (configFilePath) {
    try {
      await fsp.mkdir(path.dirname(configFilePath), { recursive: true })
      await fsp.writeFile(configFilePath, JSON.stringify(next, null, 2), 'utf8')
    } catch {
      /* 配置写入失败不影响主流程 */
    }
  }
  return next
}

/**
 * 候选 git 可执行文件路径（按平台区分）
 * @returns {string[]} 候选路径列表
 */
function candidateGitPaths() {
  const list = []
  if (process.env.GIT_PATH) list.push(process.env.GIT_PATH)
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env.LOCALAPPDATA || ''
    list.push(path.join(pf, 'Git', 'cmd', 'git.exe'))
    list.push(path.join(pf, 'Git', 'bin', 'git.exe'))
    list.push(path.join(pf86, 'Git', 'cmd', 'git.exe'))
    if (local) list.push(path.join(local, 'Programs', 'Git', 'cmd', 'git.exe'))
  } else {
    list.push('/usr/local/bin/git', '/opt/homebrew/bin/git', '/usr/bin/git')
  }
  list.push('git')
  return list
}

/**
 * 探测可用的 git 可执行文件（优先使用用户手动指定的路径）
 * @param {boolean} force 是否忽略缓存重新探测
 * @returns {Promise<{ bin: string, version: string } | null>} 探测结果，未安装时返回 null
 */
async function resolveGit(force = false) {
  if (!force && gitBinCache) return gitBinCache
  const cfg = await readGitConfig()
  const candidates = []
  if (cfg.gitPath) candidates.push(cfg.gitPath)
  candidates.push(...candidateGitPaths())
  for (const bin of candidates) {
    try {
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 8000, windowsHide: true })
      const matched = /git version (\d+(?:\.\d+)*)/.exec(String(stdout))
      gitBinCache = { bin, version: matched ? matched[1] : String(stdout).trim() }
      return gitBinCache
    } catch {
      /* 该候选不可用，继续尝试下一个 */
    }
  }
  gitBinCache = null
  return null
}

/**
 * 比较两个点分版本号
 * @param {string} version 待比较版本，如 2.39.1
 * @param {string} target 目标版本，如 2.23.0
 * @returns {boolean} version >= target 时返回 true
 */
function versionAtLeast(version, target) {
  const a = String(version || '').split('.').map((n) => Number(n) || 0)
  const b = String(target).split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return true
}

/**
 * 执行一次 git 命令（spawn 数组参数，不使用 shell）
 * @param {string} bin git 可执行文件路径
 * @param {string[]} args git 参数
 * @param {string} cwd 工作目录
 * @param {{ timeout?: number, maxBuffer?: number, stdinData?: string, onStderr?: (chunk: string) => void }} options 执行选项
 * @returns {Promise<{ code: number, killed: boolean, truncated: boolean, stdout: string, stderr: string }>} 执行结果
 */
function spawnOnce(bin, args, cwd, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const maxBuffer = options.maxBuffer || DEFAULT_MAX_BUFFER
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, { cwd, windowsHide: true, env: options.env || process.env })
    } catch (err) {
      reject(err)
      return
    }
    const outChunks = []
    const errChunks = []
    let outLen = 0
    let errLen = 0
    let killed = false
    let truncated = false
    const timer = setTimeout(() => {
      killed = true
      try {
        child.kill()
      } catch {
        /* 进程已退出 */
      }
    }, timeout)

    child.stdout.on('data', (buf) => {
      if (outLen + buf.length > maxBuffer) {
        truncated = true
        killed = true
        try {
          child.kill()
        } catch {
          /* 进程已退出 */
        }
        return
      }
      outLen += buf.length
      outChunks.push(buf)
    })
    child.stderr.on('data', (buf) => {
      // 进度类输出（如 clone --progress）走回调实时回吐，不受下面截断阈值限制
      if (typeof options.onStderr === 'function') options.onStderr(buf.toString('utf8'))
      if (errLen > 512 * 1024) return
      errLen += buf.length
      errChunks.push(buf)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: typeof code === 'number' ? code : -1,
        killed,
        truncated,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      })
    })

    try {
      if (typeof options.stdinData === 'string') child.stdin.end(options.stdinData)
      else child.stdin.end()
    } catch {
      /* 标准输入已关闭 */
    }
  })
}

/**
 * 执行 git 命令并返回统一结果
 * @param {string[]} args git 参数（不含 git 可执行文件与全局 -c 配置）
 * @param {string} cwd 仓库目录
 * @param {{ timeout?: number, maxBuffer?: number, stdinData?: string }} options 执行选项
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string, truncated?: boolean, error?: string, message?: string }>} 执行结果
 */
async function run(args, cwd, options = {}) {
  const gitBin = await resolveGit()
  if (!gitBin) {
    return { ok: false, code: -1, stdout: '', stderr: '', error: 'NO_GIT', message: '未检测到 Git，请安装 Git 或在 Git 设置中指定 git.exe 路径' }
  }
  const finalArgs = ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8', ...args]
  let res
  try {
    res = await spawnOnce(gitBin.bin, finalArgs, cwd, options)
  } catch (err) {
    return { ok: false, code: -1, stdout: '', stderr: '', error: 'GIT_EXEC_ERROR', message: err?.message || String(err) }
  }
  if (res.killed) {
    return { ok: false, code: -1, stdout: res.stdout, stderr: res.stderr, error: 'TIMEOUT', message: 'Git 命令执行超时，请稍后重试' }
  }
  const result = {
    ok: res.code === 0,
    code: res.code,
    stdout: res.stdout,
    stderr: res.stderr,
    truncated: res.truncated,
    gitVersion: gitBin.version,
  }
  if (!result.ok) {
    result.error = 'GIT_ERROR'
    result.message = (res.stderr || res.stdout || 'Git 命令执行失败').trim().slice(0, 500)
  }
  return result
}

/**
 * 将渲染层传入的路径转换为仓库内相对路径，并校验其位于仓库内
 * @param {string} repoRoot 仓库根目录
 * @param {string} target 目标路径（绝对或相对仓库根）
 * @returns {string} 仓库内相对路径（正斜杠）
 */
function toRelPath(repoRoot, target) {
  const root = path.resolve(repoRoot)
  const full = path.resolve(root, target)
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径不在仓库内：${target}`)
  }
  return rel.split(path.sep).join('/')
}

/**
 * 批量转换路径为仓库内相对路径
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} paths 目标路径列表
 * @returns {string[]} 相对路径列表
 */
function toRelPaths(repoRoot, paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('未选择文件')
  return paths.map((p) => toRelPath(repoRoot, p))
}

/**
 * 将写操作加入串行队列（避免并发写 .git/index 冲突）
 * @param {string} repoRoot 仓库根目录
 * @param {() => Promise<any>} task 待执行任务
 * @returns {Promise<any>} 任务执行结果
 */
function enqueueWrite(repoRoot, task) {
  const key = repoRoot || '__global__'
  const prev = writeQueues.get(key) || Promise.resolve()
  const next = prev.then(task, task)
  writeQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/**
 * 解析 `git status -b` 的分支头行，如 `## main...origin/main [ahead 2, behind 1]`
 * @param {string} line 分支头行
 * @returns {{ branch: string, upstream: string, ahead: number, behind: number, detached: boolean, upstreamGone: boolean }} 分支信息
 */
function parseBranchLine(line) {
  let text = String(line || '').replace(/^##\s+/, '')
  let ahead = 0
  let behind = 0
  let upstreamGone = false
  const bracket = text.match(/\[([^\]]*)\]/)
  if (bracket) {
    upstreamGone = /\bgone\b/i.test(bracket[1])
    text = text.slice(0, bracket.index).trim()
    for (const part of bracket[1].split(',')) {
      const m = part.trim().match(/^(ahead|behind)\s+(\d+)$/)
      if (!m) continue
      if (m[1] === 'ahead') ahead = Number(m[2])
      else behind = Number(m[2])
    }
  }
  let detached = /\(no branch\)/.test(text)
  let branch = text
  let upstream = ''
  if (text.includes('...')) {
    const parts = text.split('...')
    branch = parts[0].trim()
    upstream = (parts[1] || '').trim()
  }
  branch = branch.replace(/^No commits yet on\s+/, '').trim()
  if (!branch) branch = 'HEAD'
  if (detached) branch = 'HEAD'
  return { branch, upstream, ahead, behind, detached, upstreamGone }
}

/**
 * 在 -b 分支行缺失时，通过 rev-parse 单独读取分支与上游信息
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ branch: string, upstream: string, ahead: number, behind: number, detached: boolean, upstreamGone: boolean }>} 分支信息
 */
async function readBranchInfo(repoRoot) {
  const branchRes = await run(['symbolic-ref', '--short', 'HEAD'], repoRoot, { timeout: 8000 })
  const detached = !branchRes.ok
  let branch = detached ? 'HEAD' : branchRes.stdout.trim()
  if (detached) {
    const headRes = await run(['rev-parse', '--short', 'HEAD'], repoRoot, { timeout: 8000 })
    if (headRes.ok) branch = headRes.stdout.trim()
  }
  let upstream = ''
  let ahead = 0
  let behind = 0
  let upstreamGone = false
  const upRes = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot, { timeout: 8000 })
  if (upRes.ok && upRes.stdout.trim()) {
    upstream = upRes.stdout.trim()
    const countRes = await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], repoRoot, { timeout: 10000 })
    const nums = countRes.ok ? countRes.stdout.trim().split(/\s+/) : []
    if (nums.length >= 2) {
      behind = Number(nums[0]) || 0
      ahead = Number(nums[1]) || 0
    }
  } else if (!detached && branch) {
    // @{u} 解析失败：若分支配置了上游（branch.<name>.merge）但远程引用不存在，
    // 说明远端仓库还没有该分支（常见于推送到空仓库 / fetch --prune 之后）
    const cfgRes = await run(['config', `branch.${branch}.merge`], repoRoot, { timeout: 8000 })
    upstreamGone = cfgRes.ok && !!cfgRes.stdout.trim()
  }
  return { branch, upstream, ahead, behind, detached, upstreamGone }
}

/**
 * 构造单个文件变更对象
 * @param {string} relPath 仓库内相对路径
 * @param {string} code 状态码
 * @param {boolean} staged 是否已暂存
 * @param {string} [origPath] 重命名 / 复制前的原路径
 * @returns {{ path: string, name: string, dir: string, status: string, staged: boolean, renamedFrom?: string }} 变更对象
 */
function makeChange(relPath, code, staged, origPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/')
  const segments = normalized.split('/')
  const name = segments[segments.length - 1] || normalized
  return {
    path: normalized,
    name,
    dir: segments.slice(0, -1).join('/'),
    status: code,
    staged,
    renamedFrom: origPath ? String(origPath).replace(/\\/g, '/') : undefined,
  }
}

/**
 * 清空内部缓存（切换 git 可执行文件路径后调用）
 */
function clearCaches() {
  detectCache.clear()
  gitBinCache = null
}

/**
 * 检测指定目录是否位于 Git 仓库内（支持在仓库子目录打开）
 * @param {string} dirPath 目录路径
 * @returns {Promise<{ ok: boolean, isRepo: boolean, repoRoot?: string, gitAvailable: boolean, gitVersion?: string, message?: string }>} 检测结果
 */
async function detect(dirPath) {
  const gitBin = await resolveGit()
  if (!dirPath || typeof dirPath !== 'string') {
    return { ok: false, isRepo: false, gitAvailable: !!gitBin, message: '目录路径无效' }
  }
  let stat
  try {
    stat = await fsp.stat(dirPath)
  } catch {
    return { ok: false, isRepo: false, gitAvailable: !!gitBin, message: '目录不存在' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, isRepo: false, gitAvailable: !!gitBin, message: '不是目录' }
  }
  if (!gitBin) {
    return { ok: true, isRepo: false, gitAvailable: false, message: '未检测到 Git' }
  }
  if (detectCache.has(dirPath)) {
    return { ...detectCache.get(dirPath), gitAvailable: true, gitVersion: gitBin.version }
  }
  const res = await run(['rev-parse', '--show-toplevel', '--is-inside-work-tree'], dirPath, { timeout: 10000 })
  if (!res.ok) {
    const result = { ok: true, isRepo: false, gitAvailable: true, gitVersion: gitBin.version }
    detectCache.set(dirPath, result)
    return result
  }
  const lines = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  const repoRoot = lines[0] || dirPath
  const result = { ok: true, isRepo: true, repoRoot, gitAvailable: true, gitVersion: gitBin.version }
  detectCache.set(dirPath, result)
  return result
}

/**
 * 读取仓库状态（分支信息 + 暂存 / 未暂存 / 冲突分组）
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ ok: boolean, status?: object, message?: string }>} 状态结果
 */
async function status(repoRoot) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const res = await run(['status', '--porcelain=v1', '-z', '-uall', '-b'], repoRoot, {
    timeout: 20000,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (!res.ok) return { ok: false, message: res.message, error: res.error }

  const fields = res.stdout.split('\0')
  let index = 0
  let branchInfo = null
  if (fields[0] && fields[0].startsWith('## ')) {
    branchInfo = parseBranchLine(fields[0])
    index = 1
  } else {
    branchInfo = await readBranchInfo(repoRoot)
  }

  const staged = []
  const unstaged = []
  const conflicted = []
  let truncated = false

  while (index < fields.length) {
    const entry = fields[index]
    index += 1
    if (!entry || entry.length < 3) continue
    const x = entry[0]
    const y = entry[1]
    let relPath = entry.slice(2)
    if (relPath.startsWith(' ')) relPath = relPath.slice(1)
    let origPath = ''
    if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && fields[index]) {
      origPath = fields[index]
      index += 1
    }
    if (x === '!') continue // 已忽略文件不展示
    if (x === '?' && y === '?') {
      unstaged.push(makeChange(relPath, '?', false))
      continue
    }
    const isConflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
    if (isConflict) {
      conflicted.push(makeChange(relPath, 'U', false))
      continue
    }
    if (x && x !== ' ') staged.push(makeChange(relPath, x, true, origPath))
    if (y && y !== ' ') unstaged.push(makeChange(relPath, y, false, origPath))
  }

  const sortByName = (a, b) => a.path.localeCompare(b.path, 'zh-CN')
  staged.sort(sortByName)
  unstaged.sort(sortByName)
  conflicted.sort(sortByName)
  if (staged.length + unstaged.length + conflicted.length > MAX_CHANGES) truncated = true

  return {
    ok: true,
    status: {
      repoRoot,
      branch: branchInfo.branch,
      upstream: branchInfo.upstream,
      upstreamGone: !!branchInfo.upstreamGone,
      ahead: branchInfo.ahead,
      behind: branchInfo.behind,
      detached: branchInfo.detached,
      staged: staged.slice(0, MAX_CHANGES),
      unstaged: unstaged.slice(0, MAX_CHANGES),
      conflicted: conflicted.slice(0, MAX_CHANGES),
      truncated,
    },
  }
}

/**
 * 暂存指定文件（git add）
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} paths 文件路径列表
 * @returns {Promise<{ ok: boolean, message?: string }>} 操作结果
 */
async function add(repoRoot, paths) {
  const rel = toRelPaths(repoRoot, paths)
  return enqueueWrite(repoRoot, async () => {
    const res = await run(['add', '--', ...rel], repoRoot, { timeout: LONG_TIMEOUT })
    return res.ok ? { ok: true } : { ok: false, message: res.message, error: res.error }
  })
}

/**
 * 取消暂存指定文件（git restore --staged，旧版本回退 git reset）
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} paths 文件路径列表
 * @returns {Promise<{ ok: boolean, message?: string }>} 操作结果
 */
async function unstage(repoRoot, paths) {
  const rel = toRelPaths(repoRoot, paths)
  return enqueueWrite(repoRoot, async () => {
    const gitBin = (await resolveGit()) || { version: '0.0.0' }
    const args = versionAtLeast(gitBin.version, '2.23.0')
      ? ['restore', '--staged', '--', ...rel]
      : ['reset', '-q', 'HEAD', '--', ...rel]
    const res = await run(args, repoRoot, { timeout: LONG_TIMEOUT })
    return res.ok ? { ok: true } : { ok: false, message: res.message, error: res.error }
  })
}

/**
 * 提交已暂存的更改（提交信息通过 stdin 传入，避免转义问题）
 * @param {string} repoRoot 仓库根目录
 * @param {string} message 提交信息
 * @returns {Promise<{ ok: boolean, sha?: string, message?: string, error?: string }>} 提交结果
 */
async function commit(repoRoot, message) {
  const text = String(message || '').trim()
  if (!text) return { ok: false, error: 'EMPTY_MESSAGE', message: '提交信息不能为空' }
  return enqueueWrite(repoRoot, async () => {
    const res = await run(['commit', '--cleanup=whitespace', '-F', '-'], repoRoot, {
      timeout: LONG_TIMEOUT,
      stdinData: `${text}\n`,
    })
    if (res.ok) {
      const head = await run(['rev-parse', 'HEAD'], repoRoot, { timeout: 8000 })
      return { ok: true, sha: head.ok ? head.stdout.trim() : '' }
    }
    const output = `${res.stderr || ''}${res.stdout || ''}`
    if (/nothing to commit/i.test(output)) {
      return { ok: false, error: 'NOTHING_TO_COMMIT', message: '没有已暂存的更改可提交' }
    }
    if (/Please tell me who you are|user\.email|user\.name/i.test(output)) {
      return {
        ok: false,
        error: 'NO_IDENTITY',
        message: '尚未配置 Git 用户名与邮箱，请执行：git config --global user.name "你的名字" && git config --global user.email "你的邮箱"',
      }
    }
    return { ok: false, error: res.error, message: res.message }
  })
}

/**
 * 截断过长的 diff 文本
 * @param {string} text diff 原文
 * @returns {{ text: string, truncated: boolean }} 截断结果
 */
function truncateDiff(text) {
  if (text.length <= MAX_DIFF_CHARS) return { text, truncated: false }
  const cut = text.lastIndexOf('\n', MAX_DIFF_CHARS)
  const end = cut > 0 ? cut : MAX_DIFF_CHARS
  return { text: `${text.slice(0, end)}\n\n... 差异内容过大，已截断显示 ...\n`, truncated: true }
}

/**
 * 获取差异文本
 * @param {string} repoRoot 仓库根目录
 * @param {{ paths?: string[], staged?: boolean, sha?: string, revRange?: string }} options 差异选项
 * @returns {Promise<{ ok: boolean, diff?: string, truncated?: boolean, binary?: boolean, message?: string }>} diff 结果
 */
async function diff(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const rel = options.paths && options.paths.length ? toRelPaths(repoRoot, options.paths) : []
  const common = ['--no-color', '--no-ext-diff', '-U3']
  let args
  if (options.sha) {
    args = ['show', ...common, '--format=', String(options.sha), '--', ...rel]
  } else if (options.revRange) {
    args = ['diff', ...common, String(options.revRange), '--', ...rel]
  } else if (options.staged) {
    args = ['diff', '--cached', ...common, '--', ...rel]
  } else {
    args = ['diff', ...common, '--', ...rel]
  }
  const res = await run(args, repoRoot, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
  if (!res.ok) return { ok: false, message: res.message, error: res.error }
  const binary = /Binary files .* differ|GIT binary patch/.test(res.stdout)
  const cut = truncateDiff(res.stdout)
  return { ok: true, diff: cut.text, truncated: cut.truncated || !!res.truncated, binary }
}

/**
 * 读取提交历史
 * @param {string} repoRoot 仓库根目录
 * @param {{ path?: string, limit?: number, skip?: number, follow?: boolean }} options 查询选项
 * @returns {Promise<{ ok: boolean, commits?: object[], message?: string }>} 提交列表
 */
async function log(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 1000)
  const skip = Math.max(Number(options.skip) || 0, 0)
  const sep = '%x1f'
  const args = [
    'log',
    '--no-color',
    '--date=iso',
    `--pretty=format:%H${sep}%an${sep}%ae${sep}%ad${sep}%s${sep}%d`,
    '-n',
    String(limit),
  ]
  if (skip > 0) args.push('--skip', String(skip))
  if (options.follow && options.path) args.push('--follow')
  if (options.path) args.push('--', toRelPath(repoRoot, options.path))
  const res = await run(args, repoRoot, { timeout: 20000, maxBuffer: 12 * 1024 * 1024 })
  if (!res.ok) return { ok: false, message: res.message, error: res.error }
  const commits = []
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\u001f')
    const sha = parts[0] || ''
    if (!sha) continue
    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      author: parts[1] || '',
      email: parts[2] || '',
      date: parts[3] || '',
      message: parts[4] || '',
      refs: (parts[5] || '').trim(),
    })
  }
  return { ok: true, commits }
}

/**
 * 还原工作区文件（丢弃未提交的修改）
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} paths 文件路径列表
 * @returns {Promise<{ ok: boolean, message?: string }>} 操作结果
 */
async function restore(repoRoot, paths) {
  const rel = toRelPaths(repoRoot, paths)
  return enqueueWrite(repoRoot, async () => {
    const gitBin = (await resolveGit()) || { version: '0.0.0' }
    const args = versionAtLeast(gitBin.version, '2.23.0')
      ? ['restore', '--', ...rel]
      : ['checkout', '--', ...rel]
    const res = await run(args, repoRoot, { timeout: LONG_TIMEOUT })
    return res.ok ? { ok: true } : { ok: false, message: res.message, error: res.error }
  })
}

/* ==================== P1：分支 / 远程同步 / 储藏 / 忽略规则 ==================== */

/**
 * 远程操作专用执行：关闭交互式凭据输入（避免进程等待输入而挂起），并设置较长超时
 * @param {string[]} args git 参数
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<object>} 执行结果
 */
function runNetwork(args, repoRoot) {
  return run(args, repoRoot, {
    timeout: NETWORK_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

/**
 * 把 git 的原始报错转换为可操作的中文提示
 * @param {object} res run() 的执行结果
 * @param {string} action 操作名，如「推送」「拉取」「切换分支」
 * @returns {{ error: string, message: string }} 错误码与提示
 */
function friendlyRemoteError(res, action) {
  const text = `${res.stderr || ''}\n${res.stdout || ''}`
  const fail = (error, message) => ({ error, message })
  if (/Authentication failed|could not read Username|Invalid username or password|Permission denied \(publickey\)|access denied/i.test(text)) {
    return fail('AUTH_FAILED', `${action}失败：认证失败，请检查凭据（SSH key 或 credential helper）配置`)
  }
  if (/does not appear to be a git repository|No such remote|bad repository/i.test(text)) {
    return fail('NO_REMOTE', `${action}失败：找不到对应的远程仓库，请检查 remote 配置（git remote -v）`)
  }
  if (/has no upstream branch|no upstream configured|There is no tracking information/i.test(text)) {
    return fail('NO_UPSTREAM', `${action}失败：当前分支没有上游分支，请勾选「设置上游」后重试`)
  }
  if (/Updates were rejected|non-fast-forward|fetch first/i.test(text)) {
    return fail('REJECTED', `${action}被拒绝：远程存在本地没有的提交，请先拉取`)
  }
  if (/Could not resolve host|Couldn't connect|Connection timed out|timed out|unable to access|Failed to connect/i.test(text)) {
    return fail('NETWORK', `${action}失败：无法连接远程仓库，请检查网络或远程地址`)
  }
  if (/Repository not found/i.test(text)) {
    return fail('NOT_FOUND', `${action}失败：远程仓库不存在或没有访问权限`)
  }
  if (/CONFLICT|Automatic merge failed|would be overwritten by merge/i.test(text)) {
    return fail('CONFLICT', `${action}出现冲突，请在外部工具中解决冲突后再继续`)
  }
  if (/local changes to the following files|local changes would be overwritten|Please commit your changes or stash/i.test(text)) {
    return fail('DIRTY', `${action}失败：本地有未提交的修改，请先提交或使用储藏（stash）`)
  }
  const detail = text.trim().slice(0, 300)
  return fail('GIT_ERROR', `${action}失败：${detail || '未知错误'}`)
}

/* ==================== 克隆仓库（从 Git 打开） ==================== */

/** 克隆进度阶段：git 输出的关键词 -> 中文阶段名 */
const CLONE_PHASES = [
  [/Enumerating objects/i, '枚举对象'],
  [/Counting objects/i, '统计对象'],
  [/Compressing objects/i, '压缩对象'],
  [/Receiving objects/i, '接收对象'],
  [/Resolving deltas/i, '解析差异'],
  [/Checking out files|Updating files/i, '检出文件'],
  [/Filtering content/i, '过滤内容'],
  [/remote:/i, '远程仓库'],
]

/**
 * 从仓库地址推导默认项目目录名（HTTPS / SSH / 本地路径三种写法）
 * @param {string} url 仓库地址
 * @returns {string} 目录名，无法推导时返回 git-repo
 */
function repoNameFromUrl(url) {
  const raw = String(url || '').trim().replace(/\\/g, '/')
  if (!raw) return ''
  // 去掉查询串与末尾斜杠后取最后一段，再剥掉 .git 后缀
  const last = raw.split('?')[0].replace(/\/+$/, '').split('/').pop() || ''
  const name = last
    .replace(/\.git$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^\.+/, '')
    .trim()
  return name || 'git-repo'
}

/**
 * 解析 `git clone --progress` 的单行输出，提取阶段名与百分比
 * @param {string} line 原始输出行（git 用 \r 刷新同一行进度）
 * @returns {{ phase: string, percent: number, text: string } | null} 解析结果，空行返回 null
 */
function parseCloneProgress(line) {
  const text = String(line || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  let phase = '克隆中'
  for (const [re, label] of CLONE_PHASES) {
    if (re.test(text)) {
      phase = label
      break
    }
  }
  const pctMatch = /(\d{1,3})%/.exec(text)
  const percent = pctMatch ? Math.min(100, Math.max(0, Number(pctMatch[1]))) : -1
  return { phase, percent, text }
}

/**
 * 生成克隆进度回吐器：把 git 的分块输出按行解析，去重后回调（同一阶段同一百分比只回吐一次）
 * @param {(info: { phase: string, percent: number, text: string }) => void} onProgress 进度回调
 * @returns {(chunk: string) => void} 接收 stderr 分块的函数
 */
function makeCloneProgressHandler(onProgress) {
  let buffer = ''
  let lastKey = ''
  return (chunk) => {
    buffer += String(chunk || '')
    // git 用 \r 覆盖同一行刷新进度，因此 \r 与 \n 都视为行分隔
    const parts = buffer.split(/[\r\n]/)
    buffer = parts.pop() || ''
    for (const part of parts) {
      const info = parseCloneProgress(part)
      if (!info) continue
      const key = `${info.phase}|${info.percent}`
      if (key === lastKey) continue
      lastKey = key
      onProgress(info)
    }
  }
}

/**
 * 克隆远程仓库到本地目录（存放目录下以项目名新建子目录，克隆完成后返回该目录）
 * @param {string} url 仓库地址（HTTPS / SSH / 本地路径）
 * @param {string} parentDir 用于存放该仓库的父目录
 * @param {{ dirName?: string, branch?: string, depth?: number, onProgress?: (info: object) => void }} options 选项
 * @returns {Promise<{ ok: boolean, path?: string, branch?: string, error?: string, message?: string }>} 克隆结果
 */
async function clone(url, parentDir, options = {}) {
  const remote = String(url || '').trim()
  if (!remote) return { ok: false, error: 'GIT_INVALID_PARAM', message: '仓库地址不能为空' }
  if (remote.startsWith('-')) return { ok: false, error: 'GIT_INVALID_PARAM', message: '仓库地址不合法' }
  const parent = String(parentDir || '').trim()
  if (!parent) return { ok: false, error: 'GIT_INVALID_PARAM', message: '请先选择存放目录' }
  const dirName = String(options.dirName || '').trim() || repoNameFromUrl(remote)
  if (/[\\/:*?"<>|]/.test(dirName)) {
    return { ok: false, error: 'GIT_INVALID_PARAM', message: `项目目录名含非法字符：${dirName}` }
  }
  const target = path.join(parent, dirName)
  try {
    await fsp.mkdir(parent, { recursive: true })
  } catch (err) {
    return { ok: false, error: 'DIR_CREATE_FAILED', message: `存放目录创建失败：${err?.message || err}` }
  }
  // git clone 要求目标目录不存在或为空，提前判定以便给出明确提示
  let existing = null
  try {
    existing = await fsp.readdir(target)
  } catch {
    existing = null
  }
  if (Array.isArray(existing) && existing.length) {
    return { ok: false, error: 'TARGET_NOT_EMPTY', message: `目标目录已存在且不为空：${target}` }
  }

  const branch = String(options.branch || '').trim()
  if (branch && branch.startsWith('-')) {
    return { ok: false, error: 'GIT_INVALID_PARAM', message: '分支名不合法' }
  }
  const depth = Number(options.depth)
  const args = ['clone', '--progress']
  if (branch) args.push('--branch', branch)
  if (Number.isInteger(depth) && depth > 0) args.push('--depth', String(depth))
  // -- 结束选项解析，避免形如 -xxx 的仓库地址被当作参数
  args.push('--', remote, target)

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const res = await run(args, parent, {
    timeout: CLONE_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    onStderr: onProgress ? makeCloneProgressHandler(onProgress) : undefined,
  })
  if (!res.ok) {
    if (/already exists and is not an empty directory/i.test(`${res.stderr}${res.stdout}`)) {
      return { ok: false, error: 'TARGET_NOT_EMPTY', message: `目标目录已存在且不为空：${target}` }
    }
    const mapped = friendlyRemoteError(res, '克隆')
    return { ok: false, error: mapped.error, message: mapped.message }
  }
  // 新目录此前未参与过仓库检测，清空检测缓存避免使用旧结果
  detectCache.clear()
  const branchRes = await run(['rev-parse', '--abbrev-ref', 'HEAD'], target, { timeout: 15000 })
  return {
    ok: true,
    path: target,
    branch: branchRes.ok ? String(branchRes.stdout || '').trim() : '',
  }
}

/**
 * 解析 `git branch --format=...` 的输出
 * @param {object} res run() 的执行结果
 * @returns {object[]} 分支信息列表
 */
function parseBranchList(res) {
  const list = []
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.trim()) continue
    // 分隔符用 ~：引用名中不允许出现该字符，且最后一段（提交标题）取剩余全部内容
    const parts = line.split('~')
    const [name, sha, upstream, track, head, date] = parts
    const subject = parts.slice(6).join('~')
    if (!name) continue
    const aheadMatch = /ahead\s+(\d+)/.exec(String(track || ''))
    const behindMatch = /behind\s+(\d+)/.exec(String(track || ''))
    list.push({
      name,
      sha: sha || '',
      upstream: upstream || '',
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0,
      current: String(head || '').trim() === '*',
      date: date || '',
      subject: subject || '',
    })
  }
  return list
}

/**
 * 校验分支名是否合法（交由 git check-ref-format 判定，避免自造规则）
 * @param {string} repoRoot 仓库根目录
 * @param {string} name 分支名
 * @returns {Promise<{ ok: boolean, message?: string }>} 校验结果
 */
async function checkBranchName(repoRoot, name) {
  const value = String(name || '').trim()
  if (!value) return { ok: false, message: '分支名不能为空' }
  if (value.startsWith('-')) return { ok: false, message: '分支名不能以 - 开头' }
  const res = await run(['check-ref-format', '--branch', value], repoRoot, { timeout: 8000 })
  return res.ok ? { ok: true } : { ok: false, message: `分支名不合法：${value}` }
}

/**
 * 读取本地与远程分支列表
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ ok: boolean, current?: string, local?: object[], remote?: object[], message?: string }>} 分支列表
 */
async function branches(repoRoot) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const format =
    '%(refname:short)~%(objectname:short)~%(upstream:short)~%(upstream:track)~%(HEAD)~%(authordate:iso)~%(subject)'
  const [localRes, remoteRes] = await Promise.all([
    run(['branch', '--list', '--format', format], repoRoot, { timeout: 15000 }),
    run(['branch', '--list', '--remotes', '--format', format], repoRoot, { timeout: 15000 }),
  ])
  if (!localRes.ok) return { ok: false, message: localRes.message, error: localRes.error }
  const local = parseBranchList(localRes)
  // 远程分支名形如 origin/xxx，过滤掉 origin/HEAD 等符号引用与异常条目
  const remote = parseBranchList(remoteRes).filter(
    (b) => b.name.includes('/') && !b.name.endsWith('/HEAD'),
  )
  const current = (local.find((b) => b.current) || {}).name || ''
  return { ok: true, current, local, remote }
}

/**
 * 切换分支；create 为 true 时基于 from（默认当前 HEAD）新建并切换
 * @param {string} repoRoot 仓库根目录
 * @param {{ branch: string, create?: boolean, from?: string }} options 选项
 * @returns {Promise<{ ok: boolean, branch?: string, message?: string, error?: string }>} 操作结果
 */
async function checkout(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const name = String(options.branch || '').trim()
  const valid = await checkBranchName(repoRoot, name)
  if (!valid.ok) return { ok: false, error: 'INVALID_NAME', message: valid.message }
  const from = String(options.from || '').trim()
  return enqueueWrite(repoRoot, async () => {
    const args = options.create
      ? ['checkout', '-b', name, ...(from ? [from] : [])]
      : ['checkout', name]
    const res = await run(args, repoRoot, { timeout: LONG_TIMEOUT })
    if (res.ok) return { ok: true, branch: name }
    const mapped = friendlyRemoteError(res, options.create ? '新建分支' : '切换分支')
    return { ok: false, error: mapped.error, message: mapped.message }
  })
}

/**
 * 删除本地分支（不允许删除当前分支；-d 失败时由调用方决定是否 -D）
 * @param {string} repoRoot 仓库根目录
 * @param {{ branch: string, force?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>} 操作结果
 */
async function deleteBranch(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const name = String(options.branch || '').trim()
  if (!name) return { ok: false, message: '分支名不能为空' }
  return enqueueWrite(repoRoot, async () => {
    const currentRes = await run(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot, { timeout: 8000 })
    if (currentRes.ok && currentRes.stdout.trim() === name) {
      return { ok: false, error: 'CURRENT_BRANCH', message: '不能删除当前所在的分支，请先切换到其它分支' }
    }
    const res = await run(['branch', options.force ? '-D' : '-d', name], repoRoot, { timeout: LONG_TIMEOUT })
    if (res.ok) return { ok: true }
    return { ok: false, error: 'GIT_ERROR', message: (res.stderr || res.stdout || '删除分支失败').trim().slice(0, 300) }
  })
}

/**
 * 读取远程仓库列表
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ ok: boolean, remotes?: object[], message?: string }>} 远程列表
 */
async function remotes(repoRoot) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const res = await run(['remote', '-v'], repoRoot, { timeout: 10000 })
  if (!res.ok) return { ok: false, message: res.message, error: res.error }
  const map = new Map()
  for (const line of String(res.stdout || '').split('\n')) {
    const matched = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (matched && !map.has(matched[1])) map.set(matched[1], { name: matched[1], url: matched[2] })
  }
  return { ok: true, remotes: [...map.values()] }
}

/**
 * 解析推送 / 拉取使用的远程仓库名
 *
 * 注意：`git push` / `git pull` 的第一个位置参数是「远程仓库」，只有传了远程之后
 * 才能继续传 refspec。若只拼分支名（`git push master`），git 会把 master 当成
 * 远程仓库名解析，报 `fatal: 'master' does not appear to be a git repository`。
 * 因此这里统一补出远程名。
 *
 * 取值优先级：调用方指定 > 当前分支上游所属的远程 > origin > 第一个已配置的远程。
 * @param {string} repoRoot 仓库根目录
 * @param {string} [preferred] 调用方指定的远程名
 * @returns {Promise<string>} 远程仓库名；仓库未配置任何远程时返回空字符串
 */
async function resolveRemote(repoRoot, preferred = '') {
  const wanted = String(preferred || '').trim()
  if (wanted) return wanted
  const upRes = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot, { timeout: 8000 })
  const upstream = upRes.ok ? String(upRes.stdout || '').trim() : ''
  if (upstream.includes('/')) return upstream.split('/')[0]
  const listRes = await remotes(repoRoot)
  const list = (listRes.ok && listRes.remotes) || []
  if (!list.length) return ''
  return list.some((r) => r.name === 'origin') ? 'origin' : list[0].name
}

/**
 * 规范化推送 / 拉取使用的 refspec：游离 HEAD 或裸提交号统一用 HEAD，
 * 非法分支名返回空串（由调用方报错）
 * @param {string} branch 原始分支名
 * @returns {string} 可安全作为 refspec 的值
 */
function normalizeRefspec(branch) {
  const value = String(branch || '').trim()
  if (!value) return ''
  if (value.startsWith('-')) return '__INVALID__'
  // 游离 HEAD 时 status 返回 HEAD 或短提交号，直接用作 refspec 会推错
  if (value === 'HEAD' || /^[0-9a-f]{7,40}$/i.test(value)) return 'HEAD'
  return value
}

/**
 * 获取远程更新（git fetch）
 * @param {string} repoRoot 仓库根目录
 * @param {{ remote?: string, prune?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>} 操作结果
 */
async function fetchRemote(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const remote = String(options.remote || '').trim()
  return enqueueWrite(repoRoot, async () => {
    const args = ['fetch', ...(options.prune ? ['--prune'] : []), ...(remote ? [remote] : [])]
    const res = await runNetwork(args, repoRoot)
    if (res.ok) return { ok: true }
    const mapped = friendlyRemoteError(res, '获取远程更新')
    return { ok: false, error: mapped.error, message: mapped.message }
  })
}

/**
 * 拉取（git pull，默认不自动打开编辑器）
 * @param {string} repoRoot 仓库根目录
 * @param {{ remote?: string, branch?: string, rebase?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, summary?: string, message?: string, error?: string }>} 操作结果
 */
async function pull(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const refspec = normalizeRefspec(options.branch)
  if (refspec === '__INVALID__') return { ok: false, error: 'INVALID_NAME', message: `分支名不合法：${options.branch}` }
  return enqueueWrite(repoRoot, async () => {
    // 指定了分支却没指定远程时，补出远程名，否则 git 会把分支名当成远程仓库
    let remote = String(options.remote || '').trim()
    if (!remote && refspec) {
      remote = await resolveRemote(repoRoot)
      if (!remote) {
        return {
          ok: false,
          error: 'NO_REMOTE',
          message: '拉取失败：当前仓库没有配置远程仓库，请先添加远程（git remote add origin <仓库地址>）',
        }
      }
    }
    const args = ['pull', ...(options.rebase ? ['--rebase'] : ['--no-edit']), ...(remote ? [remote] : []), ...(refspec ? [refspec] : [])]
    const res = await runNetwork(args, repoRoot)
    if (res.ok) return { ok: true, summary: String(res.stderr || res.stdout || '').trim().slice(0, 300) }
    const mapped = friendlyRemoteError(res, '拉取')
    return { ok: false, error: mapped.error, message: mapped.message }
  })
}

/**
 * 判断当前分支的上游是否「已失效」：配置了上游（branch.<name>.merge），
 * 但对应远程引用不存在——即远端仓库还没有该分支（空仓库首推）或被 fetch --prune 清理。
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<boolean>} 上游失效返回 true
 */
async function isUpstreamGone(repoRoot) {
  const branchRes = await run(['symbolic-ref', '--short', 'HEAD'], repoRoot, { timeout: 8000 })
  const branch = branchRes.ok ? String(branchRes.stdout || '').trim() : ''
  if (!branch) return false
  const cfgRes = await run(['config', `branch.${branch}.merge`], repoRoot, { timeout: 8000 })
  if (!cfgRes.ok || !String(cfgRes.stdout || '').trim()) return false
  const upRes = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot, { timeout: 8000 })
  return !upRes.ok
}

/**
 * 推送（git push，可设置上游）
 * @param {string} repoRoot 仓库根目录
 * @param {{ remote?: string, branch?: string, setUpstream?: boolean, forceWithLease?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, summary?: string, message?: string, error?: string }>} 操作结果
 */
async function push(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const refspec = normalizeRefspec(options.branch)
  if (refspec === '__INVALID__') return { ok: false, error: 'INVALID_NAME', message: `分支名不合法：${options.branch}` }
  return enqueueWrite(repoRoot, async () => {
    const remote = await resolveRemote(repoRoot, options.remote)
    if (!remote) {
      return {
        ok: false,
        error: 'NO_REMOTE',
        message: '推送失败：当前仓库没有配置远程仓库，请先添加远程（git remote add origin <仓库地址>）',
      }
    }
    // 游离 HEAD 时 refspec 会被规范为 HEAD，直接推会在远端创建名为 HEAD 的分支
    if (refspec === 'HEAD') {
      return {
        ok: false,
        error: 'DETACHED',
        message: '推送失败：当前处于游离 HEAD，请先在分支管理中新建分支后再推送',
      }
    }
    // 上游已失效时自动补 --set-upstream：显式 remote+refspec 本身就会在远端创建分支，
    // 这里额外修复本地的跟踪关系，避免一直停留在 "upstream is gone" 状态
    const setUpstream = !!options.setUpstream || (await isUpstreamGone(repoRoot))
    const args = [
      'push',
      ...(setUpstream ? ['--set-upstream'] : []),
      ...(options.forceWithLease ? ['--force-with-lease'] : []),
      remote,
      ...(refspec ? [refspec] : []),
    ]
    const res = await runNetwork(args, repoRoot)
    if (res.ok) return { ok: true, summary: String(res.stderr || res.stdout || '').trim().slice(0, 300) }
    const mapped = friendlyRemoteError(res, '推送')
    return { ok: false, error: mapped.error, message: mapped.message }
  })
}

/**
 * 读取储藏（stash）列表
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ ok: boolean, stashes?: object[], message?: string }>} 储藏列表
 */
async function stashList(repoRoot) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  // %gd 在指定 --date 时会输出 stash@{日期}，因此这里不传 --date，改用 %aI 输出 ISO 时间；
  // 字段顺序把可能的任意内容（储藏说明）放在最后
  const res = await run(['stash', 'list', '--format=%gd~%H~%aI~%gs'], repoRoot, { timeout: 15000 })
  if (!res.ok) return { ok: false, message: res.message, error: res.error }
  const stashes = []
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('~')
    const [selector, sha, date] = parts
    // 储藏说明放在最后，可能包含分隔符，需重新拼接
    const subject = parts.slice(3).join('~')
    const indexMatch = /stash@\{(\d+)\}/.exec(String(selector || ''))
    const subjectMatch = /^(?:WIP on|On)\s+([^:]+):\s*([\s\S]*)$/.exec(String(subject || ''))
    stashes.push({
      index: indexMatch ? Number(indexMatch[1]) : stashes.length,
      selector: selector || '',
      branch: subjectMatch ? subjectMatch[1] : '',
      message: subjectMatch ? subjectMatch[2] : String(subject || ''),
      sha: sha || '',
      date: date || '',
    })
  }
  return { ok: true, stashes }
}

/**
 * 保存储藏（git stash push）
 * @param {string} repoRoot 仓库根目录
 * @param {{ message?: string, includeUntracked?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, empty?: boolean, message?: string, error?: string }>} 操作结果
 */
async function stashSave(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const message = String(options.message || '').trim()
  return enqueueWrite(repoRoot, async () => {
    const args = ['stash', 'push', ...(options.includeUntracked ? ['-u'] : []), ...(message ? ['-m', message] : [])]
    const res = await run(args, repoRoot, { timeout: LONG_TIMEOUT })
    if (!res.ok) return { ok: false, error: 'GIT_ERROR', message: (res.stderr || res.stdout || '储藏失败').trim().slice(0, 300) }
    const empty = /No local changes to save/i.test(`${res.stdout}${res.stderr}`)
    return { ok: true, empty }
  })
}

/**
 * 应用 / 弹出储藏
 * @param {string} repoRoot 仓库根目录
 * @param {{ index: number, pop?: boolean }} options 选项
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>} 操作结果
 */
async function stashApply(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const index = Number.isInteger(options.index) ? options.index : Number(options.index)
  if (!Number.isInteger(index) || index < 0) return { ok: false, error: 'INVALID_INDEX', message: '储藏序号无效' }
  return enqueueWrite(repoRoot, async () => {
    const res = await run(['stash', options.pop ? 'pop' : 'apply', `stash@{${index}}`], repoRoot, {
      timeout: LONG_TIMEOUT,
    })
    if (res.ok) return { ok: true }
    const mapped = friendlyRemoteError(res, options.pop ? '弹出储藏' : '应用储藏')
    return { ok: false, error: mapped.error, message: mapped.message }
  })
}

/**
 * 删除指定储藏
 * @param {string} repoRoot 仓库根目录
 * @param {{ index: number }} options 选项
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>} 操作结果
 */
async function stashDrop(repoRoot, options = {}) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const index = Number(options.index)
  if (!Number.isInteger(index) || index < 0) return { ok: false, error: 'INVALID_INDEX', message: '储藏序号无效' }
  return enqueueWrite(repoRoot, async () => {
    const res = await run(['stash', 'drop', `stash@{${index}}`], repoRoot, { timeout: LONG_TIMEOUT })
    if (res.ok) return { ok: true }
    return { ok: false, error: 'GIT_ERROR', message: (res.stderr || res.stdout || '删除储藏失败').trim().slice(0, 300) }
  })
}

/**
 * .gitignore 文件路径
 * @param {string} repoRoot 仓库根目录
 * @returns {string} 绝对路径
 */
function gitignorePathOf(repoRoot) {
  return path.join(path.resolve(repoRoot), '.gitignore')
}

/**
 * 读取 .gitignore 内容（文件不存在时返回空字符串）
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<{ ok: boolean, path?: string, content?: string, message?: string }>} 内容
 */
async function readGitignore(repoRoot) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const file = gitignorePathOf(repoRoot)
  try {
    const text = await fsp.readFile(file, 'utf8')
    return { ok: true, path: file, content: text }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, path: file, content: '' }
    return { ok: false, path: file, message: err?.message || '读取 .gitignore 失败' }
  }
}

/**
 * 写入 .gitignore（统一 LF 并保证以换行结尾）
 * @param {string} repoRoot 仓库根目录
 * @param {string} content 文件内容
 * @returns {Promise<{ ok: boolean, path?: string, message?: string }>} 写入结果
 */
async function writeGitignore(repoRoot, content) {
  if (!repoRoot) return { ok: false, message: '仓库路径为空' }
  const file = gitignorePathOf(repoRoot)
  const text = String(content ?? '').replace(/\r\n/g, '\n')
  try {
    await fsp.writeFile(file, !text || text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, path: file, message: err?.message || '写入 .gitignore 失败' }
  }
}

/**
 * 把指定路径加入 .gitignore（目录加 `/dir/`，文件加 `/file`）
 * @param {string} repoRoot 仓库根目录
 * @param {string} target 目标路径（绝对或相对仓库根）
 * @returns {Promise<{ ok: boolean, added?: boolean, rule?: string, tracked?: boolean, message?: string }>} 操作结果
 */
async function ignorePath(repoRoot, target) {
  const rel = toRelPath(repoRoot, target)
  let isDirectory = false
  try {
    const stat = await fsp.stat(path.resolve(repoRoot, rel))
    isDirectory = stat.isDirectory()
  } catch {
    /* 文件可能已被删除，按文件处理 */
  }
  const rule = isDirectory ? `/${rel}/` : `/${rel}`
  const current = await readGitignore(repoRoot)
  if (!current.ok) return { ok: false, message: current.message }
  const lines = String(current.content || '').split('\n')
  if (lines.some((line) => line.trim() === rule)) {
    return { ok: true, added: false, rule }
  }
  // 已被跟踪的文件加入忽略规则不会自动生效，需要提示用户先取消跟踪
  const trackedRes = await run(['ls-files', '--error-unmatch', '--', rel], repoRoot, { timeout: 10000 })
  const prefix = lines.length && lines[lines.length - 1].trim() ? '\n' : ''
  const writeRes = await writeGitignore(repoRoot, `${current.content || ''}${prefix}${rule}\n`)
  if (!writeRes.ok) return { ok: false, message: writeRes.message }
  return { ok: true, added: true, rule, tracked: trackedRes.ok }
}

/**
 * 检测 Git 是否可用
 * @param {boolean} force 是否忽略缓存重新探测
 * @returns {Promise<{ ok: boolean, available: boolean, version?: string, path?: string }>} 检测结果
 */
async function checkAvailable(force = false) {
  const gitBin = await resolveGit(!!force)
  if (!gitBin) return { ok: true, available: false }
  return { ok: true, available: true, version: gitBin.version, path: gitBin.bin }
}

/**
 * 读取 Git 设置
 * @returns {Promise<{ ok: boolean, gitPath?: string }>} 设置内容
 */
async function getConfig() {
  const cfg = await readGitConfig()
  return { ok: true, gitPath: cfg.gitPath || '' }
}

/**
 * 保存 Git 设置（指定 git 可执行文件路径后清空探测缓存）
 * @param {{ gitPath?: string }} config 设置内容
 * @returns {Promise<{ ok: boolean, message?: string }>} 保存结果
 */
async function setConfig(config = {}) {
  const gitPath = String(config.gitPath || '').trim()
  await writeGitConfig({ gitPath })
  clearCaches()
  if (gitPath) {
    const res = await checkAvailable(true)
    if (!res.available) return { ok: false, message: '指定的 Git 路径不可用，请检查后重试' }
  }
  return { ok: true }
}

module.exports = {
  setConfigPath,
  clearCaches,
  checkAvailable,
  getConfig,
  setConfig,
  detect,
  status,
  add,
  unstage,
  commit,
  diff,
  log,
  restore,
  // 克隆仓库（从 Git 打开）
  clone,
  repoNameFromUrl,
  // P1：分支 / 远程同步 / 储藏 / 忽略规则
  branches,
  checkout,
  deleteBranch,
  remotes,
  fetch: fetchRemote,
  pull,
  push,
  stashList,
  stashSave,
  stashApply,
  stashDrop,
  readGitignore,
  writeGitignore,
  ignorePath,
}
