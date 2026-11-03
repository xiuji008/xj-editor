<template>
  <div class="html-editor" :style="{ height }">
    <div class="editor-body">
      <!-- 左侧：HTML 源码 -->
      <div class="editor-pane source-pane" v-show="!viewMode">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><Document /></el-icon> HTML 源码
          </span>
          <div class="pane-tools">
            <el-tooltip content="查找 / 替换 (Ctrl+F)" placement="bottom">
              <el-button text size="small" class="html-find-btn" :icon="Search" @click="openFind('find')" />
            </el-tooltip>
          </div>
        </div>
        <textarea
          ref="taRef"
          :value="modelValue"
          class="html-textarea"
          spellcheck="false"
          placeholder="在此输入 HTML 内容..."
          @input="handleInput"
          @beforeinput="onBeforeInput"
          @keydown.tab.prevent="handleTab"
          @keydown="onFindShortcut"
          @scroll="onSourceScroll"
          @mouseup="scheduleAskAi"
          @keyup="scheduleAskAi"
          @select="scheduleAskAi"
          @blur="onAskAiBlur"
        />

        <!-- 查找 / 替换栏 -->
        <FindBar
          ref="findBarRef"
          :target="taRef"
          :text="modelValue"
          @update:modelValue="onFindReplace"
          @jump="onFindJump"
        />

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

      <!-- 右侧：实时预览（iframe 隔离渲染，所见即所得） -->
      <div class="editor-pane preview-pane" :class="{ 'full-width': viewMode }">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><View /></el-icon> 预览
          </span>
          <div class="pane-extra">
            <!-- 预览缩放：缩小 / 当前比例（点击恢复 100%）/ 放大，支持 Ctrl + 滚轮 -->
            <div class="zoom-tools">
              <el-tooltip content="缩小预览（Ctrl + 滚轮）" placement="bottom">
                <el-button text size="small" class="zoom-btn" :disabled="!canZoomOut" @click="onZoomOut">
                  <el-icon><ZoomOut /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="恢复 100%" placement="bottom">
                <el-button text size="small" class="zoom-value" @click="onZoomReset">
                  {{ zoomPercent }}
                </el-button>
              </el-tooltip>
              <el-tooltip content="放大预览（Ctrl + 滚轮）" placement="bottom">
                <el-button text size="small" class="zoom-btn" :disabled="!canZoomIn" @click="onZoomIn">
                  <el-icon><ZoomIn /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
            <el-tooltip content="重新加载" placement="bottom">
              <el-button text size="small" :icon="RefreshRight" @click="reloadPreview" />
            </el-tooltip>
          </div>
        </div>
        <iframe
          ref="iframeRef"
          class="html-preview-frame"
          :srcdoc="previewDoc"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          @load="onIframeLoad"
        />

        <!-- 预览内查找（Ctrl+F）：在 iframe 渲染结果中查找并高亮匹配 -->
        <PreviewFindBar
          ref="previewFindBarRef"
          :root="previewRoot"
          :scroller="previewScroller"
          :win="previewWin"
          :revision="previewDoc"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { Document, View, Search, MagicStick, TrendCharts, RefreshRight, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { getTextareaSelectionEndPos } from '../utils/caret'
import { useTextareaHistory } from '../utils/history'
import { usePreviewZoom, isZoomModifier } from '../utils/previewZoom'
import { ensureDomFindStyles } from '../utils/domFind'
import FindBar from './FindBar.vue'
import PreviewFindBar from './PreviewFindBar.vue'

const props = withDefaults(
  defineProps<{
    /** HTML 内容（v-model） */
    modelValue: string
    /** 编辑器高度 */
    height?: string
    /** 只读预览模式：隐藏源码区，预览占满 */
    viewMode?: boolean
    /** 当前 HTML 文件所在目录：用于预览中相对路径资源的解析基准 */
    baseDir?: string
  }>(),
  {
    height: '360px',
    viewMode: false,
    baseDir: '',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 点击"问 AI"按钮：携带选中的源码文本，交由父组件填入 AI 对话框 */
  (e: 'ask-ai', text: string): void
  /** 点击"生成图表"按钮：以选中的源码文本作为描述，交由父组件生成图表代码 */
  (e: 'generate-diagram', text: string): void
}>()

const taRef = ref<HTMLTextAreaElement>()
const iframeRef = ref<HTMLIFrameElement>()
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)
const previewFindBarRef = ref<InstanceType<typeof PreviewFindBar> | null>(null)
/** 预览查找的作用域：iframe 文档（每次 srcdoc 重载后更新） */
const previewWin = ref<Window>()
const previewRoot = ref<HTMLElement>()
const previewScroller = ref<HTMLElement>()

/** 撤销 / 重做历史（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z） */
const history = useTextareaHistory({
  getTextarea: () => taRef.value,
  getValue: () => props.modelValue,
  applyValue: (value: string) => emit('update:modelValue', value),
})

/* ========== 预览缩放 ========== */
/**
 * 把缩放写入 iframe 内部文档（等效浏览器缩放）：
 * 只缩放 iframe 内的内容，iframe 自身仍占满预览区、滚动由 iframe 内部承担，
 * 因此不会像直接缩放 iframe 元素那样撑出外层横向滚动条。
 *
 * 缩放施加在 body 上：html 的滚动区域会随之按比例放大，滚动条仍在 iframe 视口上；
 * 若直接缩放 iframe 元素本身，则会把 iframe 的盒子一起放大、撑出外层横向滚动条。
 */
function applyIframeZoom() {
  const doc = iframeRef.value?.contentDocument
  const target = doc?.body || doc?.documentElement
  if (!target) return
  target.style.zoom = String(previewZoom.value)
}

const {
  zoom: previewZoom,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  zoomIn,
  zoomOut,
  resetZoom,
} = usePreviewZoom({ storageKey: 'html-preview-zoom', onChange: applyIframeZoom })

/**
 * 以 iframe 视口中某个纵向位置为锚点缩放，缩放后该位置的内容保持不动
 * （按「内容偏移 / 内容总高」的比例换算）。
 */
function zoomIframeAt(viewportY: number, apply: () => void) {
  const scroller = getIframeScroller()
  if (!scroller) {
    apply()
    return
  }
  const before = scroller.scrollTop + viewportY
  const ratio = scroller.scrollHeight > 0 ? before / scroller.scrollHeight : 0
  apply()
  requestAnimationFrame(() => {
    const s = getIframeScroller()
    if (!s) return
    const max = Math.max(0, s.scrollHeight - s.clientHeight)
    const target = ratio * s.scrollHeight - viewportY
    // 标记为同步滚动，避免该程序性滚动反向带动源码区
    syncing = true
    s.scrollTop = Math.max(0, Math.min(target, max))
    requestAnimationFrame(() => {
      syncing = false
    })
  })
}

/** 放大（以预览区竖直中线为锚点） */
function onZoomIn() {
  const scroller = getIframeScroller()
  zoomIframeAt(scroller ? scroller.clientHeight / 2 : 0, () => zoomIn())
}

/** 缩小（以预览区竖直中线为锚点） */
function onZoomOut() {
  const scroller = getIframeScroller()
  zoomIframeAt(scroller ? scroller.clientHeight / 2 : 0, () => zoomOut())
}

/** 恢复 100% */
function onZoomReset() {
  const scroller = getIframeScroller()
  zoomIframeAt(scroller ? scroller.clientHeight / 2 : 0, () => resetZoom())
}

/** iframe 内的滚轮：Ctrl / Cmd + 滚轮以光标位置为锚点缩放预览（需阻止默认行为，避免整体页面缩放） */
function onIframeWheel(e: WheelEvent) {
  if (!isZoomModifier(e) || !e.deltaY) return
  e.preventDefault()
  const scroller = getIframeScroller()
  const viewportY = scroller ? e.clientY - scroller.getBoundingClientRect().top : 0
  zoomIframeAt(viewportY, () => (e.deltaY < 0 ? zoomIn() : zoomOut()))
}

/** 内容是否为完整 HTML 文档（包含 doctype 或 html 根标签） */
const isFullDocument = (content: string) => /<!doctype\s+html/i.test(content) || /<html[\s>]/i.test(content)

/** 将本地目录转换为 file:// URL（用于 <base> 标签解析相对路径资源） */
const toFileUrl = (dir: string): string => {
  const normalized = dir.replace(/\\/g, '/')
  return 'file:///' + encodeURI(normalized.startsWith('/') ? normalized : `/${normalized}`)
}

/** 预览文档：片段自动包裹为完整文档，并注入 <base> 解析本地相对资源 */
const previewDoc = computed(() => {
  const content = props.modelValue
  if (!content.trim()) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;color:#999;text-align:center;padding:40px 0">暂无内容</body></html>'
  }
  if (isFullDocument(content)) return content
  const base = props.baseDir ? `<base href="${toFileUrl(props.baseDir)}">` : ''
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8">${base}</head>\n<body>${content}</body></html>`
})

/** 手动重新加载预览（先清空再赋值，强制 iframe 重新执行脚本） */
const reloadPreview = () => {
  const iframe = iframeRef.value
  if (!iframe) return
  iframe.srcdoc = ''
  requestAnimationFrame(() => {
    if (iframeRef.value === iframe) iframe.srcdoc = previewDoc.value
  })
}

/** "问 AI"浮动按钮状态 */
const askAiVisible = ref(false)
const askAiX = ref(0)
const askAiY = ref(0)
let askAiTimer: ReturnType<typeof setTimeout> | undefined
/** 最近一次"查找跳转"的时间：跳转会选中匹配文本，此时不应弹出浮动按钮 */
let lastFindJumpAt = 0
/** 查找跳转后抑制浮动按钮的时间窗（覆盖关闭查找栏后继续按 F3 的场景） */
const FIND_JUMP_SUPPRESS_MS = 500
function onFindJump() {
  lastFindJumpAt = performance.now()
}

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
  // 查找栏打开 / 刚跳转过匹配时不显示：跳转会选中文本，弹出按钮会遮挡查找结果
  if (
    findBarRef.value?.visible ||
    previewFindBarRef.value?.visible ||
    performance.now() - lastFindJumpAt < FIND_JUMP_SUPPRESS_MS
  ) {
    askAiVisible.value = false
    return
  }
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

/* ========== 查找 / 替换 ========== */

/** 打开查找栏（查找 / 替换两种模式） */
function openFind(mode: 'find' | 'replace') {
  // 源码查找与预览查找互斥，避免两个查找栏叠加
  previewFindBarRef.value?.close()
  findBarRef.value?.open(mode)
}

/** 打开预览内查找（iframe 中渲染的内容无法用浏览器原生查找） */
function openPreviewFind() {
  findBarRef.value?.close()
  previewFindBarRef.value?.open()
}

/** iframe 内 Ctrl+F：交给预览查找栏 */
function onIframeKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (!(e.ctrlKey || e.metaKey)) return
  if (e.key.toLowerCase() !== 'f') return
  e.preventDefault()
  openPreviewFind()
}

/** 焦点是否在输入框 / 文本域 / 富文本中（是则不劫持其快捷键） */
const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/** 窗口级快捷键：纯预览模式（源码区隐藏）下 Ctrl+F 走预览内查找 */
function onWindowKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (!(e.ctrlKey || e.metaKey)) return
  if (isEditableTarget(e.target)) return
  if (e.key.toLowerCase() === 'f' && props.viewMode) {
    e.preventDefault()
    openPreviewFind()
  }
}

/** 查找栏替换结果回写源码（替换为独立撤销步骤） */
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

/* ========== 源码 / 预览同步滚动 ========== */

let syncing = false
let boundIframeWin: Window | null = null
/** iframe 内滚轮监听选项：必须是非被动监听，否则无法在 Ctrl / Cmd + 滚轮时阻止默认整页缩放 */
const WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: false }

/** 获取 iframe 内的滚动容器（scrollingElement 优先，兼容 body 滚动） */
function getIframeScroller(): HTMLElement | null {
  const win = iframeRef.value?.contentWindow
  if (!win?.document) return null
  return (win.document.scrollingElement as HTMLElement) || win.document.documentElement
}

/** 源码滚动 → 预览按比例跟随 */
function onSourceScroll() {
  if (syncing) return
  const ta = taRef.value
  const scroller = getIframeScroller()
  if (!ta || !scroller) return
  const max = ta.scrollHeight - ta.clientHeight
  if (max <= 0) return
  const ratio = ta.scrollTop / max
  const maxDoc = scroller.scrollHeight - scroller.clientHeight
  if (maxDoc <= 0) return
  syncing = true
  scroller.scrollTop = ratio * maxDoc
  requestAnimationFrame(() => {
    syncing = false
  })
}

/** 预览滚动 → 源码按比例跟随 */
function onIframeScroll() {
  if (syncing) return
  const ta = taRef.value
  const scroller = getIframeScroller()
  if (!ta || !scroller) return
  const maxDoc = scroller.scrollHeight - scroller.clientHeight
  if (maxDoc <= 0) return
  const ratio = scroller.scrollTop / maxDoc
  const max = ta.scrollHeight - ta.clientHeight
  if (max <= 0) return
  syncing = true
  ta.scrollTop = ratio * max
  requestAnimationFrame(() => {
    syncing = false
  })
}

/** iframe 加载完成后绑定其滚动 / 滚轮事件（srcdoc 更新会重新触发 load，需先解绑旧窗口） */
function onIframeLoad() {
  const win = iframeRef.value?.contentWindow
  if (!win) return
  if (boundIframeWin && boundIframeWin !== win) {
    boundIframeWin.removeEventListener('scroll', onIframeScroll, true)
    boundIframeWin.removeEventListener('wheel', onIframeWheel, WHEEL_LISTENER_OPTIONS)
    boundIframeWin.removeEventListener('keydown', onIframeKeydown)
  }
  win.addEventListener('scroll', onIframeScroll, true)
  // 非被动监听：Ctrl / Cmd + 滚轮需要在 iframe 内阻止默认行为（默认会触发整页缩放）
  win.addEventListener('wheel', onIframeWheel, WHEEL_LISTENER_OPTIONS)
  // iframe 内 Ctrl+F：交给预览查找栏（iframe 内容无法用浏览器原生查找）
  win.addEventListener('keydown', onIframeKeydown)
  boundIframeWin = win
  // srcdoc 更新后 iframe 文档被重建，需重新应用当前缩放
  applyIframeZoom()
  // 预览查找作用域更新为新文档（并注入 ::highlight 配色）
  const doc = iframeRef.value?.contentDocument
  if (doc) ensureDomFindStyles(doc)
  previewWin.value = win
  previewRoot.value = doc?.body ?? undefined
  previewScroller.value = getIframeScroller() ?? undefined
}

onBeforeUnmount(() => {
  if (boundIframeWin) {
    boundIframeWin.removeEventListener('scroll', onIframeScroll, true)
    boundIframeWin.removeEventListener('wheel', onIframeWheel, WHEEL_LISTENER_OPTIONS)
    boundIframeWin.removeEventListener('keydown', onIframeKeydown)
    boundIframeWin = null
  }
  window.removeEventListener('keydown', onWindowKeydown)
  clearTimeout(askAiTimer)
})

/** 获取当前选中的文本（供 AI 面板引用选中内容） */
const getSelectionText = () => {
  const ta = taRef.value
  if (!ta) return ''
  return ta.value.slice(ta.selectionStart, ta.selectionEnd)
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
})

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
.html-editor {
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

.pane-extra {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  margin-left: auto;
}

.pane-extra .el-button {
  font-size: 12px;
  color: var(--text-color-regular);
}

/* ========== 预览缩放控件 ========== */
.zoom-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
}

.zoom-tools .el-button {
  font-size: 13px;
  color: var(--text-color-secondary);
  padding: 4px 5px;
}

/* 缩放比例：定宽 + 等宽数字，数值变化时不抖动 */
.zoom-tools .zoom-value {
  min-width: 46px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.html-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 16px;
  font-family: var(--md-source-font, 'Consolas', 'JetBrains Mono', 'Courier New', monospace);
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color-primary);
  background: var(--bg-color-container);
  tab-size: 2;
  white-space: pre;
}

.html-textarea::placeholder {
  color: var(--text-color-placeholder);
}

/* 预览区：iframe 占满 */
.preview-pane {
  position: relative;
}

.html-preview-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: #fff;
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
