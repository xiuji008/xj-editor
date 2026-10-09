import { ElMessage } from 'element-plus'

/**
 * 复制到剪贴板的回退实现：当 navigator.clipboard 不可用（如 file:// 环境）时使用。
 *
 * @param text 待复制的文本
 * @returns 是否复制成功
 */
function copyByExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

/**
 * 提供统一的复制能力。
 */
export function useClipboard() {
  /**
   * 复制文本到剪贴板，并通过轻提示反馈结果。
   *
   * @param text 待复制的文本，为空时提示
   * @param tip 复制成功时的提示文案
   * @returns 是否复制成功
   */
  async function copy(text: string, tip = '已复制到剪贴板'): Promise<boolean> {
    if (!text) {
      ElMessage.warning('内容为空，无可复制的数据')
      return false
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else if (!copyByExecCommand(text)) {
        ElMessage.error('复制失败，请手动选择复制')
        return false
      }
      ElMessage.success(tip)
      return true
    } catch {
      ElMessage.error('复制失败，请手动选择复制')
      return false
    }
  }

  return { copy }
}
