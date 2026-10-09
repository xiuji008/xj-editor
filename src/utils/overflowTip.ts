/**
 * 溢出文本提示指令（渲染进程使用）。
 *
 * 用于目录树等带省略号截断的文本：鼠标移入时若文本实际溢出（scrollWidth > clientWidth），
 * 在元素上方显示完整的文本提示，鼠标移出后自动消失。
 * 使用单例 tooltip 元素，避免为每个节点创建独立提示实例。
 *
 * 用法：<span v-overflow-tip="fullText" class="tree-node">...</span>
 *
 * @module utils/overflowTip
 */

import type { Directive } from 'vue'

/** 单例提示元素 */
let tipEl: HTMLDivElement | null = null
/** 延迟显示计时器 */
let showTimer: number | null = null
/** 当前处于 hover 的目标元素（用于延迟后确认仍在原元素上） */
let activeEl: HTMLElement | null = null

/** 指令挂载 / 卸载时的监听器引用（保证 addEventListener / removeEventListener 使用同一函数） */
const enterHandlers = new WeakMap<HTMLElement, () => void>()
const leaveHandlers = new WeakMap<HTMLElement, () => void>()

function getTipEl(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'overflow-tip'
    document.body.appendChild(tipEl)
  }
  return tipEl
}

/** 展示提示：优先显示在目标元素上方居中，上方空间不足时显示在下方 */
function showTip(target: HTMLElement, text: string) {
  const el = getTipEl()
  el.textContent = text
  el.style.display = 'block'
  const rect = target.getBoundingClientRect()
  const tipW = el.offsetWidth
  const tipH = el.offsetHeight
  let left = rect.left + rect.width / 2 - tipW / 2
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8))
  let top = rect.top - tipH - 8
  if (top < 8) top = rect.bottom + 8
  top = Math.max(8, Math.min(top, window.innerHeight - tipH - 8))
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

/** 隐藏提示 */
function hideTip() {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (tipEl) tipEl.style.display = 'none'
  activeEl = null
}

/** 鼠标移入：文本溢出则延迟展示完整名称 */
function onEnter(target: HTMLElement, text: string) {
  const label = target.querySelector<HTMLElement>('.tree-label')
  const el = label || target
  // 未溢出（文本完整显示）时不展示提示
  if (el.scrollWidth <= el.clientWidth + 1) return
  activeEl = target
  showTimer = window.setTimeout(() => {
    showTimer = null
    // 延迟期间鼠标已移出则不再展示
    if (activeEl === target) showTip(target, text)
  }, 250)
}

/** 鼠标移出：立即隐藏 */
function onLeave() {
  hideTip()
}

/**
 * 溢出文本提示指令。
 * 指令值：完整文本（可为空字符串，表示不展示提示）。
 */
export const vOverflowTip: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    el.dataset.overflowTip = binding.value
    const enter = () => onEnter(el, el.dataset.overflowTip || '')
    const leave = onLeave
    enterHandlers.set(el, enter)
    leaveHandlers.set(el, leave)
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
  },
  updated(el, binding) {
    // 名称变化（如重命名）时同步提示内容
    el.dataset.overflowTip = binding.value
  },
  unmounted(el) {
    const enter = enterHandlers.get(el)
    const leave = leaveHandlers.get(el)
    if (enter) el.removeEventListener('mouseenter', enter)
    if (leave) el.removeEventListener('mouseleave', leave)
    enterHandlers.delete(el)
    leaveHandlers.delete(el)
    hideTip()
  },
}
