<template>
  <transition name="wb-ai-slide">
    <div v-show="visible" class="wb-ai-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <span class="panel-title">
          <el-icon class="title-icon"><MagicStick /></el-icon>
          AI 画图
        </span>
        <div class="header-actions">
          <el-tooltip :content="providerTip" placement="bottom">
            <span class="provider-badge">{{ providerName || '未配置 AI' }}</span>
          </el-tooltip>
          <el-button v-if="runId" text circle size="small" title="停止" @click="stopRun">
            <el-icon><VideoPause /></el-icon>
          </el-button>
          <el-button v-if="chat.length && !sending" text circle size="small" title="新对话（清空当前会话）" @click="clearChat">
            <el-icon><Plus /></el-icon>
          </el-button>
          <el-button text circle size="small" title="关闭" @click="emit('update:visible', false)">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 对话消息（多轮历史，每条助手消息内嵌技能归属/思考/工具调用） -->
      <div ref="chatScrollRef" class="run-area">
        <div v-if="!chat.length && !sending" class="hint-text">
          描述你想画的图，例如：「用户提交申请后主管审批，金额超 5 万走财务复核，否则直接通过」。生成后先出预览，确认后再插入画布。
        </div>
        <template v-for="(m, mi) in chat" :key="mi">
          <!-- 用户消息 -->
          <div v-if="m.role === 'user'" class="msg msg--user">
            <div class="msg__bubble">{{ m.text }}</div>
          </div>
          <!-- 助手消息 -->
          <div v-else class="msg msg--assistant">
            <div v-if="m.skill" class="msg__skill">
              <el-icon><MagicStick /></el-icon>
              <span>技能 {{ m.skill.name }}（{{ skillSourceLabel(m.skill.source) }}）</span>
            </div>
            <details v-if="m.reasoning" class="reasoning-box" :open="m.streaming && !m.text ? true : undefined">
              <summary>思考过程{{ m.streaming && m.reasoning ? '（输出中…）' : '' }}</summary>
              <pre class="reasoning-text">{{ m.reasoning }}</pre>
            </details>
            <div v-if="m.tools && m.tools.length" class="tool-log">
              <div v-for="(t, ti) in m.tools" :key="ti" class="tool-log__item">
                <el-icon class="tool-icon"><Loading v-if="t.pending" /><CircleCheckFilled v-else /></el-icon>
                <span>{{ t.text }}</span>
              </div>
            </div>
            <pre v-if="m.text" class="stream-text">{{ m.text }}</pre>
            <div v-if="m.error" class="error-text">{{ m.error }}</div>
          </div>
        </template>
      </div>

      <!-- 待插入产物（预览 + 确认） -->
      <div v-if="pendings.length" class="pending-area">
        <div class="pending-title">待插入（{{ pendings.length }}）</div>
        <div v-for="p in pendings" :key="p.pendingId" class="pending-card">
          <img v-if="p.previewUrl" :src="p.previewUrl" class="pending-preview" alt="预览" />
          <div v-else class="pending-preview pending-preview--empty">预览生成中…</div>
          <div class="pending-meta">{{ p.summary }}</div>
          <div class="pending-actions">
            <el-button size="small" type="primary" @click="onApply(p, 'append')">
              {{ p.mode === 'replace' ? '替换画布' : '插入画布' }}
            </el-button>
            <el-button size="small" @click="onApply(p, 'replace')">替换画布</el-button>
            <el-button size="small" text @click="onDiscard(p)">丢弃</el-button>
          </div>
        </div>
      </div>

      <!-- 输入区（支持拖入文档 / 文件夹作为画图材料） -->
      <div
        class="input-area"
        :class="{ 'is-dragover': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDropMaterials"
      >
        <!-- 拖入的材料附件 -->
        <div v-if="materials.length" class="materials">
          <span
            v-for="(m, i) in materials"
            :key="i"
            class="material-chip"
            :title="m.content.slice(0, 200)"
          >
            <el-icon class="material-chip__icon"><Document /></el-icon>
            {{ m.name }}（{{ m.chars }}字{{ m.truncated ? '，已截断' : '' }}）
            <el-icon class="material-chip__close" @click.stop="removeMaterial(i)"><Close /></el-icon>
          </span>
        </div>
        <el-select v-model="layout" size="small" class="input-select" title="布局">
          <el-option label="自动布局" value="auto" />
          <el-option label="流程图（竖排）" value="flow-v" />
          <el-option label="流程图（横排）" value="flow-h" />
          <el-option label="思维导图" value="mindmap" />
          <el-option label="泳道图" value="swimlane" />
          <el-option label="时序图" value="sequence" />
        </el-select>
        <el-select v-model="theme" size="small" class="input-select" title="风格">
          <el-option label="专业" value="professional" />
          <el-option label="彩色" value="colorful" />
          <el-option label="黑白" value="mono" />
          <el-option label="手绘" value="hand-drawn" />
        </el-select>
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="3"
          resize="none"
          placeholder="描述要画的图；可直接拖入 .md / .txt / .json 文档或文件夹作为画图材料"
          :disabled="sending"
          @keydown.enter.exact.prevent="onGenerate"
        />
        <div class="input-actions">
          <el-button size="small" text title="撤销上次 AI 插入" :disabled="sending" @click="onUndo">
            <el-icon><RefreshLeft /></el-icon>撤销插入
          </el-button>
          <el-button size="small" type="primary" :loading="sending" @click="onGenerate">
            {{ sending ? '生成中…' : '生成' }}
          </el-button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick, Close, VideoPause, Loading, CircleCheckFilled, RefreshLeft, Plus, Document } from '@element-plus/icons-vue'
import { onBusEvent, type WhiteboardPendingPayload } from '../utils/excalidraw/agentBus'

const props = defineProps<{
  visible: boolean
  /** 当前 workspace 根目录（skill 扫描用） */
  workspaceRoot: string
  /** 画布摘要（宿主 WhiteboardView 提供） */
  sceneSummary: () => {
    elementCount: number
    typeCounts: Record<string, number>
    selected: Array<{ id: string; type: string; text: string }>
    note: string
  }
  /** 应用待插入产物 */
  applyPending: (pendingId: string, mode?: 'append' | 'replace') => boolean
  /** 丢弃待插入产物 */
  discardPending: (pendingId: string) => boolean
}>()

const emit = defineEmits<{ 'update:visible': [value: boolean]; undo: [] }>()

/** 输入与选项 */
const inputText = ref('')
const layout = ref('auto')
const theme = ref('professional')

/** 运行状态 */
const sending = ref(false)
const runId = ref('')
const pendings = ref<WhiteboardPendingPayload[]>([])
/** 对话历史（多轮）：user 气泡 + assistant 块（内嵌思考/工具/错误） */
interface ChatToolItem {
  text: string
  pending: boolean
}
interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  reasoning: string
  tools: ChatToolItem[]
  error: string
  streaming: boolean
  skill: { name: string; source: string } | null
}
const chat = ref<ChatMsg[]>([])
const chatScrollRef = ref<HTMLElement | null>(null)

/** 当前流式中的助手消息（事件按 runId 过滤后写入它） */
function streamingMsg(): ChatMsg | null {
  return chat.value.find((m) => m.streaming) || null
}

/** skill 来源展示名 */
function skillSourceLabel(source: string): string {
  if (source === 'builtin') return '内置'
  if (source === 'workspace') return '工作区'
  if (source === 'claude-compat') return '.claude'
  return source
}

/** 消息区自动滚到底部 */
function scrollChatBottom() {
  void nextTick(() => {
    const el = chatScrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
watch(
  () => [chat.value.length, chat.value.map((m) => m.text.length + m.reasoning.length + m.tools.length).join(',')],
  () => scrollChatBottom(),
)

/** skill 与厂商 */
let skillMeta: SkillMeta | null = null
let skillBody = ''
/** 当前激活厂商（ref 保证徽标/computed 响应式刷新） */
const provider = ref<AiProvider | null>(null)
const providerName = computed(() => (provider.value ? `${provider.value.name} · ${provider.value.model}` : ''))
const providerTip = computed(() => {
  if (!provider.value) return 'AI 未配置：请在 设置 → AI 配置 中填写厂商与模型'
  if (provider.value.toolSupport === false) return '该厂商已关闭工具调用，无法执行 skill；请在 AI 配置中开启'
  return 'skill 执行使用当前激活的 AI 厂商'
})

/** 订阅 agent 事件与工具产出（setup 阶段注册一次） */
let unsubEvent: (() => void) | null = null
let unsubPending: (() => void) | null = null

onMounted(() => {
  unsubEvent = window.mdAPI?.agent.onEvent((event) => {
    if (event.runId !== runId.value) return
    const cur = streamingMsg()
    if (event.type === 'text-delta') {
      if (cur) cur.text += event.delta
    } else if (event.type === 'reasoning-delta') {
      if (cur) cur.reasoning += event.delta
    } else if (event.type === 'tool-start') {
      cur?.tools.push({ text: `调用 ${event.name}…`, pending: true })
    } else if (event.type === 'tool-result') {
      const hit = cur?.tools.find((t) => t.pending && t.text.includes(event.name))
      if (hit) {
        hit.pending = false
        hit.text = `${event.name} 完成`
      } else {
        cur?.tools.push({ text: `${event.name} 完成`, pending: false })
      }
    } else if (event.type === 'done') {
      finishRun()
    } else if (event.type === 'error') {
      if (cur) cur.error = event.error
      finishRun()
    }
  }) || null
  unsubPending = onBusEvent('wb-pending', (payload) => {
    pendings.value = [payload as WhiteboardPendingPayload, ...pendings.value].slice(0, 5)
  })
})

onBeforeUnmount(() => {
  unsubEvent?.()
  unsubPending?.()
})

function finishRun() {
  const cur = streamingMsg()
  if (cur) cur.streaming = false
  sending.value = false
  runId.value = ''
}

/** 打开面板时加载厂商配置与 skill */
watch(
  () => props.visible,
  async (visible) => {
    if (!visible || !window.mdAPI) return
    // 厂商配置必须加载成功（其余失败不阻塞）
    try {
      const aiRes = await window.mdAPI.aiGetConfig()
      provider.value =
        aiRes.providers.find((p) => p.id === aiRes.activeProviderId) || aiRes.providers[0] || null
    } catch (err) {
      console.warn('[whiteboard-ai] 读取 AI 配置失败', err)
      provider.value = null
    }
    try {
      const skillRes = await window.mdAPI.skills.list(props.workspaceRoot)
      // 选 skill：workspace 优先于内置，targets 含 whiteboard
      const candidates = [...skillRes.workspace, ...skillRes.builtin]
      skillMeta =
        candidates.find((s) => s.enabled && s.targets.includes('whiteboard')) ||
        candidates.find((s) => s.enabled && /excalidraw|白板|diagram/i.test(s.name + s.description)) ||
        null
      if (skillMeta) {
        const got = await window.mdAPI.skills.get({ rootPath: skillMeta.rootPath })
        if (got.ok) skillBody = got.body || ''
      }
    } catch (err) {
      console.warn('[whiteboard-ai] 扫描 skill 失败', err)
    }
  },
)

/** 组装 system prompt：skill body + 本环境适配段 */
function buildSystem(): string {
  const summary = props.sceneSummary()
  const parts: string[] = []
  if (skillBody) parts.push(skillBody)
  parts.push(
    [
      '【本环境适配（覆盖 skill 中的文件操作指引）】',
      `- 不要写文件、不要向用户输出 element JSON；调用 whiteboard_apply_elements 工具把 spec 画到当前白板。`,
      `- 当前画布已有 ${summary.elementCount} 个元素（类型分布：${JSON.stringify(summary.typeCounts)}）。`,
      summary.selected.length
        ? `- 用户当前选中了 ${summary.selected.length} 个元素（其 text：${summary.selected.map((s) => s.text).filter(Boolean).join(' / ') || '无文字'}），用户可能希望围绕这些内容作图。`
        : `- 画布为空时直接绘制新图；追加时新图会自动避让现有内容。`,
      `- 用户在界面看到预览并自行点击插入/替换；生成预览后用一句话告诉用户查看右侧预览即可。`,
      `- 需要参考排版规则或 DSL 字段时，调用 skill_read_reference 读取 ${skillMeta?.resources.join('、') || 'references/ 文档'}。`,
    ].join('\n'),
  )
  if (layout.value !== 'auto') {
    parts.push(`【用户指定】layout 必须使用 ${layout.value}。`)
  }
  if (theme.value) {
    parts.push(`【用户指定】theme 必须使用 ${theme.value}。`)
  }
  return parts.join('\n\n')
}

/** 生成入口 */
async function onGenerate() {
  const text = inputText.value.trim()
  if (!text) {
    ElMessage.warning('请先描述要画的图')
    return
  }
  if (!window.mdAPI) return
  if (!provider.value) {
    ElMessage.warning('AI 未配置：请在 设置 → AI 配置 中填写厂商与模型')
    return
  }
  if (provider.value.toolSupport === false) {
    ElMessage.error('该厂商已关闭工具调用，无法执行 skill')
    return
  }
  if (!skillMeta) {
    ElMessage.error('未找到可用的白板 skill（excalidraw-diagram）')
    return
  }
  // 拖入材料注入到发送内容（气泡里只显示摘要）
  let fullText = text
  if (materials.value.length) {
    const parts = materials.value.map((m) => `【材料：${m.name}】\n${m.content}`)
    fullText = `${text}\n\n===== 以下是用户拖入的画图材料，围绕它们作图 =====\n${parts.join('\n\n')}`
  }
  // 多轮上下文：取此前已完成的消息文本（不含当前输入）
  const history = chat.value
    .filter((m) => !m.streaming && m.text)
    .map((m) => ({ role: m.role, content: m.text }))
  // 用户消息 + 流式中的助手消息
  const attachNote = materials.value.length ? `\n📎 已附 ${materials.value.length} 个材料文件` : ''
  chat.value.push({
    role: 'user',
    text: text + attachNote,
    reasoning: '',
    tools: [],
    error: '',
    streaming: false,
    skill: null,
  })
  chat.value.push({
    role: 'assistant',
    text: '',
    reasoning: '',
    tools: [],
    error: '',
    streaming: true,
    skill: { name: skillMeta.name, source: skillMeta.source },
  })
  inputText.value = ''
  sending.value = true
  const id = `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  runId.value = id
  try {
    // provider 是 Vue reactive Proxy，无法跨 IPC 结构化克隆，必须先拷成纯对象
    const providerPayload = JSON.parse(JSON.stringify(provider.value)) as AiProvider
    const res = await window.mdAPI.agent.run({
      runId: id,
      provider: providerPayload,
      system: buildSystem(),
      messages: [...history, { role: 'user', content: fullText }],
      toolNames: [...skillMeta.allowedTools, 'skill_read_reference'],
      skill: { id: skillMeta.id, name: skillMeta.name, source: skillMeta.source },
      skillRoot: skillMeta.rootPath,
      maxSteps: 6,
      temperature: 0.4,
    })
    if (!res.ok) {
      const cur = streamingMsg()
      if (cur) cur.error = res.error || '运行失败'
      finishRun()
    }
  } catch (err) {
    const cur = streamingMsg()
    if (cur) cur.error = err instanceof Error ? err.message : String(err)
    finishRun()
  }
}

function stopRun() {
  if (!runId.value) return
  void window.mdAPI?.agent.stop(runId.value)
}

/** 新对话：清空会话历史与材料（不影响画布与待插入产物） */
function clearChat() {
  chat.value = []
  materials.value = []
}

/** 应用 / 丢弃待插入产物 */
function onApply(p: WhiteboardPendingPayload, mode: 'append' | 'replace') {
  const ok = props.applyPending(p.pendingId, mode)
  if (ok) {
    ElMessage.success(mode === 'replace' ? '已替换画布内容' : '已插入画布')
    pendings.value = pendings.value.filter((x) => x.pendingId !== p.pendingId)
  } else {
    ElMessage.error('插入失败，产物可能已失效')
    pendings.value = pendings.value.filter((x) => x.pendingId !== p.pendingId)
  }
}

function onDiscard(p: WhiteboardPendingPayload) {
  props.discardPending(p.pendingId)
  pendings.value = pendings.value.filter((x) => x.pendingId !== p.pendingId)
}

/** 撤销上次 AI 插入（由宿主 WhiteboardView 执行） */
function onUndo() {
  emit('undo')
}

/* ========== 拖入材料（文档 / 文件夹作为画图上下文） ========== */

/** 材料条目（拖入的文本文件内容） */
interface MaterialItem {
  name: string
  content: string
  chars: number
  truncated: boolean
}
const materials = ref<MaterialItem[]>([])
const dragging = ref(false)

/** 单文件最多注入字符数 / 最多文件数 */
const MATERIAL_FILE_LIMIT = 12000
const MATERIAL_FILE_MAX = 10
/** 视为画图材料的文本扩展名 */
const MATERIAL_EXT = /\.(md|markdown|txt|json)$/i
/** 目录遍历时跳过的目录名 */
const SKIP_DIR = /^(node_modules|\.git|\.xj|\.claude|dist|release_app|\.idea|\.vscode)$/i

interface DragEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file: (cb: (f: File) => void, err: (e: unknown) => void) => void
  createReader: () => { readEntries: (cb: (entries: DragEntry[]) => void, err: (e: unknown) => void) => void }
}

/** 递归收集拖入的文本文件（目录深度 ≤ 3） */
async function collectDragFiles(entries: DragEntry[], depth: number, out: Array<{ name: string; file: File }>): Promise<void> {
  for (const entry of entries) {
    if (out.length >= MATERIAL_FILE_MAX) return
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)))
      if (file && MATERIAL_EXT.test(file.name)) out.push({ name: entry.name, file })
    } else if (entry.isDirectory && depth < 3 && !SKIP_DIR.test(entry.name)) {
      const reader = entry.createReader()
      // readEntries 每批最多 100 条，需循环读到空
      for (;;) {
        const batch = await new Promise<DragEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
        if (!batch.length) break
        await collectDragFiles(batch, depth + 1, out)
        if (out.length >= MATERIAL_FILE_MAX) return
      }
    }
  }
}

/** 拖放落材料 */
async function onDropMaterials(event: DragEvent) {
  dragging.value = false
  if (sending.value) return
  const dt = event.dataTransfer
  if (!dt) return
  const entries: DragEntry[] = []
  for (const item of Array.from(dt.items || [])) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => DragEntry | null }).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  const found: Array<{ name: string; file: File }> = []
  try {
    if (entries.length) {
      await collectDragFiles(entries, 0, found)
    } else {
      // 浏览器不支持 webkitGetAsEntry 时退回普通 File 列表
      for (const f of Array.from(dt.files || [])) {
        if (MATERIAL_EXT.test(f.name) && found.length < MATERIAL_FILE_MAX) found.push({ name: f.name, file: f })
      }
    }
  } catch (err) {
    console.warn('[whiteboard-ai] 读取拖入文件失败', err)
  }
  if (!found.length) {
    ElMessage.warning('未找到可用的文本文件（支持 .md / .markdown / .txt / .json）')
    return
  }
  let total = materials.value.reduce((s, m) => s + m.chars, 0)
  for (const { name, file } of found) {
    if (materials.value.length >= MATERIAL_FILE_MAX) break
    let raw = ''
    try {
      raw = await file.text()
    } catch {
      continue
    }
    const truncated = raw.length > MATERIAL_FILE_LIMIT
    const content = truncated ? `${raw.slice(0, MATERIAL_FILE_LIMIT)}\n…（已截断，原文共 ${raw.length} 字符）` : raw
    total += content.length
    materials.value.push({ name, content, chars: content.length, truncated })
    if (total > 60000) {
      ElMessage.warning('材料总量过大，超出部分未加入')
      break
    }
  }
  ElMessage.success(`已添加 ${found.length} 个材料文件`)
}

/** 移除材料 */
function removeMaterial(index: number) {
  materials.value.splice(index, 1)
}
</script>

<style scoped>
.wb-ai-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--bg-color-white, #ffffff);
  border-left: 1px solid var(--el-border-color-lighter);
  box-shadow: -6px 0 16px rgba(0, 0, 0, 0.08);
}

.wb-ai-slide-enter-active,
.wb-ai-slide-leave-active {
  transition: transform 0.22s ease, opacity 0.22s ease;
}
.wb-ai-slide-enter-from,
.wb-ai-slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.title-icon {
  color: var(--el-color-primary);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.provider-badge {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-area {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reasoning-box {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.reasoning-box summary {
  cursor: pointer;
  user-select: none;
}
.reasoning-text {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  font-family: inherit;
}
.tool-log {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 对话消息 */
.msg {
  margin-bottom: 10px;
}
.msg--user {
  display: flex;
  justify-content: flex-end;
}
.msg__bubble {
  max-width: 88%;
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  border-radius: 10px 10px 2px 10px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg--assistant {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--el-fill-color-blank, transparent);
}
.msg__skill {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--el-color-primary);
  opacity: 0.85;
}
.tool-log__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tool-icon {
  color: var(--el-color-primary);
}
.stream-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.error-text {
  font-size: 12px;
  color: var(--el-color-danger);
  white-space: pre-wrap;
}
.hint-text {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.pending-area {
  border-top: 1px solid var(--el-border-color-lighter);
  max-height: 45%;
  overflow-y: auto;
  padding: 10px 12px;
}
.pending-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}
.pending-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
}
.pending-preview {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--bg-color-page, #f5f7fa);
}
.pending-preview--empty {
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pending-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 6px 0;
}
.pending-actions {
  display: flex;
  gap: 6px;
}

.input-area {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-area.is-dragover {
  background: var(--el-color-primary-light-9);
  outline: 1px dashed var(--el-color-primary);
  outline-offset: -3px;
}

/* 拖入材料附件 */
.materials {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.material-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  font-size: 11px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 2px 8px;
}
.material-chip__icon {
  color: var(--el-color-primary);
}
.material-chip__close {
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.material-chip__close:hover {
  color: var(--el-color-danger);
}
.input-select {
  width: 160px;
}
.input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
