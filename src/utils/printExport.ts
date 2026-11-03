/**
 * 多种文件 → 打印用 HTML（PDF 导出）
 *
 * 统一管线：把「源内容」变成一份按纸张排版的 HTML（或直接给出源文件路径），
 * 交给主进程用隐藏窗口的 Chromium 打印成矢量 PDF。
 *
 * 支持的类型：
 * - markdown：复用编辑器渲染管线（Mermaid 矢量、Chart、KaTeX、代码高亮）
 * - html：直接把源文件交给打印窗口（相对 CSS / 图片天然可用），只注入少量打印样式
 * - text / json：等宽字体 + 自动换行，长文档可跨页
 * - image：一图一页、等比缩放居中
 * - docx：docx-preview 离屏渲染后打印（图片转 base64，避免 blob 跨进程失效）
 *
 * 资源可访问性：
 * - markdown / docx 的图片：markdown 走 mdlocal:// 绝对路径，docx 走 base64；
 * - KaTeX 字体内联为 data URL（打印窗口是临时文件，相对字体路径会 404）。
 *
 * @module utils/printExport
 */

import {
  renderMarkdown,
  enhanceRenderedDom,
  getMarkdownExtensionStyles,
  CODE_THEMES,
  DEFAULT_CODE_THEME,
} from './markdown'
import { joinPath, toMdLocalUrl } from './fileUtils'
import katexCss from 'katex/dist/katex.min.css?inline'

// ============================================================
// 类型与默认值
// ============================================================

/** 可打印的文件类型 */
export type PrintableKind = 'markdown' | 'html' | 'json' | 'text' | 'image' | 'docx'

/** 纸张预设 */
export type PdfPaper = 'A3' | 'A4' | 'A5' | 'Letter' | 'custom'

/** PDF 版面设置（UI 与打印参数共用同一份结构） */
export interface PdfPageSettings {
  /** 纸张预设，custom 时用 customWidthMm / customHeightMm */
  paper: PdfPaper
  /** 自定义纸张宽度（毫米） */
  customWidthMm: number
  /** 自定义纸张高度（毫米） */
  customHeightMm: number
  /** 是否横向 */
  landscape: boolean
  /** 页边距（毫米） */
  marginMm: number
  /** 内容缩放（1 = 100%），调大可在 100% 视图下获得更大字号 */
  scale: number
  /** 是否打印「第 N 页 / 共 M 页」页脚 */
  showPageNumber: boolean
}

/** 默认版面：A4 纵向、14mm 边距、100% 缩放、带页码 */
export const DEFAULT_PDF_PAGE: PdfPageSettings = {
  paper: 'A4',
  customWidthMm: 210,
  customHeightMm: 297,
  landscape: false,
  marginMm: 14,
  scale: 1,
  showPageNumber: true,
}

/** 纸张预设尺寸（毫米，纵向） */
const PAPER_MM: Record<Exclude<PdfPaper, 'custom'>, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
}

/** 解析出实际纸张尺寸（毫米，已计入横向翻转） */
export function resolvePaperMm(page: PdfPageSettings): { w: number; h: number } {
  const base =
    page.paper === 'custom'
      ? { w: page.customWidthMm, h: page.customHeightMm }
      : PAPER_MM[page.paper] || PAPER_MM.A4
  return page.landscape ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

/** 生成打印 HTML 的入参 */
export interface PrintBuildOptions {
  /** 源类型 */
  kind: PrintableKind
  /** 文本内容（markdown / html / json / text 由编辑器提供，编码已纠正） */
  text?: string
  /** 源文件绝对路径（html / image / docx） */
  filePath?: string
  /** 源文件所在目录，用于解析相对图片路径 */
  baseDir?: string
  /** 当前文件名 */
  baseName?: string
  /** 文档标题 */
  title?: string
  /** 代码高亮主题（markdown 用） */
  codeTheme?: string
  /** 正文字体栈 */
  fontFamily?: string
  /** 版面设置 */
  page?: Partial<PdfPageSettings>
  /** 进度提示 */
  onProgress?: (text: string) => void
}

/** 生成结果：html 与 sourceFile 二选一 */
export interface PrintDocument {
  /** 打印用完整 HTML（markdown / 文本 / docx） */
  html?: string
  /** 直接打印的源文件（html / image） */
  sourceFile?: string
  /** 追加注入的打印样式（sourceFile 模式） */
  injectCss?: string
  /** 主进程 printToPDF 参数 */
  options: {
    pageSize?: 'A3' | 'A4' | 'A5' | 'Letter'
    customWidthMm?: number
    customHeightMm?: number
    landscape?: boolean
    marginMm?: number
    showPageNumber?: boolean
  }
  /** 降级 / 跳过项说明 */
  warnings: string[]
}

// ============================================================
// 入口
// ============================================================

/**
 * 根据源类型生成打印文档。
 *
 * 失败会抛出 Error（调用方统一提示），局部降级只记入 warnings。
 */
export async function buildPrintDocument(opts: PrintBuildOptions): Promise<PrintDocument> {
  const page: PdfPageSettings = { ...DEFAULT_PDF_PAGE, ...(opts.page || {}) }
  const options = toPrintOptions(page)
  const ctx: BuildContext = {
    page,
    options,
    warnings: [],
    // 正文可用 CSS 宽度（已扣除 zoom 影响），保证图表按最终宽度渲染
    contentWidthPx: computeContentWidthPx(page),
  }

  switch (opts.kind) {
    case 'markdown':
      return { ...(await buildMarkdownDoc(opts, ctx)), options, warnings: ctx.warnings }
    case 'json':
    case 'text':
      return { ...(await buildPlainTextDoc(opts, ctx)), options, warnings: ctx.warnings }
    case 'html':
      return { ...buildHtmlFileDoc(opts, ctx), options, warnings: ctx.warnings }
    case 'image':
      return { ...buildImageFileDoc(opts, ctx), options, warnings: ctx.warnings }
    case 'docx':
      return { ...(await buildDocxDoc(opts, ctx)), options, warnings: ctx.warnings }
    default:
      throw new Error('该文件类型暂不支持导出 PDF')
  }
}

/** 内部构建上下文 */
interface BuildContext {
  page: PdfPageSettings
  options: PrintDocument['options']
  warnings: string[]
  contentWidthPx: number
}

/** 单个构建器的产物（options / warnings 由统一入口补齐） */
type PrintPayload = Pick<PrintDocument, 'html' | 'sourceFile' | 'injectCss'>

/** 版面设置 → 主进程打印参数 */
function toPrintOptions(page: PdfPageSettings): PrintDocument['options'] {
  const common = {
    landscape: page.landscape,
    marginMm: page.marginMm,
    showPageNumber: page.showPageNumber,
  }
  if (page.paper === 'custom') {
    return {
      ...common,
      customWidthMm: page.customWidthMm,
      customHeightMm: page.customHeightMm,
    }
  }
  return { ...common, pageSize: page.paper }
}

/** 正文可用宽度（CSS px）：纸张宽 - 左右边距，再按缩放折算 */
function computeContentWidthPx(page: PdfPageSettings): number {
  const { w } = resolvePaperMm(page)
  const contentMm = Math.max(30, w - page.marginMm * 2)
  const scale = page.scale > 0 ? page.scale : 1
  const px = ((contentMm / 25.4) * 96) / scale
  // 上限避免超大纸张导致图表按离谱尺寸渲染
  return Math.round(Math.min(Math.max(px, 260), 1600))
}

// ============================================================
// Markdown
// ============================================================

/** Markdown → 打印 HTML（离屏渲染富内容） */
async function buildMarkdownDoc(opts: PrintBuildOptions, ctx: BuildContext): Promise<PrintPayload> {
  const host = createOffscreenHost(ctx.contentWidthPx)
  try {
    opts.onProgress?.('正在渲染文档…')
    host.innerHTML = renderMarkdown(opts.text || '')
    document.body.appendChild(host)

    opts.onProgress?.('正在渲染图表…')
    await enhanceRenderedDom(host, opts.baseName)
    await waitImagesLoaded(host)

    opts.onProgress?.('正在准备打印样式…')
    cleanupForPrint(host)
    absolutizeImages(host, opts.baseDir || '', ctx.warnings)

    const katexCssInlined = await getInlinedKatexCss()
    const html = composeHtml(host.innerHTML, {
      title: opts.title || opts.baseName || 'Markdown 文档',
      fontFamily: opts.fontFamily,
      codeTheme: opts.codeTheme,
      extraCss: `${getMarkdownExtensionStyles()}\n${katexCssInlined}`,
      rich: true,
      zoom: ctx.page.scale,
    })
    return { html }
  } finally {
    host.remove()
  }
}

// ============================================================
// 纯文本 / JSON
// ============================================================

/** 纯文本与 JSON：等宽字体、保留缩进、自动折行、可跨页 */
async function buildPlainTextDoc(opts: PrintBuildOptions, ctx: BuildContext): Promise<PrintPayload> {
  const text = opts.text || ''
  if (!text.trim()) throw new Error('内容为空，无法导出 PDF')
  const html = composeHtml(`<pre class="plain-code">${escapeHtml(text)}</pre>`, {
    title: opts.title || opts.baseName || '文本',
    fontFamily: opts.fontFamily,
    extraCss: `
.plain-code {
  margin: 0;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: Consolas, "Courier New", Monaco, monospace;
  font-size: 12.5px;
  line-height: 1.62;
  tab-size: 2;
}`,
    rich: false,
    zoom: ctx.page.scale,
  })
  return { html }
}

// ============================================================
// HTML / 图片：直接打印源文件
// ============================================================

/**
 * HTML 文件：直接打印源文件本身。
 *
 * 源文件的样式表、相对路径图片天然可用，比"读文本再拼装"保真；
 * 只需注入少量覆盖样式（暗色背景转白、缩放）。
 */
function buildHtmlFileDoc(opts: PrintBuildOptions, ctx: BuildContext): PrintPayload {
  if (!opts.filePath) throw new Error('缺少文件路径')
  return {
    sourceFile: opts.filePath,
    injectCss: `
body { zoom: ${ctx.page.scale} !important; }
@media print {
  html, body { background: #fff !important; }
}`,
  }
}

/** 图片：一图一页，等比缩放到页面内并居中 */
function buildImageFileDoc(opts: PrintBuildOptions, ctx: BuildContext): PrintPayload {
  if (!opts.filePath) throw new Error('缺少文件路径')
  return {
    sourceFile: opts.filePath,
    injectCss: `
html, body {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff !important;
  overflow: hidden;
}
img {
  max-width: 100% !important;
  max-height: 100vh !important;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: 0;
}`,
  }
}

// ============================================================
// Word（.docx）
// ============================================================

/** docx → 打印 HTML：docx-preview 离屏渲染（图片 base64、按页断页） */
async function buildDocxDoc(opts: PrintBuildOptions, ctx: BuildContext): Promise<PrintPayload> {
  if (!opts.filePath) throw new Error('缺少文件路径')
  opts.onProgress?.('正在解析 Word 文档…')

  const bytes = await readLocalBinary(opts.filePath)
  if (!bytes) throw new Error('无法读取 Word 文件')

  const bodyHost = createOffscreenHost(ctx.contentWidthPx)
  const styleHost = document.createElement('div')
  styleHost.style.cssText = 'position:fixed;left:-100000px;top:0;'
  document.body.append(bodyHost, styleHost)

  try {
    const { renderAsync } = await import('docx-preview')
    opts.onProgress?.('正在渲染 Word 排版…')
    await renderAsync(bytes, bodyHost, styleHost, {
      // 不要文档自带的灰色外框，打印时按纸张排版
      inWrapper: false,
      // 按 Word 的分页符断页
      breakPages: true,
      // 宽度/高度交给纸张决定，避免固定 A4 宽度导致横向溢出
      ignoreWidth: true,
      ignoreHeight: true,
      ignoreFonts: false,
      // 图片转 base64：blob URL 在打印窗口（另一个进程）里取不到
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      experimental: true,
    })

    await waitImagesLoaded(bodyHost)
    // docx-preview 会往 styleContainer 写多个 <style> 元素，必须取内部文本——
    // 直接用 innerHTML 会把 "</style>" 带进外层样式块，导致 CSS 泄漏成正文文本
    const docxCss = Array.from(styleHost.querySelectorAll('style'))
      .map((s) => s.textContent || '')
      .join('\n')
    // 不传 fontFamily：Word 文档的字体由 docx-preview 生成的内联样式决定，避免被覆盖
    const html = composeHtml(bodyHost.innerHTML, {
      title: opts.title || opts.baseName || 'Word 文档',
      extraCss: `${docxCss}\n${DOCX_PRINT_CSS}`,
      rich: false,
      zoom: ctx.page.scale,
    })
    return { html }
  } finally {
    bodyHost.remove()
    styleHost.remove()
  }
}

/** docx-preview 产物在打印场景下的补偿样式 */
const DOCX_PRINT_CSS = `
/* 去掉屏幕上的页面阴影 / 灰底 / 固定高度，交给浏览器按纸张分页 */
section.docx {
  box-shadow: none !important;
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  min-height: 0 !important;
  height: auto !important;
  background: #fff !important;
  overflow: visible !important;
  break-after: page;
  page-break-after: always;
}
section.docx:last-child { break-after: auto; page-break-after: auto; }
section.docx table { max-width: 100%; }
section.docx img { max-width: 100% !important; height: auto !important; }
/* 页眉页脚不再固定定位 */
section.docx header, section.docx footer { position: static !important; }
`

// ============================================================
// 离屏渲染与清理
// ============================================================

/**
 * 创建离屏渲染容器。
 *
 * 必须真实参与布局（不能用 display:none），否则 Mermaid / Chart 取不到正确尺寸；
 * 因此用负偏移把它移出可视区。
 */
function createOffscreenHost(widthPx: number): HTMLElement {
  const host = document.createElement('div')
  host.className = 'markdown-body'
  host.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${widthPx}px;background:#fff;z-index:-1;`
  return host
}

/** 等待容器内所有图片加载完成（含远程图） */
async function waitImagesLoaded(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve()
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
          // 兜底：远程图挂起时最多等 8 秒，避免导出卡死
          setTimeout(resolve, 8000)
        }),
    ),
  )
}

/**
 * 清理只在交互界面有意义的装饰：
 * - 代码块复制 / 下载按钮、图表工具条（打印出来是黑块）
 * - 同步滚动用的 data-line 标记
 */
function cleanupForPrint(host: HTMLElement): void {
  host
    .querySelectorAll('.code-actions, .code-block-header button, .diagram-header, .diagram-actions')
    .forEach((el) => el.remove())
  host.querySelectorAll('[data-line]').forEach((el) => el.removeAttribute('data-line'))
  // 任务列表复选框：去掉 disabled 以便保留勾选态的视觉差异
  host.querySelectorAll('input[type="checkbox"]').forEach((el) => el.removeAttribute('disabled'))
}

/**
 * 把图片 src 统一换成 mdlocal:// 绝对路径。
 *
 * 打印窗口加载的是临时 HTML 文件，相对路径会解析到临时目录，必须按源文件目录补全。
 */
function absolutizeImages(host: HTMLElement, baseDir: string, warnings: string[]): void {
  let missing = 0
  host.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim()
    if (!src) {
      missing++
      return
    }
    if (/^(data:|https?:|mdlocal:|blob:)/i.test(src)) return

    let decoded = src
    try {
      decoded = decodeURIComponent(src)
    } catch {
      decoded = src
    }
    const isAbsolute = /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(decoded)
    if (!isAbsolute && !baseDir) {
      missing++
      return
    }
    const abs = isAbsolute ? decoded : joinPath(baseDir, decoded)
    img.setAttribute('src', toMdLocalUrl(abs))
  })
  if (missing) {
    warnings.push(`${missing} 张图片路径无法解析，PDF 中可能缺失`)
  }
}

// ============================================================
// 本地二进制读取
// ============================================================

/** 读本地文件二进制（桌面端走 IPC；浏览器环境返回 null） */
async function readLocalBinary(filePath: string): Promise<Uint8Array | null> {
  if (!window.mdAPI?.readBinary) return null
  const res = await window.mdAPI.readBinary(filePath)
  return res?.ok && res.data ? res.data : null
}

// ============================================================
// KaTeX 字体内联
// ============================================================

/** 缓存内联后的 KaTeX CSS（约 20 个字体，只处理一次） */
let katexInlinePromise: Promise<string> | null = null

/** 获取内联字体后的 KaTeX CSS（失败时返回原始 CSS，公式退化为系统字体） */
function getInlinedKatexCss(): Promise<string> {
  if (!katexInlinePromise) {
    katexInlinePromise = inlineCssUrls(katexCss).catch(() => katexCss)
  }
  return katexInlinePromise
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/** 把 CSS 中所有 url() 指向的字体/图片转成 data URL（取不到则保留原值） */
async function inlineCssUrls(css: string): Promise<string> {
  const urls = new Set<string>()
  css.replace(CSS_URL_RE, (match, _quote, url: string) => {
    if (url && !url.startsWith('data:')) urls.add(url)
    return match
  })
  if (!urls.size) return css

  const resolved = new Map<string, string>()
  await Promise.all(
    Array.from(urls).map(async (url) => {
      const dataUrl = await toDataUrl(url)
      if (dataUrl) resolved.set(url, dataUrl)
    }),
  )
  if (!resolved.size) return css

  return css.replace(CSS_URL_RE, (match, _quote, url: string) =>
    resolved.has(url) ? `url("${resolved.get(url)}")` : match,
  )
}

/** 把一个资源地址读成 data URL（支持 http(s)、file://、应用内相对路径） */
async function toDataUrl(rawUrl: string): Promise<string | null> {
  try {
    const abs = new URL(rawUrl, document.baseURI).href
    const bytes = await readBinaryByUrl(abs)
    if (!bytes || !bytes.length) return null
    return `data:${guessMimeType(abs)};base64,${bytesToBase64(bytes)}`
  } catch {
    return null
  }
}

/** 按 URL 形态读取二进制：file:// 走主进程 IPC，其余走 fetch */
async function readBinaryByUrl(absUrl: string): Promise<Uint8Array | null> {
  if (absUrl.startsWith('file:')) {
    const filePath = fileUrlToPath(absUrl)
    if (!filePath) return null
    return readLocalBinary(filePath)
  }
  const resp = await fetch(absUrl)
  if (!resp.ok) return null
  return new Uint8Array(await resp.arrayBuffer())
}

/** file:// URL → 本地路径（Windows 去掉盘符前的斜杠） */
function fileUrlToPath(absUrl: string): string {
  try {
    let p = decodeURIComponent(new URL(absUrl).pathname)
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p
  } catch {
    return ''
  }
}

/** 依据扩展名猜 MIME（字体为主） */
function guessMimeType(url: string): string {
  const clean = url.split('#')[0].split('?')[0]
  const ext = (clean.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'woff2':
      return 'font/woff2'
    case 'woff':
      return 'font/woff'
    case 'ttf':
      return 'font/ttf'
    case 'otf':
      return 'font/otf'
    case 'eot':
      return 'application/vnd.ms-fontobject'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

/** 二进制转 base64（分块避免超长参数栈溢出） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// ============================================================
// HTML 组装
// ============================================================

interface ComposeOptions {
  title: string
  fontFamily?: string
  codeTheme?: string
  /** 追加的样式（扩展样式 / KaTeX / docx 样式） */
  extraCss?: string
  /** 是否启用 Markdown 富文本排版（docx / 纯文本不需要，避免覆盖其自身样式） */
  rich?: boolean
  /** 内容缩放 */
  zoom?: number
}

/** 所有 html 模式共用的基础样式：白底、纸张内边距为 0、分页规则 */
const BASE_PRINT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff !important; }
body {
  color: #303133;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  word-wrap: break-word;
}
img { max-width: 100% !important; height: auto; }
svg { max-width: 100%; height: auto; }
figure { margin: 16px 0; text-align: center; }
figure svg, figure img { max-width: 100%; }
/* 标题不落页尾 */
h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
/* 表格：长表跨页并重复表头，单行不被拦腰截断 */
table { border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
/* 整块内容尽量不拆页 */
blockquote, figure, .mermaid, .chart-container, .frontmatter-card { break-inside: avoid; page-break-inside: avoid; }
::-webkit-scrollbar { display: none; }
`

/** Markdown 富文本排版样式 */
const RICH_PRINT_CSS = `
body { font-size: 15px; line-height: 1.75; }
.markdown-body > :first-child { margin-top: 0 !important; }
.markdown-body > :last-child { margin-bottom: 0 !important; }
h1, h2, h3, h4, h5, h6 { break-inside: avoid; line-height: 1.35; }
h1 { font-size: 26px; margin: 22px 0 14px; }
h2 { font-size: 22px; margin: 20px 0 12px; }
h3 { font-size: 18px; margin: 18px 0 10px; }
h4 { font-size: 16px; margin: 16px 0 8px; }
h5, h6 { font-size: 15px; margin: 14px 0 8px; }
p { margin: 0 0 12px; }
ul, ol { margin: 0 0 12px; padding-left: 26px; }
li { margin: 4px 0; }
li > p { margin: 0; }
a { color: #0563c1; text-decoration: underline; word-break: break-all; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 20px 0; }
table { width: 100%; margin: 14px 0; font-size: 14px; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
pre {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: 6px;
  font-family: Consolas, "Courier New", Monaco, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  /* 超长代码整块 avoid 会被推出页面，允许跨页 */
  break-inside: auto;
  page-break-inside: auto;
}
pre code { background: none !important; padding: 0 !important; font-size: inherit; }
code {
  font-family: Consolas, "Courier New", Monaco, monospace;
  font-size: 0.92em;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f6f8fa;
}
.code-block-wrapper { margin: 12px 0; break-inside: auto; }
.code-block-wrapper pre { margin: 0; }
blockquote {
  margin: 14px 0;
  padding: 8px 14px;
  border-left: 4px solid #dfe2e5;
  background: #f8f9fa;
  color: #606266;
}
blockquote > :last-child { margin-bottom: 0; }
li.task-list-item, .task-list-item { list-style: none; margin-left: -20px; }
input[type="checkbox"] { margin-right: 6px; }
.math-block, .katex-display { break-inside: avoid; text-align: center; margin: 14px 0; }
figcaption { margin-top: 6px; color: #909399; font-size: 12px; }
`

/** 拼装完整 HTML 文档 */
function composeHtml(bodyHtml: string, opts: ComposeOptions): string {
  const theme =
    CODE_THEMES.find((t) => t.name === opts.codeTheme) ||
    CODE_THEMES.find((t) => t.name === DEFAULT_CODE_THEME) ||
    CODE_THEMES[0]
  const themeVars = Object.entries(theme?.vars || {})
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
  const fontStack =
    opts.fontFamily ||
    '"Microsoft YaHei", "微软雅黑", "PingFang SC", "Segoe UI", Arial, sans-serif'
  const zoom = opts.zoom && opts.zoom !== 1 ? `\nbody { zoom: ${opts.zoom}; }` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(opts.title)}</title>
<style>
:root {
  ${themeVars}
}
${BASE_PRINT_CSS}
${opts.rich || opts.fontFamily ? `body { font-family: ${fontStack}; }` : ''}
${opts.rich ? `${RICH_PRINT_CSS}\n${theme?.css || ''}` : ''}
${opts.extraCss || ''}${zoom}
</style>
</head>
<body class="markdown-body">
${bodyHtml}
</body>
</html>`
}

/** HTML 转义 */
function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
