/**
 * AI 相关工具函数：配置加载/保存、对话调用、图表提示词。
 * 实际网络请求在 Electron 主进程完成（避免渲染进程跨域并便于集中管理密钥）。
 * 快捷动作的提示词由主进程持久化、可在设置中定制，见 utils/quickAi.ts。
 */


/** 图表 / 代码生成类型：后续新增类型只需在 DIAGRAM_TYPES 中追加一项 */
export interface DiagramType {
  /** 代码块语言标识（同时作为类型唯一 key） */
  lang: string
  /** 下拉展示名称 */
  label: string
  /** 该类型的语法与格式约束（写入提示词，用于约束 AI 输出） */
  spec: string
}

/**
 * 支持的图表 / 代码生成类型。
 * 新增类型（如 echarts / graphviz / svg 等）只需在此追加一项，
 * 面板下拉、提示词与结果解析会自动支持。
 */
export const DIAGRAM_TYPES: DiagramType[] = [
  {
    lang: 'mermaid',
    label: 'Mermaid',
    spec: `1. 使用 Mermaid 语法，首行声明图类型（graph TD / sequenceDiagram / classDiagram / gantt / pie / mindmap / flowchart LR 等），按描述选择最贴切的一种；
2. 节点文本使用 []、{}、() 包裹，不要出现未闭合的引号或括号，避免渲染失败；
3. 节点与连线的命名简洁，建议使用中文标签；`,
  },
  {
    lang: 'plantuml',
    label: 'PlantUML',
    spec: `1. 使用 PlantUML 语法，首尾必须包含 @startuml 与 @enduml；
2. 按描述选择最贴切的图类型（时序图 / 用例图 / 类图 / 活动图 / 组件图 / 状态图等）；
3. 参与方名称简洁，建议使用中文；`,
  },
  {
    lang: 'chart',
    label: 'Chart 图表',
    spec: `1. 只输出一个 JSON 对象（不要数组、不要注释、不要尾随逗号），优先使用简化格式：
   {"type":"bar|line|pie|doughnut|radar|area","title":"图表标题","data":[{"name":"类目","value":123}]}
   也可直接输出 Chart.js 原生配置（含 data.datasets）；
2. 数值一律使用数字类型，不要加引号；
3. 类目与标题建议使用中文；`,
  },
]

/** 默认图表类型 */
export const DEFAULT_DIAGRAM_LANG = 'mermaid'

/** 按语言标识获取类型定义，未知类型回落到默认类型 */
export function getDiagramType(lang: string): DiagramType {
  return DIAGRAM_TYPES.find((t) => t.lang === lang) || DIAGRAM_TYPES[0]
}

/**
 * 构建"生成图表 / 代码"提示词。
 * @param desc 用户选中的自然语言描述
 * @param type 目标类型（决定提示词中的语法约束与输出围栏语言）
 */
export function buildDiagramPrompt(desc: string, type: DiagramType): string {
  return `你是一名图表生成专家。请根据下面给出的自然语言描述，生成一段可直接渲染的 \`${type.lang}\` 代码。

总体要求：
1. 只输出一段代码，并用 \`\`\`${type.lang} 代码围栏包裹，围栏外不要输出任何解释、标题或前后缀；
2. 代码必须语法正确，可被标准渲染器直接渲染，不得使用占位符或省略号；
3. 完整覆盖描述中出现的实体与关系，层次清晰、命名精炼；
4. 若描述过短或含糊，按最合理的常见场景补全，但仍需贴合描述主题。

${type.label} 语法要求：
${type.spec}

以下是待生成图表的描述：
${desc}`
}

/**
 * 将数据转为可安全跨 IPC 传输的纯对象。
 * Vue 的 ref/reactive 会返回 Proxy，Electron 的 structuredClone 无法克隆 Proxy，
 * 直接传入会抛 "An object could not be cloned"，因此发往主进程前必须剥离。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 获取 AI 配置（内置厂商 + 自定义厂商） */
export async function getAiConfig(): Promise<AiConfig | null> {
  try {
    const cfg = await window.mdAPI?.aiGetConfig()
    return cfg || null
  } catch {
    return null
  }
}

/** 保存 AI 配置 */
export async function saveAiConfig(config: AiConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await window.mdAPI?.aiSetConfig(toPlain(config))) || { ok: false, error: '主进程不可用' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 发起一次 AI 对话请求 */
export async function aiChat(
  provider: AiProvider,
  messages: AiMessage[],
  temperature?: number,
  scene?: AiLogScene,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    return (
      (await window.mdAPI?.aiChat(toPlain({ provider, messages, temperature, scene }))) || {
        ok: false,
        error: '主进程不可用',
      }
    )
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 生成流式请求标识（渲染进程侧生成，保证监听器先于首个增量注册） */
export function createAiRequestId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 获取当前启用的 AI 厂商（服务地址与模型齐全才视为可用，本地模型允许不填 Key）
 * @returns {Promise<AiProvider | null>} 可用厂商配置，未配置时为 null
 */
export async function getActiveProvider(): Promise<AiProvider | null> {
  const cfg = await getAiConfig()
  if (!cfg) return null
  const provider =
    cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0] || null
  if (!provider || !provider.baseUrl?.trim() || !provider.model?.trim()) return null
  return provider
}

/**
 * 发起一次流式 AI 对话请求，增量文本通过 onDelta 实时回调
 * @param provider 厂商配置
 * @param messages 对话消息
 * @param handlers 增量 / 完成 / 失败回调
 * @param temperature 温度，缺省使用厂商配置
 * @param scene 业务场景（用于调用日志归类）
 * @returns {Promise<AiStreamSession>} 会话句柄（stop 可中断生成）
 */
export async function aiChatStream(
  provider: AiProvider,
  messages: AiMessage[],
  handlers: AiStreamHandlers,
  temperature?: number,
  scene?: AiLogScene,
): Promise<AiStreamSession> {
  const requestId = createAiRequestId()
  try {
    const session = await window.mdAPI?.aiChatStream(
      toPlain({ requestId, provider, messages, temperature, scene }),
      handlers,
    )
    return session || { ok: false, error: '主进程不可用', stop: () => {} }
  } catch (err) {
    return { ok: false, error: String(err), stop: () => {} }
  }
}

/** 调用场景中文名（用于日志列表展示） */
export const AI_SCENE_LABELS: Record<string, string> = {
  chat: '自由对话',
  polish: '润色',
  expand: '扩写',
  outline: '概要生成',
  diagram: '生成图表',
  quick: '快捷任务',
  commit: '生成提交信息',
  pdf: 'PDF 阅读笔记',
  test: '连接测试',
  skill: '技能调用',
}

/** 取场景展示名，未知场景回退为场景值本身 */
export function aiSceneLabel(scene?: string): string {
  return AI_SCENE_LABELS[scene || ''] || scene || '未知'
}

/** 查询存在调用日志的月份（倒序） */
export async function getAiLogMonths(): Promise<AiLogMonth[]> {
  try {
    const res = await window.mdAPI?.aiLogMonths()
    return res?.ok ? res.months || [] : []
  } catch {
    return []
  }
}

/** 分页查询调用日志（含统计） */
export async function listAiLogs(query: AiLogQuery): Promise<AiLogListResult> {
  try {
    const res = await window.mdAPI?.aiLogList(toPlain(query))
    if (res?.ok) return res
    return { ok: false, page: 1, pageSize: query.pageSize || 20, total: 0, items: [], error: res?.error || '查询失败' }
  } catch (err) {
    return { ok: false, page: 1, pageSize: query.pageSize || 20, total: 0, items: [], error: String(err) }
  }
}

/** 查询单条调用日志详情（完整请求 / 响应） */
export async function getAiLogDetail(id: string, month?: string): Promise<AiLogRecord | null> {
  try {
    const res = await window.mdAPI?.aiLogDetail({ id, month })
    return res?.ok ? res.record || null : null
  } catch {
    return null
  }
}

/** 删除指定调用日志 */
export async function deleteAiLogs(ids: string[], month?: string): Promise<{ ok: boolean; removed: number; error?: string }> {
  try {
    const res = await window.mdAPI?.aiLogDelete({ ids, month })
    return { ok: !!res?.ok, removed: res?.removed || 0, error: res?.error }
  } catch (err) {
    return { ok: false, removed: 0, error: String(err) }
  }
}

/** 清空指定月份（缺省清空全部）调用日志 */
export async function clearAiLogs(month?: string): Promise<{ ok: boolean; removed: number; error?: string }> {
  try {
    const res = await window.mdAPI?.aiLogClear({ month })
    return { ok: !!res?.ok, removed: res?.removed || 0, error: res?.error }
  } catch (err) {
    return { ok: false, removed: 0, error: String(err) }
  }
}

/** 在系统文件管理器中打开日志目录 */
export async function openAiLogDir(): Promise<{ ok: boolean; dir?: string; error?: string }> {
  try {
    return (await window.mdAPI?.aiLogOpenDir()) || { ok: false, error: '主进程不可用' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 测试指定厂商连接 */
export async function aiTest(provider: AiProvider): Promise<{ ok: boolean; reply?: string; elapsed?: number; error?: string }> {
  try {
    return (await window.mdAPI?.aiTest(toPlain(provider))) || { ok: false, error: '主进程不可用' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 提取文件内容供 AI 使用（文本 / Office / 图片） */
export async function extractFileForAi(filePath: string): Promise<AiFileAttachment | null> {
  try {
    return (await window.mdAPI?.extractFileForAi(filePath)) || null
  } catch (err) {
    return {
      ok: false,
      kind: 'unsupported',
      name: filePath.split(/[\\/]/).pop() || filePath,
      path: filePath,
      ext: '',
      size: 0,
      error: String(err),
    }
  }
}

/** 弹出文件选择框，选取要引用给 AI 的文件（可多选） */
export async function pickAiFiles(): Promise<string[]> {
  try {
    const res = await window.mdAPI?.selectAiFiles()
    if (!res || res.canceled) return []
    return res.filePaths || []
  } catch (err) {
    console.warn('选择 AI 引用文件失败：', err)
    return []
  }
}

/* ========== 目录树拖拽到 AI 面板（文件 / 文件夹引用） ========== */

/** 目录树节点拖拽时使用的自定义 dataTransfer 类型：跨组件传递路径，且不会被文本拖拽混淆 */
export const AI_DROP_MIME = 'application/x-md-ai-file'

/** 拖入 AI 面板的目录树节点（文件或文件夹） */
export interface AiDropPayload {
  /** 节点绝对路径 */
  path: string
  /** 节点名称（用于提示文案） */
  name: string
  /** 是否为文件夹 */
  isDirectory: boolean
}

/**
 * 写入目录树节点的拖拽数据（dragstart 时调用）。
 * 同时写入纯文本路径，便于拖到系统其它目标时仍可用。
 * @param e 拖拽事件
 * @param payload 节点信息
 */
export function writeAiDropPayload(e: DragEvent, payload: AiDropPayload): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.setData(AI_DROP_MIME, JSON.stringify(payload))
  dt.setData('text/plain', payload.path)
  dt.effectAllowed = 'copy'
}

/**
 * 判断拖拽事件是否携带目录树节点（dragover / dragenter 阶段用）。
 * 浏览器在该阶段不允许读取 data，只能通过 types 判断。
 * @param e 拖拽事件
 */
export function hasAiDropPayload(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes(AI_DROP_MIME)
}

/**
 * 读取拖拽事件中的目录树节点（drop 阶段用）。
 * @param e 拖拽事件
 * @returns 节点信息，非目录树拖拽时返回 null
 */
export function readAiDropPayload(e: DragEvent): AiDropPayload | null {
  const raw = e.dataTransfer?.getData(AI_DROP_MIME)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as AiDropPayload
    return data?.path ? data : null
  } catch {
    return null
  }
}

/**
 * 判断拖拽事件是否为系统文件拖拽。
 * 目录树节点走的是系统级文件拖拽，拖回页面内部时即表现为 Files。
 * @param e 拖拽事件
 * @returns 是系统文件拖拽时返回 true
 */
export function hasSystemFiles(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files')
}

/**
 * 取得拖入文件的磁盘绝对路径（优先 webUtils，兼容旧版 File.path）
 * @param file 拖入的文件对象
 * @returns 绝对路径，取不到时返回空串
 */
export function resolveDroppedFilePath(file: File): string {
  try {
    const p = window.mdAPI?.getPathForFile?.(file)
    if (p) return p
  } catch {
    // 忽略：回退到已废弃的 File.path
  }
  return (file as File & { path?: string }).path || ''
}

/**
 * 读取系统文件拖拽中的第一个文件 / 文件夹（拖回页面内部时用于还原节点信息）
 * @param e 拖拽事件
 * @returns 节点信息，非系统文件拖拽时返回 null
 */
export async function readSystemFilePayload(e: DragEvent): Promise<AiDropPayload | null> {
  const file = e.dataTransfer?.files?.[0]
  if (!file) return null
  const filePath = resolveDroppedFilePath(file)
  if (!filePath) return null
  const name = filePath.split(/[\\/]/).pop() || filePath
  let isDirectory = false
  try {
    const res = await window.mdAPI?.statPath(filePath)
    isDirectory = !!res?.isDirectory
  } catch {
    // 忽略：按文件处理
  }
  return { path: filePath, name, isDirectory }
}

/** 可作为 AI 上下文的文本扩展名（与主进程 extractFileForAi 的文本 / 文档类型保持一致） */
const AI_TEXT_EXT_SET = new Set([
  'txt', 'md', 'markdown', 'mdown', 'mkd', 'json', 'xml', 'yaml', 'yml', 'csv', 'log',
  'ini', 'conf', 'properties', 'sql', 'java', 'py', 'js', 'ts', 'jsx', 'tsx', 'c', 'cpp',
  'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'cmd', 'html', 'htm', 'css', 'scss',
  'less', 'vue', 'tex', 'toml', 'env',
  'doc', 'docx', 'docm', 'ppt', 'pptx', 'pps', 'pot', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'odt', 'ods', 'odp', 'rtf', 'epub', 'pdf',
])

/** 可作为 AI 上下文的图片扩展名（走多模态，体积远大于文本，文件夹拖入时单独限量） */
const AI_IMAGE_EXT_SET = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'])

/** 收集文件夹时跳过的目录名（依赖 / 构建产物 / 版本控制等，避免大量无关文件进入上下文） */
const AI_SKIP_DIR_SET = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.cache', '__pycache__', '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'vendor',
])

/** 文件夹拖入时最多引用的文件数 */
const AI_DIR_MAX_FILES = 20
/** 文件夹拖入时最多引用的图片数 */
const AI_DIR_MAX_IMAGES = 3
/** 文件夹递归层级上限 */
const AI_DIR_MAX_DEPTH = 5
/** 收集文件夹时最多遍历的目录数 */
const AI_DIR_MAX_DIRS = 200
/** 单个文件大小上限（超过则跳过，避免超大文件撑爆上下文） */
const AI_FILE_MAX_SIZE = 5 * 1024 * 1024

/** 文件夹收集结果 */
export interface AiCollectResult {
  /** 可作为 AI 上下文的文件路径 */
  files: string[]
  /** 是否因数量上限只取了部分文件 */
  truncated: boolean
}

/** 取文件名的扩展名（小写，无扩展名时为空串） */
function extOfName(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/** 判断文件是否为 AI 可解析的类型（文本 / 文档 / 图片，无扩展名按文本处理） */
function isAiSupportedFile(name: string): boolean {
  const ext = extOfName(name)
  return ext === '' || AI_TEXT_EXT_SET.has(ext) || AI_IMAGE_EXT_SET.has(ext)
}

/**
 * 把拖入的文件 / 文件夹解析为可引用的文件列表。
 * 文件夹按层级遍历（跳过依赖与构建目录），达到文件数上限时只取先遍历到的文件。
 * @param payload 拖入的目录树节点
 * @returns 文件列表与是否被截断
 */
export async function collectFilesForAi(payload: AiDropPayload): Promise<AiCollectResult> {
  if (!payload.isDirectory) return { files: [payload.path], truncated: false }
  const files: string[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: payload.path, depth: 1 }]
  let images = 0
  let dirs = 0
  let truncated = false
  while (queue.length) {
    const cur = queue.shift()!
    if (dirs >= AI_DIR_MAX_DIRS) {
      truncated = true
      break
    }
    dirs++
    const res = await window.mdAPI?.readDir(cur.path)
    if (!res?.ok) continue
    for (const c of res.children || []) {
      if (c.isDirectory) {
        if (cur.depth >= AI_DIR_MAX_DEPTH || AI_SKIP_DIR_SET.has(c.name)) continue
        queue.push({ path: c.path, depth: cur.depth + 1 })
        continue
      }
      if (!isAiSupportedFile(c.name) || c.size > AI_FILE_MAX_SIZE) continue
      if (AI_IMAGE_EXT_SET.has(extOfName(c.name))) {
        if (images >= AI_DIR_MAX_IMAGES) continue
        images++
      }
      if (files.length >= AI_DIR_MAX_FILES) {
        truncated = true
        continue
      }
      files.push(c.path)
    }
  }
  return { files, truncated }
}

/** 从 AI 返回内容中剥离可能的代码块包裹，得到纯文本 */
export function stripCodeFence(text: string): string {
  const trimmed = (text || '').trim()
  // yaml / yml / json 一并识别：AI 返回元数据时常使用 ```yaml 围栏
  const fence = /^```(?:markdown|md|text|yaml|yml|json)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed)
  return fence ? fence[1].trim() : trimmed
}

/**
 * 将 AI 生成的概要包装为提示块（GitHub Alert 语法），用于插入到文章大标题之下。
 * 例：
 * > [!NOTE] 文章概要
 * > 1. 核心要点一
 * > 2. 核心要点二
 */
/**
 * 从 AI 返回内容中提取目标语言的代码（去掉围栏与围栏外的说明文字）。
 * 优先取指定语言的围栏，其次取任意围栏，最后回退为原文。
 */
export function extractDiagramCode(text: string, lang: string): string {
  const raw = (text || '').trim()
  if (!raw) return ''
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 1. ```lang ... ```
  const named = new RegExp('```' + escape(lang) + '\\s*\\n([\\s\\S]*?)```', 'i').exec(raw)
  if (named) return named[1].trim()
  // 2. ``` ... ```（AI 未标注语言或标注了其他语言）
  const any = /```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)```/.exec(raw)
  if (any) return any[1].trim()
  // 3. 围栏未闭合：去掉首行的 ```xxx
  const unclosed = /^```[a-zA-Z0-9_+-]*\s*\n([\s\S]*)$/.exec(raw)
  if (unclosed) return unclosed[1].trim()
  return raw
}

/** 将代码包装为带语言标识的代码块，插入文档后即可被渲染为图表 */
export function buildDiagramBlock(code: string, lang: string): string {
  const body = (code || '').trim()
  if (!body) return ''
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

export function buildOutlineBlock(text: string): string {
  let body = stripCodeFence(text || '').trim()
  // 去掉 AI 可能输出的 "## 文章概要" 之类标题，只保留正文
  body = body.replace(/^#{1,6}\s*[【《]?(?:文章概要|概要)[】》]?\s*:?\s*\n+/i, '')
  if (!body) return ''
  const lines = body.split('\n').map((line) => (line.trim() ? `> ${line}` : '>'))
  return `> [!NOTE] 文章概要\n${lines.join('\n')}`
}
