<template>
  <div class="tool-card" @click="$emit('open')">
    <div class="card-head">
      <div class="card-icon">
        <el-icon :size="20"><component :is="tool.icon" /></el-icon>
      </div>
      <el-tag v-if="tool.badge" size="small" :type="tool.badge === 'new' ? 'success' : 'warning'" effect="light">
        {{ tool.badge === 'new' ? 'NEW' : 'BETA' }}
      </el-tag>
      <el-button
        text
        size="small"
        class="fav-btn"
        :class="{ active: favorite }"
        @click.stop="$emit('toggle-favorite')"
      >
        <el-icon :size="16"><StarFilled v-if="favorite" /><Star v-else /></el-icon>
      </el-button>
    </div>
    <div class="card-title">{{ tool.name }}</div>
    <div class="card-desc">{{ tool.description }}</div>
  </div>
</template>

<script setup lang="ts">
import { Star, StarFilled } from '@element-plus/icons-vue'
import type { ToolDefinition } from './types'

defineProps<{
  /** 工具定义 */
  tool: ToolDefinition
  /** 是否已收藏 */
  favorite: boolean
}>()

defineEmits<{
  (e: 'open'): void
  (e: 'toggle-favorite'): void
}>()
</script>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-card:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  flex-shrink: 0;
}

.fav-btn {
  margin-left: auto;
  padding: 2px;
  color: var(--el-text-color-placeholder);
}

.fav-btn.active,
.fav-btn:hover {
  color: var(--el-color-warning);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.card-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
