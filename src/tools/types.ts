import type { Component } from 'vue'

/**
 * 工具分类标识。
 * 新增分类时在此处扩展，并在 categories.ts 中补充分类定义。
 */
export type ToolCategoryKey = 'text' | 'encode' | 'crypto' | 'time' | 'generator' | 'dev'

/**
 * 工具分类定义。
 */
export interface ToolCategory {
  /** 分类唯一标识 */
  key: ToolCategoryKey | 'all' | 'favorite' | 'recent'
  /** 分类展示名称 */
  name: string
  /** 分类图标（Element Plus 图标组件） */
  icon: Component
  /** 是否为「全部 / 收藏 / 最近」这类内置分组，用于控制列表渲染位置 */
  builtIn?: boolean
}

/**
 * 工具定义。
 * 一个工具 = 一份元数据 + 一个按需加载的组件，新增工具无需改动路由或菜单。
 */
export interface ToolDefinition {
  /** 工具唯一标识，建议使用短横线命名，如 json-formatter */
  id: string
  /** 工具展示名称 */
  name: string
  /** 一句话说明，展示在卡片与搜索结果中 */
  description: string
  /** 所属分类 */
  category: ToolCategoryKey
  /** 卡片图标（Element Plus 图标组件） */
  icon: Component
  /** 搜索关键词，用于模糊匹配（支持中英文） */
  keywords: string[]
  /** 工具组件（动态 import，构建时自动分包） */
  component: () => Promise<{ default: Component }>
  /** 同分类内的排序权重，数值越小越靠前，默认 100 */
  order?: number
  /** 卡片右上角角标，用于标记新上线或实验性工具 */
  badge?: 'new' | 'beta'
}
