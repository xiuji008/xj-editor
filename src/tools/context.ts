import { inject, provide, type InjectionKey } from 'vue'

/**
 * 工具与外部宿主（编辑器）交互的上下文。
 * 宿主可通过 provideToolContext 注入实现，工具侧用 useToolContext 获取。
 */
export interface ToolContext {
  /**
   * 判断当前是否支持把结果插入到文档中（需打开文本类文件且编辑器可用）。
   *
   * @returns 可插入返回 true
   */
  canInsert: () => boolean
  /**
   * 把文本插入到文档光标处，存在选区时替换选区。
   *
   * @param text 待插入的文本
   */
  insertText: (text: string) => void
}

/**
 * 依赖注入键。
 */
const TOOL_CONTEXT_KEY: InjectionKey<ToolContext> = Symbol('md-tool-context')

/**
 * 默认上下文：未提供宿主实现时，插入能力不可用，避免工具报错。
 */
const DEFAULT_CONTEXT: ToolContext = {
  canInsert: () => false,
  insertText: () => undefined,
}

/**
 * 宿主调用：向所有后代工具组件提供上下文实现。
 *
 * @param context 上下文实现
 */
export function provideToolContext(context: ToolContext): void {
  provide(TOOL_CONTEXT_KEY, context)
}

/**
 * 工具调用：获取当前宿主上下文。
 *
 * @returns 工具上下文，未注入时返回不可插入的默认实现
 */
export function useToolContext(): ToolContext {
  return inject(TOOL_CONTEXT_KEY, DEFAULT_CONTEXT)
}
