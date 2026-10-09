/**
 * 预览区缩放（放大 / 缩小）通用逻辑。
 *
 * Markdown / HTML 等预览共用：
 * - 缩放范围 25% ~ 500%，步长 10%，可通过 localStorage 持久化；
 * - 支持 Ctrl / Cmd + 滚轮缩放（由调用方在 wheel 事件中调用并 preventDefault）；
 * - HTML 预览为 iframe，需要把缩放写入 iframe 文档，故提供 onChange 回调。
 */
import { computed, ref } from 'vue'

/** 最小缩放比例 */
export const PREVIEW_ZOOM_MIN = 0.25
/** 最大缩放比例 */
export const PREVIEW_ZOOM_MAX = 5
/** 单次缩放步长（10%） */
export const PREVIEW_ZOOM_STEP = 0.1

/** 缩放值归一化：限制在允许范围内并保留两位小数，避免浮点误差（如 0.30000000000000004） */
export function normalizeZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  const clamped = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value))
  return Math.round(clamped * 100) / 100
}

/** 是否为缩放修饰键（Ctrl / Cmd） */
export function isZoomModifier(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return e.ctrlKey || e.metaKey
}

export interface PreviewZoomOptions {
  /** localStorage 持久化 key；不传则不持久化 */
  storageKey?: string
  /** 缩放变化回调（HTML 预览需据此把缩放写入 iframe 文档） */
  onChange?: (zoom: number) => void
}

/** 预览缩放状态与操作 */
export function usePreviewZoom(options: PreviewZoomOptions = {}) {
  const { storageKey, onChange } = options

  /** 读取持久化的缩放值（无记录 / 读取失败时回退 100%） */
  const readStoredZoom = (): number => {
    if (!storageKey) return 1
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return 1
      return normalizeZoom(Number(raw))
    } catch {
      return 1
    }
  }

  const zoom = ref(readStoredZoom())
  /** 缩放百分比的展示文本，如 "120%" */
  const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)
  const canZoomIn = computed(() => zoom.value < PREVIEW_ZOOM_MAX)
  const canZoomOut = computed(() => zoom.value > PREVIEW_ZOOM_MIN)

  /** 设置缩放值（自动限幅 + 持久化 + 回调） */
  const setZoom = (value: number) => {
    const next = normalizeZoom(value)
    if (next === zoom.value) return
    zoom.value = next
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // 忽略持久化失败（如隐私模式）
      }
    }
    onChange?.(next)
  }

  /** 放大一档 */
  const zoomIn = (step = PREVIEW_ZOOM_STEP) => setZoom(zoom.value + step)
  /** 缩小一档 */
  const zoomOut = (step = PREVIEW_ZOOM_STEP) => setZoom(zoom.value - step)
  /** 恢复 100% */
  const resetZoom = () => setZoom(1)

  return {
    zoom,
    zoomPercent,
    canZoomIn,
    canZoomOut,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  }
}
