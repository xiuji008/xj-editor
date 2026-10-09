<template>
  <transition name="el-zoom-in-top">
    <div v-show="visible" class="find-bar">
      <div class="find-row">
        <el-input
          ref="findInputRef"
          v-model="keyword"
          size="small"
          class="find-input"
          placeholder="查找"
          @keydown="onFindKeydown"
        >
          <template #prefix>
            <el-icon class="find-prefix-icon"><Search /></el-icon>
          </template>
          <template #suffix>
            <span v-if="keyword && total === 0" class="find-status no-result">无结果</span>
            <span v-else-if="total > 0" class="find-status">{{ currentNo }}/{{ total }}</span>
          </template>
        </el-input>
        <el-tooltip content="区分大小写" placement="top">
          <el-button
            text
            size="small"
            class="find-btn"
            :class="{ 'is-active': caseSensitive }"
            @click="caseSensitive = !caseSensitive"
          >
            Aa
          </el-button>
        </el-tooltip>
        <el-tooltip content="上一个 (Shift+Enter)" placement="top">
          <el-button text size="small" class="find-btn" :icon="ArrowUp" @click="prev" />
        </el-tooltip>
        <el-tooltip content="下一个 (Enter)" placement="top">
          <el-button text size="small" class="find-btn" :icon="ArrowDown" @click="next" />
        </el-tooltip>
        <el-button
          text
          size="small"
          class="find-btn"
          :class="{ 'is-active': replaceMode }"
          @click="toggleReplace"
        >
          替换
        </el-button>
        <el-tooltip content="关闭 (Esc)" placement="top">
          <el-button text size="small" class="find-btn" :icon="Close" @click="close" />
        </el-tooltip>
      </div>
      <div v-if="replaceMode" class="replace-row">
        <el-input
          ref="replaceInputRef"
          v-model="replaceText"
          size="small"
          class="find-input"
          placeholder="替换为"
          @keydown="onReplaceKeydown"
        />
        <el-button size="small" :disabled="total === 0" @click="replaceCurrent">替换</el-button>
        <el-button size="small" :disabled="total === 0" @click="replaceAll">全部替换</el-button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { ElInput } from 'element-plus'
import { Search, ArrowUp, ArrowDown, Close } from '@element-plus/icons-vue'
import { computeMatches, scrollTextareaToOffset } from '../utils/find'

const props = defineProps<{
  /** 目标文本域元素（父组件在模板中传入 ref 会被自动解包为元素） */
  target: HTMLTextAreaElement | undefined
  /** 当前文档全文（用于计算匹配与替换） */
  text: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 跳转到某个匹配：会选中匹配文本，供父组件抑制"选中浮动按钮"等副作用 */
  (e: 'jump'): void
}>()

const ta = computed(() => props.target)

const visible = ref(false)
const keyword = ref('')
const replaceText = ref('')
const caseSensitive = ref(false)
const replaceMode = ref(false)

const matches = ref<number[]>([])
const currentIndex = ref(-1)

const total = computed(() => matches.value.length)
const currentNo = computed(() => (currentIndex.value >= 0 ? currentIndex.value + 1 : 0))

const findInputRef = ref<InstanceType<typeof ElInput> | null>(null)
const replaceInputRef = ref<InstanceType<typeof ElInput> | null>(null)

/* ========== 匹配计算与高亮 ========== */

/** 重新计算匹配：reset 为 true 时定位到第一个匹配，否则仅收敛当前索引 */
function recompute(reset: boolean) {
  matches.value = computeMatches(props.text, keyword.value, caseSensitive.value)
  if (reset) {
    currentIndex.value = matches.value.length ? 0 : -1
    const textarea = ta.value
    if (textarea && keyword.value && matches.value.length) {
      const m = matches.value[0]
      textarea.setSelectionRange(m, m + keyword.value.length)
    }
  } else if (currentIndex.value >= matches.value.length) {
    currentIndex.value = matches.value.length ? 0 : -1
  }
  applyHighlights()
}

/** 用 CSS Custom Highlight API 在 textarea 中高亮所有匹配与当前匹配 */
function applyHighlights() {
  const textarea = ta.value
  if (!textarea || typeof CSS === 'undefined' || !CSS.highlights) return
  const registry = CSS.highlights
  registry.delete('md-find')
  registry.delete('md-find-active')
  const kw = keyword.value
  if (!kw || matches.value.length === 0) return
  const ranges: Range[] = matches.value.map((m) => {
    const r = new Range()
    r.setStart(textarea, m)
    r.setEnd(textarea, m + kw.length)
    return r
  })
  const all = new Highlight(...ranges)
  all.priority = 10
  registry.set('md-find', all)

  const cur = matches.value[currentIndex.value]
  if (cur != null) {
    const r = new Range()
    r.setStart(textarea, cur)
    r.setEnd(textarea, cur + kw.length)
    const active = new Highlight(r)
    active.priority = 20
    registry.set('md-find-active', active)
  }
}

function clearHighlights() {
  if (typeof CSS === 'undefined' || !CSS.highlights) return
  CSS.highlights.delete('md-find')
  CSS.highlights.delete('md-find-active')
}

/** 跳转并选中第 idx 个匹配（越界时循环） */
function goTo(idx: number) {
  const textarea = ta.value
  if (!textarea || matches.value.length === 0) return
  if (idx < 0) idx = matches.value.length - 1
  else if (idx >= matches.value.length) idx = 0
  currentIndex.value = idx
  const m = matches.value[idx]
  const kw = keyword.value
  textarea.focus()
  textarea.setSelectionRange(m, m + kw.length)
  scrollTextareaToOffset(textarea, m)
  applyHighlights()
  emit('jump')
}

function next() {
  goTo(currentIndex.value + 1)
}

function prev() {
  goTo(currentIndex.value - 1)
}

watch(keyword, () => {
  if (visible.value) recompute(true)
})

watch(caseSensitive, () => {
  if (visible.value) recompute(true)
})

watch(
  () => props.text,
  () => {
    if (visible.value) recompute(false)
  }
)

/* ========== 打开 / 关闭 ========== */

/** 打开查找栏；mode 为 find 时聚焦查找框，replace 时聚焦替换框 */
function open(mode: 'find' | 'replace' = 'find') {
  visible.value = true
  replaceMode.value = mode === 'replace'
  // 编辑器中有选中文本时，预填为查找关键词
  const textarea = ta.value
  if (textarea && textarea.selectionEnd > textarea.selectionStart) {
    const sel = props.text.slice(textarea.selectionStart, textarea.selectionEnd)
    if (sel.trim() && !sel.includes('\n')) keyword.value = sel
  }
  recompute(true)
  nextTick(() => {
    if (replaceMode.value) replaceInputRef.value?.focus()
    else {
      findInputRef.value?.focus()
      findInputRef.value?.select()
    }
  })
}

function close() {
  if (!visible.value) return
  visible.value = false
  clearHighlights()
  ta.value?.focus()
}

/* ========== 替换 ========== */

/** 替换当前匹配，并自动跳到替换后的下一个匹配 */
function replaceCurrent() {
  const textarea = ta.value
  const kw = keyword.value
  if (!textarea || !kw) return
  const m = matches.value[currentIndex.value]
  if (m == null) return
  const rep = replaceText.value
  const newText = props.text.slice(0, m) + rep + props.text.slice(m + kw.length)
  const nextPos = m + rep.length
  emit('update:modelValue', newText)
  nextTick(() => {
    recompute(false)
    let ni = matches.value.findIndex((x) => x >= nextPos)
    if (ni === -1) ni = matches.value.length ? 0 : -1
    if (ni >= 0) goTo(ni)
  })
}

/** 替换全部匹配（从后往前替换避免索引错位） */
function replaceAll() {
  const kw = keyword.value
  if (!kw || matches.value.length === 0) return
  const rep = replaceText.value
  let result = props.text
  for (let i = matches.value.length - 1; i >= 0; i--) {
    const m = matches.value[i]
    result = result.slice(0, m) + rep + result.slice(m + kw.length)
  }
  emit('update:modelValue', result)
  nextTick(() => recompute(false))
}

function toggleReplace() {
  replaceMode.value = !replaceMode.value
  if (replaceMode.value) nextTick(() => replaceInputRef.value?.focus())
}

/* ========== 输入框键盘 ========== */

function onFindKeydown(e: Event | KeyboardEvent) {
  const ev = e as KeyboardEvent
  const mod = ev.ctrlKey || ev.metaKey
  if (mod && ev.key.toLowerCase() === 'f') {
    ev.preventDefault()
    focusFind()
  } else if (mod && ev.key.toLowerCase() === 'h') {
    ev.preventDefault()
    replaceMode.value = true
    nextTick(() => replaceInputRef.value?.focus())
  } else if (ev.key === 'Enter' && ev.shiftKey) {
    ev.preventDefault()
    prev()
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    next()
  } else if (ev.key === 'Escape') {
    close()
  } else if (ev.key === 'F3' && ev.shiftKey) {
    ev.preventDefault()
    prev()
  } else if (ev.key === 'F3') {
    ev.preventDefault()
    next()
  }
}

function onReplaceKeydown(e: Event | KeyboardEvent) {
  const ev = e as KeyboardEvent
  if (ev.key === 'Enter') {
    ev.preventDefault()
    replaceCurrent()
  } else if (ev.key === 'Escape') {
    close()
  } else if (ev.key === 'F3' && ev.shiftKey) {
    ev.preventDefault()
    prev()
  } else if (ev.key === 'F3') {
    ev.preventDefault()
    next()
  }
}

function focusFind() {
  nextTick(() => {
    findInputRef.value?.focus()
    findInputRef.value?.select()
  })
}

onBeforeUnmount(clearHighlights)

// visible 供父组件判断"查找栏是否打开"（如打开时不显示选中文本的浮动按钮）
defineExpose({ open, close, next, prev, visible })
</script>

<style scoped>
.find-bar {
  position: absolute;
  top: 46px;
  right: 12px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--bg-color-white);
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  user-select: none;
}

.find-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.find-input {
  width: 240px;
}

.find-input :deep(.el-input__wrapper) {
  padding-right: 6px;
}

.find-btn {
  font-size: 13px;
  color: var(--text-color-regular);
}

.find-btn.is-active {
  color: var(--color-primary);
  background-color: var(--color-primary-light-9);
}

.find-prefix-icon {
  font-size: 14px;
}

.find-status {
  font-size: 12px;
  color: var(--text-color-secondary);
  white-space: nowrap;
}

.find-status.no-result {
  color: #f56c6c;
}
</style>

<style>
/* 文本域内查找高亮（CSS Custom Highlight API，作用于任意组件内的 textarea，需全局定义） */
::highlight(md-find) {
  background-color: rgba(230, 162, 60, 0.45);
  color: inherit;
}

::highlight(md-find-active) {
  background-color: rgba(64, 158, 255, 0.9);
  color: #ffffff;
}
</style>
