/**
 * 白板生成 DSL 的排版引擎（纯函数，输入节点尺寸、输出坐标）。
 *
 * 支持 5 种布局：flow-v / flow-h（分层 + 重心排序）、mindmap（横向树）、
 * swimlane（泳道）、sequence（参与者列 + 消息行）。
 * 分组（swimlane 之外的布局）在布局完成后按子节点包围盒生成容器框。
 */

import type { CanvasEdge, CanvasGroup, CanvasLayout, CanvasNode } from './specSchema'

/** 已定位的节点 */
export interface PositionedNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** 分组容器框（swimlane 为泳道长条；其它布局为包裹子节点的背景框） */
export interface PositionedGroup {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

/** 时序图的消息行（无绑定的显式箭头坐标） */
export interface SequenceEdge {
  from: string
  to: string
  label?: string
  kind?: string
  x1: number
  x2: number
  y: number
}

export interface LayoutResult {
  nodes: Map<string, PositionedNode>
  groups: PositionedGroup[]
  /** 时序图专用：消息行（其它布局为空数组） */
  sequenceEdges: SequenceEdge[]
  /** 时序图专用：生命线（参与者底部到末行） */
  lifelines: Array<{ id: string; x: number; y1: number; y2: number }>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** 布局入参：节点尺寸（编译器测量文本后给出） */
export type SizeMap = Map<string, { width: number; height: number }>

// 间距常量
const GAP_MAIN = 130 // 层间距 / 列间距
const GAP_CROSS = 44 // 同层节点间距
const GAP_ROW = 46 // 横排节点纵向间距
const GROUP_PAD = 28 // 分组容器内边距
const LANE_LABEL_W = 40 // 泳道标签高度占用（标签在泳道顶部）
const LANE_GAP = 56 // 泳道之间间距
const TITLE_OFFSET = 64 // 标题与首行内容的间距

/* ==================== 图结构 ==================== */

interface Graph {
  next: Map<string, string[]>
  prev: Map<string, string[]>
}

function buildGraph(nodes: CanvasNode[], edges: CanvasEdge[]): Graph {
  const ids = new Set(nodes.map((n) => n.id))
  const next = new Map<string, string[]>()
  const prev = new Map<string, string[]>()
  for (const n of nodes) {
    next.set(n.id, [])
    prev.set(n.id, [])
  }
  const added = new Set<string>()
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue
    const key = `${e.from}->${e.to}`
    if (added.has(key)) continue
    added.add(key)
    next.get(e.from)!.push(e.to)
    prev.get(e.to)!.push(e.from)
  }
  return { next, prev }
}

/** 最长路径分层（prev 方向 DFS；环上的回边忽略） */
function computeLayers(ids: string[], graph: Graph): Map<string, number> {
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    let result = 0
    for (const p of graph.prev.get(id) || []) {
      if (visiting.has(p)) continue
      result = Math.max(result, layerOf(p) + 1)
    }
    visiting.delete(id)
    layer.set(id, result)
    return result
  }
  for (const id of ids) layerOf(id)
  return layer
}

/* ==================== 分层布局（flow-v / flow-h） ==================== */

function layeredLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sizes: SizeMap,
  vertical: boolean,
): { nodes: PositionedNode[] } {
  const graph = buildGraph(nodes, edges)
  const ids = nodes.map((n) => n.id)
  const layers = new Map<number, string[]>()
  for (const id of ids) {
    const l = computeLayers([id], graph).get(id) || 0
    if (!layers.has(l)) layers.set(l, [])
    layers.get(l)!.push(id)
  }
  const layerKeys = [...layers.keys()].sort((a, b) => a - b)

  // 重心排序：同层节点按相邻层邻居的平均位置排序，减少连线交叉（两轮扫）
  const orderOf = new Map<string, number>()
  for (const key of layerKeys) layers.get(key)!.forEach((id, i) => orderOf.set(id, i))
  const barycenter = (id: string, neighbors: string[]): number => {
    const list = neighbors.map((n) => orderOf.get(n)).filter((v): v is number => v !== undefined)
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : orderOf.get(id) || 0
  }
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const key of layerKeys) {
      const list = layers.get(key)!
      list.sort((a, b) => barycenter(a, graph.prev.get(a) || []) - barycenter(b, graph.prev.get(b) || []))
      list.forEach((id, i) => orderOf.set(id, i))
    }
    for (const key of [...layerKeys].reverse()) {
      const list = layers.get(key)!
      list.sort((a, b) => barycenter(a, graph.next.get(a) || []) - barycenter(b, graph.next.get(b) || []))
      list.forEach((id, i) => orderOf.set(id, i))
    }
  }

  const positioned: PositionedNode[] = []
  if (vertical) {
    // 每层一列，列内水平居中；列自上而下
    let y = 0
    for (const key of layerKeys) {
      const list = layers.get(key)!
      const colWidth = Math.max(...list.map((id) => sizes.get(id)?.width || 0), 0)
      const rowHeight = Math.max(...list.map((id) => sizes.get(id)?.height || 0), 0)
      list.forEach((id) => {
        const s = sizes.get(id) || { width: 0, height: 0 }
        positioned.push({
          id,
          x: (colWidth - s.width) / 2,
          y: y + (rowHeight - s.height) / 2,
          width: s.width,
          height: s.height,
        })
      })
      y += rowHeight + GAP_MAIN
    }
    // 每列的 x 需要按列宽累计（第二遍：横向错开）
    let x = 0
    for (const key of layerKeys) {
      const list = layers.get(key)!
      const colWidth = Math.max(...list.map((id) => sizes.get(id)?.width || 0), 0)
      for (const p of positioned) {
        if (layers.get(key)!.includes(p.id)) p.x += x
      }
      x += colWidth + GAP_MAIN
    }
  } else {
    // 每层一行（纵向堆叠），层自左向右
    let x = 0
    for (const key of layerKeys) {
      const list = layers.get(key)!
      const colWidth = Math.max(...list.map((id) => sizes.get(id)?.width || 0), 0)
      let yy = 0
      for (const id of list) {
        const s = sizes.get(id) || { width: 0, height: 0 }
        positioned.push({ id, x: x + (colWidth - s.width) / 2, y: yy, width: s.width, height: s.height })
        yy += s.height + GAP_CROSS
      }
      x += colWidth + GAP_MAIN
    }
  }
  return { nodes: positioned }
}

/* ==================== 思维导图（横向树） ==================== */

function mindmapLayout(nodes: CanvasNode[], edges: CanvasEdge[], sizes: SizeMap): { nodes: PositionedNode[] } {
  const graph = buildGraph(nodes, edges)
  const ids = nodes.map((n) => n.id)
  // 根：入度为 0 中出度最大者，否则第一个节点
  let root = ids[0]
  let bestScore = -1
  for (const id of ids) {
    const indeg = (graph.prev.get(id) || []).length
    if (indeg === 0) {
      const score = (graph.next.get(id) || []).length
      if (score > bestScore) {
        bestScore = score
        root = id
      }
    }
  }
  // BFS 建树（目标已访问的边忽略）
  const children = new Map<string, string[]>()
  const level = new Map<string, number>([[root, 0]])
  const queue = [root]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nxt of graph.next.get(cur) || []) {
      if (level.has(nxt)) continue
      level.set(nxt, level.get(cur)! + 1)
      if (!children.has(cur)) children.set(cur, [])
      children.get(cur)!.push(nxt)
      queue.push(nxt)
    }
  }
  // 每层列宽
  const colWidth = new Map<number, number>()
  for (const id of ids) {
    const l = level.get(id)
    if (l === undefined) continue
    colWidth.set(l, Math.max(colWidth.get(l) || 0, sizes.get(id)?.width || 0))
  }
  // 后序分配 y：叶子顺序堆叠，父节点取子节点均值
  let cursor = 0
  const yOf = new Map<string, number>()
  const assignY = (id: string): number => {
    const kids = children.get(id) || []
    const h = sizes.get(id)?.height || 0
    if (!kids.length) {
      const y = cursor
      cursor += h + GAP_CROSS
      yOf.set(id, y)
      return y + h / 2
    }
    const centers = kids.map((k) => assignY(k))
    const y = Math.min(...centers) - h / 2
    yOf.set(id, y)
    return Math.min(...centers)
  }
  assignY(root)
  // 未连通到根的节点（孤立/环）按层堆到最下面
  for (const id of ids) {
    if (!yOf.has(id)) {
      yOf.set(id, cursor)
      cursor += (sizes.get(id)?.height || 0) + GAP_CROSS
    }
  }
  const positioned: PositionedNode[] = ids.map((id) => {
    const l = level.get(id) ?? 0
    const s = sizes.get(id) || { width: 0, height: 0 }
    let x = 0
    for (let k = 0; k < l; k++) x += (colWidth.get(k) || 0) + GAP_MAIN
    return { id, x, y: yOf.get(id) || 0, width: s.width, height: s.height }
  })
  return { nodes: positioned }
}

/* ==================== 泳道布局 ==================== */

function swimlaneLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  groups: CanvasGroup[],
  sizes: SizeMap,
): { nodes: PositionedNode[]; groups: PositionedGroup[] } {
  const memberOf = new Map<string, string>()
  const laneDefs: Array<{ id: string; label: string; members: string[] }> = groups.map((g) => ({
    id: g.id,
    label: g.label,
    members: [...g.children],
  }))
  for (const g of groups) for (const c of g.children) memberOf.set(c, g.id)
  const orphans = nodes.filter((n) => !memberOf.has(n.id)).map((n) => n.id)
  if (orphans.length) {
    laneDefs.push({ id: '__lane_others__', label: '其他', members: orphans })
  }
  const positioned: PositionedNode[] = []
  const laneRects: PositionedGroup[] = []
  let laneY = 0
  for (const lane of laneDefs) {
    const members = nodes.filter((n) => lane.members.includes(n.id))
    if (!members.length) continue
    const memberEdges = edges.filter((e) => lane.members.includes(e.from) && lane.members.includes(e.to))
    const inner = layeredLayout(members, memberEdges, sizes, false) // 泳道内横向流程
    let contentW = 0
    let contentH = 0
    for (const p of inner.nodes) {
      contentW = Math.max(contentW, p.x + p.width)
      contentH = Math.max(contentH, p.y + p.height)
    }
    contentW = Math.max(contentW, 240)
    contentH = Math.max(contentH, 60)
    const laneW = contentW + GROUP_PAD * 2
    const laneH = contentH + GROUP_PAD * 2 + LANE_LABEL_W
    for (const p of inner.nodes) {
      positioned.push({
        id: p.id,
        x: GROUP_PAD + p.x,
        y: laneY + GROUP_PAD + LANE_LABEL_W + p.y,
        width: p.width,
        height: p.height,
      })
    }
    laneRects.push({ id: lane.id, label: lane.label, x: 0, y: laneY, width: laneW, height: laneH })
    laneY += laneH + LANE_GAP
  }
  // 泳道整体水平居中（以最宽泳道为基准）
  const maxW = Math.max(...laneRects.map((g) => g.width), 0)
  for (const lane of laneRects) lane.x = (maxW - lane.width) / 2
  for (const p of positioned) {
    const lane = laneRects.find((g) => p.x >= g.x - 1 && p.x <= g.x + g.width + 1 && p.y >= g.y && p.y <= g.y + g.height)
    if (lane) p.x += lane.x
  }
  return { nodes: positioned, groups: laneRects }
}

/* ==================== 时序图布局 ==================== */

function sequenceLayout(nodes: CanvasNode[], edges: CanvasEdge[], sizes: SizeMap): {
  nodes: PositionedNode[]
  sequenceEdges: SequenceEdge[]
  lifelines: Array<{ id: string; x: number; y1: number; y2: number }>
} {
  const positioned: PositionedNode[] = []
  let x = 0
  for (const n of nodes) {
    const s = sizes.get(n.id) || { width: 0, height: 0 }
    positioned.push({ id: n.id, x, y: 0, width: s.width, height: s.height })
    x += s.width + 170
  }
  const centerOf = new Map<string, number>()
  for (const p of positioned) centerOf.set(p.id, p.x + p.width / 2)
  const sequenceEdges: SequenceEdge[] = []
  let row = 0
  for (const e of edges) {
    const x1 = centerOf.get(e.from)
    const x2 = centerOf.get(e.to)
    if (x1 === undefined || x2 === undefined) continue
    sequenceEdges.push({ ...e, x1, x2, y: 150 + row * 84 })
    row++
  }
  const bottomY = 150 + Math.max(0, row - 1) * 84 + 70
  const lifelines = positioned.map((p) => ({
    id: p.id,
    x: p.x + p.width / 2,
    y1: p.height + 16,
    y2: Math.max(bottomY, p.height + 80),
  }))
  return { nodes: positioned, sequenceEdges, lifelines }
}

/* ==================== 分组容器框（非 swimlane） ==================== */

function groupContainers(positioned: PositionedNode[], groups: CanvasGroup[]): PositionedGroup[] {
  const byId = new Map(positioned.map((p) => [p.id, p]))
  const rects: PositionedGroup[] = []
  for (const g of groups) {
    const members = g.children.map((c) => byId.get(c)).filter((p): p is PositionedNode => !!p)
    if (!members.length) continue
    const minX = Math.min(...members.map((p) => p.x))
    const minY = Math.min(...members.map((p) => p.y))
    const maxX = Math.max(...members.map((p) => p.x + p.width))
    const maxY = Math.max(...members.map((p) => p.y + p.height))
    rects.push({
      id: g.id,
      label: g.label,
      x: minX - GROUP_PAD,
      y: minY - GROUP_PAD - 18,
      width: maxX - minX + GROUP_PAD * 2,
      height: maxY - minY + GROUP_PAD * 2 + 18,
    })
  }
  return rects
}

/* ==================== 汇总入口 ==================== */

function boundsOf(result: {
  nodes: PositionedNode[]
  groups: PositionedGroup[]
  sequenceEdges?: SequenceEdge[]
}): LayoutResult['bounds'] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const expand = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  for (const p of result.nodes) expand(p.x, p.y, p.width, p.height)
  for (const g of result.groups) expand(g.x, g.y, g.width, g.height)
  for (const e of result.sequenceEdges || []) expand(Math.min(e.x1, e.x2) - 20, e.y - 30, Math.abs(e.x2 - e.x1) + 40, 60)
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/**
 * 计算整体布局
 * @param layout 布局类型
 * @param nodes 节点（校验后的 spec.nodes）
 * @param edges 连线
 * @param groups 分组
 * @param sizes 每个节点的尺寸（编译器测量文本后传入）
 */
export function layoutSpec(
  layout: CanvasLayout,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  groups: CanvasGroup[],
  sizes: SizeMap,
): LayoutResult {
  const positioned = new Map<string, PositionedNode>()
  let laneRects: PositionedGroup[] = []
  let sequenceEdges: SequenceEdge[] = []
  let lifelines: LayoutResult['lifelines'] = []

  if (layout === 'swimlane') {
    const r = swimlaneLayout(nodes, edges, groups, sizes)
    for (const p of r.nodes) positioned.set(p.id, p)
    laneRects = r.groups
  } else if (layout === 'sequence') {
    const r = sequenceLayout(nodes, edges, sizes)
    for (const p of r.nodes) positioned.set(p.id, p)
    sequenceEdges = r.sequenceEdges
    lifelines = r.lifelines
  } else if (layout === 'mindmap') {
    const r = mindmapLayout(nodes, edges, sizes)
    for (const p of r.nodes) positioned.set(p.id, p)
  } else {
    const r = layeredLayout(nodes, edges, sizes, layout === 'flow-v')
    for (const p of r.nodes) positioned.set(p.id, p)
  }

  // 非 swimlane 的分组：包裹子节点包围盒
  let groupRects = laneRects
  if (layout !== 'swimlane' && groups.length && positioned.size) {
    groupRects = groupContainers([...positioned.values()], groups)
    // 容器框会改变包围盒，但节点位置不变（容器画在节点后面即可）
  }

  // 整体平移到 (0,0) 基准
  const bounds = boundsOf({ nodes: [...positioned.values()], groups: groupRects, sequenceEdges })
  const dx = -bounds.minX
  const dy = -bounds.minY
  for (const p of positioned.values()) {
    p.x += dx
    p.y += dy
  }
  for (const g of groupRects) {
    g.x += dx
    g.y += dy
  }
  for (const e of sequenceEdges) {
    e.x1 += dx
    e.x2 += dx
    e.y += dy
  }
  for (const l of lifelines) {
    l.x += dx
    l.y1 += dy
    l.y2 += dy
  }
  const finalBounds = boundsOf({ nodes: [...positioned.values()], groups: groupRects, sequenceEdges })

  return {
    nodes: positioned,
    groups: groupRects,
    sequenceEdges,
    lifelines,
    bounds: finalBounds,
  }
}

export { TITLE_OFFSET }
