<template>
  <transition name="slide-right">
    <div
      v-show="visible"
      class="ai-panel"
      :class="{ 'is-drop-target': dropActive }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- 拖拽引用提示：左侧目录树的文件 / 文件夹拖入时展示（不拦截拖拽事件） -->
      <div v-if="dropActive" class="drop-mask">
        <el-icon class="drop-icon"><Upload /></el-icon>
        <span class="drop-text">松开即可引用到 AI 对话</span>
      </div>

      <!-- 头部 -->
      <div class="panel-header">
        <span class="panel-title">
          <el-icon class="title-icon"><MagicStick /></el-icon>
          AI 助手
        </span>
        <div class="header-actions">
          <el-select
            v-model="activeProviderId"
            size="small"
            class="provider-select"
            placeholder="选择 AI 厂商"
          >
            <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
          <el-tooltip content="新建对话" placement="bottom">
            <el-button text circle size="small" @click="newSession">
              <el-icon><Plus /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="历史对话" placement="bottom">
            <el-button text circle size="small" @click="historyVisible = true">
              <el-icon><Clock /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="在独立窗口中聊天" placement="bottom">
            <el-button text circle size="small" @click="openChatWindow">
              <el-icon><Promotion /></el-icon>
            </el-button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="onHeaderCommand">
            <el-button text circle size="small">
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="prompts">
                  <el-icon><EditPen /></el-icon><span class="dropdown-label">快捷提示词</span>
                </el-dropdown-item>
                <el-dropdown-item command="config">
                  <el-icon><Setting /></el-icon><span class="dropdown-label">AI 配置</span>
                </el-dropdown-item>
                <el-dropdown-item command="clear" divided>
                  <el-icon><Delete /></el-icon><span class="dropdown-label">清空当前对话</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-tooltip content="关闭" placement="bottom">
            <el-button text circle size="small" @click="emit('update:visible', false)">
              <el-icon><Close /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <!-- 当前会话标题 -->
      <div class="session-bar">
        <el-icon class="session-icon"><ChatDotRound /></el-icon>
        <span class="session-title" :title="activeTitle">{{ activeTitle }}</span>
        <span v-if="messageCount" class="session-count">{{ messageCount }} 条</span>
      </div>

      <!-- 快捷操作：内置生成类型（提示词可在「快捷提示词」中自定义） -->
      <div class="quick-actions">
        <el-button
          v-for="a in inlineActions"
          :key="a.id"
          size="small"
          :disabled="sending"
          :title="a.desc"
          @click="runQuickAction(a)"
        >
          <el-icon><component :is="quickIcon(a.icon)" /></el-icon><span>{{ a.name }}</span>
        </el-button>
        <el-dropdown v-if="moreActions.length" trigger="click" @command="onQuickCommand">
          <el-button size="small" :disabled="sending">
            更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="a in moreActions" :key="a.id" :command="a.id" :title="a.desc">
                <el-icon><component :is="quickIcon(a.icon)" /></el-icon>
                <span class="dropdown-label">{{ a.name }}</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- 图表 / 代码生成：选择类型后按描述生成，类型可在 DIAGRAM_TYPES 中扩展 -->
      <div class="diagram-actions">
        <el-select v-model="diagramLang" size="small" class="diagram-select" placeholder="图表类型">
          <el-option v-for="t in DIAGRAM_TYPES" :key="t.lang" :label="t.label" :value="t.lang" />
        </el-select>
        <el-button size="small" :disabled="sending" @click="runDiagram()">
          <el-icon><TrendCharts /></el-icon><span>生成图表</span>
        </el-button>
      </div>

      <!-- 文档元数据：AI 读取全文生成核心元数据，一键合并到文档头部 -->
      <div class="metadata-actions">
        <el-tooltip
          content="读取全文生成 / 补全元数据并合并到文档头部；只写入工具支持的字段（标题、摘要、关键词、标签、分类、系列、作者、状态、图标），createDate、lastUpdateDate 由系统维护，AI 不会改动"
          placement="top"
        >
          <el-button size="small" type="primary" plain :disabled="sending" @click="runMetadataAction()">
            <el-icon><Postcard /></el-icon><span>一键更新元数据</span>
          </el-button>
        </el-tooltip>
      </div>

      <!-- 消息列表 -->
      <div ref="listRef" class="message-list">
        <div v-if="messages.length === 0" class="empty">
          <el-icon class="empty-icon"><MagicStick /></el-icon>
          <p>你好，我是 AI 助手。</p>
          <p>点击上方快捷类型即可处理当前文档或选中文本，也可以直接提问。</p>
          <p>提示词可在头部的<b>快捷提示词</b>中按需修改。</p>
          <p>选中描述文本后点击<b>生成图表</b>，可生成 Mermaid / PlantUML / Chart 等代码。</p>
          <p>点击<b>一键更新元数据</b>，可按全文生成元数据（只写入支持的字段，时间字段由系统维护）。</p>
          <p>点击<b>新建对话</b>可开启新会话，<b>历史对话</b>中可查看与继续此前的聊天。</p>
          <p>把左侧目录树的<b>文件 / 文件夹</b>拖到此处，即可引用其内容发起对话。</p>
        </div>

        <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
          <div class="bubble">
            <template v-if="m.id === streamingId && !m.content">
              <span class="typing"><i /><i /><i /></span>
            </template>
            <template v-else>
              <div v-if="m.role === 'user' && m.label" class="msg-label">{{ m.label }}</div>
              <div v-if="m.files?.length" class="msg-files">
                <el-icon class="msg-files-icon"><Paperclip /></el-icon>
                引用文件：{{ m.files.join('、') }}
              </div>
              <details v-if="m.role === 'user' && m.label && m.content" class="msg-prompt">
                <summary>已按提示词处理（点击查看）</summary>
                <pre class="prompt-text">{{ m.content }}</pre>
              </details>
              <div v-if="m.content && !(m.role === 'user' && m.label)" class="ai-md" v-html="renderMd(m.content)"></div>
              <div v-if="m.error" class="error">{{ m.error }}</div>
            </template>
          </div>
          <!-- 结果操作 -->
          <div
            v-if="m.role === 'assistant' && m.id !== streamingId && m.content"
            class="msg-actions"
          >
            <template v-if="m.applyMode === 'replace'">
              <el-button size="small" text type="primary" @click="applyReplace(m)">替换全文</el-button>
              <el-button size="small" text type="primary" @click="applyAppend(m)">插入到文末</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else-if="m.applyMode === 'append'">
              <el-button size="small" text type="primary" @click="applyAppend(m)">插入到文末</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else-if="m.applyMode === 'prepend'">
              <el-button size="small" text type="primary" @click="applyPrepend(m)">插入到文首</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else-if="m.applyMode === 'outline'">
              <el-button size="small" text type="success" @click="applyOutline(m)">插入到标题之下</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else-if="m.applyMode === 'caret'">
              <el-button size="small" text type="primary" @click="applyToCaret(m)">插入到光标处</el-button>
              <el-button size="small" text type="primary" @click="applyAppend(m)">插入到文末</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else-if="m.applyMode === 'metadata'">
              <el-button size="small" text type="primary" @click="applyMetadata(m)">更新元数据</el-button>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
            </template>
            <template v-else>
              <el-button size="small" text @click="copyText(m)">复制</el-button>
              <el-button size="small" text @click="regenerate(m)">重新生成</el-button>
            </template>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="input-area">
        <div class="input-toolbar">
          <el-tooltip content="选择文件，或从左侧目录树拖入文件 / 文件夹" placement="top">
            <el-button text size="small" :disabled="sending" @click="pickFiles">
              <el-icon><Paperclip /></el-icon>
              <span>引用文件</span>
            </el-button>
          </el-tooltip>
          <span v-if="attachments.length" class="attach-count">已引用 {{ attachments.length }} 个文件</span>
          <span v-else class="attach-tip">可从左侧目录树拖入文件 / 文件夹</span>
        </div>

        <!-- 已引用的文件附件 -->
        <div v-if="attachments.length" class="attach-list">
          <div v-for="f in attachments" :key="f.path" class="attach-chip" :class="f.kind">
            <img v-if="f.kind === 'image' && f.dataUrl" class="attach-thumb" :src="f.dataUrl" alt="" />
            <el-icon v-else class="attach-icon" :class="f.kind">
              <Picture v-if="f.kind === 'image'" />
              <Document v-else-if="f.kind === 'text'" />
              <WarningFilled v-else />
            </el-icon>
            <span class="attach-name" :title="f.path">{{ f.name }}</span>
            <span class="attach-tag" :class="f.kind">
              {{ f.kind === 'text' ? (f.truncated ? '文本·截断' : '文本') : f.kind === 'image' ? '图片' : '不支持' }}
            </span>
            <el-icon class="attach-remove" @click="removeAttachment(f.path)"><Close /></el-icon>
          </div>
        </div>

        <el-input
          ref="inputRef"
          v-model="draft"
          type="textarea"
          :rows="3"
          resize="none"
          placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
          @keydown.enter.exact.prevent="sendChat"
        />
        <div class="input-footer">
          <span class="model-hint" :class="{ warn: !activeProvider?.apiKey }">
            {{ activeProvider ? `${activeProvider.name} · ${activeProvider.model}` : '未配置 AI 厂商' }}
            <template v-if="activeProvider && !activeProvider.apiKey && activeProvider.format !== 'openai'"> · 未填 Key</template>
          </span>
          <div class="footer-buttons">
            <el-button v-if="sending" size="small" @click="stop">
              <el-icon><VideoPause /></el-icon><span>停止</span>
            </el-button>
            <el-button
              type="primary"
              :loading="sending"
              :disabled="sending || (!draft.trim() && attachments.length === 0)"
              @click="sendChat"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>

      <!-- AI 配置对话框 -->
      <AiConfigDialog v-model="configVisible" @update:model-value="onConfigDialogChange" />

      <!-- 快捷 AI 提示词（内置类型的提示词可定制修改） -->
      <QuickAiPromptsDialog v-model="promptsVisible" @saved="reloadQuickActions" />

      <!-- 历史对话（切换 / 重命名 / 删除） -->
      <AiChatHistoryDialog v-model="historyVisible" :chat="chat" />
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, type InputInstance } from 'element-plus'
import {
  MagicStick, Setting, Close, Delete, EditPen, ArrowDown, TrendCharts,
  Paperclip, Document, Picture, WarningFilled, Plus, Clock, Promotion, MoreFilled,
  VideoPause, ChatDotRound, Upload, Postcard,
} from '@element-plus/icons-vue'
import AiConfigDialog from './AiConfigDialog.vue'
import QuickAiPromptsDialog from './QuickAiPromptsDialog.vue'
import AiChatHistoryDialog from './AiChatHistoryDialog.vue'
import {
  stripCodeFence,
  DIAGRAM_TYPES, DEFAULT_DIAGRAM_LANG, buildDiagramPrompt, buildDiagramBlock, extractDiagramCode, getDiagramType,
  hasAiDropPayload, readAiDropPayload, hasSystemFiles, readSystemFilePayload,
  collectFilesForAi, type AiDropPayload,
} from '../utils/ai'
import {
  buildQuickPrompt, getQuickAiConfig, quickIcon, resolveQuickApply, resolveQuickInput,
} from '../utils/quickAi'
import { renderMarkdown } from '../utils/markdown'
import { useAiChat } from '../composables/useAiChat'

/** 快捷区直接展示的动作数量，其余收入「更多」下拉 */
const INLINE_QUICK_COUNT = 6

/** 记住上次选择的图表类型（本地存储，仅影响默认值） */
const DIAGRAM_LANG_KEY = 'md-ai-diagram-lang'

const props = defineProps<{
  visible: boolean
  content: string
  /** 当前编辑器选中的文本：作为"生成图表"的默认描述来源 */
  selection?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** mode: replace=替换全文 / append=插入到文末 / caret=插入到光标处（替换选中内容）/ prepend=插入到文首 */
  'apply-content': [payload: { text: string; mode: 'replace' | 'append' | 'caret' | 'prepend' }]
  /** 元数据更新：把 AI 生成的 YAML 字段合并到文档头部（时间字段由系统维护） */
  'apply-metadata': [text: string]
  'insert-outline': [outline: string]
}>()

/** 对话状态：多会话 + 流式响应（与独立对话窗口共享同一份数据） */
const chat = useAiChat()
const {
  providers, activeProviderId, activeProvider, activeSession, messages, revision,
  attachments, sending, streamingId,
  reloadConfig, newSession, clearActiveMessages, pickFiles, addAttachments, removeAttachment,
  clearAttachments, buildUserContent, send, stop,
} = chat

const draft = ref('')
const listRef = ref<HTMLElement>()
/** 输入框实例（拖入文件后自动聚焦，便于立即提问） */
const inputRef = ref<InputInstance | null>(null)
const configVisible = ref(false)
/** 是否有目录树节点正拖到面板上（展示放置提示） */
const dropActive = ref(false)
/** dragenter / dragleave 计数：指针在子元素之间移动时避免提示闪烁 */
let dragDepth = 0
/** 快捷 AI 提示词对话框 */
const promptsVisible = ref(false)
/** 历史对话对话框 */
const historyVisible = ref(false)
/** 快捷 AI 生成类型（来自主进程配置，提示词可定制） */
const quickActions = ref<QuickAiAction[]>([])

/** 当前会话标题 */
const activeTitle = computed(() => activeSession.value?.title || '新对话')
/** 当前会话消息条数 */
const messageCount = computed(() => messages.value.length)

/** 上次选择的图表类型（本地记忆，非法值回落到默认类型） */
function loadDiagramLang(): string {
  try {
    const saved = localStorage.getItem(DIAGRAM_LANG_KEY)
    if (saved && DIAGRAM_TYPES.some((t) => t.lang === saved)) return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return DEFAULT_DIAGRAM_LANG
}

const diagramLang = ref(loadDiagramLang())
watch(diagramLang, (v) => {
  try {
    localStorage.setItem(DIAGRAM_LANG_KEY, v)
  } catch {
    /* 忽略写入失败 */
  }
})

/** 启用的快捷动作（停用与排序在「快捷提示词」中配置） */
const enabledActions = computed(() => quickActions.value.filter((a) => a.enabled !== false))

/** 快捷区直接展示的动作 */
const inlineActions = computed(() => enabledActions.value.slice(0, INLINE_QUICK_COUNT))

/** 收入「更多」下拉的动作 */
const moreActions = computed(() => enabledActions.value.slice(INLINE_QUICK_COUNT))

/** 加载快捷 AI 动作配置（打开面板或提示词保存后调用） */
async function reloadQuickActions() {
  const cfg = await getQuickAiConfig()
  quickActions.value = cfg.actions || []
}

/** 「更多」下拉：按 id 找到动作并执行 */
function onQuickCommand(id: string) {
  const action = enabledActions.value.find((a) => a.id === id)
  if (action) void runQuickAction(action)
}

/** 头部「更多」下拉：快捷提示词 / AI 配置 / 清空当前对话 */
function onHeaderCommand(command: string) {
  if (command === 'prompts') promptsVisible.value = true
  else if (command === 'config') configVisible.value = true
  else if (command === 'clear') clearActiveMessages()
}

/** 在独立窗口中继续聊天（会话数据与面板共享） */
async function openChatWindow() {
  try {
    await window.mdAPI?.openAiChatWindow()
  } catch {
    ElMessage.warning('打开对话窗口失败')
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    reloadConfig(true)
    void reloadQuickActions()
  }
})

onMounted(() => {
  reloadConfig()
  void reloadQuickActions()
})

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 消息新增或流式增量到达时滚动到底部
watch([revision, () => messages.value.length], () => scrollToBottom())

/**
 * 确保已选中 AI 厂商：面板刚打开时配置可能仍在加载中，
 * 此时先重新加载一次，避免误报"请先配置 AI 厂商"。
 */
async function ensureProvider(): Promise<boolean> {
  if (!activeProvider.value) await reloadConfig()
  if (activeProvider.value) return true
  ElMessage.warning('请先配置 AI 厂商')
  configVisible.value = true
  return false
}

/** 引用指定路径的文件：提取内容（文本 / Office / 图片），不可解析的标记为不支持 */
async function addFiles(paths: string[]) {
  await addAttachments(paths)
}

/* ========== 目录树拖拽引用（文件 / 文件夹拖入面板） ========== */

/** 拖拽进入：识别目录树节点与系统文件拖拽，避免拦截面板内的文本拖拽 */
function onDragEnter(e: DragEvent) {
  if (!hasAiDropPayload(e) && !hasSystemFiles(e)) return
  dragDepth++
  dropActive.value = true
}

/** 拖拽悬停：声明为复制操作并保持提示常亮 */
function onDragOver(e: DragEvent) {
  if (!hasAiDropPayload(e) && !hasSystemFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropActive.value = true
}

/** 拖拽离开：计数归零后才隐藏提示 */
function onDragLeave(e: DragEvent) {
  if (!hasAiDropPayload(e) && !hasSystemFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropActive.value = false
}

/** 放下：把拖入的文件 / 文件夹解析为引用附件（目录树节点或系统文件拖拽） */
async function onDrop(e: DragEvent) {
  const payload = readAiDropPayload(e) || (await readSystemFilePayload(e))
  dragDepth = 0
  dropActive.value = false
  if (!payload) return
  e.preventDefault()
  e.stopPropagation()
  await attachDroppedNode(payload)
}

/**
 * 引用拖入的文件 / 文件夹：文件夹按层级展开为可解析的文件（有数量上限），
 * 添加完成后聚焦输入框，便于直接输入问题发起对话。
 */
async function attachDroppedNode(payload: AiDropPayload) {
  if (sending.value) {
    ElMessage.warning('正在生成中，请先停止生成或等待完成后再拖入')
    return
  }
  const name = payload.name || payload.path.split(/[\\/]/).pop() || '该文件'
  const { files, truncated } = await collectFilesForAi(payload)
  if (!files.length) {
    ElMessage.warning(
      payload.isDirectory ? `「${name}」中没有可作为 AI 上下文的文件` : `暂不支持引用「${name}」`,
    )
    return
  }
  await addAttachments(files)
  nextTick(() => inputRef.value?.focus())
  ElMessage.success(
    truncated
      ? `「${name}」内容较多，已引用前 ${files.length} 个文件，输入问题后发送`
      : `已引用 ${files.length} 个文件，输入问题后发送`,
  )
}

/**
 * 执行快捷动作：按动作配置取输入内容、套用提示词并调用 AI（流式返回）。
 * 适用范围为「选中文本」的动作需要编辑器中有选中内容；结果应用方式由动作配置决定。
 */
async function runQuickAction(action: QuickAiAction) {
  if (sending.value) return
  const { text, fromSelection } = resolveQuickInput(action, props.content, props.selection || '')
  if (!text.trim()) {
    ElMessage.warning(
      action.scope === 'selection'
        ? `【${action.name}】需要先在编辑器中选中要处理的文本`
        : '当前文档为空，请先打开或输入内容',
    )
    return
  }
  if (!(await ensureProvider())) return
  const prompt = buildQuickPrompt(action.prompt, text)
  const userContent = buildUserContent(prompt)
  if (!userContent) {
    ElMessage.warning('没有可发送的内容，请移除不支持的附件')
    return
  }
  const applyMode = resolveQuickApply(action, fromSelection)
  const files = attachments.value.map((f) => f.name)
  clearAttachments()
  const reply = await send({
    content: userContent,
    text: prompt,
    label: `【${action.name}】${fromSelection ? '选中文本' : '当前文档'}`,
    kind: 'quick',
    applyMode,
    files: files.length ? files : undefined,
    withHistory: false,
    scene: 'quick',
    transform: (t) => stripCodeFence(t),
  })
  if (reply) ElMessage.success(`${action.name}完成`)
}

/**
 * 生成图表 / 代码：把自然语言描述转为指定类型的代码块（流式返回）。
 * 描述来源优先级：显式传入（编辑器选中文本） > 当前编辑器选中内容 > 输入框草稿。
 */
async function runDiagram(inputText?: string) {
  if (sending.value) return
  const fromDraft = !inputText?.trim() && !(props.selection || '').trim() && !!draft.value.trim()
  const desc = (inputText || props.selection || draft.value).trim()
  if (!desc) {
    ElMessage.warning('请先在编辑器中选中描述文本，或在输入框中输入要生成的图表描述')
    return
  }
  if (!(await ensureProvider())) return
  const type = getDiagramType(diagramLang.value)
  const prompt = buildDiagramPrompt(desc, type)
  const userContent = buildUserContent(prompt)
  if (!userContent) {
    ElMessage.warning('没有可发送的内容，请移除不支持的附件')
    return
  }
  const files = attachments.value.map((f) => f.name)
  clearAttachments()
  if (fromDraft) draft.value = ''
  const reply = await send({
    content: userContent,
    text: desc,
    label: `【生成 ${type.label}】`,
    kind: 'diagram',
    applyMode: 'caret',
    files: files.length ? files : undefined,
    withHistory: false,
    scene: 'diagram',
    transform: (t) => buildDiagramBlock(extractDiagramCode(t, type.lang), type.lang),
    validate: (t) => (t ? '' : 'AI 未返回有效代码，请调整描述后重试'),
  })
  if (reply) ElMessage.success(`${type.label} 生成完成`)
}

/** 自由对话（流式返回，可携带引用的文件与图片，并附带历史上下文） */
async function sendChat() {
  const text = draft.value.trim()
  if (sending.value) return
  const userContent = buildUserContent(text)
  if (!userContent) return
  if (!(await ensureProvider())) return
  const files = attachments.value.map((f) => f.name)
  clearAttachments()
  draft.value = ''
  await send({
    content: userContent,
    text,
    kind: 'chat',
    files: files.length ? files : undefined,
    withHistory: true,
    scene: 'chat',
  })
}

/** 重新生成：取上一条提问重新发起（单轮，不携带更早历史） */
async function regenerate(m: AiChatMessage) {
  if (sending.value) return
  const list = messages.value
  const idx = list.findIndex((item) => item.id === m.id)
  if (idx < 1) return
  const user = list[idx - 1]
  if (!user || user.role !== 'user') return
  if (!(await ensureProvider())) return
  // 移除待重生成的旧回复及其之后的消息，保持会话上下文干净
  list.splice(idx)
  await send({
    content: user.content,
    text: user.content,
    label: user.label,
    kind: user.kind,
    files: user.files,
    applyMode: user.applyMode,
    withHistory: true,
    scene: user.kind === 'chat' ? 'chat' : 'quick',
    transform: user.kind === 'quick' ? (t) => stripCodeFence(t) : undefined,
  })
}

function copyText(m: AiChatMessage) {
  navigator.clipboard?.writeText(m.content).then(
    () => ElMessage.success('已复制到剪贴板'),
    () => ElMessage.warning('复制失败'),
  )
}

/** 替换全文 */
function applyReplace(m: AiChatMessage) {
  emit('apply-content', { text: m.content, mode: 'replace' })
}

/** 追加到文末 */
function applyAppend(m: AiChatMessage) {
  emit('apply-content', { text: m.content, mode: 'append' })
}

/** 插入到文首（如生成的标题） */
function applyPrepend(m: AiChatMessage) {
  emit('apply-content', { text: m.content, mode: 'prepend' })
}

/** 概要插入到文章大标题之下 */
function applyOutline(m: AiChatMessage) {
  emit('insert-outline', m.content)
}

/** 插入到光标处：有选中内容时替换选中，否则插入到光标位置 */
function applyToCaret(m: AiChatMessage) {
  emit('apply-content', { text: m.content, mode: 'caret' })
}

/** 更新元数据：合并到文档头部（createDate / lastUpdateDate 由系统维护） */
function applyMetadata(m: AiChatMessage) {
  emit('apply-metadata', m.content)
}

/** AI 配置对话框开关变化时重新加载配置 */
function onConfigDialogChange(val: boolean) {
  if (!val) reloadConfig()
}

const renderMd = (text: string) => renderMarkdown(text)

/**
 * 引用编辑器选中的文本：预填到输入框（可继续编辑或追加问题后发送）。
 * 多次调用会按行累加，避免覆盖已有草稿。
 */
function quoteSelection(text: string) {
  const t = (text || '').trim()
  if (!t) return
  draft.value = draft.value.trim() ? `${draft.value.trim()}\n${t}` : t
}

/** 工具栏「概要生成」：执行内置的概要动作（配置尚未加载时先加载一次） */
async function runOutlineAction() {
  if (!quickActions.value.length) await reloadQuickActions()
  const action = quickActions.value.find((a) => a.id === 'outline')
  if (!action) {
    ElMessage.warning('未找到「概要生成」快捷类型，请在「快捷提示词」中恢复默认')
    return
  }
  await runQuickAction(action)
}

/**
 * 一键更新元数据：执行内置的元数据动作（配置尚未加载时先加载一次）。
 * AI 只生成内容字段，createDate / lastUpdateDate 由应用侧维护。
 */
async function runMetadataAction() {
  if (!quickActions.value.length) await reloadQuickActions()
  const action = quickActions.value.find((a) => a.id === 'metadata')
  if (!action) {
    ElMessage.warning('未找到「元数据」快捷类型，请在「快捷提示词」中恢复默认')
    return
  }
  await runQuickAction(action)
}

// 供外部（App.vue）直接触发概要生成 / 引用文件 / 引用选中文本
defineExpose({
  runOutline: () => runOutlineAction(),
  /** 供外部（工具栏一键更新元数据）触发元数据生成 */
  runMetadata: () => runMetadataAction(),
  /** 供外部（编辑器浮动按钮）以选中文本为描述直接生成图表 */
  runDiagram,
  addAttachments: addFiles,
  quoteSelection,
})
</script>

<style scoped>
.ai-panel {
  position: fixed;
  top: 52px;
  right: 0;
  bottom: 0;
  width: 380px;
  z-index: 600;
  display: flex;
  flex-direction: column;
  background: var(--bg-color, #fff);
  border-left: 1px solid var(--el-border-color);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
}

/* 滑入动画 */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.22s ease;
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 46px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.title-icon {
  color: var(--el-color-primary);
  font-size: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.provider-select {
  width: 110px;
  margin-right: 4px;
}

/* 当前会话标题栏 */
.session-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  flex-shrink: 0;
}

.session-icon {
  color: var(--el-color-primary);
  font-size: 14px;
  flex-shrink: 0;
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.dropdown-label {
  margin-left: 4px;
}

/* 快捷类型：内置动作按配置顺序展示，超出部分收入「更多」下拉 */
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.quick-actions .el-button {
  margin-left: 0;
}

/* 图表 / 代码生成：类型下拉 + 生成按钮 */
.diagram-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.diagram-select {
  flex: 1;
}

.diagram-actions .el-button {
  flex: 1;
  margin-left: 0;
}

/* 一键更新元数据：整行展示 */
.metadata-actions {
  display: flex;
  padding: 0 12px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.metadata-actions .el-button {
  flex: 1;
  margin-left: 0;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.8;
  padding: 0 20px;
}

.empty-icon {
  font-size: 34px;
  color: var(--el-color-primary-light-5);
  margin-bottom: 8px;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.message.user {
  align-items: flex-end;
}

.message.assistant {
  align-items: flex-start;
}

.bubble {
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.message.user .bubble {
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  color: var(--el-text-color-primary);
  border-top-right-radius: 2px;
}

.message.assistant .bubble {
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-top-left-radius: 2px;
  width: 100%;
}

.msg-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
  font-weight: 600;
}

/* 快捷动作：提示词默认折叠，可展开查看实际发送的内容 */
.msg-prompt {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.msg-prompt summary {
  cursor: pointer;
  user-select: none;
}

.msg-prompt .prompt-text {
  margin: 4px 0 0;
  padding: 6px 8px;
  max-height: 160px;
  overflow: auto;
  border-radius: 4px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.error {
  color: var(--el-color-danger);
  font-size: 13px;
  white-space: pre-wrap;
}

/* 打字动画 */
.typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 2px;
}

.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-text-color-placeholder);
  animation: typing-bounce 1.2s infinite ease-in-out;
}

.typing i:nth-child(2) {
  animation-delay: 0.15s;
}

.typing i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
}

.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.msg-actions .el-button {
  margin-left: 0;
  padding: 2px 8px;
}

.input-area {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--bg-color, #fff);
}

.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.input-toolbar .el-button {
  margin-left: 0;
  padding: 3px 8px;
}

.attach-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 未引用文件时的拖拽引导文案 */
.attach-tip {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 拖入引用：左侧目录树节点悬停在面板上时的高亮与提示层 */
.ai-panel.is-drop-target {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -4px;
}

.drop-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  /* 不拦截指针事件，避免拖拽经过提示层时出现 dragleave / dragenter 抖动 */
  pointer-events: none;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 13px;
  font-weight: 600;
}

.drop-icon {
  font-size: 30px;
}

.attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  max-height: 84px;
  overflow-y: auto;
}

.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  font-size: 12px;
}

.attach-thumb {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--el-fill-color-light);
}

.attach-icon {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--el-text-color-secondary);
}

.attach-icon.text {
  color: var(--el-color-primary);
}

.attach-icon.image {
  color: var(--el-color-success);
}

.attach-icon.unsupported {
  color: var(--el-color-warning);
}

.attach-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.attach-tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.4;
  padding: 0 5px;
  border-radius: 4px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.attach-tag.text {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.attach-tag.image {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.attach-tag.unsupported {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.attach-remove {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
  transition: color 0.15s;
}

.attach-remove:hover {
  color: var(--el-color-danger);
}

.msg-files {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.msg-files-icon {
  font-size: 13px;
}

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.footer-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.footer-buttons .el-button {
  margin-left: 0;
}

.model-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.model-hint.warn {
  color: var(--el-color-warning);
}

/* 气泡内的 Markdown 渲染 */
.ai-md :deep(p) {
  margin: 4px 0;
}

.ai-md :deep(p:first-child) {
  margin-top: 0;
}

.ai-md :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3),
.ai-md :deep(h4) {
  margin: 10px 0 6px;
  font-size: 14px;
  line-height: 1.5;
}

.ai-md :deep(h1) {
  font-size: 16px;
}

.ai-md :deep(ul),
.ai-md :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.ai-md :deep(li) {
  margin: 2px 0;
}

.ai-md :deep(pre) {
  background: var(--el-fill-color-dark);
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}

.ai-md :deep(code) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  background: var(--el-fill-color-dark);
  padding: 1px 4px;
  border-radius: 4px;
}

.ai-md :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.ai-md :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--el-color-primary-light-5);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 0 6px 6px 0;
}

.ai-md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.ai-md :deep(th),
.ai-md :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 4px 8px;
}

.ai-md :deep(th) {
  background: var(--el-fill-color-light);
}

.ai-md :deep(a) {
  color: var(--el-color-primary);
}

.ai-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--el-border-color);
  margin: 10px 0;
}

.ai-md :deep(.code-block-wrapper) {
  margin: 8px 0;
}
</style>
