import { reactive } from 'vue'
import type { ToolCategoryKey, ToolDefinition } from './types'

/**
 * 已注册工具列表，使用响应式存储以便面板自动刷新。
 */
const tools = reactive<ToolDefinition[]>([])

/**
 * 注册一个工具。重复注册同一 id 时覆盖旧定义（便于热更新与后续扩展）。
 *
 * @param tool 工具定义
 */
export function registerTool(tool: ToolDefinition): void {
  const index = tools.findIndex((item) => item.id === tool.id)
  if (index >= 0) {
    tools.splice(index, 1, tool)
    return
  }
  tools.push(tool)
}

/**
 * 批量注册工具。
 *
 * @param list 工具定义列表
 */
export function registerTools(list: ToolDefinition[]): void {
  list.forEach(registerTool)
}

/**
 * 获取全部工具（只读，按分类权重与名称排序）。
 *
 * @returns 工具定义列表
 */
export function listTools(): readonly ToolDefinition[] {
  return tools as readonly ToolDefinition[]
}

/**
 * 按分类筛选工具。
 *
 * @param category 分类标识
 * @returns 该分类下的工具列表，按 order 与名称排序
 */
export function listByCategory(category: ToolCategoryKey): ToolDefinition[] {
  return sortTools(tools.filter((tool) => tool.category === category))
}

/**
 * 根据 id 获取工具定义。
 *
 * @param id 工具唯一标识
 * @returns 工具定义，未注册时返回 undefined
 */
export function getTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id)
}

/**
 * 按关键词搜索工具，匹配范围包含名称、描述与关键词表。
 *
 * @param keyword 搜索词，大小写不敏感
 * @returns 命中的工具列表
 */
export function searchTools(keyword: string): ToolDefinition[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) {
    return sortTools([...tools])
  }
  return sortTools(
    tools.filter((tool) => {
      const haystack = [tool.id, tool.name, tool.description, ...tool.keywords]
        .join(' ')
        .toLowerCase()
      return haystack.includes(kw)
    }),
  )
}

/**
 * 工具排序：先按 order 权重升序，权重相同时按名称本地化排序。
 *
 * @param list 待排序的工具列表
 * @returns 排序后的新数组
 */
function sortTools(list: ToolDefinition[]): ToolDefinition[] {
  return list.sort((a, b) => {
    const order = (a.order ?? 100) - (b.order ?? 100)
    return order !== 0 ? order : a.name.localeCompare(b.name, 'zh-CN')
  })
}
