import {
  Clock,
  Connection,
  Document,
  Key,
  MagicStick,
  Menu,
  Star,
  Timer,
} from '@element-plus/icons-vue'
import type { ToolCategory, ToolCategoryKey } from './types'

/**
 * 分组滤镜：列表页左侧排序展示的内置分组。
 * all 为全部工具，favorite 为收藏，recent 为最近使用。
 */
export const TOOL_FILTERS: ToolCategory[] = [
  { key: 'all', name: '全部', icon: Menu, builtIn: true },
  { key: 'favorite', name: '收藏', icon: Star, builtIn: true },
  { key: 'recent', name: '最近使用', icon: Timer, builtIn: true },
]

/**
 * 业务分类：所有具体工具必须归属其中之一。
 */
export const TOOL_CATEGORIES: ToolCategory[] = [
  { key: 'text', name: '文本处理', icon: Document },
  { key: 'encode', name: '编码转换', icon: Connection },
  { key: 'crypto', name: '哈希加密', icon: Key },
  { key: 'time', name: '时间日期', icon: Clock },
  { key: 'generator', name: '生成器', icon: MagicStick },
]

/**
 * 分类标识到分类定义的映射，供卡片快速取用。
 */
export const TOOL_CATEGORY_MAP: Record<ToolCategoryKey, ToolCategory> = TOOL_CATEGORIES.reduce(
  (map, category) => {
    map[category.key as ToolCategoryKey] = category
    return map
  },
  {} as Record<ToolCategoryKey, ToolCategory>,
)
