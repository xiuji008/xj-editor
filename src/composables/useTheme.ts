import { computed, ref } from 'vue'

/**
 * 应用主题（VS Code 风格）：浅色 / 深色 / 跟随系统。
 *
 * 实现方式：在 `<html>` 上切换 `dark` 类名 ——
 * - Element Plus 组件由 `element-plus/theme-chalk/dark/css-vars.css` 的暗色变量接管；
 * - 自定义样式由 `styles/index.css` 的变量与 `styles/dark.css` 的暗色覆盖接管。
 *
 * 选择保存在 localStorage（键 `md-app-theme`，`index.html` 中的防闪烁脚本使用同一键）。
 */
export type AppTheme = 'light' | 'dark' | 'auto'

const THEME_KEY = 'md-app-theme'
const DARK_CLASS = 'dark'

function readSavedTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
  } catch {
    /* 存储不可用时回退默认值 */
  }
  return 'auto'
}

/** 全局单例状态：同窗口内所有组件共享 */
const theme = ref<AppTheme>(readSavedTheme())

/** 操作系统是否偏好深色（auto 模式跟随） */
const systemDark = ref(false)
try {
  systemDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
} catch {
  /* matchMedia 不可用时按浅色处理 */
}

/** 当前是否处于深色 */
const isDark = computed(() => theme.value === 'dark' || (theme.value === 'auto' && systemDark.value))

/** 将深浅状态落到根元素类名（Element Plus 暗色变量与 dark.css 都依赖 html.dark） */
function applyThemeClass(): void {
  document.documentElement.classList.toggle(DARK_CLASS, isDark.value)
}

/** 设置主题：立即生效并持久化 */
function setTheme(value: AppTheme): void {
  theme.value = value
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  applyThemeClass()
}

/** 浅深互切（工具栏快捷按钮） */
function toggleTheme(): void {
  setTheme(isDark.value ? 'light' : 'dark')
}

/**
 * 应用启动时调用一次：应用当前主题并挂载系统配色 / 多窗口同步监听。
 * `index.html` 的内联脚本已提前设置类名避免首屏闪烁，此处是权威实现。
 */
export function initTheme(): void {
  applyThemeClass()

  // 跟随系统：操作系统切换浅深色时实时响应
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener?.('change', (event) => {
      systemDark.value = event.matches
      applyThemeClass()
    })
  } catch {
    /* 忽略 */
  }

  // 多窗口同步：另一窗口修改主题时，本窗口通过 storage 事件跟随
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY || !event.newValue) return
    if (event.newValue === 'light' || event.newValue === 'dark' || event.newValue === 'auto') {
      theme.value = event.newValue
      applyThemeClass()
    }
  })
}

/** 主题状态与操作（组件内使用） */
export function useTheme() {
  return { theme, isDark, setTheme, toggleTheme }
}
