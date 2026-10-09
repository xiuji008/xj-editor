<template>
  <div class="tool-panel">
    <!-- 工具工作区：打开具体工具后占据整个面板 -->
    <ToolWorkspace v-if="activeTool" :tool="activeTool" @back="backToList" />

    <!-- 工具列表：搜索 + 分类 + 卡片网格 -->
    <template v-else>
      <div class="panel-filter">
        <div class="panel-search">
          <el-input v-model="keyword" placeholder="搜索工具" clearable :prefix-icon="Search" />
        </div>
        <div class="filter-group">
          <div
            v-for="filter in TOOL_FILTERS"
            :key="filter.key"
            :class="['filter-item', { active: activeFilter === filter.key }]"
            @click="activeFilter = filter.key"
          >
            <el-icon :size="15"><component :is="filter.icon" /></el-icon>
            <span>{{ filter.name }}</span>
            <span class="filter-count">{{ countOf(filter.key) }}</span>
          </div>
        </div>
        <div class="filter-divider" />
        <div class="filter-group">
          <div
            v-for="category in TOOL_CATEGORIES"
            :key="category.key"
            :class="['filter-item', { active: activeFilter === category.key }]"
            @click="activeFilter = category.key"
          >
            <el-icon :size="15"><component :is="category.icon" /></el-icon>
            <span>{{ category.name }}</span>
            <span class="filter-count">{{ countOf(category.key) }}</span>
          </div>
        </div>
      </div>

      <div class="panel-content">
        <div v-if="visibleTools.length" class="tool-grid">
          <ToolCard
            v-for="tool in visibleTools"
            :key="tool.id"
            :tool="tool"
            :favorite="favorites.includes(tool.id)"
            @open="handleOpen(tool.id)"
            @toggle-favorite="handleToggleFavorite(tool.id)"
          />
        </div>
        <el-empty v-else description="没有匹配的工具" :image-size="72" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Search } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import { TOOL_CATEGORIES, TOOL_FILTERS } from './categories'
// 副作用导入：确保内置工具已完成注册
import './widgets/index'
import { getTool, searchTools } from './registry'
import { isFavorite, pushRecent, readFavorites, readRecent, toggleFavorite } from './storage'
import ToolCard from './ToolCard.vue'
import ToolWorkspace from './ToolWorkspace.vue'
import type { ToolCategory, ToolDefinition } from './types'
import { useToolPanel } from './useToolPanel'

const { activeToolId, openTool, backToList } = useToolPanel()

/** 搜索关键词 */
const keyword = ref('')
/** 当前选中的分组（内置分组或业务分类） */
const activeFilter = ref<ToolCategory['key']>('all')
/** 收藏的工具 id 列表 */
const favorites = ref<string[]>(readFavorites())
/** 最近使用的工具 id 列表 */
const recent = ref<string[]>(readRecent())

/** 当前打开的工具定义 */
const activeTool = computed(() => (activeToolId.value ? getTool(activeToolId.value) : undefined))

/** 命中搜索关键词的工具列表 */
const matchedTools = computed<ToolDefinition[]>(() => searchTools(keyword.value))

/** 当前分组下需要展示的工具列表 */
const visibleTools = computed<ToolDefinition[]>(() => {
  const key = activeFilter.value
  if (key === 'favorite') {
    return matchedTools.value.filter((tool) => favorites.value.includes(tool.id))
  }
  if (key === 'recent') {
    return recent.value
      .map((id) => matchedTools.value.find((tool) => tool.id === id))
      .filter((tool): tool is ToolDefinition => !!tool)
  }
  if (key === 'all') {
    return matchedTools.value
  }
  return matchedTools.value.filter((tool) => tool.category === key)
})

/**
 * 统计指定分组下的工具数量。
 *
 * @param key 分组标识
 * @returns 该分组下的工具数量
 */
function countOf(key: ToolCategory['key']): number {
  if (key === 'all') {
    return matchedTools.value.length
  }
  if (key === 'favorite') {
    return matchedTools.value.filter((tool) => isFavorite(tool.id)).length
  }
  if (key === 'recent') {
    return recent.value.length
  }
  return matchedTools.value.filter((tool) => tool.category === key).length
}

/**
 * 打开工具工作区，并记录最近使用。
 *
 * @param id 工具唯一标识
 */
function handleOpen(id: string): void {
  pushRecent(id)
  recent.value = readRecent()
  openTool(id)
}

/**
 * 切换收藏状态并刷新本地列表。
 *
 * @param id 工具唯一标识
 */
function handleToggleFavorite(id: string): void {
  toggleFavorite(id)
  favorites.value = readFavorites()
}
</script>

<style scoped>
.tool-panel {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.panel-filter {
  width: 168px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 12px;
}

.panel-search {
  margin-bottom: 8px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.filter-divider {
  height: 1px;
  margin: 8px 0;
  background: var(--el-border-color-lighter);
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.filter-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.filter-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}

.filter-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.filter-item.active .filter-count {
  color: var(--el-color-primary);
}

.panel-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding-right: 4px;
}
</style>
