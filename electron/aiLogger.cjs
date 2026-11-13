/**
 * AI 调用日志（Electron 主进程模块）
 * - 记录每次大模型请求的参数、响应内容、输入输出 Token、模型信息与耗时
 * - 按月落盘为本地 JSON：{userData}/ai-logs/ai-log-YYYY-MM.json
 * - 密钥类信息（Authorization / x-api-key / URL 中的 key）一律脱敏后落盘，图片 base64 不落盘
 */
const fs = require('fs')
const path = require('path')

/** 单月最多保留的记录数（超出后丢弃最旧记录，避免文件无限增长） */
const MAX_RECORDS_PER_MONTH = 3000
/** 单条消息正文最大保留字符数（超出截断） */
const MESSAGE_TEXT_LIMIT = 4000
/** 响应正文最大保留字符数（超出截断） */
const RESPONSE_TEXT_LIMIT = 20000
/** 列表预览长度 */
const PREVIEW_LENGTH = 200
/** 图片附件的 Token 估算基数（无法精确统计时按此估算） */
const IMAGE_TOKEN_ESTIMATE = 800

/** 日志目录（由 initAiLogger 初始化） */
let logDir = ''
/** 串行化写入队列：避免并发请求同时写同一文件导致内容丢失 */
let writeQueue = Promise.resolve()

/**
 * 初始化日志目录
 * @param {string} userDataDir 应用数据目录（app.getPath('userData')）
 * @returns {string} 日志目录
 */
function initAiLogger(userDataDir) {
  logDir = path.join(userDataDir, 'ai-logs')
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch {
    /* 目录创建失败时仍允许运行，写入阶段会再次尝试 */
  }
  return logDir
}

/** 获取日志目录（未初始化时为空串） */
function getAiLogDir() {
  return logDir
}

/** 时间戳 -> 月份标识 YYYY-MM（按本地时区，与用户口径一致） */
function monthOf(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 月份 -> 日志文件路径 */
function logFilePath(month) {
  return path.join(logDir, `ai-log-${String(month || '').trim() || 'unknown'}.json`)
}

/** 读取某月日志文件（不存在或损坏时返回空结构） */
function readMonthFile(month) {
  try {
    const data = JSON.parse(fs.readFileSync(logFilePath(month), 'utf-8'))
    if (data && Array.isArray(data.records)) {
      return {
        month: data.month || month,
        updatedAt: data.updatedAt || '',
        records: data.records.filter((r) => r && typeof r === 'object'),
      }
    }
  } catch {
    /* 首次运行或文件损坏时视为空 */
  }
  return { month, updatedAt: '', records: [] }
}

/** 写入某月日志文件（先写临时文件再重命名，避免中断产生半截 JSON） */
function writeMonthFile(month, file) {
  fs.mkdirSync(logDir, { recursive: true })
  const target = logFilePath(month)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8')
  fs.renameSync(tmp, target)
}

/** 列出所有存在日志的月份（倒序，最新在前） */
function listMonthFiles() {
  if (!logDir) return []
  let names = []
  try {
    names = fs.readdirSync(logDir)
  } catch {
    return []
  }
  return names
    .map((n) => /^ai-log-(\d{4}-\d{2})\.json$/.exec(n))
    .filter(Boolean)
    .map((m) => m[1])
    .sort()
    .reverse()
}

// ============================================================
// 脱敏与内容裁剪
// ============================================================

/** 文本超长时截断并追加省略标记 */
function clipText(text, limit = MESSAGE_TEXT_LIMIT) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  return s.length > limit ? `${s.slice(0, limit)}…（已截断，共 ${s.length} 字符）` : s
}

/** Bearer 令牌脱敏 */
function maskBearer(value) {
  const s = String(value ?? '')
  if (!s) return ''
  return /^Bearer\s+/i.test(s) ? 'Bearer ***' : '***'
}

/** 请求头脱敏：密钥类字段不落盘 */
function maskHeaders(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase()
    if (key === 'authorization') out[k] = maskBearer(v)
    else if (key === 'x-api-key' || key === 'api-key' || key === 'api_key') out[k] = v ? '***' : ''
    else out[k] = v
  }
  return out
}

/** URL 中的密钥参数脱敏（如 Gemini 的 ?key=xxx） */
function maskUrl(url) {
  return String(url ?? '').replace(/([?&](?:key|api_key|apiKey)=)[^&\s]+/gi, '$1***')
}

/**
 * 构造消息快照：文本按上限裁剪，图片只保留体积等元信息（base64 不落盘）
 * @param {Array<{role:string, content:any}>} messages 原始消息
 * @returns {Array<object>} 消息快照
 */
function snapshotMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  return list.map((m) => {
    const content = m?.content
    if (typeof content === 'string') {
      return {
        role: m?.role || 'user',
        chars: content.length,
        truncated: content.length > MESSAGE_TEXT_LIMIT,
        text: clipText(content),
      }
    }
    if (Array.isArray(content)) {
      const parts = []
      let chars = 0
      for (const p of content) {
        if (!p) continue
        if (p.type === 'image') {
          const bytes = Math.round(((p.dataUrl || '').length * 3) / 4)
          parts.push({
            type: 'image',
            mime: p.mime || '',
            bytes,
            note: `图片附件（约 ${Math.max(1, Math.round(bytes / 1024))} KB，原始内容不落盘）`,
          })
          continue
        }
        const t = String(p.text || '')
        chars += t.length
        parts.push({
          type: 'text',
          chars: t.length,
          truncated: t.length > MESSAGE_TEXT_LIMIT,
          text: clipText(t),
        })
      }
      return { role: m?.role || 'user', chars, parts }
    }
    return { role: m?.role || 'user', chars: 0, text: '' }
  })
}

/** 统计消息的原始字符数（用于估算 Token） */
function countMessageChars(messages) {
  const list = Array.isArray(messages) ? messages : []
  let total = 0
  for (const m of list) {
    const c = m?.content
    if (typeof c === 'string') total += c.length
    else if (Array.isArray(c)) {
      for (const p of c) total += p?.type === 'image' ? 0 : String(p?.text || '').length
    }
  }
  return total
}

/** 纯文本 Token 估算：中日韩按 1 字 1 token，其余按 4 字符 1 token */
function estimateTextTokens(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  if (!s) return 0
  const cjk = /[㐀-䶿一-鿿぀-ヿ가-힯]/
  let cjkCount = 0
  let otherCount = 0
  for (const ch of s) {
    if (cjk.test(ch)) cjkCount += 1
    else otherCount += 1
  }
  return Math.ceil(cjkCount + otherCount / 4)
}

/**
 * Token 估算（服务端未返回用量时兜底）
 * @param {string|Array<object>} content 消息内容
 */
function estimateTokens(content) {
  if (Array.isArray(content)) {
    return content.reduce((sum, c) => {
      if (!c) return sum
      if (c.type === 'image') return sum + IMAGE_TOKEN_ESTIMATE
      return sum + estimateTextTokens(c.text || '')
    }, 0)
  }
  return estimateTextTokens(content)
}

// ============================================================
// 记录写入
// ============================================================

/**
 * 记录一次 AI 调用
 * @param {object} entry 调用详情
 * @param {string} [entry.requestId] 请求标识
 * @param {string} [entry.scene] 业务场景：chat / polish / expand / outline / diagram / commit / test / skill
 * @param {string} [entry.runId] agent 运行标识（一次 skill 运行的多个步骤共享）
 * @param {number} [entry.step] agent 步序号（1 起）
 * @param {object} [entry.skill] 触发的 skill { id, name, source }
 * @param {Array<object>} [entry.tools] 本步工具调用 [{ name, ok, elapsedMs, argsChars, argsSnippet, resultChars, resultSnippet, error }]
 * @param {object} entry.provider 厂商配置 { id, name, format, baseUrl, model, temperature }
 * @param {object} [entry.request] 实际 HTTP 请求 { url, headers, body }
 * @param {Array<object>} [entry.messages] 原始对话消息（统一角色格式）
 * @param {number} [entry.temperature] 温度
 * @param {boolean} [entry.stream] 是否流式
 * @param {boolean} entry.ok 是否成功
 * @param {string} [entry.error] 错误信息
 * @param {string} [entry.content] 模型输出内容
 * @param {string} [entry.thinking] 模型思考过程（reasoning，无则空）
 * @param {object} [entry.usage] 服务端用量 { input, output, total }
 * @param {number} [entry.elapsedMs] 耗时（毫秒）
 * @param {boolean} [entry.stopped] 是否被用户中断
 * @param {boolean} [entry.fallback] 是否由流式降级为一次性请求
 * @returns {Promise<object|null>} 写入的记录
 */
async function logAiCall(entry = {}) {
  if (!logDir) return null
  const now = Date.now()
  const provider = entry.provider || {}
  const request = entry.request || {}
  const body = request.body && typeof request.body === 'object' ? request.body : {}
  const messages = Array.isArray(entry.messages) ? entry.messages : []
  const content = typeof entry.content === 'string' ? entry.content : ''

  // Token：优先服务端用量，缺失时按字符数估算并标记
  const usage = entry.usage || null
  let input = Number.isFinite(usage?.input) ? usage.input : null
  let output = Number.isFinite(usage?.output) ? usage.output : null
  let total = Number.isFinite(usage?.total) ? usage.total : null
  let estimated = false
  if (input == null || output == null) {
    estimated = true
    if (input == null) input = messages.reduce((s, m) => s + estimateTokens(m?.content), 0)
    if (output == null) output = estimateTextTokens(content)
  }
  if (total == null) total = input + output

  // 请求参数：剔除消息体，只保留超参与元信息
  const params = {}
  for (const [k, v] of Object.entries(body)) {
    if (k === 'messages' || k === 'contents' || k === 'system' || k === 'systemInstruction') continue
    params[k] = v
  }

  // agent 工具调用快照：入参 / 结果截断保留
  const toolLog = (Array.isArray(entry.tools) ? entry.tools : []).slice(0, 20).map((t) => ({
    name: String(t?.name || ''),
    ok: !!t?.ok,
    elapsedMs: Number.isFinite(t?.elapsedMs) ? t.elapsedMs : null,
    argsChars: Number(t?.argsChars) || 0,
    argsSnippet: clipText(t?.argsSnippet || '', 2000),
    resultChars: Number(t?.resultChars) || 0,
    resultSnippet: clipText(t?.resultSnippet || '', 2000),
    error: String(t?.error || ''),
  }))

  const record = {
    id: String(entry.requestId || '') || `ai-${now}-${Math.random().toString(36).slice(2, 8)}`,
    month: monthOf(now),
    ts: now,
    time: new Date(now).toISOString(),
    scene: entry.scene || 'chat',
    ok: !!entry.ok,
    error: entry.error || '',
    // agent 运行归属：一次 skill 运行的多个步骤共享 runId，step 为步序号
    runId: String(entry.runId || ''),
    step: Number.isFinite(entry.step) ? entry.step : null,
    skill: entry.skill && entry.skill.name ? { id: entry.skill.id || '', name: String(entry.skill.name), source: String(entry.skill.source || '') } : null,
    provider: {
      id: provider.id || '',
      name: provider.name || '',
      format: provider.format || 'openai',
      baseUrl: maskUrl(provider.baseUrl || ''),
      model: provider.model || '',
    },
    request: {
      url: maskUrl(request.url || ''),
      method: 'POST',
      headers: maskHeaders(request.headers),
      params,
      temperature: Number.isFinite(entry.temperature) ? entry.temperature : (body.temperature ?? null),
      stream: entry.stream === undefined ? !!body.stream : !!entry.stream,
      messageCount: messages.length,
      promptChars: countMessageChars(messages),
      messages: snapshotMessages(messages),
    },
    response: {
      content: clipText(content, RESPONSE_TEXT_LIMIT),
      contentChars: content.length,
      truncated: content.length > RESPONSE_TEXT_LIMIT,
      thinking: clipText(entry.thinking || '', MESSAGE_TEXT_LIMIT),
      finishReason: entry.finishReason || '',
      status: entry.status ?? null,
    },
    tools: toolLog,
    usage: { input, output, total, estimated },
    elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null,
    stopped: !!entry.stopped,
    fallback: !!entry.fallback,
    preview: clipText(content, PREVIEW_LENGTH).replace(/\s+/g, ' ').trim(),
  }

  const month = record.month
  await (writeQueue = writeQueue.then(async () => {
    try {
      const file = readMonthFile(month)
      file.records.push(record)
      if (file.records.length > MAX_RECORDS_PER_MONTH) {
        file.records.splice(0, file.records.length - MAX_RECORDS_PER_MONTH)
      }
      file.updatedAt = new Date().toISOString()
      writeMonthFile(month, file)
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }).catch(() => {}))
  return record
}

// ============================================================
// 查询
// ============================================================

/** 列表摘要（不含完整请求 / 响应正文，避免 IPC 传输过大） */
function toSummary(r) {
  return {
    id: r.id,
    month: r.month,
    ts: r.ts,
    time: r.time,
    scene: r.scene,
    ok: r.ok,
    error: r.error,
    stopped: r.stopped,
    fallback: r.fallback,
    runId: r.runId || '',
    step: r.step ?? null,
    skillName: r.skill?.name || '',
    skillSource: r.skill?.source || '',
    toolCount: Array.isArray(r.tools) ? r.tools.length : 0,
    hasThinking: !!r.response?.thinking,
    providerId: r.provider?.id || '',
    providerName: r.provider?.name || '',
    model: r.provider?.model || '',
    format: r.provider?.format || '',
    stream: !!r.request?.stream,
    messageCount: r.request?.messageCount || 0,
    promptChars: r.request?.promptChars || 0,
    inputTokens: r.usage?.input || 0,
    outputTokens: r.usage?.output || 0,
    totalTokens: r.usage?.total || 0,
    estimated: !!r.usage?.estimated,
    elapsedMs: r.elapsedMs,
    preview: r.preview || '',
  }
}

/**
 * 汇总统计
 * @param {Array<object>} records 记录列表
 */
function computeStats(records) {
  const stats = {
    total: records.length,
    okCount: 0,
    failCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    elapsedMs: 0,
    avgElapsedMs: 0,
    byProvider: [],
    byScene: [],
  }
  if (!records.length) return stats
  const providerMap = new Map()
  const sceneMap = new Map()
  for (const r of records) {
    if (r.ok) stats.okCount += 1
    else stats.failCount += 1
    stats.inputTokens += r.usage?.input || 0
    stats.outputTokens += r.usage?.output || 0
    stats.totalTokens += r.usage?.total || 0
    stats.elapsedMs += r.elapsedMs || 0
    const pk = `${r.provider?.name || '未知'} / ${r.provider?.model || '未知'}`
    const pv = providerMap.get(pk) || { key: pk, name: r.provider?.name || '未知', model: r.provider?.model || '未知', count: 0, totalTokens: 0, elapsedMs: 0 }
    pv.count += 1
    pv.totalTokens += r.usage?.total || 0
    pv.elapsedMs += r.elapsedMs || 0
    providerMap.set(pk, pv)
    const sk = r.scene || 'chat'
    const sv = sceneMap.get(sk) || { scene: sk, count: 0, totalTokens: 0 }
    sv.count += 1
    sv.totalTokens += r.usage?.total || 0
    sceneMap.set(sk, sv)
  }
  stats.avgElapsedMs = Math.round(stats.elapsedMs / records.length)
  stats.byProvider = [...providerMap.values()].sort((a, b) => b.count - a.count)
  stats.byScene = [...sceneMap.values()].sort((a, b) => b.count - a.count)
  return stats
}

/**
 * 列出月份（含每月记录数）
 * @returns {Promise<Array<{ month: string, count: number, updatedAt: string }>>}
 */
async function listMonths() {
  return listMonthFiles().map((month) => {
    const file = readMonthFile(month)
    return { month, count: file.records.length, updatedAt: file.updatedAt || '' }
  })
}

/**
 * 分页查询日志
 * @param {object} query 查询条件
 * @param {string} [query.month] 月份 YYYY-MM，缺省查全部月份
 * @param {string} [query.scene] 场景过滤
 * @param {'all'|'ok'|'fail'} [query.status] 状态过滤
 * @param {string} [query.keyword] 关键字（厂商 / 模型 / 场景 / 错误 / 响应预览）
 * @param {number} [query.page] 页码（1 起）
 * @param {number} [query.pageSize] 每页条数
 */
async function queryLogs(query = {}) {
  const months = query.month ? [query.month] : listMonthFiles()
  let records = []
  for (const m of months) records = records.concat(readMonthFile(m).records)
  const keyword = String(query.keyword || '').trim().toLowerCase()
  const scene = String(query.scene || '').trim()
  const status = query.status || 'all'
  const filtered = records.filter((r) => {
    if (scene && r.scene !== scene) return false
    if (status === 'ok' && !r.ok) return false
    if (status === 'fail' && r.ok) return false
    if (keyword) {
      const hay = [
        r.scene, r.error, r.preview,
        r.provider?.name, r.provider?.model, r.provider?.id, r.provider?.baseUrl,
      ].join(' ').toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    return true
  })
  filtered.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
  const start = (page - 1) * pageSize
  return {
    ok: true,
    page,
    pageSize,
    total: filtered.length,
    items: filtered.slice(start, start + pageSize).map(toSummary),
    stats: computeStats(filtered),
  }
}

/**
 * 查询单条日志详情（完整请求 / 响应）
 * @param {string} id 记录 id
 * @param {string} [month] 月份，缺省时按月份倒序查找
 */
async function getLogDetail(id, month) {
  const target = String(id || '')
  if (!target) return null
  const months = month ? [month] : listMonthFiles()
  for (const m of months) {
    const hit = readMonthFile(m).records.find((r) => r.id === target)
    if (hit) return hit
  }
  return null
}

/** 清空指定月份日志（缺省清空全部） */
async function clearLogs(month) {
  const months = month ? [month] : listMonthFiles()
  let removed = 0
  for (const m of months) {
    const file = readMonthFile(m)
    removed += file.records.length
    writeMonthFile(m, { month: m, updatedAt: new Date().toISOString(), records: [] })
  }
  return { ok: true, removed }
}

/**
 * 删除指定记录
 * @param {string[]} ids 记录 id 列表
 * @param {string} [month] 月份，缺省时全月扫描
 */
async function deleteLogs(ids, month) {
  const targets = new Set((Array.isArray(ids) ? ids : []).map((i) => String(i)))
  if (!targets.size) return { ok: true, removed: 0 }
  const months = month ? [month] : listMonthFiles()
  let removed = 0
  for (const m of months) {
    const file = readMonthFile(m)
    const kept = file.records.filter((r) => !targets.has(String(r.id)))
    removed += file.records.length - kept.length
    if (kept.length !== file.records.length) {
      writeMonthFile(m, { month: m, updatedAt: new Date().toISOString(), records: kept })
    }
  }
  return { ok: true, removed }
}

module.exports = {
  initAiLogger,
  getAiLogDir,
  logAiCall,
  listMonths,
  queryLogs,
  getLogDetail,
  clearLogs,
  deleteLogs,
}
