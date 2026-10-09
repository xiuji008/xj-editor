<template>
  <div class="text-editor">
    <div class="te-header">
      <span class="te-title">
        <el-icon><Document /></el-icon>
        文本编辑
      </span>
      <span class="te-info">{{ lineCount }} 行 · {{ charCount }} 字符</span>
      <el-tooltip content="查找 / 替换 (Ctrl+F)" placement="bottom">
        <el-button text size="small" class="te-find-btn" :icon="Search" @click="openFind('find')" />
      </el-tooltip>
    </div>
    <textarea
      ref="taRef"
      :value="modelValue"
      class="te-textarea"
      spellcheck="false"
      placeholder="在此输入文本内容..."
      @input="handleInput"
      @beforeinput="onBeforeInput"
      @keydown.tab.prevent="handleTab"
      @keydown="onFindShortcut"
      @mouseup="scheduleAskAi"
      @keyup="scheduleAskAi"
      @select="scheduleAskAi"
      @scroll="scheduleAskAi"
      @blur="onAskAiBlur"
    />

    <!-- 查找 / 替换栏 -->
    <FindBar ref="findBarRef" :target="taRef" :text="modelValue" @update:modelValue="onFindReplace" />

    <!-- 选中文本后的浮动按钮：问 AI / 生成图表 -->
    <teleport to="body">
      <transition name="el-zoom-in-top">
        <div
          v-if="askAiVisible"
          class="ask-ai-group"
          :style="{ left: askAiX + 'px', top: askAiY + 'px' }"
          @mousedown.prevent
        >
          <div class="ask-ai-btn" @click="onAskAiClick">
            <el-icon class="ask-ai-icon"><MagicStick /></el-icon>
            <span>问AI</span>
          </div>
          <div class="ask-ai-btn" @click="onGenerateDiagramClick">
            <el-icon class="ask-ai-icon"><TrendCharts /></el-icon>
            <span>生成图表</span>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Document, MagicStick, TrendCharts, Search } from '@element-plus/icons-vue'
import { getTextareaSelectionEndPos } from '../utils/caret'
import { useTextareaHistory } from '../utils/history'
import FindBar from './FindBar.vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 点击"问 AI"按钮：携带选中的文本，交由父组件填入 AI 对话框 */
  (e: 'ask-ai', text: string): void
  /** 点击"生成图表"按钮：以选中的文本作为描述，交由父组件生成图表代码 */
  (e: 'generate-diagram', text: string): void
}>()

const taRef = ref<HTMLTextAreaElement>()
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)

/** 撤销 / 重做历史（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z） */
const history = useTextareaHistory({
  getTextarea: () => taRef.value,
  getValue: () => props.modelValue,
  applyValue: (value: string) => emit('update:modelValue', value),
})

/** "问 AI"浮动按钮状态 */
const askAiVisible = ref(false)
const askAiX = ref(0)
const askAiY = ref(0)
let askAiTimer: ReturnType<typeof setTimeout> | undefined

/** 输入前捕获改动前状态（供撤销快照使用） */
const onBeforeInput = (e: Event) => {
  const ta = taRef.value
  if (!ta) return
  history.capturePending({
    value: ta.value,
    start: ta.selectionStart,
    end: ta.selectionEnd,
  })
}

const handleInput = (e: Event) => {
  history.push()
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  scheduleAskAi()
}

/** 获取当前选中的文本；无有效选区时返回空串 */
function getSelection(): string {
  const ta = taRef.value
  if (!ta) return ''
  const { selectionStart: s, selectionEnd: e } = ta
  if (s == null || e == null || s === e) return ''
  return props.modelValue.slice(s, e)
}

/** 延迟刷新按钮（选区在事件处理时可能尚未更新） */
function scheduleAskAi() {
  clearTimeout(askAiTimer)
  askAiTimer = setTimeout(updateAskAi, 10)
}

/** 根据当前选区更新浮动按钮的显示与位置 */
function updateAskAi() {
  const ta = taRef.value
  const text = getSelection()
  if (!ta || !text.trim()) {
    askAiVisible.value = false
    return
  }
  const pos = getTextareaSelectionEndPos(ta)
  if (!pos) {
    askAiVisible.value = false
    return
  }
  // 限制在视口内，避免按钮组溢出屏幕（问AI + 生成图表 两个按钮）
  const btnW = 190
  const btnH = 32
  askAiX.value = Math.min(Math.max(pos.x, 12), window.innerWidth - btnW - 12)
  askAiY.value = Math.max(pos.y - 10, btnH + 8)
  askAiVisible.value = true
}

/** 失焦时隐藏按钮 */
function onAskAiBlur() {
  clearTimeout(askAiTimer)
  askAiVisible.value = false
}

/** 点击"问 AI"：把选中文本交给父组件 */
function onAskAiClick() {
  const text = getSelection()
  askAiVisible.value = false
  if (text.trim()) emit('ask-ai', text)
}

/** 点击"生成图表"：把选中文本作为图表描述交给父组件 */
function onGenerateDiagramClick() {
  const text = getSelection()
  askAiVisible.value = false
  if (text.trim()) emit('generate-diagram', text)
}

/**
 * 用给定文本替换当前选区（无选区时插入到光标处），用于 AI 生成结果回填。
 * 与 handleTab 一致：同步设置 textarea 值与光标，避免受控组件导致光标跳到文末。
 */
function replaceSelection(text: string) {
  const ta = taRef.value
  if (!ta) return
  history.push(true)
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const next = ta.value.slice(0, start) + text + ta.value.slice(end)
  const caret = start + text.length
  ta.value = next
  ta.setSelectionRange(caret, caret)
  ta.focus()
  emit('update:modelValue', next)
}

/** Tab 键插入两个空格（同步更新 DOM，光标不丢失） */
const handleTab = (e: KeyboardEvent) => {
  const ta = taRef.value
  if (!ta) return
  history.push(true)
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const value = ta.value
  const next = value.slice(0, start) + '  ' + value.slice(end)
  const caret = start + 2
  ta.value = next
  ta.setSelectionRange(caret, caret)
  emit('update:modelValue', next)
}

const lineCount = computed(() => (props.modelValue ? props.modelValue.split('\n').length : 0))
const charCount = computed(() => props.modelValue.length)

/* ========== 查找 / 替换 ========== */

/** 打开查找栏（查找 / 替换两种模式） */
function openFind(mode: 'find' | 'replace') {
  findBarRef.value?.open(mode)
}

/** 查找栏替换结果回写文本（替换为独立撤销步骤） */
function onFindReplace(value: string) {
  history.push(true)
  emit('update:modelValue', value)
}

/** 文本域内快捷键：Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做、Ctrl+F 查找、Ctrl+H 替换、F3 跳转、Esc 关闭 */
function onFindShortcut(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) history.redo()
    else history.undo()
  } else if (mod && key === 'y') {
    e.preventDefault()
    history.redo()
  } else if (mod && key === 'f') {
    e.preventDefault()
    openFind('find')
  } else if (mod && key === 'h') {
    e.preventDefault()
    openFind('replace')
  } else if (e.key === 'F3' && e.shiftKey) {
    e.preventDefault()
    findBarRef.value?.prev()
  } else if (e.key === 'F3') {
    e.preventDefault()
    findBarRef.value?.next()
  } else if (e.key === 'Escape') {
    findBarRef.value?.close()
  }
}

/** 获取当前选中的文本（供 AI 面板引用选中内容） */
const getSelectionText = () => {
  const ta = taRef.value
  if (!ta) return ''
  return ta.value.slice(ta.selectionStart, ta.selectionEnd)
}

defineExpose({
  getSelectionText,
  /** 用给定文本替换当前选区（无选区时插入到光标处），用于 AI 结果回填 */
  replaceSelection,
  undo: () => history.undo(),
  redo: () => history.redo(),
  pushHistory: () => history.push(true),
  resetHistory: () => history.reset(),
})
</script>

<style scoped>
.text-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color-container);
  position: relative;
}

.te-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-color-secondary);
  flex-shrink: 0;
}

.te-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-color-primary);
  font-weight: 500;
}

.te-info {
  margin-left: auto;
}

.te-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 16px;
  font-family: 'Consolas', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color-primary);
  background: var(--bg-color-container);
  tab-size: 2;
  white-space: pre;
}

.te-textarea::placeholder {
  color: var(--text-color-placeholder);
}

/* 选中文本后的浮动按钮组：问 AI / 生成图表 */
.ask-ai-group {
  position: fixed;
  z-index: 1200;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ask-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 16px;
  border: none;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.ask-ai-btn:hover {
  filter: brightness(1.08);
}

.ask-ai-btn:active {
  transform: scale(0.96);
}

.ask-ai-icon {
  font-size: 13px;
}
</style>
