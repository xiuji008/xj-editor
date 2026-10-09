/**
 * 终端渲染工具：轻量终端缓冲区（ANSI 颜色解析 + 行缓冲）与提示符计算
 *
 * 渲染层的终端不做完整 TTY 模拟，只覆盖日常命令输出所需的部分：
 * - 文本追加、换行、回车重绘（进度条）、退格、制表符、清屏
 * - SGR 颜色（16 色 / 256 色 / 真彩色）与常用文本属性
 * - 其余转义序列（光标定位、OSC 等）安全忽略
 */

/** shell 类型（全局声明于 env.d.ts，此处仅复用） */
export type ShellKind = TerminalShellKind

/** 历史命令在 localStorage 中的键名 */
const HISTORY_KEY = 'md-terminal-history'

/** 历史命令最大保留条数 */
export const COMMAND_HISTORY_LIMIT = 300

/**
 * 读取持久化的历史命令（最近执行的在末尾）
 * @returns {string[]} 历史命令列表
 */
export function loadCommandHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((item) => typeof item === 'string' && item.trim()).slice(-COMMAND_HISTORY_LIMIT)
  } catch {
    return []
  }
}

/**
 * 持久化历史命令（超出上限时丢弃最旧的记录）
 * @param list 历史命令列表
 */
export function saveCommandHistory(list: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-COMMAND_HISTORY_LIMIT)))
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 清空持久化的历史命令 */
export function clearCommandHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 渲染层维护的终端会话信息 */
export interface TerminalSessionInfo {
  /** 会话 id（主进程生成） */
  id: string
  /** shell 标识 */
  shellId: string
  /** shell 展示名 */
  shellName: string
  /** shell 类型，决定提示符与换行符 */
  kind: ShellKind
  /** 启动目录（命令执行的初始位置） */
  cwd: string
  /** 标签标题，如 1: PowerShell */
  title: string
  /** 行结束符 */
  eol: string
  /** shell 是否自带提示符输出（cmd 自带，无需渲染层补提示符） */
  echoesPrompt: boolean
  /** 进程是否仍在运行 */
  alive: boolean
}

/** 文本样式（由 ANSI SGR 序列解析得到） */
interface TermStyle {
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** 一行中的文本片段（同一样式的连续文本） */
interface TermSegment {
  text: string
  style: TermStyle
  /** 样式指纹，用于判断能否与前一个片段合并 */
  key: string
}

/** 终端中的一个逻辑行 */
interface TermLine {
  segments: TermSegment[]
}

/**
 * 16 基础色（取自 VS Code 深色主题，适配深色终端背景）
 */
const BASE_COLORS = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#f5f5f5',
]

/** 256 色立方体的取值表 */
const CUBE_STEPS = [0, 95, 135, 175, 215, 255]

/**
 * 取 xterm-256 色板中的颜色
 * @param index 颜色下标（0-255）
 * @returns {string} 十六进制颜色
 */
function colorOfIndex(index: number): string {
  if (index < 16) return BASE_COLORS[index]
  if (index < 232) {
    const i = index - 16
    const r = CUBE_STEPS[Math.floor(i / 36)]
    const g = CUBE_STEPS[Math.floor((i % 36) / 6)]
    const b = CUBE_STEPS[i % 6]
    return `rgb(${r},${g},${b})`
  }
  const gray = 8 + (index - 232) * 10
  return `rgb(${gray},${gray},${gray})`
}

/**
 * HTML 转义，避免 shell 输出中的尖括号被当作标签
 * @param text 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 生成样式指纹（用于片段合并判断）
 * @param style 文本样式
 * @returns {string} 指纹字符串
 */
function styleKey(style: TermStyle): string {
  return `${style.color || ''}|${style.bg || ''}|${style.bold ? 1 : 0}${style.dim ? 1 : 0}${style.italic ? 1 : 0}${style.underline ? 1 : 0}`
}

/**
 * 终端行缓冲区：把 shell 输出（含 ANSI 序列）转换为可直接渲染的 HTML 行
 */
export class TerminalBuffer {
  /** 行集合 */
  private lines: TermLine[] = [{ segments: [] }]
  /** 最大保留行数，超出后丢弃最旧的行，避免长时间输出导致内存膨胀 */
  private maxLines: number
  /** 当前样式（由 SGR 序列修改） */
  private style: TermStyle = {}
  /** 当前样式指纹 */
  private key = ''

  /**
   * @param maxLines 最大保留行数，默认 3000
   */
  constructor(maxLines = 3000) {
    this.maxLines = maxLines
  }

  /** 当前行（始终存在） */
  private currentLine(): TermLine {
    return this.lines[this.lines.length - 1]
  }

  /** 追加一个换行 */
  private newLine(): void {
    this.lines.push({ segments: [] })
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines)
    }
  }

  /** 删除最后一个字符（退格） */
  private backspace(): void {
    const line = this.currentLine()
    const last = line.segments[line.segments.length - 1]
    if (!last) return
    last.text = last.text.slice(0, -1)
    if (!last.text) line.segments.pop()
  }

  /** 追加可打印字符 */
  private append(ch: string): void {
    const line = this.currentLine()
    const last = line.segments[line.segments.length - 1]
    if (last && last.key === this.key) {
      last.text += ch
      return
    }
    line.segments.push({ text: ch, style: { ...this.style }, key: this.key })
  }

  /** 追加空格到下一个制表位 */
  private tab(): void {
    const line = this.currentLine()
    let len = 0
    for (const seg of line.segments) len += seg.text.length
    const next = Math.floor(len / 8) * 8 + 8
    for (let i = len; i < next; i++) this.append(' ')
  }

  /** 清空当前行内容 */
  private clearLine(): void {
    this.currentLine().segments = []
  }

  /** 清屏（等同执行 clear / cls） */
  clear(): void {
    this.lines = [{ segments: [] }]
  }

  /**
   * 写入 shell 输出文本（含 ANSI 转义序列）
   * @param text 输出文本
   */
  write(text: string): void {
    if (!text) return
    let i = 0
    const len = text.length
    while (i < len) {
      const ch = text[i]
      if (ch === '\x1b') {
        i += this.parseEscape(text, i)
        continue
      }
      if (ch === '\n') {
        this.newLine()
        i += 1
        continue
      }
      if (ch === '\r') {
        // \r\n 视为换行；单独的 \r 视为重绘当前行（进度条）
        if (text[i + 1] === '\n') {
          this.newLine()
          i += 2
        } else {
          this.clearLine()
          i += 1
        }
        continue
      }
      if (ch === '\b') {
        this.backspace()
        i += 1
        continue
      }
      if (ch === '\t') {
        this.tab()
        i += 1
        continue
      }
      if (ch === '\f' || ch === '\v') {
        // 换页符：cmd 的 cls 在重定向输出时使用
        this.clear()
        i += 1
        continue
      }
      if (ch < ' ') {
        // 其余控制字符忽略
        i += 1
        continue
      }
      this.append(ch)
      i += 1
    }
  }

  /**
   * 解析转义序列，返回消耗的字数
   * @param text 完整文本
   * @param start 转义符 \x1b 所在下标
   * @returns {number} 消耗的字数
   */
  private parseEscape(text: string, start: number): number {
    const next = text[start + 1]
    if (next === undefined) return 1
    // CSI：ESC [ 参数 终止符
    if (next === '[') {
      let j = start + 2
      let params = ''
      while (j < text.length) {
        const c = text[j]
        if (c >= '\x40' && c <= '\x7e') break
        params += c
        j += 1
      }
      // 序列不完整（分包到达）：丢弃剩余部分，等待后续数据
      if (j >= text.length) return text.length - start
      this.handleCsi(params, text[j])
      return j + 1 - start
    }
    // OSC：ESC ] ... BEL / ST
    if (next === ']') {
      let j = start + 2
      while (j < text.length) {
        if (text[j] === '\x07') return j + 1 - start
        if (text[j] === '\x1b' && text[j + 1] === '\\') return j + 2 - start
        j += 1
      }
      return text.length - start
    }
    // 字符集选择等三字节序列
    if (next === '(' || next === ')' || next === '*' || next === '+' || next === '#') return 3
    return 2
  }

  /**
   * 处理 CSI 序列：仅处理会影响显示内容的部分，其余安全忽略
   * @param params 参数串
   * @param final 终止字符
   */
  private handleCsi(params: string, final: string): void {
    const nums = params
      .split(';')
      .map((s) => parseInt(s, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n))
    switch (final) {
      case 'm':
        this.applySgr(nums)
        break
      case 'J': {
        // 2J / 3J：清屏
        const p = nums[0] || 0
        if (p === 2 || p === 3) this.clear()
        break
      }
      case 'K': {
        // 2K：清空整行
        const p = nums[0] || 0
        if (p === 2) this.clearLine()
        break
      }
      default:
        // 光标移动、隐藏光标等不影响文本内容
        break
    }
  }

  /**
   * 应用 SGR（图形渲染）参数
   * @param nums 参数数组
   */
  private applySgr(nums: number[]): void {
    let k = 0
    while (k < nums.length) {
      const n = nums[k]
      if (n === 0) {
        this.style = {}
      } else if (n === 1) {
        this.style.bold = true
      } else if (n === 2) {
        this.style.dim = true
      } else if (n === 3) {
        this.style.italic = true
      } else if (n === 4) {
        this.style.underline = true
      } else if (n === 7) {
        const color = this.style.color
        this.style.color = this.style.bg
        this.style.bg = color
      } else if (n === 22) {
        this.style.bold = false
        this.style.dim = false
      } else if (n === 23) {
        this.style.italic = false
      } else if (n === 24) {
        this.style.underline = false
      } else if (n === 39) {
        delete this.style.color
      } else if (n === 49) {
        delete this.style.bg
      } else if (n >= 30 && n <= 37) {
        this.style.color = BASE_COLORS[n - 30]
      } else if (n >= 90 && n <= 97) {
        this.style.color = BASE_COLORS[n - 90 + 8]
      } else if (n >= 40 && n <= 47) {
        this.style.bg = BASE_COLORS[n - 40]
      } else if (n >= 100 && n <= 107) {
        this.style.bg = BASE_COLORS[n - 100 + 8]
      } else if (n === 38 || n === 48) {
        const mode = nums[k + 1]
        const isFg = n === 38
        if (mode === 5) {
          const color = colorOfIndex(nums[k + 2] ?? 0)
          if (isFg) this.style.color = color
          else this.style.bg = color
          k += 2
        } else if (mode === 2) {
          const r = nums[k + 2] ?? 0
          const g = nums[k + 3] ?? 0
          const b = nums[k + 4] ?? 0
          const color = `rgb(${r},${g},${b})`
          if (isFg) this.style.color = color
          else this.style.bg = color
          k += 4
        }
      }
      k += 1
    }
    this.key = styleKey(this.style)
  }

  /**
   * 渲染全部行为 HTML（每行一个字符串）
   * @returns {string[]} 行 HTML 数组
   */
  htmlLines(): string[] {
    return this.lines.map((line) => {
      if (!line.segments.length) return ''
      return line.segments
        .map((seg) => {
          const text = escapeHtml(seg.text)
          const css: string[] = []
          if (seg.style.color) css.push(`color:${seg.style.color}`)
          if (seg.style.bg) css.push(`background:${seg.style.bg}`)
          if (seg.style.bold) css.push('font-weight:600')
          if (seg.style.italic) css.push('font-style:italic')
          if (seg.style.underline) css.push('text-decoration:underline')
          if (seg.style.dim) css.push('opacity:0.65')
          if (!css.length) return text
          return `<span style="${css.join(';')}">${text}</span>`
        })
        .join('')
    })
  }
}

/**
 * Windows 路径转 Git Bash / WSL 风格路径（D:\a\b -> /d/a/b）
 * @param cwd Windows 路径
 * @returns {string} POSIX 风格路径，非 Windows 路径时原样返回
 */
function toPosixPath(cwd: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(cwd)
  if (!m) return cwd
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

/**
 * 生成提示符文本
 * @param kind shell 类型
 * @param cwd 当前工作目录
 * @returns {string} 提示符（cmd 由 shell 自身输出，返回空串）
 */
export function buildPrompt(kind: ShellKind, cwd: string): string {
  if (kind === 'cmd') return ''
  if (kind === 'powershell') return `PS ${cwd}> `
  return `${toPosixPath(cwd)} $ `
}

/**
 * 按分隔符拆分路径（兼容 Windows 与 POSIX 分隔符）
 * @param p 路径
 * @returns {string[]} 路径片段
 */
function splitPath(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

/**
 * 目录切换命令解析：估算命令执行后的工作目录，用于让提示符跟随 cd 变化
 * @param current 当前工作目录
 * @param command 用户输入的命令
 * @param kind shell 类型
 * @returns {string} 切换后的目录，无法判断时返回空串（保持原目录）
 */
export function resolveCd(current: string, command: string, kind: ShellKind): string {
  const cmd = command.trim()
  if (!cmd) return ''
  const isBash = kind === 'bash' || kind === 'other'
  const m = /^(cd|chdir|set-location|sl|pushd)\s+(.+)$/i.exec(cmd)
  if (!m) {
    // 盘符切换：D: / D:\（仅 Windows shell 有效）
    const drive = /^([A-Za-z]):\\?\/?$/.exec(cmd)
    if (drive && !isBash) return `${drive[1].toUpperCase()}:\\`
    return ''
  }
  const target = m[2].trim().replace(/^['"]/, '').replace(/['"]$/, '')
  if (!target || target === '-' || target.startsWith('~')) return ''
  if (isBash) {
    if (target.startsWith('/')) return target.replace(/\/$/, '') || '/'
    const parts = splitPath(current.startsWith('/') ? current : `/${current}`)
    for (const seg of splitPath(target)) {
      if (seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return `/${parts.join('/')}`
  }
  if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\')) {
    return target.replace(/\/$/, '')
  }
  const parts = splitPath(current)
  for (const seg of splitPath(target)) {
    if (seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  if (!parts.length) return current
  const [first, ...rest] = parts
  return /^[A-Za-z]:$/.test(first) ? `${first}\\${rest.join('\\')}` : parts.join('\\')
}
