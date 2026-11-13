/**
 * CanvasSpec DSL → Excalidraw elements 编译器。
 *
 * 链路：校验 → 文本测量（含中文换行）→ layoutSpec 排版 → skeleton[] →
 * convertToExcalidrawElements（自动生成 text 绑定、箭头绑定、seed/versionNonce 等）。
 * 只依赖 @excalidraw/excalidraw 的公开 API，不手写 element 内部字段。
 */

import { layoutSpec, TITLE_OFFSET, type LayoutResult, type PositionedNode } from './layout'
import {
  resolveLayout,
  validateSpec,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSpec,
  type CanvasTheme,
  type EdgeKind,
  type NodeShape,
  type NodeTone,
} from './specSchema'

/* ==================== 主题与色调 ==================== */

interface ToneStyle {
  background: string
  stroke: string
}

/** professional：低饱和底色 + 深描边 */
const PROFESSIONAL_TONES: Record<NodeTone, ToneStyle> = {
  neutral: { background: '#e9ecef', stroke: '#343a40' },
  start: { background: '#d8f3dc', stroke: '#2f6b3a' },
  end: { background: '#ffe3e3', stroke: '#c92a2a' },
  ok: { background: '#c3fae8', stroke: '#0ca678' },
  warn: { background: '#fff3bf', stroke: '#e67700' },
  error: { background: '#ffc9c9', stroke: '#c92a2a' },
  highlight: { background: '#d0ebff', stroke: '#1971c2' },
}

/** colorful：明快底色 */
const COLORFUL_TONES: Record<NodeTone, ToneStyle> = {
  neutral: { background: '#e5dbff', stroke: '#5f3dc4' },
  start: { background: '#b2f2bb', stroke: '#2b8a3e' },
  end: { background: '#ffc9c9', stroke: '#e03131' },
  ok: { background: '#96f2d7', stroke: '#0ca678' },
  warn: { background: '#ffec99', stroke: '#f08c00' },
  error: { background: '#ffa8a8', stroke: '#c92a2a' },
  highlight: { background: '#a5d8ff', stroke: '#1c7ed6' },
}

/** mono：单色（所有 tone 同底色） */
const MONO_TONES: Record<NodeTone, ToneStyle> = {
  neutral: { background: '#f1f3f5', stroke: '#212529' },
  start: { background: '#f1f3f5', stroke: '#212529' },
  end: { background: '#f1f3f5', stroke: '#212529' },
  ok: { background: '#f1f3f5', stroke: '#212529' },
  warn: { background: '#f1f3f5', stroke: '#212529' },
  error: { background: '#f1f3f5', stroke: '#212529' },
  highlight: { background: '#f1f3f5', stroke: '#212529' },
}

const THEME_TONES: Record<CanvasTheme, Record<NodeTone, ToneStyle>> = {
  professional: PROFESSIONAL_TONES,
  colorful: COLORFUL_TONES,
  mono: MONO_TONES,
  'hand-drawn': PROFESSIONAL_TONES, // 手绘感 = professional 配色 + roughness 2
}

const EDGE_COLOR: Record<CanvasTheme, string> = {
  professional: '#495057',
  colorful: '#495057',
  mono: '#212529',
  'hand-drawn': '#343a40',
}

const GROUP_BG: Record<CanvasTheme, string> = {
  professional: '#f8f9fa',
  colorful: '#f3f0ff',
  mono: '#f1f3f5',
  'hand-drawn': '#f8f9fa',
}

const GROUP_STROKE: Record<CanvasTheme, string> = {
  professional: '#adb5bd',
  colorful: '#b197fc',
  mono: '#868e96',
  'hand-drawn': '#adb5bd',
}

function edgeStyle(kind: EdgeKind | undefined): string | undefined {
  if (kind === 'dashed') return 'dashed'
  if (kind === 'dotted') return 'dotted'
  return undefined
}

/* ==================== 文本测量（含换行） ==================== */

const BASE_FONT_SIZE = 14
const BASE_LINE_HEIGHT = 20
const SUB_FONT_SIZE = 12
const PAD_X = 20
const PAD_Y = 16
const MAX_TEXT_WIDTH = 240

let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx
  try {
    const canvas = document.createElement('canvas')
    measureCtx = canvas.getContext('2d')
  } catch {
    measureCtx = null
  }
  return measureCtx
}

/** 估算文本宽度（无 canvas 时按 CJK 全宽 / 半角半宽估算） */
function textWidth(text: string, fontSize: number): number {
  const ctx = getMeasureContext()
  if (ctx) {
    ctx.font = `${fontSize}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
    return ctx.measureText(text).width
  }
  let width = 0
  for (const ch of text) {
    // CJK 全角字符按 1 字宽，其余按 0.55 字宽
    width += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? fontSize : fontSize * 0.55
  }
  return width
}

/** 按最大宽度折行为若干行 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const segment of String(text || '').split('\n')) {
    if (!segment) {
      out.push('')
      continue
    }
    let line = ''
    for (const ch of segment) {
      if (line && textWidth(line + ch, fontSize) > maxWidth) {
        out.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

/** 测量节点尺寸（label + sub 双行块） */
export function measureNodeSize(node: CanvasNode): { width: number; height: number } {
  const labelLines = wrapText(node.label, BASE_FONT_SIZE, MAX_TEXT_WIDTH)
  const subLines = node.sub ? wrapText(node.sub, SUB_FONT_SIZE, MAX_TEXT_WIDTH) : []
  const textWidthMax = Math.max(
    ...labelLines.map((l) => textWidth(l, BASE_FONT_SIZE)),
    ...subLines.map((l) => textWidth(l, SUB_FONT_SIZE)),
    0,
  )
  const lines = labelLines.length + subLines.length
  let width = Math.ceil(textWidthMax) + PAD_X * 2
  let height = lines * BASE_LINE_HEIGHT + PAD_Y * 2
  // 菱形需要更大的包围尺寸
  if (node.shape === 'diamond') {
    width = Math.ceil(width * 1.5)
    height = Math.ceil(height * 1.7)
  }
  return {
    width: Math.max(width, node.shape === 'diamond' ? 150 : 110),
    height: Math.max(height, node.shape === 'diamond' ? 84 : 46),
  }
}

/* ==================== skeleton 生成 ==================== */

/** skeleton 元素的宽松类型（转换函数 convertToExcalidrawElements 的入参按 unknown 处理） */
type SkeletonElement = Record<string, unknown>

export interface CompileResult {
  /** Excalidraw skeleton（调用方再交给 convertToExcalidrawElements） */
  skeletons: SkeletonElement[]
  /** 元素总数（不含转换后自动生成的 text 元素） */
  elementCount: number
  /** 面向用户的一句话摘要 */
  summary: string
  /** 实际使用的布局 */
  layout: string
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

function nodeSkeleton(
  node: CanvasNode,
  pos: PositionedNode,
  theme: CanvasTheme,
  roughness: number,
): SkeletonElement {
  const tones = THEME_TONES[theme] || PROFESSIONAL_TONES
  const tone = tones[(node.tone as NodeTone) || 'neutral'] || tones.neutral
  const shape: NodeShape = (node.shape as NodeShape) || 'rect'
  const label = node.sub ? `${node.label}\n${node.sub}` : node.label
  const base = {
    id: node.id,
    x: pos.x,
    y: pos.y,
    width: pos.width,
    height: pos.height,
    strokeColor: tone.stroke,
    backgroundColor: tone.background,
    fillStyle: theme === 'hand-drawn' ? 'hachure' : 'solid',
    strokeWidth: 1.5,
    roughness,
    strokeStyle: undefined as string | undefined,
  }
  if (shape === 'diamond') {
    return { type: 'diamond', ...base, label: { text: label, fontSize: BASE_FONT_SIZE } }
  }
  if (shape === 'ellipse') {
    return { type: 'ellipse', ...base, label: { text: label, fontSize: BASE_FONT_SIZE } }
  }
  // rect 直角 / rounded 圆角
  return {
    type: 'rectangle',
    ...base,
    roundness: shape === 'rounded' ? { type: 3 } : null,
    label: { text: label, fontSize: BASE_FONT_SIZE },
  } as SkeletonElement
}

function arrowSkeleton(
  edge: CanvasEdge,
  from: PositionedNode,
  to: PositionedNode,
  theme: CanvasTheme,
  roughness: number,
  bind: boolean,
): SkeletonElement {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height / 2
  const x2 = to.x + to.width / 2
  const y2 = to.y + to.height / 2
  const skeleton: Record<string, unknown> = {
    type: 'arrow',
    x: x1,
    y: y1,
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
    strokeColor: EDGE_COLOR[theme] || EDGE_COLOR.professional,
    strokeWidth: 1.5,
    roughness,
    strokeStyle: edgeStyle(edge.kind),
    ...(edge.label ? { label: { text: edge.label, fontSize: BASE_FONT_SIZE - 2 } } : {}),
  }
  if (bind) {
    // 绑定后 Excalidraw 自动吸附到元素边框并随节点移动
    skeleton.start = { id: edge.from }
    skeleton.end = { id: edge.to }
  }
  return skeleton as SkeletonElement
}

/** 编译 CanvasSpec（校验失败时返回 null，issues 在 validateSpec 中获取） */
export function compileSpec(spec: CanvasSpec): CompileResult | null {
  const { ok } = validateSpec(spec)
  if (!ok) return null
  const layout = resolveLayout(spec)
  const theme: CanvasTheme = (spec.theme as CanvasTheme) || 'professional'
  const roughness = theme === 'hand-drawn' ? 2 : 1
  const nodes = spec.nodes
  const edges = (spec.edges || []).filter((e) => e.from !== e.to)
  const groups = spec.groups || []

  // 文本测量 → 排版
  const sizes = new Map(nodes.map((n) => [n.id, measureNodeSize(n)]))
  const laid = layoutSpec(layout, nodes, edges, groups, sizes)

  const skeletons: SkeletonElement[] = []
  const pad = 24

  // 标题（有 title 时，放内容上方）
  if (spec.title) {
    skeletons.push({
      type: 'text',
      text: spec.title,
      x: pad,
      y: -TITLE_OFFSET + pad,
      fontSize: 20,
    } as SkeletonElement)
  }

  // 时序图：生命线（虚线，画在参与者之后、消息之前）
  if (layout === 'sequence') {
    for (const l of laid.lifelines) {
      skeletons.push({
        type: 'line',
        x: l.x,
        y: l.y1,
        points: [
          [0, 0],
          [0, l.y2 - l.y1],
        ],
        strokeColor: '#adb5bd',
        strokeWidth: 1,
        roughness,
        strokeStyle: 'dashed',
      } as SkeletonElement)
    }
  }

  // 分组容器（画在节点下方）
  for (const g of laid.groups) {
    skeletons.push({
      type: 'rectangle',
      id: `group-${g.id}`,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      strokeColor: GROUP_STROKE[theme] || GROUP_STROKE.professional,
      backgroundColor: GROUP_BG[theme] || GROUP_BG.professional,
      fillStyle: 'solid',
      strokeWidth: 1,
      roughness,
      roundness: { type: 3 },
    } as SkeletonElement)
    skeletons.push({
      type: 'text',
      text: g.label,
      x: g.x + 14,
      y: g.y + 10,
      fontSize: 13,
    } as SkeletonElement)
  }

  // 节点
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (const [id, pos] of laid.nodes) {
    const node = nodeById.get(id)
    if (node) skeletons.push(nodeSkeleton(node, pos, theme, roughness))
  }

  // 连线：flow/mindmap/swimlane 用绑定箭头；sequence 用显式坐标（不绑定，避免消息行塌到参与者边框）
  if (layout === 'sequence') {
    const posById = laid.nodes
    for (const e of laid.sequenceEdges) {
      const skeleton: Record<string, unknown> = {
        type: 'arrow',
        x: Math.min(e.x1, e.x2),
        y: e.y,
        points: [
          [0, 0],
          [e.x2 - e.x1, 0],
        ],
        strokeColor: EDGE_COLOR[theme] || EDGE_COLOR.professional,
        strokeWidth: 1.5,
        roughness,
        strokeStyle: edgeStyle(e.kind as EdgeKind),
        ...(e.label ? { label: { text: e.label, fontSize: BASE_FONT_SIZE - 2 } } : {}),
      }
      if (e.label) {
        // 无绑定的箭头 label 不会被自动挂载，单独生成居中文本
        delete (skeleton as Record<string, unknown>).label
        skeletons.push(skeleton as SkeletonElement)
        const midX = (e.x1 + e.x2) / 2
        skeletons.push({
          type: 'text',
          text: e.label,
          x: midX - textWidth(e.label, BASE_FONT_SIZE - 2) / 2,
          y: e.y - 26,
          fontSize: BASE_FONT_SIZE - 2,
        } as SkeletonElement)
      } else {
        skeletons.push(skeleton as SkeletonElement)
      }
      void posById
    }
  } else {
    for (const e of edges) {
      const from = laid.nodes.get(e.from)
      const to = laid.nodes.get(e.to)
      if (from && to) skeletons.push(arrowSkeleton(e, from, to, theme, roughness, true))
    }
  }

  return {
    skeletons,
    elementCount: skeletons.length,
    summary: `${spec.title || '白板图'}（${layout}，${nodes.length} 节点 / ${edges.length} 连线）`,
    layout,
    bounds: laid.bounds,
  }
}
