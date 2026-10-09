/**
 * AI 对话组合式逻辑：多会话管理（新建 / 切换 / 重命名 / 删除 / 历史）+ 流式响应（可中断）。
 * 供右侧 AI 面板与独立「AI 对话」窗口共用，会话数据经主进程持久化并在窗口间同步。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { aiChatStream, extractFileForAi, getAiConfig, pickAiFiles } from '../utils/ai'
import {
  buildContextMessages,
  createChatSession,
  deriveTitle,
  listChatSessions,
  makeChatId,
  onChatsChanged,
  readActiveSessionId,
  removeChatSessions,
  saveChatSession,
  writeActiveSessionId,
} from '../utils/aiChat'

/** 发送一次对话的参数 */
export interface AiChatSendOptions {
  /** 发送给模型的内容（文本或含图片的多模态片段） */
  content: string | AiChatPart[]
  /** 用户消息正文（缺省由 content 推导，用于历史展示与上下文） */
  text?: string
  /** 展示标签（快捷动作 / 图表生成），存在时优先展示 */
  label?: string
  /** 消息类型 */
  kind?: AiChatKind
  /** 结果应用方式（快捷动作 / 图表生成） */
  applyMode?: AiChatMessage['applyMode']
  /** 引用的文件名 */
  files?: string[]
  /** 是否携带历史消息作为上下文（自由对话为 true，快捷动作 / 图表为 false） */
  withHistory?: boolean
  /** 调用场景（用于调用日志归类） */
  scene?: AiLogScene
  /** 流式结束后对最终文本的转换（如剥离代码围栏、包装代码块） */
  transform?: (text: string) => string
  /** 结果校验，返回非空文案表示失败（写入消息的错误提示） */
  validate?: (text: string) => string
  /** 指定厂商，缺省使用当前选中的厂商 */
  provider?: AiProvider | null
}

/** 由多模态内容推导用于展示与上下文的纯文本 */
function plainTextOf(content: string | AiChatPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('\n')
    .trim()
}

/**
 * AI 对话状态与行为
 * @returns 会话 / 厂商 / 附件 / 发送等状态与方法
 */
export function useAiChat() {
  /** 已配置的厂商 */
  const providers = ref<AiProvider[]>([])
  /** 当前选中的厂商 id */
  const activeProviderId = ref('')
  /** 当前选中的厂商 */
  const activeProvider = computed(
    () => providers.value.find((p) => p.id === activeProviderId.value) || null,
  )
  /** 全部会话（按更新时间倒序） */
  const sessions = ref<AiChatSession[]>([])
  /** 当前会话 id */
  const activeId = ref(readActiveSessionId())
  /** 是否正在生成 */
  const sending = ref(false)
  /** 正在流式生成的消息 id（空表示未在生成） */
  const streamingId = ref('')
  /** 消息变更计数：界面据此滚动到底部 */
  const revision = ref(0)
  /** 引用的文件附件（文本 / 图片 / 不支持） */
  const attachments = ref<AiFileAttachment[]>([])

  /** 当前会话 */
  const activeSession = computed<AiChatSession | null>(
    () => sessions.value.find((s) => s.id === activeId.value) || null,
  )
  /** 当前会话的消息 */
  const messages = computed<AiChatMessage[]>(() => activeSession.value?.messages || [])
  /** 是否有历史会话 */
  const hasSessions = computed(() => sessions.value.length > 0)

  /** 当前流式会话的中断函数 */
  let stopStream: (() => void) | null = null
  /** 会话保存防抖定时器 */
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 会话变更订阅的取消函数 */
  let stopSync: (() => void) | null = null

  /**
   * 从主进程加载 AI 配置。
   * forceDefault 为 true 时强制选中默认厂商（打开面板时调用），
   * 否则仅在当前选中失效时回落到默认。
   */
  async function reloadConfig(forceDefault = false) {
    const cfg = await getAiConfig()
    if (!cfg) return
    providers.value = cfg.providers || []
    const defId = cfg.activeProviderId || providers.value[0]?.id || ''
    if (forceDefault || !providers.value.some((p) => p.id === activeProviderId.value)) {
      activeProviderId.value = defId
    }
  }

  /** 加载全部会话，并校正当前选中的会话 */
  async function loadSessions() {
    const list = await listChatSessions()
    sessions.value = list
    if (!activeId.value || !list.some((s) => s.id === activeId.value)) {
      activeId.value = list[0]?.id || ''
      writeActiveSessionId(activeId.value)
    }
  }

  /** 确保存在当前会话（没有则新建，暂不落盘） */
  function ensureSession(): AiChatSession {
    let session = activeSession.value
    if (!session) {
      session = createChatSession()
      sessions.value.unshift(session)
      activeId.value = session.id
      writeActiveSessionId(session.id)
    }
    return session
  }

  /**
   * 持久化指定会话（更新时间与标题）
   * @param session 会话
   */
  async function persistSession(session: AiChatSession) {
    session.updatedAt = Date.now()
    if (!session.titleEdited) session.title = deriveTitle(session)
    await saveChatSession(session)
  }

  /**
   * 保存当前会话（防抖 500ms）
   * @param immediate true 时立即保存（新建会话、生成结束等场景）
   */
  function saveActive(immediate = false) {
    const session = activeSession.value
    if (!session) return
    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      void persistSession(session)
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistSession(session)
    }, 500)
  }

  /** 新建对话（当前会话为空时直接复用，避免产生空白历史） */
  function newSession() {
    if (sending.value) {
      ElMessage.warning('正在生成中，请先停止生成或等待完成')
      return
    }
    const current = activeSession.value
    if (current && current.messages.length === 0) return
    const session = createChatSession()
    sessions.value.unshift(session)
    activeId.value = session.id
    writeActiveSessionId(session.id)
    revision.value++
  }

  /** 切换到指定会话 */
  function selectSession(id: string) {
    if (!id || id === activeId.value) return
    activeId.value = id
    writeActiveSessionId(id)
    revision.value++
  }

  /** 重命名会话 */
  async function renameSession(id: string, title: string) {
    const session = sessions.value.find((s) => s.id === id)
    if (!session) return
    const text = (title || '').trim()
    session.title = text || deriveTitle(session)
    session.titleEdited = !!text
    session.updatedAt = Date.now()
    await saveChatSession(session)
  }

  /** 删除会话（删除当前会话时自动切换） */
  async function removeSession(id: string) {
    const ok = await removeChatSessions([id])
    if (!ok) {
      ElMessage.error('删除对话失败')
      return
    }
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeId.value === id) {
      activeId.value = sessions.value[0]?.id || ''
      writeActiveSessionId(activeId.value)
    }
    revision.value++
  }

  /** 清空当前会话的消息（保留会话） */
  function clearActiveMessages() {
    const session = activeSession.value
    if (!session) return
    session.messages = []
    session.title = '新对话'
    session.titleEdited = false
    revision.value++
    void persistSession(session)
  }

  /** 弹出文件选择框并引用所选文件 */
  async function pickFiles() {
    const paths = await pickAiFiles()
    if (paths.length) await addAttachments(paths)
  }

  /** 引用指定路径的文件：提取内容（文本 / Office / 图片），不可解析的标记为不支持 */
  async function addAttachments(paths: string[]) {
    if (!paths?.length) return
    const existing = new Set(attachments.value.map((f) => f.path))
    for (const p of paths) {
      if (existing.has(p)) continue
      const f = await extractFileForAi(p)
      if (!f) continue
      if (!f.ok) {
        ElMessage.error(f.error || `无法读取文件 ${f.name}`)
        continue
      }
      if (f.kind === 'unsupported') {
        ElMessage.warning(`${f.name}：${f.error || '不支持的文件类型'}（可点击移除）`)
      }
      attachments.value.push(f)
      existing.add(p)
    }
  }

  /** 移除已引用的附件 */
  function removeAttachment(path: string) {
    attachments.value = attachments.value.filter((f) => f.path !== path)
  }

  /** 清空已引用的附件（发送成功后调用） */
  function clearAttachments() {
    attachments.value = []
  }

  /**
   * 构建用户消息内容：文本 + 附件。
   * 文本附件拼入文字，图片附件作为多模态片段；无内容时返回空字符串。
   */
  function buildUserContent(text: string): string | AiChatPart[] {
    const parts: AiChatPart[] = []
    if (text) parts.push({ type: 'text', text })
    for (const f of attachments.value) {
      if (f.kind === 'image' && f.dataUrl) {
        parts.push({ type: 'image', mime: f.mime, dataUrl: f.dataUrl })
      } else if (f.kind === 'text' && f.content) {
        parts.push({ type: 'text', text: `【引用文件：${f.name}】\n${f.content}` })
      }
    }
    if (parts.length === 0) return ''
    if (parts.length === 1 && parts[0].type === 'text') return parts[0].text || ''
    return parts
  }

  /** 中断当前生成（已生成的内容保留） */
  function stop() {
    if (!stopStream) return
    stopStream()
    stopStream = null
  }

  /**
   * 发送一次对话（流式返回，增量实时写入消息内容）
   * @param opts 发送参数
   * @returns 生成成功时返回助手消息，失败返回 null
   */
  function send(opts: AiChatSendOptions): Promise<AiChatMessage | null> {
    if (sending.value) return Promise.resolve(null)
    const provider = opts.provider || activeProvider.value
    if (!provider) {
      ElMessage.warning('请先配置 AI 厂商')
      return Promise.resolve(null)
    }
    const isNew = !activeSession.value
    const session = ensureSession()
    const userText = opts.text ?? plainTextOf(opts.content)
    const user: AiChatMessage = {
      id: makeChatId(),
      role: 'user',
      kind: opts.kind || 'chat',
      content: userText,
      label: opts.label || '',
      files: opts.files?.length ? opts.files : [],
      applyMode: opts.applyMode,
      createdAt: Date.now(),
    }
    const assistant: AiChatMessage = {
      id: makeChatId(),
      role: 'assistant',
      kind: opts.kind || 'chat',
      content: '',
      applyMode: opts.applyMode,
      createdAt: Date.now(),
    }
    const history = opts.withHistory ? session.messages.slice() : []
    session.messages.push(user, assistant)
    session.providerId = provider.id
    streamingId.value = assistant.id
    sending.value = true
    revision.value++
    // 新会话立即落盘，保证历史列表中可见
    saveActive(isNew)

    return new Promise((resolve) => {
      const finish = (ok: boolean, error?: string) => {
        sending.value = false
        streamingId.value = ''
        stopStream = null
        if (!ok) assistant.error = error || '请求失败'
        void persistSession(session)
        revision.value++
        resolve(ok ? assistant : null)
      }
      const requestMessages = buildContextMessages(history, opts.content)
      void (async () => {
        const s = await aiChatStream(
          provider,
          requestMessages,
          {
            onDelta: (delta) => {
              assistant.content += delta
              revision.value++
            },
            onDone: (content, payload) => {
              const raw = content || assistant.content
              assistant.content = opts.transform ? opts.transform(raw) : raw
              if (payload?.fallback) ElMessage.info('该模型未返回流式结果，已一次性生成')
              const invalid = opts.validate ? opts.validate(assistant.content) : ''
              if (invalid) {
                ElMessage.error(invalid)
                finish(false, invalid)
                return
              }
              finish(true)
            },
            onError: (error, payload) => {
              const raw = payload?.content || assistant.content
              assistant.content = opts.transform ? opts.transform(raw) : raw
              finish(false, error)
            },
          },
          undefined,
          opts.scene || 'chat',
        )
        if (!s.ok) {
          ElMessage.error(s.error || 'AI 请求失败')
          finish(false, s.error || 'AI 请求失败')
          return
        }
        stopStream = s.stop
      })()
    })
  }

  /** 会话变更（其它窗口或本窗口写入）时重新加载，保持多窗口一致 */
  function handleChanged() {
    // 本窗口正在生成时忽略外部变更，避免覆盖正在写入的消息
    if (sending.value) return
    void loadSessions()
  }

  onMounted(() => {
    void loadSessions()
    stopSync = onChatsChanged(handleChanged)
  })

  onBeforeUnmount(() => {
    stop()
    if (saveTimer) {
      clearTimeout(saveTimer)
      const session = activeSession.value
      if (session) void persistSession(session)
    }
    stopSync?.()
    stopSync = null
  })

  return {
    // 厂商
    providers,
    activeProviderId,
    activeProvider,
    reloadConfig,
    // 会话
    sessions,
    activeId,
    activeSession,
    messages,
    hasSessions,
    revision,
    loadSessions,
    newSession,
    selectSession,
    renameSession,
    removeSession,
    clearActiveMessages,
    // 附件
    attachments,
    pickFiles,
    addAttachments,
    removeAttachment,
    clearAttachments,
    buildUserContent,
    // 发送
    sending,
    streamingId,
    send,
    stop,
  }
}

/** 组合式返回值类型（供组件类型标注使用） */
export type AiChatStore = ReturnType<typeof useAiChat>
