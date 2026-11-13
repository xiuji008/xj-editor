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

    <!-- AI 画图入口（悬浮画布右上角，位于导出下拉左侧） -->
    <div v-if="ready && !loadError" class="wb-ai">
      <el-button size="small" text :type="aiPanelVisible ? 'primary' : ''" @click="aiPanelVisible = !aiPanelVisible">
        <el-icon class="wb-ai__label"><MagicStick /></el-icon>AI 画图
      </el-button>
    </div>

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

    <!-- AI 画图面板（右侧覆盖抽屉） -->
    <WhiteboardAiPanel
      v-if="ready && !loadError"
      :visible="aiPanelVisible"
      :workspace-root="workspaceRoot || ''"
      :scene-summary="buildSceneSummary"
      :apply-pending="applyPending"
      :discard-pending="discardPending"
      @update:visible="aiPanelVisible = $event"
      @undo="onUndoLastApply"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { WarningFilled, Download, MagicStick } from '@element-plus/icons-vue'
import { toMdLocalUrl } from '../utils/fileUtils'
import { useTheme } from '../composables/useTheme'
import { emitBusEvent, type WhiteboardPendingPayload } from '../utils/excalidraw/agentBus'
import { validateSpec } from '../utils/excalidraw/specSchema'
import { compileSpec } from '../utils/excalidraw/sceneCompiler'
import WhiteboardAiPanel from './WhiteboardAiPanel.vue'
import {
  loadExcalidraw,
  mountExcalidraw,
  type ExcalidrawApiLike,
  type ExcalidrawHandle,
  type ExcalidrawModule,
} from './whiteboard/excalidrawBridge'

const props = defineProps<{
  /** 白板文件绝对路径（.board / .excalidraw，内容为 Excalidraw 开放 JSON） */
  filePath: string
  /** 当前 workspace 根目录（agent skill 扫描用） */
  workspaceRoot?: string
}>()

const { isDark } = useTheme()

const containerRef = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadError = ref('')
const exporting = ref(false)
const aiPanelVisible = ref(false)

/** React 实例句柄 */
let handle: ExcalidrawHandle | null = null
/** Excalidraw 实例 API（agent 写画布 / 摘要用） */
let apiRef: ExcalidrawApiLike | null = null
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
/** agent 生成的待插入产物：pendingId -> { elements, summary, mode } */
const pendingMap = new Map<string, { elements: unknown[]; summary: string; mode: 'append' | 'replace' }>()
/** agent 应用前的场景快照栈（撤销上次插入用，最多 10 层） */
const undoStack: unknown[][] = []
/** 工具调用订阅取消函数（agent 反向 IPC） */
let unsubToolCall: (() => void) | null = null

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
  apiRef = null
  if (!containerRef.value) return
  handle = await mountExcalidraw(containerRef.value, {
    initialData: initial,
    theme: isDark.value ? 'dark' : 'light',
    langCode: 'zh-CN',
    onChange: onSceneChange,
    excalidrawAPI: (api) => {
      apiRef = api
    },
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

defineExpose({ saveNow, undoLastApply })

/* ========== Agent：工具执行（反向 IPC） ========== */

/** 画布摘要（模型上下文，不给全量 JSON） */
function buildSceneSummary(): {
  elementCount: number
  typeCounts: Record<string, number>
  selected: Array<{ id: string; type: string; text: string }>
  note: string
} {
  const typeCounts: Record<string, number> = {}
  for (const el of sceneElements as Array<Record<string, unknown>>) {
    const type = String(el?.type || 'unknown')
    typeCounts[type] = (typeCounts[type] || 0) + 1
  }
  const selectedIds = new Set(Object.keys((sceneAppState.selectedElementIds as Record<string, unknown>) || {}))
  const selected: Array<{ id: string; type: string; text: string }> = []
  for (const el of sceneElements as Array<Record<string, unknown>>) {
    if (!selectedIds.has(String(el?.id || ''))) continue
    const text = typeof el?.text === 'string' ? el.text.slice(0, 80) : ''
    selected.push({ id: String(el?.id || ''), type: String(el?.type || ''), text })
    if (selected.length >= 30) break
  }
  return {
    elementCount: sceneElements.length,
    typeCounts,
    selected,
    note: 'selected 仅在用户框选了元素时非空；画布为空时 elementCount 为 0',
  }
}

/** 执行 agent 工具调用（agent.cjs 反向下发） */
async function executeAgentTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'whiteboard_get_scene') return buildSceneSummary()
  if (name === 'whiteboard_apply_elements') return generatePending(args)
  throw new Error(`未知工具：${name}`)
}

async function handleAgentToolCall(call: { runId: string; callId: string; name: string; args: Record<string, unknown> }) {
  try {
    const data = await executeAgentTool(call.name, call.args || {})
    window.mdAPI?.agent.toolResult({ runId: call.runId, callId: call.callId, ok: true, data })
  } catch (err) {
    window.mdAPI?.agent.toolResult({
      runId: call.runId,
      callId: call.callId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 编译 spec 生成待插入产物 + 预览（不直接落画布，等待用户确认） */
async function generatePending(args: Record<string, unknown>): Promise<{
  ok: boolean
  pendingId: string
  summary: string
  elementCount: number
  note: string
}> {
  if (!exMod) throw new Error('Excalidraw 模块未就绪')
  const spec = args?.spec
  const { ok, issues } = validateSpec(spec)
  if (!ok) {
    throw new Error(`spec 校验失败：${issues.map((i) => `${i.path} ${i.message}`).join('；')}`)
  }
  const compiled = compileSpec(spec as never)
  if (!compiled) throw new Error('spec 编译失败')
  const elements = exMod.convertToExcalidrawElements(compiled.skeletons, { regenerateIds: true })
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const mode = args?.mode === 'replace' ? 'replace' : 'append'
  pendingMap.set(pendingId, { elements, summary: compiled.summary, mode })

  // 预览 SVG（img 可直接展示）
  let previewUrl = ''
  try {
    const svg = await exMod.exportToSvg({
      elements,
      appState: { exportBackgroundColor: isDark.value ? '#1d1e20' : '#ffffff' },
      files: null,
      exportPadding: 16,
    })
    const xml = new XMLSerializer().serializeToString(svg)
    previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  } catch {
    previewUrl = ''
  }

  const payload: WhiteboardPendingPayload = {
    pendingId,
    previewUrl,
    elementCount: elements.length,
    summary: compiled.summary,
    mode,
  }
  onBusEventEmit(payload)
  return {
    ok: true,
    pendingId,
    summary: compiled.summary,
    elementCount: elements.length,
    note: '预览已生成并展示给用户，等待用户点击插入/替换；不要重复调用本工具，改用文字告知用户查看预览',
  }
}

/** 触发白板待插入广播（供 AI 面板订阅展示） */
function onBusEventEmit(payload: WhiteboardPendingPayload) {
  emitBusEvent('wb-pending', payload)
}

/** 记录撤销快照（应用前调用） */
function pushUndoSnapshot() {
  undoStack.push([...sceneElements])
  if (undoStack.length > 10) undoStack.shift()
}

/** 应用待插入产物（面板确认后调用） */
function applyPending(pendingId: string, mode?: 'append' | 'replace'): boolean {
  const pending = pendingMap.get(pendingId)
  if (!pending || !apiRef) return false
  pushUndoSnapshot()
  const effective = mode || pending.mode
  const next = effective === 'replace' ? pending.elements : [...sceneElements, ...pending.elements]
  try {
    apiRef.updateScene({ elements: next })
    apiRef.scrollToContent(pending.elements, { fitToViewport: true, viewportZoomFactor: 0.8 })
  } catch (err) {
    console.warn('[whiteboard] applyPending 失败', err)
    return false
  }
  pendingMap.delete(pendingId)
  // updateScene 触发 onChange 后由防抖自动保存；这里再补一次立即保存保证落盘
  setTimeout(() => void saveNow(), 200)
  return true
}

/** 丢弃待插入产物 */
function discardPending(pendingId: string): boolean {
  return pendingMap.delete(pendingId)
}

/** 撤销上次 agent 插入（恢复应用前的场景） */
function undoLastApply(): boolean {
  const snapshot = undoStack.pop()
  if (!snapshot || !apiRef) return false
  try {
    apiRef.updateScene({ elements: snapshot })
    setTimeout(() => void saveNow(), 200)
    return true
  } catch {
    return false
  }
}

/** AI 面板撤销按钮 */
function onUndoLastApply() {
  if (undoLastApply()) ElMessage.success('已撤销上次 AI 插入')
  else ElMessage.warning('没有可撤销的 AI 插入')
}

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
  handle?.update({
    theme: dark ? 'dark' : 'light',
    langCode: 'zh-CN',
    onChange: onSceneChange,
    excalidrawAPI: (api) => {
      apiRef = api
    },
  })
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
  // agent 工具调用监听（白板视图即工具执行器）
  unsubToolCall = window.mdAPI?.agent.onToolCall((call) => {
    void handleAgentToolCall(call)
  }) || null
})

onBeforeUnmount(() => {
  disposed = true
  if (saveTimer !== null) clearTimeout(saveTimer)
  unsubToolCall?.()
  unsubToolCall = null
  handle?.unmount()
  handle = null
  apiRef = null
  pendingMap.clear()
  undoStack.length = 0
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

/* AI 画图按钮：位于导出下拉左侧 */
.wb-ai {
  position: absolute;
  top: 48px;
  right: 96px;
  z-index: 30;
}

.wb-ai__label {
  margin-right: 2px;
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
