/**
 * AI 对话会话持久化与上下文构建。
 * 会话数据由主进程统一存放在 ai-chats.json，主窗口与「AI 对话」独立窗口共享，
 * 任一窗口写入后主进程广播变更事件，各窗口通过 onChatsChanged 重新加载。
 */

/** 历史上下文最多携带的消息条数 */
const CONTEXT_MAX_MESSAGES = 20
/** 历史上下文的字符上限（超出从最早处截断） */
const CONTEXT_MAX_CHARS = 16000
/** 上次打开的会话 id 持久化键（localStorage，窗口维度记忆） */
const ACTIVE_SESSION_KEY = 'md-ai-chat-active'

/**
 * 转为可安全跨 IPC 传输的纯对象。
 * Vue 的响应式对象是 Proxy，Electron 的 structuredClone 无法克隆 Proxy，发送前必须剥离。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 生成会话 / 消息 id */
export function makeChatId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 查询全部会话（按更新时间倒序） */
export async function listChatSessions(): Promise<AiChatSession[]> {
  try {
    const res = await window.mdAPI?.aiChats.list()
    return res?.ok ? res.sessions || [] : []
  } catch {
    return []
  }
}

/** 新增 / 更新会话 */
export async function saveChatSession(session: AiChatSession): Promise<boolean> {
  try {
    const res = await window.mdAPI?.aiChats.upsert(toPlain(session))
    return !!res?.ok
  } catch {
    return false
  }
}

/** 删除会话（可批量） */
export async function removeChatSessions(ids: string[]): Promise<boolean> {
  try {
    const res = await window.mdAPI?.aiChats.remove({ ids })
    return !!res?.ok
  } catch {
    return false
  }
}

/**
 * 订阅会话变更（其它窗口写入 / 本窗口写入后触发）
 * @returns {() => void} 取消订阅函数
 */
export function onChatsChanged(callback: () => void): () => void {
  try {
    return window.mdAPI?.aiChats.onChanged(callback) ?? (() => {})
  } catch {
    return () => {}
  }
}

/** 创建一个空会话（未落盘，产生首条消息后才写入） */
export function createChatSession(): AiChatSession {
  const now = Date.now()
  return { id: makeChatId(), title: '新对话', createdAt: now, updatedAt: now, messages: [] }
}

/** 读取上次打开的会话 id */
export function readActiveSessionId(): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) || ''
  } catch {
    return ''
  }
}

/** 记住当前打开的会话 id */
export function writeActiveSessionId(id: string): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id)
    else localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/**
 * 由会话内容推导标题：优先取首条提问（快捷动作取标签），无内容时为「新对话」。
 * @param session 会话
 * @returns {string} 标题
 */
export function deriveTitle(session: AiChatSession): string {
  const first = session.messages.find((m) => m.role === 'user')
  if (!first) return session.title?.trim() || '新对话'
  const raw = (first.label || first.content || '').replace(/\s+/g, ' ').trim()
  // 去掉快捷动作的方括号包裹
  const text = raw.replace(/^【(.+)】.*$/, '$1').trim()
  if (!text) return '新对话'
  return text.length > 30 ? `${text.slice(0, 30)}…` : text
}

/**
 * 构建发送给大模型的消息：可选历史上下文 + 当前提问。
 * 历史从最近往前取，超出条数或字符上限时丢弃最早的。
 * @param history 历史消息（不含当前提问）
 * @param current 当前提问（文本或多模态片段）
 * @returns {AiMessage[]} 请求消息
 */
export function buildContextMessages(
  history: AiChatMessage[],
  current: string | AiChatPart[],
): AiMessage[] {
  const picked: AiChatMessage[] = []
  let chars = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    // 失败消息与空内容不参与上下文
    if (m.error || !m.content.trim()) continue
    if (picked.length >= CONTEXT_MAX_MESSAGES) break
    if (picked.length && chars + m.content.length > CONTEXT_MAX_CHARS) break
    picked.unshift(m)
    chars += m.content.length
  }
  return [
    ...picked.map((m) => ({ role: m.role, content: m.content }) as AiMessage),
    { role: 'user', content: current },
  ]
}

/** 会话最后一条消息的预览文本（用于历史列表展示） */
export function sessionPreview(session: AiChatSession): string {
  const last = session.messages[session.messages.length - 1]
  if (!last) return '暂无消息'
  const text = (last.content || last.label || '').replace(/\s+/g, ' ').trim()
  if (!text) return last.error ? '生成失败' : '暂无消息'
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/** 会话时间展示：今天显示时分，今年显示月日时分，更早显示年月日 */
export function formatSessionTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return time
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}
