<template>
  <div class="md-editor" :style="{ height }">
    <!-- 编辑器主体：左右分栏 -->
    <div class="editor-body">
      <!-- 左侧：Markdown 源码 -->
      <div ref="sourcePaneRef" class="editor-pane source-pane" v-show="!viewMode">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><Document /></el-icon> Markdown 源码
          </span>
          <div ref="toolbarRef" class="pane-tools">
            <!-- 可见基础按钮（空间不足时动态收进"更多"） -->
            <el-tooltip
              v-for="it in inlineItems"
              :key="it.key"
              :content="it.title"
              placement="bottom"
            >
              <el-button
                text
                size="small"
                :class="{ 'is-hidden': overflowKeys.has(it.key) }"
                @click="it.action"
              >{{ it.label }}</el-button>
            </el-tooltip>
            <!-- 插入表情：分类标签 + 表情格子，点击插入到光标处 -->
            <el-popover
              trigger="click"
              placement="bottom-end"
              :width="332"
              :persistent="false"
              popper-class="emoji-picker-popover"
            >
              <template #reference>
                <el-button text size="small" class="emoji-trigger" title="插入表情">表情</el-button>
              </template>
              <div class="emoji-picker">
                <div class="emoji-picker__cats">
                  <button
                    v-for="g in emojiGroups"
                    :key="g.key"
                    type="button"
                    class="emoji-picker__cat"
                    :class="{ 'is-active': emojiActiveKey === g.key }"
                    @click="emojiActiveKey = g.key"
                  >{{ g.label }}</button>
                </div>
                <div v-if="emojiActiveGroup" class="emoji-picker__grid">
                  <button
                    v-for="(e, i) in emojiActiveGroup.emojis"
                    :key="emojiActiveGroup.key + '-' + i"
                    type="button"
                    class="emoji-picker__item"
                    :title="e"
                    @click="insertEmoji(e)"
                  >{{ e }}</button>
                </div>
              </div>
            </el-popover>
            <!-- 更多：高级按钮 + 提示块（可按类型选择）+ 溢出的基础按钮 -->
            <el-dropdown trigger="click" class="more-dropdown" @command="onMoreCommand">
              <el-button text size="small" class="more-btn" title="更多">
                <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="it in dropdownAdvanced"
                    :key="it.key"
                    :command="it.key"
                  >{{ it.label }}</el-dropdown-item>
                  <!-- 提示块：hover 展开类型子菜单，按类型插入 -->
                  <el-dropdown trigger="hover" class="admonition-sub" @command="onAdmonitionCommand">
                    <div class="el-dropdown-menu__item admonition-trigger">
                      提示块
                      <el-icon class="el-icon--right"><ArrowRight /></el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="t in admonitionTypes"
                          :key="t.marker"
                          :command="t.marker"
                        >
                          <span class="alert-type-dot" :style="{ background: t.color }" />{{ t.label }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <el-dropdown-item
                    v-for="it in overflowInlineItems"
                    :key="it.key"
                    :command="it.key"
                  >{{ it.label }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <!-- 额外工具栏内容（如放大按钮），始终可见 -->
          <div class="pane-extra">
            <slot name="toolbar-extra" />
          </div>
        </div>
        <textarea
          ref="textareaRef"
          :value="modelValue"
          class="source-textarea"
          placeholder="在此输入 Markdown 内容..."
          spellcheck="false"
          @input="onInput"
          @beforeinput="onBeforeInput"
          @scroll="onSourceScroll"
          @paste="onPaste"
          @keydown="onFindShortcut"
          @focus="lastPane = 'source'"
          @mouseup="scheduleAskAi"
          @keyup="scheduleAskAi"
          @select="scheduleAskAi"
          @blur="onAskAiBlur"
        />

        <!-- 粘贴图片时的上传中提示：贴在粘贴位置，上传完成或失败后移除 -->
        <transition name="el-fade-in">
          <div
            v-if="pasteLoading && pasteLoadingVisible"
            ref="pasteLoadingRef"
            class="paste-loading"
            :style="{ left: pasteLoadingPos.left + 'px', top: pasteLoadingPos.top + 'px' }"
          >
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>{{ pasteLoadingText }}</span>
          </div>
        </transition>

        <!-- 查找 / 替换栏 -->
        <FindBar
          ref="findBarRef"
          :target="textareaRef"
          :text="modelValue"
          @update:modelValue="onFindReplace"
          @jump="onFindJump"
        />
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

      <!-- 右侧：预览 -->
      <div class="editor-pane preview-pane" :class="{ 'full-width': viewMode }">
        <div class="pane-header">
          <span class="pane-title">
            <el-icon><View /></el-icon> 预览
          </span>
          <!-- 预览区右上角：复制 / 缩放 / 目录导航 -->
          <div class="pane-extra pane-extra-right">
            <!-- 复制：Markdown 源码 / 公众号格式（可选主题）/ 知乎 / 掘金 / 长图 PNG -->
            <CopyMenu
              :markdown="modelValue"
              :code-theme="codeTheme"
              :file-name="fileName"
              :source-el="previewInnerRef || null"
            />
            <el-divider direction="vertical" class="preview-extra-divider" />
            <!-- 预览缩放：缩小 / 当前比例（点击恢复 100%）/ 放大，支持 Ctrl + 滚轮 -->
            <div class="zoom-tools">
              <el-tooltip content="缩小预览（Ctrl + 滚轮）" placement="bottom">
                <el-button
                  text
                  size="small"
                  class="zoom-btn"
                  :disabled="!canZoomOut"
                  @click="onZoomOut"
                >
                  <el-icon><ZoomOut /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="恢复 100%" placement="bottom">
                <el-button text size="small" class="zoom-value" @click="onZoomReset">
                  {{ zoomPercent }}
                </el-button>
              </el-tooltip>
              <el-tooltip content="放大预览（Ctrl + 滚轮）" placement="bottom">
                <el-button
                  text
                  size="small"
                  class="zoom-btn"
                  :disabled="!canZoomIn"
                  @click="onZoomIn"
                >
                  <el-icon><ZoomIn /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
            <el-tooltip :content="tocVisible ? '收起目录' : '目录导航'" placement="bottom">
              <el-button
                text
                size="small"
                class="toc-toggle-btn"
                :class="{ 'is-active': tocVisible }"
                @click="tocVisible = !tocVisible"
              >
                <el-icon><List /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </div>
        <!-- 目录导航面板：浮动于预览区右上角，可收起/展开，默认收起 -->
        <transition name="el-zoom-in-top">
          <div v-show="tocVisible" class="toc-panel">
            <div class="toc-panel-header">
              <span class="toc-panel-title">
                <el-icon><List /></el-icon> 目录
              </span>
              <el-button
                text
                size="small"
                class="toc-panel-close"
                :icon="Close"
                @click="tocVisible = false"
              />
            </div>
            <div class="toc-list">
              <div
                v-for="item in tocItems"
                :key="item.id"
                class="toc-item"
                :class="[`toc-level-${item.level}`, { 'is-active': item.id === activeTocId }]"
                :title="item.text"
                @click="scrollToHeading(item.id)"
              >{{ item.text }}</div>
              <div v-if="tocItems.length === 0" class="toc-empty">当前文档没有标题</div>
            </div>
          </div>
        </transition>
        <div
          ref="previewRef"
          class="preview-content"
          @scroll="onPreviewScroll"
          @click="onPreviewClick"
          @contextmenu="onPreviewContextMenu"
          @wheel="onPreviewWheel"
          @pointerdown="onPreviewGesture"
          @touchstart.passive="onPreviewGesture"
        >
          <!-- 缩放容器：zoom 只作用于内容（图表 / 图片 / 代码块一并缩放），滚动条与留白保持原尺寸 -->
          <div
            ref="previewInnerRef"
            class="preview-zoom-inner markdown-body"
            :style="zoomStyle"
            v-html="renderedHtml"
          />
        </div>

        <!-- 预览内查找（Ctrl+F）：在渲染结果中查找并高亮匹配 -->
        <PreviewFindBar
          ref="previewFindBarRef"
          :root="previewInnerRef"
          :scroller="previewRef"
          :revision="renderedHtml"
        />
      </div>
    </div>

    <!-- 预览右键菜单：图片 / 图表（Mermaid SVG / Chart canvas / PlantUML）另存为 -->
    <teleport to="body">
      <div
        v-if="previewMenu.visible"
        class="preview-ctx-overlay"
        @click="closePreviewMenu"
        @contextmenu.prevent="closePreviewMenu"
      >
        <div
          class="preview-ctx-menu"
          :style="{ left: previewMenu.x + 'px', top: previewMenu.y + 'px' }"
        >
          <div
            v-for="item in previewMenu.items"
            :key="item.label"
            class="preview-ctx-item"
            @click="item.action"
          >{{ item.label }}</div>
        </div>
      </div>
    </teleport>

    <!-- 插入链接弹窗：分别填写跳转链接与展示文本 -->
    <el-dialog
      v-model="linkDialog.visible"
      title="插入链接"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      @closed="() => textareaRef?.focus()"
    >
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="跳转链接">
          <el-input
            v-model="linkDialog.url"
            placeholder="https://example.com"
            clearable
            :autofocus="true"
            @keydown.enter.prevent="confirmInsertLink"
          />
        </el-form-item>
        <el-form-item label="展示文本">
          <el-input
            v-model="linkDialog.text"
            placeholder="链接显示的文字（留空则显示链接地址）"
            clearable
            @keydown.enter.prevent="confirmInsertLink"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="linkDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmInsertLink">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, View, ArrowDown, ArrowRight, List, Close, MagicStick, TrendCharts, ZoomIn, ZoomOut, Loading } from '@element-plus/icons-vue'
import { usePreviewZoom, isZoomModifier } from '../utils/previewZoom'
import {
  renderMarkdown,
  enhanceRenderedDom,
  getMarkdownExtensionStyles,
  applyCodeTheme,
  DEFAULT_CODE_THEME,
  refreshPlantUmlImages,
} from '../utils/markdown'
import { PLANTUML_CONFIG_CHANGED_EVENT } from '../utils/plantUmlConfig'
import {
  getImagesFromClipboard,
  isImageHostingEnabled,
  uploadImages,
} from '../utils/imageHosting'
import {
  basename,
  resolvePath,
  toMdLocalUrl,
  fromMdLocalUrl,
  joinPath,
  fileToDataUrl,
  dataUrlToFile,
  isAbsolutePath,
} from '../utils/fileUtils'
import { getTextareaSelectionEndPos, getTextareaCaretPos } from '../utils/caret'
import { useTextareaHistory } from '../utils/history'
import { EMOJI_GROUPS, loadRecentEmojis, pushRecentEmoji, type EmojiGroup } from '../utils/emojiData'
import FindBar from './FindBar.vue'
import PreviewFindBar from './PreviewFindBar.vue'
import CopyMenu from './CopyMenu.vue'

const props = withDefaults(defineProps<{
  /** Markdown 内容（v-model） */
  modelValue: string
  /** 编辑器高度 */
  height?: string
  /** 代码高亮主题 */
  codeTheme?: string
  /** 只读预览模式：隐藏源码区，预览占满 */
  viewMode?: boolean
  /** 当前 Markdown 文件所在目录：本地图片优先保存/解析到其下的 images 文件夹 */
  imageBaseDir?: string
  /** 应用图片存储目录（userData/images）：文件未保存时保存图片，以及旧文档 images/xxx 图片解析的兜底 */
  appImagesDir?: string
  /** 当前文档名（如 笔记.md）：作为代码块导出文件时的默认文件名前缀 */
  fileName?: string
}>(), {
  height: '360px',
  codeTheme: DEFAULT_CODE_THEME,
  viewMode: false,
  imageBaseDir: '',
  appImagesDir: '',
  fileName: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 点击预览中指向本地文件的链接时触发（如 [a](doc.md)） */
  (e: 'open-file', filePath: string): void
  /** 插入 / 粘贴图片成功（图片写入应用图片目录）后触发，供目录树刷新 */
  (e: 'images-inserted'): void
  /** 通过系统对话框另存出新文件（图片另存为 / 图表导出 PNG）后触发，携带保存路径，供目录树刷新 */
  (e: 'file-saved', filePath: string): void
  /** 点击"问 AI"按钮：携带选中的源码文本，交由父组件填入 AI 对话框 */
  (e: 'ask-ai', text: string): void
  /** 点击"生成图表"按钮：以选中的源码文本作为描述，交由父组件生成图表代码 */
  (e: 'generate-diagram', text: string): void
  /** 点击工具栏"转Word"：交由父组件把当前文档转成 .docx 并写入同级目录 */
  (e: 'export-docx'): void
}>()

const textareaRef = ref<HTMLTextAreaElement>()
const sourcePaneRef = ref<HTMLDivElement>()
const previewRef = ref<HTMLDivElement>()
/** 预览缩放容器（markdown 块级元素都在其下，同步滚动按它取块） */
const previewInnerRef = ref<HTMLDivElement>()
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)
const previewFindBarRef = ref<InstanceType<typeof PreviewFindBar> | null>(null)
/** 最近一次交互所在的分栏：决定 Ctrl+F 走源码查找还是预览查找 */
const lastPane = ref<'source' | 'preview'>('source')

/** 撤销 / 重做历史（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z） */
const history = useTextareaHistory({
  getTextarea: () => textareaRef.value,
  getValue: () => props.modelValue,
  applyValue: (value: string) => emit('update:modelValue', value),
})

/* ========== 预览缩放（Markdown / 图表 / 图片等一并缩放） ========== */
const {
  zoom: previewZoom,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  zoomIn,
  zoomOut,
  resetZoom,
} = usePreviewZoom({ storageKey: 'md-preview-zoom' })

/** 缩放样式：zoom 需为字符串，避免数值被当作带单位的长度处理 */
const zoomStyle = computed(() => ({ zoom: String(previewZoom.value) }))

/**
 * 缩放预览，并保持视口中某个纵向位置（相对预览区顶部）的内容不跳动。
 * 按「内容偏移 / 内容总高」的比例换算，缩放后把同一内容点重新对齐到原位置。
 */
const zoomPreviewAt = (viewportY: number, apply: () => void) => {
  const el = previewRef.value
  if (!el) {
    apply()
    return
  }
  const before = el.scrollTop + viewportY
  const ratio = el.scrollHeight > 0 ? before / el.scrollHeight : 0
  apply()
  nextTick(() => {
    if (previewRef.value !== el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const target = ratio * el.scrollHeight - viewportY
    // 程序性滚动：不反向同步源码，避免缩放时编辑区跟着跳
    setScrollTop('preview', el, Math.max(0, Math.min(target, max)))
  })
}

/** 放大（以预览区竖直中线为锚点） */
const onZoomIn = () => {
  const el = previewRef.value
  zoomPreviewAt(el ? el.clientHeight / 2 : 0, () => zoomIn())
}

/** 缩小（以预览区竖直中线为锚点） */
const onZoomOut = () => {
  const el = previewRef.value
  zoomPreviewAt(el ? el.clientHeight / 2 : 0, () => zoomOut())
}

/** 恢复 100% */
const onZoomReset = () => {
  const el = previewRef.value
  zoomPreviewAt(el ? el.clientHeight / 2 : 0, () => resetZoom())
}

/** 预览滚轮：Ctrl / Cmd + 滚轮以光标位置为锚点缩放，普通滚轮仅记录用户手势（用于反向同步源码） */
const onPreviewWheel = (e: WheelEvent) => {
  if (isZoomModifier(e) && e.deltaY) {
    e.preventDefault()
    const el = previewRef.value
    const viewportY = el ? e.clientY - el.getBoundingClientRect().top : 0
    zoomPreviewAt(viewportY, () => (e.deltaY < 0 ? zoomIn() : zoomOut()))
  }
  onPreviewGesture()
}

/**
 * 渲染后的 HTML。
 * 预览渲染采用防抖：输入（打字 / 回车 / 粘贴 / 工具栏插入）期间不逐键全量重渲染预览，
 * 停止输入后再渲染。否则长文档下每敲一键都会触发 markdown 解析 + 预览 DOM 整体重写 +
 * 全部代码块高亮 / 图表重建，造成主线程卡顿、两侧滚动同步错乱，表现为编辑区视口上下乱跳。
 */
const PREVIEW_RENDER_DEBOUNCE_MS = 200
const EMPTY_PREVIEW_HTML = '<p style="color:#999;text-align:center;padding:40px 0">暂无内容</p>'
const renderPreviewHtml = (md: string) => (md ? renderMarkdown(md) : EMPTY_PREVIEW_HTML)

const renderedHtml = ref(renderPreviewHtml(props.modelValue))
/** 预览渲染防抖定时器：存在即表示还有待执行的渲染请求 */
let previewRenderTimer: ReturnType<typeof setTimeout> | undefined
/**
 * 预览内容是否与源码不一致（源码已变化、预览尚未渲染到最新）。
 * 该阶段两侧 DOM 不匹配，双向滚动同步都应暂停，渲染完成后统一锚定一次，
 * 避免基于过期 DOM 的同步把源码视口滚到错误位置。
 */
let previewRenderPending = false

/** 内容变化：防抖重渲染预览 */
const schedulePreviewRender = () => {
  previewRenderPending = true
  clearTimeout(previewRenderTimer)
  previewRenderTimer = setTimeout(() => {
    previewRenderTimer = undefined
    renderedHtml.value = renderPreviewHtml(props.modelValue)
  }, PREVIEW_RENDER_DEBOUNCE_MS)
}
watch(() => props.modelValue, schedulePreviewRender)

/**
 * 源码区最近一次输入（含回车换行）的时间。
 * 输入后预览会防抖重渲染，渲染完成时的锚定 / 增强可能引发预览 scroll 事件；
 * 该窗口内禁止「预览 -> 源码」的反向滚动，避免正在编辑的光标行被拽到视口顶部。
 */
const SOURCE_INPUT_GUARD_MS = 600
let lastSourceInputAt = 0

/** 输入前捕获改动前状态（供撤销快照使用） */
const onBeforeInput = (e: Event) => {
  lastSourceInputAt = performance.now()
  const ta = textareaRef.value
  if (!ta) return
  history.capturePending({
    value: ta.value,
    start: ta.selectionStart,
    end: ta.selectionEnd,
  })
}

/** 输入时同步内容到父组件 */
const onInput = (e: Event) => {
  lastSourceInputAt = performance.now()
  history.push()
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

// 渲染后增强 DOM（初始化 Mermaid / Chart.js / 复制 / 下载按钮）+ 本地图片路径重写
const refreshPreview = async () => {
  await nextTick()
  if (previewRef.value) {
    try {
      // 传入文档名，使代码块「下载」按钮的默认文件名形如 笔记.py / 笔记-2.sql；
      // 同时传入文档所在目录，作为 ```js 代码块「运行」时的工作目录
      await enhanceRenderedDom(previewRef.value, props.fileName, props.imageBaseDir || '')
    } catch (e) {
      // enhance 失败不影响基本预览
    }
    rewriteLocalImages(previewRef.value)
    updateToc()
    // 预览已按最新源码渲染完成：若期间没有更新的渲染请求，解除滚动同步暂停
    previewRenderPending = previewRenderTimer !== undefined
    // 渲染完成后把预览视口锚定到源码当前视口顶部（程序性滚动，不会反向干扰源码侧）
    const ta = textareaRef.value
    if (ta && ta.clientWidth > 0) syncPreviewFromSource()
  } else {
    previewRenderPending = previewRenderTimer !== undefined
  }
}

// 内容变化时重新增强；首次挂载时 modelValue 已有内容、computed 不会产生"变化"，
// 因此需在 onMounted 中主动调用一次，否则 Mermaid / Chart / PlantUML 等图表会以代码块形态显示。
watch(renderedHtml, refreshPreview)

/**
 * 将预览中的相对 / 绝对本地图片路径重写为 mdlocal:// URL，
 * 使其在桌面端可正常加载（浏览器无法直接加载 file:// 资源）。
 */
const rewriteLocalImages = (container: HTMLElement) => {
  container.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    // 已处理过的 / 远程 / data 直接跳过
    if (!src || /^(data:|mdlocal:|https?:|file:)/i.test(src)) return
    // images/ 前缀：优先从当前文件同级目录的 images 文件夹解析，旧文档图片可能在应用图片目录，失败时回退
    if (/^images[\\/]/i.test(src)) {
      const rel = src.replace(/^images[\\/]/i, '')
      const candidates: string[] = []
      if (props.imageBaseDir) candidates.push(joinPath(props.imageBaseDir, 'images', rel))
      if (props.appImagesDir) candidates.push(joinPath(props.appImagesDir, rel))
      if (candidates.length === 0) return
      let idx = 0
      const tryLoad = () => {
        if (idx >= candidates.length) return
        img.setAttribute('src', toMdLocalUrl(candidates[idx++]))
      }
      img.addEventListener('error', tryLoad, { once: true })
      tryLoad()
      return
    }
    // 相对路径需要有基准目录；绝对路径可直接转换
    if (!props.imageBaseDir && !isAbsolutePath(src)) return
    const abs = props.imageBaseDir ? resolvePath(props.imageBaseDir, src) : resolvePath('', src)
    img.setAttribute('src', toMdLocalUrl(abs))
  })
}

// ========== 目录导航 ==========
const tocVisible = ref(false)
const tocItems = ref<{ id: string; level: number; text: string }[]>([])
const activeTocId = ref('')
let tocSeq = 0

/** 从预览 DOM 中提取标题生成目录（按需补 id，供跳转与高亮使用） */
const updateToc = () => {
  const container = previewRef.value
  if (!container) {
    tocItems.value = []
    return
  }
  const items: { id: string; level: number; text: string }[] = []
  container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const el = h as HTMLElement
    if (!el.id) el.id = `md-toc-${++tocSeq}`
    items.push({
      id: el.id,
      level: Number(el.tagName.slice(1)),
      text: (el.textContent || '').trim(),
    })
  })
  tocItems.value = items
}

/** 点击目录项：平滑滚动预览到对应标题 */
const scrollToHeading = (id: string) => {
  const el = previewRef.value?.querySelector(`#${CSS.escape(id)}`)
  if (!el) return
  // 视为一次"用户主动滚动预览"：滚动期间的 scroll 事件可反向同步源码，保证两侧联动
  onPreviewGesture()
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 预览滚动时高亮当前目录项 */
const updateActiveToc = () => {
  const container = previewRef.value
  if (!container || tocItems.value.length === 0) {
    activeTocId.value = ''
    return
  }
  const containerTop = container.getBoundingClientRect().top
  let active = ''
  for (const item of tocItems.value) {
    const el = container.querySelector(`#${CSS.escape(item.id)}`)
    if (!el) continue
    if ((el as HTMLElement).getBoundingClientRect().top - containerTop <= 12) {
      active = item.id
    } else {
      break
    }
  }
  activeTocId.value = active
}

/** 预览滚动：更新目录高亮；仅在用户主动浏览预览时才反向同步源码滚动 */
const onPreviewScroll = (e: Event) => {
  updateActiveToc()
  if (isProgrammaticScroll('preview', e.target as HTMLElement)) return
  // 源码 -> 预览的自动锚定刚发生：后续 scroll 事件即使 scrollTop 已被异步增强改变（clamp），
  // 也属于程序性滚动，不能反向同步源码，否则会把编辑中的光标行顶到顶部
  if (performance.now() < previewProgramScrollUntil) return
  // 预览渲染防抖窗口内，预览 DOM 与源码不一致，此时的滚动多为渲染副作用，跳过反向同步
  if (previewRenderPending) return
  // 非用户手势（滚轮 / 触摸 / 指针按下）引起的滚动（如图表/图片异步加载导致高度变化）
  // 若反向同步源码会把编辑中的视口滚乱，仅用户主动浏览预览时才同步
  if (performance.now() - previewGestureAt > PREVIEW_GESTURE_WINDOW_MS) return
  scheduleScrollSync('preview')
}

/**
 * 预览点击：http/https/mailto/tel 链接交给系统默认浏览器打开，
 * 指向本地文件的链接交给父组件打开
 * （支持 .md/.txt/图片/PDF 等，父组件按类型分发到编辑器或预览器）
 */
const onPreviewClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  const anchor = target.closest?.('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') || ''
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    // 阻止 Electron 窗口内导航，改用系统默认浏览器打开
    e.preventDefault()
    if (window.mdAPI?.openUrl) {
      window.mdAPI.openUrl(href).then((res) => {
        if (res && res.ok === false && res.error) ElMessage.warning(res.error)
      })
    } else if (typeof window !== 'undefined') {
      window.open(href, '_blank', 'noopener')
    }
    return
  }
  if (/^(#|mdlocal:|data:)/i.test(href)) return
  e.preventDefault()
  const abs = props.imageBaseDir ? resolvePath(props.imageBaseDir, href) : href
  if (abs) emit('open-file', abs)
}

// 代码主题变更时应用
watch(() => props.codeTheme, (theme) => {
  applyCodeTheme(theme)
})

// ========== 工具栏：插入 Markdown 文本 ==========
/**
 * 在光标处插入文本。
 * 直接以 textarea 实际内容（ta.value）作为插入基准，避免受控组件下
 * props.modelValue 尚未同步导致插入错位、光标跳转到文末的问题；
 * 同步设置 textarea 的值与光标后，Vue 重渲染时发现值相同会跳过 DOM 写入，光标得以保留。
 */
const insertMarkdown = (text: string) => {
  const ta = textareaRef.value
  if (!ta) return
  history.push(true)
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const cur = ta.value
  const newVal = cur.slice(0, start) + text + cur.slice(end)
  const caret = start + text.length
  const prevScrollTop = ta.scrollTop

  // 程序化赋值 textarea.value 后，浏览器会把选区重置到文末；
  // 若先 focus() 再 setSelectionRange，focus 触发的"滚动到选区"（异步）
  // 会先滚到文末，导致插入代码块/表格后编辑器跳转到文档底部。
  // 因此先设置选区再聚焦。
  ta.value = newVal
  ta.setSelectionRange(caret, caret)
  ta.focus()

  // 插入点之前的文本未变，光标所在行相对视口的位置应与插入前一致：
  // 保持插入前的 scrollTop 即可让插入行停留在原屏幕位置，不必按行号估算滚动目标
  // （源码默认软换行，按「逻辑行号 × 行高」估算在长段落处会算错，反而导致视口跳行）。
  // 下一帧把滚动位置恢复为插入前的位置（若内容变短则 clamp 防越界），
  // 并标记为程序性滚动，避免该滚动被反向同步放大、造成视口抖动。
  requestAnimationFrame(() => {
    if (textareaRef.value !== ta) return
    const maxScroll = Math.max(0, ta.scrollHeight - ta.clientHeight)
    setScrollTop('source', ta, Math.max(0, Math.min(prevScrollTop, maxScroll)))
  })

  emit('update:modelValue', newVal)
}

const insertCodeBlock = () => {
  insertMarkdown('\n```\n\n```\n')
}

// ========== 插入链接弹窗 ==========
const linkDialog = ref({ visible: false, text: '', url: '' })

const insertLink = () => {
  const ta = textareaRef.value
  // 选中的文本作为默认展示文本
  const selected = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() : ''
  linkDialog.value = { visible: true, text: selected, url: 'https://' }
}

const confirmInsertLink = () => {
  let url = linkDialog.value.url.trim()
  if (!url) {
    ElMessage.warning('请填写跳转链接')
    return
  }
  // 无协议时默认补全 https://
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) url = 'https://' + url
  const text = linkDialog.value.text.trim() || url
  insertMarkdown(`[${text}](${url})`)
  linkDialog.value.visible = false
}

/** 插入表格 */
const insertTable = () => {
  insertMarkdown('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n')
}

const insertImageBusy = ref(false)

/**
 * 计算本地图片保存目录：
 * 优先当前文件同级目录下的 images 文件夹；文件未保存（无目录）时回退到应用图片目录。
 */
const getLocalImagesDir = (): string => {
  return props.imageBaseDir ? joinPath(props.imageBaseDir, 'images') : props.appImagesDir
}

/**
 * 插入图片：
 * - 已配置图床：读取本地图片 -> 上传 -> 插入图片 URL
 * - 未配置（本地模式）：把图片复制到当前文件同级目录下的 images 文件夹，插入 images/文件名 相对路径
 */
const insertImage = async () => {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面应用中可用')
    return
  }
  if (insertImageBusy.value) return
  insertImageBusy.value = true
  try {
    const res = await window.mdAPI.selectImages()
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return
    const paths = res.filePaths

    if (isImageHostingEnabled()) {
      // 图床模式：路径 -> dataUrl -> File -> 上传
      const files: File[] = []
      for (const p of paths) {
        const data = await window.mdAPI.readDataUrl(p)
        if (!data.ok || !data.dataUrl) continue
        const file = dataUrlToFile(data.dataUrl, basename(p))
        if (file) files.push(file)
      }
      if (files.length === 0) throw new Error('无法读取所选图片')
      const results = await uploadImages(files)
      for (const r of results) insertMarkdown(`\n![${r.fileName}](${r.url})\n`)
      ElMessage.success(`已上传并插入 ${results.length} 张图片`)
    } else {
      // 本地模式：复制到当前文件同级目录的 images 文件夹，插入 images/文件名 相对路径
      const targetDir = getLocalImagesDir()
      if (!targetDir) {
        ElMessage.warning('当前文件尚未保存，请先保存文件后再插入图片')
        return
      }
      const imp = await window.mdAPI.importImages(paths, targetDir)
      if (!imp.ok || !imp.results) throw new Error(imp.error || '导入图片失败')
      for (const item of imp.results) {
        insertMarkdown(`\n![${item.fileName}](images/${item.fileName})\n`)
      }
      emit('images-inserted')
      ElMessage.success(`已插入 ${imp.results.length} 张图片到当前文件目录下的 images 文件夹`)
    }
  } catch (err: any) {
    ElMessage.error(`图片插入失败：${err?.message || '未知错误'}`)
  } finally {
    insertImageBusy.value = false
  }
}

/* ========== 粘贴图片的上传中提示 ========== */
/** 是否正在处理粘贴的图片（上传 / 保存中） */
const pasteLoading = ref(false)
/** 提示文案 */
const pasteLoadingText = ref('')
/** 提示是否落在源码区可视范围内（滚动出可视区时隐藏） */
const pasteLoadingVisible = ref(false)
/** 提示相对源码区的位置 */
const pasteLoadingPos = ref({ left: 0, top: 0 })
const pasteLoadingRef = ref<HTMLElement>()
/** 粘贴位置锚点（视口坐标 + 当时的滚动偏移，用于滚动后重新定位） */
let pasteAnchor: { x: number; y: number; lineHeight: number; scrollTop: number; scrollLeft: number } | null = null

/** 按粘贴锚点（叠加之后的滚动偏移）刷新提示位置；粘贴行滚出可视区时隐藏 */
const updatePasteLoadingPos = () => {
  const ta = textareaRef.value
  const pane = sourcePaneRef.value
  if (!ta || !pane || !pasteAnchor) return
  const paneRect = pane.getBoundingClientRect()
  const taRect = ta.getBoundingClientRect()
  const x = pasteAnchor.x - (ta.scrollLeft - pasteAnchor.scrollLeft)
  const y = pasteAnchor.y - (ta.scrollTop - pasteAnchor.scrollTop)
  const lineH = pasteAnchor.lineHeight || 20
  pasteLoadingVisible.value = y >= taRect.top + 2 && y <= taRect.bottom - 2
  if (!pasteLoadingVisible.value) return
  // 提示贴在行末右侧；靠近右边界时左移，避免被源码区裁掉
  const chipW = pasteLoadingRef.value?.offsetWidth || 160
  const maxLeft = Math.max(4, taRect.right - paneRect.left - chipW - 4)
  pasteLoadingPos.value = {
    left: Math.min(Math.max(x - paneRect.left + 4, 4), maxLeft),
    top: Math.min(
      Math.max(y - paneRect.top - lineH / 2, taRect.top - paneRect.top + lineH / 2),
      taRect.bottom - paneRect.top - lineH / 2,
    ),
  }
}

/** 在粘贴落点显示上传中提示 */
const showPasteLoading = (count: number) => {
  const ta = textareaRef.value
  if (!ta) return
  const pos = getTextareaCaretPos(ta, ta.selectionStart)
  if (!pos) return
  pasteLoadingText.value = count > 1 ? `正在上传 ${count} 张图片…` : '图片上传中…'
  pasteAnchor = {
    x: pos.x,
    y: pos.y,
    lineHeight: pos.lineHeight || 20,
    scrollTop: ta.scrollTop,
    scrollLeft: ta.scrollLeft,
  }
  pasteLoading.value = true
  updatePasteLoadingPos()
  // 提示渲染后拿到实际宽度，再校正一次水平位置
  nextTick(updatePasteLoadingPos)
}

/** 移除上传中提示（上传完成或失败后调用） */
const hidePasteLoading = () => {
  pasteLoading.value = false
  pasteLoadingVisible.value = false
  pasteAnchor = null
}

/**
 * 粘贴处理：粘贴图片时自动处理（图床上传 / 本地保存），
 * 粘贴本地文件路径时转成 Markdown 链接。
 */
const onPaste = async (e: ClipboardEvent) => {
  if (!e.clipboardData) return
  const images = getImagesFromClipboard(e.clipboardData)

  // 图片粘贴
  if (images.length > 0) {
    e.preventDefault()
    if (!window.mdAPI) {
      ElMessage.warning('图片粘贴功能仅在桌面应用中可用')
      return
    }
    showPasteLoading(images.length)
    try {
      if (isImageHostingEnabled()) {
        const results = await uploadImages(images)
        for (const r of results) insertMarkdown(`\n![${r.fileName}](${r.url})\n`)
        ElMessage.success(`已上传 ${results.length} 张图片`)
      } else {
        // 本地模式：粘贴图片保存到当前文件同级目录的 images 文件夹，插入 images/文件名 相对路径
        const targetDir = getLocalImagesDir()
        if (!targetDir) {
          ElMessage.warning('当前文件尚未保存，请先保存文件后再粘贴图片')
          return
        }
        for (const file of images) {
          const dataUrl = await fileToDataUrl(file)
          const res = await window.mdAPI!.saveImageData(dataUrl, targetDir, file.name)
          if (res.ok && res.fileName) {
            insertMarkdown(`\n![${res.fileName}](images/${res.fileName})\n`)
          } else {
            ElMessage.error(res.error || '保存粘贴的图片失败')
          }
        }
        emit('images-inserted')
        ElMessage.success(`已粘贴 ${images.length} 张图片`)
      }
    } catch (err: any) {
      ElMessage.error(`粘贴图片失败：${err?.message || '未知错误'}`)
    } finally {
      hidePasteLoading()
    }
    return
  }

  // 粘贴文件路径 -> 转成 Markdown 链接
  const text = e.clipboardData.getData('text')
  if (text && /^[A-Za-z]:[\\/]/.test(text.trim()) && /\.\w+$/.test(text.trim())) {
    e.preventDefault()
    const p = text.trim().replace(/"/g, '')
    const name = basename(p)
    insertMarkdown(`[${name}](${p})`)
  }
}

const insertMermaid = () => {
  insertMarkdown('\n```mermaid\ngraph TD\n    A[开始] --> B[结束]\n```\n')
}

const insertChart = () => {
  const chartTemplate = `\n\`\`\`chart\n{\n  "type": "pie",\n  "title": "技术栈分布",\n  "data": [\n    { "name": "Java", "value": 40 },\n    { "name": "Python", "value": 25 },\n    { "name": "前端", "value": 20 }\n  ]\n}\n\`\`\`\n`
  insertMarkdown(chartTemplate)
}

const insertPlantUml = () => {
  insertMarkdown('\n```plantuml\n@startuml\nAlice -> Bob: 你好\n@enduml\n```\n')
}

/** 提示块类型（渲染端 markdown.ts 中对应的 alert 语法） */
const admonitionTypes = [
  { marker: 'NOTE', label: '笔记', color: '#409eff' },
  { marker: 'TIP', label: '提示', color: '#67c23a' },
  { marker: 'IMPORTANT', label: '重要', color: '#9c27b0' },
  { marker: 'WARNING', label: '警告', color: '#e6a23c' },
  { marker: 'CAUTION', label: '危险', color: '#f56c6c' },
]

/** 插入提示块，可指定类型 */
const insertAdmonition = (marker = 'NOTE') => {
  insertMarkdown(`\n> [!${marker}]\n> 在此输入提示内容\n`)
}

/** 提示块子菜单点击 */
const onAdmonitionCommand = (marker: string) => {
  insertAdmonition(marker)
}

const insertMath = () => {
  insertMarkdown('\n$$\nE = mc^2\n$$\n')
}

// ========== 插入表情 ==========
/** 最近使用的表情（首个分组），localStorage 持久化 */
const recentEmojis = ref<string[]>(loadRecentEmojis())

/** 分组列表：有最近记录时在最前面追加「最近」分组 */
const emojiGroups = computed<EmojiGroup[]>(() =>
  recentEmojis.value.length
    ? [{ key: 'recent', label: '最近', emojis: recentEmojis.value }, ...EMOJI_GROUPS]
    : EMOJI_GROUPS,
)

const emojiActiveKey = ref(EMOJI_GROUPS[0].key)

const emojiActiveGroup = computed<EmojiGroup | undefined>(() =>
  emojiGroups.value.find((g) => g.key === emojiActiveKey.value) ?? emojiGroups.value[0],
)

/** 插入表情到光标处，并记录到最近使用 */
const insertEmoji = (emoji: string) => {
  insertMarkdown(emoji)
  recentEmojis.value = pushRecentEmoji(emoji)
}

// ========== 工具栏：数据驱动 + 溢出下拉 ==========
interface ToolbarItem {
  key: string
  label: string
  title: string
  action: () => void
}

// 基础按钮：常驻一行，空间不足时动态收进下拉
const inlineItems: ToolbarItem[] = [
  { key: 'find', label: '查找', title: '查找 / 替换 (Ctrl+F)', action: () => openSourceFind('find') },
  { key: 'h1', label: 'H1', title: '一级标题', action: () => insertMarkdown('# ') },
  { key: 'h2', label: 'H2', title: '二级标题', action: () => insertMarkdown('## ') },
  { key: 'h3', label: 'H3', title: '三级标题', action: () => insertMarkdown('### ') },
  { key: 'list', label: '列表', title: '无序列表', action: () => insertMarkdown('- ') },
  { key: 'code', label: '代码', title: '代码块', action: insertCodeBlock },
  { key: 'link', label: '链接', title: '链接', action: insertLink },
  { key: 'table', label: '表格', title: '插入表格', action: insertTable },
  { key: 'image', label: '图片', title: '插入图片', action: insertImage },
  {
    key: 'docx',
    label: '转Word',
    title: '转换为 Word 文档（.docx），保存到当前文件同级目录',
    action: () => emit('export-docx'),
  },
]

// 高级按钮：始终收入"更多"下拉（提示块单独处理为可选用类型的子菜单）
const advancedItems: ToolbarItem[] = [
  { key: 'mermaid', label: 'Mermaid 图表', title: 'Mermaid 图表', action: insertMermaid },
  { key: 'plantuml', label: 'PlantUML 图表', title: 'PlantUML 图表（渲染需联网）', action: insertPlantUml },
  { key: 'chart', label: 'Chart 图表', title: 'Chart 图表', action: insertChart },
  { key: 'math', label: '数学公式', title: '数学公式', action: insertMath },
]

const allItems = [...inlineItems, ...advancedItems]

const toolbarRef = ref<HTMLElement>()
const overflowKeys = ref<Set<string>>(new Set())
let resizeObserver: ResizeObserver | null = null
let recomputeRaf = 0

// 下拉内容（高级按钮部分）
const dropdownAdvanced = computed(() => advancedItems)
// 下拉内容（被溢出隐藏的基础按钮，保证下拉始终可用）
const overflowInlineItems = computed(() =>
  inlineItems.filter((it) => overflowKeys.value.has(it.key)),
)

/**
 * 重新计算溢出：基础按钮总宽超出可用区域时，将放不下的按钮动态收进"更多"。
 * 直接测量实际渲染的按钮，与显示完全一致，避免测量行与实际渲染不一致。
 */
const recomputeOverflow = () => {
  const wrap = toolbarRef.value
  if (!wrap) return
  const available = wrap.clientWidth
  if (!available) return
  // 直接子元素中的 .el-button 即为行内基础按钮（el-tooltip 未额外包裹 span，class 合并到 button 上）
  const btnEls = Array.from(wrap.querySelectorAll<HTMLElement>(':scope > .el-button'))
  const moreEl = wrap.querySelector<HTMLElement>('.more-dropdown')
  const moreW = moreEl?.offsetWidth || 0
  const gap = 2
  // 预留"更多"按钮本身及其与最后一个按钮之间的间隙
  const threshold = available - moreW - gap
  const hidden = new Set<string>()
  let cum = 0
  btnEls.forEach((el, i) => {
    const it = inlineItems[i]
    if (!it) return
    if (i > 0) cum += gap
    cum += el.offsetWidth || 0
    if (cum > threshold) hidden.add(it.key)
  })
  overflowKeys.value = hidden
}

/** 防抖调度：合并同一帧内的多次尺寸变化 */
const scheduleRecompute = () => {
  if (recomputeRaf) return
  recomputeRaf = requestAnimationFrame(() => {
    recomputeRaf = 0
    recomputeOverflow()
  })
}

/** 点击下拉项 */
const onMoreCommand = (key: string) => {
  const item = allItems.find((it) => it.key === key)
  item?.action()
}

/* ========== 查找 / 替换（源码区 + 预览区） ========== */

/** 查找栏替换结果回写源码（替换为独立撤销步骤） */
function onFindReplace(value: string) {
  history.push(true)
  emit('update:modelValue', value)
}

/** 打开源码查找（同时关闭预览查找，两个查找栏不叠加） */
const openSourceFind = (mode: 'find' | 'replace' = 'find') => {
  previewFindBarRef.value?.close()
  findBarRef.value?.open(mode)
}

/** 打开预览内查找（同时关闭源码查找） */
const openPreviewFind = () => {
  findBarRef.value?.close()
  previewFindBarRef.value?.open()
}

/** 焦点是否在输入框 / 文本域 / 富文本中（是则不劫持其快捷键） */
const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * 窗口级快捷键：焦点不在源码区时（点击过预览、或纯预览模式）Ctrl+F 走预览内查找。
 * 已由 textarea / 查找栏处理过的按键会 preventDefault，这里直接跳过。
 */
function onWindowKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (!(e.ctrlKey || e.metaKey)) return
  // 焦点在其他输入框（如 AI 面板）时不拦截
  if (isEditableTarget(e.target)) return
  const key = e.key.toLowerCase()
  if (key === 'f') {
    // 纯预览模式下源码区已隐藏，必须能在预览中查找
    if (!props.viewMode && lastPane.value !== 'preview') return
    e.preventDefault()
    openPreviewFind()
  } else if (e.key === 'F3' && previewFindBarRef.value?.visible) {
    e.preventDefault()
    if (e.shiftKey) previewFindBarRef.value.prev()
    else previewFindBarRef.value.next()
  }
}

/** 源码区快捷键：Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做、Ctrl+F 查找、Ctrl+H 替换、F3 跳转、Esc 关闭 */
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
    openSourceFind('find')
  } else if (mod && key === 'h') {
    e.preventDefault()
    openSourceFind('replace')
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

onMounted(() => {
  nextTick(() => {
    recomputeOverflow()
    if (toolbarRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleRecompute)
      // 观察工具栏父容器：侧边栏拖动 / 窗口缩放 / 分屏切换都会引起宽度变化
      const header = toolbarRef.value.closest('.pane-header')
      if (header) resizeObserver.observe(header)
      resizeObserver.observe(toolbarRef.value)
    }
    // 字体加载完成后按钮宽度可能变化，重新计算
    document.fonts?.ready?.then(() => recomputeOverflow())
    window.addEventListener('resize', scheduleRecompute)
  })
})

onBeforeUnmount(() => {
  if (previewRenderTimer) {
    clearTimeout(previewRenderTimer)
    previewRenderTimer = undefined
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  if (recomputeRaf) {
    cancelAnimationFrame(recomputeRaf)
    recomputeRaf = 0
  }
  if (scrollSyncRaf) {
    cancelAnimationFrame(scrollSyncRaf)
    scrollSyncRaf = 0
  }
  window.removeEventListener('resize', scheduleRecompute)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener(PLANTUML_CONFIG_CHANGED_EVENT, onPlantUmlConfigChanged)
})

// ========== 同步滚动（基于源码行号锚定） ==========
// 预览中每个块级元素都带 data-line（源码起始行号，1-based，由 markdown.ts 注入）。
// 滚动时把「源码行号」与「预览块位置」双向锚定，块边界严格对齐、块内线性插值，
// 相比旧的比例同步（scrollTop/scrollHeight）在内容高度差异大、图片/图表异步加载时更准确。
/**
 * 程序性滚动标记：记录某侧最近一次程序设置 scrollTop 的期望值与时间。
 * 随后该侧产生的 scroll 事件若 scrollTop 与期望值一致（浏览器可能 clamp，取容差），
 * 即认定为程序滚动的结果而忽略，从而阻断「源码 -> 预览 -> 源码」的循环同步。
 * 不能只依赖事件时间戳：长文档输入时预览重渲染较慢，滚动同步被 rAF / 渲染队列延迟后，
 * scroll 事件与程序滚动相隔已超过几十毫秒，纯时间窗会失效并导致两侧来回滚动、视口抖动。
 */
const PROGRAM_SCROLL_TOLERANCE = 2 // 期望值容差 px
const PROGRAM_SCROLL_WINDOW_MS = 500 // 超过该时长不再认定，避免误伤之后的用户滚动
const programScrollAt: Record<'source' | 'preview', number> = { source: -1, preview: -1 }
const programScrollValue: Record<'source' | 'preview', number> = { source: -1, preview: -1 }

/** 标记某侧本次 scrollTop 为程序性设置（随后该侧紧邻的 scroll 事件应被忽略，避免循环同步） */
const markProgrammaticScroll = (side: 'source' | 'preview', value: number) => {
  programScrollAt[side] = performance.now()
  programScrollValue[side] = value
}

/** 判断某侧 scroll 事件是否由程序性滚动触发 */
const isProgrammaticScroll = (side: 'source' | 'preview', el: HTMLElement): boolean => {
  const expected = programScrollValue[side]
  if (expected < 0) return false
  if (performance.now() - programScrollAt[side] > PROGRAM_SCROLL_WINDOW_MS) return false
  return Math.abs(el.scrollTop - expected) <= PROGRAM_SCROLL_TOLERANCE
}

/**
 * 预览侧「程序性滚动静默期」：源码 -> 预览的自动锚定（含预览重渲染后的统一锚定）之后，
 * 预览 scrollHeight 可能被代码块高亮 / 图片 / 图表异步增强再次改变，浏览器会把 scrollTop
 * 重新 clamp 成另一个值，导致上面的「数值相等」判定失效；此时的 scroll 事件会被误当成
 * 用户滚动而反向同步源码，表现为「光标所在行被顶到编辑器顶部」。
 * 因此额外用一个纯时间窗兜底，窗口内的预览 scroll 事件一律忽略。
 */
const PREVIEW_PROGRAM_SCROLL_GUARD_MS = 400
let previewProgramScrollUntil = 0

/** 设置滚动位置并打上程序性标记（记录浏览器 clamp 后的实际值，保证判定可靠） */
const setScrollTop = (side: 'source' | 'preview', el: HTMLElement, value: number) => {
  el.scrollTop = value
  markProgrammaticScroll(side, el.scrollTop)
  if (side === 'preview') {
    previewProgramScrollUntil = performance.now() + PREVIEW_PROGRAM_SCROLL_GUARD_MS
  }
}

/** 用户在预览区主动滚动（滚轮 / 触摸 / 指针按下）的最近时间 */
let previewGestureAt = 0
/** 该时间窗口内的预览滚动视为用户主动浏览，才反向同步源码 */
const PREVIEW_GESTURE_WINDOW_MS = 500
const onPreviewGesture = () => {
  previewGestureAt = performance.now()
  // 记录"最近交互在预览区"：Ctrl+F 时据此走预览内查找
  lastPane.value = 'preview'
}

/** 影响源码 textarea 换行布局的样式属性（供镜像复刻） */
const SOURCE_WRAP_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

/** 源码换行布局缓存：value/宽度/样式不变时可复用，避免每个滚动帧重建镜像 */
let sourceWrapCache: {
  value: string
  clientWidth: number
  styleKey: string
  tops: number[]
} | null = null

/**
 * 源码 textarea 默认软换行（wrap），一个逻辑行可能占多个可视行。
 * 直接按 scrollTop / lineHeight 换算会把「可视行」当作「逻辑行」，导致同步滚动锚到过远处。
 * 这里用隐藏镜像复刻 textarea 的换行布局，测出每个逻辑行首可视行的纵向偏移（相对第 0 行，即内容区顶部）。
 */
const getSourceWrapLayout = (ta: HTMLTextAreaElement): { tops: number[] } => {
  const cs = getComputedStyle(ta)
  const value = ta.value
  const clientWidth = ta.clientWidth
  const styleKey = SOURCE_WRAP_KEYS.map((k) => `${k}:${cs[k]}`).join(';')
  const cached = sourceWrapCache
  if (cached && cached.value === value && cached.clientWidth === clientWidth && cached.styleKey === styleKey) {
    return cached
  }
  const mirror = document.createElement('div')
  for (const key of SOURCE_WRAP_KEYS) {
    const v = cs[key]
    if (v) (mirror.style as unknown as Record<string, string>)[key] = v
  }
  mirror.style.position = 'absolute'
  mirror.style.left = '-99999px'
  mirror.style.top = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.width = `${clientWidth}px`
  // 末尾补一个换行：保证每行（含末尾空行）的测量区间内都含有字符，且不影响上方行布局
  mirror.textContent = value + '\n'
  document.body.appendChild(mirror)
  const tops: number[] = []
  const textNode = mirror.firstChild
  if (textNode) {
    // 各逻辑行的起始 offset
    const starts: number[] = [0]
    let pos = -1
    while ((pos = value.indexOf('\n', pos + 1)) !== -1) starts.push(pos + 1)
    const probeLen = value.length + 1
    for (let li = 0; li < starts.length; li++) {
      const s = starts[li]
      // 该行区间延伸到其换行符之后，保证 range 非空
      const e = li + 1 < starts.length ? starts[li + 1] : probeLen
      const range = document.createRange()
      range.setStart(textNode, Math.min(s, probeLen))
      range.setEnd(textNode, Math.min(e, probeLen))
      const rect = range.getClientRects()[0]
      tops.push(rect ? rect.top : 0)
    }
  }
  document.body.removeChild(mirror)
  if (tops.length === 0) tops.push(0)
  const base = tops[0] || 0
  for (let i = 0; i < tops.length; i++) tops[i] -= base
  sourceWrapCache = { value, clientWidth, styleKey, tops }
  return sourceWrapCache
}

/** 源码视口顶部对应的逻辑行号（0-based） */
const getSourceTopLineIndex = (ta: HTMLTextAreaElement): number => {
  const { tops } = getSourceWrapLayout(ta)
  const y = Math.max(0, ta.scrollTop)
  // 二分：最后一个「首可视行顶 <= y」的行，即视口顶部所在行
  let lo = 0
  let hi = tops.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] <= y) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 将某个逻辑行（0-based）的首可视行滚到源码视口顶部所需的 scrollTop */
const getSourceLineScrollTop = (ta: HTMLTextAreaElement, lineIndex: number): number => {
  const { tops } = getSourceWrapLayout(ta)
  const i = Math.max(0, Math.min(lineIndex, tops.length - 1))
  return tops[i]
}

/** 预览顶层带 data-line 的块：{ 起始行号, 相对预览内容顶部的位置 } */
const getLineBlocks = (): { line: number; top: number }[] => {
  const preview = previewRef.value
  const inner = previewInnerRef.value
  if (!preview || !inner) return []
  const prect = preview.getBoundingClientRect()
  const blocks: { line: number; top: number }[] = []
  for (const el of Array.from(inner.children)) {
    const line = Number((el as HTMLElement).dataset.line)
    if (!Number.isFinite(line) || line <= 0) continue
    const top = (el as HTMLElement).getBoundingClientRect().top - prect.top + preview.scrollTop
    blocks.push({ line, top })
  }
  blocks.sort((a, b) => a.line - b.line)
  return blocks
}

/** 源码滚动 -> 预览：取视口顶部行号，在块间线性插值得到预览滚动位置 */
const syncPreviewFromSource = () => {
  const ta = textareaRef.value
  const preview = previewRef.value
  // 源码区隐藏（全屏预览模式）时不执行同步
  if (!ta || !preview || ta.clientWidth === 0) return
  // 源码默认软换行：用「换行感知」的行号（而非 scrollTop/lineHeight 的可视行数），否则会锚到过远的块
  const line0 = getSourceTopLineIndex(ta)
  const blocks = getLineBlocks()
  if (blocks.length === 0) return
  let i = 0
  while (i < blocks.length && blocks[i].line - 1 < line0) i++
  const prev = blocks[Math.max(0, i - 1)]
  const next = blocks[Math.min(blocks.length - 1, i)]
  let targetTop: number
  if (i === 0 || i >= blocks.length) {
    targetTop = prev.top
  } else {
    const span = next.line - prev.line || 1
    targetTop = prev.top + (next.top - prev.top) * ((line0 - (prev.line - 1)) / span)
  }
  const previewPaddingTop = parseFloat(getComputedStyle(preview).paddingTop) || 0
  const max = Math.max(0, preview.scrollHeight - preview.clientHeight)
  setScrollTop('preview', preview, Math.max(0, Math.min(targetTop - previewPaddingTop, max)))
}

/** 预览滚动 -> 源码：取视口顶部对应的块行号并滚动源码 */
const syncSourceFromPreview = () => {
  const ta = textareaRef.value
  const preview = previewRef.value
  // 源码区隐藏（全屏预览模式）时不执行同步
  if (!ta || !preview || ta.clientWidth === 0) return
  // 焦点在源码区（用户正在编辑）：反向同步会把光标行滚出视口，
  // 之后一旦输入（如回车），浏览器为了让光标可见会把光标所在行顶到视口顶部。
  // 编辑期间以光标为准，不允许预览的反向同步挪动源码视口。
  if (document.activeElement === ta) return
  // 正在输入（打字 / 回车 / 粘贴）：编辑中的源码视口不得被反向同步挪动，
  // 否则回车触发预览重渲染时，光标所在行会被顶到编辑器视口顶部
  if (performance.now() - lastSourceInputAt < SOURCE_INPUT_GUARD_MS) return
  const blocks = getLineBlocks()
  if (blocks.length === 0) return
  const previewPaddingTop = parseFloat(getComputedStyle(preview).paddingTop) || 0
  const viewTop = preview.scrollTop + previewPaddingTop
  let i = 0
  while (i < blocks.length && blocks[i].top < viewTop) i++
  const prev = blocks[Math.max(0, i - 1)]
  const next = blocks[Math.min(blocks.length - 1, i)]
  let line: number
  if (i === 0 || i >= blocks.length) {
    line = prev.line
  } else {
    const span = next.top - prev.top || 1
    line = prev.line + ((viewTop - prev.top) / span) * (next.line - prev.line)
  }
  const max = Math.max(0, ta.scrollHeight - ta.clientHeight)
  // 源码默认软换行：滚动目标应为「该逻辑行首可视行」的内容偏移（按换行布局换算）
  const target = getSourceLineScrollTop(ta, Math.round(line) - 1)
  setScrollTop('source', ta, Math.max(0, Math.min(target, max)))
}

/** 滚动同步按帧合并：同一帧内的多次滚动事件只执行一次锚定 */
let scrollSyncRaf = 0
const scheduleScrollSync = (source: 'source' | 'preview') => {
  if (scrollSyncRaf) return
  scrollSyncRaf = requestAnimationFrame(() => {
    scrollSyncRaf = 0
    if (source === 'source') syncPreviewFromSource()
    else syncSourceFromPreview()
  })
}

/** 源码区滚动：同步预览滚动并刷新浮动按钮位置 */
const onSourceScroll = (event: Event) => {
  // 粘贴图片的上传提示跟着粘贴位置滚动 / 滚出可视区时隐藏
  updatePasteLoadingPos()
  scheduleAskAi()
  // 预览防抖渲染窗口内，预览仍是旧内容，先不同步，渲染完成后统一锚定一次
  if (previewRenderPending) return
  if (isProgrammaticScroll('source', event.target as HTMLElement)) return
  scheduleScrollSync('source')
}

// 注入 Markdown 扩展样式到全局（确保 v-html 内动态生成的元素能正确显示）
const extensionStyleId = 'md-extension-styles'
const injectExtensionStyles = () => {
  if (document.getElementById(extensionStyleId)) return
  const style = document.createElement('style')
  style.id = extensionStyleId
  style.textContent = getMarkdownExtensionStyles()
  document.head.appendChild(style)
}

onMounted(() => {
  injectExtensionStyles()
  applyCodeTheme(props.codeTheme)
  // 组件挂载即渲染首屏图表 / 代码块增强（watch 仅在内容变化时触发，首次挂载需手动调用）
  refreshPreview()
})

/** PlantUML 服务配置变更：刷新预览中已渲染的图表，使其使用新地址重新加载 */
const onPlantUmlConfigChanged = () => {
  if (previewRef.value) refreshPlantUmlImages(previewRef.value)
}

onMounted(() => {
  window.addEventListener(PLANTUML_CONFIG_CHANGED_EVENT, onPlantUmlConfigChanged)
  // 窗口级快捷键：焦点不在源码区（或纯预览模式）时，Ctrl+F 在预览中查找
  window.addEventListener('keydown', onWindowKeydown)
})

/** 获取源码区当前选中的文本（供 AI 面板引用选中内容） */
const getSelectionText = () => {
  const ta = textareaRef.value
  if (!ta) return ''
  return ta.value.slice(ta.selectionStart, ta.selectionEnd)
}

/* ========== 选中文本后的"问 AI"浮动按钮 ========== */
const askAiVisible = ref(false)
const askAiX = ref(0)
const askAiY = ref(0)
let askAiTimer: ReturnType<typeof setTimeout> | undefined
/** 最近一次"查找跳转"的时间：跳转会选中匹配文本，此时不应弹出浮动按钮 */
let lastFindJumpAt = 0
/** 查找跳转后抑制浮动按钮的时间窗（覆盖关闭查找栏后继续按 F3 的场景） */
const FIND_JUMP_SUPPRESS_MS = 500
const onFindJump = () => {
  lastFindJumpAt = performance.now()
}

/** 延迟刷新按钮（选区在事件处理时可能尚未更新） */
function scheduleAskAi() {
  clearTimeout(askAiTimer)
  askAiTimer = setTimeout(updateAskAi, 10)
}

/** 根据当前源码区选区更新浮动按钮的显示与位置 */
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
  const ta = textareaRef.value
  const text = getSelectionText()
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
  const text = getSelectionText()
  askAiVisible.value = false
  if (text.trim()) emit('ask-ai', text)
}

/** 点击"生成图表"：把选中文本作为图表描述交给父组件 */
function onGenerateDiagramClick() {
  const text = getSelectionText()
  askAiVisible.value = false
  if (text.trim()) emit('generate-diagram', text)
}

/* ========== 预览右键菜单：图片 / 图表另存为 ========== */
interface PreviewMenuItem {
  label: string
  action: () => void
}

const previewMenu = ref<{ visible: boolean; x: number; y: number; items: PreviewMenuItem[] }>({
  visible: false,
  x: 0,
  y: 0,
  items: [],
})

/** 显示右键菜单（限制在视口内） */
function showPreviewMenu(e: MouseEvent, items: PreviewMenuItem[]) {
  const menuW = 190
  const menuH = items.length * 34 + 8
  previewMenu.value = {
    visible: true,
    x: Math.min(e.clientX, window.innerWidth - menuW - 8),
    y: Math.min(e.clientY, window.innerHeight - menuH - 8),
    items,
  }
}

function closePreviewMenu() {
  previewMenu.value.visible = false
}

/** 预览右键：图片 -> 另存为；Mermaid/其他 SVG -> PNG；Chart canvas -> PNG */
function onPreviewContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return
  const img = target.closest('img')
  if (img) {
    showPreviewMenu(e, [{ label: '图片另存为...', action: () => savePreviewImage(img) }])
    return
  }
  const svg = target.closest('svg')
  if (svg) {
    showPreviewMenu(e, [{ label: '保存为图片 (PNG)', action: () => saveSvgAsImage(svg) }])
    return
  }
  const canvas = target.closest('canvas')
  if (canvas) {
    showPreviewMenu(e, [{ label: '保存为图片 (PNG)', action: () => saveCanvasAsImage(canvas) }])
  }
}

/** 调起桌面端保存对话框写入图片文件 */
async function saveImageAs(payload: {
  source:
    | { type: 'local'; path: string }
    | { type: 'url'; url: string }
    | { type: 'data'; dataUrl: string }
  defaultName: string
}) {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面应用中可用')
    return
  }
  const res = await window.mdAPI.saveImageAs(payload)
  if (!res) return
  if (res.canceled) return
  if (res.ok === false && res.error) {
    ElMessage.error(`保存失败：${res.error}`)
    return
  }
  // 保存成功后通知父组件：若文件落在已打开目录内，静默刷新目录树使其即时显示
  if (res.filePath) emit('file-saved', res.filePath)
  ElMessage.success(`已保存到 ${res.filePath || ''}`)
}

/** 预览中的图片另存为（本地文件 / 远程 URL / data URL 均可） */
async function savePreviewImage(img: HTMLImageElement) {
  const src = img.currentSrc || img.src || ''
  const fallbackName = basename(img.getAttribute('src') || '') || basename(src) || 'image'
  const defaultName = /\.\w+$/.test(fallbackName) ? fallbackName : `${fallbackName}.png`
  if (/^mdlocal:/i.test(src)) {
    const localPath = fromMdLocalUrl(src)
    if (localPath) {
      await saveImageAs({ source: { type: 'local', path: localPath }, defaultName })
      return
    }
  }
  if (/^https?:/i.test(src)) {
    await saveImageAs({ source: { type: 'url', url: src }, defaultName })
    return
  }
  if (/^data:/i.test(src)) {
    await saveImageAs({ source: { type: 'data', dataUrl: src }, defaultName })
    return
  }
  ElMessage.warning('无法定位该图片的保存来源')
}

/** 将 SVG（Mermaid / 其他内联 SVG）转 PNG 后另存 */
function saveSvgAsImage(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || svg.viewBox?.baseVal?.width || 800))
  const height = Math.max(1, Math.round(rect.height || svg.viewBox?.baseVal?.height || 600))
  const xml = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    saveImageAs({ source: { type: 'data', dataUrl: canvas.toDataURL('image/png') }, defaultName: 'diagram.png' })
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    ElMessage.error('图表保存失败：无法转换 SVG')
  }
  image.src = url
}

/** Chart.js canvas 直接导出 PNG 另存 */
async function saveCanvasAsImage(canvas: HTMLCanvasElement) {
  let dataUrl = ''
  try {
    dataUrl = canvas.toDataURL('image/png')
  } catch {
    ElMessage.error('图表保存失败：无法导出')
    return
  }
  if (dataUrl) await saveImageAs({ source: { type: 'data', dataUrl }, defaultName: 'chart.png' })
}

defineExpose({
  focus: () => textareaRef.value?.focus(),
  getSelectionText,
  /** 用给定文本替换当前选区（无选区时插入到光标处），用于 AI 结果回填 */
  replaceSelection: insertMarkdown,
  undo: () => history.undo(),
  redo: () => history.redo(),
  pushHistory: () => history.push(true),
  resetHistory: () => history.reset(),
})
</script>

<style scoped>
.md-editor {
  display: flex;
  flex-direction: column;
  background: var(--bg-color-page);
  overflow: hidden;
  border: 1px solid var(--border-color-light);
  border-radius: 6px;
}

/* 编辑器主体 */
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
  position: relative;
}

.pane-tools .el-button {
  font-size: 12px;
  color: var(--text-color-regular);
  flex-shrink: 0;
}

/* 移除 Element Plus 按钮默认的相邻左外边距，避免工具栏间距不可控 */
.pane-tools .el-button + .el-button {
  margin-left: 0;
}

/* "更多"下拉按钮不允许收缩 */
.pane-tools .more-dropdown {
  flex-shrink: 0;
  display: inline-flex;
}

/* 溢出隐藏的按钮 */
.pane-tools .el-button.is-hidden {
  display: none;
}

.more-btn {
  display: inline-flex;
  align-items: center;
}

/* 额外工具区（如放大按钮），始终可见 */
.pane-extra {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.pane-extra .el-button {
  font-size: 12px;
  color: var(--text-color-regular);
}

/* ========== 预览区目录导航 ========== */
/* 目录面板基于预览区定位 */
.preview-pane {
  position: relative;
}

/* 目录按钮推到标题栏右侧 */
.pane-extra-right {
  margin-left: auto;
}

/* 复制 / 缩放之间的分隔线 */
.preview-extra-divider {
  height: 14px;
  margin: 0 4px;
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

.toc-toggle-btn {
  font-size: 15px !important;
  color: var(--text-color-secondary) !important;
  transition: color 0.2s;
}

.toc-toggle-btn.is-active {
  color: var(--color-primary) !important;
}

/* 目录面板：浮动于预览区右上角 */
.toc-panel {
  position: absolute;
  top: 48px;
  right: 12px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 260px;
  max-width: calc(100% - 24px);
  max-height: min(420px, calc(100% - 64px));
  background: var(--bg-color-white);
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.toc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color-lighter);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-regular);
}

.toc-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toc-panel-close {
  font-size: 14px;
  color: var(--text-color-secondary);
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.toc-item {
  padding: 5px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color-regular);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.2s, color 0.2s;
}

.toc-item:hover {
  background: var(--bg-color-page);
  color: var(--color-primary);
}

.toc-item.is-active {
  background: var(--color-primary-light-9);
  color: var(--color-primary);
  font-weight: 600;
}

/* 按标题层级缩进 */
.toc-item.toc-level-1 {
  padding-left: 10px;
  font-weight: 600;
}

.toc-item.toc-level-2 {
  padding-left: 22px;
}

.toc-item.toc-level-3 {
  padding-left: 34px;
}

.toc-item.toc-level-4 {
  padding-left: 46px;
}

.toc-item.toc-level-5 {
  padding-left: 58px;
}

.toc-item.toc-level-6 {
  padding-left: 70px;
}

.toc-empty {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-color-placeholder);
}

/* 源码编辑区 */
.source-textarea {
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
  background: var(--bg-color-white);
  tab-size: 2;
}

/* 明亮模式下编辑区底色取自「设置 → 外观 → 编辑区底色」（默认浅灰，与白板一致），深色模式保持原样 */
html:not(.dark) .source-pane,
html:not(.dark) .source-textarea {
  background: var(--md-editor-bg, var(--bg-color-page));
}

.source-textarea:focus {
  outline: none;
}

/* 粘贴图片时的上传中提示：贴在粘贴位置，不遮挡编辑交互 */
.paste-loading {
  position: absolute;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  padding: 1px 10px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: var(--text-color-primary);
  background: var(--bg-color-white);
  border: 1px solid var(--color-primary-light-5);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transform: translateY(-50%);
  pointer-events: none;
}

.paste-loading .el-icon {
  color: var(--color-primary);
  font-size: 13px;
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

/* 预览右键菜单（teleport 到 body，fixed 定位） */
.preview-ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.preview-ctx-menu {
  position: fixed;
  min-width: 170px;
  padding: 4px;
  background: var(--bg-color-white);
  border: 1px solid var(--border-color-light);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  user-select: none;
}

.preview-ctx-item {
  padding: 7px 12px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-color-regular);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.preview-ctx-item:hover {
  background: var(--color-primary-light-9);
  color: var(--color-primary);
}

/* PlantUML 图表 */
.markdown-body :deep(.plantuml-container) {
  margin: 16px 0;
  padding: 16px;
  background: #fafafa;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  text-align: center;
  overflow-x: auto;
}

.markdown-body :deep(.plantuml-container .plantuml-img) {
  display: inline-block;
  max-width: 100%;
  border-radius: 4px;
}

.markdown-body :deep(.plantuml-container .plantuml-error) {
  color: #f56c6c;
  font-size: 13px;
  padding: 12px;
}

/* 预览区 */
.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  font-family: var(--md-preview-font, 'Segoe UI', 'Microsoft YaHei', sans-serif);
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-color-primary);
}

/* Markdown 渲染样式 */
.markdown-body :deep(h1) {
  font-size: 28px;
  font-weight: 700;
  margin: 24px 0 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--border-color-light);
}

.markdown-body :deep(h2) {
  font-size: 22px;
  font-weight: 600;
  margin: 20px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color-lighter);
}

.markdown-body :deep(h3) {
  font-size: 18px;
  font-weight: 600;
  margin: 16px 0 10px;
}

.markdown-body :deep(h4) {
  font-size: 16px;
  font-weight: 600;
  margin: 14px 0 8px;
}

.markdown-body :deep(p) {
  margin: 8px 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--color-primary);
  background: var(--color-primary-light-9);
  color: var(--text-color-secondary);
  border-radius: 0 4px 4px 0;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  background: var(--md-inline-code-bg);
  border-radius: 3px;
  color: #e6a23c;
}

.markdown-body :deep(pre) {
  margin: 12px 0;
  padding: 16px;
  background: #1e1e1e;
  border-radius: 8px;
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.6;
}

.markdown-body :deep(table) {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border-color-light);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--bg-color-page);
  font-weight: 600;
}

.markdown-body :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-body :deep(.md-figure) {
  margin: 16px 0;
  text-align: center;
}
.markdown-body :deep(.md-figure img) {
  display: inline-block;
  border-radius: 8px;
}
.markdown-body :deep(.md-figcaption) {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-color-secondary);
  text-align: center;
  line-height: 1.6;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 2px solid var(--border-color-light);
  margin: 20px 0;
}

/* ========== Markdown 扩展样式（代码块复制按钮 / Mermaid / Chart / 提示块 / 数学公式） ========== */
.markdown-body :deep(.code-block-wrapper) {
  margin: 12px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--code-border, #383838);
}
.markdown-body :deep(.code-block-wrapper .code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--code-header-bg, #2d2d2d);
  border-bottom: 1px solid var(--code-border, #383838);
}
.markdown-body :deep(.code-block-wrapper .code-lang) {
  font-size: 12px;
  color: var(--code-lang-color, #999);
  font-family: 'Consolas', monospace;
  text-transform: lowercase;
}
.markdown-body :deep(.code-copy-btn) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--code-btn-border, #444);
  border-radius: 4px;
  background: transparent;
  color: var(--code-btn-color, #aaa);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.markdown-body :deep(.code-copy-btn:hover) {
  background: #3a3a3a;
  color: #fff;
  border-color: #555;
}
.markdown-body :deep(.code-copy-btn.copied) {
  color: #67c23a;
  border-color: #67c23a;
}
.markdown-body :deep(.code-copy-btn.copy-failed) {
  color: #f56c6c;
  border-color: #f56c6c;
}
.markdown-body :deep(.code-block-wrapper pre) {
  margin: 0;
  padding: 16px;
  background: var(--code-bg, #1e1e1e);
  border-radius: 0;
  overflow-x: auto;
}
.markdown-body :deep(.code-block-wrapper pre code) {
  padding: 0;
  background: transparent;
  color: var(--code-text, #d4d4d4);
  font-size: 13px;
  line-height: 1.6;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* 图表代码块复制按钮头部（Mermaid / PlantUML / Chart / 公式） */
.markdown-body :deep(.diagram-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  padding: 0 0 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color-light);
}

/* Mermaid 图表 */
.markdown-body :deep(.mermaid-container) {
  margin: 16px 0;
  padding: 16px;
  background: #fafafa;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  text-align: center;
  overflow-x: auto;
}
.markdown-body :deep(.mermaid-container .mermaid) {
  display: inline-block;
  min-width: 100%;
}

/* Chart.js 图表 */
.markdown-body :deep(.chart-container) {
  margin: 16px 0;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
}
.markdown-body :deep(.chart-container canvas) {
  max-width: 100% !important;
  height: 350px !important;
}

/* YAML Front Matter 卡片 */
.markdown-body :deep(.frontmatter-card) {
  margin: 16px 0;
  padding: 16px 20px;
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f7ff 100%);
  border: 1px solid #b3d8ff;
  border-left: 4px solid #409eff;
  border-radius: 8px;
}
.markdown-body :deep(.fm-title) {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color-primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.markdown-body :deep(.fm-emoji) {
  font-size: 24px;
}
.markdown-body :deep(.fm-meta) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-color-regular);
}
.markdown-body :deep(.fm-meta-item) {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 3px 12px;
  background: rgba(64, 158, 255, 0.06);
  border: 1px solid rgba(64, 158, 255, 0.15);
  border-radius: 6px;
}
.markdown-body :deep(.fm-tag) {
  display: inline-block;
  padding: 2px 10px;
  background: #409eff;
  color: #fff;
  font-size: 12px;
  border-radius: 10px;
}
.markdown-body :deep(.fm-desc) {
  font-size: 14px;
  color: var(--text-color-regular);
  line-height: 1.6;
}

/* GitHub Alert 提示块 */
.markdown-body :deep(.github-alert) {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  border-left: 4px solid;
}
.markdown-body :deep(.alert-header) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-weight: 600;
  font-size: 14px;
}
.markdown-body :deep(.alert-icon) {
  font-size: 16px;
}
.markdown-body :deep(.alert-body) {
  padding: 8px 16px 12px;
  font-size: 14px;
  line-height: 1.7;
}
.markdown-body :deep(.alert-body p) {
  margin: 4px 0;
}
.markdown-body :deep(.alert-body p:last-child) {
  margin-bottom: 0;
}
.markdown-body :deep(.alert-note) {
  background: #ecf5ff;
  border-color: #409eff;
}
.markdown-body :deep(.alert-note .alert-header) {
  color: #337ecc;
  background: rgba(64, 158, 255, 0.08);
}
.markdown-body :deep(.alert-tip) {
  background: #f0f9eb;
  border-color: #67c23a;
}
.markdown-body :deep(.alert-tip .alert-header) {
  color: #529b2e;
  background: rgba(103, 194, 58, 0.08);
}
.markdown-body :deep(.alert-important) {
  background: #f4f0fa;
  border-color: #9c27b0;
}
.markdown-body :deep(.alert-important .alert-header) {
  color: #7b1fa2;
  background: rgba(156, 39, 176, 0.08);
}
.markdown-body :deep(.alert-warning) {
  background: #fdf6ec;
  border-color: #e6a23c;
}
.markdown-body :deep(.alert-warning .alert-header) {
  color: #b88230;
  background: rgba(230, 162, 60, 0.08);
}
.markdown-body :deep(.alert-caution) {
  background: #fef0f0;
  border-color: #f56c6c;
}
.markdown-body :deep(.alert-caution .alert-header) {
  color: #c45656;
  background: rgba(245, 108, 108, 0.08);
}

/* 数学公式 */
.markdown-body :deep(.math-block) {
  margin: 16px 0;
  padding: 12px 16px;
  text-align: center;
  overflow-x: auto;
  background: #fafafa;
  border-radius: 6px;
}
.markdown-body :deep(.math-block .katex-display) {
  margin: 0;
}

/* 响应式 */
@media (max-width: 768px) {
  .editor-body {
    flex-direction: column;
  }

  .editor-pane {
    flex: none;
    height: 50%;
  }
}
</style>

<style>
/* 提示块类型圆点（下拉菜单 teleport 到 body，需全局样式） */
.alert-type-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}

/* "提示块"子菜单触发项 hover 时高亮 */
.admonition-sub .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.admonition-sub .el-dropdown-menu__item:hover {
  background-color: var(--el-dropdown-menuItem-hover-fill, #f5f7fa);
}
</style>

<!-- 表情选择面板：popover 传送至 body，须用非 scoped 样式 -->
<style>
.emoji-trigger {
  flex-shrink: 0;
}

.emoji-picker-popover.el-popover {
  padding: 8px;
}

.emoji-picker__cats {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 6px;
}

.emoji-picker__cat {
  border: none;
  background: transparent;
  font-size: 12px;
  line-height: 1;
  color: var(--text-color-secondary, #909399);
  padding: 4px 8px;
  border-radius: 10px;
  cursor: pointer;
}

.emoji-picker__cat:hover {
  background: var(--el-fill-color, #f5f7fa);
}

.emoji-picker__cat.is-active {
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
}

.emoji-picker__grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  max-height: 236px;
  overflow-y: auto;
}

.emoji-picker__item {
  border: none;
  background: transparent;
  font-size: 19px;
  line-height: 1;
  padding: 5px 0;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
}

.emoji-picker__item:hover {
  background: var(--el-fill-color, #f5f7fa);
}
</style>
