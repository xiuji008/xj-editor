<template>
  <div class="ai-chat-window">
    <!-- 头部：厂商选择与会话操作 -->
    <div class="window-header">
      <span class="window-title">
        <el-icon class="title-icon"><MagicStick /></el-icon>
        AI 对话
      </span>
      <div class="header-actions">
        <el-select v-model="activeProviderId" size="small" class="provider-select" placeholder="选择 AI 厂商">
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
        <el-tooltip content="AI 配置" placement="bottom">
          <el-button text circle size="small" @click="configVisible = true">
            <el-icon><Setting /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 当前会话 -->
    <div class="session-bar">
      <el-icon class="session-icon"><ChatDotRound /></el-icon>
      <span class="session-title" :title="activeTitle">{{ activeTitle }}</span>
      <span v-if="messages.length" class="session-count">{{ messages.length }} 条</span>
    </div>

    <!-- 消息列表 -->
    <div ref="listRef" class="message-list">
      <div v-if="messages.length === 0" class="empty">
        <el-icon class="empty-icon"><ChatDotRound /></el-icon>
        <p>开始一段新的对话。</p>
        <p>支持引用文件（文本 / Office / 图片）一起提问，回复实时流式展示。</p>
        <p>点击<b>新建对话</b>可开启新会话，<b>历史对话</b>中可查看与继续此前的聊天。</p>
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
            <div v-if="m.content && !(m.role === 'user' && m.label)" class="ai-md" v-html="renderMd(m.content)"></div>
            <div v-if="m.error" class="error">{{ m.error }}</div>
          </template>
        </div>
        <div v-if="m.role === 'assistant' && m.id !== streamingId && m.content" class="msg-actions">
          <el-button size="small" text @click="copyText(m)">复制</el-button>
          <el-button size="small" text @click="regenerate(m)">重新生成</el-button>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-area">
      <div class="input-toolbar">
        <el-button text size="small" :disabled="sending" @click="pickFiles">
          <el-icon><Paperclip /></el-icon>
          <span>引用文件</span>
        </el-button>
        <span v-if="attachments.length" class="attach-count">已引用 {{ attachments.length }} 个文件</span>
      </div>

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
        v-model="draft"
        type="textarea"
        :rows="4"
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

    <AiConfigDialog v-model="configVisible" @update:model-value="onConfigDialogChange" />
    <AiChatHistoryDialog v-model="historyVisible" :chat="chat" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  MagicStick, Setting, Plus, Clock, Paperclip, Document, Picture, WarningFilled,
  Close, VideoPause, ChatDotRound,
} from '@element-plus/icons-vue'
import AiConfigDialog from './AiConfigDialog.vue'
import AiChatHistoryDialog from './AiChatHistoryDialog.vue'
import { useAiChat } from '../composables/useAiChat'
import { renderMarkdown } from '../utils/markdown'

/**
 * 独立「AI 对话」窗口：与主窗口右侧面板共享同一份会话数据（含历史对话），
 * 适合边写文档边聊天的场景（由主窗口的「在独立窗口中聊天」按钮打开）。
 */
const chat = useAiChat()
const {
  providers, activeProviderId, activeProvider, activeSession, messages, revision,
  attachments, sending, streamingId,
  reloadConfig, newSession, pickFiles, removeAttachment, clearAttachments, buildUserContent, send, stop,
} = chat

const draft = ref('')
const listRef = ref<HTMLElement>()
const configVisible = ref(false)
const historyVisible = ref(false)

/** 当前会话标题 */
const activeTitle = computed(() => activeSession.value?.title || '新对话')

onMounted(() => {
  reloadConfig()
})

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 消息新增或流式增量到达时滚动到底部
watch([revision, () => messages.value.length], () => scrollToBottom())

/** 确保已选中 AI 厂商，未配置时提示并打开配置 */
async function ensureProvider(): Promise<boolean> {
  if (!activeProvider.value) await reloadConfig()
  if (activeProvider.value) return true
  ElMessage.warning('请先配置 AI 厂商')
  configVisible.value = true
  return false
}

/** 发送对话（流式返回，携带历史上下文） */
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

/** 重新生成：取上一条提问重新发起 */
async function regenerate(m: AiChatMessage) {
  if (sending.value) return
  const list = messages.value
  const idx = list.findIndex((item) => item.id === m.id)
  if (idx < 1) return
  const user = list[idx - 1]
  if (!user || user.role !== 'user') return
  if (!(await ensureProvider())) return
  list.splice(idx)
  await send({
    content: user.content,
    text: user.content,
    label: user.label,
    kind: user.kind,
    files: user.files,
    withHistory: true,
    scene: 'chat',
  })
}

function copyText(m: AiChatMessage) {
  navigator.clipboard?.writeText(m.content).then(
    () => ElMessage.success('已复制到剪贴板'),
    () => ElMessage.warning('复制失败'),
  )
}

/** 配置对话框关闭后重新加载厂商列表 */
function onConfigDialogChange(val: boolean) {
  if (!val) reloadConfig()
}

const renderMd = (text: string) => renderMarkdown(text)
</script>

<style scoped>
.ai-chat-window {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color, #fff);
}

.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 46px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.window-title {
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
  width: 140px;
  margin-right: 6px;
}

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

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.9;
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
  max-width: 92%;
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
}

.msg-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
  font-weight: 600;
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

.error {
  color: var(--el-color-danger);
  font-size: 13px;
  white-space: pre-wrap;
}

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
}

.msg-actions .el-button {
  margin-left: 0;
  padding: 2px 8px;
}

.input-area {
  flex-shrink: 0;
  padding: 10px 16px 14px;
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

.attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  max-height: 96px;
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
  max-width: 160px;
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
</style>
