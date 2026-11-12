/**
 * Markdown 源码编辑区底色配置。
 *
 * 用户可在「设置 → 外观 → 编辑区底色」中从内置的几种浅色底中选择，
 * 选择结果通过 CSS 变量 `--md-editor-bg` 下发到全局，源码面板与文本框统一引用，
 * 切换后即时生效。仅浅色模式（`html:not(.dark)`）生效，深色模式保持原有深色底。
 */
export interface EditorBgOption {
  /** 存储使用的值 */
  value: string
  /** 展示名 */
  label: string
  /** 色块颜色（可直接写入 CSS background） */
  color: string
}

/** CSS 变量：编辑区底色 */
export const EDITOR_BG_VAR = '--md-editor-bg'
/** localStorage 键：编辑区底色 */
export const EDITOR_BG_KEY = 'md-editor-bg'

/** 默认底色：与白板一致的浅灰页面底色 */
export const DEFAULT_EDITOR_BG = 'page'

/** 内置浅色底色（均为低饱和度，保证正文对比度） */
export const EDITOR_BG_OPTIONS: EditorBgOption[] = [
  { value: 'page', label: '浅灰', color: 'var(--bg-color-page)' },
  { value: 'white', label: '纯白', color: '#ffffff' },
  { value: 'warm', label: '米白', color: '#faf7f0' },
  { value: 'green', label: '豆绿', color: '#e9f2e7' },
  { value: 'blue', label: '淡蓝', color: '#eef4fb' },
  { value: 'yellow', label: '暖黄', color: '#fdf6e3' },
]

/**
 * 按存储值取底色项，值失效时回退默认项。
 * @param value 底色 value
 * @returns {EditorBgOption} 命中的底色项
 */
export function getEditorBgOption(value: string | null | undefined): EditorBgOption {
  return EDITOR_BG_OPTIONS.find((o) => o.value === value) || EDITOR_BG_OPTIONS[0]
}

/**
 * 把底色写入根元素 CSS 变量，使编辑区即时生效。
 * @param value 底色 value
 */
export function applyEditorBg(value: string | null | undefined): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(EDITOR_BG_VAR, getEditorBgOption(value).color)
}

/**
 * 读取持久化的底色选择。
 * @returns {string} 底色 value
 */
export function readStoredEditorBg(): string {
  try {
    return getEditorBgOption(localStorage.getItem(EDITOR_BG_KEY)).value
  } catch {
    // 隐私模式等场景下 localStorage 不可用，回退默认值
    return DEFAULT_EDITOR_BG
  }
}
