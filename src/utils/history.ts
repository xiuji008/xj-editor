/**
 * 文本域撤销 / 重做历史管理（组合式函数）
 *
 * 由于 textarea 的 value 由父组件通过 :value 受控，程序化赋值会破坏浏览器
 * 原生撤销栈（Ctrl+Z 失效），因此这里实现自定义的历史栈：
 * - 通过 beforeinput 捕获改动前的状态（value + 光标），保证快照精确
 * - 连续输入（默认 800ms 窗口）合并为一步撤销
 * - 工具栏插入 / 查找替换 / Tab 等离散操作（force）始终为独立一步
 * - 撤销 / 重做后同步恢复对应的光标位置
 *
 * @module utils/history
 */

import { computed, ref, type Ref } from 'vue'

export interface HistorySnapshot {
  value: string
  start: number
  end: number
  time: number
}

/** 历史记录上限 */
const HISTORY_LIMIT = 200
/** 连续输入合并窗口（毫秒）：窗口内的连续输入合并为一步撤销 */
const COALESCE_MS = 800

/** beforeinput 阶段捕获的改动前状态 */
interface PendingSnapshot {
  value: string
  start: number
  end: number
}

export function useTextareaHistory(opts: {
  /** 获取当前 textarea 元素 */
  getTextarea: () => HTMLTextAreaElement | undefined
  /** 获取当前内容（textarea 未就绪时的兜底） */
  getValue: () => string
  /** 应用某个历史快照的内容（通常 emit update:modelValue） */
  applyValue: (value: string) => void
}) {
  const undoStack: Ref<HistorySnapshot[]> = ref([])
  const redoStack: Ref<HistorySnapshot[]> = ref([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  /** beforeinput 时记录改动前的状态，供 input 时作为撤销快照 */
  let pending: PendingSnapshot | null = null

  function capturePending(snap: PendingSnapshot): void {
    pending = snap
  }

  /**
   * 记录一个历史快照；force=true 时忽略连续输入合并（用于工具栏插入等离散操作）。
   * 快照内容为改动前的状态：优先取 beforeinput 捕获的状态，否则取当前值 + 光标。
   */
  function push(force = false): void {
    const ta = opts.getTextarea()
    const now = Date.now()
    const last = undoStack.value[undoStack.value.length - 1]
    // 连续输入：仅更新时间戳，不新增快照
    if (!force && last && now - last.time < COALESCE_MS) {
      last.time = now
      pending = null
      return
    }
    const pre: PendingSnapshot = pending || {
      value: opts.getValue(),
      start: ta?.selectionStart ?? 0,
      end: ta?.selectionEnd ?? 0,
    }
    pending = null
    redoStack.value = []
    undoStack.value.push({ ...pre, time: now })
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
  }

  /** 应用快照：同步设置 textarea 的值与光标，再通知父组件 */
  function applySnapshot(snap: HistorySnapshot): void {
    const ta = opts.getTextarea()
    if (ta) {
      ta.value = snap.value
      // 先设置选区再聚焦：程序化赋值后浏览器会把选区重置到文末，
      // 若先 focus 再 setSelectionRange，focus 的异步滚动会跳到文末。
      ta.setSelectionRange(
        Math.min(snap.start, snap.value.length),
        Math.min(snap.end, snap.value.length),
      )
      ta.focus()
    }
    opts.applyValue(snap.value)
  }

  /** 撤销一步 */
  function undo(): void {
    const snap = undoStack.value.pop()
    if (!snap) return
    const ta = opts.getTextarea()
    redoStack.value.push({
      value: ta ? ta.value : opts.getValue(),
      start: ta?.selectionStart ?? 0,
      end: ta?.selectionEnd ?? 0,
      time: Date.now(),
    })
    applySnapshot(snap)
  }

  /** 重做一步 */
  function redo(): void {
    const snap = redoStack.value.pop()
    if (!snap) return
    undoStack.value.push(snap)
    applySnapshot(snap)
  }

  /** 清空历史（切换文件 / 新建文件时调用） */
  function reset(): void {
    undoStack.value = []
    redoStack.value = []
    pending = null
  }

  return { push, undo, redo, reset, canUndo, canRedo, capturePending }
}
