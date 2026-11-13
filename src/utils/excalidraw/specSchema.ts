/**
 * 白板生成 DSL（CanvasSpec）类型与校验。
 *
 * 模型只输出这份紧凑 DSL，不直接输出 Excalidraw element JSON；
 * 由 sceneCompiler.ts 编译为 elements（坐标/换行/绑定全本地计算）。
 */

export type CanvasLayout = 'flow-v' | 'flow-h' | 'mindmap' | 'swimlane' | 'sequence'
export type CanvasTheme = 'professional' | 'colorful' | 'mono' | 'hand-drawn'
export type NodeShape = 'rect' | 'rounded' | 'diamond' | 'ellipse'
export type NodeTone = 'neutral' | 'start' | 'end' | 'ok' | 'warn' | 'error' | 'highlight'
export type EdgeKind = 'solid' | 'dashed' | 'dotted'

/** 图的节点（矩形 / 圆角 / 菱形 / 椭圆，带主文案与可选副文案） */
export interface CanvasNode {
  id: string
  label: string
  sub?: string
  shape?: NodeShape
  tone?: NodeTone
}

/** 图的连线（from/to 引用节点 id） */
export interface CanvasEdge {
  from: string
  to: string
  label?: string
  kind?: EdgeKind
}

/** 图的分组（泳道 / 容器框） */
export interface CanvasGroup {
  id: string
  label: string
  children: string[]
}

/** 图的 DSL 描述 */
export interface CanvasSpec {
  layout?: CanvasLayout
  theme?: CanvasTheme
  title?: string
  groups?: CanvasGroup[]
  nodes: CanvasNode[]
  edges?: CanvasEdge[]
}

/** 校验问题（path 为定位用途的可读描述） */
export interface SpecIssue {
  path: string
  message: string
}

export interface SpecValidateResult {
  ok: boolean
  issues: SpecIssue[]
}

/** DSL 上限约束（超出时提示拆分，而不是硬画） */
export const SPEC_LIMITS = {
  maxNodes: 40,
  maxEdges: 80,
  maxGroups: 10,
  maxLabelChars: 60,
} as const

const NODE_SHAPES: ReadonlySet<string> = new Set(['rect', 'rounded', 'diamond', 'ellipse'])
const TONES: ReadonlySet<string> = new Set(['neutral', 'start', 'end', 'ok', 'warn', 'error', 'highlight'])
const EDGE_KINDS: ReadonlySet<string> = new Set(['solid', 'dashed', 'dotted'])
const LAYOUTS: ReadonlySet<string> = new Set(['flow-v', 'flow-h', 'mindmap', 'swimlane', 'sequence'])
const THEMES: ReadonlySet<string> = new Set(['professional', 'colorful', 'mono', 'hand-drawn'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 校验并返回规范化错误清单（不改写 spec，编译器自行容错） */
export function validateSpec(input: unknown): SpecValidateResult {
  const issues: SpecIssue[] = []
  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ path: 'spec', message: 'spec 必须是对象' }] }
  }
  const spec = input as Partial<CanvasSpec>

  if (spec.layout && !LAYOUTS.has(spec.layout)) {
    issues.push({ path: 'spec.layout', message: `未知布局 ${String(spec.layout)}` })
  }
  if (spec.theme && !THEMES.has(spec.theme)) {
    issues.push({ path: 'spec.theme', message: `未知主题 ${String(spec.theme)}` })
  }

  // nodes
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : []
  if (!nodes.length) {
    issues.push({ path: 'spec.nodes', message: '至少需要 1 个节点' })
  }
  if (nodes.length > SPEC_LIMITS.maxNodes) {
    issues.push({ path: 'spec.nodes', message: `节点数 ${nodes.length} 超过上限 ${SPEC_LIMITS.maxNodes}，请拆分` })
  }
  const seenIds = new Set<string>()
  nodes.forEach((n, i) => {
    const path = `spec.nodes[${i}]`
    if (!isPlainObject(n)) {
      issues.push({ path, message: '节点必须是对象' })
      return
    }
    const id = str(n.id)
    if (!id) issues.push({ path: `${path}.id`, message: '节点 id 不能为空' })
    else if (seenIds.has(id)) issues.push({ path: `${path}.id`, message: `节点 id 重复：${id}` })
    else seenIds.add(id)
    const label = str(n.label)
    if (!label) issues.push({ path: `${path}.label`, message: '节点 label 不能为空' })
    else if (label.length > SPEC_LIMITS.maxLabelChars) {
      issues.push({ path: `${path}.label`, message: `label 超过 ${SPEC_LIMITS.maxLabelChars} 字，请精简` })
    }
    if (n.shape && !NODE_SHAPES.has(String(n.shape))) {
      issues.push({ path: `${path}.shape`, message: `未知形状 ${String(n.shape)}（可用：rect/rounded/diamond/ellipse）` })
    }
    if (n.tone && !TONES.has(String(n.tone))) {
      issues.push({ path: `${path}.tone`, message: `未知色调 ${String(n.tone)}（可用：neutral/start/end/ok/warn/error/highlight）` })
    }
  })

  // edges
  const edges = Array.isArray(spec.edges) ? spec.edges : []
  if (edges.length > SPEC_LIMITS.maxEdges) {
    issues.push({ path: 'spec.edges', message: `连线数 ${edges.length} 超过上限 ${SPEC_LIMITS.maxEdges}，请拆分` })
  }
  edges.forEach((e, i) => {
    const path = `spec.edges[${i}]`
    if (!isPlainObject(e)) {
      issues.push({ path, message: '连线必须是对象' })
      return
    }
    const from = str(e.from)
    const to = str(e.to)
    if (!from || !seenIds.has(from)) issues.push({ path: `${path}.from`, message: `from 引用了不存在的节点：${from}` })
    if (!to || !seenIds.has(to)) issues.push({ path: `${path}.to`, message: `to 引用了不存在的节点：${to}` })
    if (from && from === to) issues.push({ path, message: '不支持自环连线' })
    if (e.kind && !EDGE_KINDS.has(String(e.kind))) {
      issues.push({ path: `${path}.kind`, message: `未知线型 ${String(e.kind)}（可用：solid/dashed/dotted）` })
    }
  })

  // groups
  const groups = Array.isArray(spec.groups) ? spec.groups : []
  if (groups.length > SPEC_LIMITS.maxGroups) {
    issues.push({ path: 'spec.groups', message: `分组数超过上限 ${SPEC_LIMITS.maxGroups}` })
  }
  const groupedNodes = new Set<string>()
  groups.forEach((g, i) => {
    const path = `spec.groups[${i}]`
    if (!isPlainObject(g)) {
      issues.push({ path, message: '分组必须是对象' })
      return
    }
    if (!str(g.id)) issues.push({ path: `${path}.id`, message: '分组 id 不能为空' })
    if (!str(g.label)) issues.push({ path: `${path}.label`, message: '分组 label 不能为空' })
    const children = Array.isArray(g.children) ? g.children : []
    if (!children.length) issues.push({ path: `${path}.children`, message: '分组至少包含 1 个节点' })
    for (const c of children) {
      if (!seenIds.has(str(c))) {
        issues.push({ path: `${path}.children`, message: `分组引用了不存在的节点：${String(c)}` })
      }
      if (groupedNodes.has(str(c))) {
        issues.push({ path: `${path}.children`, message: `节点 ${String(c)} 出现在多个分组中（分组只允许一层）` })
      }
      groupedNodes.add(str(c))
    }
  })

  return { ok: issues.length === 0, issues }
}

/** 未知布局时按规则推断：有分组 → swimlane，否则 flow-v */
export function resolveLayout(spec: Partial<CanvasSpec>): CanvasLayout {
  if (spec.layout && LAYOUTS.has(spec.layout)) return spec.layout as CanvasLayout
  const groups = Array.isArray(spec.groups) ? spec.groups : []
  return groups.length ? 'swimlane' : 'flow-v'
}
