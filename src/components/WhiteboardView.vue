<template>
  <div class="whiteboard-view">
    <!-- 加载失败 -->
    <div v-if="loadError" class="wb-error">
      <el-icon :size="48" color="#f56c6c"><WarningFilled /></el-icon>
      <p class="wb-error__text">白板加载失败</p>
      <p class="wb-error__hint">{{ loadError }}</p>
      <el-button type="primary" plain size="small" @click="openBoard">重试</el-button>
    </div>

    <!-- React 子树挂载点（Excalidraw 填满容器） -->
    <div v-show="!loadError" ref="containerRef" class="wb-canvas" />

    <!-- 导出下拉（悬浮画布右上角） -->
    <div v-if="ready && !loadError" class="wb-export">
      <el-dropdown trigger="click" @command="onExport">
        <el-button size="small" text :loading="exporting">
          <el-icon class="wb-export__label"><Download /></el-icon>导出
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="png">导出 PNG</el-dropdown-item>
            <el-dropdown-item command="svg">导出 SVG</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { WarningFilled, Download } from '@element-plus/icons-vue'
import { toMdLocalUrl } from '../utils/fileUtils'
import { useTheme } from '../composables/useTheme'
import {
  loadExcalidraw,
  mountExcalidraw,
  type ExcalidrawHandle,
  type ExcalidrawModule,
} from './whiteboard/excalidrawBridge'

const props = defineProps<{
  /** 白板文件绝对路径（.board / .excalidraw，内容为 Excalidraw 开放 JSON） */
  filePath: string
}>()

const { isDark } = useTheme()

const containerRef = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadError = ref('')
const exporting = ref(false)

/** React 实例句柄 */
let handle: ExcalidrawHandle | null = null
/** 动态加载的 Excalidraw 模块（含 exportToBlob / serializeAsJSON 等） */
let exMod: ExcalidrawModule | null = null
/** 最近一次 onChange 的场景快照（保存 / 导出用） */
let sceneElements: readonly unknown[] = []
let sceneAppState: Record<string, unknown> = {}
let sceneFiles: unknown = null
/** 最近一次落盘的序列化结果：onChange 序列化结果与其相同则视为未修改 */
let lastSavedJson = ''
/** 自动保存定时器 */
let saveTimer: number | null = null
/** 组件是否仍存活（异步回调里防串扰） */
let disposed = false
/** 串扰防护：打开文件时的加载序号 */
let loadToken = 0

/* ========== 打开与渲染 ========== */

/** 读取本地白板 JSON 并挂载 Excalidraw */
async function openBoard() {
  const token = ++loadToken
  loadError.value = ''
  ready.value = false
  try {
    const [mod, res] = await Promise.all([
      loadExcalidraw(),
      fetch(toMdLocalUrl(props.filePath)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      }),
    ])
    if (disposed || token !== loadToken) return
    exMod = mod

    // 空文件 / 非法 JSON：以空白画布起步（新建 .board 可能是空文件）
    let initial: { elements?: readonly unknown[]; appState?: Record<string, unknown> } = {}
    const text = (res || '').trim()
    if (text) {
      try {
        const parsed = JSON.parse(text)
        const restored = mod.restore(parsed, null, null) as {
          elements?: readonly unknown[]
          appState?: Record<string, unknown>
        }
        initial = { elements: restored.elements, appState: restored.appState }
      } catch {
        // JSON 解析失败：按空白画布打开，避免整块白板不可用
        ElMessage.warning('白板文件内容不是合法 JSON，已按空白画布打开')
      }
    }
    lastSavedJson = text

    await mountScene(initial)
    if (disposed || token !== loadToken) return
    ready.value = true
  } catch (err: unknown) {
    if (disposed || token !== loadToken) return
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

/** 在容器内挂载 React 子树 */
async function mountScene(initial: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) {
  handle?.unmount()
  handle = null
  if (!containerRef.value) return
  handle = await mountExcalidraw(containerRef.value, {
    initialData: initial,
    theme: isDark.value ? 'dark' : 'light',
    langCode: 'zh-CN',
    onChange: onSceneChange,
  })
}

/** Excalidraw onChange：记录快照 + 防抖自动保存 */
function onSceneChange(elements: readonly unknown[], appState: Record<string, unknown>, files: unknown) {
  sceneElements = elements
  sceneAppState = appState
  sceneFiles = files
  if (!exMod) return
  // 与上次落盘内容一致（如仅视口滚动 / 选中变化）则不打脏
  let json: string
  try {
    json = exMod.serializeAsJSON(elements, appState, files, 'local')
  } catch {
    return
  }
  if (json === lastSavedJson) return
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void saveNow(), 1000)
}

/* ========== 保存 ========== */

/** 序列化当前场景（无模块 / 无场景返回 null） */
function serializeScene(): string | null {
  if (!exMod) return null
  try {
    return exMod.serializeAsJSON(sceneElements, sceneAppState, sceneFiles, 'local')
  } catch {
    return null
  }
}

/** 立即保存（Ctrl+S / 自动保存共用；由 App.vue 全局快捷键路由调用） */
async function saveNow() {
  if (!window.mdAPI || !props.filePath || disposed) return
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const json = serializeScene()
  if (json === null || json === lastSavedJson) return
  try {
    const res = await window.mdAPI.saveFile({ filePath: props.filePath, content: json })
    if (!res?.canceled && props.filePath) {
      lastSavedJson = json
    }
  } catch {
    // 静默失败：下一条 onChange 会再次触发自动保存，用户也可手动 Ctrl+S
  }
}

defineExpose({ saveNow })

/* ========== 导出 ========== */

async function onExport(command: string) {
  if (exporting.value || !exMod || !sceneElements) return
  exporting.value = true
  const baseName = props.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') || '白板'
  try {
    if (command === 'png') {
      const blob = await exMod.exportToBlob({
        elements: sceneElements,
        appState: sceneAppState,
        files: sceneFiles,
        mimeType: 'image/png',
        exportPadding: 16,
      })
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      const res = await window.mdAPI?.saveImageAs({
        source: { type: 'data', dataUrl },
        defaultName: `${baseName}.png`,
      })
      if (res && !res.canceled && !res.error) ElMessage.success('已导出 PNG')
      else if (res?.error) ElMessage.error(`导出失败：${res.error}`)
    } else if (command === 'svg') {
      const svg = await exMod.exportToSvg({
        elements: sceneElements,
        appState: sceneAppState,
        files: sceneFiles,
        exportPadding: 16,
      })
      const xml = new XMLSerializer().serializeToString(svg)
      const res = await window.mdAPI?.saveAs({
        content: xml,
        defaultPath: `${baseName}.svg`,
        filters: [{ name: 'SVG 图片', extensions: ['svg'] }],
      })
      if (res && !res.canceled) ElMessage.success('已导出 SVG')
    }
  } catch (err: unknown) {
    ElMessage.error(`导出失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    exporting.value = false
  }
}

/* ========== 主题与生命周期 ========== */

// 深浅主题切换：仅更新 Excalidraw 的 theme props（重传 initialData 不会重置场景，但为稳妥起见不传）
watch(isDark, (dark) => {
  handle?.update({ theme: dark ? 'dark' : 'light', langCode: 'zh-CN', onChange: onSceneChange })
})

// 同一组件实例下切换白板文件：重开场景
watch(
  () => props.filePath,
  () => {
    if (props.filePath) void openBoard()
  },
)

onMounted(() => {
  void openBoard()
})

onBeforeUnmount(() => {
  disposed = true
  if (saveTimer !== null) clearTimeout(saveTimer)
  handle?.unmount()
  handle = null
})
</script>

<style scoped>
.whiteboard-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-color-page, #f5f7fa);
}

.wb-canvas {
  width: 100%;
  height: 100%;
}

/* 导出下拉：悬浮画布右上角，避开 Excalidraw 顶部工具栏的右侧区域 */
.wb-export {
  position: absolute;
  top: 48px;
  right: 16px;
  z-index: 30;
}

.wb-export__label {
  margin-right: 2px;
}

.wb-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 40px;
}

.wb-error__text {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f56c6c;
}

.wb-error__hint {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
</style>
