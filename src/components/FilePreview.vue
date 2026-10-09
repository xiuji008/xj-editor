<template>
  <div class="file-preview">
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

onMounted(() => {
  const el = viewerRef.value
  if (!el) return
  // 初始立即计算一次，避免页面首次渲染为原始 A4 大小
  updateWordFitZoom(el.clientWidth)
  fitObserver = new ResizeObserver((entries) => {
    updateWordFitZoom(entries[0]?.contentRect.width || 0)
  })
  fitObserver.observe(el)
})

onUnmounted(() => {
  fitObserver?.disconnect()
  fitObserver = null
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
