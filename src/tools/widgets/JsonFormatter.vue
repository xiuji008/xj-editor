<template>
  <div class="json-workbench">
    <!-- 顶部操作条：作用于左侧源码 -->
    <div class="wb-toolbar">
      <el-button size="small" :icon="MagicStick" @click="applyFormat">格式化</el-button>
      <el-button size="small" :icon="Coin" @click="applyMinify">压缩</el-button>
      <el-button size="small" :icon="Sort" @click="applySort">排序键</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" :icon="FolderOpened" @click="pickFile">打开文件</el-button>
      <el-button size="small" @click="fillSample">示例</el-button>
      <el-button size="small" :icon="Delete" @click="clearAll">清空</el-button>
      <div class="toolbar-spacer" />
      <el-checkbox v-model="autoParse" size="small">自动解析</el-checkbox>
    </div>

    <el-alert
      v-if="errorMessage"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
      class="wb-alert"
    />
    <el-alert
      v-else-if="stale && hasInput"
      title="内容较大或已暂停自动解析，点击「解析」刷新右侧视图"
      type="info"
      :closable="false"
      show-icon
      class="wb-alert"
    />

    <div ref="bodyRef" class="wb-body" v-loading="busy" element-loading-text="处理中…">
      <!-- 左：JSON 源码 -->
      <section class="wb-pane" :style="{ width: leftWidth }">
        <header class="pane-head">
          <span class="pane-title">JSON 源码</span>
          <div class="pane-actions">
            <el-button text size="small" :icon="DocumentCopy" @click="copyInput">复制</el-button>
            <el-button text size="small" type="primary" :icon="Refresh" @click="parseNow">解析</el-button>
          </div>
        </header>
        <JsonCodePane v-model="input" :error-line="errorLine" @file="loadFile" />
      </section>

      <div class="wb-splitter" @mousedown.prevent="startDrag"><span class="splitter-bar" /></div>

      <!-- 右：树视图 / 文本输出 -->
      <section class="wb-pane">
        <header class="pane-head">
          <div class="view-switch">
            <button type="button" :class="{ active: view === 'tree' }" @click="view = 'tree'">树视图</button>
            <button type="button" :class="{ active: view === 'text' }" @click="view = 'text'">文本输出</button>
          </div>
          <div class="pane-actions">
            <template v-if="view === 'tree'">
              <el-input
                v-model="keyword"
                size="small"
                placeholder="搜索键名或值"
                clearable
                class="tree-search"
              />
              <el-button text size="small" @click="expandTree">展开</el-button>
              <el-button text size="small" @click="collapseTree">折叠</el-button>
            </template>
            <template v-else>
              <el-select v-model="mode" size="small" class="mode-select">
                <el-option label="格式化" value="format" />
                <el-option label="压缩" value="minify" />
                <el-option label="转义" value="escape" />
                <el-option label="去转义" value="unescape" />
              </el-select>
              <el-select v-if="mode === 'format'" v-model="indent" size="small" class="indent-select">
                <el-option label="2 空格" value="2" />
                <el-option label="4 空格" value="4" />
                <el-option label="Tab" value="tab" />
              </el-select>
              <el-button text size="small" :icon="RefreshLeft" @click="outputToInput">写回左侧</el-button>
            </template>
            <el-button text size="small" :icon="DocumentCopy" @click="copyOutput">复制</el-button>
            <el-button v-if="canInsert()" text size="small" :icon="Position" @click="handleInsert">插入</el-button>
          </div>
        </header>

        <div class="pane-content">
          <JsonTreePane
            v-if="view === 'tree' && tree"
            :store="tree"
            :version="treeVersion"
            :search="searchResult"
            :empty-text="emptyText"
            @change="treeVersion++"
          />
          <textarea v-else-if="view === 'text'" class="output-area" readonly spellcheck="false" wrap="off" :value="outputText" />
          <div v-else class="pane-mask">
            <el-empty :description="emptyText" :image-size="64" />
          </div>
        </div>
      </section>
    </div>

    <input ref="fileRef" type="file" accept=".json,.txt,application/json" hidden @change="onFilePicked" />
  </div>
</template>

<script setup lang="ts">
import {
  Coin,
  Delete,
  DocumentCopy,
  FolderOpened,
  MagicStick,
  Position,
  Refresh,
  RefreshLeft,
  Sort,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useClipboard } from '../useClipboard'
import { useToolContext } from '../context'
import JsonCodePane from './json/JsonCodePane.vue'
import JsonTreePane from './json/JsonTreePane.vue'
import {
  collapseAll,
  collectSearch,
  createTree,
  expandAll,
  type JsonTreeStore,
  type SearchResult,
} from './json/jsonTree'
import {
  describeJsonError,
  formatSize,
  indentString,
  sortJsonKeys,
  stringifyJson,
  type IndentOption,
} from './json/jsonUtils'

/** 右侧视图：树视图或文本输出 */
type RightView = 'tree' | 'text'
/** 文本输出模式 */
type OutputMode = 'format' | 'minify' | 'escape' | 'unescape'

/** 解析结果 */
interface ParseResult {
  /** 是否解析成功 */
  ok: boolean
  /** 解析后的值，失败时为 undefined */
  value: unknown
  /** 错误信息，成功时为空 */
  message: string
  /** 出错行号 */
  line: number | null
  /** 出错列号 */
  column: number | null
  /** 出错字符偏移 */
  position: number | null
}

/** 空解析结果 */
const EMPTY_PARSE: ParseResult = { ok: true, value: undefined, message: '', line: null, column: null, position: null }
/** 自动解析的字符数上限，超过后改为手动触发，避免大 JSON 频繁解析 */
const AUTO_PARSE_LIMIT = 200000
/** 自动解析防抖时长（毫秒） */
const PARSE_DEBOUNCE = 350
/** 搜索防抖时长（毫秒） */
const SEARCH_DEBOUNCE = 250
/** 「展开」按钮默认展开的层级 */
const EXPAND_DEPTH = 3

const { copy } = useClipboard()
const { canInsert, insertText } = useToolContext()

/** 左侧源码 */
const input = ref('')
/** 右侧视图 */
const view = ref<RightView>('tree')
/** 文本输出模式 */
const mode = ref<OutputMode>('format')
/** 格式化缩进 */
const indent = ref<IndentOption>('2')
/** 是否自动解析 */
const autoParse = ref(true)
/** 是否正在处理耗时任务 */
const busy = ref(false)
/** 输入已变化但尚未解析（大文件或手动模式） */
const stale = ref(false)
/** 解析结果 */
const parseResult = shallowRef<ParseResult>(EMPTY_PARSE)
/** 树状态容器 */
const tree = shallowRef<JsonTreeStore | null>(null)
/** 树结构版本号 */
const treeVersion = ref(0)
/** 搜索关键词 */
const keyword = ref('')
/** 搜索结果 */
const searchResult = shallowRef<SearchResult | null>(null)
/** 左右分栏容器，用于计算拖拽比例 */
const bodyRef = ref<HTMLElement | null>(null)
/** 文件选择框 */
const fileRef = ref<HTMLInputElement | null>(null)
/** 左侧宽度百分比 */
const leftRatio = ref(50)

/** 是否有输入内容 */
const hasInput = computed(() => input.value.trim().length > 0)
/** 左侧宽度样式 */
const leftWidth = computed(() => `${leftRatio.value}%`)
/** 错误行号，用于左侧行号栏高亮 */
const errorLine = computed(() => parseResult.value.line)

/** 文本输出计算结果 */
const textResult = computed<{ text: string; message: string }>(() => {
  const raw = input.value
  if (!raw.trim()) {
    return { text: '', message: '' }
  }
  // 转义与去转义面向普通文本，不要求输入本身是合法 JSON
  if (mode.value === 'escape') {
    return { text: JSON.stringify(raw).slice(1, -1), message: '' }
  }
  if (mode.value === 'unescape') {
    try {
      const trimmed = raw.trim()
      const wrapped = trimmed.startsWith('"') ? trimmed : `"${trimmed}"`
      return { text: JSON.parse(wrapped) as string, message: '' }
    } catch {
      return { text: '', message: '去转义失败：文本不是合法的转义字符串' }
    }
  }
  if (!parseResult.value.ok) {
    return { text: '', message: '' }
  }
  const space = mode.value === 'format' ? indentString(indent.value) : undefined
  return { text: stringifyJson(parseResult.value.value, space), message: '' }
})

/** 文本输出内容 */
const outputText = computed(() => textResult.value.text)

/** 顶部错误提示 */
const errorMessage = computed(() => {
  const result = parseResult.value
  if (result.message) {
    const where = result.line ? `（第 ${result.line} 行第 ${result.column} 列）` : ''
    return `JSON 解析失败：${result.message}${where}`
  }
  if (mode.value === 'unescape') {
    return textResult.value.message
  }
  return ''
})

/** 右侧空状态文案 */
const emptyText = computed(() => {
  if (!hasInput.value) {
    return '在左侧输入或拖入 JSON 文件后展示结构'
  }
  return 'JSON 解析失败，修正后重新解析'
})

/** 自动解析定时器 */
let parseTimer: number | undefined
/** 搜索定时器 */
let searchTimer: number | undefined

/**
 * 执行解析并重建右侧树。
 *
 * @returns 是否解析成功
 */
function parseNow(): boolean {
  const raw = input.value
  if (!raw.trim()) {
    parseResult.value = EMPTY_PARSE
    tree.value = null
    stale.value = false
    return true
  }
  try {
    const value = JSON.parse(raw) as unknown
    parseResult.value = { ok: true, value, message: '', line: null, column: null, position: null }
    tree.value = createTree(value)
    treeVersion.value++
    stale.value = false
    refreshSearch()
    return true
  } catch (e) {
    const info = describeJsonError(e, raw)
    parseResult.value = {
      ok: false,
      value: undefined,
      message: info.message,
      line: info.line,
      column: info.column,
      position: info.position,
    }
    tree.value = null
    stale.value = false
    return false
  }
}

/**
 * 按当前关键词重新计算搜索结果。
 */
function refreshSearch(): void {
  const kw = keyword.value.trim()
  searchResult.value = kw && tree.value ? collectSearch(tree.value, kw) : null
}

/**
 * 执行耗时任务：先让出一帧渲染 loading，避免大 JSON 处理时界面无响应。
 *
 * @param task 待执行任务
 * @param success 成功提示文案，为空则不提示
 */
async function runTask(task: () => boolean | void, success = ''): Promise<void> {
  busy.value = true
  await new Promise((resolve) => setTimeout(resolve, 16))
  try {
    const ok = task()
    if (success && ok !== false) {
      ElMessage.success(success)
    }
  } finally {
    busy.value = false
  }
}

/**
 * 就地格式化左侧文本。
 */
function applyFormat(): void {
  void runTask(() => {
    if (!parseNow()) {
      return false
    }
    input.value = stringifyJson(parseResult.value.value, indentString(indent.value))
    return true
  }, '已格式化')
}

/**
 * 就地压缩左侧文本。
 */
function applyMinify(): void {
  void runTask(() => {
    if (!parseNow()) {
      return false
    }
    input.value = stringifyJson(parseResult.value.value)
    return true
  }, '已压缩')
}

/**
 * 就地按键名排序并格式化。
 */
function applySort(): void {
  void runTask(() => {
    if (!parseNow()) {
      return false
    }
    input.value = stringifyJson(sortJsonKeys(parseResult.value.value), indentString(indent.value))
    return true
  }, '已排序')
}

/**
 * 把右侧文本输出写回左侧输入框，便于二次处理。
 */
function outputToInput(): void {
  if (!outputText.value) {
    ElMessage.warning('暂无可写回的内容')
    return
  }
  input.value = outputText.value
}

/**
 * 复制左侧源码。
 */
function copyInput(): void {
  void copy(input.value)
}

/**
 * 复制右侧输出内容：树视图下复制格式化后的完整 JSON。
 */
function copyOutput(): void {
  const text = view.value === 'text' ? outputText.value : stringifyJson(parseResult.value.value, indentString(indent.value))
  void copy(text)
}

/**
 * 把处理结果插入到当前文档光标处。
 */
function handleInsert(): void {
  const text = view.value === 'text' ? outputText.value : stringifyJson(parseResult.value.value, indentString(indent.value))
  if (!text) {
    ElMessage.warning('暂无可插入的内容')
    return
  }
  insertText(text)
}

/**
 * 展开树节点（按层级限制，避免超大结构一次性展开）。
 */
function expandTree(): void {
  if (!tree.value) {
    return
  }
  expandAll(tree.value, EXPAND_DEPTH)
  treeVersion.value++
}

/**
 * 折叠全部树节点。
 */
function collapseTree(): void {
  if (!tree.value) {
    return
  }
  collapseAll(tree.value)
  treeVersion.value++
}

/**
 * 触发文件选择。
 */
function pickFile(): void {
  fileRef.value?.click()
}

/**
 * 文件选择回调。
 *
 * @param event 选择事件
 */
function onFilePicked(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) {
    void loadFile(file)
  }
}

/**
 * 读取文本文件内容到左侧输入框。
 *
 * @param file 目标文件
 */
async function loadFile(file: File): Promise<void> {
  busy.value = true
  try {
    const text = await readFileAsText(file)
    input.value = text
    ElMessage.success(`已载入 ${file.name}（${formatSize(text.length)}）`)
  } catch {
    ElMessage.error('文件读取失败')
  } finally {
    busy.value = false
  }
}

/**
 * 以文本方式读取文件。
 *
 * @param file 目标文件
 * @returns 文件内容
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

/**
 * 填入示例 JSON。
 */
function fillSample(): void {
  input.value = '{\n  "name": "MyHub",\n  "tools": ["json", "base64"],\n  "enabled": true,\n  "stats": { "stars": 128, "owner": null }\n}'
}

/**
 * 清空输入与解析结果。
 */
function clearAll(): void {
  input.value = ''
  parseResult.value = EMPTY_PARSE
  tree.value = null
  treeVersion.value++
  stale.value = false
  keyword.value = ''
  searchResult.value = null
}

/**
 * 启动分栏拖拽。
 *
 * @param event 鼠标事件
 */
function startDrag(): void {
  const rect = bodyRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }
  const onMove = (moveEvent: MouseEvent): void => {
    const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100
    leftRatio.value = Math.min(75, Math.max(25, ratio))
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 输入变化后按策略解析：手动模式或超大内容时仅标记为待解析
watch(input, (value) => {
  window.clearTimeout(parseTimer)
  if (!value.trim()) {
    parseNow()
    return
  }
  if (!autoParse.value || value.length > AUTO_PARSE_LIMIT) {
    stale.value = true
    return
  }
  parseTimer = window.setTimeout(() => parseNow(), PARSE_DEBOUNCE)
})

// 搜索关键词变化后防抖过滤
watch(keyword, (value) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    const kw = value.trim()
    searchResult.value = kw && tree.value ? collectSearch(tree.value, kw) : null
  }, SEARCH_DEBOUNCE)
})

onBeforeUnmount(() => {
  window.clearTimeout(parseTimer)
  window.clearTimeout(searchTimer)
})
</script>

<style scoped>
.json-workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 420px;
}

.wb-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.toolbar-spacer {
  flex: 1;
}

.wb-alert {
  margin-top: 8px;
  padding: 6px 8px;
}

.wb-body {
  flex: 1;
  min-height: 0;
  margin-top: 10px;
  display: flex;
}

.wb-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.wb-pane:first-child {
  flex: none;
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  flex-shrink: 0;
}

.pane-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pane-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-wrap: wrap;
}

.view-switch {
  display: inline-flex;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.view-switch button {
  border: none;
  outline: none;
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}

.view-switch button.active {
  background: var(--el-color-primary);
  color: #fff;
}

.tree-search {
  width: 150px;
}

.mode-select {
  width: 96px;
}

.indent-select {
  width: 92px;
}

.pane-content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.output-area {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 8px 10px;
  resize: none;
  outline: none;
  font-size: 13px;
  line-height: 20px;
  font-family: Consolas, 'Courier New', monospace;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-blank);
  white-space: pre;
  overflow: auto;
}

.pane-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-blank);
}

.wb-splitter {
  width: 8px;
  flex-shrink: 0;
  cursor: col-resize;
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.splitter-bar {
  width: 1px;
  background: var(--el-border-color-lighter);
}

.wb-splitter:hover .splitter-bar {
  width: 2px;
  background: var(--el-color-primary);
}
</style>
