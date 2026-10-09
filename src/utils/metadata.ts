/**
 * Markdown 元数据（YAML Front Matter）模板与合并工具
 *
 * - 只维护本工具实际渲染 / 使用的核心字段（见 METADATA_FIELDS），
 *   元数据块中不包含任何注释，只写入有值的字段；
 * - createDate / lastUpdateDate 由系统维护：AI 返回的同名字段会被忽略，
 *   createDate 沿用文档首次写入的值，lastUpdateDate 每次更新 / 保存时刷新；
 * - AI 生成的字段按字段清单顺序合并回文档头部，清单之外的字段不写入。
 */
import { formatDateTime } from './markdown'
import { stripCodeFence } from './ai'

/** 一个元数据字段定义 */
export interface MetadataField {
  /** 字段名（写入 YAML 的键） */
  key: string
  /** 字段说明（仅用于代码内说明与 AI 提示词，不写入文档） */
  desc: string
  /** 是否由系统维护（true 时 AI 不可改写，始终写入） */
  system?: boolean
}

/**
 * 支持的元数据字段清单（顺序即写入顺序）
 * 仅包含工具实际渲染 / 使用的字段：新增字段需在此追加，
 * 并同步 electron/quickAi.cjs 中 metadata 动作的提示词字段清单。
 */
export const METADATA_FIELDS: MetadataField[] = [
  { key: 'title', desc: '标题：文档标题，简洁准确，建议不超过 30 字' },
  { key: 'emoji', desc: '图标：代表文档主题的一个 emoji' },
  { key: 'description', desc: '摘要：一句话说明文档讲什么、适合谁看，不超过 120 字' },
  { key: 'keywords', desc: '关键词：3-6 个，用顿号或逗号分隔' },
  { key: 'tags', desc: '标签：3-6 个，数组格式 [标签1, 标签2]' },
  { key: 'category', desc: '分类：所属分类目录，单个' },
  { key: 'series', desc: '系列：所属系列 / 专栏，无则留空' },
  { key: 'author', desc: '作者：作者名，无法确定则留空' },
  { key: 'status', desc: '状态：draft / review / published / archived' },
  { key: 'createDate', system: true, desc: '创建时间：首次写入文档时由系统生成' },
  { key: 'lastUpdateDate', system: true, desc: '更新时间：每次保存 / 更新元数据时由系统刷新' },
]

/** 由系统维护的字段（小写）：AI 返回时一律忽略 */
const SYSTEM_KEYS = new Set(
  METADATA_FIELDS.filter((f) => f.system).map((f) => f.key.toLowerCase()),
)

/** 历史文档中可能出现的时间字段别名：AI 返回时同样忽略，避免与系统字段冲突 */
const SYSTEM_ALIASES = ['created', 'updated', 'lastmod', 'modified']

/** 文档头部 front matter 块的匹配正则（仅匹配文档最开头的 --- 包裹块） */
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/

/** 元数据值：Map 的键为小写字段名，值为原始键名与值 */
export type MetadataValues = Map<string, { key: string; value: string }>

/** 统一换行符为 \n，避免 Windows \r\n 导致正则匹配失败 */
function normalizeNewlines(text: string): string {
  return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * 生成 YAML 标量值：含特殊字符（前导符号、冒号空格、行内注释）时使用双引号包裹。
 * 数组形式的值（如 [标签1, 标签2]）保持原样，便于渲染时解析为标签列表。
 * @param {string} value 原始值
 * @returns {string} 可直接写入 YAML 的值
 */
function formatYamlValue(value: string): string {
  const v = (value ?? '').trim()
  if (!v) return ''
  const needQuote = /^[&*!|>%@`#-]/.test(v) || v.includes(': ') || v.includes(' #') || v.includes('\n')
  if (!needQuote) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 解析 YAML 文本中的「key: value」字段（忽略注释、分隔线与列表符号）。
 * 支持中英文冒号，值两端的引号会被去掉。
 * @param {string} text YAML 文本
 * @returns {MetadataValues} 字段集合
 */
export function parseMetadataFields(text: string): MetadataValues {
  const map: MetadataValues = new Map()
  for (const line of normalizeNewlines(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') continue
    const enIdx = trimmed.indexOf(':')
    const cnIdx = trimmed.indexOf('：')
    let colonIdx = enIdx
    if (colonIdx === -1 || (cnIdx !== -1 && cnIdx < colonIdx)) colonIdx = cnIdx
    if (colonIdx <= 0) continue
    const key = trimmed.slice(0, colonIdx).trim().replace(/^-\s*/, '')
    let value = trimmed.slice(colonIdx + 1).trim()
    if (!key) continue
    if (value.length > 1 && /^["']/.test(value) && value.endsWith(value[0])) {
      value = value.slice(1, -1).trim()
    }
    map.set(key.toLowerCase(), { key, value })
  }
  return map
}

/**
 * 拆分文档：取出头部的 front matter 块与剩余正文。
 * @param {string} markdown 文档全文
 * @returns {{ block: string | null; body: string }} 元数据块（无则为 null）与正文
 */
export function splitFrontMatter(markdown: string): { block: string | null; body: string } {
  const src = normalizeNewlines(markdown)
  const match = FRONT_MATTER_RE.exec(src)
  if (!match) return { block: null, body: src }
  return { block: match[1], body: src.slice(match[0].length) }
}

/**
 * 按字段清单顺序渲染元数据行：只写入有值的字段，且不输出任何注释。
 * 系统字段（createDate / lastUpdateDate）无值时取当前时间，始终写入；
 * 清单之外的字段一律丢弃，保证元数据块只含本工具支持的字段。
 * @param {MetadataValues} values 字段集合
 * @param {string} now 当前时间字符串
 * @returns {string[]} YAML 行
 */
function renderMetadataLines(values: MetadataValues, now: string): string[] {
  const lines: string[] = []
  for (const field of METADATA_FIELDS) {
    let value = values.get(field.key.toLowerCase())?.value ?? ''
    if (!value && field.system) value = now
    if (!value.trim()) continue
    lines.push(`${field.key}: ${formatYamlValue(value)}`)
  }
  return lines
}

/**
 * 生成元数据块（YAML Front Matter）：只含本工具支持的字段，无注释、无空值占位。
 * createDate 沿用传入值或当前时间，lastUpdateDate 取当前时间。
 * @param {object} opts 可选：title 标题、values 预填字段、now 指定时间
 * @returns {string} 以换行结尾的元数据块（含首尾 ---）
 */
export function buildFullMetadataBlock(opts: {
  title?: string
  values?: Record<string, string>
  now?: string
} = {}): string {
  const now = opts.now || formatDateTime()
  const values: MetadataValues = new Map()
  for (const [key, value] of Object.entries(opts.values || {})) {
    if (!key) continue
    values.set(key.toLowerCase(), { key, value: String(value ?? '') })
  }
  if (opts.title && !values.get('title')?.value) {
    values.set('title', { key: 'title', value: opts.title })
  }
  const createDate = values.get('createdate')?.value || values.get('created')?.value || now
  values.set('createdate', { key: 'createDate', value: createDate })
  values.set('lastupdatedate', { key: 'lastUpdateDate', value: now })
  return `---\n${renderMetadataLines(values, now).join('\n')}\n---\n`
}

/**
 * 确保文档头部存在元数据块：已有则原样返回，否则插入元数据块（只有时间与标题时有值）。
 * @param {string} markdown 文档全文
 * @param {object} opts 同 buildFullMetadataBlock
 * @returns {string} 文档全文
 */
export function ensureMetadataBlock(
  markdown: string,
  opts: { title?: string; values?: Record<string, string>; now?: string } = {},
): string {
  const src = normalizeNewlines(markdown)
  const { block, body } = splitFrontMatter(src)
  if (block) return src
  return buildFullMetadataBlock(opts) + body
}

/**
 * 把 AI 生成的元数据合并到文档头部：
 * 1. 保留文档已有的元数据值；
 * 2. AI 给出的非空字段覆盖已有值（createDate / lastUpdateDate 等系统字段除外）；
 * 3. createDate 沿用原值（无则取当前时间），lastUpdateDate 刷新为当前时间；
 * 4. 输出按字段清单排列且不含注释，只保留本工具支持的字段，空值字段不写入。
 *
 * @param {string} markdown 文档全文
 * @param {string} aiText AI 返回的 YAML 文本（允许带 ```yaml 代码围栏）
 * @param {object} opts 可选：now 指定时间
 * @returns {string} 合并后的文档全文
 */
export function applyAiMetadata(
  markdown: string,
  aiText: string,
  opts: { now?: string } = {},
): string {
  const now = opts.now || formatDateTime()
  const { block, body } = splitFrontMatter(markdown)
  const merged: MetadataValues = new Map()
  if (block) {
    for (const [lower, item] of parseMetadataFields(block)) merged.set(lower, item)
  }
  // AI 输出：系统字段一律忽略，空值不覆盖已有内容
  for (const [lower, item] of parseMetadataFields(stripCodeFence(aiText))) {
    if (SYSTEM_KEYS.has(lower) || SYSTEM_ALIASES.includes(lower)) continue
    if (!item.value.trim()) continue
    merged.set(lower, item)
  }
  const createDate = merged.get('createdate')?.value || merged.get('created')?.value || now
  merged.set('createdate', { key: 'createDate', value: createDate })
  merged.set('lastupdatedate', { key: 'lastUpdateDate', value: now })
  return `---\n${renderMetadataLines(merged, now).join('\n')}\n---\n${body}`
}
