/**
 * AI 配置与对话（Electron 主进程模块）
 * - 内置常见 AI 厂商预设，支持 OpenAI 兼容 / Anthropic / Gemini 三种协议
 * - 配置以 JSON 文件持久化（路径由调用方传入，通常为 app.getPath('userData') 下）
 */
const fs = require('fs')
const path = require('path')
const docConvert = require('./docConvert.cjs')

// 内置 AI 厂商预设（format: openai 为 OpenAI 兼容格式；anthropic / gemini 为各自原生格式）
const AI_BUILTIN_PROVIDERS = [
  {
    id: 'openai', name: 'OpenAI', format: 'openai',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', temperature: 0.7,
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', format: 'anthropic',
    baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', temperature: 0.7,
  },
  {
    id: 'google', name: 'Google Gemini', format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash', temperature: 0.7,
  },
  {
    id: 'deepseek', name: 'DeepSeek', format: 'openai',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.7,
  },
  {
    id: 'moonshot', name: 'Moonshot Kimi', format: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', temperature: 0.7,
  },
  {
    id: 'qwen', name: '阿里云百炼 Qwen', format: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', temperature: 0.7,
  },
  {
    id: 'zhipu', name: '智谱 GLM', format: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', temperature: 0.7,
  },
  {
    id: 'ollama', name: 'Ollama（本地）', format: 'openai',
    baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', temperature: 0.7,
  },
]

const AI_REQUEST_TIMEOUT = 180000 // 180s

/**
 * 读取 AI 配置：
 * - 内置厂商始终存在（允许用户覆盖 baseUrl / apiKey / model / temperature）
 * - 自定义厂商从配置文件恢复（custom: true）
 */
function getAiConfig(configPath) {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {}
  } catch {
    /* 首次运行或文件损坏时使用默认配置 */
  }
  const storedProviders = Array.isArray(stored.providers) ? stored.providers : []
  const savedById = new Map(storedProviders.map((p) => [p.id, p]))
  const providers = AI_BUILTIN_PROVIDERS.map((preset) => {
    const saved = savedById.get(preset.id) || {}
    return { ...preset, ...saved, builtin: true, custom: false }
  })
  for (const p of storedProviders) {
    if (p.custom && !AI_BUILTIN_PROVIDERS.some((b) => b.id === p.id)) {
      providers.push({ ...p, builtin: false, custom: true })
    }
  }
  const activeId =
    stored.activeProviderId && providers.some((p) => p.id === stored.activeProviderId)
      ? stored.activeProviderId
      : providers[0]?.id || ''
  return { activeProviderId: activeId, providers }
}

/** 保存 AI 配置 */
async function saveAiConfig(configPath, config) {
  const providers = Array.isArray(config?.providers) ? config.providers : []
  const payload = {
    activeProviderId: config?.activeProviderId || '',
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      format: p.format || 'openai',
      baseUrl: p.baseUrl,
      apiKey: p.apiKey || '',
      model: p.model,
      temperature: p.temperature ?? 0.7,
      // 工具调用开关（skill 执行要求支持；未设置视为开启）
      toolSupport: p.toolSupport !== false,
      custom: !!p.custom,
    })),
  }
  await fs.promises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf-8')
}

/**
 * 按厂商协议构造请求（URL / 请求头 / 请求体），供一次性与流式调用共用。
 * @param {object} provider { id, name, format, baseUrl, apiKey, model, temperature }
 * @param {Array<{role:string, content:string}>} messages 对话消息
 * @param {number} [temperature] 温度
 * @param {boolean} stream 是否流式输出
 * @returns {{ url: string, headers: object, body: object }} 请求描述
 */
function buildRequest(provider, messages, temperature, stream) {
  const fmt = provider.format || 'openai'
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')
  const apiKey = provider.apiKey || ''
  const model = provider.model || ''
  if (!baseUrl || !model) throw new Error('请先在 AI 配置中填写服务地址与模型')

  if (fmt === 'anthropic') {
    if (!apiKey) throw new Error('请填写 Anthropic API Key')
    const system = messages.filter((m) => m.role === 'system').map((m) => toPlainText(m.content)).join('\n\n')
    const body = {
      model,
      max_tokens: 8192,
      temperature: temperature ?? 0.7,
      stream: !!stream,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
    }
    if (system) body.system = system
    return {
      url: `${baseUrl}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
    }
  }

  if (fmt === 'gemini') {
    const sys = messages.find((m) => m.role === 'system')?.content
    const body = {
      contents: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: toGeminiParts(m.content),
        })),
    }
    if (sys) body.systemInstruction = { parts: toGeminiParts(sys) }
    const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    return {
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(apiKey)}`,
      headers: { 'content-type': 'application/json' },
      body,
    }
  }

  // openai 兼容格式（默认；Ollama 等本地模型可不填 Key）
  const headers = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content) })),
    temperature: temperature ?? 0.7,
    stream: !!stream,
  }
  // 流式请求显式要求服务端回传用量（部分厂商默认不返回，用于统计输入输出 Token）
  if (stream) body.stream_options = { include_usage: true }
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body,
  }
}

/**
 * 从一次性响应中提取 Token 用量（不同协议字段不同）
 * @param {string} fmt 协议格式：openai / anthropic / gemini
 * @param {object} data 响应 JSON
 * @returns {{ input: number, output: number, total: number } | null} 用量，缺失时返回 null
 */
function extractUsage(fmt, data) {
  if (!data || typeof data !== 'object') return null
  if (fmt === 'anthropic') {
    const u = data.usage || {}
    if (!Number.isFinite(u.input_tokens) && !Number.isFinite(u.output_tokens)) return null
    const input = Number(u.input_tokens) || 0
    const output = Number(u.output_tokens) || 0
    return { input, output, total: input + output }
  }
  if (fmt === 'gemini') {
    const u = data.usageMetadata || {}
    if (!Number.isFinite(u.promptTokenCount) && !Number.isFinite(u.candidatesTokenCount)) return null
    const input = Number(u.promptTokenCount) || 0
    const output = Number(u.candidatesTokenCount) || 0
    return { input, output, total: Number(u.totalTokenCount) || input + output }
  }
  const u = data.usage || {}
  if (!Number.isFinite(u.prompt_tokens) && !Number.isFinite(u.completion_tokens)) return null
  const input = Number(u.prompt_tokens) || 0
  const output = Number(u.completion_tokens) || 0
  return { input, output, total: Number(u.total_tokens) || input + output }
}

/**
 * 从流式事件中提取 Token 用量（同一请求的用量分散在多个事件里，需合并）
 * @param {string} fmt 协议格式：openai / anthropic / gemini
 * @param {object} json 事件数据
 * @returns {{ input: number|null, output: number|null, total: number|null } | null} 用量
 */
function extractStreamUsage(fmt, json) {
  if (!json || typeof json !== 'object') return null
  if (fmt === 'anthropic') {
    // message_start 携带输入用量，message_delta 携带输出用量
    if (json.type === 'message_start' && Number.isFinite(json.message?.usage?.input_tokens)) {
      return { input: Number(json.message.usage.input_tokens), output: null, total: null }
    }
    if (json.type === 'message_delta' && Number.isFinite(json.usage?.output_tokens)) {
      return { input: null, output: Number(json.usage.output_tokens), total: null }
    }
    return null
  }
  if (fmt === 'gemini') {
    const u = json.usageMetadata
    if (!u) return null
    return {
      input: Number.isFinite(u.promptTokenCount) ? Number(u.promptTokenCount) : null,
      output: Number.isFinite(u.candidatesTokenCount) ? Number(u.candidatesTokenCount) : null,
      total: Number.isFinite(u.totalTokenCount) ? Number(u.totalTokenCount) : null,
    }
  }
  const u = json.usage
  if (!u) return null
  return {
    input: Number.isFinite(u.prompt_tokens) ? Number(u.prompt_tokens) : null,
    output: Number.isFinite(u.completion_tokens) ? Number(u.completion_tokens) : null,
    total: Number.isFinite(u.total_tokens) ? Number(u.total_tokens) : null,
  }
}

/**
 * 合并多个流式事件中的用量字段（保留最新一次的非空值）
 * @param {object|null} acc 累积用量
 * @param {object|null} next 新用量
 * @returns {object|null} 合并后的用量
 */
function mergeUsage(acc, next) {
  if (!next) return acc
  if (!acc) return { input: next.input ?? null, output: next.output ?? null, total: next.total ?? null }
  return {
    input: next.input ?? acc.input,
    output: next.output ?? acc.output,
    total: next.total ?? acc.total,
  }
}

/**
 * 从一次性响应中提取结束原因（不同协议字段不同）
 * @param {string} fmt 协议格式
 * @param {object} data 响应 JSON
 * @returns {string} 结束原因，缺失时为空串
 */
function extractFinishReason(fmt, data) {
  if (!data || typeof data !== 'object') return ''
  if (fmt === 'anthropic') return data.stop_reason || ''
  if (fmt === 'gemini') return data.candidates?.[0]?.finishReason || ''
  return data.choices?.[0]?.finish_reason || ''
}

/**
 * 一次性调用指定厂商接口；配置不合法或请求失败时抛出 Error
 * @param {object} provider { id, name, format, baseUrl, apiKey, model, temperature }
 * @param {Array<{role:string, content:string}>} messages
 * @param {number} [temperature]
 * @returns {Promise<{ content: string, request: object, messages: Array, usage: object|null, finishReason: string, elapsedMs: number }>}
 *   含实际请求信息与 Token 用量（供调用日志使用）
 */
async function chatWithProvider(provider, messages, temperature) {
  const fmt = provider.format || 'openai'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT)
  const started = Date.now()
  try {
    const { url, headers, body } = buildRequest(provider, messages, temperature, false)
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`)
    let content = ''
    if (fmt === 'anthropic') {
      content = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
    } else if (fmt === 'gemini') {
      content = (data.candidates || [])
        .flatMap((c) => c.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
    } else {
      content = data.choices?.[0]?.message?.content ?? ''
    }
    return {
      content,
      request: { url, headers, body },
      messages,
      usage: extractUsage(fmt, data),
      finishReason: extractFinishReason(fmt, data),
      elapsedMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 逐行读取 SSE 响应体（data: 开头的事件行）。
 * @param {Response} res fetch 响应
 * @returns {AsyncGenerator<string>} 事件行（不含末尾换行）
 */
async function* readSseLines(res) {
  if (!res.body || typeof res.body.getReader !== 'function') return
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) yield line
        idx = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield buffer.trim()
  } finally {
    reader.releaseLock?.()
  }
}

/**
 * 从单条 SSE 数据中取出增量文本（不同协议字段不同）。
 * @param {string} fmt 协议格式：openai / anthropic / gemini
 * @param {object} json 已解析的事件数据
 * @returns {string} 增量文本，无增量时为空串
 */
function extractStreamDelta(fmt, json) {
  if (!json || typeof json !== 'object') return ''
  if (fmt === 'anthropic') {
    if (typeof json.delta?.text === 'string') return json.delta.text
    if (typeof json.completion === 'string') return json.completion
    return ''
  }
  if (fmt === 'gemini') {
    return (json.candidates || [])
      .flatMap((c) => c.content?.parts || [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
  }
  const choice = json.choices?.[0]
  if (typeof choice?.delta?.content === 'string') return choice.delta.content
  if (typeof choice?.message?.content === 'string') return choice.message.content
  if (typeof choice?.text === 'string') return choice.text
  return ''
}

/**
 * 流式调用指定厂商接口，通过 onDelta 逐段回调生成的文本。
 * 支持 OpenAI 兼容 / Anthropic / Gemini 三种协议；厂商不支持流式时由调用方降级为一次性请求。
 * @param {object} provider { id, name, format, baseUrl, apiKey, model, temperature }
 * @param {Array<{role:string, content:string}>} messages 对话消息
 * @param {number} [temperature] 温度
 * @param {{ onDelta?: (text: string) => void, signal?: AbortSignal }} options 增量回调与外部中断信号
 * @returns {Promise<{ content: string, request: object, messages: Array, usage: object|null, finishReason: string, elapsedMs: number }>}
 *   content 为拼接后的完整文本，其余字段供调用日志使用
 */
async function chatStreamWithProvider(provider, messages, temperature, options = {}) {
  const fmt = provider.format || 'openai'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT)
  /** 外部中断时同步终止内部请求 */
  const onAbort = () => controller.abort()
  options.signal?.addEventListener?.('abort', onAbort)
  const started = Date.now()
  let full = ''
  let usage = null
  let finishReason = ''
  let retryHint = false // 是否因不支持 stream_options 而重试过
  try {
    const built = buildRequest(provider, messages, temperature, true)
    const { url, headers } = built
    const send = (body) =>
      fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      })
    let body = built.body
    let res = await send(body)
    // 部分兼容服务不识别 stream_options：去掉后重试一次，保证主流程可用（仅丢失用量统计）
    if (!res.ok && res.status === 400 && body.stream_options) {
      const text = await res.text().catch(() => '')
      if (/stream_options/i.test(text)) {
        retryHint = true
        body = { ...body }
        delete body.stream_options
        res = await send(body)
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let message = `HTTP ${res.status}`
      try {
        message = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || message
      } catch {
        /* 非 JSON 错误响应，保留状态码提示 */
      }
      throw new Error(message)
    }
    if (!res.body) throw new Error('服务端未返回流式响应体')
    for await (const line of readSseLines(res)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let json = null
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      usage = mergeUsage(usage, extractStreamUsage(fmt, json))
      if (!finishReason) {
        if (fmt === 'anthropic') {
          if (json.type === 'message_delta' && json.delta?.stop_reason) finishReason = json.delta.stop_reason
          else if (json.type === 'message_start' && json.message?.stop_reason) finishReason = json.message.stop_reason
        } else if (fmt === 'gemini') {
          if (json.candidates?.[0]?.finishReason) finishReason = json.candidates[0].finishReason
        } else if (json.choices?.[0]?.finish_reason) {
          finishReason = json.choices[0].finish_reason
        }
      }
      const delta = extractStreamDelta(fmt, json)
      if (!delta) continue
      full += delta
      if (typeof options.onDelta === 'function') options.onDelta(delta)
    }
    return {
      content: full,
      request: { url, headers, body },
      messages,
      usage,
      finishReason,
      elapsedMs: Date.now() - started,
      retriedWithoutUsage: retryHint,
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener?.('abort', onAbort)
  }
}

// ============================================================
// 文件内容提取（供 AI 携带文件 / 图片作为上下文）
// ============================================================

const MAX_TEXT_CHARS = 60000 // 文本内容截断上限
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 图片多模态大小上限

/** 常见纯文本扩展名（直接读取内容） */
const TEXT_EXT_SET = new Set([
  'txt', 'md', 'markdown', 'mdown', 'mkd', 'json', 'xml', 'yaml', 'yml', 'csv', 'log',
  'ini', 'conf', 'properties', 'sql', 'java', 'py', 'js', 'ts', 'jsx', 'tsx', 'c', 'cpp',
  'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'cmd', 'html', 'htm', 'css', 'scss',
  'less', 'vue', 'tex', 'toml', 'env',
])

/** 图片扩展名 -> MIME */
const IMAGE_EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
}

/** 可用 anydoc 本地转换为 Markdown 的文档扩展名（Office / PDF / RTF / EPUB / ODT / CSV） */
const CONVERT_EXT_SET = new Set([
  'doc', 'docx', 'docm',
  'ppt', 'pptx', 'pps', 'pot', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb',
  'odt', 'ods', 'odp',
  'rtf', 'epub', 'csv', 'pdf',
])

/**
 * 提取文件内容供 AI 使用。
 * 返回 { ok, kind: 'text'|'image'|'unsupported', name, path, ext, size, content?, dataUrl?, mime?, truncated?, error? }
 */
async function extractFileForAi(filePath) {
  const name = path.basename(filePath)
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  const size = (await fs.promises.stat(filePath).catch(() => null))?.size || 0

  // 图片 -> 多模态 data URL
  if (IMAGE_EXT_MIME[ext]) {
    if (size > MAX_IMAGE_BYTES) {
      return {
        ok: true, kind: 'unsupported', name, path: filePath, ext, size,
        error: `图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，无法作为附件发送`,
      }
    }
    const mime = IMAGE_EXT_MIME[ext]
    const dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
    return { ok: true, kind: 'image', name, path: filePath, ext, size, mime, dataUrl }
  }

  // Office / PDF / RTF / EPUB / ODT / CSV 等文档 -> 本地转换为 Markdown
  if (CONVERT_EXT_SET.has(ext)) {
    const res = await docConvert.toMarkdown(filePath)
    if (!res.ok) {
      return { ok: true, kind: 'unsupported', name, path: filePath, ext, size, error: `无法解析 ${ext}：${res.error}` }
    }
    const content = res.markdown || ''
    if (!content.trim()) {
      return { ok: true, kind: 'unsupported', name, path: filePath, ext, size, error: `${ext} 中未提取到文本内容` }
    }
    const truncated = content.length > MAX_TEXT_CHARS
    return { ok: true, kind: 'text', name, path: filePath, ext, size, content: content.slice(0, MAX_TEXT_CHARS), truncated }
  }

  // 文本文件（含无扩展名）
  if (TEXT_EXT_SET.has(ext) || ext === '') {
    const content = await fs.promises.readFile(filePath, 'utf-8').catch((e) => {
      throw e
    })
    const truncated = content.length > MAX_TEXT_CHARS
    return { ok: true, kind: 'text', name, path: filePath, ext, size, content: content.slice(0, MAX_TEXT_CHARS), truncated }
  }

  return { ok: true, kind: 'unsupported', name, path: filePath, ext, size, error: `暂不支持解析 ${ext || '未知'} 类型文件` }
}

// ============================================================
// 多模态消息转换
// 统一 content 结构：
//   string | Array<{ type:'text', text } | { type:'image', mime, dataUrl }>
// ============================================================

/** 提取纯文本（用于 system 消息） */
function toPlainText(content) {
  if (typeof content === 'string') return content
  return (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

/** OpenAI 兼容格式 content */
function toOpenAiContent(content) {
  if (typeof content === 'string') return content
  return (content || []).map((c) =>
    c.type === 'image'
      ? { type: 'image_url', image_url: { url: c.dataUrl } }
      : { type: 'text', text: c.text },
  )
}

/** Anthropic 格式 content */
function toAnthropicContent(content) {
  if (typeof content === 'string') return content
  return (content || []).map((c) => {
    if (c.type !== 'image') return { type: 'text', text: c.text }
    const m = /^data:([^;]+);base64,(.*)$/s.exec(c.dataUrl || '')
    if (!m) return { type: 'text', text: `[图片: ${c.mime || 'unknown'}]` }
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
  })
}

/** Gemini 格式 parts */
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }]
  return (content || []).map((c) => {
    if (c.type !== 'image') return { text: c.text }
    const m = /^data:([^;]+);base64,(.*)$/s.exec(c.dataUrl || '')
    if (!m) return { text: `[图片: ${c.mime || 'unknown'}]` }
    return { inline_data: { mime_type: m[1], data: m[2] } }
  })
}

module.exports = {
  AI_BUILTIN_PROVIDERS,
  getAiConfig,
  saveAiConfig,
  chatWithProvider,
  chatStreamWithProvider,
  extractFileForAi,
}
