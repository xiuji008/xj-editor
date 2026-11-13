/**
 * Agent Skill 管理（Electron 主进程模块）
 * - skill 目录 = `<name>/SKILL.md`（frontmatter: name/description/version/allowed-tools/targets）+ references/ + scripts/
 * - 两级来源：workspace（`<workspace>/.xj/skills/`，可写）> 内置（resources/skills，只读）
 * - 兼容识别 `<workspace>/.claude/skills/`（只读列出，导入后才生效）
 * - 启用/停用状态存 `{userData}/skills-state.json`（按 rootPath 记录，删除目录时自动清理）
 */
const fs = require('fs')
const path = require('path')

/** 单个 skill 的 references 目录名 */
const REFERENCES_DIR = 'references'
/** 每级来源最多扫描的 skill 数量（防异常目录刷爆） */
const MAX_SKILLS_PER_ROOT = 100

// ============================================================
// 启用/停用状态
// ============================================================

let statePath = ''

/** 初始化状态文件路径（由 main.cjs 调用一次） */
function initSkillsState(userDataDir) {
  statePath = path.join(userDataDir, 'skills-state.json')
}

/** 读取禁用清单（rootPath 列表） */
function readDisabledList() {
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    return Array.isArray(data.disabled) ? data.disabled.map(String) : []
  } catch {
    return []
  }
}

/** 写回禁用清单 */
function writeDisabledList(list) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify({ disabled: list }, null, 2), 'utf-8')
}

// ============================================================
// frontmatter 解析（只支持 key: value 与 key: [a, b] 两种形态）
// ============================================================

/**
 * 解析 SKILL.md 的 YAML frontmatter
 * @param {string} text SKILL.md 原文
 * @returns {{ meta: object, body: string } | null} 无 frontmatter 时返回 null
 */
function parseFrontmatter(text) {
  const raw = String(text || '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return null
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      // 数组形态：[a, b, c] 或 []
      const inner = value.slice(1, -1).trim()
      meta[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []
    } else {
      meta[key] = value.replace(/^['"]|['"]$/g, '')
    }
  }
  return { meta, body: raw.slice(match[0].length) }
}

// ============================================================
// 目录扫描
// ============================================================

/**
 * 扫描一个 skills 根目录，返回有效 skill 元数据列表
 * @param {string} root 根目录（.xj/skills / 内置 skills / .claude/skills）
 * @param {'builtin'|'workspace'|'claude-compat'} source 来源标识
 * @param {Set<string>} disabled 禁用的 rootPath 集合
 */
function scanSkillsRoot(root, source, disabled) {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= MAX_SKILLS_PER_ROOT) break
    if (!entry.isDirectory()) continue
    const dirPath = path.join(root, entry.name)
    const skillMdPath = path.join(dirPath, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue
    let text = ''
    try {
      text = fs.readFileSync(skillMdPath, 'utf-8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    const name = String(parsed?.meta.name || entry.name)
    const description = String(parsed?.meta.description || '')
    if (!description) continue // description 是路由唯一依据，缺失视为无效
    const resources = []
    try {
      const refDir = path.join(dirPath, REFERENCES_DIR)
      if (fs.existsSync(refDir)) {
        for (const f of fs.readdirSync(refDir, { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.md')) resources.push(`${REFERENCES_DIR}/${f.name}`)
        }
      }
    } catch {
      /* references 缺失时忽略 */
    }
    const allowedTools = Array.isArray(parsed?.meta['allowed-tools'])
      ? parsed.meta['allowed-tools'].map(String)
      : String(parsed?.meta['allowed-tools'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    const targets = Array.isArray(parsed?.meta.targets)
      ? parsed.meta.targets.map(String)
      : []
    out.push({
      id: `${source}::${entry.name}`,
      name,
      description: description.slice(0, 200),
      version: String(parsed?.meta.version || ''),
      allowedTools,
      targets,
      source,
      rootPath: dirPath,
      hasScripts: fs.existsSync(path.join(dirPath, 'scripts')),
      resources,
      enabled: !disabled.has(dirPath),
    })
  }
  return out
}

// ============================================================
// 对外 API
// ============================================================

/** 内置 skills 目录（由 main.cjs 在启动时确定：dev 用项目 skills/，打包用 resources/skills） */
let builtinDir = ''

/** 初始化内置目录 */
function initSkillsBuiltinDir(dir) {
  builtinDir = dir
}

/** workspace 下的 skill 根目录（懒创建语义由 import 等写操作负责） */
function workspaceSkillsDir(workspaceRoot) {
  return path.join(String(workspaceRoot || ''), '.xj', 'skills')
}

/** workspace 下的 .claude/skills 兼容目录 */
function claudeCompatSkillsDir(workspaceRoot) {
  return path.join(String(workspaceRoot || ''), '.claude', 'skills')
}

/**
 * 列出全部 skill（workspace > 内置，同名 workspace 覆盖内置；.claude 兼容只读列出）
 * @param {{ workspaceRoot?: string }} payload
 */
function listSkills(payload = {}) {
  const workspaceRoot = String(payload?.workspaceRoot || '')
  const disabled = new Set(readDisabledList())
  const builtin = builtinDir ? scanSkillsRoot(builtinDir, 'builtin', disabled) : []
  const workspace = workspaceRoot
    ? scanSkillsRoot(workspaceSkillsDir(workspaceRoot), 'workspace', disabled)
    : []
  const claudeCompat = workspaceRoot
    ? scanSkillsRoot(claudeCompatSkillsDir(workspaceRoot), 'claude-compat', disabled)
    : []
  // 同名 skill：workspace 覆盖内置（隐藏被覆盖的内置项）
  const wsNames = new Set(workspace.map((s) => s.name))
  return {
    ok: true,
    workspaceRoot,
    builtinDir,
    builtin: builtin.filter((s) => !wsNames.has(s.name)),
    workspace,
    claudeCompat,
  }
}

/** 校验 rootPath 是否位于给定根目录之下（防穿越） */
function isUnderRoot(rootPath, root) {
  const rel = path.relative(String(root), String(rootPath))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * 读取 skill 详情（meta + body + 资源清单）
 * @param {{ rootPath?: string }} payload
 */
function getSkill(payload = {}) {
  const rootPath = String(payload?.rootPath || '')
  const skillMdPath = path.join(rootPath, 'SKILL.md')
  if (!rootPath || !isUnderSkillRoot(rootPath) || !fs.existsSync(skillMdPath)) {
    return { ok: false, error: 'skill 不存在' }
  }
  try {
    const text = fs.readFileSync(skillMdPath, 'utf-8')
    const parsed = parseFrontmatter(text) || { meta: {}, body: text }
    const meta = {
      id: path.basename(rootPath),
      name: String(parsed.meta.name || path.basename(rootPath)),
      description: String(parsed.meta.description || ''),
      version: String(parsed.meta.version || ''),
      rootPath,
    }
    return { ok: true, meta, body: parsed.body, skillMdPath }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/** rootPath 是否属于任一已知的 skill 根（workspace/.xj/skills、内置、.claude/skills） */
function isUnderSkillRoot(rootPath) {
  const roots = [builtinDir, workspaceSkillsDir(globalWorkspaceRoot()), claudeCompatSkillsDir(globalWorkspaceRoot())]
  return roots.some((r) => r && isUnderRoot(rootPath, r))
}

/** 全局 workspace 根（getSkill / readResource 等无 workspace 参数的接口用最近一次 list 的值） */
let lastWorkspaceRoot = ''
function setLastWorkspaceRoot(root) {
  lastWorkspaceRoot = String(root || '')
}
function globalWorkspaceRoot() {
  return lastWorkspaceRoot
}

/**
 * 读取 skill 资源文件（references/ 下，路径白名单）
 * @param {{ rootPath?: string, relPath?: string }} payload
 */
function readSkillResource(payload = {}) {
  const rootPath = String(payload?.rootPath || '')
  const relPath = String(payload?.relPath || '').replace(/\\/g, '/')
  if (!rootPath || !relPath) return { ok: false, error: '参数缺失' }
  if (!relPath.startsWith(`${REFERENCES_DIR}/`)) return { ok: false, error: '只允许读取 references/ 下的文件' }
  if (relPath.includes('..')) return { ok: false, error: '非法路径' }
  const target = path.join(rootPath, relPath)
  if (!isUnderRoot(target, rootPath)) return { ok: false, error: '非法路径' }
  try {
    return { ok: true, content: fs.readFileSync(target, 'utf-8'), relPath }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/**
 * 导入 skill：从任意目录复制到 `<workspace>/.xj/skills/<name>`
 * @param {{ workspaceRoot?: string, fromPath?: string, overwrite?: boolean }} payload
 */
function importSkill(payload = {}) {
  const workspaceRoot = String(payload?.workspaceRoot || '')
  const fromPath = String(payload?.fromPath || '')
  if (!workspaceRoot || !fromPath) return { ok: false, error: '参数缺失' }
  const fromMd = path.join(fromPath, 'SKILL.md')
  if (!fs.existsSync(fromMd)) return { ok: false, error: '所选目录没有 SKILL.md，不是有效的 skill 包' }
  const parsed = parseFrontmatter(fs.readFileSync(fromMd, 'utf-8'))
  const name = String(parsed?.meta.name || path.basename(fromPath)).replace(/[\\/:*?"<>|]/g, '_')
  const dest = path.join(workspaceSkillsDir(workspaceRoot), name)
  if (fs.existsSync(dest) && !payload?.overwrite) {
    return { ok: false, needConfirm: true, error: '目标目录已存在同名 skill，确认覆盖？', dest, name }
  }
  try {
    fs.mkdirSync(dest, { recursive: true })
    copyDir(fromPath, dest)
    return { ok: true, rootPath: dest, name }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/** 递归复制目录（跳过 scripts 以外的所有文件照常复制；P0 不执行脚本但保留文件） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/**
 * 删除 workspace skill（仅允许 .xj/skills 内）
 * @param {{ rootPath?: string }} payload
 */
function removeSkill(payload = {}) {
  const rootPath = String(payload?.rootPath || '')
  if (!rootPath) return { ok: false, error: '参数缺失' }
  const wsRoot = workspaceSkillsDir(globalWorkspaceRoot())
  if (!isUnderRoot(rootPath, wsRoot)) return { ok: false, error: '只允许删除工作区内的 skill' }
  try {
    fs.rmSync(rootPath, { recursive: true, force: true })
    // 清理禁用状态
    const disabled = readDisabledList().filter((p) => p !== rootPath)
    writeDisabledList(disabled)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/**
 * 启用/停用 skill
 * @param {{ rootPath?: string, enabled?: boolean }} payload
 */
function setSkillEnabled(payload = {}) {
  const rootPath = String(payload?.rootPath || '')
  if (!rootPath) return { ok: false, error: '参数缺失' }
  const disabled = readDisabledList()
  const has = disabled.includes(rootPath)
  if (payload?.enabled === false && !has) disabled.push(rootPath)
  if (payload?.enabled !== false && has) writeDisabledList(disabled.filter((p) => p !== rootPath))
  else if (payload?.enabled === false) writeDisabledList(disabled)
  return { ok: true }
}

module.exports = {
  initSkillsState,
  initSkillsBuiltinDir,
  setLastWorkspaceRoot,
  parseFrontmatter,
  listSkills,
  getSkill,
  readSkillResource,
  importSkill,
  removeSkill,
  setSkillEnabled,
  workspaceSkillsDir,
}
