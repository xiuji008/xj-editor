<template>
  <div
    ref="rootEl"
    class="pdf-page"
    :class="{ 'is-active': active }"
    :style="rootStyle"
    :data-page="pageNumber"
    @click="onPageClick"
  >
    <canvas ref="canvasEl" class="pdf-page-canvas" />

    <!-- 高亮标记层：canvas 之上、文本层之下，半透明覆盖，点击穿透由容器命中检测处理 -->
    <div class="pdf-mark-layer">
      <div
        v-for="box in markBoxes"
        :key="box.key"
        class="pdf-mark-box"
        :style="box.style"
      />
    </div>

    <!-- 文本层：pdf.js TextLayer 渲染，提供可选中文本（高亮标注依赖它取选区） -->
    <div ref="textEl" class="pdf-text-layer" :style="textLayerStyle" />

    <div v-if="!rendered" class="pdf-page-placeholder">
      <span>第 {{ pageNumber }} 页</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { TextLayer } from 'pdfjs-dist'
import type { PdfMark } from '../../utils/pdfNotes'

/** 页面渲染所需的 PDF 文档句柄（只用到 getPage，故按需声明避免依赖内部类型） */
interface PdfDocLike {
  getPage: (pageNumber: number) => Promise<any>
}

const props = defineProps<{
  /** PDF 文档句柄 */
  doc: PdfDocLike | null
  /** 页码（1 起） */
  pageNumber: number
  /** 页面距滚动容器顶部的偏移（CSS 像素） */
  top: number
  /** 页面渲染宽度（CSS 像素） */
  width: number
  /** 页面渲染高度（CSS 像素） */
  height: number
  /** 当前缩放比例（1 = 100%） */
  scale: number
  /** 页面原始高度（PDF 单位 pt，用于高亮坐标换算） */
  pageHeightPt: number
  /** 本页的高亮标记 */
  marks: PdfMark[]
  /** 是否处于高亮标注模式（开启后选中文本即提示添加批注） */
  highlightMode: boolean
  /** 是否为当前阅读页（用于样式高亮） */
  active: boolean
}>()

const emit = defineEmits<{
  /** 选中文本后请求添加高亮：携带 PDF 坐标矩形与原文 */
  (e: 'selection', payload: { page: number; rects: number[][]; quote: string; x: number; y: number }): void
  /** 点击已有高亮标记 */
  (e: 'mark-click', mark: PdfMark): void
}>()

/** 滚动容器获取函数（由 PdfViewer 提供，用于懒渲染的 IntersectionObserver root） */
const getScrollEl = inject<() => HTMLElement | null>('pdfScrollEl', () => null)

const rootEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const textEl = ref<HTMLElement | null>(null)

/** 是否已完成渲染（含文本层） */
const rendered = ref(false)
/** 是否正在渲染（避免重复触发） */
let rendering = false
/** 当前渲染任务（缩放切换时需要取消） */
let renderTask: { promise: Promise<void>; cancel: () => void } | null = null
/** 文本层实例 */
let textLayer: TextLayer | null = null
/** 懒渲染观察器 */
let observer: IntersectionObserver | null = null
/** 是否已进入过视口（进入过一次后保持渲染结果） */
let inViewport = false

/** 页面定位样式：由父级统一计算布局，absolute 定位 */
const rootStyle = computed(() => ({
  top: `${Math.round(props.top)}px`,
  width: `${Math.round(props.width)}px`,
  height: `${Math.round(props.height)}px`,
}))

/** 文本层需要的缩放变量（pdf.js 的 TextLayer 样式依赖它计算字号） */
const textLayerStyle = computed(() => ({
  '--total-scale-factor': String(props.scale),
  '--scale-factor': String(props.scale),
}))

/**
 * 将 PDF 坐标矩形换算为 CSS 定位样式。
 * PDF 坐标系原点在左下角、y 轴向上，CSS 原点在左上角、y 轴向下。
 */
const markBoxes = computed(() => {
  const boxes: Array<{ key: string; style: Record<string, string>; mark: PdfMark }> = []
  const scale = props.scale
  for (const mark of props.marks) {
    for (let i = 0; i < mark.rects.length; i++) {
      const [x, y, w, h] = mark.rects[i]
      boxes.push({
        key: `${mark.id}-${i}`,
        mark,
        style: {
          left: `${x * scale}px`,
          top: `${(props.pageHeightPt - y - h) * scale}px`,
          width: `${w * scale}px`,
          height: `${h * scale}px`,
          background: mark.color,
        },
      })
    }
  }
  return boxes
})

/**
 * 渲染页面：canvas 渲染 + 文本层渲染。
 * 文本层同时用于文本选择与高亮定位，因此与 canvas 一起渲染。
 */
async function renderPage() {
  if (!props.doc || !canvasEl.value || rendering) return
  rendering = true
  try {
    renderTask?.cancel()
    renderTask = null
    textLayer?.cancel()
    textLayer = null
    if (textEl.value) textEl.value.textContent = ''

    const page = await props.doc.getPage(props.pageNumber)
    const viewport = page.getViewport({ scale: props.scale })
    const canvas = canvasEl.value
    // CSS 尺寸必须等于 viewport 尺寸，否则文本层与画布错位
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)

    const task = page.render({ canvas, viewport })
    renderTask = task
    await task.promise
    renderTask = null

    const textContent = await page.getTextContent()
    textLayer = new TextLayer({
      textContentSource: textContent,
      container: textEl.value as HTMLElement,
      viewport,
    })
    await textLayer.render()
    // 渲染期间用户可能已切走，这里仅在组件仍存活时标记完成
    rendered.value = true
  } catch (err: any) {
    // 主动取消（缩放切换）不视为错误，保持占位状态等待下次渲染
    if (err?.name !== 'RenderingCancelledException') {
      console.warn('[PdfPage] 渲染失败', err)
      rendered.value = false
    }
  } finally {
    rendering = false
  }
}

/** 清除渲染结果并重新渲染（缩放变化时使用） */
function resetAndRender() {
  rendered.value = false
  if (inViewport) void renderPage()
}

/** 文本选区 → PDF 坐标矩形（仅处理同一页内的选区） */
function captureSelection(): { rects: number[][]; quote: string; x: number; y: number } | null {
  const layer = textEl.value
  const root = rootEl.value
  if (!layer || !root) return null
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  // 跨页选区不处理：起点与终点必须都在本页文本层内
  if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return null
  const rootRect = root.getBoundingClientRect()
  const quote = sel.toString().trim()
  if (!quote) return null
  const scale = props.scale
  const rects: number[][] = []
  let maxX = 0
  let maxY = 0
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue
    const topInPage = r.top - rootRect.top
    rects.push([
      Number(((r.left - rootRect.left) / scale).toFixed(2)),
      Number((props.pageHeightPt - (topInPage + r.height) / scale).toFixed(2)),
      Number((r.width / scale).toFixed(2)),
      Number((r.height / scale).toFixed(2)),
    ])
    maxX = Math.max(maxX, r.right - rootRect.left)
    maxY = Math.max(maxY, r.bottom - rootRect.top)
  }
  if (!rects.length) return null
  return { rects, quote, x: maxX, y: maxY }
}

/** 页面鼠标释放：在高亮模式下把选区抛给父组件 */
function onMouseUp() {
  if (!props.highlightMode) return
  // 延后一帧，确保浏览器已更新选区
  window.setTimeout(() => {
    const payload = captureSelection()
    if (payload) emit('selection', { page: props.pageNumber, ...payload })
  }, 0)
}

/** 点击命中检测：点击落在高亮矩形内时通知父组件 */
function onPageClick(event: MouseEvent) {
  if (!props.marks.length || !rootEl.value) return
  const rootRect = rootEl.value.getBoundingClientRect()
  const px = event.clientX - rootRect.left
  const py = event.clientY - rootRect.top
  const scale = props.scale
  for (const mark of props.marks) {
    for (const [x, y, w, h] of mark.rects) {
      const left = x * scale
      const top = (props.pageHeightPt - y - h) * scale
      if (px >= left && px <= left + w * scale && py >= top && py <= top + h * scale) {
        emit('mark-click', mark)
        return
      }
    }
  }
}

onMounted(() => {
  void nextTick(() => {
    const container = getScrollEl()
    if (container && rootEl.value) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              inViewport = true
              void renderPage()
            } else {
              inViewport = false
            }
          }
        },
        { root: container, rootMargin: '700px 0px' },
      )
      observer.observe(rootEl.value)
    }
    rootEl.value?.addEventListener('mouseup', onMouseUp)
  })
})

onBeforeUnmount(() => {
  rootEl.value?.removeEventListener('mouseup', onMouseUp)
  observer?.disconnect()
  observer = null
  renderTask?.cancel()
  renderTask = null
  textLayer?.cancel()
  textLayer = null
})

// 缩放变化：清掉旧渲染结果，视口内的页面重新渲染
watch(() => props.scale, resetAndRender)
// 文档切换（打开另一个 PDF）：强制重新渲染
watch(() => props.doc, resetAndRender)
</script>

<style scoped>
.pdf-page {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  box-shadow: 0 1px 6px rgb(0 0 0 / 18%);
  overflow: hidden;
}

.pdf-page-canvas {
  display: block;
}

.pdf-mark-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pdf-mark-box {
  position: absolute;
  opacity: 0.42;
  mix-blend-mode: multiply;
  border-radius: 2px;
}

/* pdf.js TextLayer 所需样式：文本透明铺在画布上，用于选择与定位 */
.pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  opacity: 1;
  transform-origin: 0 0;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.pdf-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  -webkit-user-select: text;
  -moz-user-select: text;
  user-select: text;
}

.pdf-text-layer > :not(.markedContent),
.pdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.pdf-text-layer .markedContent {
  display: contents;
}

.pdf-page-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 13px;
}
</style>
