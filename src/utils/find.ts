/**
 * 文本查找辅助工具：计算关键词匹配位置、滚动 textarea 到指定偏移处。
 * 供 FindBar 组件（Markdown / 文本编辑器内的查找替换）使用。
 */

/** 在文本中查找关键词的所有起始偏移；忽略大小写时对两个字符串同时小写 */
export function computeMatches(text: string, keyword: string, caseSensitive: boolean): number[] {
  if (!keyword) return []
  const source = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? keyword : keyword.toLowerCase()
  const res: number[] = []
  const step = needle.length || 1
  let idx = source.indexOf(needle)
  while (idx !== -1) {
    res.push(idx)
    idx = source.indexOf(needle, idx + step)
  }
  return res
}

/**
 * 滚动 textarea 使指定文本偏移处可见（一般配合选中该位置）。
 * 通过 Range.getClientRects 获取光标在视口内的位置，再换算为滚动偏移，
 * 该方案天然兼容自动换行与水平滚动。
 */
export function scrollTextareaToOffset(ta: HTMLTextAreaElement, offset: number) {
  const pos = Math.min(Math.max(offset, 0), ta.value.length)
  try {
    const range = new Range()
    range.setStart(ta, pos)
    range.setEnd(ta, pos)
    const rects = range.getClientRects()
    if (rects && rects.length > 0) {
      // 自动换行时光标可能落在两行交界处，取最后一个矩形
      const caret = rects[rects.length - 1]
      const taRect = ta.getBoundingClientRect()
      const lineTop = caret.top - taRect.top + ta.scrollTop
      const lineBottom = lineTop + caret.height
      const charX = caret.left - taRect.left + ta.scrollLeft
      const viewH = ta.clientHeight
      const viewW = ta.clientWidth

      let st = ta.scrollTop
      if (lineTop < st) st = Math.max(0, lineTop)
      else if (lineBottom > st + viewH) st = Math.max(0, lineBottom - viewH)
      ta.scrollTop = st

      let sl = ta.scrollLeft
      if (charX < sl) sl = Math.max(0, charX)
      else if (charX > sl + viewW) sl = Math.max(0, charX - viewW + 16)
      ta.scrollLeft = sl
      return
    }
  } catch {
    /* Range 不可用时回退到按行号估算 */
  }
  // 回退方案：按行号 × 行高估算垂直滚动位置（忽略自动换行的折行）
  const lineIndex = ta.value.slice(0, pos).split('\n').length - 1
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18
  const target = Math.max(0, lineIndex * lineHeight)
  if (target < ta.scrollTop) ta.scrollTop = target
  else if (target + lineHeight > ta.scrollTop + ta.clientHeight) ta.scrollTop = target + lineHeight - ta.clientHeight
}
