/**
 * 显示字体配置。
 *
 * 用户可在「设置 → 外观」中切换字体，字体值通过 CSS 变量下发到全局，
 * 编辑区 / 预览区样式统一引用变量，切换后即时生效，无需重建 DOM。
 *
 * 两组字体独立配置：
 * - 正文字体：Markdown 预览区正文（标题 / 段落 / 表格等，代码块仍用等宽字体）；
 * - 编辑器字体：源码编辑区（Markdown / HTML / JSON / 纯文本）。
 */
export interface FontOption {
  /** 存储与传输使用的值 */
  value: string
  /** 下拉框展示名 */
  label: string
  /** 实际写入 CSS 的 font-family 字体栈（含兜底） */
  stack: string
}

/** 下拉分组 */
export interface FontGroup {
  /** 分组名 */
  label: string
  /** 该组下的字体 */
  options: FontOption[]
}

/** 系统默认字体栈（不含中文指定字体，交给系统兜底） */
const SYSTEM_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

/** 源码编辑区默认等宽字体栈（未设置时保持原有观感） */
const DEFAULT_SOURCE_STACK = "'Consolas', 'JetBrains Mono', 'Courier New', monospace"

/** 可选字体清单（按用途分组，组内为常用 -> 少见） */
export const FONT_GROUPS: FontGroup[] = [
  {
    label: '常用',
    options: [
      { value: 'system', label: '默认字体', stack: SYSTEM_STACK },
      {
        value: 'yahei',
        label: '微软雅黑',
        stack: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif",
      },
      { value: 'simsun', label: '宋体', stack: "'SimSun', 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif" },
      { value: 'simhei', label: '黑体', stack: "'SimHei', 'Heiti SC', 'STHeiti', 'Noto Sans CJK SC', sans-serif" },
      { value: 'kaiti', label: '楷体', stack: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
      { value: 'fangsong', label: '仿宋', stack: "'FangSong', 'STFangsong', 'Fangsong SC', serif" },
      { value: 'lishu', label: '隶书', stack: "'LiSu', 'STLiti', 'Lisu', serif" },
    ],
  },
  {
    label: '书法 / 艺术',
    options: [
      { value: 'youyuan', label: '幼圆', stack: "'YouYuan', 'Yuanti SC', 'Yuanti TC', sans-serif" },
      { value: 'xingkai', label: '华文行楷', stack: "'STXingkai', '华文行楷', 'KaiTi', serif" },
      { value: 'xinwei', label: '华文新魏', stack: "'STXinwei', '华文新魏', 'STZhongsong', serif" },
      { value: 'yaoti', label: '方正姚体', stack: "'FZYaoti', '方正姚体', 'STXingkai', serif" },
      { value: 'shuti', label: '方正舒体', stack: "'FZShuTi', '方正舒体', 'STXingkai', serif" },
      { value: 'caiyun', label: '华文彩云', stack: "'STCaiyun', '华文彩云', 'YouYuan', sans-serif" },
    ],
  },
  {
    label: '西文',
    options: [
      { value: 'arial', label: 'Arial', stack: "Arial, Helvetica, sans-serif" },
      { value: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
      { value: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
      { value: 'verdana', label: 'Verdana', stack: "Verdana, Geneva, sans-serif" },
      { value: 'tahoma', label: 'Tahoma', stack: "Tahoma, Arial, sans-serif" },
      { value: 'palatino', label: 'Palatino', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
    ],
  },
  {
    label: '等宽（适合代码）',
    options: [
      { value: 'consolas', label: 'Consolas', stack: DEFAULT_SOURCE_STACK },
      {
        value: 'cascadia',
        label: 'Cascadia Mono',
        stack: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      },
      {
        value: 'jetbrains',
        label: 'JetBrains Mono',
        stack: "'JetBrains Mono', Consolas, monospace",
      },
      { value: 'sourcecode', label: 'Source Code Pro', stack: "'Source Code Pro', Consolas, monospace" },
      { value: 'menlo', label: 'Menlo / Monaco', stack: "Menlo, Monaco, Consolas, monospace" },
      { value: 'courier', label: 'Courier New', stack: "'Courier New', Courier, monospace" },
      { value: 'yaheimono', label: '微软雅黑 Mono', stack: "'Microsoft YaHei Mono', Consolas, monospace" },
    ],
  },
]

/** 扁平化后的字体清单（用于按 value 查表） */
export const FONT_OPTIONS: FontOption[] = FONT_GROUPS.flatMap((g) => g.options)

/** 正文字体默认值 */
export const DEFAULT_PREVIEW_FONT = 'system'
/** 编辑器字体默认值 */
export const DEFAULT_SOURCE_FONT = 'consolas'

/** CSS 变量：正文字体 */
export const PREVIEW_FONT_VAR = '--md-preview-font'
/** CSS 变量：编辑器字体 */
export const SOURCE_FONT_VAR = '--md-source-font'

/** localStorage 键：正文字体 */
export const PREVIEW_FONT_KEY = 'md-preview-font'
/** localStorage 键：编辑器字体 */
export const SOURCE_FONT_KEY = 'md-source-font'

/**
 * 按存储值取字体项。
 * @param value 字体 value，为空 / 已失效时回退到兜底值
 * @param fallback 兜底 value
 * @returns {FontOption} 命中的字体项，或兜底字体项
 */
export function getFontOption(value: string | null | undefined, fallback: string): FontOption {
  const hit = FONT_OPTIONS.find((f) => f.value === value)
  if (hit) return hit
  return FONT_OPTIONS.find((f) => f.value === fallback) || FONT_OPTIONS[0]
}

/**
 * 取字体的 CSS font-family 字符串。
 * @param value 字体 value
 * @param fallback 兜底 value
 * @returns {string} 可直接写入 font-family 的字体栈
 */
export function getFontStack(value: string | null | undefined, fallback: string): string {
  return getFontOption(value, fallback).stack
}

/**
 * 记录某项字体的 CSS 变量（写入根元素，全作用域生效）。
 * @param varName CSS 变量名
 * @param value 字体 value
 * @param fallback 兜底 value
 */
function setFontVar(varName: string, value: string | null | undefined, fallback: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(varName, getFontStack(value, fallback))
}

/**
 * 把当前选择的字体写入 CSS 变量，使编辑区 / 预览区即时生效。
 * @param source 编辑器字体 value
 * @param preview 正文字体 value
 */
export function applyFonts(source: string, preview: string): void {
  setFontVar(SOURCE_FONT_VAR, source, DEFAULT_SOURCE_FONT)
  setFontVar(PREVIEW_FONT_VAR, preview, DEFAULT_PREVIEW_FONT)
}

/**
 * 读取持久化的字体选择。
 * @param storageKey localStorage 键
 * @param fallback 无记录 / 值失效时的兜底 value
 * @returns {string} 字体 value
 */
export function readStoredFont(storageKey: string, fallback: string): string {
  try {
    return getFontOption(localStorage.getItem(storageKey), fallback).value
  } catch {
    // 隐私模式等场景下 localStorage 不可用，回退默认值
    return fallback
  }
}
