/**
 * JSON 树模型：面向大 JSON 的懒加载 + 扁平化实现。
 *
 * 大 JSON 场景做了三处关键优化：
 * 1. 节点懒加载：仅在展开时构建子节点，且按页渲染，避免大数组一次性展开卡死；
 * 2. 零响应式代理：节点为普通对象，变更通过 store.version 递增通知，避免 Proxy 开销；
 * 3. 扁平化使用显式栈做深度优先遍历，避免深层 JSON 递归爆栈。
 */

/** JSON 节点类型 */
export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

/** 树节点 */
export interface JsonNode {
  /** 键名：对象为属性名，数组为下标，根节点固定为 `$` */
  key: string
  /** 节点类型 */
  type: JsonNodeType
  /** 节点原始值，容器节点为对象或数组本体 */
  value: unknown
  /** 层级深度，根节点为 0 */
  depth: number
  /** JSONPath，如 `$.items[0].name` */
  path: string
  /** 直接子节点数量，非容器节点为 0 */
  childCount: number
  /** 父节点引用，根节点为 null */
  parent: JsonNode | null
}

/** 行类型：普通节点或「加载更多」占位行 */
export type TreeRowKind = 'node' | 'more'

/** 扁平化后的一行渲染数据 */
export interface TreeRow {
  /** 行类型 */
  kind: TreeRowKind
  /** 对应节点 */
  node: JsonNode
  /** 缩进层级 */
  depth: number
  /** 是否可展开 */
  expandable: boolean
  /** 当前是否已展开 */
  expanded: boolean
  /** 「加载更多」行的剩余子节点数量，普通行固定为 0 */
  remaining: number
}

/** 扁平化结果 */
export interface FlattenResult {
  /** 可见行列表 */
  rows: TreeRow[]
  /** 是否因超过行数上限被截断 */
  truncated: boolean
}

/** 搜索结果 */
export interface SearchResult {
  /** 需要展示的 path 集合：命中节点及其全部祖先 */
  visible: Set<string>
  /** 需要展开的 path 集合：命中节点的全部祖先 */
  expanded: Set<string>
  /** 真正命中的 path 集合，用于高亮 */
  hits: Set<string>
  /** 命中数量 */
  count: number
  /** 是否因超过遍历上限被中断 */
  truncated: boolean
}

/** 树状态容器 */
export interface JsonTreeStore {
  /** 根节点 */
  root: JsonNode
  /** 已展开节点的 path 集合 */
  expanded: Set<string>
  /** 每个容器节点当前已渲染的子节点数量（分页） */
  shown: Map<string, number>
  /** 子节点缓存，key 为节点 path */
  cache: Map<string, JsonNode[]>
  /** 单个容器默认渲染的子节点数量 */
  pageSize: number
  /** 结构版本号，变更后需重新扁平化 */
  version: number
}

/** 单个容器默认渲染的子节点数量 */
export const DEFAULT_PAGE_SIZE = 200
/** 扁平化行数上限，超出后截断，防止展开超大结构导致内存爆炸 */
export const MAX_FLATTEN_ROWS = 60000
/** 搜索时最大遍历节点数 */
export const SEARCH_NODE_LIMIT = 200000
/** 搜索时最大命中数量 */
export const SEARCH_MATCH_LIMIT = 3000
/** 「展开全部」时最多展开的容器节点数 */
export const MAX_EXPAND_NODES = 4000
/** 预览文本最大长度 */
export const PREVIEW_MAX_LENGTH = 160

/** 合法标识符键名，用于生成简写 JSONPath */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/

/**
 * 判断值的 JSON 类型。
 *
 * @param value 任意 JSON 值
 * @returns 节点类型
 */
function typeOf(value: unknown): JsonNodeType {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  const type = typeof value
  if (type === 'object' || type === 'number' || type === 'string' || type === 'boolean') {
    return type
  }
  // JSON.parse 不会产生 function / undefined，此处仅作兜底
  return 'null'
}

/**
 * 计算容器节点的直接子节点数量。
 *
 * @param value 任意 JSON 值
 * @returns 子节点数量，非容器为 0
 */
function childCountOf(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length
  }
  return 0
}

/**
 * 生成子节点的 JSONPath。
 *
 * @param parentPath 父节点 path
 * @param key 子键名
 * @param isArray 父节点是否为数组
 * @returns 子节点 path
 */
function childPath(parentPath: string, key: string, isArray: boolean): string {
  if (isArray) {
    return `${parentPath}[${key}]`
  }
  if (IDENTIFIER_PATTERN.test(key)) {
    return `${parentPath}.${key}`
  }
  return `${parentPath}[${JSON.stringify(key)}]`
}

/**
 * 创建节点。
 *
 * @param key 键名
 * @param value 节点值
 * @param depth 层级
 * @param parent 父节点
 * @returns 新节点
 */
function createNode(key: string, value: unknown, depth: number, parent: JsonNode | null): JsonNode {
  const isArray = Array.isArray(parent?.value)
  return {
    key,
    type: typeOf(value),
    value,
    depth,
    path: parent ? childPath(parent.path, key, isArray) : '$',
    childCount: childCountOf(value),
    parent,
  }
}

/**
 * 基于根值创建树状态容器。
 *
 * @param rootValue 解析后的 JSON 根值
 * @param pageSize 单个容器默认渲染的子节点数量
 * @returns 树状态容器
 */
export function createTree(rootValue: unknown, pageSize: number = DEFAULT_PAGE_SIZE): JsonTreeStore {
  return {
    root: createNode('$', rootValue, 0, null),
    expanded: new Set<string>(),
    shown: new Map<string, number>(),
    cache: new Map<string, JsonNode[]>(),
    pageSize,
    version: 0,
  }
}

/**
 * 获取（并缓存）节点的子节点列表。
 *
 * @param store 树状态容器
 * @param node 目标节点
 * @returns 子节点数组，非容器节点返回空数组
 */
export function childrenOf(store: JsonTreeStore, node: JsonNode): JsonNode[] {
  const cached = store.cache.get(node.path)
  if (cached) {
    return cached
  }
  const children: JsonNode[] = []
  if (Array.isArray(node.value)) {
    for (let i = 0; i < node.value.length; i++) {
      children.push(createNode(String(i), node.value[i], node.depth + 1, node))
    }
  } else if (node.value && typeof node.value === 'object') {
    const source = node.value as Record<string, unknown>
    Object.keys(source).forEach((key) => {
      children.push(createNode(key, source[key], node.depth + 1, node))
    })
  }
  store.cache.set(node.path, children)
  return children
}

/**
 * 判断节点是否可展开。
 *
 * @param node 目标节点
 * @returns 存在子节点时返回 true
 */
export function isExpandable(node: JsonNode): boolean {
  return node.childCount > 0
}

/**
 * 展开或折叠节点。
 *
 * @param store 树状态容器
 * @param node 目标节点
 */
export function toggleNode(store: JsonTreeStore, node: JsonNode): void {
  if (!isExpandable(node)) {
    return
  }
  if (store.expanded.has(node.path)) {
    store.expanded.delete(node.path)
    store.shown.delete(node.path)
  } else {
    store.expanded.add(node.path)
  }
  store.version++
}

/**
 * 追加渲染某容器节点的更多子节点。
 *
 * @param store 树状态容器
 * @param node 目标节点
 * @param step 本次追加的数量
 */
export function showMore(store: JsonTreeStore, node: JsonNode, step: number = DEFAULT_PAGE_SIZE): void {
  const current = store.shown.get(node.path) ?? store.pageSize
  store.shown.set(node.path, current + step)
  store.version++
}

/**
 * 按层级展开全部节点，受最大展开数量保护，避免超大结构卡死。
 *
 * @param store 树状态容器
 * @param maxDepth 展开到的最大层级
 */
export function expandAll(store: JsonTreeStore, maxDepth: number = 3): void {
  store.expanded.clear()
  store.shown.clear()
  const stack: JsonNode[] = [store.root]
  let count = 0
  while (stack.length > 0) {
    if (count >= MAX_EXPAND_NODES) {
      break
    }
    const node = stack.pop() as JsonNode
    if (node.childCount === 0 || node.depth >= maxDepth) {
      continue
    }
    store.expanded.add(node.path)
    count++
    const children = childrenOf(store, node)
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i])
    }
  }
  store.version++
}

/**
 * 折叠全部节点。
 *
 * @param store 树状态容器
 */
export function collapseAll(store: JsonTreeStore): void {
  store.expanded.clear()
  store.shown.clear()
  store.version++
}

/**
 * 扁平化为可见行列表，使用显式栈做深度优先遍历。
 *
 * @param store 树状态容器
 * @param search 搜索结果，传入时只展示命中分支并忽略分页
 * @returns 扁平化结果
 */
export function flattenTree(store: JsonTreeStore, search: SearchResult | null = null): FlattenResult {
  interface Frame {
    node: JsonNode
    depth: number
    more: boolean
    remaining: number
  }

  const rows: TreeRow[] = []
  const stack: Frame[] = [{ node: store.root, depth: 0, more: false, remaining: 0 }]
  let truncated = false

  while (stack.length > 0) {
    const frame = stack.pop() as Frame
    if (frame.more) {
      rows.push({
        kind: 'more',
        node: frame.node,
        depth: frame.depth,
        expandable: false,
        expanded: false,
        remaining: frame.remaining,
      })
      continue
    }

    const node = frame.node
    if (search && !search.visible.has(node.path)) {
      continue
    }
    if (rows.length >= MAX_FLATTEN_ROWS) {
      truncated = true
      break
    }

    const expandable = isExpandable(node)
    const expanded = expandable && (search ? search.expanded.has(node.path) : store.expanded.has(node.path))
    rows.push({ kind: 'node', node, depth: frame.depth, expandable, expanded, remaining: 0 })
    if (!expanded) {
      continue
    }

    const children = childrenOf(store, node)
    const limit = search ? children.length : Math.min(children.length, store.shown.get(node.path) ?? store.pageSize)
    // 栈为后进先出：先压入「加载更多」，再倒序压入子节点，保证渲染顺序正确
    if (limit < children.length) {
      stack.push({ node, depth: frame.depth + 1, more: true, remaining: children.length - limit })
    }
    for (let i = limit - 1; i >= 0; i--) {
      const child = children[i]
      if (search && !search.visible.has(child.path)) {
        continue
      }
      stack.push({ node: child, depth: frame.depth + 1, more: false, remaining: 0 })
    }
  }

  return { rows, truncated }
}

/**
 * 收集命中的节点及其祖先，用于搜索过滤。
 *
 * @param store 树状态容器
 * @param keyword 搜索关键词，大小写不敏感
 * @returns 搜索结果
 */
export function collectSearch(store: JsonTreeStore, keyword: string): SearchResult {
  const kw = keyword.trim().toLowerCase()
  const visible = new Set<string>()
  const expanded = new Set<string>()
  const hits = new Set<string>()
  const stack: JsonNode[] = [store.root]
  let count = 0
  let visited = 0
  let truncated = false

  while (stack.length > 0) {
    if (visited >= SEARCH_NODE_LIMIT || count >= SEARCH_MATCH_LIMIT) {
      truncated = true
      break
    }
    const node = stack.pop() as JsonNode
    visited++

    const hit = !kw || searchableText(node).toLowerCase().includes(kw)
    if (hit) {
      hits.add(node.path)
      visible.add(node.path)
      count++
      let parent = node.parent
      while (parent) {
        visible.add(parent.path)
        expanded.add(parent.path)
        parent = parent.parent
      }
    }

    if (isExpandable(node)) {
      const children = childrenOf(store, node)
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i])
      }
    }
  }

  return { visible, expanded, hits, count, truncated }
}

/**
 * 生成参与搜索匹配的文本，超长字符串截断以控制开销。
 *
 * @param node 目标节点
 * @returns 键名与值组成的匹配文本
 */
function searchableText(node: JsonNode): string {
  if (node.type === 'string') {
    return `${node.key} ${String(node.value).slice(0, 2000)}`
  }
  if (node.type === 'object' || node.type === 'array') {
    return node.key
  }
  return `${node.key} ${String(node.value)}`
}

/**
 * 生成节点值的预览文本。
 *
 * @param node 目标节点
 * @param maxLength 字符串最大展示长度
 * @returns 预览文本
 */
export function nodePreview(node: JsonNode, maxLength: number = PREVIEW_MAX_LENGTH): string {
  switch (node.type) {
    case 'object':
      return `{…} ${node.childCount} 个键`
    case 'array':
      return `[…] ${node.childCount} 项`
    case 'string': {
      const raw = String(node.value)
      const text = raw.length > maxLength ? `${raw.slice(0, maxLength)}…` : raw
      return `"${text}"`
    }
    case 'null':
      return 'null'
    default:
      return String(node.value)
  }
}

/**
 * 序列化节点值，用于复制或详情展示。
 *
 * @param node 目标节点
 * @param indent 缩进字符串，为空表示压缩输出
 * @returns 序列化文本
 */
export function stringifyNode(node: JsonNode, indent?: string): string {
  try {
    return JSON.stringify(node.value, null, indent)
  } catch {
    return String(node.value)
  }
}
