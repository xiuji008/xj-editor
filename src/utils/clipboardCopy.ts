/**
 * 剪贴板写入：纯文本 / 富文本 HTML / PNG 图片。
 *
 * 富文本优先用「隐藏容器 + 选区 + execCommand('copy')」：
 * Chromium 会把选中的 DOM 序列化成 text/html 放进剪贴板，微信 / 知乎 / 掘金的
 * 编辑器对这种「原生复制」接受度最好（ClipboardItem 写入在部分平台被降级）。
 * 失败时再退回异步剪贴板 API。
 */

/** execCommand 兜底写纯文本 */
function copyTextByExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;'
  document.body.appendChild(textarea)
  let ok = false
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}

/** 复制纯文本（Markdown 源码 / 纯文本） */
export async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 权限被拒时走兜底 */
  }
  return copyTextByExecCommand(text)
}

/** 复制结果：mode = rich（剪贴板为 HTML）| plain（只有纯文本兜底，粘贴出来是 HTML 源文本） */
export interface RichCopyResult {
  ok: boolean
  mode: 'rich' | 'plain'
}

/**
 * 复制富文本：剪贴板内容就是 HTML 本身（单通道语义，对齐 markdown-nice）。
 * text/html 与 text/plain 均放 HTML 字符串——粘到公众号/知乎/掘金得到排版，
 * 粘到 txt/记事本得到 HTML 源文本，都不会出现 Markdown 源码。
 *
 * @param html 已内联样式的 HTML 片段
 */
export async function copyRichHtml(html: string): Promise<RichCopyResult> {
  // 桌面端（Electron）：主进程直写系统剪贴板，不依赖文档焦点/用户手势，
  // 避免渲染进程 execCommand 失败时退化成纯文本
  try {
    if (window.mdAPI?.writeRichHtml) {
      const res = await window.mdAPI.writeRichHtml(html, html)
      if (res?.ok) return { ok: true, mode: 'rich' }
      // IPC 失败时继续走下面的浏览器路径兜底
    }
  } catch {
    /* 忽略 IPC 异常，走兜底 */
  }

  const holder = document.createElement('div')
  holder.setAttribute('data-md-copy-holder', '')
  // 必须真实可见地排版（opacity:0 不影响复制），否则部分浏览器会丢掉内联样式
  holder.style.cssText =
    'position:fixed;left:-99999px;top:0;width:677px;opacity:0;pointer-events:none;z-index:-1;'
  holder.innerHTML = html
  document.body.appendChild(holder)

  let ok = false
  const selection = window.getSelection()
  const restoreRanges: Range[] = []
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) restoreRanges.push(selection.getRangeAt(i))
  }

  try {
    const range = document.createRange()
    range.selectNodeContents(holder)
    selection?.removeAllRanges()
    selection?.addRange(range)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    selection?.removeAllRanges()
    // 还原用户原来的选区（避免复制后编辑器选区被清空）
    for (const r of restoreRanges) {
      try {
        selection?.addRange(r)
      } catch {
        /* 选区已失效时忽略 */
      }
    }
    holder.remove()
  }

  if (ok) return { ok: true, mode: 'rich' }

  // 兜底：异步剪贴板 API，text/html 与 text/plain 均为 HTML
  try {
    const items: Record<string, Blob> = {
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([html], { type: 'text/plain' }),
    }
    await navigator.clipboard.write([new ClipboardItem(items)])
    return { ok: true, mode: 'rich' }
  } catch {
    // 最坏情况：只能写纯文本，内容也是 HTML 源文本（不会出现 Markdown 源码）
    const plainOk = copyTextByExecCommand(html)
    return { ok: plainOk, mode: 'plain' }
  }
}

/** 复制 PNG 图片到剪贴板 */
export async function copyImageBlob(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
