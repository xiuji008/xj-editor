/**
 * Markdown → Word（.docx）导出
 *
 * 思路：复用编辑器现有的渲染管线（renderMarkdown + enhanceRenderedDom）把 Markdown
 * 渲染成富 HTML，再做一层「规范化」把自定义结构摊平为语义化的 HTML + 行内样式，
 * 最后交给 docx 库的 htmlToContent 转成 Word 原生段落 / 表格。
 *
 * 全流程在本地渲染进程完成（图表由 DOM 直接编码为图片），主进程只负责落盘，
 * 因此不需要联网，也不会把文档内容发往任何服务。
 *
 * @module utils/docxExport
 */

import {
  renderMarkdown,
  enhanceRenderedDom,
  getMarkdownExtensionStyles,
  applyCodeTheme,
  setMathOutputMode,
  CODE_THEMES,
  DEFAULT_CODE_THEME,
} from './markdown'
import { joinPath, fromMdLocalUrl } from './fileUtils'

/** 导出选项 */
export interface DocxExportOptions {
  /** Markdown 源码 */
  markdown: string
  /** 当前文件名（增强渲染时用于图表相关命名） */
  baseName?: string
  /** 当前文件所在目录，用于解析文档中的相对图片路径 */
  baseDir?: string
  /** 代码高亮主题名（缺省用默认主题） */
  codeTheme?: string
  /** 进度提示回调 */
  onProgress?: (text: string) => void
}

/** 导出结果 */
export interface DocxExportResult {
  /** docx 文件字节 */
  data: Uint8Array
  /** 降级 / 跳过项说明（导出后提示用户） */
  warnings: string[]
}

/** 一张待嵌入图片（Word 不支持时用 fallback） */
interface DocxAsset {
  data: Uint8Array
  fallback?: Uint8Array
}

/** 图片收集上下文 */
interface CollectContext {
  baseDir: string
  assets: Map<string, DocxAsset>
  warnings: string[]
}

/** A4 纸张尺寸（twips） */
const A4_WIDTH = 11906
const A4_HEIGHT = 16838
/** 页边距（twips，1440 = 1 英寸） */
const PAGE_MARGIN = 1440
/** 正文宽度对应的图片最大宽度（px，docx/html 默认值，正好是 A4 正文宽度） */
const MAX_IMAGE_WIDTH = 601
/** 嵌入图片的降采样上限宽度（px，避免 docx 体积过大） */
const IMAGE_DOWNSCALE_WIDTH = 1600

/** Front Matter 字段中文名（未收录的字段直接显示原 key） */
const FRONT_MATTER_LABELS: Record<string, string> = {
  title: '标题',
  emoji: '表情',
  description: '描述',
  keywords: '关键词',
  tags: '标签',
  category: '分类',
  series: '系列',
  author: '作者',
  status: '状态',
  createDate: '创建时间',
  lastUpdateDate: '更新时间',
}

/** GitHub 提示块配色（左边框 / 背景 / 标题色） */
const ALERT_COLORS: Record<string, { border: string; bg: string; title: string }> = {
  note: { border: '#409eff', bg: '#ecf5ff', title: '#409eff' },
  tip: { border: '#67c23a', bg: '#f0f9eb', title: '#67c23a' },
  important: { border: '#8e5cf7', bg: '#f4f0ff', title: '#8e5cf7' },
  warning: { border: '#e6a23c', bg: '#fdf6ec', title: '#e6a23c' },
  caution: { border: '#f56c6c', bg: '#fef0f0', title: '#f56c6c' },
}

// ============================================================
// 入口
// ============================================================

/**
 * 将 Markdown 导出为 docx 字节。
 *
 * 流程：离屏渲染 → 图表/图片编码 → HTML 规范化 → htmlToContent → Packer 打包。
 * 任何一步的局部失败都会降级（占位文本 / 跳过图片）并记入 warnings，不抛出。
 */
export async function exportMarkdownToDocx(opts: DocxExportOptions): Promise<DocxExportResult> {
  const warnings: string[] = []
  const host = createOffscreenHost()
  const prevMathMode = setMathOutputMode('htmlAndMathml')
  try {
    applyCodeTheme(opts.codeTheme || DEFAULT_CODE_THEME)
    ensurePreviewStyles()

    host.innerHTML = renderMarkdown(opts.markdown || '')
    document.body.appendChild(host)

    opts.onProgress?.('正在渲染图表…')
    await enhanceRenderedDom(host, opts.baseName)
    await waitImagesLoaded(host)

    opts.onProgress?.('正在处理图片…')
    const ctx: CollectContext = {
      baseDir: opts.baseDir || '',
      assets: new Map(),
      warnings,
    }
    await normalizeForDocx(host, opts.markdown || '', ctx)

    opts.onProgress?.('正在生成文档…')
    // 动态引入 docx（约数百 KB），避免拖慢首屏；Vite 会自动切成独立异步块
    const [{ Document, Packer }, { htmlToContent }] = await Promise.all([
      import('docx'),
      import('docx/html'),
    ])
    const html = host.innerHTML
    const content = htmlToContent(html, {
      stylesheet: buildStylesheet(opts.codeTheme),
      maxImageWidth: MAX_IMAGE_WIDTH,
      images: (source: string) => ctx.assets.get(source),
      onWarning: (w) => {
        if (!warnings.includes(w.message)) warnings.push(w.message)
      },
    })

    const doc = new Document({
      creator: 'XJ-Editor',
      title: (opts.baseName || '').replace(/\.(md|markdown)$/i, '') || 'Markdown 文档',
      styles: {
        default: {
          document: {
            run: { font: '微软雅黑', size: 21 },
            paragraph: { spacing: { line: 300 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: A4_WIDTH, height: A4_HEIGHT },
              margin: {
                top: PAGE_MARGIN,
                right: PAGE_MARGIN,
                bottom: PAGE_MARGIN,
                left: PAGE_MARGIN,
              },
            },
          },
          children: [...content],
        },
      ],
    })

    const blob = await Packer.toBlob(doc)
    return { data: new Uint8Array(await blob.arrayBuffer()), warnings }
  } finally {
    setMathOutputMode(prevMathMode)
    host.remove()
  }
}

// ============================================================
// 离屏渲染
// ============================================================

/**
 * 创建离屏渲染容器。
 *
 * 必须真实参与布局（不能用 display:none），否则 getComputedStyle 取不到正确值、
 * canvas / SVG 尺寸也会异常；因此用负偏移把它移出可视区。
 */
function createOffscreenHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'markdown-body'
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:820px;background:#fff;'
  return host
}

/** 确保扩展样式已注入文档（源码模式下预览组件可能尚未注入） */
function ensurePreviewStyles(): void {
  if (document.getElementById('md-docx-export-styles')) return
  const style = document.createElement('style')
  style.id = 'md-docx-export-styles'
  style.textContent = getMarkdownExtensionStyles()
  document.head.appendChild(style)
}

/** 等待容器内所有图片加载完成（含 PlantUML 这类懒加载图片） */
async function waitImagesLoaded(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve()
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        }),
    ),
  )
}

// ============================================================
// HTML 规范化
// ============================================================

/**
 * 把预览 DOM 摊平为「语义化 HTML + 行内样式」，并把图片字节收集进 ctx.assets。
 *
 * 之所以必须摊平：htmlToContent 只认识标准 HTML 语义与 CSS，
 * 而我们预览里的提示块、代码块外框、图表容器都是自定义结构。
 */
async function normalizeForDocx(
  host: HTMLElement,
  markdown: string,
  ctx: CollectContext,
): Promise<void> {
  // 1. Front Matter：改用源码解析生成元信息表格（比读渲染后的卡片结构更稳）
  replaceFrontMatter(host, markdown)

  // 2. 公式：取 KaTeX 的 MathML 输出，交给 htmlToContent 转成 Word 原生公式
  normalizeMath(host, ctx)

  // 3. 代码块：丢掉语言标签栏 / 复制下载按钮，把主题配色写成行内样式
  normalizeCodeBlocks(host)

  // 4. GitHub 提示块 → 带左边框与底纹的引用块
  normalizeAlerts(host)

  // 5. 图表：Mermaid（内联 SVG）与 Chart.js（canvas）编码为图片
  await normalizeDiagrams(host, ctx)

  // 6. 图片图文：figure + figcaption → 图 + 居中灰色图注
  normalizeFigures(host)

  // 7. 清理装饰节点与辅助属性
  cleanupNodes(host)

  // 8. 统一收集所有 <img> 的字节（同步回调前必须先把字节取齐）
  await collectImageBytes(host, ctx)
}

/** Front Matter 卡片 → 元信息表格（从源码重新解析，避免依赖渲染结构） */
function replaceFrontMatter(host: HTMLElement, markdown: string): void {
  host.querySelectorAll('.frontmatter-card').forEach((el) => el.remove())
  const rows = parseFrontMatter(markdown)
  if (!rows.length) return
  const table = document.createElement('table')
  table.innerHTML =
    `<tr><th>字段</th><th>值</th></tr>` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td>${escapeHtml(FRONT_MATTER_LABELS[k] || k)}</td><td>${escapeHtml(v)}</td></tr>`,
      )
      .join('')
  table.style.cssText = 'border-collapse:collapse;width:100%;'
  host.insertBefore(table, host.firstChild)
}

/** 解析文档头部的 YAML Front Matter（只取顶层 key: value，忽略数组与嵌套） */
function parseFrontMatter(markdown: string): Array<[string, string]> {
  const text = (markdown || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!/^---\s*\n/.test(text)) return []
  const end = text.indexOf('\n---', 3)
  if (end === -1) return []
  const block = text.slice(4, end)
  const rows: Array<[string, string]> = []
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim())
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (!value) continue
    rows.push([m[1], value])
  }
  return rows
}

/**
 * 公式处理：优先把 KaTeX 输出的 MathML 交给 htmlToContent，转成 Word 原生公式
 * （实测可落地为 m:oMath，在 Word 中可编辑）；MathML 缺失时才降级为 LaTeX 源码文本。
 */
function normalizeMath(host: HTMLElement, ctx: CollectContext): void {
  const NS = 'http://www.w3.org/1998/Math/MathML'
  let failed = 0
  // 块级公式：居中独占一段
  host.querySelectorAll('.math-block').forEach((el) => {
    const p = document.createElement('p')
    p.style.textAlign = 'center'
    const math = el.querySelector('math')
    if (math) {
      math.setAttribute('xmlns', NS)
      p.appendChild(math.cloneNode(true))
    } else {
      const tex = extractLatex(el)
      p.textContent = tex ? `$$${tex}$$` : '[公式]'
      failed++
    }
    el.replaceWith(p)
  })
  // 行内公式：只保留 MathML，丢掉 KaTeX 的 HTML 排版部分
  host.querySelectorAll('.katex').forEach((el) => {
    if (el.closest('.math-block')) return
    const math = el.querySelector('math')
    if (math) {
      math.setAttribute('xmlns', NS)
      el.replaceWith(math.cloneNode(true))
      return
    }
    const tex = extractLatex(el)
    const span = document.createElement('span')
    span.textContent = tex ? `$${tex}$` : '[公式]'
    el.replaceWith(span)
    failed++
  })
  if (failed) ctx.warnings.push(`${failed} 处公式降级为 LaTeX 源码（未取到 MathML）`)
}

/** 从 KaTeX 渲染结果里取回 LaTeX 源码 */
function extractLatex(el: Element): string {
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
  const tex = annotation?.textContent?.trim()
  return tex || ''
}

/**
 * 代码块规范化：删除语言标签栏与按钮，把主题配色写成行内样式。
 *
 * 直接用 getComputedStyle 读已渲染的颜色，避免让 htmlToContent 解析 CSS 变量。
 */
function normalizeCodeBlocks(host: HTMLElement): void {
  host.querySelectorAll('.code-block-header').forEach((el) => el.remove())
  host.querySelectorAll('.code-block-wrapper').forEach((wrapper) => {
    const pre = wrapper.querySelector('pre')
    if (!pre) return
    const cs = getComputedStyle(pre)
    const bg = normalizeColor(cs.backgroundColor)
    const fg = normalizeColor(cs.color)
    const font = /consolas|monaco|menlo|courier|source code/i.test(cs.fontFamily)
      ? cs.fontFamily
      : 'Consolas, "Courier New", monospace'
    pre.style.cssText = `background:${bg === 'transparent' ? '#f6f8fa' : bg};color:${fg};` +
      `font-family:${font};font-size:13px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;`
    // hljs token 颜色 → 行内样式
    pre.querySelectorAll('span[class*="hljs-"]').forEach((span) => {
      const color = normalizeColor(getComputedStyle(span as HTMLElement).color)
      if (color && color !== fg) (span as HTMLElement).style.color = color
    })
    wrapper.replaceWith(pre)
  })
}

/** GitHub 提示块 → 带左边框与底纹的 blockquote */
function normalizeAlerts(host: HTMLElement): void {
  host.querySelectorAll('.github-alert').forEach((el) => {
    const kind = Array.from(el.classList)
      .map((c) => /^alert-(.+)$/.exec(c)?.[1] || '')
      .filter(Boolean)[0] || 'note'
    const color = ALERT_COLORS[kind] || ALERT_COLORS.note
    const quote = document.createElement('blockquote')
    quote.style.cssText =
      `border-left:4px solid ${color.border};background:${color.bg};padding:8px 12px;margin:12px 0;`
    const header = el.querySelector('.alert-header')
    if (header) {
      const title = document.createElement('p')
      title.textContent = (header.querySelector('.alert-label')?.textContent || header.textContent || kind).trim()
      title.style.cssText = `color:${color.title};font-weight:bold;margin:0 0 4px 0;`
      quote.appendChild(title)
    }
    const body = el.querySelector('.alert-body')
    if (body) {
      Array.from(body.childNodes).forEach((node) => quote.appendChild(node.cloneNode(true)))
    } else {
      Array.from(el.childNodes)
        .filter((n) => n !== header)
        .forEach((node) => quote.appendChild(node.cloneNode(true)))
    }
    el.replaceWith(quote)
  })
}

/** Mermaid（SVG）与 Chart.js（canvas）编码为图片并替换为 <img> */
async function normalizeDiagrams(host: HTMLElement, ctx: CollectContext): Promise<void> {
  // Mermaid：enhanceRenderedDom 后 div.mermaid 内含内联 <svg>
  for (const container of Array.from(host.querySelectorAll('.mermaid'))) {
    const svg = container.querySelector('svg')
    if (!svg) continue
    const svgBytes = await svgToBytes(svg as SVGSVGElement)
    const pngBytes = await svgToPngBytes(svg as SVGSVGElement)
    const img = document.createElement('img')
    if (svgBytes || pngBytes) {
      img.src = registerAsset(ctx, svgBytes, pngBytes)
    } else {
      img.remove()
      ctx.warnings.push('有 1 个 Mermaid 图表未能转换为图片')
      continue
    }
    container.replaceWith(img)
  }

  // Chart.js：canvas 直接导出 PNG
  for (const canvas of Array.from(host.querySelectorAll<HTMLCanvasElement>('canvas[data-chart-config]'))) {
    try {
      const bytes = await canvasToPngBytes(canvas)
      const img = document.createElement('img')
      img.src = registerAsset(ctx, bytes)
      canvas.replaceWith(img)
    } catch {
      ctx.warnings.push('有 1 个 Chart 图表未能转换为图片')
    }
  }

  // PlantUML 转为图片后，容器里剩下的头部等装饰统一交给 cleanup 处理
  host.querySelectorAll('.plantuml-container').forEach((el) => {
    const img = el.querySelector('img')
    if (img) el.replaceWith(img)
  })
}

/** figure + figcaption → 图 + 居中灰色图注 */
function normalizeFigures(host: HTMLElement): void {
  host.querySelectorAll('figure').forEach((fig) => {
    const img = fig.querySelector('img')
    const caption = fig.querySelector('figcaption')
    const frag = document.createDocumentFragment()
    if (img) {
      const p = document.createElement('p')
      p.style.textAlign = 'center'
      p.appendChild(img)
      frag.appendChild(p)
    }
    if (caption?.textContent?.trim()) {
      const p = document.createElement('p')
      p.style.cssText = 'text-align:center;color:#909399;font-size:12px;'
      const em = document.createElement('em')
      em.textContent = caption.textContent.trim()
      p.appendChild(em)
      frag.appendChild(p)
    }
    fig.replaceWith(frag)
  })
}

/** 清理装饰节点与辅助属性 */
function cleanupNodes(host: HTMLElement): void {
  // 图表头部（含源码复制按钮）在 Word 中没有意义
  host.querySelectorAll('.diagram-header').forEach((el) => el.remove())
  // 同步滚动用的行号标记
  host.querySelectorAll('[data-line]').forEach((el) => el.removeAttribute('data-line'))
  // 任务列表复选框的 disabled 不影响 htmlToContent 读取勾选态，保留 input 本身
  host.querySelectorAll('input[type="checkbox"]').forEach((el) => el.removeAttribute('disabled'))
  // 代码块工具条残留
  host.querySelectorAll('.code-actions').forEach((el) => el.remove())
}

// ============================================================
// 图片字节
// ============================================================

/** 遍历所有 <img>，把字节取齐并把 src 换成 docx-asset://N */
async function collectImageBytes(host: HTMLElement, ctx: CollectContext): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'))
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    if (!src) {
      img.remove()
      continue
    }
    // 图表（Mermaid / Chart）已在上一阶段编码并换成本内部地址，字节已在 assets 里
    if (src.startsWith('docx-asset://')) continue
    try {
      const bytes = await resolveImageBytes(src, ctx.baseDir)
      if (!bytes) {
        replaceWithPlaceholder(img, src)
        ctx.warnings.push(`图片未嵌入：${shorten(src)}`)
        continue
      }
      const asset = await buildAsset(bytes)
      if (!asset) {
        replaceWithPlaceholder(img, src)
        ctx.warnings.push(`图片格式不支持：${shorten(src)}`)
        continue
      }
      img.setAttribute('src', registerAsset(ctx, asset.data, asset.fallback))
      // 保留 alt，图片缺失时 Word 会显示它
      if (!img.getAttribute('alt')) img.setAttribute('alt', '')
    } catch {
      replaceWithPlaceholder(img, src)
      ctx.warnings.push(`图片未嵌入：${shorten(src)}`)
    }
  }
}

/** 按 src 形态取字节：data: 直接解码；mdlocal/相对/绝对走主进程读文件；http(s) 走主进程下载 */
async function resolveImageBytes(src: string, baseDir: string): Promise<Uint8Array | null> {
  if (/^data:/i.test(src)) {
    const m = /^data:[^;]*;base64,(.*)$/i.exec(src)
    if (!m) return null
    const bin = atob(m[1])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  const localPath = fromMdLocalUrl(src)
  if (localPath) return readLocalFile(localPath)

  if (/^https?:\/\//i.test(src)) {
    if (!window.mdAPI?.fetchBinary) return null
    const res = await window.mdAPI.fetchBinary({ url: src, timeout: 10000 })
    return res.ok && res.data ? res.data : null
  }

  // 相对路径（可能经过 URL 编码）或绝对路径
  let decoded = src
  try {
    decoded = decodeURIComponent(src)
  } catch {
    decoded = src
  }
  const abs = /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(decoded) || !baseDir ? decoded : joinPath(baseDir, decoded)
  return readLocalFile(abs)
}

/** 读本地文件二进制 */
async function readLocalFile(filePath: string): Promise<Uint8Array | null> {
  if (!window.mdAPI?.readBinary) return null
  const res = await window.mdAPI.readBinary(filePath)
  return res.ok && res.data ? res.data : null
}

/**
 * 生成可嵌入的资源：
 * - SVG：同时提供 PNG 兜底（Word 2016+ 直接显示 SVG，旧版用 PNG）
 * - WebP / AVIF 等 Word 不支持的格式：转成 PNG
 * - 超大图：等比降采样，控制 docx 体积
 */
async function buildAsset(bytes: Uint8Array): Promise<DocxAsset | null> {
  const kind = detectImageKind(bytes)
  if (kind === 'svg') {
    const png = await rasterizeBytes(bytes, 'image/svg+xml')
    return { data: bytes, fallback: png || undefined }
  }
  if (kind === 'webp' || kind === 'avif' || kind === 'ico') {
    const png = await rasterizeBytes(bytes, kind === 'ico' ? 'image/x-icon' : `image/${kind}`)
    return png ? { data: png } : null
  }
  if (kind === 'unknown') return null
  return { data: bytes }
}

/** 用浏览器把图片（含 SVG / WebP / AVIF）栅格化为 PNG 字节 */
async function rasterizeBytes(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await loadImage(img, url)
    const scale = Math.min(1, IMAGE_DOWNSCALE_WIDTH / Math.max(1, img.naturalWidth))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await canvasToPngBytes(canvas)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** SVG 元素 → SVG 字节 */
function svgToBytes(svg: SVGSVGElement): Uint8Array | null {
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const box = measureSvg(svg)
    clone.setAttribute('width', String(box.width))
    clone.setAttribute('height', String(box.height))
    const xml = new XMLSerializer().serializeToString(clone)
    return new TextEncoder().encode(xml)
  } catch {
    return null
  }
}

/** SVG 元素 → PNG 字节（作为 Word 的兜底位图） */
async function svgToPngBytes(svg: SVGSVGElement): Promise<Uint8Array | null> {
  const bytes = svgToBytes(svg)
  if (!bytes) return null
  return rasterizeBytes(bytes, 'image/svg+xml')
}

/** 估算 SVG 的像素尺寸（mermaid 常把 width 写成 100%，此时用布局尺寸 / viewBox） */
function measureSvg(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number)
  const width = Math.round(rect.width || svg.clientWidth || vb[2] || 800)
  const height = Math.round(rect.height || svg.clientHeight || vb[3] || 600)
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

/** canvas → PNG 字节 */
function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas 转 PNG 失败'))
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    }, 'image/png')
  })
}

function loadImage(img: HTMLImageElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

/** 注册一张图片资源，返回供 <img src> 使用的内部地址 */
function registerAsset(ctx: CollectContext, data: Uint8Array, fallback?: Uint8Array): string {
  const key = `docx-asset://${ctx.assets.size + 1}`
  ctx.assets.set(key, fallback ? { data, fallback } : { data })
  return key
}

/** 图片取不到时替换为占位段落 */
function replaceWithPlaceholder(img: HTMLImageElement, src: string): void {
  const p = document.createElement('p')
  p.textContent = `[图片未嵌入: ${shorten(src)}]`
  p.style.cssText = 'color:#909399;font-size:12px;'
  img.replaceWith(p)
}

/** 探测图片格式（Word 原生支持 png/jpg/gif/bmp/svg，webp/avif/ico 需转换） */
function detectImageKind(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'bmp' | 'svg' | 'webp' | 'avif' | 'ico' | 'unknown' {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 6 && (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) return 'gif'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp'
  if (bytes.length >= 5 && bytes.slice(4, 8).join(',') === '102,116,121,112') return 'avif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp'
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'ico'
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512))
  if (/<svg[\s>]/i.test(head) || /^<\?xml/i.test(head)) return 'svg'
  return 'unknown'
}

// ============================================================
// 样式
// ============================================================

/** 拼装传给 htmlToContent 的样式表（扩展样式 + 当前代码主题） */
function buildStylesheet(codeTheme?: string): string {
  const theme = CODE_THEMES.find((t) => t.name === codeTheme) || CODE_THEMES[0]
  const vars = Object.entries(theme.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
  return `
:root { ${vars} }
.markdown-body {
  font-family: "微软雅黑", "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.8;
  color: #303133;
}
blockquote { border-left: 4px solid #dfe2e5; padding: 4px 12px; color: #606266; background: #f8f9fa; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
th { background: #f6f8fa; font-weight: bold; }
code { font-family: Consolas, "Courier New", monospace; }
a { color: #0563c1; }
hr { border: none; border-top: 1px solid #dfe2e5; }
${getMarkdownExtensionStyles()}
${theme.css}
`
}

// ============================================================
// 小工具
// ============================================================

/** rgb() / rgba() → #rrggbb，无法解析时原样返回 */
function normalizeColor(color: string): string {
  const m = /^rgba?\(([^)]+)\)$/i.exec((color || '').trim())
  if (!m) return color || ''
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  const hex = parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 截断过长的图片地址，避免提示信息被撑爆 */
function shorten(src: string): string {
  const text = src.length > 60 ? `${src.slice(0, 30)}…${src.slice(-20)}` : src
  return text
}
