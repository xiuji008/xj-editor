<template>
  <div class="pdf-viewer">
    <!-- 工具条：页码导航 / 缩放 / 标注模式 / 批注面板 -->
    <div class="pdf-toolbar">
      <el-button-group>
        <el-tooltip content="上一页" placement="bottom">
          <el-button size="small" text :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
            <el-icon><ArrowUp /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="下一页" placement="bottom">
          <el-button size="small" text :disabled="currentPage >= numPages" @click="goToPage(currentPage + 1)">
            <el-icon><ArrowDown /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <div class="page-jump">
        <el-input
          v-model="pageInput"
          size="small"
          class="page-input"
          @keyup.enter="jumpToInputPage"
          @blur="jumpToInputPage"
        />
        <span class="page-total">/ {{ numPages || '-' }}</span>
      </div>

      <el-divider direction="vertical" />

      <el-tooltip content="缩小" placement="bottom">
        <el-button size="small" text :disabled="!numPages" @click="zoomBy(1 / 1.2)">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
      </el-tooltip>
      <span class="scale-text">{{ Math.round(scale * 100) }}%</span>
      <el-tooltip content="放大" placement="bottom">
        <el-button size="small" text :disabled="!numPages" @click="zoomBy(1.2)">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
      </el-tooltip>
      <el-button
        size="small"
        text
        :type="scaleMode === 'fit-width' ? 'primary' : ''"
        :disabled="!numPages"
        @click="setScaleMode('fit-width')"
      >
        适应宽度
      </el-button>
      <el-button
        size="small"
        text
        :type="scaleMode === 'fit-page' ? 'primary' : ''"
        :disabled="!numPages"
        @click="setScaleMode('fit-page')"
      >
        适应整页
      </el-button>

      <el-divider direction="vertical" />

      <el-button
        size="small"
        text
        :type="highlightMode ? 'primary' : ''"
        :disabled="!numPages"
        @click="toggleHighlight"
      >
        <el-icon><EditPen /></el-icon>&nbsp;高亮标注
      </el-button>
      <el-button
        size="small"
        text
        :type="sidebarVisible ? 'primary' : ''"
        @click="sidebarVisible = !sidebarVisible"
      >
        <el-icon><Collection /></el-icon>&nbsp;批注
        <span v-if="annotationCount" class="count-badge">{{ annotationCount }}</span>
      </el-button>

      <span v-if="savedHint" class="saved-hint">已保存</span>
    </div>

    <div class="pdf-main">
      <!-- 文档滚动区：进入视口的页面才会真正渲染 -->
      <div ref="scrollRef" class="pdf-scroll" @scroll="onScroll">
        <div v-if="loading" class="pdf-status">
          <el-icon class="is-loading" :size="28"><Loading /></el-icon>
          <p>正在加载 PDF…</p>
        </div>
        <div v-else-if="error" class="pdf-status is-error">
          <el-icon :size="36" color="#f56c6c"><WarningFilled /></el-icon>
          <p class="error-text">{{ error }}</p>
          <el-button size="small" plain @click="openDocument">重试</el-button>
        </div>
        <div v-else class="pdf-pages" :style="{ height: `${totalHeight}px` }">
          <PdfPage
            v-for="item in layout"
            :key="item.page"
            :doc="doc"
            :page-number="item.page"
            :top="item.top"
            :width="item.width"
            :height="item.height"
            :scale="scale"
            :page-height-pt="item.heightPt"
            :marks="marksByPage[item.page] || []"
            :highlight-mode="highlightMode"
            :active="item.page === currentPage"
            @selection="onSelection"
            @mark-click="onMarkClick"
          />
          <!-- 选中文本后的浮动操作：选色高亮 / 记笔记 / AI 生成笔记 -->
          <div v-if="pending" class="selection-popover" :style="popoverStyle">
            <div class="pop-colors">
              <button
                v-for="c in PDF_MARK_COLOR_PRESETS"
                :key="c.value"
                type="button"
                class="pop-color"
                :class="{ 'is-active': lastColor === c.value }"
                :style="{ background: c.value }"
                :title="`${c.label}高亮`"
                @click="confirmSelection(c.value, 'mark')"
              />
              <el-color-picker
                size="small"
                :model-value="lastColor"
                title="自定义颜色"
                @change="onCustomPick"
              />
            </div>
            <el-divider direction="vertical" />
            <el-button size="small" text @click="pending = null">取消</el-button>
            <el-button size="small" @click="confirmSelection(lastColor, 'note')">
              <el-icon><EditPen /></el-icon>&nbsp;记笔记
            </el-button>
            <el-button size="small" type="primary" @click="confirmSelection(lastColor, 'ai')">
              <el-icon><MagicStick /></el-icon>&nbsp;AI 笔记
            </el-button>
          </div>
        </div>
      </div>

      <PdfNotesPanel
        v-if="sidebarVisible"
        :marks="sidecar.marks"
        :notes="sidecar.notes"
        :current-page="currentPage"
        :sidecar-name="sidecarName"
        :colors="PDF_MARK_COLOR_PRESETS"
        :ai-key="aiKey"
        :ai-text="aiText"
        @jump="goToPage"
        @add-note="addNote"
        @save="saveNote"
        @remove-mark="removeMark"
        @remove-note="removeNote"
        @set-color="setMarkColor"
        @ai="runAiNote"
        @ai-stop="stopAiNote"
        @export="exportMarkdown"
        @reveal="revealSidecar"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  EditPen,
  Collection,
  Loading,
  MagicStick,
  WarningFilled,
} from '@element-plus/icons-vue'
import PdfPage from './PdfPage.vue'
import PdfNotesPanel from './PdfNotesPanel.vue'
import { loadPdfDocument, destroyPdfDocument, type PdfDocumentHandle, type PdfPageSize } from '../../composables/usePdfDocument'
import {
  loadPdfSidecar,
  savePdfSidecar,
  sidecarPathFor,
  createPdfId,
  createEmptySidecar,
  applySourceStat,
  exportPdfAnnotationsMarkdown,
  PDF_MARK_COLOR_PRESETS,
  DEFAULT_MARK_COLOR,
  type PdfMark,
  type PdfNote,
  type PdfScaleMode,
  type PdfSidecar,
} from '../../utils/pdfNotes'
import { streamAiNote } from '../../utils/pdfAi'
import { basename } from '../../utils/fileUtils'

/** 页面之间的间距（CSS 像素） */
const PAGE_GAP = 16
/** 页面区上下留白（CSS 像素） */
const PAGE_PADDING = 16
/** 进度保存防抖时间（毫秒） */
const SAVE_DELAY = 800

const props = defineProps<{
  /** PDF 文件绝对路径 */
  filePath: string
}>()

/** 提供给子页面的滚动容器获取函数（懒渲染观察器需要） */
provide('pdfScrollEl', () => scrollRef.value)

const scrollRef = ref<HTMLElement | null>(null)
/** pdf.js 文档句柄：pdf.js 对象不参与响应式代理，避免 Proxy 破坏内部行为 */
const doc = shallowRef<PdfDocumentHandle | null>(null)
/** 每页原始尺寸（pt） */
const sizes = ref<PdfPageSize[]>([])
/** 是否正在加载 */
const loading = ref(false)
/** 加载错误信息 */
const error = ref('')
/** 缩放模式 */
const scaleMode = ref<PdfScaleMode>('fit-width')
/** 自定义缩放比例（scaleMode 为 custom 时生效） */
const customScale = ref(1)
/** 滚动容器可视宽高 */
const viewportSize = ref({ width: 0, height: 0 })
/** 当前页码（1 起） */
const currentPage = ref(1)
/** 页码输入框 */
const pageInput = ref('1')
/** 是否开启高亮标注模式 */
const highlightMode = ref(false)
/** 批注面板是否显示 */
const sidebarVisible = ref(true)
/** sidecar 数据（进度 / 标记 / 笔记） */
const sidecar = ref<PdfSidecar>(createEmptySidecar(props.filePath))
/** 目录只读等写入失败时只提示一次 */
const writeWarned = ref(false)
/** 最近一次保存的提示（2 秒后消失） */
const savedHint = ref(false)
/** 待确认的选区 */
const pending = ref<{ page: number; rects: number[][]; quote: string; x: number; y: number } | null>(null)
/** 最近使用的高亮颜色（浮动工具条与后续标注默认沿用） */
const lastColor = ref(DEFAULT_MARK_COLOR)
/** 正在生成 AI 笔记的条目 key（空串表示无） */
const aiKey = ref('')
/** AI 流式增量文本（生成过程中展示，完成后写入笔记） */
const aiText = ref('')

/** 防抖定时器 */
let saveTimer: number | null = null
let hintTimer: number | null = null
/** 容器尺寸观察器 */
let resizeObserver: ResizeObserver | null = null
/** 当前 AI 生成会话（同一时刻只允许一个生成任务） */
let aiSession: { stop: () => void } | null = null

/** 总页数 */
const numPages = computed(() => sizes.value.length)

/** 当前缩放比例 */
const scale = computed(() => {
  if (scaleMode.value === 'custom') return customScale.value
  if (!sizes.value.length || !viewportSize.value.width) return 1
  const maxWidth = Math.max(...sizes.value.map((s) => s.w))
  const fitWidth = (viewportSize.value.width - PAGE_PADDING * 2) / maxWidth
  if (scaleMode.value === 'fit-width') return fitWidth
  const fitHeight = (viewportSize.value.height - PAGE_PADDING * 2) / Math.max(sizes.value[0].h, 1)
  return Math.min(fitWidth, fitHeight)
})

/** 页面布局：逐页累加得到每页在滚动容器中的偏移与渲染尺寸 */
const layout = computed(() => {
  const items: Array<{ page: number; top: number; width: number; height: number; heightPt: number }> = []
  let top = PAGE_PADDING
  for (let i = 0; i < sizes.value.length; i++) {
    const size = sizes.value[i]
    const height = size.h * scale.value
    items.push({
      page: i + 1,
      top,
      width: size.w * scale.value,
      height,
      heightPt: size.h,
    })
    top += height + PAGE_GAP
  }
  return items
})

/** 滚动区总高度 */
const totalHeight = computed(() => {
  const items = layout.value
  if (!items.length) return 0
  const last = items[items.length - 1]
  return last.top + last.height + PAGE_PADDING
})

/** 按页码分组的高亮标记 */
const marksByPage = computed(() => {
  const map: Record<number, PdfMark[]> = {}
  for (const mark of sidecar.value.marks) {
    if (!map[mark.page]) map[mark.page] = []
    map[mark.page].push(mark)
  }
  return map
})

/** 标记 + 笔记总数（工具条角标） */
const annotationCount = computed(() => sidecar.value.marks.length + sidecar.value.notes.length)

/** sidecar 文件名（悬浮提示） */
const sidecarName = computed(() => basename(sidecarPathFor(props.filePath)))

/** 浮动操作按钮定位：页面在本容器内水平居中，故用 50% + 页内偏移 */
const popoverStyle = computed(() => {
  const data = pending.value
  if (!data) return {}
  const item = layout.value.find((i) => i.page === data.page)
  if (!item) return {}
  return {
    left: `calc(50% + ${Math.round(data.x - item.width / 2)}px)`,
    top: `${Math.round(item.top + data.y + 6)}px`,
  }
})

/**
 * 打开 PDF：先读取 sidecar（进度 / 批注），再加载文档并恢复上次阅读位置。
 */
async function openDocument() {
  if (!props.filePath) return
  await flushSave()
  await destroyPdfDocument(doc.value)
  doc.value = null
  sizes.value = []
  currentPage.value = 1
  pageInput.value = '1'
  error.value = ''
  loading.value = true
  pending.value = null
  // 切换文档时中断未完成的 AI 生成，避免结果写到另一篇文档的笔记上
  stopAiNote()
  resetAiNote()
  try {
    // 记录源文件大小 / 修改时间，便于文档被替换后识别批注是否仍然匹配
    const stat = await window.mdAPI?.statPath(props.filePath)
    sidecar.value = await loadPdfSidecar(props.filePath)
    applySourceStat(sidecar.value, { size: stat?.size || 0, mtime: stat?.mtime || 0 })

    const result = await loadPdfDocument(props.filePath)
    doc.value = markRaw(result.doc) as PdfDocumentHandle
    sizes.value = result.sizes

    const progress = sidecar.value.progress
    scaleMode.value = progress?.scaleMode || 'fit-width'
    customScale.value = progress?.scale || 1
    await nextTick()
    measureViewport()
    // 等待布局与页面组件挂载后再定位，否则滚动高度尚未生效
    await nextTick()
    if (progress) {
      goToPage(progress.page, progress.offset)
    }
  } catch (err: any) {
    error.value = err?.message || 'PDF 打开失败'
  } finally {
    loading.value = false
  }
}

/** 测量滚动容器可视尺寸（fit-width / fit-page 依赖） */
function measureViewport() {
  const el = scrollRef.value
  if (!el) return
  viewportSize.value = { width: el.clientWidth, height: el.clientHeight }
}

/**
 * 滚动事件：更新当前页码并延迟保存阅读进度。
 */
function onScroll() {
  const el = scrollRef.value
  if (!el || !layout.value.length) return
  // 以视口上方 25% 处所在页作为当前页，符合从上往下阅读的直觉
  const probe = el.scrollTop + el.clientHeight * 0.25
  let page = 1
  for (const item of layout.value) {
    if (item.top <= probe) page = item.page
    else break
  }
  if (page !== currentPage.value) {
    currentPage.value = page
    pageInput.value = String(page)
  }
  scheduleSave()
}

/**
 * 跳转到指定页。
 * @param page 目标页码（1 起）
 * @param offset 页内偏移（CSS 像素），缺省定位到页顶
 */
function goToPage(page: number, offset = 0) {
  const el = scrollRef.value
  const item = layout.value.find((i) => i.page === page)
  if (!el || !item) return
  el.scrollTop = Math.max(0, item.top + offset - 4)
  currentPage.value = page
  pageInput.value = String(page)
  scheduleSave()
}

/** 从页码输入框跳转 */
function jumpToInputPage() {
  const page = Number.parseInt(pageInput.value, 10)
  if (!Number.isFinite(page)) {
    pageInput.value = String(currentPage.value)
    return
  }
  goToPage(Math.min(Math.max(page, 1), numPages.value))
}

/** 缩放按钮：以当前比例为基准，切换到自定义模式 */
function zoomBy(factor: number) {
  const next = Math.min(Math.max(scale.value * factor, 0.25), 5)
  customScale.value = next
  scaleMode.value = 'custom'
  // 缩放后保持当前页顶部位置，避免跳页
  nextTick(() => goToPage(currentPage.value))
}

/** 切换缩放模式 */
function setScaleMode(mode: PdfScaleMode) {
  scaleMode.value = mode
  nextTick(() => goToPage(currentPage.value))
}

/** 切换高亮标注模式：关闭时清空未确认选区 */
function toggleHighlight() {
  highlightMode.value = !highlightMode.value
  if (!highlightMode.value) pending.value = null
}

/** 页面文本选区回调：暂存待确认选区 */
function onSelection(payload: { page: number; rects: number[][]; quote: string; x: number; y: number }) {
  pending.value = payload
}

/**
 * 确认选区：按指定颜色生成高亮标记，并按需要创建笔记。
 * @param color 高亮颜色
 * @param mode 后续动作：mark 仅高亮 / note 高亮并新建笔记 / ai 高亮并由 AI 生成笔记
 */
function confirmSelection(color: string, mode: 'mark' | 'note' | 'ai') {
  const data = pending.value
  pending.value = null
  if (!data) return
  lastColor.value = color
  const mark: PdfMark = {
    id: createPdfId('m'),
    page: data.page,
    color,
    rects: data.rects,
    quote: data.quote,
    createdAt: new Date().toISOString(),
  }
  sidecar.value.marks.push(mark)
  if (mode === 'note') {
    addNote(mark.page, mark.id)
  } else if (mode === 'ai') {
    const note = addNote(mark.page, mark.id)
    void runAiNote({ key: `m-${mark.id}`, page: mark.page, quote: mark.quote, markId: mark.id, noteId: note.id })
  } else {
    scheduleSave()
  }
  window.getSelection()?.removeAllRanges()
}

/** 浮动工具条自定义取色：记色后立即按该色高亮 */
function onCustomPick(value: string | null) {
  if (!value) return
  lastColor.value = value
  confirmSelection(value, 'mark')
}

/** 修改已有高亮的颜色 */
function setMarkColor(id: string, color: string) {
  const mark = sidecar.value.marks.find((m) => m.id === id)
  if (!mark) return
  mark.color = color
  lastColor.value = color
  scheduleSave()
}

/** 点击已有高亮：定位到该标记对应的笔记 */
function onMarkClick(mark: PdfMark) {
  const note = sidecar.value.notes.find((n) => n.markId === mark.id)
  if (note) {
    sidebarVisible.value = true
    return
  }
  addNote(mark.page, mark.id)
}

/**
 * 新增笔记。
 * @param page 页码
 * @param markId 关联的高亮标记 id，可为空
 * @returns 新建的笔记对象（供 AI 生成流程直接使用）
 */
function addNote(page: number, markId?: string): PdfNote {
  const now = new Date().toISOString()
  const note: PdfNote = {
    id: createPdfId('n'),
    page,
    markId,
    text: '',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  }
  sidecar.value.notes.push(note)
  sidebarVisible.value = true
  scheduleSave()
  return note
}

/** 保存笔记正文编辑结果 */
function saveNote(note: PdfNote, text: string) {
  const target = sidecar.value.notes.find((n) => n.id === note.id)
  if (!target) return
  target.text = text
  target.source = target.source || 'manual'
  target.updatedAt = new Date().toISOString()
  scheduleSave()
}

/**
 * AI 生成 / 完善笔记：流式写入，完成后一次性落到笔记正文并保存。
 * @param payload 生成上下文（原文、已有笔记、所在页与条目）
 */
async function runAiNote(payload: {
  key: string
  page: number
  quote: string
  markId?: string
  noteId?: string
  existing?: string
}) {
  stopAiNote()
  // 没有现成笔记时先补一条空笔记，AI 结果直接落到它上面
  let note = payload.noteId ? sidecar.value.notes.find((n) => n.id === payload.noteId) : undefined
  if (!note) note = addNote(payload.page, payload.markId)

  aiKey.value = payload.key
  aiText.value = ''
  const res = await streamAiNote({
    quote: payload.quote,
    existing: payload.existing || note.text,
    onDelta: (delta) => {
      aiText.value += delta
    },
    onDone: (content, stopped) => {
      const target = sidecar.value.notes.find((n) => n.id === note!.id)
      if (target) {
        // 中断时可能还有未通过最后一个回调返回的片段，取较长的一份避免丢字
        const streamed = aiText.value.trim()
        const finalText = stopped && streamed.length > content.length ? streamed : content
        target.text = finalText
        target.source = 'ai'
        target.updatedAt = new Date().toISOString()
      }
      resetAiNote()
      scheduleSave()
    },
    onError: (msg) => {
      ElMessage.error(msg)
      resetAiNote()
    },
  })
  if (!res.ok) {
    ElMessage.warning(res.error || 'AI 生成失败，请检查 AI 配置')
    resetAiNote()
    return
  }
  aiSession = { stop: res.stop ?? (() => {}) }
}

/** 中断 AI 生成（已生成片段不丢失，由 onDone 写入笔记） */
function stopAiNote() {
  aiSession?.stop()
  aiSession = null
}

/** 清理 AI 生成状态 */
function resetAiNote() {
  aiSession = null
  aiKey.value = ''
  aiText.value = ''
}

/** 删除高亮标记，同时删除挂在其上的笔记 */
function removeMark(id: string) {
  sidecar.value.marks = sidecar.value.marks.filter((m) => m.id !== id)
  sidecar.value.notes = sidecar.value.notes.filter((n) => n.markId !== id)
  scheduleSave()
}

/** 删除笔记 */
function removeNote(id: string) {
  sidecar.value.notes = sidecar.value.notes.filter((n) => n.id !== id)
  scheduleSave()
}

/** 导出批注为 Markdown */
async function exportMarkdown() {
  const content = exportPdfAnnotationsMarkdown(sidecar.value, props.filePath)
  const defaultPath = props.filePath.replace(/\.pdf$/i, '') + '-批注.md'
  const res = await window.mdAPI?.saveAs({
    content,
    defaultPath,
    filters: [{ name: 'Markdown 文件', extensions: ['md'] }],
  })
  if (res?.filePath) ElMessage.success('批注已导出')
}

/** 在文件夹中显示 sidecar 文件 */
function revealSidecar() {
  window.mdAPI?.revealFile(sidecarPathFor(props.filePath))
}

/** 当前页内滚动偏移 */
function currentOffset(): number {
  const el = scrollRef.value
  const item = layout.value.find((i) => i.page === currentPage.value)
  if (!el || !item) return 0
  return Math.max(0, el.scrollTop - item.top)
}

/** 防抖保存 */
function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void persist()
  }, SAVE_DELAY)
}

/** 立即保存（切换文件 / 关闭组件时调用） */
async function flushSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  await persist()
}

/** 写入 sidecar：进度 + 标记 + 笔记 */
async function persist() {
  if (!props.filePath || !numPages.value) return
  sidecar.value.progress = {
    page: currentPage.value,
    offset: currentOffset(),
    scale: scale.value,
    scaleMode: scaleMode.value,
    updatedAt: new Date().toISOString(),
  }
  const ok = await savePdfSidecar(props.filePath, sidecar.value)
  if (!ok) {
    if (!writeWarned.value) {
      writeWarned.value = true
      ElMessage.warning('批注无法写入文件（目录可能只读），本次仅保存在当前会话')
    }
    return
  }
  savedHint.value = true
  if (hintTimer) window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => {
    savedHint.value = false
    hintTimer = null
  }, 1600)
}

onMounted(() => {
  void openDocument()
  nextTick(() => {
    const el = scrollRef.value
    if (!el) return
    measureViewport()
    resizeObserver = new ResizeObserver(() => measureViewport())
    resizeObserver.observe(el)
  })
})

onBeforeUnmount(async () => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (hintTimer) window.clearTimeout(hintTimer)
  stopAiNote()
  await flushSave()
  await destroyPdfDocument(doc.value)
  doc.value = null
})

// 切换文件时重新加载（先保存旧文件进度由 openDocument 内部处理）
watch(() => props.filePath, () => void openDocument())
</script>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-color-white, #fff);
}

.pdf-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
  background: var(--bg-color-white, #fff);
}

.page-jump {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-input {
  width: 52px;
}

.page-input :deep(.el-input__inner) {
  text-align: center;
}

.page-total,
.scale-text {
  font-size: 12px;
  color: var(--text-color-regular, #606266);
  white-space: nowrap;
}

.scale-text {
  min-width: 42px;
  text-align: center;
}

.count-badge {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--el-color-primary, #409eff);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.saved-hint {
  margin-left: auto;
  font-size: 12px;
  color: #67c23a;
}

.pdf-main {
  flex: 1;
  display: flex;
  min-height: 0;
}

.pdf-scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #f0f2f5;
}

.pdf-pages {
  position: relative;
  width: 100%;
}

.pdf-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: #909399;
  font-size: 13px;
}

.pdf-status p {
  margin: 0;
}

.pdf-status.is-error .error-text {
  color: #f56c6c;
}

.selection-popover {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  background: var(--bg-color-white, #fff);
  box-shadow: 0 4px 12px rgb(0 0 0 / 16%);
}

.pop-colors {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pop-color {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s;
}

.pop-color:hover {
  transform: scale(1.12);
}

.pop-color.is-active {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 1px;
}
</style>
