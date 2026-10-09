/**
 * JSON 工具通用函数：缩进、体积格式化、错误定位与结构排序。
 */

/** 缩进选项：2 空格、4 空格或 Tab */
export type IndentOption = '2' | '4' | 'tab'

/** JSON 解析错误信息 */
export interface JsonErrorInfo {
  /** 原始错误信息 */
  message: string
  /** 出错行号（1 基），无法定位时为 null */
  line: number | null
  /** 出错列号（1 基），无法定位时为 null */
  column: number | null
  /** 出错字符偏移（0 基），无法定位时为 null */
  position: number | null
}

/**
 * 把缩进选项转换为实际缩进字符串。
 *
 * @param option 缩进选项
 * @returns 缩进字符串
 */
export function indentString(option: IndentOption): string {
  return option === 'tab' ? '\t' : ' '.repeat(Number(option))
}

/**
 * 按字符数格式化体积文案。
 *
 * @param size 字符数
 * @returns 形如 `12.3 KB` 的文案
 */
export function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} 字符`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 统计文本行数。使用 indexOf 递增查找，避免 split 在超大文本上产生大数组。
 *
 * @param text 文本内容
 * @returns 行数（空文本为 1 行）
 */
export function countLines(text: string): number {
  let count = 1
  let index = text.indexOf('\n')
  while (index !== -1) {
    count++
    index = text.indexOf('\n', index + 1)
  }
  return count
}

/**
 * 计算字符偏移所在的行列号（均为 1 基）。
 *
 * @param text 文本内容
 * @param position 字符偏移
 * @returns 行号与列号
 */
export function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const safePosition = Math.max(0, Math.min(position, text.length))
  let line = 1
  let lastBreak = -1
  let index = text.indexOf('\n')
  while (index !== -1 && index < safePosition) {
    line++
    lastBreak = index
    index = text.indexOf('\n', index + 1)
  }
  return { line, column: safePosition - lastBreak }
}

/**
 * 解析 JSON 异常，尽量提取出错位置（不同浏览器错误信息格式不同）。
 *
 * @param error 捕获到的异常
 * @param text 触发异常的原始文本，用于换算行列号
 * @returns 错误信息与定位
 */
export function describeJsonError(error: unknown, text: string): JsonErrorInfo {
  const message = error instanceof Error ? error.message : String(error)
  const positionMatch = /position\s+(\d+)/.exec(message)
  if (positionMatch) {
    const position = Number(positionMatch[1])
    if (position >= 0 && position <= text.length) {
      const { line, column } = positionToLineColumn(text, position)
      return { message, line, column, position }
    }
  }
  const lineColumnMatch = /line\s+(\d+)\s+column\s+(\d+)/.exec(message)
  if (lineColumnMatch) {
    return { message, line: Number(lineColumnMatch[1]), column: Number(lineColumnMatch[2]), position: null }
  }
  return { message, line: null, column: null, position: null }
}

/**
 * 递归排序对象键名，数组保持原有顺序。
 *
 * @param value 任意 JSON 值
 * @returns 键名已排序的新结构，不修改入参
 */
export function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonKeys(item))
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    Object.keys(source)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .forEach((key) => {
        result[key] = sortJsonKeys(source[key])
      })
    return result
  }
  return value
}

/**
 * 序列化 JSON 值，序列化失败时回退为字符串拼接，保证 UI 不会抛错。
 *
 * @param value 任意 JSON 值
 * @param indent 缩进字符串，为空表示压缩输出
 * @returns 序列化文本
 */
export function stringifyJson(value: unknown, indent?: string): string {
  try {
    return JSON.stringify(value, null, indent)
  } catch {
    return String(value)
  }
}
