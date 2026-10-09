<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, ArrowDown, SwitchButton, Brush, Close, WarningFilled, Clock, CopyDocument, Refresh } from '@element-plus/icons-vue'
import TerminalView from './TerminalView.vue'
import TerminalIcon from './TerminalIcon.vue'
import { loadCommandHistory, clearCommandHistory, type TerminalSessionInfo } from '../utils/terminal'

const props = defineProps<{
  /** 是否显示终端面板 */
  visible: boolean
  /** 新建终端时默认的工作目录（打开的目录，其次当前文件所在目录） */
  defaultCwd: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

/** 终端会话列表（支持多个同时存在） */
const sessions = ref<TerminalSessionInfo[]>([])
/** 当前激活的会话 id */
const activeId = ref('')
/** 系统可用 shell 列表 */
const shells = ref<ShellOption[]>([])
/** 每窗口隔离的存储：shell 选择与面板高度按窗口独立，避免多窗口互相覆盖 */
const winStore: Storage = typeof sessionStorage === 'object' && sessionStorage ? sessionStorage : localStorage
/** 默认 shell（可记忆用户上次选择） */
const defaultShellId = ref(winStore.getItem('md-terminal-shell') || '')
/** 面板高度（像素，可拖拽调整并记忆） */
const panelHeight = ref(Number(winStore.getItem('md-terminal-height') || 240))
/** 终端序号，用于生成「1: PowerShell」形式的标题 */
let titleSeq = 0

/** 暴露给父组件的方法签名 */
type TerminalViewExpose = {
  clearScreen: () => void
  focusInput: () => void
  setDraft: (line: string) => void
  runCommand: (line: string) => void
}
/** 会话 id -> 终端组件实例 */
const viewRefs = new Map<string, TerminalViewExpose>()
/** 当前激活的会话 */
const activeSession = computed(() => sessions.value.find((s) => s.id === activeId.value) || null)
/** 标签右键菜单状态 */
const tabMenu = ref({ visible: false, x: 0, y: 0, id: '' })
/** 右键菜单对应会话的下标（-1 表示未命中） */
const menuIndex = computed(() => sessions.value.findIndex((s) => s.id === tabMenu.value.id))
/** 右键菜单对应会话 */
const menuSession = computed(() => sessions.value[menuIndex.value] || null)
/** 历史命令面板是否展开 */
const historyVisible = ref(false)
/** 历史命令列表（旧的在前，与保存顺序一致） */
const historyList = ref<string[]>([])
/** 历史命令过滤关键字 */
const historyFilter = ref('')
/** 历史命令展示列表（最近的在前） */
const historyItems = computed(() => {
  const query = historyFilter.value.trim().toLowerCase()
  const list = query ? historyList.value.filter((item) => item.toLowerCase().includes(query)) : historyList.value
  return list.slice(-100).reverse()
})

/**
 * 记录终端组件实例，便于执行清屏 / 聚焦等操作
 * @param id 会话 id
 * @param el 组件实例
 */
function setViewRef(id: string, el: unknown) {
  if (el) viewRefs.set(id, el as TerminalViewExpose)
  else viewRefs.delete(id)
}

/** 加载系统可用 shell */
async function loadShells() {
  if (!window.mdAPI) return
  const res = await window.mdAPI.terminal.shells()
  shells.value = res?.shells ?? []
  if (!defaultShellId.value) defaultShellId.value = res?.defaultShellId ?? ''
}

/**
 * 新建终端会话
 * @param cwd 工作目录（为空时使用面板默认目录）
 * @param shellId shell 标识（为空时使用默认 shell）
 */
async function createTerminal(cwd?: string, shellId?: string) {
  if (!window.mdAPI) return
  if (!shells.value.length) await loadShells()
  if (!shells.value.length) {
    ElMessage.error('未检测到可用的命令行程序')
    return
  }
  const res = await window.mdAPI.terminal.start({
    cwd: cwd || props.defaultCwd,
    shellId: shellId || defaultShellId.value || undefined,
  })
  if (!res?.ok || !res.id) {
    ElMessage.error(`终端启动失败：${res?.error || '未知错误'}`)
    return
  }
  const session: TerminalSessionInfo = {
    id: res.id,
    shellId: res.shellId || '',
    shellName: res.shellName || '终端',
    kind: res.kind || 'other',
    cwd: res.cwd || '',
    title: `${++titleSeq}: ${res.shellName || '终端'}`,
    eol: res.eol || '\n',
    echoesPrompt: !!res.echoesPrompt,
    alive: true,
  }
  sessions.value.push(session)
  activeId.value = session.id
  nextTick(focusActive)
}

/** 新建终端（默认 shell + 默认目录） */
function newTerminal() {
  createTerminal()
}

/**
 * 从下拉菜单选择 shell 新建终端
 * @param shellId shell 标识
 */
function onShellCommand(shellId: string) {
  defaultShellId.value = shellId
  winStore.setItem('md-terminal-shell', shellId)
  createTerminal(undefined, shellId)
}

/**
 * 批量关闭终端会话（运行中的会话先确认，仅确认一次）
 * @param list 待关闭的会话
 */
async function closeSessions(list: TerminalSessionInfo[]) {
  if (!list.length) return
  const running = list.filter((s) => s.alive).length
  if (running) {
    const text =
      list.length === 1
        ? `关闭「${list[0].title}」将终止其中正在运行的命令，确定继续吗？`
        : `将关闭 ${list.length} 个终端（其中 ${running} 个仍在运行），确定继续吗？`
    try {
      await ElMessageBox.confirm(text, '关闭终端', {
        type: 'warning',
        confirmButtonText: '关闭',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  for (const item of list) {
    await window.mdAPI?.terminal.kill(item.id)
    removeSession(item.id)
  }
}

/**
 * 关闭终端会话
 * @param session 会话
 */
function closeSession(session: TerminalSessionInfo) {
  closeSessions([session])
}

/**
 * 打开标签右键菜单
 * @param e 鼠标事件
 * @param session 右键命中的会话
 */
function openTabMenu(e: MouseEvent, session: TerminalSessionInfo) {
  tabMenu.value = { visible: true, x: e.clientX, y: e.clientY, id: session.id }
}

/** 关闭标签右键菜单 */
function closeTabMenu() {
  if (tabMenu.value.visible) tabMenu.value = { ...tabMenu.value, visible: false }
}

/**
 * 取菜单动作对应的会话集合
 * @param action 动作标识
 * @param index 基准下标
 * @returns {TerminalSessionInfo[]} 目标会话
 */
function menuTargets(action: string, index: number): TerminalSessionInfo[] {
  if (index < 0) return []
  if (action === 'close') return [sessions.value[index]]
  if (action === 'closeOthers') return sessions.value.filter((_, i) => i !== index)
  if (action === 'closeLeft') return sessions.value.slice(0, index)
  if (action === 'closeRight') return sessions.value.slice(index + 1)
  if (action === 'closeAll') return sessions.value.slice()
  return []
}

/**
 * 执行标签右键菜单动作
 * @param action 动作标识
 */
async function runMenuAction(action: string) {
  const session = menuSession.value
  const index = menuIndex.value
  closeTabMenu()
  if (!session) return
  if (action === 'copyPath') {
    try {
      await navigator.clipboard.writeText(session.cwd)
      ElMessage.success('已复制工作目录')
    } catch {
      ElMessage.warning('复制失败，请手动复制：' + session.cwd)
    }
    return
  }
  if (action === 'restart') {
    restartSession(session.id)
    return
  }
  await closeSessions(menuTargets(action, index))
}

/** 历史命令面板展开时重新载入已保存的历史 */
function onHistoryShow() {
  historyList.value = loadCommandHistory()
  historyFilter.value = ''
}

/**
 * 把历史命令填入当前终端
 * @param line 命令
 */
function fillHistory(line: string) {
  const view = viewRefs.get(activeId.value)
  if (!view) {
    ElMessage.warning('请先新建一个终端')
    return
  }
  view.setDraft(line)
  historyVisible.value = false
}

/**
 * 直接在当前终端执行历史命令
 * @param line 命令
 */
function runHistory(line: string) {
  const view = viewRefs.get(activeId.value)
  if (!view) {
    ElMessage.warning('请先新建一个终端')
    return
  }
  view.runCommand(line)
  historyVisible.value = false
}

/** 清空全部历史命令 */
function clearHistory() {
  clearCommandHistory()
  historyList.value = []
  ElMessage.success('已清空历史命令')
}

/** 从列表中移除会话并切换激活项 */
function removeSession(id: string) {
  viewRefs.delete(id)
  const index = sessions.value.findIndex((s) => s.id === id)
  if (index >= 0) sessions.value.splice(index, 1)
  if (activeId.value === id) {
    const last = sessions.value[sessions.value.length - 1]
    activeId.value = last ? last.id : ''
  }
}

/** 终止当前终端 */
function killActive() {
  if (activeSession.value) closeSession(activeSession.value)
}

/** 清空当前终端屏幕（保留会话） */
function clearActive() {
  const view = viewRefs.get(activeId.value)
  view?.clearScreen()
}

/** shell 退出时标记会话状态（关闭时不再二次确认） */
function onSessionExit(id: string) {
  const session = sessions.value.find((s) => s.id === id)
  if (session) session.alive = false
}

/**
 * 同步终端内部目录变化（cd 之后重启仍在同一目录）
 * @param payload 会话 id 与新目录
 */
function onCwdChange(payload: { id: string; cwd: string }) {
  const session = sessions.value.find((s) => s.id === payload.id)
  if (session) session.cwd = payload.cwd
}

/**
 * 以相同目录与 shell 重启会话
 * @param id 会话 id
 */
async function restartSession(id: string) {
  const session = sessions.value.find((s) => s.id === id)
  if (!session) return
  const { cwd, shellId } = session
  await window.mdAPI?.terminal.kill(id)
  removeSession(id)
  await createTerminal(cwd, shellId)
}

/** 聚焦当前终端输入框 */
function focusActive() {
  const view = viewRefs.get(activeId.value)
  view?.focusInput()
}

/**
 * 拖拽调整面板高度
 * @param e 鼠标事件
 */
function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  const startY = e.clientY
  const startHeight = panelHeight.value
  document.body.classList.add('term-resizing')
  const onMove = (ev: MouseEvent) => {
    const next = startHeight - (ev.clientY - startY)
    const max = Math.max(160, window.innerHeight - 240)
    panelHeight.value = Math.max(120, Math.min(next, max))
  }
  const onUp = () => {
    document.body.classList.remove('term-resizing')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    winStore.setItem('md-terminal-height', String(Math.round(panelHeight.value)))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 面板显示后自动聚焦命令行
watch(
  () => props.visible,
  (visible) => {
    if (visible) nextTick(focusActive)
  },
)

onMounted(() => {
  loadShells()
  // 点击其它位置 / 窗口变化时收起标签右键菜单
  window.addEventListener('mousedown', closeTabMenu)
  window.addEventListener('resize', closeTabMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', closeTabMenu)
  window.removeEventListener('resize', closeTabMenu)
  // 面板卸载时只回收本窗口创建的会话，避免遗留 shell 子进程（不影响其它窗口）
  window.mdAPI?.terminal.killOwn()
})

defineExpose({
  /**
   * 确保至少存在一个终端
   * @param cwd 指定工作目录
   */
  ensure: (cwd?: string) => (sessions.value.length ? Promise.resolve() : createTerminal(cwd)),
  /**
   * 在指定目录打开新终端
   * @param cwd 工作目录
   */
  openAt: (cwd: string) => createTerminal(cwd),
  /** 聚焦当前终端 */
  focus: focusActive,
})
</script>

<template>
  <div v-show="visible" class="terminal-panel" :style="{ height: `${panelHeight}px` }">
    <div class="term-resizer" title="拖动调整高度" @mousedown="onResizeStart"></div>
    <div class="term-header">
      <span class="term-title">
        <TerminalIcon />
        <span>终端</span>
      </span>
      <div class="term-tabs">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="term-tab"
          :class="{ active: session.id === activeId }"
          :title="session.cwd"
          @click="activeId = session.id"
          @click.middle.prevent="closeSession(session)"
          @contextmenu.prevent="openTabMenu($event, session)"
        >
          <span class="tab-name">{{ session.title }}</span>
          <el-icon v-if="!session.alive" class="tab-status" title="已退出"><WarningFilled /></el-icon>
          <el-icon class="tab-close" @click.stop="closeSession(session)"><Close /></el-icon>
        </div>
      </div>
      <div class="term-actions">
        <el-popover
          v-model:visible="historyVisible"
          placement="bottom-end"
          :width="420"
          trigger="click"
          popper-class="term-history-popper"
          @show="onHistoryShow"
        >
          <template #reference>
            <el-tooltip content="历史命令（终端内 Ctrl+R 可搜索）" placement="top">
              <el-button text size="small" :icon="Clock" />
            </el-tooltip>
          </template>
          <div class="term-history">
            <div class="term-history-head">
              <el-input v-model="historyFilter" size="small" placeholder="过滤历史命令" clearable />
              <el-button size="small" type="danger" text @click="clearHistory">清空</el-button>
            </div>
            <div class="term-history-list">
              <div v-if="!historyItems.length" class="term-history-empty">暂无历史命令</div>
              <div v-for="(item, idx) in historyItems" :key="idx" class="term-history-item">
                <span class="term-history-cmd" :title="item" @click="fillHistory(item)">{{ item }}</span>
                <el-tooltip content="立即执行" placement="top">
                  <el-button text size="small" type="primary" @click="runHistory(item)">执行</el-button>
                </el-tooltip>
              </div>
            </div>
          </div>
        </el-popover>
        <el-tooltip content="新建终端" placement="top">
          <el-button text size="small" :icon="Plus" @click="newTerminal" />
        </el-tooltip>
        <el-tooltip content="选择命令行程序新建" placement="top">
          <el-dropdown trigger="click" placement="bottom-end" @command="onShellCommand">
            <el-button text size="small" :icon="ArrowDown" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="shell in shells" :key="shell.id" :command="shell.id">
                  {{ shell.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>
        <el-tooltip content="清空屏幕" placement="top">
          <el-button text size="small" :icon="Brush" :disabled="!activeSession" @click="clearActive" />
        </el-tooltip>
        <el-tooltip content="终止当前终端" placement="top">
          <el-button
            text
            size="small"
            :icon="SwitchButton"
            :disabled="!activeSession"
            @click="killActive"
          />
        </el-tooltip>
        <el-tooltip content="关闭面板" placement="top">
          <el-button text size="small" :icon="Close" @click="emit('close')" />
        </el-tooltip>
      </div>
    </div>
    <div class="term-main">
      <TerminalView
        v-for="session in sessions"
        :key="session.id"
        v-show="session.id === activeId"
        :ref="(el) => setViewRef(session.id, el)"
        :session="session"
        :active="session.id === activeId"
        @exit="onSessionExit"
        @restart="restartSession"
        @cwd-change="onCwdChange"
      />
      <div v-if="!sessions.length" class="term-empty">
        <el-button size="small" :icon="Plus" @click="newTerminal">新建终端</el-button>
        <span class="term-empty-tip">将在「{{ defaultCwd || '当前目录' }}」中打开命令行</span>
      </div>
    </div>
    <!-- 标签右键菜单：关闭 / 关闭左侧 / 关闭右侧 / 关闭其他 / 关闭全部 -->
    <div
      v-if="tabMenu.visible"
      class="term-tab-menu"
      :style="{ left: `${tabMenu.x}px`, top: `${tabMenu.y}px` }"
      @mousedown.stop
      @contextmenu.prevent
    >
      <div class="menu-item" @click="runMenuAction('close')">关闭</div>
      <div class="menu-item" :class="{ disabled: menuIndex <= 0 }" @click="runMenuAction('closeLeft')">
        关闭左侧标签
      </div>
      <div
        class="menu-item"
        :class="{ disabled: menuIndex < 0 || menuIndex >= sessions.length - 1 }"
        @click="runMenuAction('closeRight')"
      >
        关闭右侧标签
      </div>
      <div class="menu-item" :class="{ disabled: sessions.length <= 1 }" @click="runMenuAction('closeOthers')">
        关闭其他标签
      </div>
      <div class="menu-item" @click="runMenuAction('closeAll')">关闭全部</div>
      <div class="menu-sep"></div>
      <div class="menu-item" @click="runMenuAction('restart')">
        <el-icon class="menu-icon"><Refresh /></el-icon>
        重启终端
      </div>
      <div class="menu-item" @click="runMenuAction('copyPath')">
        <el-icon class="menu-icon"><CopyDocument /></el-icon>
        复制工作目录
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--bg-color-overlay, #fff);
  border-top: 1px solid var(--el-border-color-light);
}

.term-resizer {
  height: 4px;
  cursor: ns-resize;
  flex-shrink: 0;
}

.term-resizer:hover {
  background: var(--el-color-primary-light-5);
}

.term-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
}

.term-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.term-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.term-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 2px 4px 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.term-tab:hover {
  background: var(--el-fill-color-light);
}

.term-tab.active {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-status {
  color: var(--el-color-warning);
  font-size: 12px;
}

.tab-close {
  font-size: 12px;
  border-radius: 3px;
}

.tab-close:hover {
  color: var(--el-color-danger);
  background: var(--el-fill-color-dark);
}

.term-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.term-main {
  position: relative;
  flex: 1;
  min-height: 0;
}

.term-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--el-text-color-secondary);
}

.term-empty-tip {
  font-size: 12px;
}

.term-tab-menu {
  position: fixed;
  z-index: 3000;
  min-width: 148px;
  padding: 4px 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.term-tab-menu .menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.term-tab-menu .menu-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.term-tab-menu .menu-item.disabled {
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
}

.term-tab-menu .menu-item.disabled:hover {
  background: transparent;
  color: var(--el-text-color-placeholder);
}

.term-tab-menu .menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--el-border-color-lighter);
}

.term-tab-menu .menu-icon {
  font-size: 12px;
}

.term-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.term-history-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.term-history-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}

.term-history-empty {
  padding: 8px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.term-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.term-history-cmd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  cursor: pointer;
}

.term-history-item:hover .term-history-cmd {
  color: var(--el-color-primary);
}
</style>

<style>
/* 拖拽调整终端面板高度时锁定鼠标样式与文本选中 */
body.term-resizing {
  cursor: ns-resize;
  user-select: none;
}
</style>
