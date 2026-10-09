/**
 * Git 相关工具（渲染进程）
 * 提供状态展示映射、diff 文本解析、目录树徽标计算等纯函数，不依赖任何第三方库。
 */

/** 状态展示信息：字母标记、颜色与中文说明 */
export interface GitStatusMeta {
  /** 单字母标记 */
  text: string
  /** 展示颜色 */
  color: string
  /** 悬浮说明 */
  label: string
}

/** 目录树徽标：文件显示状态字母，目录显示后代变更数量 */
export interface GitBadge {
  /** 状态码，目录为空字符串 */
  code: string
  /** 变更数量 */
  count: number
}

/** 并排模式的一行（左右两侧可能为 null） */
export interface GitSplitRow {
  left: GitDiffLine | null
  right: GitDiffLine | null
}

/** 状态展示映射（配色沿用 VS Code 语义） */
const GIT_STATUS_META: Record<string, GitStatusMeta> = {
  M: { text: 'M', color: '#e2c08d', label: '已修改' },
  A: { text: 'A', color: '#81b88b', label: '已添加' },
  D: { text: 'D', color: '#c74e39', label: '已删除' },
  R: { text: 'R', color: '#4d9de0', label: '已重命名' },
  C: { text: 'C', color: '#4d9de0', label: '已复制' },
  U: { text: '!', color: '#c74e39', label: '冲突' },
  '?': { text: 'U', color: '#81b88b', label: '未跟踪' },
  '!': { text: 'I', color: '#9aa0a6', label: '已忽略' },
}

/**
 * 获取状态码对应的展示信息（未知状态回退为已修改样式）
 * @param code 状态码
 * @returns 展示信息
 */
export function gitStatusMeta(code: string): GitStatusMeta {
  return GIT_STATUS_META[code] || GIT_STATUS_META.M
}

/** 是否 Windows 平台（路径大小写不敏感） */
const IS_WINDOWS = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent || '')

/**
 * 路径规范化：统一为正斜杠，便于跨平台比较
 * @param p 原始路径
 * @returns 规范化后的路径
 */
export function normPath(p: string): string {
  return String(p || '').replace(/\\/g, '/')
}

/**
 * 路径比较键：Windows 下盘符与大小写可能不一致（git 返回 D:/…，应用内可能是 d:/…），
 * 统一转小写后比较；其它平台保持大小写敏感。
 * @param p 原始路径
 * @returns 用于比较的键
 */
export function gitPathKey(p: string): string {
  const normalized = normPath(p)
  return IS_WINDOWS ? normalized.toLowerCase() : normalized
}

/**
 * 拼接根目录与相对路径（渲染进程无 node path 模块，自行按斜杠处理）
 * @param root 根目录
 * @param rel 相对路径
 * @returns 拼接后的路径（正斜杠）
 */
export function joinPath(root: string, rel: string): string {
  const r = normPath(root).replace(/\/+$/, '')
  const s = normPath(rel).replace(/^\/+/, '')
  return s ? `${r}/${s}` : r
}

/**
 * 计算绝对路径相对仓库根的相对路径
 * @param repoRoot 仓库根目录
 * @param absPath 文件绝对路径
 * @returns 仓库内相对路径，不在仓库内时返回空字符串
 */
export function relPathOf(repoRoot: string, absPath: string): string {
  const root = normPath(repoRoot).replace(/\/+$/, '')
  const target = normPath(absPath)
  const rootKey = IS_WINDOWS ? root.toLowerCase() : root
  const targetKey = IS_WINDOWS ? target.toLowerCase() : target
  if (!root || !targetKey.startsWith(`${rootKey}/`)) return ''
  return target.slice(root.length + 1)
}

/**
 * 判断绝对路径是否位于仓库内
 * @param repoRoot 仓库根目录
 * @param absPath 文件绝对路径
 * @returns 位于仓库内时返回 true
 */
export function isInsideRepo(repoRoot: string, absPath: string): boolean {
  if (!repoRoot) return false
  const rootKey = gitPathKey(repoRoot.replace(/\/+$/, ''))
  const targetKey = gitPathKey(absPath)
  return !!rootKey && targetKey.startsWith(`${rootKey}/`)
}

/**
 * 解析 unified diff 文本为 hunk 列表
 * @param text diff 原文
 * @returns hunk 列表
 */
export function parseGitDiff(text: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = []
  if (!text) return hunks
  let current: GitDiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const raw of text.split('\n')) {
    // 跳过文件头与元信息，仅保留 hunk 内的实际差异行
    if (
      raw.startsWith('diff --git') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file mode') ||
      raw.startsWith('deleted file mode') ||
      raw.startsWith('old mode') ||
      raw.startsWith('new mode') ||
      raw.startsWith('similarity index') ||
      raw.startsWith('rename from') ||
      raw.startsWith('rename to') ||
      raw.startsWith('Binary files')
    ) {
      continue
    }
    const matched = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (matched) {
      oldNo = Number(matched[1])
      newNo = Number(matched[2])
      current = { header: raw, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (raw.startsWith('\\')) continue // \ No newline at end of file
    if (raw.startsWith('+')) {
      current.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: raw.slice(1) })
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: raw.slice(1) })
    } else {
      current.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: raw.startsWith(' ') ? raw.slice(1) : raw })
    }
  }
  return hunks
}

/**
 * 统计 diff 的新增与删除行数
 * @param hunks hunk 列表
 * @returns 新增与删除行数
 */
export function countDiffStats(hunks: GitDiffHunk[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') add += 1
      else if (line.type === 'del') del += 1
    }
  }
  return { add, del }
}

/**
 * 将 hunk 列表转换为并排模式行（连续的删除与新增两两配对）
 * @param hunks hunk 列表
 * @returns 并排行列表
 */
export function buildSplitRows(hunks: GitDiffHunk[]): GitSplitRow[] {
  const rows: GitSplitRow[] = []
  for (const hunk of hunks) {
    let pendingDel: GitDiffLine[] = []
    for (const line of hunk.lines) {
      if (line.type === 'del') {
        pendingDel.push(line)
      } else if (line.type === 'add') {
        rows.push({ left: pendingDel.shift() || null, right: line })
      } else {
        for (const left of pendingDel) rows.push({ left, right: null })
        pendingDel = []
        rows.push({ left: line, right: line })
      }
    }
    for (const left of pendingDel) rows.push({ left, right: null })
  }
  return rows
}

/**
 * 判断 diff 是否为二进制差异（无 hunk 且包含二进制标记）
 * @param text diff 原文
 * @returns 是二进制差异时返回 true
 */
export function isBinaryDiff(text: string): boolean {
  if (!text) return false
  return /Binary files .* differ|GIT binary patch/.test(text) && !/^@@/m.test(text)
}

/**
 * 计算目录树徽标：文件节点为状态字母，目录节点为其后代变更数量
 * @param repoRoot 仓库根目录
 * @param status 仓库状态，为空时返回空表
 * @returns 绝对路径（规范化）到徽标的映射
 */
export function buildGitBadgeMap(repoRoot: string, status: GitStatus | null): Map<string, GitBadge> {
  const map = new Map<string, GitBadge>()
  if (!repoRoot || !status) return map
  const changes: GitFileChange[] = [...status.conflicted, ...status.staged, ...status.unstaged]
  for (const change of changes) {
    const fileKey = gitPathKey(joinPath(repoRoot, change.path))
    const existed = map.get(fileKey)
    if (existed) {
      existed.count += 1
      if (change.status === 'U') existed.code = 'U'
    } else {
      map.set(fileKey, { code: change.status, count: 1 })
    }
    // 逐级累加父目录的变更数量
    const segments = normPath(change.path).split('/').slice(0, -1)
    let acc = ''
    for (const segment of segments) {
      acc = acc ? `${acc}/${segment}` : segment
      const dirKey = gitPathKey(joinPath(repoRoot, acc))
      const dirBadge = map.get(dirKey)
      if (dirBadge) {
        dirBadge.count += 1
        if (change.status === 'U') dirBadge.code = 'U'
      } else {
        map.set(dirKey, { code: '', count: 1 })
      }
    }
  }
  return map
}

/**
 * 从仓库地址推导默认项目目录名（与主进程 git.cjs 的推导规则保持一致）
 * 支持 HTTPS / SSH（git@host:group/repo.git）/ 本地路径三种写法
 * @param url 仓库地址
 * @returns 目录名，无法推导时返回 git-repo
 */
export function repoNameFromUrl(url: string): string {
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
 * 格式化提交时间为相对时间（三天内）或日期
 * @param date Git 输出的时间字符串
 * @returns 展示文本
 */
export function formatGitDate(date: string): string {
  if (!date) return ''
  const parsed = new Date(date.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return date
  const diff = Date.now() - parsed.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 3 * day) return `${Math.floor(diff / day)} 天前`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}
