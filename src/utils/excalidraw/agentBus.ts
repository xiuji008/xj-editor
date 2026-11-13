/**
 * 白板 Agent 内部事件总线（极简发布订阅，无依赖）。
 *
 * 用于「渲染进程工具执行器（WhiteboardView）」与「AI 面板（WhiteboardAiPanel）」
 * 之间的解耦通信：工具执行器产出预览后广播，面板订阅展示并回调插入/丢弃。
 */

export interface WhiteboardPendingPayload {
  /** 待插入产物标识（applyScene 用） */
  pendingId: string
  /** 预览 SVG 的 dataUrl（img 可直接展示） */
  previewUrl: string
  /** 元素数量 */
  elementCount: number
  /** 面向用户的一句话摘要（模型 spec 的 title / 布局） */
  summary: string
  /** 该产物建议的插入方式 */
  mode: 'append' | 'replace'
}

type BusHandler = (payload: unknown) => void

const handlers = new Map<string, Set<BusHandler>>()

/** 订阅事件，返回取消订阅函数 */
export function onBusEvent(type: string, handler: BusHandler): () => void {
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(handler)
  return () => {
    set?.delete(handler)
  }
}

/** 发布事件（无订阅者时静默忽略） */
export function emitBusEvent(type: string, payload: unknown): void {
  const set = handlers.get(type)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(payload)
    } catch {
      /* 单个订阅者异常不影响其它订阅者 */
    }
  }
}
