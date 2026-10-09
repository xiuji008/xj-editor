/**
 * 预览区（渲染后的 DOM / iframe 文档）查找与高亮。
 *
 * 与源码区 textarea 查找（utils/find.ts）对应，区别在于目标是一个真实 DOM 树：
 * - 遍历文本节点计算匹配，不改动 DOM，避免破坏 Mermaid / 代码高亮 / 图表等渲染结果；
 * - 借助 CSS Custom Highlight API 高亮「全部匹配」与「当前匹配」（不产生 DOM 变更）；
 * - 所有文档对象都从传入的 window / 节点上取，因此同样适用于 iframe 内的预览文档。
 */

/** 单个匹配项：所属文本节点 + 节点内的起止偏移 */
export interface DomMatch {
  node: Text
  start: number
  end: number
}

/** 全部匹配的高亮名 */
const ALL_KEY = 'md-dom-find'
/** 当前匹配的高亮名（优先级更高，覆盖在全部匹配之上） */
const ACTIVE_KEY = 'md-dom-find-active'
/** 高亮配色样式节点 id（::highlight 需定义在目标文档中） */
const STYLE_ID = 'md-dom-find-style'

const HIGHLIGHT_CSS = `::highlight(${ALL_KEY}) { background-color: rgba(230, 162, 60, 0.45); color: inherit; }
::highlight(${ACTIVE_KEY}) { background-color: rgba(64, 158, 255, 0.9); color: #ffffff; }`

/** 在目标文档注入 ::highlight 配色（幂等；iframe 预览需注入到 iframe 文档） */
export function ensureDomFindStyles(doc: Document): void {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = HIGHLIGHT_CSS
  doc.head.appendChild(style)
}

/** 收集 root 下参与查找的文本节点（跳过脚本 / 样式等非展示文本） */
export function collectTextNodes(root: HTMLElement): Text[] {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

/** 在 root 中按文档顺序查找 keyword 的全部匹配 */
export function findDomMatches(root: HTMLElement, keyword: string, caseSensitive: boolean): DomMatch[] {
  if (!root || !keyword) return []
  const kw = caseSensitive ? keyword : keyword.toLowerCase()
  const step = Math.max(kw.length, 1)
  const matches: DomMatch[] = []
  for (const node of collectTextNodes(root)) {
    const text = node.nodeValue || ''
    const src = caseSensitive ? text : text.toLowerCase()
    let from = 0
    for (;;) {
      const idx = src.indexOf(kw, from)
      if (idx === -1) break
      matches.push({ node, start: idx, end: idx + kw.length })
      from = idx + step
    }
  }
  return matches
}

/** Highlight API 相关类型（TS DOM 库尚未稳定提供，按需声明最小集合） */
interface HighlightLike {
  priority: number
}
type HighlightCtor = new (...ranges: Range[]) => HighlightLike
interface HighlightRegistryLike {
  set(key: string, value: unknown): void
  delete(key: string): void
}
type HighlightWindow = Window & {
  CSS?: { highlights?: HighlightRegistryLike }
  Highlight?: HighlightCtor
}

/**
 * 创建针对某个 window（主窗口或 iframe 窗口）的高亮控制器。
 * 同名 registry key 全局唯一，多个实例共用也不会互相覆盖——打开新的查找栏前请先 close 旧的。
 */
export function createDomHighlighter(win: Window) {
  const w = win as HighlightWindow
  const doc = win.document
  const registry = w.CSS?.highlights
  const Ctor = w.Highlight

  const toRange = (m: DomMatch): Range => {
    const r = doc.createRange()
    r.setStart(m.node, m.start)
    r.setEnd(m.node, m.end)
    return r
  }

  return {
    /** 浏览器是否支持 CSS Custom Highlight API（不支持时仍可跳转，只是没有高亮） */
    supported: !!registry && !!Ctor,
    /** 高亮全部匹配，并用更高优先级标出当前匹配 */
    apply(matches: DomMatch[], currentIndex: number) {
      if (!registry || !Ctor) return
      registry.delete(ALL_KEY)
      registry.delete(ACTIVE_KEY)
      if (matches.length === 0) return
      const all = new Ctor(...matches.map(toRange))
      all.priority = 10
      registry.set(ALL_KEY, all)
      const cur = matches[currentIndex]
      if (cur) {
        const active = new Ctor(toRange(cur))
        active.priority = 20
        registry.set(ACTIVE_KEY, active)
      }
    },
    clear() {
      registry?.delete(ALL_KEY)
      registry?.delete(ACTIVE_KEY)
    },
  }
}

/** 把匹配滚动到滚动容器的垂直中部（只滚动该容器，不影响外层布局） */
export function scrollMatchIntoView(match: DomMatch, scroller: HTMLElement): void {
  const doc = match.node.ownerDocument
  const range = doc.createRange()
  range.setStart(match.node, match.start)
  range.setEnd(match.node, match.end)
  const rect = range.getBoundingClientRect()
  const box = scroller.getBoundingClientRect()
  const delta = rect.top - box.top - (scroller.clientHeight - rect.height) / 2
  scroller.scrollTop += delta
}
