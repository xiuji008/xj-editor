/**
 * 文本选区定位工具：计算 textarea 中选区末端的位置（视口坐标），
 * 用于实现"选中文本后弹出操作按钮（如问 AI）"等浮动交互。
 *
 * 原理：复制 textarea 的字体、宽度、内边距到隐藏的镜像 div，
 * 按选区前的文本进行排版测量，得到选区末端所在行的位置。
 */

export interface CaretPos {
  /** 选区末端的视口 x 坐标（像素） */
  x: number
  /** 选区末端所在行底部的视口 y 坐标（像素，已减去滚动偏移） */
  y: number
  /** 所在行的行高（像素），用于把浮动提示对齐到该行中线 */
  lineHeight?: number
}

/** 计算 textarea 当前选区末端的位置；无有效选区时返回 null */
export function getTextareaSelectionEndPos(ta: HTMLTextAreaElement): CaretPos | null {
  const start = ta.selectionStart
  const end = ta.selectionEnd
  if (start == null || end == null || start === end) return null
  return getTextareaCaretPos(ta, end)
}

/**
 * 计算 textarea 中指定字符索引所在行的位置（视口坐标）。
 * 用于在粘贴等操作的落点处显示浮动提示。
 *
 * @param ta textarea 元素
 * @param position 字符索引（默认当前光标位置）
 * @returns 行末 x / 行底 y / 行高；索引无效时返回 null
 */
export function getTextareaCaretPos(
  ta: HTMLTextAreaElement,
  position: number = ta.selectionStart,
): CaretPos | null {
  if (position == null || position < 0) return null

  const cs = getComputedStyle(ta)
  const tabSize = parseInt(cs.tabSize || '2', 10) || 2
  const text = ta.value.slice(0, position)

  // 镜像容器：与 textarea 相同的字体 / 宽度 / 内边距 / 换行规则，测量选区末端所在行
  const mirror = document.createElement('div')
  ;[
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'whiteSpace', 'tabSize',
  ].forEach((p) => {
    mirror.style[p] = cs[p]
  })
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.width = `${ta.clientWidth}px`
  mirror.style.boxSizing = 'border-box'
  mirror.textContent = text.replace(/\t/g, ' '.repeat(tabSize))
  // 末尾补一个零宽字符：光标位于空行（含空文档）时也能排出该行，取到正确的行底坐标
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  // 测量选区末端所在行的水平宽度
  const lastLine = text.split('\n').pop() || ''
  const span = document.createElement('span')
  span.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    'top:0',
    'left:0',
    'white-space:pre',
    `font-family:${cs.fontFamily}`,
    `font-size:${cs.fontSize}`,
    `font-weight:${cs.fontWeight}`,
    `font-style:${cs.fontStyle}`,
    `letter-spacing:${cs.letterSpacing}`,
    `tab-size:${cs.tabSize}`,
  ].join(';')
  span.textContent = lastLine.replace(/\t/g, ' '.repeat(tabSize))
  document.body.appendChild(span)

  const lineWidth = span.offsetWidth
  const mirrorHeight = mirror.offsetHeight
  document.body.removeChild(mirror)
  document.body.removeChild(span)

  const rect = ta.getBoundingClientRect()
  const padLeft = parseFloat(cs.paddingLeft) || 0
  const padBottom = parseFloat(cs.paddingBottom) || 0

  const padRight = parseFloat(cs.paddingRight) || 0
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 20
  // 软换行时行的实际宽度会超过内容宽度，x 需钳制在内容区右边界内
  const maxX = rect.left + ta.clientWidth - padRight - ta.scrollLeft

  return {
    // 行末 x：容器左边缘 + 左内边距 + 所在行宽度 - 水平已滚动偏移
    x: Math.min(rect.left + padLeft + lineWidth - ta.scrollLeft, maxX),
    // 行底 y：容器顶 + 内容总高（不含下内边距）- 垂直已滚动偏移
    y: rect.top + (mirrorHeight - padBottom) - ta.scrollTop,
    lineHeight,
  }
}
