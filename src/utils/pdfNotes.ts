/**
 * PDF 阅读标注数据（Sidecar）模型与读写
 *
 * 标注 / 笔记数据不写入 PDF 源文件，而是以 JSON 形式存放在 PDF 的同级目录下，
 * 文件名为「原文件名 + .notes.json」，例如 `手册.pdf` → `手册.pdf.notes.json`。
 *
 * 设计要点：
 * - 不修改源文件，避免破坏 PDF 签名 / 加密文件 / 大文件重写失败；
 * - 数据与文档同目录，方便随文档一起备份、移动、进 Git；
 * - 记录 source（文件名 / 大小 / 修改时间），用于文档改名或替换后识别失联数据。
 *
 * @module utils/pdfNotes
 */
import { basename } from './fileUtils'

/** sidecar 文件后缀：原路径 + 该后缀即为标注文件路径 */
const SIDECAR_SUFFIX = '.notes.json'

/** sidecar 数据结构版本（结构变更时递增，读取时做兼容处理） */
const SIDECAR_VERSION = 1

/** 缩放模式：适应宽度 / 适应整页 / 自定义比例 */
export type PdfScaleMode = 'fit-width' | 'fit-page' | 'custom'

/** 高亮颜色预设项 */
export interface PdfMarkColor {
  /** 颜色值（HEX） */
  value: string
  /** 展示名 */
  label: string
}

/** 内置高亮颜色预设（标注工具条与侧栏共用） */
export const PDF_MARK_COLOR_PRESETS: PdfMarkColor[] = [
  { value: '#ffe58f', label: '黄' },
  { value: '#b7eb8f', label: '绿' },
  { value: '#91d5ff', label: '蓝' },
  { value: '#ffadd2', label: '粉' },
  { value: '#d3adf7', label: '紫' },
]

/** 默认高亮颜色 */
export const DEFAULT_MARK_COLOR = PDF_MARK_COLOR_PRESETS[0].value

/**
 * 单个矩形区域，采用 PDF 用户坐标系（原点在页面左下角，单位 pt，y 轴向上）
 */
export interface PdfRect {
  /** 矩形左下角 x（PDF 坐标，pt） */
  x: number
  /** 矩形左下角 y（PDF 坐标，pt） */
  y: number
  /** 矩形宽度（pt） */
  w: number
  /** 矩形高度（pt） */
  h: number
}

/**
 * 文本高亮标记：由选区生成，可能跨行因此包含多个矩形
 */
export interface PdfMark {
  /** 标记 id */
  id: string
  /** 所在页码（1 起） */
  page: number
  /** 高亮颜色 */
  color: string
  /** 覆盖的矩形数组，每项为 [x, y, w, h]（PDF 坐标） */
  rects: number[][]
  /** 被标记的原文（用于锚点失效时展示，也便于搜索） */
  quote: string
  /** 创建时间（ISO 字符串） */
  createdAt: string
}

/**
 * 阅读笔记：可挂在页码上，也可挂在某个高亮标记上
 */
export interface PdfNote {
  /** 笔记 id */
  id: string
  /** 所在页码（1 起） */
  page: number
  /** 关联的高亮标记 id，为空表示仅为页码笔记 */
  markId?: string
  /** 笔记正文（支持 Markdown 语法） */
  text: string
  /** 笔记来源：手动撰写或由 AI 生成（用于展示来源标记） */
  source?: 'manual' | 'ai'
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 最后更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * 阅读进度：页码 + 页内偏移 + 缩放，重开时还原到上次位置
 */
export interface PdfProgress {
  /** 当前页码（1 起） */
  page: number
  /** 页内滚动偏移（CSS 像素，相对该页顶部） */
  offset: number
  /** 缩放比例（1 = 100%） */
  scale: number
  /** 缩放模式 */
  scaleMode: PdfScaleMode
  /** 更新时间（ISO 字符串） */
  updatedAt: string
}

/**
 * Sidecar 文件整体结构
 */
export interface PdfSidecar {
  /** 结构版本 */
  version: number
  /** 归属文档信息，用于识别文档是否被替换 */
  source: {
    /** 文件名（不含目录） */
    name: string
    /** 文件大小（字节） */
    size: number
    /** 最后修改时间（毫秒时间戳） */
    mtime: number
  }
  /** 阅读进度 */
  progress?: PdfProgress
  /** 高亮标记列表 */
  marks: PdfMark[]
  /** 笔记列表 */
  notes: PdfNote[]
}

/** 生成简易唯一 id（时间戳 + 随机串，满足本地唯一即可） */
export function createPdfId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 由 PDF 路径推导 sidecar 路径：原路径 + `.notes.json`
 * @param pdfPath PDF 文件绝对路径
 * @returns sidecar 文件绝对路径
 */
export function sidecarPathFor(pdfPath: string): string {
  return `${pdfPath}${SIDECAR_SUFFIX}`
}

/** 创建一个空的 sidecar 数据结构 */
export function createEmptySidecar(pdfPath: string, stat?: { size: number; mtime: number }): PdfSidecar {
  return {
    version: SIDECAR_VERSION,
    source: {
      name: basename(pdfPath),
      size: stat?.size || 0,
      mtime: stat?.mtime || 0,
    },
    marks: [],
    notes: [],
  }
}

/**
 * 规范化读取结果：补齐缺失字段、过滤脏数据，保证后续逻辑无需判空。
 * @param raw 任意解析结果
 * @param pdfPath 归属的 PDF 路径
 * @returns 规范化后的 sidecar 数据
 */
function normalizeSidecar(raw: any, pdfPath: string): PdfSidecar {
  const data = createEmptySidecar(pdfPath, raw?.source)
  if (!raw || typeof raw !== 'object') return data
  if (Array.isArray(raw.marks)) {
    data.marks = raw.marks
      .filter((m: any) => m && Number.isFinite(m.page) && Array.isArray(m.rects))
      .map((m: any) => ({
        id: String(m.id || createPdfId('m')),
        page: Math.max(1, Math.round(Number(m.page) || 1)),
        color: typeof m.color === 'string' ? m.color : DEFAULT_MARK_COLOR,
        rects: m.rects.filter((r: any) => Array.isArray(r) && r.length === 4).map((r: any) => r.map(Number)),
        quote: String(m.quote || ''),
        createdAt: String(m.createdAt || new Date().toISOString()),
      }))
  }
  if (Array.isArray(raw.notes)) {
    data.notes = raw.notes
      .filter((n: any) => n && typeof n.text === 'string')
      .map((n: any) => ({
        id: String(n.id || createPdfId('n')),
        page: Math.max(1, Math.round(Number(n.page) || 1)),
        markId: n.markId ? String(n.markId) : undefined,
        text: n.text,
        source: n.source === 'ai' ? 'ai' : 'manual',
        createdAt: String(n.createdAt || new Date().toISOString()),
        updatedAt: String(n.updatedAt || n.createdAt || new Date().toISOString()),
      }))
  }
  const p = raw.progress
  if (p && Number.isFinite(p.page)) {
    data.progress = {
      page: Math.max(1, Math.round(Number(p.page) || 1)),
      offset: Number.isFinite(p.offset) ? Number(p.offset) : 0,
      scale: Number.isFinite(p.scale) && Number(p.scale) > 0 ? Number(p.scale) : 1,
      scaleMode: (['fit-width', 'fit-page', 'custom'] as PdfScaleMode[]).includes(p.scaleMode)
        ? p.scaleMode
        : 'fit-width',
      updatedAt: String(p.updatedAt || new Date().toISOString()),
    }
  }
  return data
}

/**
 * 读取 PDF 的 sidecar 标注数据（文件不存在时返回空数据，不视为错误）。
 * @param pdfPath PDF 文件绝对路径
 * @returns sidecar 数据与是否成功写入过（用于判断只读场景）
 */
export async function loadPdfSidecar(pdfPath: string): Promise<PdfSidecar> {
  const target = sidecarPathFor(pdfPath)
  try {
    const res = await window.mdAPI?.readFile(target)
    if (!res?.ok || typeof res.content !== 'string') return createEmptySidecar(pdfPath)
    return normalizeSidecar(JSON.parse(res.content), pdfPath)
  } catch {
    return createEmptySidecar(pdfPath)
  }
}

/**
 * 写入 sidecar 标注数据（覆盖写，通过主进程静默保存，不弹对话框）。
 * @param pdfPath PDF 文件绝对路径
 * @param data sidecar 数据
 * @returns 是否写入成功
 */
export async function savePdfSidecar(pdfPath: string, data: PdfSidecar): Promise<boolean> {
  const target = sidecarPathFor(pdfPath)
  try {
    const res = await window.mdAPI?.saveFile({
      filePath: target,
      content: JSON.stringify({ ...data, version: SIDECAR_VERSION }, null, 2),
    })
    return !!res && !res.canceled
  } catch {
    return false
  }
}

/**
 * 修复 sidecar 中记录的源文件信息（首次写入时补全大小 / 修改时间）。
 * @param data sidecar 数据
 * @param stat 文件状态
 */
export function applySourceStat(data: PdfSidecar, stat: { size: number; mtime: number }): void {
  if (stat) {
    data.source.size = stat.size || 0
    data.source.mtime = stat.mtime || 0
  }
}

/**
 * 将标注 / 笔记导出为 Markdown 文本（便于把批注整理进知识库）。
 * @param data sidecar 数据
 * @param pdfPath PDF 路径（用于标题）
 * @returns Markdown 文本
 */
export function exportPdfAnnotationsMarkdown(data: PdfSidecar, pdfPath: string): string {
  const lines: string[] = [`# ${basename(pdfPath)} 阅读批注`, '']
  const items = [
    ...data.marks.map((m) => ({ page: m.page, kind: 'mark' as const, item: m })),
    ...data.notes.map((n) => ({ page: n.page, kind: 'note' as const, item: n })),
  ].sort((a, b) => a.page - b.page)
  if (!items.length) {
    lines.push('（暂无批注）')
    return lines.join('\n')
  }
  for (const { page, kind, item } of items) {
    if (kind === 'mark') {
      const mark = item as PdfMark
      const quote = mark.quote.trim()
      lines.push(`- **P${page}** 高亮${quote ? `：${quote}` : ''}`)
      continue
    }
    const note = item as PdfNote
    const tag = note.source === 'ai' ? 'AI 笔记' : '笔记'
    // 笔记正文保留 Markdown 原始排版（缩进 2 空格作为引用块内联到列表项下）
    const body = note.text.trim()
    if (!body) {
      lines.push(`- **P${page}** ${tag}`)
      continue
    }
    lines.push(`- **P${page}** ${tag}`, '', body.split('\n').map((l) => `  ${l}`).join('\n'), '')
  }
  return lines.join('\n')
}
