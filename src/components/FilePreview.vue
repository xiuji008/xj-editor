<template>
  <div ref="rootRef" class="file-preview">
    <!-- 通用操作条：独立顶部工具条（不悬浮覆盖，避免遮挡预览器自带的工具栏 / 搜索框） -->
    <div
      v-if="fileKind === 'image' || fileKind === 'pdf' || fileKind === 'office' || fileKind === 'archive'"
      class="file-actions"
    >
      <el-button
        v-if="fileKind === 'pdf' || fileKind === 'office'"
        size="small"
        text
        :loading="converting"
        @click="convertToMarkdown"
      >
        <el-icon><Download /></el-icon>&nbsp;转为 Markdown
      </el-button>
      <el-button size="small" text @click="revealInFolder">
        <el-icon><FolderOpened /></el-icon>&nbsp;在文件夹中显示
      </el-button>
      <el-button size="small" text @click="openWithDefault">
        <el-icon><Pointer /></el-icon>&nbsp;用默认程序打开
      </el-button>
    </div>

    <!-- 预览主体 -->
    <div class="preview-body">
      <!-- 图片预览 -->
      <ImagePreview v-if="fileKind === 'image'" :file-url="fileUrl" :file-format="ext" />

      <!-- PDF 由 pdf.js 渲染：支持阅读进度保存、高亮标注与笔记 -->
      <PdfViewer v-else-if="fileKind === 'pdf'" :file-path="filePath" />

      <!-- Office / 压缩包预览（均由 open-file-viewer 渲染） -->
      <div
        v-else-if="isViewerKind"
        ref="viewerRef"
        class="viewer-preview"
        :class="{ 'office-fit': fileKind === 'office' }"
        :style="{ '--ofv-fit-zoom': fitZoom }"
        v-loading="loading"
      >
        <OpenFileViewer
          v-if="fileSource && !loadError"
          :key="fileKind"
          :file="fileSource"
          :file-name="fileName"
          width="100%"
          height="100%"
          fit="width"
          toolbar
          theme="light"
          locale="zh-CN"
          :plugins="plugins"
        />
        <div v-if="loadError" class="preview-error">
          <el-icon :size="48" color="#f56c6c"><WarningFilled /></el-icon>
          <p class="error-text">文件预览失败</p>
          <p class="error-hint">{{ loadError }}</p>
          <el-button type="primary" plain size="small" @click="loadFile">重试</el-button>
        </div>
      </div>

      <!-- 无法预览的类型 -->
      <div v-else class="unsupported">
        <el-icon :size="64" color="#909399"><QuestionFilled /></el-icon>
        <h3>暂不支持预览该文件类型</h3>
        <p class="unsupported-name">{{ fileName }}</p>
        <el-button-group>
          <el-button type="primary" @click="openWithDefault">
            <el-icon><Pointer /></el-icon>&nbsp;用默认程序打开
          </el-button>
          <el-button @click="revealInFolder">
            <el-icon><FolderOpened /></el-icon>&nbsp;在文件夹中显示
          </el-button>
        </el-button-group>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { OpenFileViewer } from '@open-file-viewer/vue'
import { archivePlugin, officePlugin } from '@open-file-viewer/core'
import '@open-file-viewer/core/style.css'
import { WarningFilled, QuestionFilled, FolderOpened, Pointer, Download } from '@element-plus/icons-vue'
import ImagePreview from './ImagePreview.vue'
// pdf.js 体积较大（含 worker 源码），按需加载，避免拖慢 Markdown 编辑场景的首屏
const PdfViewer = defineAsyncComponent(() => import('./pdf/PdfViewer.vue'))
import { basename, extname, toMdLocalUrl, type FileKind } from '../utils/fileUtils'
import { getImageHostingConfig } from '../utils/imageHosting'

const props = defineProps<{
  /** 文件绝对路径 */
  filePath: string
  /** 文件类型 */
  fileKind: FileKind
}>()

const emit = defineEmits<{
  /** 文档已成功转换为 Markdown，参数为转换出的 .md 路径 */
  (e: 'converted', targetPath?: string): void
}>()

const loading = ref(false)
const loadError = ref('')
const fileSource = ref<File | string | null>(null)

const viewerRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
/** 旧版 Word（.doc）渲染页面的基础宽度（px，A4 宽度） */
const WORD_PAGE_WIDTH = 794
/** 页面最大视觉宽度：超宽窗口下避免页面过大，保持居中阅读 */
const WORD_PAGE_MAX_WIDTH = 1080
/** 旧版 Word 页面适配容器宽度的缩放比例（zoom） */
const fitZoom = ref(1)
let fitObserver: ResizeObserver | null = null

/** 根据容器宽度计算 Word 页面缩放比例，使页面尽量占满容器（上限 1080px） */
function updateWordFitZoom(width: number) {
  if (!width) return
  const target = Math.min(Math.max(width, 320), WORD_PAGE_MAX_WIDTH)
  fitZoom.value = Number((target / WORD_PAGE_WIDTH).toFixed(3))
}

/** 由 open-file-viewer 渲染的类型：Office 文档与压缩包 */
const isViewerKind = computed(() => props.fileKind === 'office' || props.fileKind === 'archive')

/**
 * 预览插件：按文件类型装配，避免为单个文件加载无关插件。
 * Office → officePlugin（不支持 PDF）；压缩包 → archivePlugin。
 */
const plugins = computed(() =>
  props.fileKind === 'archive' ? [archivePlugin()] : [officePlugin()],
)

const fileName = computed(() => basename(props.filePath))
const ext = computed(() => extname(props.filePath).replace(/^\./, '').toLowerCase())
/** 通过 mdlocal:// 协议访问本地文件 */
const fileUrl = computed(() => toMdLocalUrl(props.filePath))

/**
 * 加载 Office / 压缩包文件（PDF 由 <iframe> 原生渲染，无需 fetch）。
 * 先 fetch 探测文件是否可读，再把文件路径交给预览器自行读取。
 */
const loadFile = async () => {
  if (!props.filePath) {
    loadError.value = '文件路径为空'
    return
  }

  loading.value = true
  loadError.value = ''
  fileSource.value = null

  try {
    const response = await fetch(fileUrl.value)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    await response.blob()
    // 使用 mdlocal URL 作为预览源，open-file-viewer 支持字符串 URL
    fileSource.value = fileUrl.value
  } catch (err: any) {
    loadError.value = err?.message || '无法加载文件'
  } finally {
    loading.value = false
  }
}

/** 在文件夹中显示 */
const revealInFolder = () => {
  window.mdAPI?.revealFile(props.filePath)
}

/** 用系统默认程序打开 */
const openWithDefault = async () => {
  const res = await window.mdAPI?.openWithDefault(props.filePath)
  if (res && res.error) {
    ElMessage.error(`打开失败：${res.error}`)
  }
}

/** 一键转换为 Markdown：主进程本地转换，按图片配置处理嵌入图片，成功后通知外层打开转换结果 */
const converting = ref(false)
const convertToMarkdown = async () => {
  if (converting.value) return
  converting.value = true
  try {
    const res = await window.mdAPI?.convertToMarkdown(props.filePath, getImageHostingConfig())
    if (!res?.ok) {
      ElMessage.error(`转换失败：${res?.error || '未知错误'}`)
      return
    }
    const assets = res.exportedAssets || []
    const uploaded = assets.filter((a) => a.uploaded).length
    const hint = uploaded
      ? `（已上传 ${uploaded} 张图片到图床）`
      : assets.length
        ? `（并导出 ${assets.length} 个嵌入图片/资源）`
        : ''
    ElMessage.success(`已转换为 ${basename(res.targetPath || props.filePath)}${hint}`)
    if (res.warnings?.length) {
      ElMessage.warning(res.warnings[0])
    }
    emit('converted', res.targetPath)
  } finally {
    converting.value = false
  }
}

watch(
  () => props.filePath,
  () => {
    if (isViewerKind.value) loadFile()
  },
  { immediate: true },
)

/* ========== 内置搜索框增强：添加上/下箭头，循环切换搜索匹配 ========== */

/** 当前定位到的匹配序号（-1 表示未定位） */
let searchIndex = -1
let toolbarObserver: MutationObserver | null = null

/** 收集预览 DOM（含 iframe 内部）中的所有搜索高亮节点 */
function collectSearchMatches(): HTMLElement[] {
  const root = viewerRef.value
  if (!root) return []
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.ofv-search-match'))
  for (const iframe of root.querySelectorAll('iframe')) {
    try {
      const body = (iframe as HTMLIFrameElement).contentDocument?.body
      if (body) marks.push(...Array.from(body.querySelectorAll<HTMLElement>('mark.ofv-search-match')))
    } catch {
      /* 跨域 iframe 忽略 */
    }
  }
  return marks
}

/** 跳转并高亮第 idx 个匹配（越界循环），同步计数显示为 current/total */
function goToSearchMatch(idx: number) {
  const matches = collectSearchMatches()
  if (!matches.length) {
    searchIndex = -1
    return
  }
  if (idx < 0) idx = matches.length - 1
  else if (idx >= matches.length) idx = 0
  matches.forEach((m, i) => m.classList.toggle('is-active', i === idx))
  matches[idx].scrollIntoView({ block: 'center', inline: 'nearest' })
  searchIndex = idx
  const countEl = viewerRef.value?.querySelector<HTMLElement>('.ofv-toolbar-search-count')
  if (countEl) countEl.textContent = `${idx + 1}/${matches.length}`
}

/** 向内置搜索框注入上/下箭头按钮（每个搜索框只注入一次） */
function ensureSearchNav() {
  const root = viewerRef.value
  if (!root) return
  const group = root.querySelector<HTMLElement>('.ofv-toolbar-search')
  if (!group || group.querySelector('.ofv-search-nav')) return
  const input = group.querySelector<HTMLInputElement>('input')
  const count = group.querySelector<HTMLElement>('.ofv-toolbar-search-count')
  if (!input || !count) return

  const mkNavButton = (dir: -1 | 1) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ofv-search-nav'
    btn.title = dir === -1 ? '上一个 (Shift+Enter)' : '下一个 (Enter)'
    btn.setAttribute('aria-label', btn.title)
    btn.innerHTML =
      dir === -1
        ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.8 9.8 8 5.6l4.2 4.2"/></svg>'
        : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.8 6.2 8 10.4l4.2-4.2"/></svg>'
    btn.addEventListener('click', () => goToSearchMatch(searchIndex + dir))
    return btn
  }
  const up = mkNavButton(-1)
  const down = mkNavButton(1)
  input.after(down)
  input.after(up)

  // 内置 input 监听先执行（生成高亮并滚到第一个），这里随后重置序号、格式化计数
  input.addEventListener('input', () => {
    searchIndex = input.value.trim() ? 0 : -1
    const matches = collectSearchMatches()
    matches.forEach((m, i) => m.classList.toggle('is-active', searchIndex === 0 && i === 0))
    count.textContent = matches.length ? `1/${matches.length}` : ''
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      goToSearchMatch(searchIndex + (e.shiftKey ? -1 : 1))
    }
  })
}

function startToolbarObserver() {
  const root = rootRef.value
  if (!root || toolbarObserver) return
  // 工具栏由 open-file-viewer 在挂载/重建时渲染，用 MutationObserver 捕捉搜索框出现
  toolbarObserver = new MutationObserver(() => ensureSearchNav())
  toolbarObserver.observe(root, { childList: true, subtree: true })
  ensureSearchNav()
}

// 组件复用时 fileKind 可能后变为 office/archive（此时 onMounted 已过），需补启动观察器
watch(isViewerKind, (v) => {
  if (v) startToolbarObserver()
})

onMounted(() => {
  const el = viewerRef.value
  if (!el) return
  // 初始立即计算一次，避免页面首次渲染为原始 A4 大小
  updateWordFitZoom(el.clientWidth)
  fitObserver = new ResizeObserver((entries) => {
    updateWordFitZoom(entries[0]?.contentRect.width || 0)
  })
  fitObserver.observe(el)
  if (isViewerKind.value) startToolbarObserver()
})

onUnmounted(() => {
  fitObserver?.disconnect()
  fitObserver = null
  toolbarObserver?.disconnect()
  toolbarObserver = null
  fileSource.value = null
})
</script>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-color-page, #f5f7fa);
}

/* 操作条：独立占位（不再悬浮覆盖），避免遮挡预览器自带的工具栏 / 搜索框 */
.file-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-color-white, #fff);
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

/* 预览主体：占满剩余空间，子元素统一填满 */
.preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-body > * {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.viewer-preview {
  width: 100%;
  overflow: hidden;
}

.preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 40px;
}

.error-text {
  font-size: 16px;
  font-weight: 600;
  color: #f56c6c;
  margin: 0;
}

.error-hint {
  font-size: 13px;
  color: #909399;
  margin: 0;
}

/* 修复 Word/Office 文档缩放后内容被横向裁剪的问题 */
.viewer-preview :deep(.ofv-viewport) {
  overflow-x: auto;
}

/* Word 预览：限制页面最大视觉宽度，超宽窗口下页面居中、不再显得过小 */
.viewer-preview.office-fit :deep(.ofv-root) {
  max-width: 1080px;
  margin: 0 auto;
}

/* 旧版 Word（.doc）页面按容器宽度自适应缩放（zoom 由 JS 计算） */
:deep(.ofv-msdoc-document) {
  align-items: safe center;
  min-width: 0;
}

:deep(.ofv-msdoc-page) {
  zoom: var(--ofv-fit-zoom, 1);
}

/* 内置搜索框注入的上/下切换按钮 */
.viewer-preview :deep(.ofv-search-nav) {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  margin-left: 4px;
  padding: 0;
  border: 1px solid var(--ofv-border, var(--border-color-light, #dcdfe6));
  border-radius: 4px;
  background: transparent;
  color: var(--ofv-text-muted, var(--text-color-secondary, #909399));
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

.viewer-preview :deep(.ofv-search-nav:hover) {
  color: var(--ofv-accent, var(--color-primary, #409eff));
  border-color: var(--ofv-accent, var(--color-primary, #409eff));
}

.viewer-preview :deep(.ofv-search-nav svg) {
  display: block;
  width: 12px;
  height: 12px;
}

/* 当前定位到的搜索匹配高亮 */
.viewer-preview :deep(mark.ofv-search-match.is-active) {
  background: #ff9632;
  color: #fff;
}

.unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  padding: 40px;
  color: #909399;
}

.unsupported h3 {
  margin: 0;
  color: var(--text-color-primary);
}

.unsupported-name {
  margin: 0;
  font-size: 13px;
  word-break: break-all;
  max-width: 480px;
  text-align: center;
}
</style>
