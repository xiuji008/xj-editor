/**
 * JS 脚本运行器（渲染进程单例状态）
 *
 * 统一管理「脚本输出面板」的显示与运行状态，供两处调用：
 * - .js 文件编辑器顶部的「运行」按钮（App.vue）
 * - Markdown ```js 代码块的「运行」按钮（markdown.ts 的事件委托）
 *
 * 实际执行走主进程 script.cjs（Node 子进程），输出经 window.mdAPI.script
 * 流式回传，本模块负责订阅并聚合到响应式状态，由 ScriptOutputPanel 渲染。
 *
 * @module utils/scriptRunner
 */

import { ref } from 'vue'

/** 输出行 */
export interface ScriptOutputLine {
  /** 输出流：stdout 标准输出 / stderr 标准错误 / system 系统提示 */
  stream: 'stdout' | 'stderr' | 'system'
  /** 输出文本 */
  text: string
}

/** 运行参数 */
export interface ScriptRunPayload {
  /** 代码片段（与 filePath 二选一） */
  code?: string
  /** 脚本文件路径（与 code 二选一） */
  filePath?: string
  /** 工作目录 */
  cwd?: string
  /** 超时（毫秒） */
  timeoutMs?: number
}

/** 输出面板是否可见 */
export const scriptPanelVisible = ref(false)
/** 是否有脚本正在运行 */
export const scriptRunning = ref(false)
/** 当前运行的脚本描述（文件名 / 代码片段） */
export const scriptLabel = ref('')
/** 最近一次退出码（null 表示尚未退出或未运行） */
export const scriptExitCode = ref<number | null>(null)
/** 输出行列表 */
export const scriptLines = ref<ScriptOutputLine[]>([])
/** 输出行累计上限，超出后丢弃最旧的行，避免长输出撑爆内存 */
const MAX_LINES = 2000

/** 当前会话 id */
let sessionId = ''
/** 是否已订阅主进程事件 */
let subscribed = false
/** 订阅取消函数 */
let offData: (() => void) | null = null
let offExit: (() => void) | null = null

/** 追加一行输出（按上限裁剪） */
function append(stream: ScriptOutputLine['stream'], text: string): void {
  if (!text) return
  scriptLines.value.push({ stream, text })
  if (scriptLines.value.length > MAX_LINES) {
    scriptLines.value.splice(0, scriptLines.value.length - MAX_LINES)
  }
}

/** 从路径 / 片段描述生成标签 */
function describe(payload: ScriptRunPayload): string {
  if (payload.filePath) {
    const parts = payload.filePath.split(/[\\/]/)
    return parts[parts.length - 1] || payload.filePath
  }
  return '代码片段'
}

/** 订阅主进程脚本事件（只订阅一次，按会话 id 过滤） */
function ensureSubscribed(): void {
  if (subscribed || !window.mdAPI?.script) return
  offData = window.mdAPI.script.onData((payload) => {
    if (payload.id !== sessionId) return
    append(payload.stream, payload.data)
  })
  offExit = window.mdAPI.script.onExit((payload) => {
    if (payload.id !== sessionId) return
    scriptRunning.value = false
    scriptExitCode.value = payload.code
    sessionId = ''
  })
  subscribed = true
}

/** 清空输出与状态 */
export function clearScriptOutput(): void {
  scriptLines.value = []
  scriptExitCode.value = null
}

/** 停止当前正在运行的脚本 */
export function stopScript(): void {
  if (sessionId) window.mdAPI?.script?.kill(sessionId)
  sessionId = ''
  scriptRunning.value = false
}

/** 关闭面板（若仍在运行则先停止） */
export function closeScriptPanel(): void {
  if (scriptRunning.value) stopScript()
  scriptPanelVisible.value = false
}

/**
 * 运行脚本：打开面板并启动执行。
 * @param payload 运行参数（code / filePath + cwd + timeoutMs）
 */
export async function runScript(payload: ScriptRunPayload): Promise<void> {
  // 已有运行中的脚本时先终止，避免并发串台
  if (scriptRunning.value) stopScript()

  scriptPanelVisible.value = true
  scriptRunning.value = true
  scriptExitCode.value = null
  clearScriptOutput()
  scriptLabel.value = describe(payload)

  // 非桌面环境（浏览器预览）：无主进程能力，仅提示
  if (!window.mdAPI?.script) {
    append('system', '仅桌面版支持运行脚本\n')
    scriptRunning.value = false
    return
  }

  ensureSubscribed()
  const res = await window.mdAPI.script.run(payload)
  if (!res?.ok || !res.id) {
    append('stderr', `${res?.error || '脚本启动失败'}\n`)
    scriptRunning.value = false
    return
  }
  sessionId = res.id
  const target = payload.filePath || '<snippet>'
  append('system', `$ node ${target}   (工作目录: ${res.cwd})\n`)
}
