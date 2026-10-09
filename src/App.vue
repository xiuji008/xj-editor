<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox, ElTree } from 'element-plus'
import {
  Plus,
  FolderOpened,
  Folder,
  Document,
  Check,
  CopyDocument,
  Download,
  Edit,
  View,
  Files,
  Refresh,
  Fold,
  Expand,
  Delete,
  DocumentAdd,
  FolderAdd,
  MagicStick,
  Setting,
  Tickets,
  Notebook,
  Clock,
  Close,
  RefreshLeft,
  Hide,
  ArrowDown,
  ArrowRight,
  Postcard,
  Monitor,
} from '@element-plus/icons-vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import HtmlEditor from './components/HtmlEditor.vue'
import JsonEditor from './components/JsonEditor.vue'
import TextEditor from './components/TextEditor.vue'
import FilePreview from './components/FilePreview.vue'
import AiPanel from './components/AiPanel.vue'
import AiChatWindow from './components/AiChatWindow.vue'
import AiLogDialog from './components/AiLogDialog.vue'
import SettingsDialog from './components/settings/SettingsDialog.vue'
import GitPanel from './components/GitPanel.vue'
import GitDiffDialog from './components/GitDiffDialog.vue'
import GitHistoryDialog from './components/GitHistoryDialog.vue'
import GitCloneDialog from './components/GitCloneDialog.vue'
import GitIcon from './components/GitIcon.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import TerminalIcon from './components/TerminalIcon.vue'
import { provideToolContext, ToolLauncher } from './tools'
import {
  buildGitBadgeMap,
  gitPathKey,
  gitStatusMeta,
  isInsideRepo,
  joinPath,
  relPathOf,
  type GitBadge,
} from './utils/git'
import { getImageHostingConfig } from './utils/imageHosting'
import { buildOutlineBlock } from './utils/ai'
import {
  CODE_THEMES,
  DEFAULT_CODE_THEME,
  renderMarkdown,
  getMarkdownExtensionStyles,
  buildMetadataBlock,
  updateMetadataLastUpdate,
  getFrontMatterTitle,
  setFrontMatterTitle,
} from './utils/markdown'
import { applyAiMetadata } from './utils/metadata'
import { basename, dirname, extname, classifyFile, type FileKind } from './utils/fileUtils'
import FileIcon from './components/FileIcon.vue'
import { vOverflowTip } from './utils/overflowTip'
import katexCss from 'katex/dist/katex.min.css?inline'

/* ========== 文件状态 ========== */
const content = ref('')
const currentPath = ref('')
const isDirty = ref(false)
const fileType = ref<FileKind>('markdown')
/** 右侧是否已打开文件：切换目录后关闭编辑器时置为 false，避免残留上一个目录的文件 */
const fileOpened = ref(true)
/* ========== 窗口身份与每窗口存储（多窗口：状态互不覆盖） ========== */
/** 当前窗口 id（主进程分配，首个主窗口为 1；纯浏览器环境为 0） */
const winId = window.mdAPI?.windowId || 0
/**
 * 持久化槽位号：跨重启稳定，重启恢复窗口时沿用同一个槽位，
 * 保证目录 / 展开项 / 布局等本窗口状态不会因窗口 id 重排而串位。
 */
const slotId = window.mdAPI?.windowInit?.slot || winId || 0
/** 每窗口隔离的存储：sessionStorage 按窗口独立，承载布局 / 面板这类不该跨窗口共享的状态 */
const winStore: Storage = typeof sessionStorage === 'object' && sessionStorage ? sessionStorage : localStorage

/* ========== 外观设置（在「设置」中调整，记忆上次选择） ========== */
const CODE_THEME_KEY = 'md-code-theme'
const VIEW_MODE_KEY = 'md-view-mode'
type ViewMode = 'edit' | 'split' | 'preview'

/** 代码高亮主题：优先取上次设置的值，值失效时回退默认主题 */
const savedTheme = localStorage.getItem(CODE_THEME_KEY)
const codeTheme = ref<string>(
  CODE_THEMES.some((t) => t.name === savedTheme) ? (savedTheme as string) : DEFAULT_CODE_THEME,
)
/** 视图模式：编辑 / 分屏 / 预览 */
const savedViewMode = localStorage.getItem(VIEW_MODE_KEY)
const viewMode = ref<ViewMode>(
  savedViewMode === 'edit' || savedViewMode === 'split' || savedViewMode === 'preview'
    ? savedViewMode
    : 'split',
)

watch(codeTheme, (value) => localStorage.setItem(CODE_THEME_KEY, value))
watch(viewMode, (value) => localStorage.setItem(VIEW_MODE_KEY, value))

/**
 * 右侧实际展示的内容类型。
 * 未打开任何文件时为 'none'，用于展示空状态，而不是继续渲染上一个文件的编辑器。
 */
const activeFileType = computed<FileKind | 'none'>(() => (fileOpened.value ? fileType.value : 'none'))

/* ========== 目录浏览状态 ========== */
const openedDir = ref('')
const showSidebar = ref(false)
const treeKey = ref(0)
const treeRef = ref<InstanceType<typeof ElTree> | null>(null)
/** 文件复制剪贴板（目录树 Ctrl+C 复制 / Ctrl+V 粘贴） */
const clipNode = ref<{ path: string; name: string; isDirectory: boolean } | null>(null)

/* ========== 目录树状态记忆（按窗口隔离，重启后恢复本窗口上次打开的目录树） ========== */
/** 本窗口工作区记忆键：目录 / 展开项 / 侧边栏显隐，按持久化槽位分槽保存，互不覆盖 */
const WS_KEY = `md-ws-${slotId || 0}`
/** 旧版本遗留的全局键（升级后仅用于一次性兜底读取，仅首个窗口使用） */
const LEGACY_DIR_KEY = 'md-last-dir'
const LEGACY_EXPANDED_KEY = 'md-last-expanded'
/** 当前展开的目录路径集合（规范化斜杠），用于记忆展开状态 */
const expandedDirs = ref<Set<string>>(new Set())

/**
 * 读取本窗口的工作区记忆
 * @returns {{dir?: string, expanded?: string[], sidebar?: string}} 记忆内容
 */
function readWorkspace(): { dir?: string; expanded?: string[]; sidebar?: string } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WS_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as { dir?: string; expanded?: string[]; sidebar?: string }) : {}
  } catch {
    return {}
  }
}

/**
 * 增量写入本窗口的工作区记忆
 * @param {Record<string, unknown>} patch 待合并的字段
 */
function patchWorkspace(patch: Record<string, unknown>) {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify({ ...readWorkspace(), ...patch }))
  } catch {
    /* 存储不可用时忽略，不影响编辑 */
  }
}

/** 清除本窗口的工作区记忆（进入单文件模式 / 目录失效时调用） */
function clearWorkspace() {
  localStorage.removeItem(WS_KEY)
}

/** 记忆上次打开的目录路径 */
function saveLastDir(dir: string) {
  patchWorkspace({ dir })
}

/** 记忆侧边栏显隐（仅在已打开目录或文件时记录） */
function saveLastSidebar(visible: boolean) {
  if (!openedDir.value && !currentPath.value) return
  patchWorkspace({ sidebar: visible ? '1' : '0' })
}

/** 记忆当前展开的目录集合 */
function saveLastExpanded() {
  patchWorkspace({ expanded: [...expandedDirs.value] })
}

/** 切换为新目录时清空旧的展开记忆 */
function resetExpandedMemory() {
  expandedDirs.value = new Set()
  saveLastExpanded()
}

/* ========== 最近打开的目录（侧边栏内快速切换） ========== */
const RECENT_DIRS_KEY = 'md-recent-dirs'
/** 最近目录最多保留的条数 */
const RECENT_DIRS_MAX = 12
const recentDirs = ref<string[]>([])

/** 读取最近打开的目录列表 */
function loadRecentDirs() {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_DIRS_KEY) || '[]')
    recentDirs.value = (Array.isArray(list) ? list : []).filter(
      (p): p is string => typeof p === 'string' && !!p.trim(),
    )
  } catch {
    recentDirs.value = []
  }
}

/** 持久化最近打开的目录列表 */
function saveRecentDirs() {
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(recentDirs.value))
}

/** 记录最近打开的目录：同路径去重后置顶，超出上限丢弃最旧的 */
function pushRecentDir(dir: string) {
  if (!dir) return
  // 多窗口下先合并其它窗口写入的最近目录，避免整表覆盖导致条目丢失
  loadRecentDirs()
  const key = normPath(dir)
  recentDirs.value = [dir, ...recentDirs.value.filter((p) => normPath(p) !== key)].slice(0, RECENT_DIRS_MAX)
  saveRecentDirs()
}

/** 从最近打开的目录列表中移除 */
function removeRecentDir(dir: string) {
  const key = normPath(dir)
  recentDirs.value = recentDirs.value.filter((p) => normPath(p) !== key)
  saveRecentDirs()
}

/* ========== 最近打开目录面板的展开 / 收起（默认展开，记忆用户设置） ========== */
const RECENT_COLLAPSED_KEY = 'md-recent-collapsed'
const recentCollapsed = ref(winStore.getItem(RECENT_COLLAPSED_KEY) === '1')

/** 切换「最近打开的目录」面板的展开 / 收起状态并记忆 */
function toggleRecentCollapsed() {
  recentCollapsed.value = !recentCollapsed.value
  winStore.setItem(RECENT_COLLAPSED_KEY, recentCollapsed.value ? '1' : '0')
}

/** 判断指定文件是否位于目录内（含子目录），用于切换目录时决定是否需要关闭当前文件 */
function isInsideDir(filePath: string, dir: string): boolean {
  if (!filePath || !dir) return false
  const file = normPath(filePath)
  const base = normPath(dir).replace(/\/+$/, '')
  return file === base || file.startsWith(base + '/')
}

/**
 * 关闭右侧编辑器 / 预览：清空当前文件的内容与路径，回到空状态。
 * 切换目录时调用，避免右侧继续展示上一个目录中的文件。
 */
function closeFile() {
  // 关闭前把暂存区挂起的修改落盘，避免丢失
  flushScratchSave()
  // 编辑器卸载前清空撤销 / 重做历史，避免下次打开文件时误撤销到旧内容
  markdownEditorRef.value?.resetHistory?.()
  htmlEditorRef.value?.resetHistory?.()
  jsonEditorRef.value?.resetHistory?.()
  textEditorRef.value?.resetHistory?.()
  suppressDirty = true
  content.value = ''
  currentPath.value = ''
  fileType.value = 'markdown'
  isDirty.value = false
  fileOpened.value = false
  suppressDirty = false
  updateTitle()
  syncTreeCurrent()
}

/**
 * 切换目录前的收尾：当前文件不在新目录内时，先确认未保存的修改再关闭编辑器。
 * 返回 false 表示用户取消了切换。
 */
async function beforeSwitchDir(dir: string): Promise<boolean> {
  // 当前文件仍在新目录内：保留打开状态，仅切换目录树
  if (isInsideDir(currentPath.value, dir)) return true
  if (!(await guardDirty())) return false
  closeFile()
  return true
}

/**
 * 直接打开指定目录（不弹系统选择框）：
 * 先校验目录是否仍然可读，再把目录树切换过去，并记录到最近列表。
 */
async function openDirByPath(dir: string) {
  if (!dir || !window.mdAPI) return
  const res = await window.mdAPI.readDir(dir)
  if (!res?.ok) {
    removeRecentDir(dir)
    ElMessage.warning(`目录不可用：${res?.error || '目录不存在'}`)
    return
  }
  if (!(await beforeSwitchDir(dir))) return
  openedDir.value = dir
  showSidebar.value = true
  treeKey.value++
  pushRecentDir(dir)
  // 记忆本次打开的目录，下次启动时自动恢复
  saveLastDir(dir)
  saveLastSidebar(true)
  resetExpandedMemory()
}

/** 单文件模式下：把当前文件所在目录打开到目录树中 */
function openCurrentFileDir() {
  const dir = currentPath.value ? dirname(currentPath.value) : ''
  if (dir) openDirByPath(dir)
}

/* ========== 单文件模式（只展示当前打开的文件） ========== */

/** 未打开目录但已打开文件：目录树中仅展示该文件，不展开其所在目录 */
const isSingleFileMode = computed(() => !openedDir.value && !!currentPath.value)

/** 侧边栏是否有内容可展示（目录树 / 单文件 / 最近目录） */
const hasSidebarContent = computed(
  () => !!openedDir.value || !!currentPath.value || recentDirs.value.length > 0,
)

/** 侧边栏标题：目录名 / 文件名 / 最近目录占位 */
const sidebarTitle = computed(() => {
  if (openedDir.value) return basename(openedDir.value) || openedDir.value
  if (currentPath.value) return fileName.value
  return '最近打开的目录'
})

/** 侧边栏标题悬浮提示：完整路径 */
const sidebarTitleTip = computed(() => openedDir.value || currentPath.value || '')

/**
 * 进入单文件模式：清空左侧目录树与其记忆，仅展示当前打开的文件。
 * 用于「打开文件」「外部打开」「打开暂存区」等单文件入口。
 */
function enterSingleFileMode() {
  openedDir.value = ''
  expandedDirs.value = new Set()
  // 清除本窗口的目录记忆，避免下次启动又恢复成整棵目录树
  clearWorkspace()
  showSidebar.value = true
  treeKey.value++
  syncTreeCurrent()
}

/** 单文件模式下当前文件路径变化（新建 / 重命名 / 删除）后重建目录树 */
function refreshSingleFileTree() {
  if (!openedDir.value) treeKey.value++
}

/* ========== 侧边栏宽度（支持拖动调整，记忆用户设置） ========== */
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const sidebarWidth = ref(Number(winStore.getItem('md-sidebar-width')) || 260)
let sidebarResizing = false
let sidebarStartX = 0
let sidebarStartWidth = 0

const clampSidebarWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))

function onSidebarResizeStart(e: MouseEvent) {
  e.preventDefault()
  sidebarResizing = true
  sidebarStartX = e.clientX
  sidebarStartWidth = sidebarWidth.value
  document.body.classList.add('sidebar-resizing')
  window.addEventListener('mousemove', onSidebarResizeMove)
  window.addEventListener('mouseup', onSidebarResizeEnd)
}

function onSidebarResizeMove(e: MouseEvent) {
  if (!sidebarResizing) return
  sidebarWidth.value = clampSidebarWidth(sidebarStartWidth + (e.clientX - sidebarStartX))
}

function onSidebarResizeEnd() {
  if (!sidebarResizing) return
  sidebarResizing = false
  document.body.classList.remove('sidebar-resizing')
  window.removeEventListener('mousemove', onSidebarResizeMove)
  window.removeEventListener('mouseup', onSidebarResizeEnd)
  winStore.setItem('md-sidebar-width', String(sidebarWidth.value))
}

/** 应用图片存储目录（userData/images），供 Markdown 预览解析 images/xxx 图片 */
const appImagesDir = ref('')

/** 内置暂存文件路径（安装目录或应用数据目录下，不在左侧目录树中展示） */
const scratchPath = ref('')
/** 当前打开的是否为内置暂存文件 */
const isScratchFile = computed(() => !!scratchPath.value && currentPath.value === scratchPath.value)

let suppressDirty = false

/** 暂存区按钮提示（附带文件路径，便于用户找到该文件） */
const scratchTip = computed(() => {
  const base = '暂存区：打开内置临时文件，用于拷贝 / 暂存信息（Ctrl+Shift+T）'
  return scratchPath.value ? `${base}\n${scratchPath.value}` : base
})

const fileName = computed(() => {
  if (currentPath.value) {
    const parts = currentPath.value.split(/[\\/]/)
    return parts[parts.length - 1] || '未命名.md'
  }
  return '未命名.md'
})

/** 当前打开的文件是否可编辑保存（markdown / html / json / 文本） */
const canSave = computed(
  () =>
    fileOpened.value &&
    (!currentPath.value ||
      fileType.value === 'markdown' ||
      fileType.value === 'html' ||
      fileType.value === 'json' ||
      fileType.value === 'text'),
)

const wordCount = computed(() => {
  const text = content.value
  const cjk = text.match(/[\u4e00-\u9fa5]/g)?.length || 0
  const words = text
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return cjk + words
})

const lineCount = computed(() => (content.value ? content.value.split('\n').length : 0))

const editorViewMode = computed(() => viewMode.value === 'preview')
const wrapperClass = computed(() => `view-${viewMode.value}`)

/** 当前文件所在目录，用于 Markdown 本地图片的相对路径解析 */
const currentDir = computed(() => (currentPath.value ? dirname(currentPath.value) : ''))

watch(
  content,
  () => {
    if (suppressDirty) return
    isDirty.value = true
    updateTitle()
  },
  { flush: 'sync' }
)

// 暂存区：内容变化后触发自动保存（写盘在 scheduleScratchSave 中防抖执行）
watch(content, () => {
  if (suppressDirty) return
  scheduleScratchSave()
})

function updateTitle() {
  const mark = isDirty.value ? '● ' : ''
  const title = `${mark}${fileName.value} - Markdown 编辑器`
  window.mdAPI?.setWindowTitle(title)
  window.mdAPI?.setModified(isDirty.value)
}

/**
 * 上报窗口上下文（当前文件 / 目录 / 是否有未保存修改）：
 * 主进程据此把外部打开的文件路由到正确窗口，并在关闭窗口前决定是否拦截确认。
 */
let lastContextKey = ''
watch([currentPath, openedDir, isDirty], () => {
  // 仅在文件 / 目录 / 脏标记真正变化时上报，避免每次输入都发 IPC
  const key = `${currentPath.value}|${openedDir.value}|${isDirty.value}`
  if (key === lastContextKey) return
  lastContextKey = key
  window.mdAPI?.setWindowContext({
    filePath: currentPath.value,
    dirPath: openedDir.value,
    dirty: isDirty.value,
  })
})

/**
 * 同一文件在另一个窗口已打开：提示用户是否切换过去。
 * 两个窗口同时编辑同一文件时，后保存者会覆盖前者，因此出现即提示。
 * @param {string} filePath 冲突文件路径
 */
async function handleFileConflict(filePath: string) {
  try {
    await ElMessageBox.confirm(
      '该文件已在另一个窗口打开，两边同时保存会互相覆盖。是否切换到那个窗口？',
      '文件已在其它窗口打开',
      { type: 'warning', confirmButtonText: '切换过去', cancelButtonText: '留在当前窗口', closeOnClickModal: false },
    )
    await window.mdAPI?.focusFile(filePath)
  } catch {
    /* 用户选择留在当前窗口 */
  }
}

/**
 * 关闭 / 退出确认：主进程在窗口有未保存修改时拦截并回调这里，
 * 由用户选择保存 / 放弃 / 取消，再把结果回给主进程。
 * @param {{quitting?: boolean, remaining?: number}} payload 确认上下文：是否退出应用、还剩几个窗口待处理
 */
let closingWindow = false
async function handleCloseRequest(payload: { quitting?: boolean; remaining?: number } = {}) {
  if (closingWindow) return
  closingWindow = true
  // 退出应用时可能有多个窗口依次确认，提示里说明还剩几个，避免用户以为是关单个窗口
  const quitting = !!payload.quitting
  const rest = Math.max(0, (payload.remaining ?? 1) - 1)
  const text = quitting
    ? rest > 0
      ? `当前文件有未保存的修改，是否保存后再退出？（还有 ${rest} 个窗口待处理）`
      : '当前文件有未保存的修改，是否保存后再退出？'
    : '当前文件有未保存的修改，是否保存后再关闭窗口？'
  try {
    await ElMessageBox.confirm(text, quitting ? '退出应用' : '关闭窗口', {
      type: 'warning',
      confirmButtonText: '保存',
      cancelButtonText: '放弃修改',
      distinguishCancelAndClose: true,
      closeOnClickModal: false,
    })
    await saveFile()
    // 保存被取消（如另存为弹窗放弃）时保持窗口打开
    window.mdAPI?.replyWindowClose(isDirty.value ? 'cancel' : 'save')
  } catch (action) {
    // cancel=放弃修改，close=取消关闭（点 X / 遮罩）
    window.mdAPI?.replyWindowClose(action === 'cancel' ? 'discard' : 'cancel')
  } finally {
    closingWindow = false
  }
}

/* ========== 文件操作 ========== */

/** 确认放弃未保存的修改 */
async function guardDirty(): Promise<boolean> {
  if (!isDirty.value) return true
  try {
    await ElMessageBox.confirm('当前文件有未保存的修改，是否放弃？', '提示', {
      type: 'warning',
      confirmButtonText: '放弃修改',
      cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}

/** 读取并加载指定路径文件（按扩展名分派到编辑器 / 预览器） */
let loadToken = 0
async function loadFile(filePath: string) {
  const token = ++loadToken
  if (!window.mdAPI) return
  // 切换文件前：把暂存区尚未落盘的修改立即保存，避免丢失
  flushScratchSave()
  const res = await window.mdAPI.readFile(filePath)
  // 加载期间用户又切换了文件，丢弃过期的读取结果
  if (token !== loadToken) return
  if (!res.ok) {
    ElMessage.error(`打开文件失败：${res.error || '未知错误'}`)
    return
  }
  const kind = classifyFile(filePath, !!res.isText)
  suppressDirty = true
  currentPath.value = filePath
  fileType.value = kind
  fileOpened.value = true
  if (kind === 'markdown' || kind === 'html' || kind === 'json' || kind === 'text') {
    content.value = res.content || ''
  } else {
    content.value = ''
  }
  suppressDirty = false
  isDirty.value = false
  updateTitle()
  syncTreeCurrent()
  // 记录加载时的磁盘修改时间，用于保存前检测是否被其它窗口 / 外部程序改过
  void refreshFileMtime()
  // 切换文件后清空编辑器的撤销/重做历史
  nextTick(() => {
    markdownEditorRef.value?.resetHistory?.()
    htmlEditorRef.value?.resetHistory?.()
    jsonEditorRef.value?.resetHistory?.()
    textEditorRef.value?.resetHistory?.()
  })
}

/** 当前文件加载 / 上次保存时的磁盘修改时间（毫秒），用于保存前检测外部改动 */
const fileMtime = ref(0)

/** 重新读取当前文件的磁盘修改时间（加载后、保存后各调用一次） */
async function refreshFileMtime() {
  if (!window.mdAPI || !currentPath.value) {
    fileMtime.value = 0
    return
  }
  const res = await window.mdAPI.statPath(currentPath.value)
  fileMtime.value = res?.ok ? Number(res.mtime) || 0 : 0
}

/**
 * 保存前检查磁盘文件是否被其它窗口 / 外部程序修改过，避免静默覆盖
 * @returns {Promise<boolean>} 可以继续保存返回 true，用户取消返回 false
 */
async function confirmOverwriteIfChanged() {
  if (!window.mdAPI || !currentPath.value || !fileMtime.value) return true
  const res = await window.mdAPI.statPath(currentPath.value)
  if (!res?.ok || !res.mtime) return true
  // 磁盘修改时间未变（仍是本窗口加载 / 上次保存的版本），可以安全保存
  if (res.mtime <= fileMtime.value) return true
  try {
    await ElMessageBox.confirm(
      '该文件在其它窗口或外部程序中已被修改，保存会覆盖那些修改。是否继续保存？',
      '文件已被修改',
      { type: 'warning', confirmButtonText: '覆盖保存', cancelButtonText: '取消', closeOnClickModal: false },
    )
    return true
  } catch {
    return false
  }
}

/** 同步目录树高亮为当前打开的文件 */
function syncTreeCurrent() {
  nextTick(() => {
    const key = currentPath.value || ''
    treeRef.value?.setCurrentKey(key)
    // lazy 树首层为异步加载，稍后重试一次以命中高亮（节点就绪后才会真正选中）
    window.setTimeout(() => treeRef.value?.setCurrentKey(key), 80)
  })
}

/**
 * 递归重新加载一个目录节点，并按刷新前记录的展开路径逐层恢复子目录。
 * 子目录重建后默认收起，这里在父目录加载完成后立即对子目录重新展开，
 * 从而保证任意深度的展开状态在刷新后都不丢失。
 */
function reloadTreeNode(node: any, expandedSet: Set<string>): Promise<void> {
  return new Promise<void>((resolve) => {
    node.loaded = false
    node.expand(() => {
      const childNodes: any[] = node.childNodes || []
      const chain: Promise<void>[] = []
      for (const child of childNodes) {
        if (child.isLeaf) continue
        const p = child.data?.path
        if (p && expandedSet.has(normPath(p))) chain.push(reloadTreeNode(child, expandedSet))
      }
      Promise.all(chain).then(() => resolve())
    })
  })
}

/**
 * 静默刷新目录树：
 * - dirPath 指定时只刷新该目录（重命名 / 新建 / 删除后局部刷新）
 * - 不传时刷新整棵树（含所有已展开的子目录）
 * 刷新全程保留展开状态与当前高亮，不会收起目录。
 */
/** 路径统一为斜杠形式，用于与树节点 key 比较（兼容 Windows 反斜杠 / 正斜杠） */
const normPath = (p: string) => p.replace(/\\/g, '/')

/**
 * 在节点表中按路径查找节点。
 * 树节点 key 来自主进程 path.join（Windows 下为反斜杠），而 dirname() 等返回正斜杠，
 * 因此不能直接用 nodesMap[dirPath] 精确索引，需逐节点规范化后比较。
 */
function findTreeNodeByPath(nodes: any[], path: string): any | null {
  const key = normPath(path)
  for (const node of nodes) {
    if (node.data?.path && normPath(node.data.path) === key) return node
  }
  return null
}

async function refreshTreeDir(dirPath?: string) {
  // 目录刷新通常意味着文件发生变化，顺带防抖刷新 Git 状态
  scheduleGitRefresh()
  const tree = treeRef.value
  if (!tree) return
  const store = (tree as any).store as { nodesMap: Record<string, any> } | null
  if (!store?.nodesMap) return
  const nodes: any[] = Object.values(store.nodesMap)
  // 记录当前展开的目录路径，刷新后逐层恢复
  const expandedSet = new Set<string>()
  for (const node of nodes) {
    if (node.expanded && node.data?.path) expandedSet.add(normPath(node.data.path))
  }
  // 根节点（打开的目录，level 1）
  let root: any
  for (const node of nodes) {
    if (node.level === 1 && !node.isLeaf) {
      root = node
      break
    }
  }
  const target = dirPath ? findTreeNodeByPath(nodes, dirPath) : root
  if (!target || target.isLeaf) return
  await reloadTreeNode(target, expandedSet)
  // 恢复当前高亮
  nextTick(() => {
    const key = currentPath.value
    if (key) tree.setCurrentKey(key)
  })
}

/**
 * 递归加载并展开目录树中处于目标集合的目录节点。
 * lazy 树子节点默认未加载，expand 会先触发异步加载，回调时子节点已就绪，
 * 从而逐层恢复上次的展开状态。
 */
function expandNodeByPath(node: any, targetSet: Set<string>): Promise<void> {
  return new Promise((resolve) => {
    if (node.isLeaf) {
      resolve()
      return
    }
    const finish = () => {
      const chain: Promise<void>[] = []
      for (const child of node.childNodes || []) {
        if (child.isLeaf) continue
        const p = child.data?.path
        if (p && targetSet.has(normPath(p))) chain.push(expandNodeByPath(child, targetSet))
      }
      Promise.all(chain).then(() => resolve())
    }
    if (node.loaded && node.childNodes.length) {
      if (node.expanded) finish()
      else node.expand(() => finish())
    } else {
      // 尚未加载（lazy）：标记后 expand 触发异步加载
      node.loaded = false
      node.expand(() => finish())
    }
  })
}

/** 目录树渲染完成后，恢复上次记忆的展开状态 */
async function restoreExpandedTree() {
  let tree = treeRef.value
  // 等待 v-if 渲染完成（lazy 树挂载后 treeRef 才可用）
  for (let i = 0; i < 50 && !tree; i++) {
    await new Promise((r) => setTimeout(r, 50))
    tree = treeRef.value
  }
  if (!tree || !expandedDirs.value.size) return
  const root = (tree as any).store.root
  await expandNodeByPath(root, expandedDirs.value)
}

/**
 * 启动时恢复上次关闭前打开的目录树（目录已不存在时清除记忆）。
 *
 * @param preferredDir 主进程会话保存的目录；为空时读取本窗口本地记忆
 * @returns 是否成功恢复目录
 */
async function restoreLastDir(preferredDir = ''): Promise<boolean> {
  // 按槽位读取记忆；旧版本升级上来时，仅首个窗口兜底读一次全局键
  const ws = readWorkspace()
  const legacyDir = slotId <= 1 ? localStorage.getItem(LEGACY_DIR_KEY) || '' : ''
  const rememberedDir = ws.dir || legacyDir
  const dir = preferredDir || rememberedDir
  if (!dir || !window.mdAPI) {
    // 上次以单文件模式退出（或未打开过目录）：有最近目录时展开侧边栏，便于快速打开
    if (recentDirs.value.length && ws.sidebar !== '0') {
      showSidebar.value = true
    }
    return false
  }
  const res = await window.mdAPI.readDir(dir)
  if (!res?.ok) {
    // 目录已被移动 / 删除：清除本窗口记忆，避免下次仍尝试恢复
    clearWorkspace()
    return false
  }
  // 仅当本地记忆与会话目录一致时恢复展开项，避免把其它目录的状态错误套用过来
  const sameRememberedDir = !!rememberedDir && normPath(rememberedDir) === normPath(dir)
  const legacyExpanded = (() => {
    try {
      const list: unknown = JSON.parse(localStorage.getItem(LEGACY_EXPANDED_KEY) || '[]')
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  })()
  const list: unknown[] = sameRememberedDir
    ? Array.isArray(ws.expanded)
      ? ws.expanded
      : legacyExpanded
    : []
  expandedDirs.value = new Set(list.filter((p): p is string => typeof p === 'string').map(normPath))
  openedDir.value = dir
  showSidebar.value = sameRememberedDir ? ws.sidebar !== '0' : true
  treeKey.value++
  // 主进程会话是目录恢复的权威来源，同时回填本地记忆以修复旧版本清空的数据
  saveLastDir(dir)
  await nextTick()
  await restoreExpandedTree()
  return true
}

/**
 * 插入 / 粘贴图片后静默刷新目录树：
 * 整树刷新会重建当前目录下新建的 images 文件夹，也会更新已展开目录的图片文件
 */
function onImagesInserted() {
  refreshTreeDir()
}

/**
 * 编辑器通过系统对话框另存出新文件（图片另存为 / SVG、Chart 导出 PNG）后：
 * 静默刷新文件所在目录，若不在已打开目录内则刷新为 no-op
 */
function onFileSavedExternally(filePath: string) {
  refreshTreeDir(dirname(filePath))
}

/** 打开文件（带未保存确认），供目录树点击 / 预览链接跳转使用 */
async function openFileByPath(filePath: string) {
  if (!(await guardDirty())) {
    // 用户取消切换：恢复目录树高亮到原文件，避免选中错乱
    syncTreeCurrent()
    return
  }
  await loadFile(filePath)
}

/* ========== 暂存区（内置临时文件，用于拷贝 / 暂存信息） ========== */

/** 获取暂存文件路径（文件被删除时由主进程自动重建） */
async function ensureScratchPath(): Promise<string> {
  if (!window.mdAPI) return ''
  const res = await window.mdAPI.getScratchFile()
  if (!res?.ok || !res.path) return ''
  scratchPath.value = res.path
  return res.path
}

/** 工具栏「暂存区」按钮：一键打开内置暂存文件 */
/**
 * 打开暂存区：暂存区是全局单文件，主进程保证同一时间只有一个窗口编辑它。
 * 已被其它窗口占用时，主进程会前置那个窗口，这里只做提示。
 */
async function openScratch() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  const res = await window.mdAPI.openScratchFile()
  if (!res?.ok || !res.path) {
    ElMessage.error('暂存文件不可用')
    return
  }
  scratchPath.value = res.path
  if (res.locked) {
    ElMessage.info('暂存区已在另一个窗口打开，已为你切换到该窗口')
    return
  }
  const filePath = res.path
  if (currentPath.value === filePath) {
    ElMessage.info('暂存区已打开')
    return
  }
  if (!(await guardDirty())) return
  await loadFile(filePath)
  // 暂存区是内置单文件：清空目录树，只展示该文件
  if (currentPath.value === filePath) enterSingleFileMode()
  ElMessage.success('已打开暂存区')
}

/** 清空暂存区内容（恢复为初始说明文档） */
async function clearScratch() {
  if (!isScratchFile.value) return
  try {
    await ElMessageBox.confirm('确定清空暂存区的全部内容吗？此操作不可恢复。', '清空暂存区', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  const res = await window.mdAPI?.clearScratchFile()
  if (!res?.ok) {
    ElMessage.error(`清空失败：${res?.error || '未知错误'}`)
    return
  }
  suppressDirty = true
  content.value = res.content || ''
  isDirty.value = false
  suppressDirty = false
  updateTitle()
  nextTick(() => {
    markdownEditorRef.value?.resetHistory?.()
  })
  ElMessage.success('暂存区已清空')
}

/** 暂存文件自动保存：停止输入 800ms 后写盘，切换 / 关闭无需手动保存 */
let scratchSaveTimer: number | null = null

/** 立即把暂存区挂起的自动保存落盘（切换文件 / 新建文件前调用） */
function flushScratchSave() {
  if (scratchSaveTimer === null) return
  clearTimeout(scratchSaveTimer)
  scratchSaveTimer = null
  if (!isScratchFile.value || !isDirty.value || !window.mdAPI) return
  const filePath = currentPath.value
  const text = content.value
  window.mdAPI
    .saveFile({ filePath, content: text })
    .then((res) => {
      // 保存期间可能已切换文件：仅当仍处于同一文件时才清除脏标记
      if (!res?.canceled && currentPath.value === filePath) {
        isDirty.value = false
        updateTitle()
      }
    })
    .catch(() => {
      /* 自动保存失败不影响继续编辑，用户可手动 Ctrl+S */
    })
}

function scheduleScratchSave() {
  if (!isScratchFile.value) return
  if (scratchSaveTimer !== null) clearTimeout(scratchSaveTimer)
  scratchSaveTimer = window.setTimeout(async () => {
    scratchSaveTimer = null
    // 防抖期间可能已切换到其他文件，或用户已手动保存
    if (!isScratchFile.value || !isDirty.value || !window.mdAPI) return
    try {
      // 直接写入当前内容：暂存区不刷新元数据，避免内容被反复改写
      const res = await window.mdAPI.saveFile({ filePath: currentPath.value, content: content.value })
      if (!res?.canceled) {
        isDirty.value = false
        updateTitle()
      }
    } catch {
      /* 自动保存失败不影响继续编辑，用户可手动 Ctrl+S */
    }
  }, 800)
}

async function newFile() {
  if (!(await guardDirty())) return
  // 新建前先落盘暂存区的挂起修改
  flushScratchSave()
  suppressDirty = true
  // 新建文件时初始化元数据块（title 占位为"未命名"，另存为时按文件名自动补全）
  content.value = buildMetadataBlock({ title: '未命名' })
  currentPath.value = ''
  fileType.value = 'markdown'
  fileOpened.value = true
  isDirty.value = false
  suppressDirty = false
  updateTitle()
  // 新建文件无路径：单文件模式下清空目录树中的旧文件节点
  refreshSingleFileTree()
  // 新建文件后清空编辑器的撤销/重做历史
  nextTick(() => {
    markdownEditorRef.value?.resetHistory?.()
    htmlEditorRef.value?.resetHistory?.()
    jsonEditorRef.value?.resetHistory?.()
    textEditorRef.value?.resetHistory?.()
  })
}

async function openFile() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  if (!(await guardDirty())) return
  const res = await window.mdAPI.openFile()
  if (res.canceled || !res.filePath) return
  await loadFile(res.filePath)
  // 通过对话框打开的单个文件：清空目录树，只展示该文件
  if (currentPath.value === res.filePath) enterSingleFileMode()
  ElMessage.success(`已打开 ${fileName.value}`)
}

/** 打开目录：在侧边栏展示文件树 */
async function openDirectory() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  const res = await window.mdAPI.openDirectory()
  if (res.canceled || !res.path) return
  if (!(await beforeSwitchDir(res.path))) return
  openedDir.value = res.path
  showSidebar.value = true
  treeKey.value++
  // 记入最近打开的目录，便于后续一键切换
  pushRecentDir(res.path)
  // 记忆本次打开的目录，下次启动时自动恢复
  saveLastDir(res.path)
  saveLastSidebar(true)
  resetExpandedMemory()
  ElMessage.success('已打开目录')
}

/* ========== 多窗口（一窗口一文档 / 目录，彼此状态隔离） ========== */

/** 新建窗口：沿用当前窗口的目录，新窗口拥有独立的编辑器与目录树 */
async function newWindow() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  const res = await window.mdAPI.newWindow({ dirPath: openedDir.value })
  if (!res?.ok) ElMessage.warning(res?.error || '新建窗口失败')
}

/** 在新窗口中打开文件（该文件已在其它窗口打开时，直接聚焦那个窗口） */
async function openFileInNewWindow(filePath: string) {
  if (!window.mdAPI || !filePath) return
  const res = await window.mdAPI.openInNewWindow({ filePath, dirPath: openedDir.value })
  if (!res?.ok) ElMessage.warning(res?.error || '打开失败')
  else if (res.reused) ElMessage.info('该文件已在另一个窗口打开，已为你切换过去')
}

/** 目录树右键：在新窗口中打开该文件 */
function openInNewWindowNode(node: TreeNode) {
  hideContextMenu()
  openFileInNewWindow(node.path)
}

/** 保存前处理内容：Markdown 文件刷新元数据 lastUpdateDate；新建文件另存为时按文件名补全 title */
function prepareContentForSave(filePath: string, raw: string, isFreshNew: boolean): string {
  if (fileType.value !== 'markdown') return raw
  let result = updateMetadataLastUpdate(raw)
  if (isFreshNew) {
    const name = basename(filePath).replace(/\.(md|markdown|mdown|mkd)$/i, '')
    if (name) {
      const title = getFrontMatterTitle(result)
      if (!title || title === '未命名') result = setFrontMatterTitle(result, name)
    }
  }
  return result
}

async function saveFile() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  if (!canSave.value) return
  if (!currentPath.value) {
    await saveAs()
    return
  }
  // 多窗口 / 外部程序可能已改动该文件：保存前比对修改时间，避免静默覆盖
  if (!(await confirmOverwriteIfChanged())) return
  // 保存前先刷新元数据 lastUpdateDate，再写入磁盘
  const newContent = prepareContentForSave(currentPath.value, content.value, false)
  try {
    const res = await window.mdAPI.saveFile({ filePath: currentPath.value, content: newContent })
    if (!res.canceled) {
      // 保存成功后刷新基准修改时间，后续改动才能正确识别为"外部修改"
      void refreshFileMtime()
      // 元数据被刷新时，将编辑器内容同步为已保存的版本
      if (newContent !== content.value) {
        suppressDirty = true
        content.value = newContent
        suppressDirty = false
      }
      isDirty.value = false
      updateTitle()
      // 保存后静默刷新所在目录：新转出的文件即时显示，已有文件的修改时间同步更新
      refreshTreeDir(dirname(currentPath.value))
      ElMessage.success('已保存')
    }
  } catch (err) {
    ElMessage.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function saveAs() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  const res = await window.mdAPI.saveAs({
    content: content.value,
    defaultPath: fileName.value,
  })
  if (!res.canceled && res.filePath) {
    // 保存前刷新 lastUpdateDate；新建文件另存为时用文件名自动补全 title
    const isFreshNew = !currentPath.value
    const finalContent = prepareContentForSave(res.filePath, content.value, isFreshNew)
    if (finalContent !== content.value) {
      try {
        await window.mdAPI.saveFile({ filePath: res.filePath, content: finalContent })
      } catch (err) {
        ElMessage.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
        return
      }
      suppressDirty = true
      content.value = finalContent
      suppressDirty = false
    }
    currentPath.value = res.filePath
    fileOpened.value = true
    isDirty.value = false
    updateTitle()
    // 另存为后基准修改时间随之改变
    void refreshFileMtime()
    // 新保存的文件若在已打开的目录内，刷新目录树使其立即显示
    refreshTreeDir(dirname(res.filePath))
    ElMessage.success(`已保存到 ${fileName.value}`)
  }
}

/* ========== 导出 HTML ========== */
function buildExportHtml(bodyHtml: string): string {
  const theme = CODE_THEMES.find((t) => t.name === codeTheme.value) || CODE_THEMES[0]
  const themeVars = Object.entries(theme.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${fileName.value.replace(/\.md$/i, '')}</title>
<style>
::root {
  --color-primary: #409eff;
  --text-color-primary: #303133;
  --text-color-secondary: #606266;
  --border-color-light: #e4e7ed;
  --border-color-lighter: #ebeef5;
  --bg-color-page: #f2f3f5;
  ${themeVars}
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-color-primary);
  background: var(--bg-color-page);
}
.markdown-body {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 40px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
}
${getMarkdownExtensionStyles()}
${katexCss}
</style>
</head>
<body>
<div class="markdown-body">
${bodyHtml}
</div>
</body>
</html>`
}

async function exportHtml() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  const previewEl = document.querySelector<HTMLElement>('.preview-content')
  // 预览内容位于缩放容器内（外层是滚动容器），导出时取其内容，避免把缩放包裹层与 zoom 样式一并导出
  const innerEl = previewEl?.querySelector<HTMLElement>('.preview-zoom-inner')
  const bodyHtml = innerEl?.innerHTML || previewEl?.innerHTML || renderMarkdown(content.value)
  const res = await window.mdAPI.exportHtml({
    html: buildExportHtml(bodyHtml),
    defaultPath: fileName.value.replace(/\.md$/i, '') + '.html',
  })
  if (!res.canceled) {
    // 导出的 HTML 若保存在已打开目录内，静默刷新所在目录使其即时显示（路径不匹配时刷新为 no-op）
    if (res.filePath) refreshTreeDir(dirname(res.filePath))
    ElMessage.success('已导出 HTML')
  }
}

/* ========== 目录树 ========== */
interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  isLeaf: boolean
  ext: string
}

const treeProps = {
  label: 'name',
  isLeaf: 'isLeaf',
}

const loadTreeNode = async (node: any, resolve: (data: TreeNode[]) => void) => {
  if (node.level === 0) {
    // 单文件模式（打开本地文件 / 内置暂存文件）：只渲染当前打开的这一个文件
    if (!openedDir.value) {
      resolve(
        currentPath.value
          ? [
              {
                name: fileName.value,
                path: currentPath.value,
                isDirectory: false,
                isLeaf: true,
                ext: extname(currentPath.value).replace(/^\./, '').toLowerCase(),
              },
            ]
          : [],
      )
      return
    }
    resolve([
      {
        name: basename(openedDir.value) || openedDir.value,
        path: openedDir.value,
        isDirectory: true,
        isLeaf: false,
        ext: '',
      },
    ])
    return
  }
  const data = node.data as TreeNode
  if (!data.isDirectory) {
    resolve([])
    return
  }
  const res = await window.mdAPI?.readDir(data.path)
  if (!res?.ok) {
    resolve([])
    return
  }
  resolve(
    (res.children || [])
      // 内置暂存文件不在目录树中展示（万一用户打开了它所在的安装 / 数据目录）
      .filter((c) => !scratchPath.value || c.path !== scratchPath.value)
      .map((c) => ({ ...c, isLeaf: !c.isDirectory })),
  )
}

const onTreeNodeClick = async (data: TreeNode) => {
  if (data.isDirectory) return
  await openFileByPath(data.path)
}

/**
 * 目录树节点开始拖拽：写入节点路径信息，供右侧 AI 面板接收为引用文件。
 * 文件与文件夹均可拖拽，文件夹在放置时会自动展开为可解析的文件。
 */
/**
 * 目录树节点开始拖拽：交由主进程发起系统级文件拖拽，
 * 可直接拖到桌面 / 资源管理器 / 任意文件夹，效果与复制一致
 * @param e 拖拽事件
 * @param node 目录树节点
 */
function onTreeNodeDragStart(e: DragEvent, node: TreeNode) {
  if (!node?.path) return
  // 阻止 Chromium 的页面内拖拽，改由主进程发起系统文件拖拽
  e.preventDefault()
  window.mdAPI?.startFileDrag([node.path])
}

/** 记录目录展开状态（用于重启后恢复目录树） */
function onNodeExpand(data: TreeNode) {
  if (!data.isDirectory) return
  expandedDirs.value.add(normPath(data.path))
  saveLastExpanded()
}

/** 记录目录收起状态（用于重启后恢复目录树） */
function onNodeCollapse(data: TreeNode) {
  if (!data.isDirectory) return
  expandedDirs.value.delete(normPath(data.path))
  saveLastExpanded()
}

/* ========== 目录树全部展开 / 全部合并 ========== */
/** 全部展开时最多递归的层级，避免深目录无限展开 */
const EXPAND_ALL_MAX_DEPTH = 6
/** 全部展开时最多加载的目录数量，避免 node_modules 之类巨型目录卡死界面 */
const EXPAND_ALL_MAX_DIRS = 400
/** 是否正在执行「全部展开」（展开期间按钮显示加载态并忽略重复点击） */
const expandingAll = ref(false)

/**
 * 全部展开：逐层加载并展开所有子目录。
 * 目录树为 lazy 加载，子节点必须先加载才能展开，因此这里递归 await 每一层。
 * 达到层级 / 数量上限时停止，避免遇到超大目录时界面卡死。
 */
async function expandAllTree() {
  if (expandingAll.value) return
  const tree = treeRef.value as any
  if (!tree?.store?.root) return
  expandingAll.value = true
  try {
    let dirs = 0
    let truncated = false

    const walk = async (node: any, depth: number): Promise<void> => {
      if (node.isLeaf || !node.data?.path) return
      if (depth > EXPAND_ALL_MAX_DEPTH || dirs >= EXPAND_ALL_MAX_DIRS) {
        truncated = true
        return
      }
      dirs++
      // 展开（未加载时 expand 会先触发异步加载，回调时子节点已就绪）
      await new Promise<void>((resolve) => {
        node.expand(() => resolve())
      })
      expandedDirs.value.add(normPath(node.data.path))
      for (const child of node.childNodes || []) {
        await walk(child, depth + 1)
      }
    }

    for (const child of tree.store.root.childNodes || []) {
      await walk(child, 1)
    }
    saveLastExpanded()
    // 展开后重新高亮当前文件（新渲染的节点会覆盖默认高亮）
    nextTick(() => {
      if (currentPath.value) tree.setCurrentKey?.(currentPath.value)
    })
    if (truncated) {
      ElMessage.warning(
        `目录过多，已展开 ${dirs} 个目录后停止（上限 ${EXPAND_ALL_MAX_DEPTH} 层 / ${EXPAND_ALL_MAX_DIRS} 个目录）`,
      )
    }
  } finally {
    expandingAll.value = false
  }
}

/** 全部合并：收起所有目录，仅保留顶层目录可见（与 VS Code 行为一致） */
function collapseAllTree() {
  const tree = treeRef.value as any
  if (!tree?.store?.nodesMap) return
  const nodes: any[] = Object.values(tree.store.nodesMap)
  for (const node of nodes) {
    // 保留顶层目录（level 1），否则整棵树会收起成一行为空白
    if (node.level > 1 && node.expanded) node.collapse()
  }
  expandedDirs.value = new Set()
  // 顶层目录仍展开，需记回展开记忆，保证重启后恢复
  for (const node of nodes) {
    if (node.level === 1 && node.expanded && node.data?.path) expandedDirs.value.add(normPath(node.data.path))
  }
  saveLastExpanded()
}

// 侧边栏显隐变化时记忆（saveLastSidebar 内部会忽略尚未打开目录时的初始化）
watch(showSidebar, (v) => saveLastSidebar(v))

/* ========== 目录树右键菜单 ========== */
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  node: null as TreeNode | null,
})

function onNodeContextMenu(event: Event, data: TreeNode) {
  event.preventDefault()
  event.stopPropagation()
  const e = event as MouseEvent
  const w = 210
  contextMenu.value = {
    visible: true,
    x: Math.min(e.clientX, window.innerWidth - w),
    y: Math.min(e.clientY, window.innerHeight - 300),
    node: data,
  }
  // 菜单项较多时实际高度可能超出预估，渲染后动态修正位置，确保完整显示在视口内
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('.tree-context-menu')
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.bottom > window.innerHeight) {
      contextMenu.value.y = Math.max(8, window.innerHeight - rect.height - 8)
    }
    if (rect.right > window.innerWidth) {
      contextMenu.value.x = Math.max(8, window.innerWidth - rect.width - 8)
    }
  })
}

function hideContextMenu() {
  contextMenu.value.visible = false
}

/** 新建文件（在目标节点所在目录） */
async function createFileAt(node: TreeNode) {
  hideContextMenu()
  const dir = node.isDirectory ? node.path : dirname(node.path)
  const { value } = await ElMessageBox.prompt('输入文件名（支持 .md / .txt 等）', '新建文件', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputValue: '新建文档.md',
    inputValidator: (v: string) => (v && v.trim() ? true : '文件名不能为空'),
  }).catch(() => ({ value: '' as string }))
  const name = (value || '').trim()
  if (!name) return
  const res = await window.mdAPI?.createFile(dir, name)
  if (!res?.ok) {
    ElMessage.error(`创建失败：${res?.error || '未知错误'}`)
    return
  }
  refreshTreeDir(dir)
  ElMessage.success(`已创建 ${name}`)
}

/** 新建文件夹（在目标节点所在目录） */
async function createDirAt(node: TreeNode) {
  hideContextMenu()
  const dir = node.isDirectory ? node.path : dirname(node.path)
  const { value } = await ElMessageBox.prompt('输入文件夹名称', '新建文件夹', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputValue: '新建文件夹',
    inputValidator: (v: string) => (v && v.trim() ? true : '文件夹名不能为空'),
  }).catch(() => ({ value: '' as string }))
  const name = (value || '').trim()
  if (!name) return
  const res = await window.mdAPI?.createDir(dir, name)
  if (!res?.ok) {
    ElMessage.error(`创建失败：${res?.error || '未知错误'}`)
    return
  }
  refreshTreeDir(dir)
  ElMessage.success(`已创建文件夹 ${name}`)
}

/** 重命名目录树节点 */
async function renameTreeNode(node: TreeNode) {
  hideContextMenu()
  const { value } = await ElMessageBox.prompt('输入新名称（含扩展名）', '重命名', {
    confirmButtonText: '重命名',
    cancelButtonText: '取消',
    inputValue: node.name,
    inputValidator: (v: string) => (v && v.trim() ? true : '名称不能为空'),
  }).catch(() => ({ value: '' as string }))
  const name = (value || '').trim()
  if (!name || name === node.name) return
  const res = await window.mdAPI?.renameFile({ oldPath: node.path, newName: name })
  if (!res?.ok) {
    ElMessage.error(`重命名失败：${res?.error || '未知错误'}`)
    return
  }
  // 若重命名的是当前打开的文件，同步更新路径与标题
  if (currentPath.value === node.path) {
    currentPath.value = res.path || ''
    updateTitle()
    refreshSingleFileTree()
  }
  refreshTreeDir(dirname(node.path))
  ElMessage.success(`已重命名为 ${name}`)
}

/** 删除目录树节点（文件夹递归删除） */
async function deleteTreeNode(node: TreeNode) {
  hideContextMenu()
  const type = node.isDirectory ? '文件夹' : '文件'
  const isCurrent = currentPath.value === node.path
  try {
    await ElMessageBox.confirm(
      `确定删除${type}「${node.name}」吗？${node.isDirectory ? '文件夹内的所有内容将一并删除，此操作不可恢复。' : ''}`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      }
    )
  } catch {
    return
  }
  const res = await window.mdAPI?.deletePath(node.path)
  if (!res?.ok) {
    ElMessage.error(`删除失败：${res?.error || '未知错误'}`)
    return
  }
  // 若删除的是当前打开的文件，清空编辑器
  if (isCurrent) {
    suppressDirty = true
    content.value = ''
    currentPath.value = ''
    fileType.value = 'markdown'
    isDirty.value = false
    suppressDirty = false
    updateTitle()
    refreshSingleFileTree()
  }
  refreshTreeDir(dirname(node.path))
  ElMessage.success(`已删除 ${node.name}`)
}

/** 在文件夹中显示 */
function revealNode(node: TreeNode) {
  hideContextMenu()
  window.mdAPI?.revealFile(node.path)
}

/** 用系统默认程序打开 */
async function openWithDefaultNode(node: TreeNode) {
  hideContextMenu()
  const res = await window.mdAPI?.openWithDefault(node.path)
  if (res && !res.ok && res.error) {
    ElMessage.error(res.error)
  }
}

/** 将文件引用到 AI 面板（提取文本 / Office / 图片内容作为上下文） */
function sendToAi(node: TreeNode) {
  hideContextMenu()
  if (node.isDirectory) return
  aiPanelVisible.value = true
  nextTick(() => {
    aiPanelRef.value?.addAttachments?.([node.path])
  })
}

/* ========== 一键转 Markdown（anydoc 本地转换） ========== */

/** 可一键转换为 Markdown 的扩展名集合（Office / PDF / RTF / EPUB / ODT / CSV） */
const CONVERTIBLE_EXTS = new Set([
  'doc', 'docx', 'docm',
  'ppt', 'pptx', 'pps', 'pot', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb',
  'odt', 'ods', 'odp',
  'rtf', 'epub', 'csv', 'pdf',
])

/** 目录树节点是否为可转换为 Markdown 的文件 */
function isConvertibleFile(node: TreeNode | null): boolean {
  if (!node || node.isDirectory) return false
  return CONVERTIBLE_EXTS.has(String(node.ext || '').toLowerCase())
}

/** 一键将文件转换为 Markdown：同目录生成同名 .md，按图片配置处理嵌入图片，成功后自动打开编辑 */
async function convertToMarkdownNode(node: TreeNode) {
  hideContextMenu()
  if (!window.mdAPI) return
  const res = await window.mdAPI.convertToMarkdown(node.path, getImageHostingConfig())
  if (!res?.ok) {
    ElMessage.error(`转换失败：${res?.error || '未知错误'}`)
    return
  }
  const name = res.targetPath ? basename(res.targetPath) : ''
  const assets = res.exportedAssets || []
  const uploaded = assets.filter((a) => a.uploaded).length
  const hint = uploaded
    ? `，并上传 ${uploaded} 张图片到图床`
    : assets.length
      ? `，并导出 ${assets.length} 个嵌入图片/资源`
      : ''
  refreshTreeDir(dirname(node.path))
  await openFileByPath(res.targetPath || '')
  ElMessage.success(`已转换为 ${name}${hint}`)
  if (res.warnings?.length) {
    ElMessage.warning(res.warnings[0])
  }
}

/** 文件预览区转换完成后：静默刷新所在目录，并打开转换出的 Markdown 文档 */
async function onFileConverted(targetPath?: string) {
  if (!targetPath) return
  // 转换生成新文件后立即刷新左侧目录树，让新 .md 文件即时显示
  refreshTreeDir(dirname(targetPath))
  await openFileByPath(targetPath)
}

/* ========== 右上角文件名重命名 ========== */
const renaming = ref(false)
const renameDraft = ref('')

function startRename() {
  if (!currentPath.value) return
  // 内置暂存文件重命名会导致入口失效，直接禁用
  if (isScratchFile.value) {
    ElMessage.info('暂存区为内置文件，不支持重命名')
    return
  }
  renameDraft.value = fileName.value
  renaming.value = true
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.header-file .rename-input')
    if (!input) return
    input.focus()
    const dot = renameDraft.value.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : renameDraft.value.length)
  })
}

async function commitRename() {
  if (!renaming.value) return
  const name = renameDraft.value.trim()
  renaming.value = false
  if (!currentPath.value || !name || name === fileName.value) return
  const res = await window.mdAPI?.renameFile({ oldPath: currentPath.value, newName: name })
  if (!res?.ok) {
    ElMessage.error(`重命名失败：${res?.error || '未知错误'}`)
    return
  }
  currentPath.value = res.path || ''
  updateTitle()
  refreshSingleFileTree()
  refreshTreeDir(dirname(currentPath.value))
  ElMessage.success(`已重命名为 ${name}`)
}

function cancelRename() {
  renaming.value = false
}

/** 预览中点击本地文件链接 */
const onMarkdownOpenFile = async (filePath: string) => {
  await openFileByPath(filePath)
}

/* ========== AI 助手 ========== */
const aiPanelVisible = ref(false)
/** AI 调用日志查看窗口 */
const aiLogVisible = ref(false)
const aiPanelRef = ref<InstanceType<typeof AiPanel> | null>(null)
/** 最近一次同步给 AI 面板的编辑器选中文本（作为"生成图表"的描述来源） */
const aiSelection = ref('')
const markdownEditorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const htmlEditorRef = ref<InstanceType<typeof HtmlEditor> | null>(null)
const jsonEditorRef = ref<InstanceType<typeof JsonEditor> | null>(null)
const textEditorRef = ref<InstanceType<typeof TextEditor> | null>(null)

/** 只读预览类型（office / pdf / 压缩包 / 图片等非文本文件） */
const isReadonlyKind = (kind: FileKind) =>
  kind === 'image' || kind === 'pdf' || kind === 'office' || kind === 'archive' || kind === 'other'

/** 获取当前编辑器（Markdown / HTML / JSON / 文本）中选中的文本 */
function getEditorSelection(): string {
  if (fileType.value === 'markdown') return markdownEditorRef.value?.getSelectionText?.() || ''
  if (fileType.value === 'html') return htmlEditorRef.value?.getSelectionText?.() || ''
  if (fileType.value === 'json') return jsonEditorRef.value?.getSelectionText?.() || ''
  if (fileType.value === 'text') return textEditorRef.value?.getSelectionText?.() || ''
  return ''
}

/** 头部"AI 助手"按钮：打开面板时自动带上当前上下文（只读文件→引用为附件；文本文件→选中内容预填输入框） */
function handleAiToggle() {
  aiPanelVisible.value = !aiPanelVisible.value
  if (!aiPanelVisible.value) return
  aiSelection.value = getEditorSelection()
  nextTick(() => {
    // 只读文件（office / pdf / 图片等）：默认把当前文件作为引用附件
    if (isReadonlyKind(fileType.value) && currentPath.value) {
      aiPanelRef.value?.addAttachments?.([currentPath.value])
      return
    }
    // 文本文件：若编辑器中有选中文本，预填到 AI 输入框供提问
    const sel = getEditorSelection()
    if (sel.trim()) aiPanelRef.value?.quoteSelection?.(sel)
  })
}

/** 编辑器选中文本点击"问 AI"：打开 AI 面板并填充选中文本到对话框（面板已打开则直接填充） */
function onAskAi(text: string) {
  aiPanelVisible.value = true
  aiSelection.value = text
  nextTick(() => {
    aiPanelRef.value?.quoteSelection?.(text)
  })
}

/** 编辑器选中文本点击"生成图表"：打开 AI 面板并以选中文本为描述生成图表代码 */
function onGenerateDiagram(text: string) {
  aiPanelVisible.value = true
  aiSelection.value = text
  nextTick(() => {
    aiPanelRef.value?.runDiagram?.(text)
  })
}

/** 头部"概要生成"按钮：打开右侧 AI 面板并触发概要生成 */
function handleAiOutline() {
  aiPanelVisible.value = true
  nextTick(() => {
    aiPanelRef.value?.runOutline?.()
  })
}

/** 头部"一键更新元数据"按钮：打开右侧 AI 面板并触发元数据生成 */
function handleAiMetadata() {
  aiPanelVisible.value = true
  nextTick(() => {
    aiPanelRef.value?.runMetadata?.()
  })
}

/** 当前打开的文件对应的编辑器实例（Markdown / HTML / JSON / 文本） */
function currentEditor() {
  if (fileType.value === 'markdown') return markdownEditorRef.value
  if (fileType.value === 'html') return htmlEditorRef.value
  if (fileType.value === 'json') return jsonEditorRef.value
  return textEditorRef.value
}

/**
 * AI 面板结果应用：
 * - replace：替换全文
 * - append：追加到文末
 * - caret：插入到光标处（有选中内容时替换选中，典型场景为「描述 → 图表代码」）
 */
function onAiApplyContent(payload: { text: string; mode: 'replace' | 'append' | 'caret' | 'prepend' }) {
  const text = payload?.text?.trim()
  if (!text) return
  if (payload.mode === 'caret') {
    // 编辑器内部的 replaceSelection 已记录撤销快照，此处不再重复压栈；
    // 代码块前后补空行，避免与相邻正文粘连导致 Markdown 解析异常
    currentEditor()?.replaceSelection?.(`\n${text}\n`)
    ElMessage.success('已插入到光标处')
    return
  }
  // AI 写入前记录撤销快照，保证 Ctrl+Z 可回退
  currentEditor()?.pushHistory?.()
  if (payload.mode === 'append') {
    content.value = content.value ? `${content.value.replace(/\s+$/, '')}\n\n${text}` : text
    ElMessage.success('已插入到文末')
  } else if (payload.mode === 'prepend') {
    content.value = content.value ? `${text}\n\n${content.value.replace(/^\s+/, '')}` : text
    ElMessage.success('已插入到文首')
  } else {
    content.value = text
    ElMessage.success('已替换全文')
  }
}

/**
 * AI 一键更新元数据：把 AI 生成的 YAML 字段按完整模板合并到文档头部。
 * createDate 沿用首次写入的值、lastUpdateDate 刷新为当前时间，均由系统维护，AI 无法改写。
 */
function onAiApplyMetadata(text: string) {
  if (fileType.value !== 'markdown') {
    ElMessage.warning('元数据仅支持 Markdown 文档')
    return
  }
  const yaml = (text || '').trim()
  if (!yaml) return
  // AI 写入前记录撤销快照，保证 Ctrl+Z 可回退
  currentEditor()?.pushHistory?.()
  content.value = applyAiMetadata(content.value, yaml)
  ElMessage.success('元数据已更新（时间字段由系统维护）')
}

/** AI 概要插入到文章大标题（首个 # 一级标题）之下，以提示块样式展示；无一级标题时插入到文档开头 */
function onAiInsertOutline(outline: string) {
  // 包装为提示块：> [!NOTE] 文章概要\n> 1. ...
  const text = buildOutlineBlock(outline)
  if (!text) return
  // AI 插入前记录撤销快照，保证 Ctrl+Z 可回退
  const editor =
    fileType.value === 'markdown'
      ? markdownEditorRef.value
      : fileType.value === 'html'
        ? htmlEditorRef.value
        : fileType.value === 'json'
          ? jsonEditorRef.value
          : textEditorRef.value
  editor?.pushHistory?.()
  const lines = content.value.split('\n')
  let h1Index = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+\S/.test(lines[i])) {
      h1Index = i
      break
    }
  }
  if (h1Index === -1) {
    // 无一级标题：插入到文档最前面
    content.value = text + '\n\n' + content.value.replace(/^\s+/, '')
  } else {
    // 在首个一级标题之后空行处插入概要提示块
    lines.splice(h1Index + 1, 0, '', text, '')
    content.value = lines.join('\n')
  }
  ElMessage.success('概要已插入到文章标题之下')
}

/* ========== 工具集（Tools）========== */
/**
 * 向工具集注入宿主上下文：允许工具把处理结果插入到当前文档光标处。
 * 编辑器内部的 replaceSelection 已记录撤销快照，此处不再重复压栈。
 */
provideToolContext({
  canInsert: () => !!currentEditor(),
  insertText: (text: string) => {
    const editor = currentEditor()
    if (!editor) {
      ElMessage.warning('请先打开 Markdown / HTML / JSON / 文本文件')
      return
    }
    editor.replaceSelection?.(text)
    ElMessage.success('已插入到文档光标处')
  },
})

/* ========== 设置（外观 / 图床 / PlantUML / AI / 文件关联的统一入口） ========== */
const settingsVisible = ref(false)

/**
 * 从设置窗口打开 AI 调用日志：
 * 日志为独立大窗口，先关闭设置再打开，避免两层弹窗叠加。
 */
function openAiLogFromSettings() {
  settingsVisible.value = false
  aiLogVisible.value = true
}

/* ========== 从 Git 打开（克隆远程仓库后自动打开该项目目录） ========== */
const gitCloneVisible = ref(false)
/** 克隆弹窗的默认存放目录：当前已打开的目录优先，其次最近打开的目录 */
const gitCloneParentDir = computed(() => openedDir.value || recentDirs.value[0] || '')

/** 打开「从 Git 打开」弹窗（输入仓库地址 + 选择存放目录） */
function openGitClone() {
  gitCloneVisible.value = true
}

/** 克隆完成后自动打开该项目目录：目录树、最近目录、Git 面板随之联动 */
async function onGitCloned(dir: string) {
  await openDirByPath(dir)
}

/* ========== Git 版本管理 ========== */
/** 当前目录所在的仓库根目录，为空表示不是 Git 仓库 */
const gitRepoRoot = ref('')
/** 系统 Git 是否可用 */
const gitAvailable = ref(true)
/** 未检测到 Git 的提示是否已弹过（每个会话一次） */
const gitWarned = ref(false)
/** Git 面板显隐 */
const gitPanelVisible = ref(winStore.getItem('md-git-panel-visible') !== '0')
/** Git 面板实例（用于主动刷新状态） */
const gitPanelRef = ref<InstanceType<typeof GitPanel> | null>(null)
/** 目录树徽标：绝对路径（规范化） -> 徽标 */
const gitBadges = ref<Map<string, GitBadge>>(new Map())
/** 差异弹窗显隐 */
const gitDiffVisible = ref(false)
/** 差异弹窗参数 */
const gitDiffPayload = ref<{ paths: string[]; staged?: boolean; title?: string }>({ paths: [] })
/** 历史弹窗显隐 */
const gitHistoryVisible = ref(false)
/** 历史弹窗限定的文件（仓库内相对路径），为空表示整个仓库 */
const gitHistoryPath = ref('')
/** Git 状态刷新防抖定时器 */
let gitRefreshTimer: number | undefined

/** Git 面板是否展示：仓库内；或未检测到 Git 时保留面板以便配置路径 */
const showGitPanel = computed(() => gitPanelVisible.value && (!!gitRepoRoot.value || !gitAvailable.value))

/** 需要检测的目录：已打开目录优先，单文件模式取文件所在目录 */
const gitWatchDir = computed(() =>
  openedDir.value || (currentPath.value ? dirname(currentPath.value) : ''),
)

/**
 * 目录树节点对应的 Git 徽标
 * 文件节点显示状态字母，目录节点显示其后代变更数量
 */
function gitBadgeOf(data: { path: string; isDirectory: boolean }) {
  if (!gitRepoRoot.value) return null
  const badge = gitBadges.value.get(gitPathKey(data.path))
  if (!badge) return null
  if (data.isDirectory) {
    return {
      text: String(badge.count),
      color: 'var(--text-color-secondary)',
      title: `${badge.count} 项变更`,
    }
  }
  const meta = gitStatusMeta(badge.code)
  return { text: meta.text, color: meta.color, title: meta.label }
}

/** 防抖刷新 Git 状态（文件保存 / 目录刷新后调用） */
function scheduleGitRefresh() {
  if (!gitRepoRoot.value) return
  window.clearTimeout(gitRefreshTimer)
  gitRefreshTimer = window.setTimeout(() => gitPanelRef.value?.refresh(), 800)
}

/** 检测目录是否位于 Git 仓库内（支持在仓库子目录打开） */
async function detectGitRepo(dir: string) {
  if (!dir || !window.mdAPI) {
    gitRepoRoot.value = ''
    return
  }
  const res = await window.mdAPI.git.detect(dir).catch(() => null)
  const available = res?.gitAvailable !== false
  gitAvailable.value = available
  if (!available && !gitWarned.value) {
    gitWarned.value = true
    ElMessage.warning('未检测到 Git，版本管理功能暂不可用（可在 Git 面板的 ⋯ 菜单中设置 git.exe 路径）')
  }
  gitRepoRoot.value = res?.isRepo && res.repoRoot ? res.repoRoot : ''
}

watch(gitWatchDir, (dir) => {
  detectGitRepo(dir)
})

/** 切换 Git 面板显隐并持久化 */
function toggleGitPanel() {
  if (!gitRepoRoot.value && gitAvailable.value) {
    ElMessage.info('当前目录不是 Git 仓库，Git 面板仅在打开 Git 仓库目录时可用')
    return
  }
  gitPanelVisible.value = !gitPanelVisible.value
  winStore.setItem('md-git-panel-visible', gitPanelVisible.value ? '1' : '0')
}

/** 仓库状态变化时更新目录树徽标 */
function onGitStatusChange(status: GitStatus | null) {
  gitBadges.value = buildGitBadgeMap(gitRepoRoot.value, status)
}

/** 打开 Git 面板 / 历史中点击的文件 */
function onGitOpenFile(relPath: string) {
  openFileByPath(joinPath(gitRepoRoot.value, relPath))
}

/** 查看差异 */
function onGitViewDiff(payload: { paths: string[]; staged?: boolean; title?: string }) {
  gitDiffPayload.value = payload
  gitDiffVisible.value = true
}

/** 查看提交历史（path 为空表示整个仓库） */
function onGitViewHistory(payload: { path?: string }) {
  gitHistoryPath.value = payload.path || ''
  gitHistoryVisible.value = true
}

/** 右键菜单：查看该文件的差异 */
function gitDiffNode(node: TreeNode) {
  hideContextMenu()
  const rel = relPathOf(gitRepoRoot.value, node.path)
  if (!rel) return
  onGitViewDiff({ paths: [rel], title: rel })
}

/** 右键菜单：查看该文件的提交历史（--follow） */
function gitHistoryNode(node: TreeNode) {
  hideContextMenu()
  const rel = relPathOf(gitRepoRoot.value, node.path)
  if (!rel) return
  onGitViewHistory({ path: rel })
}

/** 右键菜单：还原文件（丢弃未提交的修改，二次确认） */
async function gitRestoreNode(node: TreeNode) {
  hideContextMenu()
  const rel = relPathOf(gitRepoRoot.value, node.path)
  if (!rel || !window.mdAPI) return
  try {
    await ElMessageBox.confirm(
      `确定还原「${node.name}」吗？该文件未提交的修改将被丢弃，此操作不可恢复。`,
      '还原确认',
      { type: 'warning', confirmButtonText: '还原', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const res = await window.mdAPI.git.restore({ repoRoot: gitRepoRoot.value, paths: [rel] })
  if (!res?.ok) {
    ElMessage.error(`还原失败：${res?.message || '未知错误'}`)
    return
  }
  ElMessage.success('已还原')
  refreshTreeDir(dirname(node.path))
  if (normPath(currentPath.value) === normPath(node.path)) await loadFile(node.path)
  await gitPanelRef.value?.refresh()
}

/** 右键菜单：把文件 / 目录加入 .gitignore */
async function gitIgnoreNode(node: TreeNode) {
  hideContextMenu()
  const rel = relPathOf(gitRepoRoot.value, node.path)
  if (!rel || !window.mdAPI) return
  const res = await window.mdAPI.git.ignorePath({ repoRoot: gitRepoRoot.value, path: rel })
  if (!res?.ok) {
    ElMessage.error(`加入 .gitignore 失败：${res?.message || '未知错误'}`)
    return
  }
  if (!res.added) {
    ElMessage.info(`规则 ${res.rule} 已存在`)
    return
  }
  if (res.tracked) {
    // 已被跟踪的文件加忽略规则不会自动生效，需要提示用户额外执行 git rm --cached
    await ElMessageBox.alert(
      `已把「${rel}」加入 .gitignore（${res.rule}），但该文件已被 Git 跟踪，需执行 git rm --cached 后规则才会生效。`,
      '已加入 .gitignore',
      { type: 'warning', confirmButtonText: '知道了' },
    ).catch(() => {})
  } else {
    ElMessage.success(`已加入 .gitignore：${res.rule}`)
  }
  await gitPanelRef.value?.refresh()
}

/**
 * 工作区被整体改变（切换分支 / 拉取 / 应用储藏等）：
 * 刷新目录树、刷新 Git 状态，并在当前文件未修改时重新加载，避免展示旧内容
 */
async function onGitRepoChanged() {
  refreshTreeDir()
  await gitPanelRef.value?.refresh()
  if (currentPath.value && !isDirty.value) {
    try {
      await loadFile(currentPath.value)
    } catch {
      /* 切换分支后文件可能已不存在，忽略加载失败 */
    }
  }
}

/** Git 设置（git.exe 路径）变更后重新检测 */
async function onGitConfigChanged() {
  gitAvailable.value = true
  gitWarned.value = false
  gitRepoRoot.value = ''
  await detectGitRepo(gitWatchDir.value)
}

/* ========== 外部文件打开（双击关联 / 拖拽到快捷方式 / 命令行传入） ========== */
async function openExternalFile(filePath: string) {
  if (!filePath) return
  if (!(await guardDirty())) return
  await loadFile(filePath)
  // 外部打开的是单个文件：不自动展开其所在目录，只展示该文件
  if (currentPath.value === filePath) enterSingleFileMode()
  ElMessage.success(`已打开 ${fileName.value}`)
}

/** 启动恢复期间收到的外部文件请求，待初始化完成后按到达顺序打开 */
const pendingExternalFiles: string[] = []
/** 启动目录 / 文件恢复是否结束；结束前外部请求只入队，不与恢复流程并发 */
let startupRestoreFinished = false
/** 是否正在消费外部文件队列，避免连续 IPC 触发并发读取 */
let drainingExternalFiles = false

/**
 * 暂存系统文件关联、快捷方式或命令行传入的文件。
 *
 * @param paths 待打开的绝对路径列表
 */
function enqueueExternalFiles(paths: string[]) {
  for (const filePath of paths || []) {
    if (!filePath || pendingExternalFiles.some((item) => normPath(item) === normPath(filePath))) continue
    pendingExternalFiles.push(filePath)
  }
  if (startupRestoreFinished) void drainExternalFiles()
}

/** 启动恢复完成后串行消费外部文件请求，保证外部打开意图最终生效 */
async function drainExternalFiles() {
  if (!startupRestoreFinished || drainingExternalFiles) return
  drainingExternalFiles = true
  try {
    while (pendingExternalFiles.length) {
      const filePath = pendingExternalFiles.shift()
      if (filePath) await openExternalFile(filePath)
    }
  } finally {
    drainingExternalFiles = false
    if (pendingExternalFiles.length) void drainExternalFiles()
  }
}

/* ========== 快捷键 ========== */
/** 当前目标是否为可编辑元素（输入框 / 文本域 / 富文本），是则交给浏览器默认行为 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * 复制目录树节点：同时写入应用内剪贴板与系统剪贴板，
 * 既可在目录树内 Ctrl+V 粘贴，也可在桌面 / 资源管理器粘贴
 * @param node 目录树节点
 */
async function copyTreeNode(node: TreeNode | null) {
  if (!node) return
  if (node.path === openedDir.value) {
    ElMessage.info('不能复制根目录')
    return
  }
  clipNode.value = { path: node.path, name: node.name, isDirectory: node.isDirectory }
  const res = await window.mdAPI?.writeFilesToClipboard([node.path])
  if (res?.ok) {
    ElMessage.success(`已复制 ${node.name}，可粘贴到桌面或任意文件夹`)
  } else {
    ElMessage.warning(`已复制到应用剪贴板，写入系统剪贴板失败：${res?.error || '未知错误'}`)
  }
}

/** Ctrl+C：复制目录树中当前选中的文件 / 文件夹 */
function copyTreeFile() {
  copyTreeNode(treeRef.value?.getCurrentNode() as TreeNode | null)
}

/** Ctrl+V：将剪贴板中的文件 / 文件夹粘贴到目标目录，并静默刷新目录树 */
async function pasteTreeFile() {
  if (!window.mdAPI) return
  const clip = clipNode.value
  if (!clip) return
  // 目标目录：当前选中的目录 → 当前选中文件所在目录 → 当前打开文件所在目录 → 根目录
  let destDir = ''
  const node = treeRef.value?.getCurrentNode() as TreeNode | null
  if (node) destDir = node.isDirectory ? node.path : dirname(node.path)
  if (!destDir) destDir = currentPath.value ? dirname(currentPath.value) : ''
  if (!destDir) destDir = openedDir.value
  if (!destDir) return
  if (destDir === clip.path) {
    ElMessage.info('不能粘贴到自身')
    return
  }
  try {
    const res = await window.mdAPI.copyPath({ srcPath: clip.path, destDir })
    if (res?.ok) {
      refreshTreeDir(destDir)
      ElMessage.success(`已粘贴 ${res.name}`)
    } else {
      ElMessage.error(`复制失败：${res?.error || '未知错误'}`)
    }
  } catch (err) {
    ElMessage.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/* ========== 终端（命令行） ========== */
/** 底部终端面板显隐 */
const terminalPanelVisible = ref(false)
/** 终端面板实例（用于新建终端 / 聚焦） */
const terminalPanelRef = ref<InstanceType<typeof TerminalPanel> | null>(null)
/** 新建终端时的默认工作目录：打开的目录优先，其次当前文件所在目录 */
const terminalCwd = computed(() => openedDir.value || (currentPath.value ? dirname(currentPath.value) : ''))

/** 切换终端面板显隐（首次显示时自动在默认目录创建终端） */
async function toggleTerminal() {
  terminalPanelVisible.value = !terminalPanelVisible.value
  if (!terminalPanelVisible.value) return
  await nextTick(() => terminalPanelRef.value?.ensure())
}

/** 关闭终端面板（保留已打开的终端，可再次唤出） */
function closeTerminalPanel() {
  terminalPanelVisible.value = false
}

/**
 * 右键菜单：在节点所在目录打开命令行
 * @param node 目录树节点（文件则取其所在目录）
 */
async function openTerminalAt(node: TreeNode) {
  hideContextMenu()
  const cwd = node.isDirectory ? node.path : dirname(node.path)
  terminalPanelVisible.value = true
  await nextTick(() => terminalPanelRef.value?.openAt(cwd))
}

function onKeydown(e: KeyboardEvent) {
  // F12：随时切换开发者工具（类似浏览器 F12 调试）
  if (e.key === 'F12') {
    e.preventDefault()
    window.mdAPI?.toggleDevTools()
    return
  }
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const key = e.key.toLowerCase()
  if (key === 's') {
    e.preventDefault()
    if (e.shiftKey) saveAs()
    else saveFile()
  } else if (key === 'o') {
    e.preventDefault()
    if (e.shiftKey) openDirectory()
    else openFile()
  } else if (key === 'n') {
    e.preventDefault()
    // Ctrl+Shift+N 新建窗口，Ctrl+N 新建文件
    if (e.shiftKey) newWindow()
    else newFile()
  } else if (key === 't' && e.shiftKey) {
    e.preventDefault()
    openScratch()
  } else if (key === 'g' && e.shiftKey) {
    e.preventDefault()
    toggleGitPanel()
  } else if (key === '`') {
    // Ctrl+` 显示 / 隐藏终端面板（同 VS Code）
    e.preventDefault()
    toggleTerminal()
  } else if (key === 'c' && !e.shiftKey) {
    // 编辑器 / 输入框内复制文本时不拦截
    if (isEditableTarget(e.target)) return
    // 页面有选中文本时保留默认复制行为
    if (window.getSelection()?.toString()) return
    copyTreeFile()
  } else if (key === 'v' && !e.shiftKey) {
    if (isEditableTarget(e.target)) return
    if (!clipNode.value) return
    e.preventDefault()
    pasteTreeFile()
  }
}

/** 外部文件事件监听解绑函数（onMounted 注册，onBeforeUnmount 注销） */
let stopListenOpenFiles: (() => void) | null = null
/** 窗口关闭确认监听解绑函数（有未保存修改时主进程拦截关闭并回调） */
let stopListenClose: (() => void) | null = null
/** 文件冲突监听解绑函数（打开的文件已在其它窗口打开时回调） */
let stopListenFileConflict: (() => void) | null = null

/**
 * 是否运行在独立的「AI 对话」窗口：该窗口由主进程以 #ai-chat 打开，
 * 只渲染聊天界面，不初始化编辑器 / 目录树 / 终端等主窗口逻辑。
 */
const isAiChatWindow = window.location.hash.replace(/^[#/]+/, '') === 'ai-chat'

onMounted(async () => {
  if (isAiChatWindow) return
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('click', hideContextMenu)
  window.addEventListener('contextmenu', hideContextMenu)
  window.mdAPI?.getAppImagesDir().then((res) => {
    if (res?.ok && res.path) appImagesDir.value = res.path
  })
  // 内置暂存文件：启动时确定路径（文件缺失时由主进程自动重建），供目录树过滤
  ensureScratchPath()
  // 读取最近打开的目录，供侧边栏快速切换
  loadRecentDirs()
  // 窗口关闭确认：有未保存修改时由用户决定保存 / 放弃 / 取消
  stopListenClose = window.mdAPI?.onRequestClose((payload) => {
    void handleCloseRequest(payload)
  }) ?? null
  // 文件冲突：打开的文件已在其它窗口打开时提示
  stopListenFileConflict = window.mdAPI?.onFileConflict((payload) => {
    void handleFileConflict(payload.filePath)
  }) ?? null
  // 尽早订阅运行期外部打开事件；初始化结束前先入队，避免异步恢复覆盖用户双击的文件
  stopListenOpenFiles = window.mdAPI?.onOpenExternalFiles((paths) => {
    enqueueExternalFiles(paths)
  }) ?? null

  try {
    // 冷启动时命令行传入的文件优先级高于上次会话，必须无条件消费主进程队列
    const startup = await window.mdAPI?.getStartupFiles()
    if (startup?.ok && startup.paths?.length) enqueueExternalFiles(startup.paths)

    if (!pendingExternalFiles.length) {
      // 主进程会话同时保存目录与活动文件：先恢复目录树，再恢复关闭时正在查看的文件
      const init = window.mdAPI?.windowInit
      if (init?.dir) {
        const restoredDir = await restoreLastDir(init.dir)
        if (init.file) {
          await loadFile(init.file)
          // 目录失效或文件不属于该目录时才降级为单文件模式，不能清除有效的目录记忆
          if (
            currentPath.value === init.file &&
            (!restoredDir || !isInsideDir(init.file, openedDir.value))
          ) {
            enterSingleFileMode()
          }
        }
      } else if (init?.file) {
        await loadFile(init.file)
        if (currentPath.value === init.file) enterSingleFileMode()
      } else {
        await restoreLastDir()
      }
    }
  } finally {
    startupRestoreFinished = true
    // 初始化过程中收到的新事件或冷启动参数最后执行，确保双击文件不会被会话恢复覆盖
    await drainExternalFiles()
    updateTitle()
  }
})

onBeforeUnmount(() => {
  // 独立对话窗口无需清理编辑器资源
  if (isAiChatWindow) return
  // 卸载前把暂存区挂起的修改落盘
  flushScratchSave()
  // 只关闭本窗口创建的终端会话，避免影响其它窗口
  window.mdAPI?.terminal.killOwn()
  stopListenClose?.()
  stopListenFileConflict?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', hideContextMenu)
  window.removeEventListener('contextmenu', hideContextMenu)
  window.removeEventListener('mousemove', onSidebarResizeMove)
  window.removeEventListener('mouseup', onSidebarResizeEnd)
  stopListenOpenFiles?.()
})

/* ========== 视图模式 ========== */
const viewOptions = [
  { label: '编辑', value: 'edit' as const, icon: Edit },
  { label: '分屏', value: 'split' as const, icon: Files },
  { label: '预览', value: 'preview' as const, icon: View },
]
</script>

<template>
  <!-- 独立「AI 对话」窗口（#ai-chat）：仅渲染聊天界面，会话数据与主窗口共享 -->
  <AiChatWindow v-if="isAiChatWindow" />

  <div v-else class="app-shell">
    <!-- 顶部工具栏 -->
    <header class="app-header">
      <div class="app-brand">
        <span class="brand-icon">
          <el-icon><Edit /></el-icon>
        </span>
        <span class="brand-name">Markdown 编辑器</span>
      </div>

      <div class="header-actions">
        <el-button-group>
          <el-tooltip content="新建 (Ctrl+N)" placement="bottom">
            <el-button :icon="Plus" @click="newFile" />
          </el-tooltip>
          <el-tooltip content="打开目录 (Ctrl+Shift+O)" placement="bottom">
            <el-button :icon="Folder" @click="openDirectory" />
          </el-tooltip>
          <el-tooltip content="从 Git 打开（克隆远程仓库到本地）" placement="bottom">
            <el-button :icon="FolderAdd" @click="openGitClone" />
          </el-tooltip>
          <el-tooltip content="打开文件 (Ctrl+O)" placement="bottom">
            <el-button :icon="Document" @click="openFile" />
          </el-tooltip>
          <el-tooltip content="保存 (Ctrl+S)" placement="bottom">
            <el-button :icon="Check" :disabled="!canSave" @click="saveFile" />
          </el-tooltip>
          <el-tooltip content="另存为 (Ctrl+Shift+S)" placement="bottom">
            <el-button :icon="CopyDocument" @click="saveAs" />
          </el-tooltip>
          <el-tooltip content="导出 HTML" placement="bottom">
            <el-button :icon="Download" :disabled="activeFileType !== 'markdown'" @click="exportHtml" />
          </el-tooltip>
          <el-tooltip :content="scratchTip" placement="bottom">
            <el-button :icon="Notebook" :type="isScratchFile ? 'primary' : ''" @click="openScratch" />
          </el-tooltip>
          <el-tooltip content="新建窗口（沿用当前目录，多窗口各自独立，Ctrl+Shift+N）" placement="bottom">
            <el-button :icon="Monitor" @click="newWindow" />
          </el-tooltip>
        </el-button-group>

        <el-divider direction="vertical" />

        <el-tooltip content="AI 助手（润色 / 扩写 / 概要生成）" placement="bottom">
          <el-button :icon="MagicStick" :type="aiPanelVisible ? 'primary' : ''" @click="handleAiToggle" />
        </el-tooltip>
        <el-tooltip content="概要生成（插入到标题之下）" placement="bottom">
          <el-button :icon="Tickets" :disabled="activeFileType !== 'markdown'" @click="handleAiOutline" />
        </el-tooltip>
        <el-tooltip content="一键更新元数据（AI 生成，时间字段由系统维护）" placement="bottom">
          <el-button :icon="Postcard" :disabled="activeFileType !== 'markdown'" @click="handleAiMetadata" />
        </el-tooltip>

        <el-divider direction="vertical" />

        <el-tooltip content="Git 版本管理（提交 / 比对 / 历史，Ctrl+Shift+G）" placement="bottom">
          <el-button :icon="GitIcon" :type="showGitPanel ? 'primary' : ''" @click="toggleGitPanel" />
        </el-tooltip>
        <el-tooltip content="终端（在当前目录下打开命令行，Ctrl+`）" placement="bottom">
          <el-button :icon="TerminalIcon" :type="terminalPanelVisible ? 'primary' : ''" @click="toggleTerminal" />
        </el-tooltip>

        <!-- Markdown / HTML / JSON 通用：视图模式（编辑 / 分屏 / 预览） -->
        <template v-if="activeFileType === 'markdown' || activeFileType === 'html' || activeFileType === 'json'">
          <el-divider direction="vertical" />

          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button v-for="opt in viewOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </template>

        <el-divider direction="vertical" />

        <!-- 工具集：JSON 格式化 / Base64 / 时间戳 / 哈希等通用小工具 -->
        <ToolLauncher />

        <!-- 设置：外观 / 图床 / PlantUML / AI / 文件关联等统一入口 -->
        <el-tooltip content="设置（外观 / 图床 / PlantUML / AI / 文件关联）" placement="bottom">
          <el-button :icon="Setting" @click="settingsVisible = true" />
        </el-tooltip>
      </div>

      <div class="header-file" :class="{ dirty: isDirty }">
        <template v-if="renaming">
          <input
            v-model="renameDraft"
            class="rename-input"
            spellcheck="false"
            :title="currentPath"
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
            @blur="commitRename"
          />
        </template>
        <template v-else>
          <span
            class="file-name"
            :class="{ clickable: !!currentPath }"
            :title="currentPath ? '点击重命名当前文件' : '未打开文件'"
            @click="startRename"
          >
            {{ fileName }}
          </span>
          <el-tag v-if="isDirty" size="small" type="warning" effect="light">未保存</el-tag>
          <el-button
            v-if="isScratchFile"
            link
            type="danger"
            size="small"
            title="清空暂存区内容"
            @click="clearScratch"
          >
            清空
          </el-button>
        </template>
      </div>
    </header>

    <!-- 主体：左侧目录树 + 右侧内容 -->
    <main class="app-main">
      <!-- 侧边栏收起后的展开按钮 -->
      <button
        v-if="!showSidebar && hasSidebarContent"
        class="sidebar-tab"
        title="展开侧边栏"
        @click="showSidebar = true"
      >
        <el-icon><FolderOpened /></el-icon>
      </button>

      <!-- 侧边栏：目录树 / 单文件 / 最近打开的目录 -->
      <aside
        v-if="showSidebar && hasSidebarContent"
        class="app-sidebar"
        :style="{ width: sidebarWidth + 'px' }"
      >
        <div class="sidebar-header">
          <span class="sidebar-title" :title="sidebarTitleTip">
            <el-icon v-if="openedDir"><FolderOpened /></el-icon>
            <el-icon v-else-if="currentPath"><Document /></el-icon>
            <el-icon v-else><Clock /></el-icon>
            <span class="sidebar-dirname">{{ sidebarTitle }}</span>
          </span>
          <div class="sidebar-actions">
            <el-tooltip v-if="openedDir" content="全部展开" placement="top">
              <el-button text size="small" :icon="Expand" :loading="expandingAll" @click="expandAllTree" />
            </el-tooltip>
            <el-tooltip v-if="openedDir" content="全部合并" placement="top">
              <el-button text size="small" :icon="Fold" @click="collapseAllTree" />
            </el-tooltip>
            <el-tooltip v-if="openedDir" content="刷新" placement="top">
              <el-button text size="small" :icon="Refresh" @click="refreshTreeDir()" />
            </el-tooltip>
            <el-tooltip v-if="isSingleFileMode" content="在目录树中打开该文件所在目录" placement="top">
              <el-button text size="small" :icon="FolderOpened" @click="openCurrentFileDir" />
            </el-tooltip>
            <el-tooltip content="收起侧边栏" placement="top">
              <el-button text size="small" :icon="Fold" @click="showSidebar = false" />
            </el-tooltip>
          </div>
        </div>
        <div v-if="openedDir || currentPath" class="sidebar-tree">
          <el-tree
            ref="treeRef"
            :key="treeKey"
            :props="treeProps"
            :load="loadTreeNode"
            lazy
            node-key="path"
            highlight-current
            :expand-on-click-node="false"
            @node-click="onTreeNodeClick"
            @node-contextmenu="onNodeContextMenu"
            @node-expand="onNodeExpand"
            @node-collapse="onNodeCollapse"
          >
            <template #default="{ data, node }">
              <span
                v-overflow-tip="data.name"
                class="tree-node"
                draggable="true"
                @dragstart.stop="onTreeNodeDragStart($event, data)"
              >
                <FileIcon
                  :ext="data.ext"
                  :name="data.name"
                  :is-directory="data.isDirectory"
                  :expanded="node.expanded"
                  :size="16"
                />
                <span class="tree-label">{{ data.name }}</span>
                <span
                  v-if="gitBadgeOf(data)"
                  class="git-badge"
                  :style="{ color: gitBadgeOf(data)!.color }"
                  :title="gitBadgeOf(data)!.title"
                >
                  {{ gitBadgeOf(data)!.text }}
                </span>
              </span>
            </template>
          </el-tree>
        </div>

        <!-- Git 版本管理：目录为 Git 仓库时展示变更列表、提交与历史入口 -->
        <GitPanel
          v-if="showGitPanel"
          ref="gitPanelRef"
          :repo-root="gitRepoRoot"
          :dirty="isDirty"
          :save-current="saveFile"
          @open-file="onGitOpenFile"
          @view-diff="onGitViewDiff"
          @view-history="onGitViewHistory"
          @status-change="onGitStatusChange"
          @config-changed="onGitConfigChanged"
          @repo-changed="onGitRepoChanged"
        />

        <!-- 最近打开的目录：一键切换，无需重复弹系统选择框 -->
        <div class="sidebar-recent" :class="{ collapsed: recentCollapsed }">
          <div class="recent-header">
            <span
              class="recent-header-left"
              :title="recentCollapsed ? '展开最近打开的目录' : '收起最近打开的目录'"
              @click="toggleRecentCollapsed"
            >
              <el-icon class="recent-arrow">
                <ArrowRight v-if="recentCollapsed" />
                <ArrowDown v-else />
              </el-icon>
              <span class="recent-title">最近打开的目录</span>
            </span>
            <span class="recent-actions">
              <el-tooltip content="从 Git 打开（克隆远程仓库）" placement="top">
                <el-button text size="small" :icon="GitIcon" @click="openGitClone" />
              </el-tooltip>
              <el-tooltip content="打开其它目录 (Ctrl+Shift+O)" placement="top">
                <el-button text size="small" :icon="FolderAdd" @click="openDirectory" />
              </el-tooltip>
            </span>
          </div>
          <template v-if="!recentCollapsed">
            <div v-if="!recentDirs.length" class="recent-empty">暂无记录</div>
              <ul v-else class="recent-list">
                <li
                  v-for="d in recentDirs"
                  :key="d"
                  class="recent-item"
                  :class="{ active: !!openedDir && normPath(d) === normPath(openedDir) }"
                  :title="d"
                  @click="openDirByPath(d)"
                >
                  <el-icon class="recent-icon"><FolderOpened /></el-icon>
                  <span class="recent-text">
                    <span class="recent-name">{{ basename(d) || d }}</span>
                    <span class="recent-path">{{ d }}</span>
                  </span>
                  <el-icon class="recent-remove" title="从最近列表中移除" @click.stop="removeRecentDir(d)">
                    <Close />
                  </el-icon>
                </li>
              </ul>
            </template>
          </div>

        <!-- 宽度拖动条 -->
        <div class="sidebar-resizer" title="拖动调整侧边栏宽度" @mousedown="onSidebarResizeStart" />
      </aside>

      <!-- 右侧内容区 -->
      <section class="app-content">
        <!-- Markdown 编辑 -->
        <div v-if="activeFileType === 'markdown'" class="editor-wrap" :class="wrapperClass">
          <MarkdownEditor
            ref="markdownEditorRef"
            v-model="content"
            :height="'100%'"
            :code-theme="codeTheme"
            :view-mode="editorViewMode"
            :image-base-dir="currentDir"
            :app-images-dir="appImagesDir"
            :file-name="fileName"
            @open-file="onMarkdownOpenFile"
            @images-inserted="onImagesInserted"
            @file-saved="onFileSavedExternally"
            @ask-ai="onAskAi"
            @generate-diagram="onGenerateDiagram"
          />
        </div>

        <!-- HTML 编辑（源码 + 实时预览） -->
        <div v-else-if="activeFileType === 'html'" class="editor-wrap" :class="wrapperClass">
          <HtmlEditor
            ref="htmlEditorRef"
            v-model="content"
            :height="'100%'"
            :view-mode="editorViewMode"
            :base-dir="currentDir"
            @ask-ai="onAskAi"
            @generate-diagram="onGenerateDiagram"
          />
        </div>

        <!-- JSON 编辑（源码 + 所见即所得树形视图） -->
        <div v-else-if="activeFileType === 'json'" class="editor-wrap" :class="wrapperClass">
          <JsonEditor
            ref="jsonEditorRef"
            v-model="content"
            :height="'100%'"
            :view-mode="editorViewMode"
            @ask-ai="onAskAi"
            @generate-diagram="onGenerateDiagram"
          />
        </div>

        <!-- 文本编辑（txt / sql / xml 等） -->
        <TextEditor
          ref="textEditorRef"
          v-else-if="activeFileType === 'text'"
          v-model="content"
          @ask-ai="onAskAi"
          @generate-diagram="onGenerateDiagram"
        />

        <!-- 图片 / PDF / Office / 压缩包 / 其他二进制预览 -->
        <FilePreview
          v-else-if="
            currentPath &&
            (activeFileType === 'image' ||
              activeFileType === 'pdf' ||
              activeFileType === 'office' ||
              activeFileType === 'archive' ||
              activeFileType === 'other')
          "
          :file-path="currentPath"
          :file-kind="activeFileType"
          @converted="onFileConverted"
        />

        <!-- 空状态 -->
        <div v-else class="empty-state">
          <el-icon :size="64" color="#c0c4cc"><Edit /></el-icon>
          <h3>Markdown 桌面编辑器</h3>
          <p class="empty-hint">
            支持打开目录浏览文件、编辑 Markdown / HTML / JSON 与文本文件、预览图片 / PDF / Office 文档。
            <br />点击上方按钮「打开目录」或「打开文件」开始使用。
          </p>
        </div>
      </section>
    </main>

    <!-- 底部终端面板：在当前目录 / 文件所在目录打开命令行，支持多标签 -->
    <TerminalPanel
      ref="terminalPanelRef"
      :visible="terminalPanelVisible"
      :default-cwd="terminalCwd"
      @close="closeTerminalPanel"
    />

    <!-- 目录树右键菜单 -->
    <teleport to="body">
      <transition name="el-zoom-in-top">
        <div
          v-if="contextMenu.visible && contextMenu.node"
          class="tree-context-menu"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        >
          <div class="ctx-title" :title="contextMenu.node.path">{{ contextMenu.node.name }}</div>
          <div class="ctx-item" @click="createFileAt(contextMenu.node)">
            <el-icon><DocumentAdd /></el-icon>
            <span>新建文件</span>
          </div>
          <div class="ctx-item" @click="createDirAt(contextMenu.node)">
            <el-icon><FolderAdd /></el-icon>
            <span>新建文件夹</span>
          </div>
          <div class="ctx-sep" />
          <div class="ctx-item" @click="renameTreeNode(contextMenu.node)">
            <el-icon><Edit /></el-icon>
            <span>重命名</span>
          </div>
          <div class="ctx-item danger" @click="deleteTreeNode(contextMenu.node)">
            <el-icon><Delete /></el-icon>
            <span>删除</span>
          </div>
          <div class="ctx-sep" />
          <div class="ctx-item" @click="copyTreeNode(contextMenu.node)">
            <el-icon><CopyDocument /></el-icon>
            <span>复制（可粘贴到桌面）</span>
          </div>
          <div class="ctx-item" @click="revealNode(contextMenu.node)">
            <el-icon><FolderOpened /></el-icon>
            <span>在文件夹中显示</span>
          </div>
          <div v-if="!contextMenu.node.isDirectory" class="ctx-item" @click="openWithDefaultNode(contextMenu.node)">
            <el-icon><View /></el-icon>
            <span>用系统默认打开</span>
          </div>
          <div v-if="!contextMenu.node.isDirectory" class="ctx-item" @click="openInNewWindowNode(contextMenu.node)">
            <el-icon><Monitor /></el-icon>
            <span>在新窗口打开</span>
          </div>
          <div v-if="isConvertibleFile(contextMenu.node)" class="ctx-item" @click="convertToMarkdownNode(contextMenu.node)">
            <el-icon><Download /></el-icon>
            <span>转为 Markdown 文件</span>
          </div>
          <template
            v-if="!contextMenu.node.isDirectory && gitRepoRoot && isInsideRepo(gitRepoRoot, contextMenu.node.path)"
          >
            <div class="ctx-sep" />
            <div class="ctx-item" @click="gitDiffNode(contextMenu.node)">
              <el-icon><View /></el-icon>
              <span>查看差异</span>
            </div>
            <div class="ctx-item" @click="gitHistoryNode(contextMenu.node)">
              <el-icon><Clock /></el-icon>
              <span>查看此文件历史</span>
            </div>
            <div class="ctx-item danger" @click="gitRestoreNode(contextMenu.node)">
              <el-icon><RefreshLeft /></el-icon>
              <span>还原此文件</span>
            </div>
            <div class="ctx-item" @click="gitIgnoreNode(contextMenu.node)">
              <el-icon><Hide /></el-icon>
              <span>加入 .gitignore</span>
            </div>
          </template>
          <div class="ctx-sep" />
          <div class="ctx-item" @click="openTerminalAt(contextMenu.node)">
            <el-icon><TerminalIcon /></el-icon>
            <span>在此处打开命令行</span>
          </div>
          <div class="ctx-sep" />
          <div v-if="!contextMenu.node.isDirectory" class="ctx-item" @click="sendToAi(contextMenu.node)">
            <el-icon><MagicStick /></el-icon>
            <span>引用给 AI</span>
          </div>
        </div>
      </transition>
    </teleport>

    <!-- 状态栏 -->
    <footer class="app-footer">
      <span class="footer-item">
        <el-icon><Files /></el-icon>
        {{ currentPath || '未打开文件' }}
      </span>
      <span class="footer-spacer" />
      <template
        v-if="
          activeFileType === 'markdown' ||
          activeFileType === 'html' ||
          activeFileType === 'json' ||
          activeFileType === 'text'
        "
      >
        <span class="footer-item">{{ lineCount }} 行</span>
        <span class="footer-item">{{ wordCount }} 字</span>
      </template>
    </footer>

    <!-- 设置窗口（外观 / 图床 / PlantUML / AI / 文件关联） -->
    <SettingsDialog
      v-model="settingsVisible"
      v-model:view-mode="viewMode"
      v-model:code-theme="codeTheme"
      @open-ai-log="openAiLogFromSettings"
    />

    <!-- AI 助手面板（右侧） -->
    <AiPanel
      ref="aiPanelRef"
      v-model:visible="aiPanelVisible"
      :content="content"
      :selection="aiSelection"
      @apply-content="onAiApplyContent"
      @apply-metadata="onAiApplyMetadata"
      @insert-outline="onAiInsertOutline"
    />

    <!-- AI 调用日志（查看每次大模型请求的参数、响应与 Token 用量） -->
    <AiLogDialog v-model="aiLogVisible" />

    <!-- Git 差异查看 -->
    <GitDiffDialog v-model="gitDiffVisible" :repo-root="gitRepoRoot" :payload="gitDiffPayload" />

    <!-- Git 提交历史 -->
    <GitHistoryDialog v-model="gitHistoryVisible" :repo-root="gitRepoRoot" :file-path="gitHistoryPath" />

    <!-- 从 Git 打开（克隆远程仓库后自动打开该项目目录） -->
    <GitCloneDialog v-model="gitCloneVisible" :default-parent-dir="gitCloneParentDir" @cloned="onGitCloned" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-color-page);
}

/* ========== 顶部工具栏 ========== */
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 52px;
  min-height: 52px;
  background: #fff;
  border-bottom: 1px solid var(--border-color-light);
  user-select: none;
  -webkit-app-region: drag;
}

.app-header .el-button,
.app-header .el-select,
.app-header .el-radio-group {
  -webkit-app-region: no-drag;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  font-size: 16px;
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  flex-wrap: nowrap;
}

/* 顶部菜单按钮组 / 视图切换 / 主题下拉：禁止收缩，避免被挤压换行 */
.header-actions .el-button-group,
.header-actions .el-radio-group,
.header-actions .el-select {
  flex-shrink: 0;
}

.header-file {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  min-width: 0;
  flex-shrink: 0;
}

.header-file.dirty .file-name {
  color: #e6a23c;
}

/* 标题栏可拖拽区域内：按钮需要可点击 */
.header-file .el-button {
  -webkit-app-region: no-drag;
}

.file-name {
  font-size: 13px;
  color: var(--text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-name.clickable {
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 6px;
  transition: background-color 0.15s, color 0.15s;
}

.file-name.clickable:hover {
  background: var(--el-fill-color-light);
  color: var(--color-primary);
}

.rename-input {
  width: 220px;
  max-width: 220px;
  font-size: 13px;
  padding: 3px 8px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  outline: none;
  background: #fff;
  color: var(--text-color-primary);
}

/* ========== 主体 ========== */
.app-main {
  flex: 1;
  min-height: 0;
  padding: 12px;
  display: flex;
  gap: 12px;
  overflow: hidden;
}

/* 侧边栏收起后的展开按钮 */
.sidebar-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1px solid var(--border-color-lighter);
  border-radius: 8px;
  background: #fff;
  color: var(--text-color-secondary);
  cursor: pointer;
  font-size: 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: color 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.sidebar-tab:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
  box-shadow: 0 2px 10px rgba(64, 158, 255, 0.2);
}

/* 左侧目录树 */
.app-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 260px;
  min-width: 180px;
  max-width: 480px;
  background: #fff;
  border: 1px solid var(--border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

/* 侧边栏宽度拖动条 */
.sidebar-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.15s;
}

.sidebar-resizer:hover {
  background: rgba(64, 158, 255, 0.3);
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color-lighter);
  flex-shrink: 0;
}

.sidebar-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-primary);
  min-width: 0;
}

.sidebar-dirname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.sidebar-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

/* 最近打开的目录 */
.sidebar-recent {
  flex-shrink: 0;
  max-height: 42%;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-top: 1px solid var(--border-color-lighter);
  overflow: auto;
}

/* 收起态：仅保留标题栏，不出现滚动条 */
.sidebar-recent.collapsed {
  max-height: none;
  overflow: hidden;
}

.recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 4px;
}

.sidebar-recent.collapsed .recent-header {
  padding-bottom: 0;
}

/* 标题栏左侧：点击可展开 / 收起 */
.recent-header-left {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  cursor: pointer;
  user-select: none;
}

.recent-header-left:hover .recent-title,
.recent-header-left:hover .recent-arrow {
  color: var(--text-color-primary);
}

.recent-arrow {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text-color-secondary);
}

.recent-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.recent-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-secondary);
}

.recent-empty {
  padding: 2px 6px 6px;
  font-size: 12px;
  color: var(--text-color-secondary);
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-color-primary);
  transition: background-color 0.12s;
}

.recent-item:hover {
  background: var(--el-fill-color-light);
}

.recent-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--color-primary);
}

.recent-icon {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--color-primary);
}

.recent-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.recent-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-path {
  font-size: 11px;
  color: var(--text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-remove {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text-color-secondary);
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
}

.recent-item:hover .recent-remove {
  opacity: 1;
}

.recent-remove:hover {
  color: #f56c6c;
}

.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  /* 作为树节点内容（flex）的子项：占满剩余宽度且允许收缩，避免长文件名撑破侧边栏被直接裁剪 */
  flex: 1;
  min-width: 0;
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 允许收缩到小于内容宽度，从而真正触发省略号，供 v-overflow-tip 检测溢出并显示完整名称 */
  min-width: 0;
}

/* 目录树节点上的 Git 状态徽标 */
.git-badge {
  flex: 0 0 auto;
  margin-left: 6px;
  font-family: Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

/* 右侧内容 */
.app-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.editor-wrap {
  width: 100%;
  height: 100%;
}

/* 编辑模式：只显示源码，隐藏预览 */
.view-edit :deep(.preview-pane) {
  display: none;
}
.view-edit :deep(.source-pane) {
  flex: 1 1 100%;
}

/* 预览模式由组件内部 viewMode 处理，隐藏源码 */

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: #909399;
}

.empty-state h3 {
  margin: 0;
  color: var(--text-color-primary);
}

.empty-hint {
  margin: 0;
  text-align: center;
  line-height: 1.8;
  font-size: 13px;
}

/* ========== 状态栏 ========== */
.app-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 30px;
  min-height: 30px;
  background: #fff;
  border-top: 1px solid var(--border-color-light);
  font-size: 12px;
  color: var(--text-color-secondary);
  user-select: none;
}

.footer-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-spacer {
  flex: 1;
}

/* ========== 目录树右键菜单 ========== */
.tree-context-menu {
  position: fixed;
  z-index: 3000;
  width: 190px;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  user-select: none;
}

.ctx-title {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color-lighter);
  margin-bottom: 4px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text-color-primary);
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.12s;
}

.ctx-item:hover {
  background: var(--el-fill-color-light);
  color: var(--color-primary);
}

.ctx-item.danger {
  color: #f56c6c;
}

.ctx-item.danger:hover {
  background: var(--el-color-danger-light-9);
  color: #f56c6c;
}

.ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-color-lighter);
}
</style>

<style>
/* 拖动侧边栏时：禁用文本选中，全程显示拖拽光标 */
body.sidebar-resizing {
  cursor: col-resize;
  user-select: none;
}

body.sidebar-resizing .sidebar-resizer {
  background: rgba(64, 158, 255, 0.3);
}

/* 拖动 Git 面板高度时：禁用文本选中，全程显示纵向拖拽光标 */
body.git-panel-resizing {
  cursor: ns-resize;
  user-select: none;
}

body.git-panel-resizing .git-resizer {
  background: rgba(64, 158, 255, 0.3);
}
</style>
