/**
 * 富文本复制管线：把当前 Markdown 渲染结果整理成「可直接粘贴到公众号 / 知乎 / 掘金」的 HTML。
 *
 * 处理顺序（对齐 markdown-nice 的方案）：
 * 1. 取内容：优先克隆预览区已渲染的 DOM（图表已渲染、代码已高亮、图片已换成 mdlocal 绝对路径），
 *    克隆后 canvas 会被替换成 PNG，避免复制后图表空白；
 * 2. 清理装饰：代码块语言栏 / 复制下载按钮 / 图表工具条 / 同步滚动标记 / 任务列表 checkbox；
 * 3. 内联样式：CSS 变量先解析成字面值，再用 juice.inlineContent 压成 style 属性
 *    （选择器优先级、::before/::after 转真实元素、!important 保留都由 juice 处理）；
 * 4. 平台处理：公众号/知乎直接用；掘金对 pre 块做换行修正（solveJuejinCode）。
 *
 * 长图 PNG 复用同一条管线，交给 html-to-image 截图。
 */

import juice from 'juice'
import {
  CODE_THEMES,
  DEFAULT_CODE_THEME,
  getMarkdownExtensionStyles,
  renderMarkdown,
} from './markdown'
import {
  COPY_BASE_CSS,
  COPY_FINAL_CSS,
  getCopyTheme,
  ZHIHU_NEUTRAL_CSS,
  type CopyTheme,
} from './copyThemes'
import { resolveCssVars } from './cssInline'
import { copyImageBlob, copyPlainText, copyRichHtml } from './clipboardCopy'

/** 复制目标平台 */
export type CopyPlatform = 'wechat' | 'zhihu' | 'juejin' | 'html'

/** 各平台的正文宽度（微信正文区上限约 677px） */
const PLATFORM_WIDTH: Record<CopyPlatform, number> = {
  wechat: 677,
  zhihu: 700,
  juejin: 700,
  html: 677,
}

/** 长图导出宽度 */
const LONG_IMAGE_WIDTH = 750

export interface CopyBuildOptions {
  /** Markdown 源码（作为纯文本兜底与掘金格式） */
  markdown: string
  platform: CopyPlatform
  /** 主题 key（copyThemes.ts） */
  themeKey?: string
  /** 当前代码高亮主题名 */
  codeTheme?: string
  /** 当前文档名（代码块按钮的默认文件名，仅克隆路径无关） */
  fileName?: string
  /** 预览容器（.preview-zoom-inner）；有则克隆已渲染结果，避免重复渲染图表 */
  sourceEl?: HTMLElement | null
}

export interface CopyPayload {
  html: string
  /** 纯文本兜底（Markdown 源码） */
  text: string
  theme: CopyTheme
  warnings: string[]
}

/** 需要从复制结果里移除的交互装饰 */
const DECORATION_SELECTORS = [
  '.code-block-header',
  '.code-actions',
  '.code-copy-btn',
  '.code-download-btn',
  '.diagram-header',
  '.diagram-actions',
  '.paste-loading',
  '.preview-find-bar',
  'script',
  'style',
  'link',
  'iframe',
].join(',')

/** Blob → dataURL（保存兜底用） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片数据失败'))
    reader.readAsDataURL(blob)
  })
}

/** 离屏舞台（可见排版但移出视口，宽度决定换行与图表尺寸） */
interface Staged {
  stage: HTMLElement
  root: HTMLElement
  theme: CopyTheme
  warnings: string[]
}

/** 准备内容 + 内联样式，返回仍在 DOM 中的舞台（调用方负责 remove） */
async function stageContent(opts: CopyBuildOptions): Promise<Staged> {
  const theme = getCopyTheme(opts.themeKey)
  const platform = opts.platform
  const width = PLATFORM_WIDTH[platform] || 677
  const warnings: string[] = []

  const stage = document.createElement('div')
  stage.className = 'md-copy-stage'
  stage.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${width}px`,
    `background:${theme.background}`,
    'z-index:-1',
    'pointer-events:none',
  ].join(';')

  const root = document.createElement('section')
  root.id = 'md-root'
  stage.appendChild(root)
  document.body.appendChild(stage)

  fillContent(root, opts, warnings)
  sanitizeForCopy(root, warnings)

  return { stage, root, theme, warnings }
}

/** 取内容：优先克隆预览 DOM，绝不重新渲染（重渲染会卸载预览里的白板嵌入） */
function fillContent(root: HTMLElement, opts: CopyBuildOptions, warnings: string[]): void {
  const preview = opts.sourceEl
  const hasPreviewContent = !!preview && preview.children.length > 0

  if (hasPreviewContent) {
    root.innerHTML = preview!.innerHTML
    mirrorCanvas(preview!, root)
    return
  }

  // 兜底：预览区还没渲染（如空文档）时用 marked 快速渲染，图表不参与
  root.innerHTML = renderMarkdown(opts.markdown || '')
  if (root.querySelector('.code-block-wrapper[data-lang="mermaid"], .chart-container, canvas')) {
    warnings.push('图表未渲染完成，复制结果中可能缺少图形')
  }
}

/**
 * 克隆 canvas 不会带走像素，长图/粘贴后会变成空白。
 * 按索引从原 DOM 取 toDataURL 结果替换成 img。
 */
function mirrorCanvas(source: HTMLElement, root: HTMLElement): void {
  const originCanvases = Array.from(source.querySelectorAll('canvas'))
  if (!originCanvases.length) return
  const cloned = Array.from(root.querySelectorAll('canvas'))

  cloned.forEach((canvas, index) => {
    const origin = originCanvases[index]
    if (!origin) return
    let dataUrl = ''
    try {
      dataUrl = origin.toDataURL('image/png')
    } catch {
      return
    }
    if (!dataUrl || dataUrl === 'data:,') return
    const img = document.createElement('img')
    img.src = dataUrl
    img.alt = canvas.getAttribute('aria-label') || '图表'
    const cssText = (canvas as HTMLCanvasElement).style.cssText
    if (cssText) img.style.cssText = cssText
    if (!/width/i.test(cssText)) img.style.maxWidth = '100%'
    canvas.replaceWith(img)
  })
}

/** 清理只在交互界面有意义的节点与属性 */
function sanitizeForCopy(root: HTMLElement, warnings: string[]): void {
  root.querySelectorAll(DECORATION_SELECTORS).forEach((el) => el.remove())
  root.querySelectorAll('[data-line]').forEach((el) => el.removeAttribute('data-line'))
  root.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
  root.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'))

  // 任务列表 checkbox：微信/知乎都不显示 input，换成对勾字符
  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const box = input as HTMLInputElement
    const mark = document.createElement('span')
    mark.textContent = box.checked ? '☑ ' : '☐ '
    mark.style.cssText = 'margin-right:4px;'
    box.replaceWith(mark)
  })

  if (root.querySelector('svg')) {
    warnings.push('文档含 SVG 图表，公众号编辑器可能无法显示，建议改用「复制为长图 PNG」')
  }

  // 开头的空白块去掉，避免粘贴后文章顶部多一截空隙
  const first = root.firstElementChild as HTMLElement | null
  if (first) first.style.marginTop = '0'
}

/** 拼装平台 CSS 并把 var() 解析成字面值（供 juice 内联） */
function buildResolvedCss(
  opts: Pick<CopyBuildOptions, 'themeKey' | 'codeTheme'>,
  platform: CopyPlatform,
): string {
  const theme = getCopyTheme(opts.themeKey)
  const codeTheme =
    CODE_THEMES.find((t) => t.name === opts.codeTheme) ||
    CODE_THEMES.find((t) => t.name === DEFAULT_CODE_THEME) ||
    CODE_THEMES[0]

  const css = [
    COPY_BASE_CSS,
    theme.css,
    platform === 'zhihu' ? ZHIHU_NEUTRAL_CSS : '',
    getMarkdownExtensionStyles(),
    codeTheme.css,
    COPY_FINAL_CSS,
  ].join('\n')

  return resolveCssVars(css, { ...codeTheme.vars })
}

/**
 * juice 内联 + 平台修正，返回最终可粘贴的 HTML。
 * juice 失败时退回原始 DOM 序列化（不中断复制）。
 */
function inlineCopyHtml(
  rawHtml: string,
  css: string,
  platform: CopyPlatform,
  warnings: string[],
): string {
  let html: string
  try {
    html = juice.inlineContent(rawHtml, css, {
      inlinePseudoElements: true,
      preserveImportant: true,
    })
  } catch (err) {
    warnings.push(`样式内联失败，已退回基础排版：${err instanceof Error ? err.message : String(err)}`)
    html = rawHtml
  }

  if (platform === 'juejin') html = solveJuejinCode(html)
  return html
}

/**
 * 掘金代码块换行修正（对齐 markdown-nice 的 solveJuejinCode）。
 * 掘金编辑器对 pre 内的 <br> 不换行，需替换成 \n；&nbsp; 会被当成普通字符。
 */
function solveJuejinCode(html: string): string {
  return html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (block) =>
    block
      .replace(/<br\s*\/?>/gi, '\n<span/>')
      .replace(/&nbsp;/g, ' '),
  )
}

/** 生成可粘贴的 HTML（不写剪贴板，便于弹窗预览/调试） */
export async function buildCopyHtml(opts: CopyBuildOptions): Promise<CopyPayload> {
  const staged = await stageContent(opts)
  try {
    const css = buildResolvedCss(opts, opts.platform)
    return {
      html: inlineCopyHtml(staged.root.outerHTML, css, opts.platform, staged.warnings),
      text: opts.markdown || '',
      theme: staged.theme,
      warnings: staged.warnings,
    }
  } finally {
    staged.stage.remove()
  }
}

/** 复制到剪贴板（公众号/知乎/掘金：富文本 HTML） */
export async function copyAsPlatform(
  opts: CopyBuildOptions,
): Promise<{ ok: boolean; warnings: string[]; mode?: 'rich' | 'plain' }> {
  const payload = await buildCopyHtml(opts)
  const res = await copyRichHtml(payload.html)
  return { ok: res.ok, warnings: payload.warnings, mode: res.mode }
}

/** 复制 Markdown 源码 */
export async function copyMarkdownSource(markdown: string): Promise<boolean> {
  return copyPlainText(markdown || '')
}

export interface LongImageResult {
  ok: boolean
  warnings: string[]
  error?: string
}

/**
 * 复制为长图 PNG。
 *
 * html-to-image 用 SVG foreignObject 截图，需要节点真实排版在文档中；
 * 字体用系统字体（skipFonts 避免去抓 @font-face 卡住）。
 */
export async function copyAsLongImage(
  opts: Omit<CopyBuildOptions, 'platform'> & { themeKey?: string },
): Promise<LongImageResult> {
  const staged = await stageContent({
    ...opts,
    platform: 'wechat',
  })

  // 长图需要在真实 DOM 上呈现排版（html-to-image 读取计算样式）：
  // 用 juice 内联结果重写舞台内容
  const css = buildResolvedCss(opts, 'wechat')
  try {
    const html = juice.inlineContent(staged.root.outerHTML, css, {
      inlinePseudoElements: true,
      preserveImportant: true,
    })
    const wrap = document.createElement('div')
    wrap.innerHTML = html
    staged.root.replaceWith(...Array.from(wrap.childNodes))
  } catch {
    /* 内联失败时保持原样，截图仍可用 */
  }

  // 长图用更宽的画面，重设舞台宽度
  staged.stage.style.width = `${LONG_IMAGE_WIDTH}px`
  staged.stage.style.padding = '28px 24px'
  staged.stage.style.boxSizing = 'border-box'
  staged.stage.style.background = staged.theme.background

  try {
    const { toBlob } = await import('html-to-image')
    const blob = await toBlob(staged.stage, {
      backgroundColor: staged.theme.background,
      pixelRatio: 2,
      // 不要让 html-to-image 去抓外部字体/样式
      skipFonts: true,
      // 自定义协议图片（mdlocal://）由渲染进程 fetch 读取，无需跳过
      filter: (node: HTMLElement) => {
        const tag = (node as HTMLElement).tagName
        return tag !== 'SCRIPT'
      },
    })
    if (!blob) {
      return { ok: false, warnings: staged.warnings, error: '截图失败，未生成图片' }
    }
    const ok = await copyImageBlob(blob)
    if (ok) return { ok: true, warnings: staged.warnings }

    // 剪贴板写不进（权限/平台限制）时兜底：直接弹系统保存对话框
    try {
      const dataUrl = await blobToDataUrl(blob)
      const saved = await window.mdAPI?.saveImageAs?.({
        source: { type: 'data', dataUrl },
        defaultName: `${opts.fileName?.replace(/\.[^.]+$/, '') || '文章'}-长图.png`,
      })
      if (saved?.filePath) {
        return { ok: true, warnings: [...staged.warnings, '剪贴板写入受限，已改为弹出保存对话框'] }
      }
    } catch {
      /* 兜底也失败时统一走失败提示 */
    }
    return {
      ok: false,
      warnings: staged.warnings,
      error: '已生成图片但无法写入剪贴板，请改用「导出 PDF」或右键另存',
    }
  } catch (err) {
    return {
      ok: false,
      warnings: staged.warnings,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    staged.stage.remove()
  }
}
