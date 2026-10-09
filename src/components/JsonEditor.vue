<template>
  <div class="json-editor" :style="{ height }">
    <div class="editor-body">
      <!-- 左侧：JSON 源码（语法高亮 + 行号） -->
      <div class="editor-pane source-pane" v-show="!viewMode">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><Document /></el-icon> JSON 源码
          </span>
          <div class="pane-tools">
            <el-tooltip content="格式化 (整理缩进)" placement="bottom">
              <el-button text size="small" :icon="MagicStick" @click="formatJson">格式化</el-button>
            </el-tooltip>
            <el-tooltip content="压缩为单行" placement="bottom">
              <el-button text size="small" :icon="Sort" @click="minifyJson">压缩</el-button>
            </el-tooltip>
            <el-divider direction="vertical" />
            <el-tooltip content="查找 / 替换 (Ctrl+F)" placement="bottom">
              <el-button text size="small" class="json-find-btn" :icon="Search" @click="openFind('find')" />
            </el-tooltip>
          </div>
        </div>
        <div class="source-body">
          <!-- 行号 -->
          <div ref="lineNumsRef" class="line-nums" aria-hidden="true">
            <pre>{{ lineNumbers }}</pre>
          </div>
          <!-- 源码编辑器：高亮层 + 透明文本域 -->
          <div class="source-stack">
            <pre ref="hlRef" class="source-highlight" aria-hidden="true"><code v-html="highlightedHtml"></code></pre>
            <textarea
              ref="taRef"
              :value="modelValue"
              class="json-textarea"
              spellcheck="false"
              placeholder="在此输入 JSON 内容..."
              wrap="off"
              @input="handleInput"
              @beforeinput="onBeforeInput"
              @keydown.tab.prevent="handleTab"
              @keydown="onFindShortcut"
              @scroll="syncScroll"
              @mouseup="scheduleAskAi"
              @keyup="scheduleAskAi"
              @select="scheduleAskAi"
              @blur="onAskAiBlur"
            />
            <!-- 查找 / 替换栏 -->
            <FindBar ref="findBarRef" :target="taRef" :text="modelValue" @update:modelValue="onFindReplace" />
          </div>
        </div>
      </div>

      <!-- 选中源码后的浮动按钮：问 AI / 生成图表 -->
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

      <!-- 右侧：所见即所得树形视图 -->
      <div class="editor-pane preview-pane" :class="{ 'full-width': viewMode }">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><View /></el-icon> 树形视图
          </span>
          <div class="pane-tools tree-tools">
            <el-tooltip content="格式化 (整理缩进)" placement="bottom">
              <el-button text size="small" :icon="MagicStick" @click="formatJson" />
            </el-tooltip>
            <el-tooltip content="压缩为单行" placement="bottom">
              <el-button text size="small" :icon="Sort" @click="minifyJson" />
            </el-tooltip>
            <el-divider direction="vertical" />
            <el-tooltip content="展开全部" placement="bottom">
              <el-button text size="small" :icon="CaretBottom" @click="expandAll" />
            </el-tooltip>
            <el-tooltip content="折叠全部" placement="bottom">
              <el-button text size="small" :icon="CaretTop" @click="collapseAll" />
            </el-tooltip>
          </div>
          <span class="pane-status" :class="{ 'is-error': !!jsonError }" :title="jsonError">
            {{ jsonError ? 'JSON 无效' : 'JSON 有效' }}
          </span>
        </div>
        <div class="tree-body" :class="{ 'has-error': !!jsonError }">
          <div v-if="jsonError" class="tree-error">
            <el-icon class="tree-error-icon"><WarningFilled /></el-icon>
            <div class="tree-error-text">{{ jsonError }}</div>
          </div>
          <div v-else-if="treeData !== null" class="tree-root">
            <JsonTreeItem
              :value="treeData"
              path="$"
              :depth="0"
              root
              :expanded="expandedSet"
              :editing="editing"
              @update-editing="onUpdateEditing"
              @change="onTreeChange"
              @update-root="onUpdateRoot"
            />
          </div>
          <div v-else class="tree-empty">暂无内容</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * JSON 编辑器：左侧源码（语法高亮 + 行号 + 查找替换），
 * 右侧所见即所得树形视图（展开折叠 / 内联编辑 / 增删改 / 类型切换）。
 *
 * 源码与树形视图双向同步：
 * - 源码变更 → 防抖解析 → 合法则刷新树；非法则树保留最后一次合法数据并提示错误
 * - 树形编辑 → 直接序列化回源码（格式化输出），并记录撤销快照
 *
 * @module components/JsonEditor
 */
import { computed, ref, watch, reactive, onBeforeUnmount } from 'vue'
import { Document, View, Search, MagicStick, TrendCharts, Sort, WarningFilled, CaretBottom, CaretTop } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import hljs from 'highlight.js/lib/core'
import jsonLang from 'highlight.js/lib/languages/json'
import { getTextareaSelectionEndPos } from '../utils/caret'
import { useTextareaHistory } from '../utils/history'
import FindBar from './FindBar.vue'
import JsonTreeItem from './JsonTreeItem.vue'

hljs.registerLanguage('json', jsonLang)

const props = withDefaults(
  defineProps<{
    /** JSON 内容（v-model） */
    modelValue: string
    /** 编辑器高度 */
    height?: string
    /** 只读视图模式：隐藏源码区，树形视图占满 */
    viewMode?: boolean
  }>(),
  {
    height: '360px',
    viewMode: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 点击"问 AI"按钮：携带选中的源码文本 */
  (e: 'ask-ai', text: string): void
  /** 点击"生成图表"按钮：以选中的源码文本作为描述，交由父组件生成图表代码 */
  (e: 'generate-diagram', text: string): void
}>()

const taRef = ref<HTMLTextAreaElement>()
const hlRef = ref<HTMLElement>()
const lineNumsRef = ref<HTMLElement>()
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)

/* ========== 源码高亮 ========== */

const highlightedHtml = computed(() => {
  const src = props.modelValue
  if (!src) return ''
  try {
    return hljs.highlight(src, { language: 'json' }).value
  } catch {
    // 高亮失败时转义原文本，避免注入
    return escapeHtml(src)
  }
})

/** HTML 转义（高亮失败时的兜底） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行号：1..N */
const lineNumbers = computed(() => {
  const count = props.modelValue ? props.modelValue.split('\n').length : 1
  const lines: string[] = []
  for (let i = 1; i <= count; i++) lines.push(String(i))
  return lines.join('\n')
})

/** 源码 / 行号滚动同步 */
function syncScroll() {
  const ta = taRef.value
  if (!ta) return
  if (hlRef.value) {
    hlRef.value.scrollTop = ta.scrollTop
    hlRef.value.scrollLeft = ta.scrollLeft
  }
  if (lineNumsRef.value) {
    lineNumsRef.value.scrollTop = ta.scrollTop
  }
}

/* ========== 撤销 / 重做历史（源码 + 树形编辑共用） ========== */

const history = useTextareaHistory({
  getTextarea: () => taRef.value,
  getValue: () => props.modelValue,
  applyValue: (value: string) => emit('update:modelValue', value),
})

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

/* ========== 格式化 / 压缩 ========== */

/** 解析当前内容；失败时提示并返回 null */
function tryParse(text: string): { ok: true; data: any } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, data: null }
  try {
    return { ok: true, data: JSON.parse(trimmed) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 格式化：解析后以 2 空格缩进重排 */
function formatJson() {
  const result = tryParse(props.modelValue)
  if (!result.ok) {
    ElMessage.error(`格式化失败：${result.error}`)
    return
  }
  history.push(true)
  emit('update:modelValue', result.data === null ? '' : JSON.stringify(result.data, null, 2))
  ElMessage.success('已格式化')
}

/** 压缩：解析后输出为单行 */
function minifyJson() {
  const result = tryParse(props.modelValue)
  if (!result.ok) {
    ElMessage.error(`压缩失败：${result.error}`)
    return
  }
  history.push(true)
  emit('update:modelValue', result.data === null ? '' : JSON.stringify(result.data))
  ElMessage.success('已压缩')
}

/* ========== 树形视图数据 ========== */

/** 树形视图绑定的数据（reactive，编辑时直接改它再序列化） */
const treeData = ref<any>(null)
/** 展开路径集合 */
const expandedSet = ref<Set<string>>(new Set(['$']))
/** 当前正在编辑的节点 */
const editing = ref<{ path: string; field: 'key' | 'value' } | null>(null)
/** JSON 解析错误（源码非法时展示） */
const jsonError = ref('')

/** 序列化树形数据（保持根为空时的空串语义） */
function serializeTree(): string {
  const data = treeData.value
  if (data === null || data === undefined) return ''
  return JSON.stringify(data, null, 2)
}

/** 收集所有容器路径（用于展开全部） */
function collectContainerPaths(value: any, path: string, acc: Set<string>): void {
  if (value === null || typeof value !== 'object') return
  acc.add(path)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectContainerPaths(value[i], `${path}[${i}]`, acc)
  } else {
    for (const k of Object.keys(value)) collectContainerPaths(value[k], `${path}[${JSON.stringify(k)}]`, acc)
  }
}

function expandAll() {
  const next = new Set<string>(['$'])
  collectContainerPaths(treeData.value, '$', next)
  expandedSet.value = next
}

function collapseAll() {
  expandedSet.value = new Set(['$'])
}

/** 源码 → 树（防抖）：合法则刷新树，非法则保留旧树并提示 */
let syncTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.modelValue,
  (val) => {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      const result = tryParse(val)
      if (result.ok) {
        // 内容与当前树一致（树形编辑回写）时跳过，避免重置树状态
        const current = serializeTree()
        if (val.trim() === '' && current === '') {
          treeData.value = null
        } else if (current !== val.trim()) {
          // 以 reactive 包裹，保证树形编辑时模板能响应嵌套变更
          treeData.value = result.data === null ? null : reactive(result.data)
          jsonError.value = ''
        } else {
          jsonError.value = ''
        }
      } else {
        jsonError.value = result.error
      }
    }, 250)
  },
  { immediate: true },
)

/** 树 → 源码：记录撤销快照并序列化回写 */
function onTreeChange() {
  history.push(true)
  emit('update:modelValue', serializeTree())
}

/** 根节点值被整体替换（类型切换） */
function onUpdateRoot(newValue: any) {
  treeData.value = newValue === null ? null : reactive(JSON.parse(JSON.stringify(newValue)))
  expandedSet.value = new Set(['$'])
  onTreeChange()
}

function onUpdateEditing(state: { path: string; field: 'key' | 'value' } | null) {
  editing.value = state
}

/* ========== "问 AI"浮动按钮 ========== */

const askAiVisible = ref(false)
const askAiX = ref(0)
const askAiY = ref(0)
let askAiTimer: ReturnType<typeof setTimeout> | undefined

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
 * 同步设置 textarea 值与光标，避免受控组件把光标重置到文末。
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

/* ========== 查找 / 替换 ========== */

function openFind(mode: 'find' | 'replace') {
  findBarRef.value?.open(mode)
}

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

onBeforeUnmount(() => {
  clearTimeout(syncTimer)
  clearTimeout(askAiTimer)
})

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
.json-editor {
  display: flex;
  flex-direction: column;
  background: var(--bg-color-container);
  overflow: hidden;
}

.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
  background: var(--border-color-light);
}

.editor-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: var(--bg-color-white);
}

.editor-pane.full-width {
  flex: 1;
}

/* 源码区：作为查找栏的定位基准 */
.source-pane {
  position: relative;
}

.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  min-height: 40px;
  background: var(--bg-color-page);
  border-bottom: 1px solid var(--border-color-lighter);
  flex-shrink: 0;
}

.pane-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color-secondary);
  flex-shrink: 0;
}

.pane-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.pane-tools .el-button {
  font-size: 12px;
  color: var(--text-color-regular);
  flex-shrink: 0;
}

.tree-tools {
  justify-content: flex-end;
}

/* 状态徽标 */
.pane-status {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  height: 18px;
  border-radius: 9px;
  font-size: 11px;
  background: var(--el-color-success-light-9);
  color: #67c23a;
  flex-shrink: 0;
  user-select: none;
}

.pane-status.is-error {
  background: var(--el-color-danger-light-9);
  color: #f56c6c;
}

/* ========== 源码区 ========== */
.source-body {
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--bg-color-container);
}

/* 行号 */
.line-nums {
  width: 46px;
  flex-shrink: 0;
  overflow: hidden;
  padding: 16px 8px 16px 12px;
  background: var(--bg-color-container);
  border-right: 1px solid var(--border-color-lighter);
  user-select: none;
  text-align: right;
}

.line-nums pre {
  margin: 0;
  font-family: 'Consolas', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-placeholder);
  white-space: pre;
}

/* 高亮层 + 透明文本域 */
.source-stack {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.source-highlight {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 16px;
  overflow: auto;
  pointer-events: none;
  font-family: 'Consolas', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-primary);
  tab-size: 2;
  white-space: pre;
}

.source-highlight code {
  font: inherit;
  color: inherit;
  background: transparent;
}

.json-textarea {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 16px;
  overflow: auto;
  font-family: 'Consolas', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: transparent;
  caret-color: var(--text-color-primary);
  background: transparent;
  tab-size: 2;
  white-space: pre;
  z-index: 2;
}

.json-textarea::placeholder {
  color: var(--text-color-placeholder);
}

/* 高亮层中的 token 颜色覆盖（textarea 透明文字，靠下方高亮层显色） */
.source-highlight :deep(.hljs-keyword),
.source-highlight :deep(.hljs-literal) {
  color: #7c3aed;
}

.source-highlight :deep(.hljs-string) {
  color: #1a7f37;
}

.source-highlight :deep(.hljs-number) {
  color: #d97706;
}

.source-highlight :deep(.hljs-attr) {
  color: #0b6bcb;
}

/* ========== 树形视图 ========== */
.tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 16px;
  background: var(--bg-color-white);
  position: relative;
}

.tree-body.has-error {
  background: var(--el-color-danger-light-9);
}

.tree-root {
  display: inline-block;
  min-width: 100%;
}

.tree-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-color-placeholder);
  font-size: 13px;
}

/* 解析错误提示 */
.tree-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 6px;
  margin-bottom: 10px;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.6;
}

.tree-error-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.tree-error-text {
  word-break: break-all;
  white-space: pre-wrap;
  user-select: text;
}

/* 选中源码后的浮动按钮组：问 AI / 生成图表 */
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
