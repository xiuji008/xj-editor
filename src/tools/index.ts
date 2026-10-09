/**
 * 工具集统一出口。
 * 宿主只需引入 ToolLauncher 即可获得完整能力：顶部按钮、快捷键、抽屉面板与已注册工具。
 */
import './widgets'

export { default as ToolLauncher } from './ToolLauncher.vue'
export { default as ToolPanel } from './ToolPanel.vue'
export { default as ToolCard } from './ToolCard.vue'
export { default as ToolSection } from './ToolSection.vue'
export { default as ToolWorkspace } from './ToolWorkspace.vue'

export { TOOL_CATEGORIES, TOOL_CATEGORY_MAP, TOOL_FILTERS } from './categories'
export { getTool, listByCategory, listTools, registerTool, registerTools, searchTools } from './registry'
export { isFavorite, pushRecent, readFavorites, readRecent, toggleFavorite } from './storage'
export { provideToolContext, useToolContext, type ToolContext } from './context'
export { useClipboard } from './useClipboard'
export { useToolPanel } from './useToolPanel'
export type { ToolCategory, ToolCategoryKey, ToolDefinition } from './types'
