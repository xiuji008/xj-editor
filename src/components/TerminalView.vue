<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
  TerminalBuffer,
  buildPrompt,
  resolveCd,
  loadCommandHistory,
  saveCommandHistory,
  COMMAND_HISTORY_LIMIT,
  type TerminalSessionInfo,
} from '../utils/terminal'

/** 补全候选项 */
interface SuggestItem {
  /** 用于替换输入片段的完整文本 */
  insert: string
  /** 展示名 */
  name: string
  /** 类型：目录 / 文件 / 命令 */
  kind: 'dir' | 'file' | 'command'
}

/** 补全请求结果 */
interface CompletionResult {
  /** 待补全片段起始下标 */
  start: number
  /** 待补全片段原文 */
  token: string
  /** 候选列表 */
  items: SuggestItem[]
  /** 候选公共前缀 */
  common: string
}

const props = defineProps<{
  /** 终端会话信息 */
  session: TerminalSessionInfo
  /** 是否为当前激活的标签 */
  active: boolean
}>()

const emit = defineEmits<{
  /** shell 进程退出 */
  (e: 'exit', id: string): void
  /** 请求以相同目录与 shell 重启 */
  (e: 'restart', id: string): void
  /** 工作目录变化（cd 之后同步给面板，便于按同一目录重启） */
  (e: 'cwd-change', payload: { id: string; cwd: string }): void
}>()

/** 行缓冲（负责 ANSI 解析与行渲染） */
const buffer = new TerminalBuffer()
/** 刷新计数：数据到达后递增，触发视图更新 */
const rev = ref(0)
/** 当前输入内容 */
const draft = ref('')
/** shell 进程是否存活 */
const alive = ref(true)
/** 进程退出码 */
const exitCode = ref(0)
/** 当前工作目录（跟随 cd 命令变化，用于提示符） */
const cwd = ref(props.session.cwd)
/** 滚动容器 */
const scrollRef = ref<HTMLElement | null>(null)
/** 终端根容器（命令执行期间无输入框，用它接收快捷键） */
const viewRef = ref<HTMLElement | null>(null)
/** 输入框 */
const inputRef = ref<HTMLInputElement | null>(null)
/** 命令是否正在执行：执行期间隐藏输入行，执行结束后才显示（同 VS Code） */
const busy = ref(false)
/** 是否显示「执行中」提示（超过一定时长才显示，避免短命令闪烁） */
const showBusyHint = ref(false)

/** 历史命令（持久化在 localStorage，跨会话复用） */
const history = ref<string[]>(loadCommandHistory())
/** 历史命令游标（等于 history.length 表示正在输入新命令） */
let historyIndex = history.value.length
/** 新会话中尚未保存的输入草稿（翻阅历史后回到该内容） */
let draftBackup = ''
/** 补全候选列表 */
const suggestions = ref<SuggestItem[]>([])
/** 候选浮层是否可见 */
const suggestVisible = ref(false)
/** 候选高亮下标 */
const suggestIndex = ref(0)
/** 候选替换起始位置（输入行中的字符下标） */
let suggestStart = 0
/** 候选浮层是否由输入自动弹出（自动弹出时不接管回车与上下键） */
let suggestAuto = false
/** 自动补全请求防抖定时器 */
let suggestTimer: ReturnType<typeof setTimeout> | undefined
/** 补全请求序号：丢弃过期结果，避免覆盖新输入 */
let suggestSeq = 0
/** 历史命令搜索（Ctrl+R）是否打开 */
const searchOpen = ref(false)
/** 历史搜索关键字 */
const searchQuery = ref('')
/** 历史搜索高亮下标（0 为最近匹配） */
const searchIndex = ref(0)
/** 历史搜索输入框 */
const searchRef = ref<HTMLInputElement | null>(null)
/** 有新输出时是否自动滚动到底部（用户向上翻阅时暂停） */
let stickBottom = true
/** 是否有待刷新的输出 */
let dirty = false
/** 动画帧句柄（合并高频输出，避免频繁重排） */
let rafId = 0
/** 数据 / 退出事件解绑函数 */
let stopData: (() => void) | null = null
let stopExit: (() => void) | null = null
/** 静默判定定时器：输出停止一段时间后认为命令执行结束 */
let idleTimer: ReturnType<typeof setTimeout> | undefined
/** 执行中提示定时器 */
let hintTimer: ReturnType<typeof setTimeout> | undefined

/** 输出静默多久判定命令执行结束（毫秒） */
const IDLE_DELAY = 300
/** 提交命令后的最短执行判定时间（毫秒），避免瞬间完成的命令导致输入行闪烁 */
const MIN_BUSY = 400
/** 执行超过多久才显示「执行中」提示（毫秒） */
const HINT_DELAY = 350

/** 全部行的 HTML（依赖 rev 触发重算） */
const allLines = computed(() => {
  void rev.value
  return buffer.htmlLines()
})
/** 除最后一行外的行（最后一行需与输入行拼接显示） */
const headLines = computed(() => allLines.value.slice(0, -1))
/** 最后一行（其后紧跟命令输入） */
const lastLine = computed(() => allLines.value[allLines.value.length - 1] ?? '')
/** 提示符文本（cmd 由 shell 自身输出，此处为空） */
const promptText = computed(() => buildPrompt(props.session.kind, cwd.value))
/** 输入框宽度：按字符数估算，保证光标处可见 */
const inputWidth = computed(() => `${Math.min(1400, Math.max(90, draft.value.length * 7.4 + 18))}px`)
/** 历史命令搜索结果（最近的在前） */
const searchMatches = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const list = query ? history.value.filter((item) => item.toLowerCase().includes(query)) : history.value
  return list.slice(-100).reverse()
})

/** 滚动到底部 */
function scrollToBottom() {
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 合并输出并在激活状态下刷新视图 */
function flush() {
  rafId = 0
  if (!dirty) return
  // 非激活标签暂不刷新，切换回来时再统一渲染
  if (!props.active) return
  dirty = false
  rev.value++
  if (stickBottom) scrollToBottom()
}

/** 标记有新输出，下一帧刷新 */
function markDirty() {
  dirty = true
  if (!rafId) rafId = requestAnimationFrame(flush)
}

/** 清除执行状态相关的定时器 */
function clearBusyTimers() {
  if (idleTimer) clearTimeout(idleTimer)
  if (hintTimer) clearTimeout(hintTimer)
  idleTimer = undefined
  hintTimer = undefined
}

/**
 * 标记为执行中：隐藏输入行，并启动静默计时
 *
 * 管道模式下无法获知命令的真实结束时机，这里按 VS Code 无 shell 集成时的思路：
 * 输出停止 IDLE_DELAY 毫秒即认为命令执行结束。
 */
function markBusy() {
  clearBusyTimers()
  busy.value = true
  showBusyHint.value = false
  hintTimer = setTimeout(() => {
    if (busy.value) showBusyHint.value = true
  }, HINT_DELAY)
  idleTimer = setTimeout(onCommandFinished, MIN_BUSY)
}

/** 收到输出：说明命令仍在运行，重置静默计时 */
function resetIdleTimer() {
  if (!busy.value) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(onCommandFinished, IDLE_DELAY)
}

/** 命令执行结束（输出静默）：恢复输入行并聚焦 */
function onCommandFinished() {
  if (!busy.value) return
  clearBusyTimers()
  busy.value = false
  showBusyHint.value = false
  markDirty()
  if (props.active) {
    nextTick(() => {
      scrollToBottom()
      focusInput()
    })
  }
}

/**
 * 写入文本到缓冲区
 * @param text 输出文本
 */
function writeOutput(text: string) {
  buffer.write(text)
  markDirty()
}

/**
 * 发送一行命令：本地回显 + 写入 shell 输入
 * @param line 命令文本
 */
function sendLine(line: string) {
  writeOutput((props.session.echoesPrompt ? '' : promptText.value) + line + '\n')
  window.mdAPI?.terminal.write({ id: props.session.id, data: line + props.session.eol })
  // 估算目录切换结果，让提示符跟随 cd 变化
  const next = resolveCd(cwd.value, line, props.session.kind)
  if (next) {
    cwd.value = next
    emit('cwd-change', { id: props.session.id, cwd: next })
  }
}

/** 提交输入框中的命令 */
function submit() {
  if (!alive.value) return
  const line = draft.value
  draft.value = ''
  if (line.trim()) {
    if (history.value[history.value.length - 1] !== line) history.value.push(line)
    if (history.value.length > COMMAND_HISTORY_LIMIT) {
      history.value.splice(0, history.value.length - COMMAND_HISTORY_LIMIT)
    }
    saveCommandHistory(history.value)
  }
  historyIndex = history.value.length
  draftBackup = ''
  hideSuggest()
  stickBottom = true
  sendLine(line)
  // 命令执行期间不显示输入行，执行结束后再出现
  markBusy()
  nextTick(scrollToBottom)
}

/**
 * 把命令放入输入框并立即执行（供历史命令面板调用）
 * @param line 命令文本
 */
function runCommand(line: string) {
  if (!alive.value) return
  draft.value = line
  submit()
}

/**
 * 把命令填入输入框（不执行，供历史命令面板调用）
 * @param line 命令文本
 */
function setDraft(line: string) {
  draft.value = line
  nextTick(focusInput)
}

/** 上下方向键翻阅历史命令 */
function navigateHistory(delta: number) {
  if (!history.value.length) return
  // 从最新位置向上翻阅前，先记住当前正在输入的内容
  if (historyIndex === history.value.length) draftBackup = draft.value
  historyIndex = Math.min(history.value.length, Math.max(0, historyIndex + delta))
  draft.value = historyIndex >= history.value.length ? draftBackup : history.value[historyIndex]
  nextTick(() => {
    const el = inputRef.value
    if (el) el.selectionStart = el.selectionEnd = el.value.length
  })
}

/** 关闭候选浮层 */
function hideSuggest() {
  suggestVisible.value = false
  suggestions.value = []
  suggestIndex.value = 0
}

/**
 * 展示候选浮层
 * @param items 候选列表
 * @param start 待替换片段起始下标
 * @param auto 是否由输入自动弹出
 */
function showSuggest(items: SuggestItem[], start: number, auto = false) {
  suggestStart = start
  suggestAuto = auto
  suggestions.value = items.slice(0, 20)
  suggestIndex.value = 0
  suggestVisible.value = suggestions.value.length > 0
}

/**
 * 请求主进程计算当前输入的补全候选
 * @returns {Promise<CompletionResult | null>} 补全结果，不可用时返回 null
 */
async function fetchCompletion(): Promise<CompletionResult | null> {
  if (!window.mdAPI?.terminal.complete) return null
  const cursor = inputRef.value?.selectionStart ?? draft.value.length
  const res = await window.mdAPI.terminal.complete({
    id: props.session.id,
    cwd: cwd.value,
    kind: props.session.kind,
    input: draft.value,
    cursor,
  })
  if (!res?.ok) return null
  return {
    start: res.start ?? 0,
    token: res.token ?? '',
    items: (res.candidates ?? []) as SuggestItem[],
    common: res.commonPrefix ?? '',
  }
}

/**
 * 用候选文本替换待补全片段
 * @param text 替换文本
 * @param start 片段起始下标
 */
function applyInsert(text: string, start: number) {
  const cursor = inputRef.value?.selectionStart ?? draft.value.length
  const value = draft.value.slice(0, start) + text + draft.value.slice(cursor)
  draft.value = value
  nextTick(() => {
    const el = inputRef.value
    if (el) el.selectionStart = el.selectionEnd = value.length
  })
}

/** Tab 键补全：唯一候选直接补全，多候选补到公共前缀并弹出候选提示 */
async function completeInput() {
  // 浮层已展开时再按 Tab：轮换选中项，并转为手动模式（回车可确认）
  if (suggestVisible.value && suggestions.value.length) {
    suggestAuto = false
    suggestIndex.value = (suggestIndex.value + 1) % suggestions.value.length
    return
  }
  const res = await fetchCompletion()
  if (!res) return
  if (!res.items.length) {
    hideSuggest()
    return
  }
  if (res.items.length === 1) {
    applyInsert(res.items[0].insert, res.start)
    hideSuggest()
    return
  }
  // 先补到公共前缀，再展示候选：行为贴近 bash
  if (res.common.length > res.token.length) applyInsert(res.common, res.start)
  showSuggest(res.items, res.start)
}

/**
 * 接受浮层中当前高亮的候选
 * @returns {boolean} 已接受返回 true
 */
function acceptSuggestion(): boolean {
  const item = suggestions.value[suggestIndex.value]
  if (!item) return false
  applyInsert(item.insert, suggestStart)
  hideSuggest()
  return true
}

/** 输入变化后延迟请求补全，自动提示可选文件 / 命令 */
function scheduleSuggest() {
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq
    if (!draft.value.trim()) {
      hideSuggest()
      return
    }
    const res = await fetchCompletion()
    // 输入已变化：丢弃本次结果
    if (seq !== suggestSeq) return
    if (!res || res.items.length < 2) {
      hideSuggest()
      return
    }
    showSuggest(res.items, res.start, true)
  }, 150)
}

/** 打开历史命令搜索（Ctrl+R） */
function openHistorySearch() {
  if (!alive.value || searchOpen.value) return
  searchOpen.value = true
  searchQuery.value = ''
  searchIndex.value = 0
  nextTick(() => searchRef.value?.focus())
}

/** 关闭历史命令搜索 */
function closeHistorySearch() {
  searchOpen.value = false
  searchQuery.value = ''
  searchIndex.value = 0
  nextTick(focusInput)
}

/** 执行历史搜索中选中的命令 */
function runHistoryItem() {
  const item = searchMatches.value[searchIndex.value]
  closeHistorySearch()
  if (item) runCommand(item)
}

/** 把历史搜索中选中的命令填入输入框 */
function fillHistoryItem() {
  const item = searchMatches.value[searchIndex.value]
  closeHistorySearch()
  if (item) setDraft(item)
}

/**
 * 历史命令搜索框的按键处理
 * @param e 键盘事件
 */
function onSearchKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'Escape') {
    e.preventDefault()
    fillHistoryItem()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    runHistoryItem()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (searchIndex.value < searchMatches.value.length - 1) searchIndex.value += 1
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (searchIndex.value > 0) searchIndex.value -= 1
    return
  }
  if (mod && (e.key === 'r' || e.key === 'R')) {
    // 连续 Ctrl+R：切换到上一条匹配
    e.preventDefault()
    if (searchMatches.value.length) {
      searchIndex.value = (searchIndex.value + 1) % searchMatches.value.length
    }
  }
}

/** Ctrl+C：有选中文本时保留复制行为，否则中断当前输入 / 发送中断符 */
function interrupt(e: KeyboardEvent) {
  const selection = window.getSelection()
  if (selection && selection.toString()) return
  e.preventDefault()
  const prefix = props.session.echoesPrompt ? '' : promptText.value
  writeOutput(draft.value ? `${prefix}${draft.value}^C\n` : '^C\n')
  draft.value = ''
  window.mdAPI?.terminal.write({ id: props.session.id, data: '\x03' })
  // 中断后命令即将结束，重新计时以便尽快恢复输入行
  resetIdleTimer()
}

function onKeydown(e: KeyboardEvent) {
  if (!alive.value) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'r' || e.key === 'R')) {
    // Ctrl+R：反向搜索历史命令（阻止浏览器刷新）
    e.preventDefault()
    openHistorySearch()
    return
  }
  if (e.key === 'Escape') {
    // 关闭候选提示（有提示时优先，否则保留默认行为）
    if (suggestVisible.value) {
      e.preventDefault()
      hideSuggest()
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    // 手动唤出的候选浮层：回车先接受候选，避免执行未完成补全的命令
    if (suggestVisible.value && !suggestAuto && acceptSuggestion()) return
    submit()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (suggestVisible.value && !suggestAuto && suggestions.value.length > 1) {
      suggestIndex.value = (suggestIndex.value + suggestions.value.length - 1) % suggestions.value.length
      return
    }
    navigateHistory(-1)
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (suggestVisible.value && !suggestAuto && suggestions.value.length > 1) {
      suggestIndex.value = (suggestIndex.value + 1) % suggestions.value.length
      return
    }
    navigateHistory(1)
    return
  }
  if (e.key === 'Tab') {
    // Tab：文件 / 目录 / 命令补全，避免把焦点移走
    e.preventDefault()
    completeInput()
    return
  }
  if (mod && (e.key === 'c' || e.key === 'C')) {
    interrupt(e)
    return
  }
  if (mod && (e.key === 'l' || e.key === 'L')) {
    // Ctrl+L：清屏（等同 clear / cls）
    e.preventDefault()
    buffer.clear()
    markDirty()
  }
}

/**
 * 粘贴处理：多行内容逐行执行，最后一行留在输入框待确认
 * @param e 粘贴事件
 */
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!text.includes('\n') && !text.includes('\r')) return
  e.preventDefault()
  const lines = text.replace(/\r/g, '').split('\n')
  const last = lines.pop() ?? ''
  for (const line of lines) sendLine(line)
  draft.value = last
  stickBottom = true
  markBusy()
  nextTick(scrollToBottom)
}

/** 用户向上翻阅时暂停自动滚动 */
function onScroll() {
  const el = scrollRef.value
  if (!el) return
  stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
}

/** 点击终端区域聚焦（正在选择文本时不抢占焦点）；执行期间输入框隐藏，聚焦容器以便接收 Ctrl+C */
function focusInput() {
  if (!alive.value) return
  const selection = window.getSelection()
  if (selection && selection.toString()) return
  if (busy.value) viewRef.value?.focus()
  else inputRef.value?.focus()
}

/**
 * 命令执行期间的按键处理（此时没有输入框，由容器接收）
 * @param e 键盘事件
 */
function onViewKeydown(e: KeyboardEvent) {
  if (!alive.value || !busy.value) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'c' || e.key === 'C')) {
    interrupt(e)
    return
  }
  if (mod && (e.key === 'l' || e.key === 'L')) {
    // Ctrl+L：清屏（等同 clear / cls）
    e.preventDefault()
    buffer.clear()
    markDirty()
  }
}

/** 清空屏幕（保留会话） */
function clearScreen() {
  buffer.clear()
  markDirty()
}

// 输入变化时自动提示文件 / 命令候选
watch(draft, () => {
  if (!searchOpen.value) scheduleSuggest()
})

// 激活时重新渲染并聚焦
watch(
  () => props.active,
  (active) => {
    if (!active) return
    nextTick(() => {
      if (dirty) flush()
      else scrollToBottom()
      focusInput()
    })
  },
)

onMounted(() => {
  // 启动提示：展示 shell 名称与工作目录
  buffer.write(`\x1b[90m${props.session.shellName} · ${props.session.cwd}\x1b[0m\r\n`)
  rev.value++
  stopData =
    window.mdAPI?.terminal.onData((payload) => {
      if (payload?.id !== props.session.id) return
      buffer.write(payload.data || '')
      markDirty()
      // 还在输出说明命令没结束，推迟输入行的出现
      resetIdleTimer()
    }) ?? null
  stopExit =
    window.mdAPI?.terminal.onExit((payload) => {
      if (payload?.id !== props.session.id) return
      alive.value = false
      // 进程已退出：清理执行状态与定时器
      clearBusyTimers()
      busy.value = false
      showBusyHint.value = false
      exitCode.value = payload.code ?? 0
      buffer.write(`\x1b[90m\r\n[进程已退出，退出码 ${exitCode.value}]\x1b[0m\r\n`)
      markDirty()
      emit('exit', props.session.id)
    }) ?? null
  if (props.active) nextTick(focusInput)
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  clearBusyTimers()
  if (suggestTimer) clearTimeout(suggestTimer)
  stopData?.()
  stopExit?.()
})

defineExpose({ clearScreen, focusInput, setDraft, runCommand, getHistory: () => history.value.slice() })
</script>

<template>
  <div
    ref="viewRef"
    class="term-view"
    tabindex="-1"
    @click="focusInput"
    @keydown="onViewKeydown"
  >
    <div ref="scrollRef" class="term-scroll" @scroll="onScroll">
      <div class="term-lines">
        <div v-for="(line, idx) in headLines" :key="idx" class="term-line" v-html="line"></div>
        <div class="term-line term-line-last">
          <span v-html="lastLine"></span>
          <template v-if="!alive">
            <span class="term-exit">已退出（代码 {{ exitCode }}）</span>
            <el-button link type="primary" size="small" @click="emit('restart', session.id)">
              重新启动
            </el-button>
          </template>
          <template v-else-if="busy">
            <!-- 命令执行期间不显示输入行，执行结束后自动恢复（同 VS Code） -->
            <span v-if="showBusyHint" class="term-busy">命令执行中…（Ctrl+C 中断）</span>
          </template>
          <template v-else-if="searchOpen">
            <span class="term-search-label">(reverse-i-search)`{{ searchQuery }}':</span>
            <input
              ref="searchRef"
              v-model="searchQuery"
              class="term-input term-search-input"
              spellcheck="false"
              autocomplete="off"
              @keydown="onSearchKeydown"
              @blur="closeHistorySearch"
            />
            <span class="term-search-hit">{{ searchMatches[searchIndex] || '' }}</span>
            <span class="term-search-tip">
              ↑↓ 选择 · Enter 执行 · Esc 填入 · Ctrl+R 换一条（共 {{ searchMatches.length }} 条）
            </span>
          </template>
          <template v-else>
            <span v-if="promptText" class="term-prompt">{{ promptText }}</span>
            <input
              ref="inputRef"
              v-model="draft"
              class="term-input"
              :style="{ width: inputWidth }"
              spellcheck="false"
              autocomplete="off"
              @keydown="onKeydown"
              @paste="onPaste"
            />
          </template>
        </div>
      </div>
      <!-- 补全候选提示：Tab 补全有多个候选时列出 -->
      <div v-if="suggestVisible" class="term-suggest">
        <div class="term-suggest-tip">Tab 补全 · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
        <div
          v-for="(item, idx) in suggestions"
          :key="`${item.kind}-${item.name}-${idx}`"
          class="term-suggest-item"
          :class="{ active: idx === suggestIndex }"
          @mousedown.prevent="
            applyInsert(item.insert, suggestStart);
            hideSuggest()
          "
        >
          <span class="suggest-kind">{{ item.kind === 'dir' ? '目录' : item.kind === 'command' ? '命令' : '文件' }}</span>
          <span class="suggest-name">{{ item.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term-view {
  position: relative;
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  color: #d4d4d4;
  outline: none;
}

.term-busy {
  color: #8c8c8c;
  opacity: 0.8;
}

.term-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 8px 12px 12px;
  font-family: Consolas, 'Courier New', 'Microsoft YaHei Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  cursor: text;
}

.term-lines {
  min-height: 100%;
}

.term-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.term-line-last {
  /* 末行与输入行同处一行：shell 输出提示符未换行时输入自然接续其后 */
  display: block;
}

.term-prompt {
  color: #4ec9b0;
}

.term-input {
  display: inline-block;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  caret-color: #409eff;
}

.term-exit {
  margin-left: 8px;
  color: #909399;
}

.term-search-label {
  color: #dcdcaa;
}

.term-search-input {
  min-width: 60px;
  color: #dcdcaa;
}

.term-search-hit {
  margin-left: 10px;
  color: #9cdcfe;
}

.term-search-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #6a6a6a;
}

.term-suggest {
  position: absolute;
  left: 12px;
  bottom: 8px;
  z-index: 20;
  width: min(520px, calc(100% - 24px));
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: #252526;
  box-shadow: 0 6px 16px rgb(0 0 0 / 40%);
}

.term-suggest-tip {
  padding: 2px 8px 4px;
  font-size: 12px;
  color: #6a6a6a;
}

.term-suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.term-suggest-item.active {
  background: #094771;
}

.suggest-kind {
  flex-shrink: 0;
  min-width: 28px;
  color: #6a6a6a;
}

.suggest-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
