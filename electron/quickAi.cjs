/**
 * 快捷 AI 动作配置（Electron 主进程模块）
 * - 内置常用快捷生成类型（润色 / 扩写 / 概要 / 翻译 …），每种类型自带默认提示词
 * - 内置提示词可定制修改：名称、提示词、适用范围、结果处理方式、启用状态均可编辑
 * - 支持新增自定义类型、恢复内置默认、停用与排序
 * - 配置以 JSON 持久化（路径由调用方传入，通常为 app.getPath('userData') 下）
 * - 文件缺失或损坏时自动回落内置默认值，保证功能始终可用
 */
const fs = require('fs')

/** 配置结构版本号（后续结构调整时用于兼容处理） */
const CONFIG_VERSION = 1

/** 适用范围取值：doc 全文 / selection 选中文本 / auto 自动（有选中用选中，否则全文） */
const SCOPES = ['doc', 'selection', 'auto']

/**
 * 结果处理方式取值
 * replace 替换全文 / append 追加文末 / caret 插入光标处 / prepend 插入文首
 * outline 插入概要块 / metadata 合并到文档头部元数据 / auto 自动
 */
const APPLIES = ['replace', 'append', 'caret', 'prepend', 'outline', 'metadata', 'auto']

/** 内置快捷 AI 动作：新增类型只需在此追加一项（图标名由渲染进程映射为组件） */
const BUILTIN_ACTIONS = [
  {
    id: 'polish',
    name: '润色',
    desc: '优化语句与措辞，保持原文结构与观点不变',
    icon: 'EditPen',
    scope: 'doc',
    apply: 'replace',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请对下面给出的内容进行润色：',
      '1. 优化语句表达与措辞，修正语病、错别字，使行文更流畅、专业；',
      '2. 保持原有的标题层级、段落结构、列表、代码块、链接等格式不变；',
      '3. 不要改变原文的实质内容与观点；',
      '4. 直接输出润色后的完整内容，不要添加任何解释或前后缀。',
      '',
      '以下是待润色的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'expand',
    name: '扩写',
    desc: '在保持结构的前提下补充内容、细节与示例',
    icon: 'DocumentAdd',
    scope: 'doc',
    apply: 'replace',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请对下面给出的内容进行扩写：',
      '1. 在保持原有标题层级与整体结构的前提下，为各章节补充更充分的内容、细节、论据或示例；',
      '2. 语言风格与原文保持一致，行文自然流畅；',
      '3. 保留原有的关键信息与代码块、链接、列表等格式；',
      '4. 直接输出扩写后的完整内容，不要添加任何解释或前后缀。',
      '',
      '以下是待扩写的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'condense',
    name: '精简',
    desc: '压缩篇幅，保留核心观点与关键信息',
    icon: 'DocumentRemove',
    scope: 'doc',
    apply: 'replace',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请对下面给出的内容进行精简：',
      '1. 在保留核心观点、关键结论与重要数据完整的前提下压缩篇幅；',
      '2. 删除重复表述、冗余铺垫与无关细节，合并可合并的段落；',
      '3. 保留原有的标题层级与代码块、链接、表格等关键格式；',
      '4. 直接输出精简后的完整内容，不要添加任何解释或前后缀。',
      '',
      '以下是待精简的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'outline',
    name: '概要生成',
    desc: '提炼核心要点，以有序列表输出文章概要',
    icon: 'Tickets',
    scope: 'doc',
    apply: 'outline',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请阅读下面给出的内容，生成一份"文章概要"：',
      '1. 概要需要提炼内容的核心主题、关键要点与结构；',
      '2. 以有序列表（1. 2. 3. …）输出概要要点，每条一句话左右，覆盖主要章节与结论；',
      '3. 只输出列表内容本身，不要输出任何标题、引言、解释或前后缀。',
      '',
      '以下是需要生成概要的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'title',
    name: '标题生成',
    desc: '为文档拟定一个贴切的一级标题',
    icon: 'Notebook',
    scope: 'doc',
    apply: 'prepend',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请为下面给出的内容拟定一个合适的标题：',
      '1. 只输出一个标题，格式为一级 Markdown 标题（# 标题）；',
      '2. 标题需准确概括内容主题，简洁有力，不超过 30 个字；',
      '3. 语言与原文保持一致；',
      '4. 不要输出任何解释、引言、候选列表或前后缀。',
      '',
      '以下是待拟标题的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'translate',
    name: '翻译',
    desc: '中英互译，保持 Markdown 格式不变',
    icon: 'Promotion',
    scope: 'auto',
    apply: 'auto',
    prompt: [
      '你是一名专业的翻译助手。请将下面给出的内容在中英文之间互译：',
      '1. 原文为中文时译为英文，原文为英文时译为中文，其他语言统一译为英文；',
      '2. 保持 Markdown 格式（标题、列表、代码块、链接、表格）不变，代码本身不翻译，必要的注释可翻译；',
      '3. 专业术语、人名、产品名与专有名词保持原样，不音译；',
      '4. 译文需符合目标语言的表达习惯，不要逐字直译；',
      '5. 只输出翻译后的内容，不要添加任何解释或前后缀。',
      '',
      '以下是待翻译的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'continue',
    name: '续写',
    desc: '沿用原文风格继续往下写，追加到文末',
    icon: 'Edit',
    scope: 'doc',
    apply: 'append',
    prompt: [
      '你是一名专业的 Markdown 写作助手。请对下面给出的内容进行续写：',
      '1. 延续原文的语气、风格、叙事视角与排版格式继续往下写；',
      '2. 承接原文末尾的内容自然展开，补充新的段落或章节，篇幅适中；',
      '3. 不要重复已写内容，不要改写或总结原文；',
      '4. 只输出续写的新内容，不要包含原文，也不要添加解释或前后缀。',
      '',
      '以下是待续写的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'proofread',
    name: '校对纠错',
    desc: '修正错别字、标点误用与语病，不改结构',
    icon: 'CircleCheck',
    scope: 'doc',
    apply: 'replace',
    prompt: [
      '你是一名严谨的文字校对助手。请对下面给出的内容做错别字与语病校对：',
      '1. 修正错别字、标点误用、语法错误与明显的表述矛盾；',
      '2. 不改变原文的结构、语气与观点，不做润色性改写；',
      '3. 保留 Markdown 格式（标题、列表、代码块、链接、表格）不变；',
      '4. 先输出校对后的完整内容，再在文末以单独一行「校对说明：」列出主要修改点；未发现问题时说明"未发现明显错误"。',
      '',
      '以下是待校对的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'format',
    name: '格式整理',
    desc: '规范标题层级、列表与代码块，保证渲染正常',
    icon: 'Finished',
    scope: 'doc',
    apply: 'replace',
    prompt: [
      '你是一名 Markdown 排版助手。请对下面给出的内容做格式规范化整理：',
      '1. 统一标题层级与列表符号，补齐缺失的空行，规范代码块的语言标识；',
      '2. 修正断裂的表格、错误的引用与链接语法，使文档可被标准 Markdown 渲染器正确渲染；',
      '3. 不改动文字内容本身，不增删观点；',
      '4. 只输出整理后的完整内容，不要添加任何解释或前后缀。',
      '',
      '以下是待整理的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'tags',
    name: '关键词摘要',
    desc: '提取关键词并生成简短摘要，追加到文末',
    icon: 'CollectionTag',
    scope: 'doc',
    apply: 'append',
    prompt: [
      '你是一名文档分析助手。请基于下面给出的内容提取关键词并生成摘要：',
      '1. 第一行输出 3-6 个关键词，格式为「关键词：A、B、C」；',
      '2. 空一行后输出一段摘要，格式为「摘要：……」，不超过 80 字；',
      '3. 语言与原文保持一致；',
      '4. 只输出上述两行内容，不要输出标题、解释或前后缀。',
      '',
      '以下是待分析的内容：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
  {
    id: 'metadata',
    name: '元数据',
    desc: '生成 / 补全核心元数据，一键合并到文档头部（时间字段由系统维护）',
    icon: 'Postcard',
    scope: 'doc',
    apply: 'metadata',
    prompt: [
      '你是一名文档元数据编辑助手。请阅读下面给出的 Markdown 文档，为它生成或补全 YAML Front Matter 元数据。',
      '',
      '【输出格式】',
      '1. 只输出 YAML 字段，每行一个，格式为「key: value」；',
      '2. 不要输出代码块围栏、不要输出 --- 分隔线、不要输出任何解释或前后缀；',
      '3. 不要输出任何注释行：不要写以 # 开头的行，也不要在字段后面加行内说明；',
      '4. 只能使用下面列出的字段，不要自定义新字段；',
      '',
      '【字段清单】（本工具只支持这些字段）',
      'title：标题，简洁准确，不超过 30 字；',
      'emoji：一个能代表文档主题的 emoji；',
      'description：摘要，一句话说明文档讲什么、适合谁看，不超过 120 字；',
      'keywords：关键词，3-6 个，用顿号分隔；',
      'tags：标签，3-6 个，数组格式 [标签1, 标签2]；',
      'category：分类，所属分类目录，单个；',
      'series：系列，所属系列或专栏，没有则留空；',
      'author：作者名，无法确定则留空；',
      'status：状态，取值 draft、review、published、archived 之一；',
      '',
      '【重要约束】',
      '1. 禁止输出 createDate 与 lastUpdateDate，这两个字段由系统维护，输出了也会被忽略；',
      '2. 只输出能确定的字段：无法确定的字段整行不要写出，不要写空值占位（如「key:」），更不要编造；',
      '3. 文档头部已有对应字段且取值合理时直接沿用，不要改写；',
      '4. 语言与正文保持一致。',
      '',
      '以下是待生成元数据的文档：',
      '```markdown',
      '{content}',
      '```',
    ].join('\n'),
  },
]

/**
 * 构造一份内置默认动作列表（深拷贝，避免调用方修改污染常量）
 * @returns {Array<object>} 默认动作列表
 */
function buildDefaultActions() {
  return BUILTIN_ACTIONS.map((item) => ({ ...item, builtin: true, enabled: true }))
}

/**
 * 构造内置默认配置
 * @returns {{ version: number, actions: Array<object> }} 默认配置
 */
function buildDefaultConfig() {
  return { version: CONFIG_VERSION, actions: buildDefaultActions() }
}

/**
 * 取有效文本，为空时回落默认值
 * @param {unknown} value 待校验值
 * @param {string} fallback 默认值
 * @returns {string} 文本
 */
function pickText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

/**
 * 规范化单个动作：字段缺失或非法时回落内置默认值
 * @param {object} input 存储中的动作
 * @param {object|undefined} defaultItem 同 id 的内置动作（存在则视为内置类型）
 * @returns {object} 规范化后的动作
 */
function normalizeAction(input, defaultItem) {
  const src = input && typeof input === 'object' ? input : {}
  const base = defaultItem || {
    id: '',
    name: '',
    desc: '',
    icon: 'MagicStick',
    scope: 'auto',
    apply: 'auto',
    prompt: '',
  }
  return {
    id: String(base.id || src.id || '').trim(),
    name: pickText(src.name, base.name || '未命名'),
    desc: pickText(src.desc, base.desc || ''),
    icon: pickText(src.icon, base.icon || 'MagicStick'),
    scope: SCOPES.includes(src.scope) ? src.scope : base.scope,
    apply: APPLIES.includes(src.apply) ? src.apply : base.apply,
    prompt: pickText(src.prompt, base.prompt || ''),
    builtin: !!defaultItem,
    enabled: src.enabled !== false,
  }
}

/**
 * 合并存储中的动作与内置默认动作：保留用户改动，并补齐新增的内置类型
 * @param {unknown} stored 存储中的动作数组
 * @returns {Array<object>} 合并后的动作列表
 */
function mergeActions(stored) {
  const defaults = buildDefaultActions()
  const list = Array.isArray(stored) ? stored : []
  const byId = new Map()
  const order = []
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (!id || byId.has(id)) continue
    byId.set(id, item)
    order.push(id)
  }
  const result = order.map((id) => normalizeAction(byId.get(id), defaults.find((d) => d.id === id)))
  // 版本升级后新增的内置类型：追加到末尾，保证老配置也能用上新功能
  for (const item of defaults) {
    if (!byId.has(item.id)) result.push({ ...item })
  }
  return result.filter((item) => item.id && item.prompt)
}

/**
 * 读取快捷 AI 配置：文件缺失、损坏或字段缺失时自动补齐为内置默认值
 * @param {string} configPath 配置文件路径
 * @returns {{ version: number, actions: Array<object> }} 配置
 */
function getQuickAiConfig(configPath) {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {}
  } catch {
    /* 首次运行或文件损坏时使用内置默认配置 */
  }
  return { version: CONFIG_VERSION, actions: mergeActions(stored.actions) }
}

/**
 * 保存快捷 AI 配置（自动与内置默认合并，过滤非法项）
 * @param {string} configPath 配置文件路径
 * @param {object} config 待保存配置
 * @returns {Promise<object>} 保存后的配置
 */
async function saveQuickAiConfig(configPath, config) {
  const actions = mergeActions(config?.actions)
  const payload = { version: CONFIG_VERSION, actions }
  await fs.promises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf-8')
  return payload
}

/**
 * 恢复内置默认动作（不落盘，由页面确认保存后写入）
 * @param {string} configPath 配置文件路径
 * @param {object} payload 重置参数：id 为空时恢复全部，否则只恢复指定动作
 * @returns {object} 恢复后的配置
 */
function resetQuickAiConfig(configPath, payload = {}) {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
  if (!id) return buildDefaultConfig()
  const current = getQuickAiConfig(configPath)
  const def = buildDefaultActions().find((d) => d.id === id)
  const idx = current.actions.findIndex((a) => a.id === id)
  if (!def || idx === -1) return current
  // 只重置内容，保留当前的启用状态与位置
  current.actions[idx] = { ...def, enabled: current.actions[idx].enabled !== false }
  return current
}

module.exports = {
  CONFIG_VERSION,
  SCOPES,
  APPLIES,
  BUILTIN_ACTIONS,
  buildDefaultActions,
  buildDefaultConfig,
  getQuickAiConfig,
  saveQuickAiConfig,
  resetQuickAiConfig,
}
