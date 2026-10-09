/**
 * AI 对话会话持久化。
 * 会话数据存放在应用数据目录的 ai-chats.json，主窗口与「AI 对话」独立窗口共享同一份数据，
 * 任一窗口写入后由主进程广播 ai:chats:changed，各窗口重新加载以保持同步。
 */
const fs = require('fs')
const fsp = fs.promises
const path = require('path')

/** 最多保留的会话数（超出丢弃最旧的） */
const MAX_SESSIONS = 200
/** 单个会话最多保留的消息数（超出丢弃最早的） */
const MAX_MESSAGES = 200
/** 单条消息最多保留的字符数（超出截断） */
const MAX_CONTENT = 20000

/** 会话文件完整路径（由主进程在 ready 后注入） */
let chatsPath = ''

/**
 * 设置会话文件路径
 * @param {string} p 持久化文件绝对路径
 */
function setChatsPath(p) {
  chatsPath = p
}

/** 生成会话 / 消息唯一 id */
function makeId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 规范化一条消息：补齐必要字段、限制长度，非法数据直接丢弃
 * @param {object} raw 原始消息
 * @returns {object | null} 规范化后的消息
 */
function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const role = raw.role === 'assistant' ? 'assistant' : 'user'
  const content = typeof raw.content === 'string' ? raw.content.slice(0, MAX_CONTENT) : ''
  if (!content && !raw.label && !raw.error) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    role,
    kind: ['chat', 'quick', 'diagram'].includes(raw.kind) ? raw.kind : 'chat',
    content,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : '',
    files: Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === 'string').slice(0, 20) : [],
    applyMode: typeof raw.applyMode === 'string' ? raw.applyMode : '',
    error: typeof raw.error === 'string' ? raw.error.slice(0, 1000) : '',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  }
}

/**
 * 规范化一个会话
 * @param {object} raw 原始会话
 * @returns {object | null} 规范化后的会话
 */
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES)
    : []
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : '新对话',
    providerId: typeof raw.providerId === 'string' ? raw.providerId : '',
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
    messages,
  }
}

/** 读取会话数据（文件不存在 / 损坏时返回空列表） */
async function readStore() {
  try {
    const text = await fsp.readFile(chatsPath, 'utf-8')
    const data = JSON.parse(text)
    const list = Array.isArray(data?.sessions) ? data.sessions.map(normalizeSession).filter(Boolean) : []
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

/**
 * 写入会话数据（原子写：先写临时文件再重命名）
 * @param {object[]} sessions 会话列表
 */
async function writeStore(sessions) {
  await fsp.mkdir(path.dirname(chatsPath), { recursive: true })
  const tmp = `${chatsPath}.tmp`
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, sessions }, null, 2), 'utf-8')
  await fsp.rename(tmp, chatsPath)
}

/** 查询全部会话（按更新时间倒序） */
async function listChats() {
  return readStore()
}

/**
 * 新增 / 更新一个会话（按 id 覆盖，不存在则插入）
 * @param {object} session 会话数据
 * @returns {Promise<{ ok: boolean, sessions: object[], error?: string }>} 写入后的完整列表
 */
async function upsertChat(session) {
  const normalized = normalizeSession(session)
  if (!normalized) return { ok: false, sessions: await readStore(), error: '会话数据无效' }
  const list = await readStore()
  const idx = list.findIndex((s) => s.id === normalized.id)
  if (idx >= 0) list[idx] = normalized
  else list.unshift(normalized)
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  const trimmed = list.slice(0, MAX_SESSIONS)
  await writeStore(trimmed)
  return { ok: true, sessions: trimmed }
}

/**
 * 删除指定会话
 * @param {string[]} ids 会话 id 列表
 * @returns {Promise<{ ok: boolean, sessions: object[], removed: number }>} 删除后的列表
 */
async function removeChats(ids) {
  const targets = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'))
  if (!targets.size) return { ok: true, sessions: await readStore(), removed: 0 }
  const list = await readStore()
  const kept = list.filter((s) => !targets.has(s.id))
  const removed = list.length - kept.length
  if (removed) await writeStore(kept)
  return { ok: true, sessions: kept, removed }
}

module.exports = {
  setChatsPath,
  makeId,
  listChats,
  upsertChat,
  removeChats,
}
