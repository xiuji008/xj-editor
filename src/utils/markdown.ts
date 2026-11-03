/**
 * Markdown 渲染增强工具
 *
 * 基于 marked 扩展，支持：
 * 1. YAML Front Matter 卡片（蓝色主题元信息卡片）
 * 2. 代码块复制按钮（语言标签 + 复制按钮）
 * 3. Mermaid 图表 + sequence 时序图别名
 * 4. 简化格式图表（pie/bar/line/area/radar）
 * 5. GitHub Alert 提示块（> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]）
 * 6. 数学公式（KaTeX，行内 $...$、块级 $$...$$、mathjax 代码块）
 *
 * @module utils/markdown
 */

import { Marked, Parser as MarkedParser } from 'marked'
import type { TokenizerExtension, RendererExtension, Tokens, Token } from 'marked'
import mermaid from 'mermaid'
import Chart from 'chart.js/auto'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import pako from 'pako'
import { getPlantUmlRenderUrl } from './plantUmlConfig'
import { runScript } from './scriptRunner'
import hljs from 'highlight.js/lib/common'
// 代码高亮主题 CSS（?inline 导入为字符串，按需动态注入）
import githubDarkCss from '../styles/code-themes/github-dark.css?inline'
import githubCss from '../styles/code-themes/github.css?inline'
import draculaCss from '../styles/code-themes/dracula.css?inline'
import monokaiCss from '../styles/code-themes/monokai.css?inline'
import nordCss from '../styles/code-themes/nord.css?inline'
import atomOneDarkCss from '../styles/code-themes/atom-one-dark.css?inline'
import atomOneLightCss from '../styles/code-themes/atom-one-light.css?inline'
import xcodeCss from '../styles/code-themes/xcode.css?inline'
import vsCss from '../styles/code-themes/vs.css?inline'
import solarizedDarkCss from '../styles/code-themes/solarized-dark.css?inline'
import solarizedLightCss from '../styles/code-themes/solarized-light.css?inline'
import tomorrowNightCss from '../styles/code-themes/tomorrow-night.css?inline'

// ============================================================
// 代码高亮主题系统
//
// 每篇文章可独立设置代码主题。主题 CSS 来自 highlight.js/styles，
// 通过 ?inline 导入为字符串，由 applyCodeTheme 动态注入 <style>。
// 同时为每个主题定义配套的 wrapper/header 配色（CSS 变量），
// 使代码块外框（语言标签栏、边框、复制按钮）与主题协调。
// ============================================================

/** 单个代码主题配置 */
export interface CodeTheme {
  /** 主题标识（对应 highlight.js styles 文件名） */
  name: string
  /** 显示名称 */
  label: string
  /** 是否深色主题 */
  isDark: boolean
  /** highlight.js 主题 CSS 字符串（控制 token 颜色 + .hljs 背景/文字） */
  css: string
  /** 代码块外框配色（CSS 变量，控制 header/边框/语言标签/按钮） */
  vars: Record<string, string>
}

/** 支持的代码主题列表 */
export const CODE_THEMES: CodeTheme[] = [
  {
    name: 'github-dark',
    label: 'GitHub Dark',
    isDark: true,
    css: githubDarkCss,
    vars: {
      '--code-bg': '#0d1117',
      '--code-header-bg': '#161b22',
      '--code-border': '#30363d',
      '--code-lang-color': '#8b949e',
      '--code-btn-color': '#8b949e',
      '--code-btn-border': '#30363d',
    },
  },
  {
    name: 'github',
    label: 'GitHub Light',
    isDark: false,
    css: githubCss,
    vars: {
      '--code-bg': '#ffffff',
      '--code-header-bg': '#f6f8fa',
      '--code-border': '#d0d7de',
      '--code-lang-color': '#57606a',
      '--code-btn-color': '#57606a',
      '--code-btn-border': '#d0d7de',
    },
  },
  {
    name: 'dracula',
    label: 'Dracula',
    isDark: true,
    css: draculaCss,
    vars: {
      '--code-bg': '#282a36',
      '--code-header-bg': '#21222c',
      '--code-border': '#191a21',
      '--code-lang-color': '#6272a4',
      '--code-btn-color': '#6272a4',
      '--code-btn-border': '#44475a',
    },
  },
  {
    name: 'monokai',
    label: 'Monokai',
    isDark: true,
    css: monokaiCss,
    vars: {
      '--code-bg': '#272822',
      '--code-header-bg': '#1e1f1c',
      '--code-border': '#3e3d32',
      '--code-lang-color': '#75715e',
      '--code-btn-color': '#75715e',
      '--code-btn-border': '#49483e',
    },
  },
  {
    name: 'nord',
    label: 'Nord',
    isDark: true,
    css: nordCss,
    vars: {
      '--code-bg': '#2e3440',
      '--code-header-bg': '#242933',
      '--code-border': '#3b4252',
      '--code-lang-color': '#81a1c1',
      '--code-btn-color': '#81a1c1',
      '--code-btn-border': '#4c566a',
    },
  },
  {
    name: 'atom-one-dark',
    label: 'Atom One Dark',
    isDark: true,
    css: atomOneDarkCss,
    vars: {
      '--code-bg': '#282c34',
      '--code-header-bg': '#21252b',
      '--code-border': '#181a1f',
      '--code-lang-color': '#5c6370',
      '--code-btn-color': '#5c6370',
      '--code-btn-border': '#3e4451',
    },
  },
  {
    name: 'atom-one-light',
    label: 'Atom One Light',
    isDark: false,
    css: atomOneLightCss,
    vars: {
      '--code-bg': '#fafafa',
      '--code-header-bg': '#f0f0f0',
      '--code-border': '#e5e5e5',
      '--code-lang-color': '#383a42',
      '--code-btn-color': '#383a42',
      '--code-btn-border': '#dcdcdc',
    },
  },
  {
    name: 'xcode',
    label: 'Xcode',
    isDark: false,
    css: xcodeCss,
    vars: {
      '--code-bg': '#ffffff',
      '--code-header-bg': '#f5f5f5',
      '--code-border': '#d4d4d4',
      '--code-lang-color': '#555555',
      '--code-btn-color': '#555555',
      '--code-btn-border': '#d4d4d4',
    },
  },
  {
    name: 'vs',
    label: 'Visual Studio',
    isDark: false,
    css: vsCss,
    vars: {
      '--code-bg': '#ffffff',
      '--code-header-bg': '#f3f3f3',
      '--code-border': '#dcdcdc',
      '--code-lang-color': '#555555',
      '--code-btn-color': '#555555',
      '--code-btn-border': '#dcdcdc',
    },
  },
  {
    name: 'solarized-dark',
    label: 'Solarized Dark',
    isDark: true,
    css: solarizedDarkCss,
    vars: {
      '--code-bg': '#002b36',
      '--code-header-bg': '#073642',
      '--code-border': '#586e75',
      '--code-lang-color': '#93a1a1',
      '--code-btn-color': '#93a1a1',
      '--code-btn-border': '#586e75',
    },
  },
  {
    name: 'solarized-light',
    label: 'Solarized Light',
    isDark: false,
    css: solarizedLightCss,
    vars: {
      '--code-bg': '#fdf6e3',
      '--code-header-bg': '#eee8d5',
      '--code-border': '#93a1a1',
      '--code-lang-color': '#586e75',
      '--code-btn-color': '#586e75',
      '--code-btn-border': '#93a1a1',
    },
  },
  {
    name: 'tomorrow-night',
    label: 'Tomorrow Night Blue',
    isDark: true,
    css: tomorrowNightCss,
    vars: {
      '--code-bg': '#002451',
      '--code-header-bg': '#001a3a',
      '--code-border': '#1a3a6e',
      '--code-lang-color': '#7285b7',
      '--code-btn-color': '#7285b7',
      '--code-btn-border': '#1a3a6e',
    },
  },
]

/** 默认代码主题 */
export const DEFAULT_CODE_THEME = 'github-dark'

const codeThemeMap = new Map(CODE_THEMES.map(t => [t.name, t]))

const THEME_STYLE_ID = 'hljs-theme-style'

/**
 * 应用代码高亮主题。
 * 将 highlight.js 主题 CSS 与配套的 wrapper 配色变量注入到全局 <style>。
 * 主题 CSS 控制 token 颜色与 .hljs 背景；wrapper 变量控制 header/边框/按钮配色。
 *
 * @param theme 主题标识（见 CODE_THEMES），未匹配时回退到默认主题
 */
export function applyCodeTheme(theme: string): void {
  const t = codeThemeMap.get(theme) || codeThemeMap.get(DEFAULT_CODE_THEME)!
  let styleEl = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = THEME_STYLE_ID
    document.head.appendChild(styleEl)
  }
  const varsCss = Object.entries(t.vars).map(([k, v]) => `${k}: ${v}`).join('; ')
  // 1. hljs 主题 CSS（token 颜色 + .hljs 背景/文字）
  // 2. 覆盖 .hljs 背景与 padding，改由 pre 的 CSS 变量统一控制，避免双重内边距
  // 3. 在 .markdown-body 作用域注入 wrapper 配色变量
  styleEl.textContent = `${t.css}
.code-block-wrapper pre code.hljs { background: transparent !important; padding: 0 !important; }
.markdown-body { ${varsCss}; }`
}

// ============================================================
// 辅助函数
// ============================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&39;')
}

/**
 * 在 HTML 字符串的第一个标签上注入 data-line（源码起始行号，1-based）。
 * 供「源码 / 预览同步滚动」使用：预览中的块级元素通过 data-line 与源码行号对应。
 * 以注释开头的 HTML（<!-- -->）不注入，避免破坏注释结构。
 */
function injectLineAttr(html: string, line: number): string {
  const start = html.indexOf('<')
  if (start === -1) return html
  if (html.startsWith('<!--', start)) return html
  const end = html.indexOf('>', start)
  if (end === -1) return html
  const tag = html.slice(start, end + 1)
  const newTag = tag.replace(/(\s*\/?>)$/, ` data-line="${line}"$1`)
  return html.slice(0, start) + newTag + html.slice(end + 1)
}

/**
 * 公式输出模式：
 * - html：只输出 KaTeX 的 HTML（预览用，体积小）
 * - htmlAndMathml：额外输出 MathML。MathML 里的 `<annotation encoding="application/x-tex">`
 *   保留了 LaTeX 源码，导出 Word 时用它把公式还原为文本（P1 进一步转成 Word 公式）。
 */
let mathOutputMode: 'html' | 'htmlAndMathml' = 'html'

/**
 * 设置公式输出模式，返回设置前的模式（便于调用方用完恢复）。
 * @param mode html 仅 HTML / htmlAndMathml 含 MathML
 */
export function setMathOutputMode(mode: 'html' | 'htmlAndMathml'): 'html' | 'htmlAndMathml' {
  const prev = mathOutputMode
  mathOutputMode = mode
  return prev
}

function renderKatex(formula: string, displayMode: boolean): string {
  try {
    return katex.renderToString(formula, {
      displayMode,
      throwOnError: false,
      output: mathOutputMode,
    })
  } catch {
    return `<span style="color:#f56c6c">公式渲染失败: ${escapeHtml(formula)}</span>`
  }
}

// ============================================================
// 1. PlantUML 编码（与 plantuml-encoder 相同的算法）
//
// 原理：将源码 UTF-8 编码后 deflate 压缩（必须使用 RAW deflate，
// 即不带头部校验的 deflateRaw，plantuml.com 仅接受该格式），
// 再用 PlantUML 自定义的 6bit base64 字母表编码，拼接成服务器地址路径。
// 渲染服务地址可通过「PlantUML 配置」自定义（默认 plantuml.com 在线服务）。
// ============================================================

/** 将 0-63 编码为 PlantUML 字母表字符 */
function encode6bit(b: number): string {
  if (b < 10) return String.fromCharCode(48 + b)
  b -= 10
  if (b < 26) return String.fromCharCode(65 + b)
  b -= 26
  if (b < 26) return String.fromCharCode(97 + b)
  b -= 26
  return String.fromCharCode(45 + b) // 62 -> '-', 63 -> '_'
}

/** 将 3 字节压缩数据编码为 4 个 PlantUML 字符 */
function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
  const c4 = b3 & 0x3f
  return (
    encode6bit(c1 & 0x3f) +
    encode6bit(c2 & 0x3f) +
    encode6bit(c3 & 0x3f) +
    encode6bit(c4 & 0x3f)
  )
}

/** 将 PlantUML 源码编码为可在渲染服务地址中使用的字符串 */
export function encodePlantUml(source: string): string {
  const compressed = pako.deflateRaw(new TextEncoder().encode(source), { level: 9 })
  let result = ''
  for (let i = 0; i < compressed.length; i += 3) {
    const b1 = compressed[i]
    const b2 = i + 1 < compressed.length ? compressed[i + 1] : 0
    const b3 = i + 2 < compressed.length ? compressed[i + 2] : 0
    result += append3bytes(b1, b2, b3)
  }
  return result
}

/**
 * 刷新容器内已渲染的 PlantUML 图表，使它们使用当前配置的服务地址重新加载。
 * 通常在「PlantUML 配置」保存后调用，让已有图表立即切换到新地址渲染。
 *
 * @param container 包含渲染后 HTML 的容器元素
 */
export function refreshPlantUmlImages(container: HTMLElement): void {
  const containers = container.querySelectorAll<HTMLElement>('.plantuml-container[data-puml-source]')
  for (const plantDiv of Array.from(containers)) {
    const source = plantDiv.dataset.pumlSource || ''
    if (!source) continue
    const img = plantDiv.querySelector<HTMLImageElement>('.plantuml-img')
    if (!img) continue
    try {
      img.src = getPlantUmlRenderUrl(encodePlantUml(source))
    } catch {
      img.src = ''
    }
  }
}

/**
 * 测试 PlantUML 渲染服务是否可用：用最小示例图请求一次渲染地址。
 * 服务端对非法地址也会返回错误图（HTTP 200），因此主要检测连通性。
 *
 * @param baseUrl 待测试的服务基础地址
 * @param timeout 超时时间（毫秒），默认 8000
 * @returns 是否连通
 */
export function testPlantUmlConnection(baseUrl: string, timeout = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => {
      img.src = ''
      resolve(false)
    }, timeout)
    img.onload = () => {
      clearTimeout(timer)
      resolve(true)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const base = baseUrl.trim().replace(/\/+$/, '')
    img.src = `${base}/svg/${encodePlantUml('@startuml\nA -> B: test\n@enduml')}`
  })
}

// ============================================================
// 1. Mermaid 初始化（单例）
// ============================================================

let mermaidInitialized = false

function ensureMermaidReady() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: '"Segoe UI", "Microsoft YaHei", Arial, sans-serif',
    suppressErrorRendering: true,
  })
  mermaidInitialized = true
}

// ============================================================
// 2. YAML Front Matter 卡片
//
// 解析文档头部的 --- 元信息块，渲染为蓝色主题卡片
// ============================================================

interface FrontMatterData {
  title: string
  tags: string[]
  category: string
  slug: string
  emoji: string
  description: string
  author: string
  series: string
  keywords: string
  status: string
  created: string
  updated: string
  /** createDate：文件创建时间 */
  createdate: string
  /** lastUpdateDate：最后更新时间 */
  lastupdatedate: string
  [key: string]: string | string[]
}

function parseFrontMatter(raw: string): FrontMatterData | null {
  const lines = raw.split('\n')
  const data: FrontMatterData = {
    title: '', tags: [], category: '', slug: '', emoji: '', description: '',
    author: '', series: '', keywords: '', status: '',
    created: '', updated: '', createdate: '', lastupdatedate: '',
  }
  let hasContent = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase()
    const val = trimmed.slice(colonIdx + 1).trim()
    if (!key) continue

    hasContent = true
    if (key === 'tags') {
      // 支持 [a, b, c] 格式，分隔符兼容中英文逗号与顿号
      const match = val.match(/^\[(.*)\]$/)
      if (match) {
        data.tags = match[1].split(/[,，、]/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      } else {
        data.tags = val.split(/[,，、]/).map(s => s.trim()).filter(Boolean)
      }
    } else if (key in data) {
      data[key] = val.replace(/^["']|["']$/g, '')
    }
  }

  return hasContent ? data : null
}

function renderFrontMatterCard(data: FrontMatterData): string {
  const titleHtml = data.title
    ? `<div class="fm-title">${data.emoji ? `<span class="fm-emoji">${escapeHtml(data.emoji)}</span>` : ''} ${escapeHtml(data.title)}</div>`
    : ''
  // 每个元数据字段各占一行：category → tags → createDate → lastUpdateDate
  const rows: string[] = []
  if (data.category) rows.push(`<div class="fm-meta-item">📂 ${escapeHtml(data.category)}</div>`)
  if (data.series) rows.push(`<div class="fm-meta-item">📚 ${escapeHtml(data.series)}</div>`)
  if (data.tags.length) {
    rows.push(`<div class="fm-meta-item">🏷 ${data.tags.map(t => `<span class="fm-tag">${escapeHtml(t)}</span>`).join('')}</div>`)
  }
  if (data.keywords) rows.push(`<div class="fm-meta-item">🔑 ${escapeHtml(data.keywords)}</div>`)
  if (data.author) rows.push(`<div class="fm-meta-item">✍️ ${escapeHtml(data.author)}</div>`)
  if (data.status) rows.push(`<div class="fm-meta-item">📌 ${escapeHtml(data.status)}</div>`)
  const createTime = data.createdate || data.created
  if (createTime) rows.push(`<div class="fm-meta-item">📅 创建 ${escapeHtml(createTime)}</div>`)
  const updateTime = data.lastupdatedate || data.updated
  if (updateTime) rows.push(`<div class="fm-meta-item">🕒 更新 ${escapeHtml(updateTime)}</div>`)
  const metaHtml = rows.length ? `<div class="fm-meta">${rows.join('')}</div>` : ''
  const descHtml = data.description ? `<div class="fm-desc">${escapeHtml(data.description)}</div>` : ''

  return `<div class="frontmatter-card">
    ${titleHtml}
    ${metaHtml}
    ${descHtml}
  </div>`
}

/**
 * 从 Markdown 文档头部提取 YAML Front Matter 块。
 * 仅匹配文档最开头的 --- 包裹块；文档中间的 --- 不受影响，按普通 Markdown 语法渲染。
 *
 * @param markdown 已统一换行符的 Markdown 源码
 * @returns [frontMatter HTML, 剩余正文] —— 若头部无合法 front matter，返回 ['', 原文]
 */
function extractFrontMatter(markdown: string): [string, string] {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!match) return ['', markdown]
  const data = parseFrontMatter(match[1])
  if (!data) return ['', markdown]
  return [renderFrontMatterCard(data), markdown.slice(match[0].length)]
}

// ============================================================
// 2.1 元数据（Front Matter）编辑工具
//
// 新建文件时初始化元数据块；保存前自动刷新 lastUpdateDate；
// 打开不含元数据的历史文件时不改动其内容。
// ============================================================

/** 将时间格式化为 YYYY-MM-DD HH:mm:ss */
export function formatDateTime(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 生成新建 Markdown 文件的元数据块（YAML Front Matter）。
 * title 默认取文件名，createDate / lastUpdateDate 默认取当前时间。
 */
export function buildMetadataBlock(opts: {
  title?: string
  tags?: string
  category?: string
  createDate?: string
  lastUpdateDate?: string
} = {}): string {
  const now = formatDateTime()
  const createDate = opts.createDate || now
  const lastUpdateDate = opts.lastUpdateDate || now
  const lines = ['---', `title: ${opts.title || '未命名'}`]
  if (opts.tags) lines.push(`tags: ${opts.tags}`)
  if (opts.category) lines.push(`category: ${opts.category}`)
  lines.push(`createDate: ${createDate}`)
  lines.push(`lastUpdateDate: ${lastUpdateDate}`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * 在文档头部元数据块中设置/更新某个字段的值。
 * 无元数据块时不改动内容；字段不存在时在收尾 --- 前插入。
 */
function setFrontMatterValue(markdown: string, key: string, value: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!fmMatch) return markdown
  const body = markdown.slice(fmMatch[0].length)
  const lines = fmMatch[1].split('\n')
  const lowerKey = key.toLowerCase()
  let found = false
  const updated = lines.map((line) => {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) return line
    if (line.slice(0, colonIdx).trim().toLowerCase() === lowerKey) {
      found = true
      return `${line.slice(0, colonIdx).trimEnd()}: ${value}`
    }
    return line
  })
  if (found) return `---\n${updated.join('\n')}\n---\n${body}`
  return `---\n${lines.join('\n')}\n${key}: ${value}\n---\n${body}`
}

/** 保存前刷新元数据块中的 lastUpdateDate（无元数据块则原样返回） */
export function updateMetadataLastUpdate(markdown: string, now?: string): string {
  return setFrontMatterValue(markdown, 'lastUpdateDate', now || formatDateTime())
}

/** 读取元数据块中的 title（无则返回空字符串） */
export function getFrontMatterTitle(markdown: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!fmMatch) return ''
  for (const line of fmMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    if (line.slice(0, colonIdx).trim().toLowerCase() === 'title') {
      return line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return ''
}

/** 设置元数据块中的 title（无元数据块则原样返回） */
export function setFrontMatterTitle(markdown: string, title: string): string {
  return setFrontMatterValue(markdown, 'title', title)
}

// ============================================================
// 3. GitHub Alert 提示块
//
// 语法：
//   > [!NOTE]
//   > 内容
//
// 支持自定义标题：
//   > [!NOTE] 文章概要
//   > 1. 要点一
//   > 2. 要点二
//
// 支持类型：NOTE / TIP / IMPORTANT / WARNING / CAUTION
// ============================================================

interface AlertToken extends Tokens.Generic {
  meta: string
  title?: string
  text: string
  tokens: Token[]
}

const alertTypes: Record<string, { icon: string; label: string; cls: string }> = {
  note: { icon: 'ℹ️', label: 'Note', cls: 'alert-note' },
  tip: { icon: '💡', label: 'Tip', cls: 'alert-tip' },
  important: { icon: '❗', label: 'Important', cls: 'alert-important' },
  warning: { icon: '⚠️', label: 'Warning', cls: 'alert-warning' },
  caution: { icon: '⛔', label: 'Caution', cls: 'alert-caution' },
}

const alertTokenizer: TokenizerExtension = {
  name: 'githubAlert',
  level: 'block',
  start(src: string) {
    const match = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/m.exec(src)
    return match ? match.index : undefined
  },
  tokenizer(src: string) {
    // 匹配 > [!TYPE] 自定义标题? 后面跟着的 > 引用行
    const rule = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n]*))?[ \t]*\n((?:>[^\n]*\n?)+)/
    const match = rule.exec(src)
    if (match) {
      const alertType = match[1].toLowerCase()
      const title = (match[2] || '').trim()
      // 去掉每行开头的 > 符号
      const content = match[3].split('\n')
        .map(line => line.replace(/^>\s?/, ''))
        .join('\n')
        .trim()
      const token: AlertToken = {
        type: 'githubAlert',
        raw: match[0],
        meta: alertType,
        title: title || undefined,
        text: content,
        tokens: [],
      }
      // marked v18: TokenizerThis 只有 this.lexer，用 blockTokens 生成块级 token，
      // 支持列表 / 段落 / 代码块等多行块级内容
      token.tokens = this.lexer.blockTokens(token.text)
      return token
    }
    return undefined
  },
}

const alertRenderer: RendererExtension = {
  name: 'githubAlert',
  renderer(token: Tokens.Generic) {
    const t = alertTypes[token.meta] || alertTypes.note
    const title = (token as AlertToken).title || t.label
    const parsed = this.parser.parse(token.tokens ?? [])
    return `<div class="github-alert ${t.cls}">
      <div class="alert-header"><span class="alert-icon">${t.icon}</span><span class="alert-label">${title}</span></div>
      <div class="alert-body">${parsed}</div>
    </div>`
  },
}

// ============================================================
// 4. 数学公式扩展
//
// 行内公式：$E=mc^2$
// 块级公式：$$\int_0^1 x dx$$
// mathjax 代码块：```mathjax ... ```
// ============================================================

const blockMathTokenizer: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start(src: string) {
    const idx = src.indexOf('$$')
    return idx > -1 ? idx : undefined
  },
  tokenizer(src: string) {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src)
    if (match) {
      return {
        type: 'blockMath',
        raw: match[0],
        text: match[1].trim(),
      }
    }
    return undefined
  },
}

const blockMathRenderer: RendererExtension = {
  name: 'blockMath',
  renderer(token: Tokens.Generic) {
    return `<div class="math-block">${renderKatex(token.text, true)}</div>`
  },
}

const inlineMathTokenizer: TokenizerExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src: string) {
    const match = /\$[^\s$]/.exec(src)
    return match ? match.index : undefined
  },
  tokenizer(src: string) {
    const match = /^\$((?:\\\$|[^\$\n])+?)\$/.exec(src)
    if (match) {
      return {
        type: 'inlineMath',
        raw: match[0],
        text: match[1].trim(),
      }
    }
    return undefined
  },
}

const inlineMathRenderer: RendererExtension = {
  name: 'inlineMath',
  renderer(token: Tokens.Generic) {
    return renderKatex(token.text, false)
  },
}

// ============================================================
// 4.1 代码块导出（下载）
//
// 代码块 / 图表源码可一键导出为文件：按代码块的语言标识推断扩展名，
// 未收录的语言统一回退为 .txt（纯文本），保证任何代码块都能导出。
// ============================================================

/**
 * 代码语言标识 → 文件扩展名映射。
 * key 为 ``` 后的语言标识（小写），value 为不含点号的扩展名。
 * 未收录的语言由 getCodeFileExt 统一回退为 txt。
 */
const LANG_EXT_MAP: Record<string, string> = {
  // 前端 / Web
  javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
  typescript: 'ts', ts: 'ts', tsx: 'tsx', vue: 'vue',
  html: 'html', htm: 'html', xml: 'xml', svg: 'svg',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less', stylus: 'styl',
  json: 'json', jsonc: 'json', json5: 'json5',
  // 后端 / 通用编程语言
  python: 'py', py: 'py', py3: 'py',
  java: 'java', kotlin: 'kt', kt: 'kt', scala: 'scala', groovy: 'groovy', gradle: 'gradle',
  go: 'go', golang: 'go', rust: 'rs', rs: 'rs',
  c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'hpp',
  csharp: 'cs', 'c#': 'cs', cs: 'cs', 'objective-c': 'm', objectivec: 'm',
  swift: 'swift', dart: 'dart', php: 'php', ruby: 'rb', rb: 'rb',
  perl: 'pl', pl: 'pl', lua: 'lua', r: 'r', matlab: 'm', julia: 'jl',
  erlang: 'erl', elixir: 'ex', haskell: 'hs', clojure: 'clj', scala3: 'scala',
  // 脚本 / Shell
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', fish: 'fish',
  powershell: 'ps1', ps1: 'ps1', ps: 'ps1', bat: 'bat', batch: 'bat', cmd: 'bat',
  vbscript: 'vbs', vbs: 'vbs', applescript: 'scpt',
  // 数据 / 配置
  sql: 'sql', mysql: 'sql', pgsql: 'sql', postgresql: 'sql', sqlite: 'sql',
  yaml: 'yml', yml: 'yml', toml: 'toml', ini: 'ini', properties: 'properties', env: 'env',
  dockerfile: 'dockerfile', docker: 'dockerfile', makefile: 'mk', make: 'mk', cmake: 'txt',
  // 文档 / 其他
  markdown: 'md', md: 'md', mdx: 'mdx', rst: 'rst', latex: 'tex', tex: 'tex',
  diff: 'diff', patch: 'diff', http: 'http', graphql: 'gql', gql: 'gql',
  protobuf: 'proto', proto: 'proto', asm: 'asm', nasm: 'asm', verilog: 'v', vhdl: 'vhd',
  csv: 'csv', tsv: 'tsv',
  // 图表 / 公式（本应用扩展语法：导出的是图表源码，便于复用与迁移）
  mermaid: 'mmd', sequence: 'mmd', plantuml: 'puml', puml: 'puml',
  chart: 'json', chartjs: 'json', math: 'tex', mathjax: 'tex',
  // 纯文本
  text: 'txt', txt: 'txt', plaintext: 'txt', plain: 'txt', log: 'log',
}

/** 未收录语言 / 无语言标识时的默认扩展名 */
const DEFAULT_CODE_EXT = 'txt'

/** 复制按钮图标（feather copy） */
const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'

/** 下载按钮图标（feather download） */
const DOWNLOAD_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'

/** 运行按钮图标（feather play，实心三角形） */
const RUN_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>'

/** 可运行脚本的语言标识（代码块标注 ```js 等语言时显示「运行」按钮） */
const RUNNABLE_JS_LANGS = new Set(['js', 'javascript', 'mjs', 'cjs', 'node', 'nodejs'])

/**
 * 根据代码块语言标识推断导出文件的扩展名。
 * 未收录的语言（含未标注语言的 ```）统一回退为 txt。
 *
 * @param lang 代码块语言标识（如 js / python / mermaid），大小写不敏感
 * @returns 不含点号的扩展名，如 js / py / txt
 */
export function getCodeFileExt(lang: string): string {
  const key = (lang || '').toLowerCase().trim()
  return LANG_EXT_MAP[key] || DEFAULT_CODE_EXT
}

/** 去除文件名中的非法字符，并去掉首尾空白 */
function sanitizeFileName(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').trim()
}

/**
 * 生成代码块导出时的默认文件名。
 * 以当前文档名（去扩展名）为前缀，第二个及之后的代码块追加序号，避免默认名重复。
 *
 * @param lang 代码块语言标识（决定扩展名）
 * @param baseName 当前文档名（可带扩展名，如 笔记.md）；为空时回退为 code
 * @param index 代码块在文档中的序号（1-based）
 * @returns 含扩展名的文件名，如 笔记.py / code-2.txt
 */
export function buildCodeFileName(lang: string, baseName?: string, index = 1): string {
  const ext = getCodeFileExt(lang)
  const base = sanitizeFileName((baseName || '').replace(/\.[^.]+$/, '')) || 'code'
  return index > 1 ? `${base}-${index}.${ext}` : `${base}.${ext}`
}

/**
 * 必须用 CRLF（\r\n）换行的文件扩展名。
 * Windows 批处理由 cmd.exe 逐行解析，纯 LF 会导致多行语句、goto 标签、
 * 括号块等解析错乱，双击运行直接报错或无输出，因此导出时统一转为 CRLF。
 * Shell / Python 等按 LF 处理，不做转换（在 Unix 下 CRLF 反而会报错）。
 */
const CRLF_EXTS = new Set(['bat', 'cmd'])

/**
 * 按目标文件类型规范化代码换行符。
 * 源码中的换行统一为 LF 后，再把 Windows 批处理类文件（bat / cmd）转为 CRLF，
 * 保证导出的脚本双击即可运行；其余类型保持 LF。
 *
 * @param code 代码块原始内容
 * @param ext 目标文件扩展名（不含点号，如 bat / py / txt）
 * @returns 换行符已规范化的内容
 */
export function normalizeCodeLineEndings(code: string, ext: string): string {
  const lf = (code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!CRLF_EXTS.has((ext || '').toLowerCase())) return lf
  return lf.replace(/\n/g, '\r\n')
}

/**
 * 导出单个代码块为文件。
 * 桌面端调用系统「另存为」对话框（可自选路径与文件名）；
 * 非桌面环境（浏览器预览）回退为 Blob 直接下载。
 * 用户在对话框中取消时不做任何提示。
 *
 * @param btn 触发下载的按钮（数据取自其 data-* 属性）
 */
async function downloadCodeBlock(btn: HTMLButtonElement): Promise<void> {
  const code = decodeURIComponent(btn.dataset.downloadCode || '')
  const ext = getCodeFileExt(btn.dataset.downloadLang || '')
  const defaultPath = btn.dataset.downloadName || `code.${ext}`
  // 换行符按文件类型规范化（bat / cmd 必须 CRLF，否则双击运行异常）
  const content = normalizeCodeLineEndings(code, ext)
  try {
    // 桌面端：系统另存为对话框，文件类型按语言扩展名过滤
    if (window.mdAPI?.saveAs) {
      const res = await window.mdAPI.saveAs({
        content,
        defaultPath,
        filters: [
          { name: `${ext.toUpperCase()} 文件`, extensions: [ext] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      if (res?.canceled) return
      showButtonFeedback(btn, true, '已导出')
      return
    }
    // 浏览器环境：Blob + <a download> 直接下载
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = defaultPath
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showButtonFeedback(btn, true, '已导出')
  } catch {
    showButtonFeedback(btn, false)
  }
}

/**
 * 在 document 上注册一次「下载代码块」事件委托。
 * 用事件委托替代逐按钮绑定：任何位置渲染的 Markdown（含 AI 面板回答）中的
 * 下载按钮都能生效，且预览重渲染后无需重新绑定。
 */
function bindCodeDownloadDelegation(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    const btn = target?.closest?.('.code-download-btn') as HTMLButtonElement | null
    if (!btn || !btn.dataset.downloadCode) return
    void downloadCodeBlock(btn)
  })
}
bindCodeDownloadDelegation()

/**
 * 在 document 上注册一次「运行代码块」事件委托：
 * 点击 ```js 代码块的「运行」按钮时，把代码交给主进程以 Node 子进程执行，
 * 输出到「脚本输出」面板。工作目录取代码块所属文档所在目录（由 enhanceRenderedDom 写入 data-run-cwd）。
 */
function bindCodeRunDelegation(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    const btn = target?.closest?.('.code-run-btn') as HTMLButtonElement | null
    if (!btn || !btn.dataset.runCode) return
    const code = decodeURIComponent(btn.dataset.runCode)
    const cwd = btn.dataset.runCwd || ''
    void runScript({ code, cwd })
  })
}
bindCodeRunDelegation()

// ============================================================
// 5. 代码块扩展
//
// 不使用 marked code renderer 扩展（兼容性更好），
// 而是在 enhanceRenderedDom 阶段后处理 <pre><code> 元素。
//
// 但仍需注册一个 code renderer 来阻止 marked 默认渲染 code block，
// 然后在 DOM 增强阶段处理。
// ============================================================

const codeRenderer: RendererExtension = {
  name: 'code',
  renderer(token: Tokens.Generic) {
    const lang = (token.lang || '').toLowerCase().trim()
    const text = token.text || ''
    const langLabel = lang || 'text'
    const ext = getCodeFileExt(lang)
    const codeHtml = escapeHtml(text)
    // 可运行脚本（js / javascript / mjs / cjs / node）额外提供「运行」按钮
    const runBtn = RUNNABLE_JS_LANGS.has(lang)
      ? `<button class="code-run-btn" type="button" title="运行脚本（Node）" data-run-code="${encodeURIComponent(text)}">
          ${RUN_ICON_SVG}
          <span>运行</span>
        </button>`
      : ''
    // 所有代码块统一渲染为 <pre><code>，在 DOM 增强阶段再根据 lang 处理
    return `<div class="code-block-wrapper" data-lang="${escapeHtml(lang)}">
      <div class="code-block-header">
        <span class="code-lang">${escapeHtml(langLabel)}</span>
        <div class="code-actions">
          <button class="code-copy-btn" type="button" title="复制代码" data-copy-code="${encodeURIComponent(text)}">
            ${COPY_ICON_SVG}
            <span>复制</span>
          </button>
          <button class="code-download-btn" type="button" title="导出为 ${escapeHtml(ext)} 文件" data-download-code="${encodeURIComponent(text)}" data-download-lang="${escapeHtml(lang)}">
            ${DOWNLOAD_ICON_SVG}
            <span>下载</span>
          </button>
          ${runBtn}
        </div>
      </div>
      <pre><code class="language-${escapeHtml(lang)}">${codeHtml}</code></pre>
    </div>`
  },
}

// ============================================================
// 5.1 图片渲染增强
//
// 将 ![说明文字](url) 渲染为 <figure>，并把 alt（说明文字）作为
// <figcaption> 显示在图片下方，使图片的说明文字在预览中可见。
// 说明文字为空时仅渲染 <img>，行为与默认一致。
// ============================================================

const imageRenderer: RendererExtension = {
  name: 'image',
  renderer(token: Tokens.Generic) {
    const href = token.href || ''
    const title = token.title || ''
    const alt = token.text || ''
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
    const img = `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${titleAttr}>`
    const caption = alt.trim()
      ? `<figcaption class="md-figcaption">${escapeHtml(alt)}</figcaption>`
      : ''
    return `<figure class="md-figure">${img}${caption}</figure>`
  },
}

// ============================================================
// 6. 构建带扩展的 marked 实例
// ============================================================

const markedInstance = new Marked({
  breaks: true,
  gfm: true,
})

markedInstance.use({
  extensions: [
    alertTokenizer,
    alertRenderer,
    blockMathTokenizer,
    blockMathRenderer,
    inlineMathTokenizer,
    inlineMathRenderer,
    codeRenderer,
    imageRenderer,
  ],
})

/**
 * 将 Markdown 文本渲染为 HTML 字符串。
 * 渲染时会为每个块级元素注入 data-line 属性（该块在源码中的起始行号，1-based），
 * 供「源码 / 预览」同步滚动时按行号双向锚定，保证左右两侧滚动内容一致。
 * @param markdown Markdown 源码
 * @returns HTML 字符串
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return ''
  try {
    // 统一换行符为 \n，避免 Windows \r\n 导致正则匹配失败
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    // 仅解析文档头部的 YAML Front Matter（--- 包裹的元信息块），渲染为蓝色主题卡片；
    // 文档中间的 --- 按普通 Markdown 语法渲染（如水平分割线）
    const [frontMatterHtml, body] = extractFrontMatter(normalized)
    // Front Matter 被提取后，body 相对整个文档的字符偏移（用于把行号换算回 textarea 全文编号）
    const consumed = normalized.slice(0, normalized.length - body.length)

    // 逐个块级 token 渲染并注入行号，替代整体 parse：
    // lexer 产出的 tokens 依次消费源码（raw 连续拼接 == body），据此可精确算出每个块的起始行号。
    const tokens = markedInstance.lexer(body)
    const parser = new MarkedParser(markedInstance.defaults)
    const parts: string[] = []
    if (frontMatterHtml) parts.push(injectLineAttr(frontMatterHtml, 1))
    let cursor = 0
    for (const token of tokens) {
      const raw = (token as Token).raw
      if (!raw || token.type === 'space') {
        cursor += raw?.length || 0
        continue
      }
      // 块起始行号 = 文档开头到该块之间的换行数 + 1（相对整个文档，含 Front Matter）
      const line = normalized.slice(0, consumed.length + cursor).split('\n').length
      const blockHtml = parser.parse([token]) as string
      if (blockHtml) parts.push(injectLineAttr(blockHtml, line))
      cursor += raw.length
    }
    return parts.join('')
  } catch {
    return '<p style="color:#f56c6c">渲染错误</p>'
  }
}

// ============================================================
// 7. 渲染后 DOM 增强
// ============================================================

const enhancedSet = new WeakSet<HTMLElement>()

/**
 * 为图表代码块容器顶部插入「语言标签 + 复制按钮」头部。
 * 图表（Mermaid/PlantUML/Chart/公式）渲染后会替换原代码块，
 * 源码复制按钮随之丢失；此头部让源码仍可一键复制，
 * 且渲染失败时用户也能复制源码排查问题。
 *
 * @param container 图表容器元素
 * @param langLabel 语言标签文案
 * @param source 图表源码（复制内容）
 */
function appendDiagramHeader(container: HTMLElement, langLabel: string, source: string): void {
  const ext = getCodeFileExt(langLabel)
  const header = document.createElement('div')
  header.className = 'diagram-header'
  header.innerHTML = `
    <span class="code-lang">${escapeHtml(langLabel)}</span>
    <div class="code-actions">
      <button class="code-copy-btn" type="button" title="复制源码" data-copy-code="${encodeURIComponent(source)}">
        ${COPY_ICON_SVG}
        <span>复制</span>
      </button>
      <button class="code-download-btn" type="button" title="导出为 ${escapeHtml(ext)} 文件" data-download-code="${encodeURIComponent(source)}" data-download-lang="${escapeHtml(langLabel)}">
        ${DOWNLOAD_ICON_SVG}
        <span>下载</span>
      </button>
    </div>
  `
  container.prepend(header)
}

/**
 * 处理渲染后的 DOM 元素：
 * 1. 将 mermaid/sequence/chart/mathjax 代码块替换为对应组件
 * 2. 初始化 Mermaid 图表（含 sequence）
 * 3. 初始化 Chart.js 图表（简化格式）
 * 4. 绑定代码块复制 / 下载按钮事件
 *
 * @param container 包含渲染后 HTML 的容器元素
 * @param baseName 当前文档名（如 笔记.md），用于生成代码块导出时的默认文件名
 * @param cwd 当前文档所在目录，作为 ```js 代码块「运行」时的工作目录
 */
export async function enhanceRenderedDom(container: HTMLElement, baseName?: string, cwd?: string): Promise<void> {
  // --- 第一步：扫描 code-block-wrapper，按 data-lang 转换特殊代码块 ---
  const codeWrappers = container.querySelectorAll<HTMLElement>('.code-block-wrapper')
  for (const wrapper of Array.from(codeWrappers)) {
    const lang = (wrapper.dataset.lang || '').toLowerCase().trim()
    const codeEl = wrapper.querySelector('code')
    if (!codeEl) continue
    const codeText = codeEl.textContent || ''

    // Mermaid 图表
    if (lang === 'mermaid') {
      const mermaidDiv = document.createElement('div')
      mermaidDiv.className = 'mermaid-container'
      // 保留源码行号标记，供「源码 / 预览」同步滚动使用
      mermaidDiv.dataset.line = wrapper.dataset.line || ''
      appendDiagramHeader(mermaidDiv, 'mermaid', codeText)
      const inner = document.createElement('div')
      inner.className = 'mermaid'
      inner.textContent = codeText
      mermaidDiv.appendChild(inner)
      wrapper.replaceWith(mermaidDiv)
      continue
    }

    // sequence 时序图 -> 转为 mermaid sequenceDiagram
    if (lang === 'sequence') {
      const mermaidCode = 'sequenceDiagram\n' + codeText.split('\n').map(l => '  ' + l).join('\n')
      const mermaidDiv = document.createElement('div')
      mermaidDiv.className = 'mermaid-container'
      mermaidDiv.dataset.line = wrapper.dataset.line || ''
      appendDiagramHeader(mermaidDiv, 'sequence', codeText)
      const inner = document.createElement('div')
      inner.className = 'mermaid'
      inner.textContent = mermaidCode
      mermaidDiv.appendChild(inner)
      wrapper.replaceWith(mermaidDiv)
      continue
    }

    // PlantUML 图表（编码后交给渲染服务生成 SVG，服务地址可在「PlantUML 配置」中自定义）
    if (lang === 'plantuml' || lang === 'puml') {
      const plantDiv = document.createElement('div')
      plantDiv.className = 'plantuml-container'
      // 保留源码行号标记，供「源码 / 预览」同步滚动使用
      plantDiv.dataset.line = wrapper.dataset.line || ''
      // 保存源码，配置变更（更换服务地址）后可据此刷新图片地址
      plantDiv.dataset.pumlSource = codeText
      appendDiagramHeader(plantDiv, lang, codeText)
      const img = document.createElement('img')
      img.className = 'plantuml-img'
      img.alt = 'PlantUML 图表'
      img.loading = 'lazy'
      try {
        img.src = getPlantUmlRenderUrl(encodePlantUml(codeText))
      } catch {
        img.src = ''
      }
      img.addEventListener('error', () => {
        plantDiv.querySelector('.plantuml-img')?.remove()
        const err = document.createElement('div')
        err.className = 'plantuml-error'
        err.textContent = 'PlantUML 渲染失败：请检查网络连接或服务地址配置后重试'
        plantDiv.appendChild(err)
      })
      plantDiv.appendChild(img)
      wrapper.replaceWith(plantDiv)
      continue
    }

    // mathjax/math 代码块 -> KaTeX 渲染
    if (lang === 'mathjax' || lang === 'math') {
      const mathDiv = document.createElement('div')
      mathDiv.className = 'math-block'
      // 保留源码行号标记，供「源码 / 预览」同步滚动使用
      mathDiv.dataset.line = wrapper.dataset.line || ''
      appendDiagramHeader(mathDiv, lang, codeText)
      mathDiv.innerHTML += renderKatex(codeText, true)
      wrapper.replaceWith(mathDiv)
      continue
    }

    // chart/chartjs 代码块 -> Chart.js canvas
    if (lang === 'chart' || lang === 'chartjs') {
      const chartDiv = document.createElement('div')
      chartDiv.className = 'chart-container'
      // 保留源码行号标记，供「源码 / 预览」同步滚动使用
      chartDiv.dataset.line = wrapper.dataset.line || ''
      appendDiagramHeader(chartDiv, lang, codeText)
      const canvas = document.createElement('canvas')
      canvas.dataset.chartConfig = encodeURIComponent(codeText)
      chartDiv.appendChild(canvas)
      wrapper.replaceWith(chartDiv)
      continue
    }
  }

  // --- 普通代码块：highlight.js 语法高亮 ---
  // 对未被转换为图表/公式的普通代码块，执行语法高亮（token 着色）
  // 注意：对于空语言或纯文本(text/plaintext)代码块，必须跳过高亮，
  // 否则 highlight.js 会回退到 highlightAuto 自动检测，可能将代码内容
  // 误识别为 Markdown，导致 **** 被渲染为 <span class="hljs-strong">****</span>，
  // 被主题 CSS 的 .hljs-strong { font-weight: bold } 显示为加粗。
  const PLAIN_LANGS = new Set(['', 'text', 'plaintext', 'txt', 'plain'])
  const codeEls = container.querySelectorAll<HTMLElement>('.code-block-wrapper pre code')
  for (const codeEl of Array.from(codeEls)) {
    if (enhancedSet.has(codeEl)) continue
    enhancedSet.add(codeEl)
    // 从父 wrapper 的 data-lang 属性获取语言
    const wrapper = codeEl.closest('.code-block-wrapper') as HTMLElement | null
    const lang = (wrapper?.dataset.lang || '').toLowerCase().trim()
    if (PLAIN_LANGS.has(lang)) continue
    try {
      hljs.highlightElement(codeEl)
    } catch {
      // 忽略高亮错误，保持原样
    }
  }

  // --- 第二步：初始化 Mermaid 图表 ---
  const mermaidEls = container.querySelectorAll<HTMLElement>('.mermaid')
  if (mermaidEls.length > 0) {
    ensureMermaidReady()
    // 串行渲染每个 mermaid 图表，避免 DOM id 冲突
    for (const el of Array.from(mermaidEls)) {
      if (enhancedSet.has(el)) continue
      enhancedSet.add(el)
      // 确保元素已挂载到文档中
      if (!el.isConnected) continue
      // 使用 textContent 获取原始图表定义
      const graphDef = el.textContent || ''
      const renderId = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
      try {
        el.innerHTML = ''
        const { svg } = await mermaid.render(renderId, graphDef)
        el.innerHTML = svg
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        el.innerHTML = `<div style="color:#f56c6c;padding:12px;font-size:13px">Mermaid 渲染失败: <pre style="margin-top:8px;white-space:pre-wrap;font-size:12px">${escapeHtml(errMsg)}</pre></div>`
      }
    }
  }

  // --- Chart.js ---
  const chartCanvases = container.querySelectorAll<HTMLCanvasElement>('canvas[data-chart-config]')
  for (const canvas of chartCanvases) {
    if (enhancedSet.has(canvas)) continue
    enhancedSet.add(canvas)
    const configStr = decodeURIComponent(canvas.dataset.chartConfig || '')
    try {
      const userData = JSON.parse(configStr)
      const chartConfig = buildChartConfig(userData)
      new Chart(canvas, chartConfig)
    } catch {
      const parent = canvas.parentElement
      if (parent) {
        parent.innerHTML = '<div style="color:#f56c6c;padding:12px">Chart 图表渲染失败：请检查 JSON 配置</div>'
      }
    }
  }

  // --- 代码块复制按钮 ---
  const copyBtns = container.querySelectorAll<HTMLButtonElement>('.code-copy-btn')
  for (const btn of copyBtns) {
    if (enhancedSet.has(btn)) continue
    enhancedSet.add(btn)
    btn.addEventListener('click', async () => {
      const encoded = btn.dataset.copyCode || ''
      const code = decodeURIComponent(encoded)
      try {
        await navigator.clipboard.writeText(code)
        showButtonFeedback(btn, true, '已复制')
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = code
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        try {
          document.execCommand('copy')
          showButtonFeedback(btn, true, '已复制')
        } catch {
          showButtonFeedback(btn, false)
        }
        document.body.removeChild(textarea)
      }
    })
  }

  // --- 代码块下载按钮（按语言导出为对应类型的文件） ---
  // 点击由 document 事件委托统一处理（见 bindCodeDownloadDelegation），
  // 此处仅按文档名与序号写入默认文件名
  Array.from(container.querySelectorAll<HTMLButtonElement>('.code-download-btn')).forEach((btn, idx) => {
    if (enhancedSet.has(btn)) return
    enhancedSet.add(btn)
    // 默认文件名：文档名 + 代码块序号 + 语言扩展名（如 笔记.py、笔记-2.sql）
    btn.dataset.downloadName = buildCodeFileName(btn.dataset.downloadLang || '', baseName, idx + 1)
  })

  // --- 代码块运行按钮：写入文档所在目录，作为脚本执行时的工作目录 ---
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>('.code-run-btn'))) {
    if (enhancedSet.has(btn)) continue
    enhancedSet.add(btn)
    btn.dataset.runCwd = cwd || ''
  }
}

/**
 * 将用户简化的图表 JSON 转换为 Chart.js 配置
 *
 * 输入格式：
 * { type: "pie"|"bar"|"line"|"area"|"radar", title, data: [{name, value}] }
 * 或直接使用 Chart.js 原始配置
 */
function buildChartConfig(userData: any): any {
  // 如果已经是 Chart.js 原始格式（有 data.datasets），直接返回
  if (userData.data?.datasets) {
    return userData
  }

  const type = (userData.type || 'bar').toLowerCase()
  const title = userData.title || ''
  const data = Array.isArray(userData.data) ? userData.data : []
  const labels = data.map((d: any) => d.name || d.label || '')
  const values = data.map((d: any) => d.value ?? 0)

  const colors = [
    '#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399',
    '#9c27b0', '#00bcd4', '#ff9800', '#795548', '#607d8b',
  ]

  // 饼图 / 环形图
  if (type === 'pie' || type === 'doughnut') {
    return {
      type: type === 'doughnut' ? 'doughnut' : 'pie',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_: string, i: number) => colors[i % colors.length]),
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: !!title, text: title },
          legend: { position: 'right' },
        },
      },
    }
  }

  // 雷达图
  if (type === 'radar') {
    return {
      type: 'radar',
      data: {
        labels,
        datasets: [{
          label: title || '数据',
          data: values,
          backgroundColor: 'rgba(64, 158, 255, 0.2)',
          borderColor: '#409eff',
          pointBackgroundColor: '#409eff',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: !!title, text: title },
        },
      },
    }
  }

  // 柱状图 / 折线图 / 面积图
  const chartType = type === 'area' ? 'line' : type
  return {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: title || '数据',
        data: values,
        backgroundColor: type === 'area' ? 'rgba(64, 158, 255, 0.2)' : (type === 'line' ? 'transparent' : colors.slice(0, values.length)),
        borderColor: type === 'line' || type === 'area' ? '#409eff' : undefined,
        fill: type === 'area',
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: !!title, text: title },
      },
    },
  }
}

/**
 * 显示按钮操作结果反馈：临时改写按钮文案，1.8s 后复原。
 *
 * @param btn 触发操作的按钮
 * @param success 操作是否成功
 * @param successText 成功时显示的文案（默认「已复制」）
 */
function showButtonFeedback(btn: HTMLButtonElement, success: boolean, successText = '已复制'): void {
  const label = btn.querySelector('span')
  const originalText = label?.textContent || successText
  if (label) {
    label.textContent = success ? successText : '失败'
  }
  btn.classList.add(success ? 'copied' : 'copy-failed')
  setTimeout(() => {
    if (label) label.textContent = originalText
    btn.classList.remove('copied', 'copy-failed')
  }, 1800)
}

/**
 * 获取 Markdown 扩展功能的样式
 */
export function getMarkdownExtensionStyles(): string {
  return `
/* ========== YAML Front Matter 卡片 ========== */
.frontmatter-card {
  margin: 16px 0;
  padding: 16px 20px;
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f7ff 100%);
  border: 1px solid #b3d8ff;
  border-left: 4px solid #409eff;
  border-radius: 8px;
}
.frontmatter-card .fm-title {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.frontmatter-card .fm-emoji {
  font-size: 24px;
}
.frontmatter-card .fm-meta {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #606266;
}
.frontmatter-card .fm-meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 3px 12px;
  background: rgba(64, 158, 255, 0.06);
  border: 1px solid rgba(64, 158, 255, 0.15);
  border-radius: 6px;
}
.frontmatter-card .fm-tag {
  display: inline-block;
  padding: 2px 10px;
  background: #409eff;
  color: #fff;
  font-size: 12px;
  border-radius: 10px;
}
.frontmatter-card .fm-desc {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

/* ========== 代码块复制 / 下载按钮 ========== */
.code-block-wrapper {
  margin: 12px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--code-border, #383838);
}
.code-block-wrapper .code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--code-header-bg, #2d2d2d);
  border-bottom: 1px solid var(--code-border, #383838);
}
.code-block-wrapper .code-lang {
  font-size: 12px;
  color: var(--code-lang-color, #999);
  font-family: 'Consolas', monospace;
  text-transform: lowercase;
}
.code-block-wrapper .code-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.code-block-wrapper .code-copy-btn,
.code-block-wrapper .code-download-btn,
.code-block-wrapper .code-run-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--code-btn-border, #444);
  border-radius: 4px;
  background: transparent;
  color: var(--code-btn-color, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.code-block-wrapper .code-copy-btn:hover,
.code-block-wrapper .code-download-btn:hover,
.code-block-wrapper .code-run-btn:hover {
  background: #3a3a3a;
  color: #fff;
  border-color: #555;
}
/* 运行按钮用绿色强调，突出「可执行」语义 */
.code-block-wrapper .code-run-btn {
  color: #67c23a;
  border-color: rgba(103, 194, 58, 0.5);
}
.code-block-wrapper .code-run-btn:hover {
  background: rgba(103, 194, 58, 0.15);
  color: #67c23a;
  border-color: #67c23a;
}
.code-block-wrapper .code-copy-btn.copied,
.code-block-wrapper .code-download-btn.copied {
  color: #67c23a;
  border-color: #67c23a;
}
.code-block-wrapper .code-copy-btn.copy-failed,
.code-block-wrapper .code-download-btn.copy-failed {
  color: #f56c6c;
  border-color: #f56c6c;
}
.code-block-wrapper pre {
  margin: 0;
  padding: 16px;
  background: var(--code-bg, #1e1e1e);
  border-radius: 0;
  overflow-x: auto;
}
.code-block-wrapper pre code {
  padding: 0;
  background: transparent;
  color: var(--code-text, #d4d4d4);
  font-size: 13px;
  line-height: 1.6;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* ========== 图表代码块复制 / 下载按钮头部（Mermaid / PlantUML / Chart / 公式） ========== */
.diagram-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  padding: 0 0 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid #e4e7ed;
}
.diagram-header .code-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.diagram-header .code-copy-btn,
.diagram-header .code-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: transparent;
  color: #909399;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.diagram-header .code-copy-btn:hover,
.diagram-header .code-download-btn:hover {
  background: #f0f0f0;
  color: #303133;
  border-color: #c0c4cc;
}
.diagram-header .code-copy-btn.copied,
.diagram-header .code-download-btn.copied {
  color: #67c23a;
  border-color: #67c23a;
}
.diagram-header .code-copy-btn.copy-failed,
.diagram-header .code-download-btn.copy-failed {
  color: #f56c6c;
  border-color: #f56c6c;
}

/* ========== Mermaid 图表 ========== */
.mermaid-container {
  margin: 16px 0;
  padding: 16px;
  background: #fafafa;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  text-align: center;
  overflow-x: auto;
}
.mermaid-container .mermaid {
  display: inline-block;
  min-width: 100%;
}

/* ========== Chart.js 图表 ========== */
.chart-container {
  margin: 16px 0;
  padding: 16px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}
.chart-container canvas {
  max-width: 100% !important;
  height: 350px !important;
}

/* ========== PlantUML 图表 ========== */
.plantuml-container {
  margin: 16px 0;
  padding: 16px;
  background: #fafafa;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  text-align: center;
  overflow-x: auto;
}
.plantuml-container .plantuml-img {
  display: inline-block;
  max-width: 100%;
  border-radius: 4px;
}
.plantuml-container .plantuml-error {
  color: #f56c6c;
  font-size: 13px;
  padding: 12px;
}

/* ========== GitHub Alert 提示块 ========== */
.github-alert {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  border-left: 4px solid;
}
.github-alert .alert-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-weight: 600;
  font-size: 14px;
}
.github-alert .alert-icon {
  font-size: 16px;
}
.github-alert .alert-body {
  padding: 8px 16px 12px;
  font-size: 14px;
  line-height: 1.7;
}
.github-alert .alert-body p {
  margin: 4px 0;
}
.github-alert .alert-body p:last-child {
  margin-bottom: 0;
}
.github-alert .alert-body ol,
.github-alert .alert-body ul {
  padding-left: 20px;
  margin: 4px 0;
}
.github-alert .alert-body li {
  margin: 2px 0;
}
.github-alert .alert-body ol:last-child,
.github-alert .alert-body ul:last-child {
  margin-bottom: 0;
}
.github-alert .alert-note {
  background: #ecf5ff;
  border-color: #409eff;
}
.github-alert .alert-note .alert-header {
  color: #337ecc;
  background: rgba(64, 158, 255, 0.08);
}
.github-alert .alert-tip {
  background: #f0f9eb;
  border-color: #67c23a;
}
.github-alert .alert-tip .alert-header {
  color: #529b2e;
  background: rgba(103, 194, 58, 0.08);
}
.github-alert .alert-important {
  background: #f4f0fa;
  border-color: #9c27b0;
}
.github-alert .alert-important .alert-header {
  color: #7b1fa2;
  background: rgba(156, 39, 176, 0.08);
}
.github-alert .alert-warning {
  background: #fdf6ec;
  border-color: #e6a23c;
}
.github-alert .alert-warning .alert-header {
  color: #b88230;
  background: rgba(230, 162, 60, 0.08);
}
.github-alert .alert-caution {
  background: #fef0f0;
  border-color: #f56c6c;
}
.github-alert .alert-caution .alert-header {
  color: #c45656;
  background: rgba(245, 108, 108, 0.08);
}

/* ========== 数学公式 ========== */
.math-block {
  margin: 16px 0;
  padding: 12px 16px;
  text-align: center;
  overflow-x: auto;
  background: #fafafa;
  border-radius: 6px;
}
.math-block .katex-display {
  margin: 0;
}

/* ========== 图片说明文字（图注） ========== */
.md-figure {
  margin: 16px 0;
  text-align: center;
}
.md-figure img {
  display: inline-block;
  max-width: 100%;
  border-radius: 8px;
}
.md-figcaption {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
  text-align: center;
  line-height: 1.6;
}
`
}
