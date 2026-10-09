/**
 * Git 提交规范与 AI 生成提交信息相关工具：
 * 配置读写、提示词渲染、diff 裁剪、提交信息校验。
 */
import { stripCodeFence } from './ai'
import { gitStatusMeta } from './git'

/** 允许出现的提交类型（Conventional Commits） */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'revert',
] as const

/** 提交 subject 最大长度（字符） */
export const COMMIT_SUBJECT_MAX = 50

/** 交给 AI 的 diff 最大字符数（超出按文件与 hunk 裁剪，控制 token 与耗时） */
export const MAX_COMMIT_DIFF_CHARS = 24000

/** 变更文件清单最多列出的文件数 */
export const MAX_COMMIT_FILES = 20

/** 提示词模板占位符说明（设置弹窗展示） */
export const COMMIT_TEMPLATE_VARS: Array<{ key: string; desc: string }> = [
  { key: '${spec}', desc: '内置提交规范正文（可在上方编辑）' },
  { key: '${branch}', desc: '当前分支名' },
  { key: '${files}', desc: '本次变更文件清单（含状态）' },
  { key: '${recentCommits}', desc: '最近若干条提交标题（仅作风格参考）' },
  { key: '${diff}', desc: '代码差异（已按长度裁剪）' },
]

/** AI 生成提交信息的上下文 */
export interface CommitPromptContext {
  /** 当前分支名 */
  branch: string
  /** 变更文件清单文本 */
  files: string
  /** 代码差异文本 */
  diff: string
  /** 最近提交标题文本 */
  recentCommits: string
}

/**
 * 渲染提示词模板：把 ${key} 占位符替换为实际值，未提供的变量替换为空串。
 * @param template 模板文本
 * @param vars 变量表
 * @returns {string} 渲染后的文本
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return (template || '').replace(/\$\{(\w+)\}/g, (raw, key: string) => vars[key] ?? '')
}

/**
 * 构建 AI 生成提交信息的完整提示词
 * @param spec 提交规范正文
 * @param template 提示词模板（支持占位符）
 * @param ctx 上下文（分支 / 文件 / 差异 / 最近提交）
 * @returns {string} 提示词
 */
export function buildCommitMessagePrompt(
  spec: string,
  template: string,
  ctx: CommitPromptContext,
): string {
  return renderTemplate(template, {
    spec: spec || '',
    branch: ctx.branch || '未知',
    files: ctx.files || '（无）',
    diff: ctx.diff || '（无差异内容）',
    recentCommits: ctx.recentCommits || '（无）',
  })
}

/**
 * 生成变更文件清单文本（超过上限时省略其余文件，避免提示词过长）
 * @param changes 变更文件列表
 * @param limit 最多列出的文件数
 * @returns {string} 清单文本，每行一条 `- [状态] 路径`
 */
export function buildFileSummary(changes: GitFileChange[], limit = MAX_COMMIT_FILES): string {
  if (!changes.length) return '（无）'
  const shown = changes.slice(0, limit)
  const lines = shown.map((c) => `- [${gitStatusMeta(c.status).text}] ${c.path}`)
  const rest = changes.length - shown.length
  if (rest > 0) lines.push(`- …其余 ${rest} 个文件已省略`)
  return lines.join('\n')
}

/**
 * 生成最近提交标题文本（供 AI 保持措辞风格）
 * @param commits 最近提交列表
 * @param limit 条数
 * @returns {string} 每行一条提交标题
 */
export function buildRecentCommitSummary(commits: GitCommitInfo[], limit = 5): string {
  const list = (commits || []).slice(0, limit)
  if (!list.length) return '（无）'
  return list.map((c) => `- ${c.message}`).join('\n')
}

/**
 * 按预算裁剪单个文件的 diff 段：保留文件头信息与每个 hunk 的前若干行，其余省略。
 * @param segment 单个文件的 diff 文本
 * @param budget 字符预算
 * @returns {string} 裁剪后的文本
 */
function clipDiffSegment(segment: string, budget: number): string {
  if (segment.length <= budget) return segment
  const lines = segment.split('\n')
  const out: string[] = []
  /** 每个 hunk 保留的行数 */
  const keepPerHunk = 24
  let omitted = 0
  let inHunk = false
  let hunkLines = 0
  let size = 0
  for (const line of lines) {
    const isHunkHeader = line.startsWith('@@')
    if (isHunkHeader) {
      inHunk = true
      hunkLines = 0
    }
    // hunk 头之前的元信息行（diff --git / index / --- / +++ 等）全部保留，保证可读性
    const keep = !inHunk || isHunkHeader || hunkLines < keepPerHunk
    if (keep) {
      if (size + line.length + 1 > budget && out.length) {
        omitted = lines.length - out.length
        break
      }
      out.push(line)
      size += line.length + 1
      if (inHunk && !isHunkHeader) hunkLines += 1
    } else {
      omitted += 1
    }
  }
  if (omitted > 0) out.push(`…（该文件已省略 ${omitted} 行）`)
  return out.join('\n')
}

/**
 * 按文件维度拆分 diff（`diff --git` 为分隔符）
 * @param diff diff 全文
 * @returns {string[]} 各文件的 diff 段
 */
function splitDiffByFile(diff: string): string[] {
  const segments: string[] = []
  let current: string[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length) segments.push(current.join('\n'))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length) segments.push(current.join('\n'))
  return segments
}

/**
 * 裁剪 diff 以控制 token：按文件分配预算，超长文件保留 hunk 头部与前后部分内容。
 * @param diff diff 全文
 * @param maxChars 总字符上限
 * @returns {string} 裁剪后的 diff（可能被省略部分内容）
 */
export function truncateDiffForAi(diff: string, maxChars = MAX_COMMIT_DIFF_CHARS): string {
  const text = (diff || '').trim()
  if (text.length <= maxChars) return text
  const segments = splitDiffByFile(text)
  const perSegment = Math.max(2000, Math.floor(maxChars / Math.max(segments.length, 1)))
  const kept: string[] = []
  let used = 0
  for (const segment of segments) {
    if (used >= maxChars) break
    const budget = Math.min(perSegment, maxChars - used)
    const clipped = clipDiffSegment(segment, budget)
    kept.push(clipped)
    used += clipped.length + 1
  }
  const skipped = segments.length - kept.length
  if (skipped > 0) kept.push(`…（另有 ${skipped} 个文件的差异已省略）`)
  return kept.join('\n')
}

/**
 * 规整 AI 生成的提交信息：去掉代码围栏、包裹引号与首尾空白
 * @param text AI 返回的原始文本
 * @returns {string} 规整后的提交信息
 */
export function normalizeCommitMessage(text: string): string {
  let body = stripCodeFence(text || '').trim()
  body = body.replace(/^["'“”‘’`]+/, '').replace(/["'“”‘’`]+$/, '')
  return body.trim()
}

/**
 * 校验提交信息是否符合 Conventional Commits 规范（只校验首行）
 * @param message 提交信息
 * @returns {{ ok: boolean, message: string }} ok 为 true 表示合规，否则 message 为原因
 */
export function validateCommitMessage(message: string): { ok: boolean; message: string } {
  const first = (message || '').trim().split('\n')[0]?.trim() || ''
  if (!first) return { ok: false, message: '提交信息不能为空' }
  const matched = /^([A-Za-z]+)(\(([^)]*)\))?(!)?:\s*(.+)$/.exec(first)
  if (!matched) {
    return { ok: false, message: '提交信息格式应为 <type>(<scope>): <subject>，如 feat(user): 添加用户登录功能' }
  }
  const type = matched[1].toLowerCase()
  const subject = matched[5] || ''
  if (!COMMIT_TYPES.includes(type as (typeof COMMIT_TYPES)[number])) {
    return { ok: false, message: `type 只能是：${COMMIT_TYPES.join(' / ')}` }
  }
  if (subject.length > COMMIT_SUBJECT_MAX) {
    return { ok: false, message: `subject 超过 ${COMMIT_SUBJECT_MAX} 个字符（当前 ${subject.length}）` }
  }
  if (/[.。；;]$/.test(subject)) {
    return { ok: false, message: 'subject 结尾不要加句号或分号' }
  }
  return { ok: true, message: '' }
}

/** 读取提交规范配置（内置默认或用户已保存的配置） */
export async function getCommitSpec(): Promise<CommitSpecConfig | null> {
  try {
    return (await window.mdAPI?.commitSpec.get()) || null
  } catch {
    return null
  }
}

/** 保存提交规范配置 */
export async function saveCommitSpec(
  config: Partial<CommitSpecConfig>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await window.mdAPI?.commitSpec.set(JSON.parse(JSON.stringify(config)))
    return res?.ok ? { ok: true } : { ok: false, error: res?.error || '保存失败' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 恢复内置提交规范（full 完整版 / brief 精简版） */
export async function resetCommitSpec(
  preset: CommitSpecPreset = 'full',
): Promise<{ ok: boolean; config?: CommitSpecConfig; error?: string }> {
  try {
    const res = await window.mdAPI?.commitSpec.reset(preset)
    return res?.ok
      ? { ok: true, config: res.config }
      : { ok: false, error: res?.error || '恢复默认失败' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
