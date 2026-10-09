/**
 * 快捷 AI 工具函数：动作配置加载 / 保存 / 恢复默认与提示词渲染。
 * 动作与内置提示词由主进程持久化（quick-ai.json），渲染进程只负责展示与调用。
 */
import * as ElementIcons from '@element-plus/icons-vue'
import type { Component } from 'vue'

/** 提示词占位符：发送前替换为待处理内容 */
export const QUICK_PROMPT_PLACEHOLDER = '{content}'

/** 适用范围中文名 */
export const QUICK_SCOPE_LABELS: Record<QuickAiScope, string> = {
  doc: '整篇文档',
  selection: '选中文本',
  auto: '自动（有选中用选中，否则全文）',
}

/** 结果处理方式中文名 */
export const QUICK_APPLY_LABELS: Record<QuickAiApply, string> = {
  replace: '替换全文',
  append: '插入到文末',
  caret: '插入到光标处（替换选中）',
  prepend: '插入到文首',
  outline: '插入到标题之下（概要块）',
  metadata: '更新元数据（合并到文档头部）',
  auto: '自动（有选中插入光标处，否则替换全文）',
}

/** 可选适用范围（下拉用） */
export const QUICK_SCOPE_OPTIONS = (Object.keys(QUICK_SCOPE_LABELS) as QuickAiScope[]).map((value) => ({
  value,
  label: QUICK_SCOPE_LABELS[value],
}))

/** 可选结果处理方式（下拉用） */
export const QUICK_APPLY_OPTIONS = (Object.keys(QUICK_APPLY_LABELS) as QuickAiApply[]).map((value) => ({
  value,
  label: QUICK_APPLY_LABELS[value],
}))

/**
 * 取动作图标组件（图标名来自配置，未知名称回落到默认图标，避免渲染异常）
 * @param {string} name 图标名
 * @returns {Component} 图标组件
 */
export function quickIcon(name: string): Component {
  const icons = ElementIcons as unknown as Record<string, Component>
  return icons[name] || icons.MagicStick
}

/** 读取快捷 AI 动作配置（含内置默认类型与提示词） */
export async function getQuickAiConfig(): Promise<QuickAiConfig> {
  try {
    const cfg = await window.mdAPI?.quickAi?.get()
    if (cfg?.actions?.length) return cfg
  } catch {
    /* 主进程不可用时返回空配置，由调用方降级处理 */
  }
  return { version: 1, actions: [] }
}

/** 保存快捷 AI 动作配置 */
export async function saveQuickAiConfig(
  actions: QuickAiAction[],
): Promise<{ ok: boolean; config?: QuickAiConfig; error?: string }> {
  try {
    const res = await window.mdAPI?.quickAi?.set({ actions: JSON.parse(JSON.stringify(actions)) })
    return res || { ok: false, error: '主进程不可用' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 恢复内置默认提示词：id 为空恢复全部，否则只恢复指定动作（不落盘，返回候选配置） */
export async function resetQuickAiActions(
  id?: string,
): Promise<{ ok: boolean; config?: QuickAiConfig; error?: string }> {
  try {
    const res = await window.mdAPI?.quickAi?.reset({ id: id || '' })
    return res || { ok: false, error: '主进程不可用' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 渲染提示词：把占位符替换为待处理内容。
 * 提示词被改坏（不含占位符）时，把内容追加到末尾，保证请求仍然可用。
 * @param {string} prompt 提示词模板
 * @param {string} content 待处理内容
 * @returns {string} 最终提示词
 */
export function buildQuickPrompt(prompt: string, content: string): string {
  const tpl = (prompt || '').trim()
  const body = content || ''
  if (!tpl) return body
  if (!tpl.includes(QUICK_PROMPT_PLACEHOLDER)) {
    return `${tpl}\n\n${body}`
  }
  return tpl.split(QUICK_PROMPT_PLACEHOLDER).join(body)
}

/**
 * 确定动作的输入内容。
 * @param {QuickAiAction} action 动作配置
 * @param {string} content 当前文档全文
 * @param {string} selection 当前编辑器选中的文本
 * @returns {{ text: string; fromSelection: boolean }} 输入内容与来源
 */
export function resolveQuickInput(
  action: QuickAiAction,
  content: string,
  selection: string,
): { text: string; fromSelection: boolean } {
  const sel = (selection || '').trim()
  if (action.scope === 'selection') return { text: sel, fromSelection: true }
  if (action.scope === 'auto' && sel) return { text: sel, fromSelection: true }
  return { text: content || '', fromSelection: false }
}

/** 解析后的结果应用方式（auto 会被消解为具体方式） */
export type QuickAiApplyMode = Exclude<QuickAiApply, 'auto'>

/**
 * 确定结果应用方式：auto 时按本次实际来源决定（有选中替换选中，否则替换全文）。
 * @param {QuickAiAction} action 动作配置
 * @param {boolean} fromSelection 本次是否以选中文本为输入
 * @returns {QuickAiApplyMode} 结果应用方式
 */
export function resolveQuickApply(action: QuickAiAction, fromSelection: boolean): QuickAiApplyMode {
  if (action.apply !== 'auto') return action.apply
  return fromSelection ? 'caret' : 'replace'
}

/** 新建一个自定义动作（默认作用于选中文本、结果插入到光标处） */
export function createQuickAction(): QuickAiAction {
  return {
    id: `custom-${Date.now()}`,
    name: '自定义动作',
    desc: '自定义提示词，可在设置中修改',
    icon: 'MagicStick',
    scope: 'auto',
    apply: 'auto',
    prompt: `你是一名专业的 Markdown 写作助手。请按下面的要求处理内容：\n1. 保持 Markdown 格式正确；\n2. 只输出处理后的内容，不要添加解释或前后缀。\n\n以下是待处理的内容：\n\`\`\`markdown\n${QUICK_PROMPT_PLACEHOLDER}\n\`\`\``,
    builtin: false,
    enabled: true,
  }
}
