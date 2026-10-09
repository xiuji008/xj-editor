<template>
  <transition name="el-zoom-in-top">
    <div v-show="visible" class="preview-find-bar">
      <div class="find-row">
        <el-input
          ref="inputRef"
          v-model="keyword"
          size="small"
          class="find-input"
          placeholder="在预览中查找"
          @keydown="onKeydown"
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
        <el-tooltip content="关闭 (Esc)" placement="top">
          <el-button text size="small" class="find-btn" :icon="Close" @click="close" />
        </el-tooltip>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
/**
 * 预览区查找栏：在渲染结果（Markdown 预览 / HTML 预览 iframe）中查找并高亮。
 * 与源码区 FindBar 的区别：目标为 DOM，只查找高亮、不提供替换。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { ElInput } from 'element-plus'
import { Search, ArrowUp, ArrowDown, Close } from '@element-plus/icons-vue'
import {
  createDomHighlighter,
  ensureDomFindStyles,
  findDomMatches,
  scrollMatchIntoView,
  type DomMatch,
} from '../utils/domFind'

const props = defineProps<{
  /** 查找范围根节点（预览内容容器） */
  root: HTMLElement | undefined
  /** 滚动容器：用于把当前匹配滚动到视口中间 */
  scroller: HTMLElement | undefined
  /** 文档上下文；iframe 预览传入 iframe 的 contentWindow，缺省为主窗口 */
  win?: Window
  /** 内容版本（如渲染后的 HTML）：变化时重算匹配，保证预览重渲染后高亮不失效 */
  revision?: string | number
}>()

/** 高亮配色需定义在各目标文档中，主窗口与 iframe 都要注入 */
const targetDoc = () => props.win?.document ?? document

const visible = ref(false)
const keyword = ref('')
const caseSensitive = ref(false)
const matches = ref<DomMatch[]>([])
const currentIndex = ref(-1)

const total = computed(() => matches.value.length)
const currentNo = computed(() => (currentIndex.value >= 0 ? currentIndex.value + 1 : 0))
/** 窗口切换（iframe 重载）后需按新文档重建高亮控制器 */
const highlighter = computed(() => createDomHighlighter(props.win ?? window))

const inputRef = ref<InstanceType<typeof ElInput> | null>(null)

function applyHighlights() {
  highlighter.value.apply(matches.value, currentIndex.value)
}

function clearHighlights() {
  highlighter.value.clear()
}

/** 重新计算匹配；reset 为 true 时定位并滚动到第一个匹配 */
function recompute(reset: boolean) {
  matches.value = props.root && keyword.value
    ? findDomMatches(props.root, keyword.value, caseSensitive.value)
    : []
  if (reset) currentIndex.value = matches.value.length ? 0 : -1
  else if (currentIndex.value >= matches.value.length) {
    currentIndex.value = matches.value.length ? 0 : -1
  }
  applyHighlights()
  // 仅首次定位时滚动：预览重渲染 / 输入过程中不改变用户当前视口
  if (reset && currentIndex.value >= 0) scrollTo(currentIndex.value)
}

function scrollTo(idx: number) {
  const m = matches.value[idx]
  const scroller = props.scroller
  if (!m || !scroller) return
  scrollMatchIntoView(m, scroller)
}

/** 跳转并高亮第 idx 个匹配（越界时循环） */
function goTo(idx: number) {
  if (matches.value.length === 0) return
  if (idx < 0) idx = matches.value.length - 1
  else if (idx >= matches.value.length) idx = 0
  currentIndex.value = idx
  scrollTo(idx)
  applyHighlights()
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

// 预览重渲染后，旧的 Range 已脱离文档，需按新 DOM 重算（保留当前序号，不滚动）
watch(
  () => props.revision,
  () => {
    if (visible.value && keyword.value) recompute(false)
  },
)

// iframe 重载后文档是新的：重新注入配色并重算
watch(
  () => props.win,
  (win) => {
    ensureDomFindStyles(win?.document ?? document)
    if (visible.value && keyword.value) recompute(false)
  },
)

watch(
  () => props.root,
  () => {
    if (visible.value && keyword.value) recompute(false)
  },
)

/* ========== 打开 / 关闭 ========== */

/** 打开查找栏；预览中有选中文本时预填为关键词 */
function open() {
  visible.value = true
  const sel = props.win?.getSelection?.()?.toString().trim()
  if (sel && !sel.includes('\n')) keyword.value = sel
  recompute(true)
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function close() {
  if (!visible.value) return
  visible.value = false
  matches.value = []
  currentIndex.value = -1
  clearHighlights()
}

/* ========== 键盘 ========== */

function onKeydown(e: Event | KeyboardEvent) {
  const ev = e as KeyboardEvent
  const mod = ev.ctrlKey || ev.metaKey
  if (mod && ev.key.toLowerCase() === 'f') {
    ev.preventDefault()
    focusInput()
  } else if (ev.key === 'Enter' && ev.shiftKey) {
    ev.preventDefault()
    prev()
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    next()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    close()
  } else if (ev.key === 'F3') {
    ev.preventDefault()
    if (ev.shiftKey) prev()
    else next()
  }
}

function focusInput() {
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

onMounted(() => ensureDomFindStyles(targetDoc()))
onBeforeUnmount(clearHighlights)

defineExpose({ open, close, next, prev, visible })
</script>

<style scoped>
.preview-find-bar {
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

.find-row {
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
