<template>
  <div class="tool-workspace">
    <header class="ws-head">
      <el-button text size="small" :icon="ArrowLeft" @click="$emit('back')">工具列表</el-button>
      <div class="ws-title">
        <el-icon :size="16"><component :is="tool.icon" /></el-icon>
        <span class="ws-name">{{ tool.name }}</span>
      </div>
    </header>
    <div class="ws-body">
      <component :is="asyncComponent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElEmpty } from 'element-plus'
import { computed, defineAsyncComponent, h, shallowRef } from 'vue'
import type { ToolDefinition } from './types'

const props = defineProps<{
  /** 当前打开的工具定义 */
  tool: ToolDefinition
}>()

defineEmits<{
  (e: 'back'): void
}>()

/** 已创建的异步组件缓存，避免同种工具重复创建导致状态丢失 */
const componentCache = shallowRef(new Map<string, ReturnType<typeof defineAsyncComponent>>())

/**
 * 获取（或首次创建）工具对应的异步组件。
 *
 * @param tool 工具定义
 * @returns 异步组件
 */
function resolveComponent(tool: ToolDefinition) {
  const cache = componentCache.value
  const cached = cache.get(tool.id)
  if (cached) {
    return cached
  }
  // 采用渲染函数而非模板字符串：运行时构建版本不支持编译 template
  const created = defineAsyncComponent({
    loader: tool.component,
    delay: 0,
    timeout: 15000,
    errorComponent: () => h(ElEmpty, { description: '工具加载失败，请重试' }),
    loadingComponent: () => h('div', { class: 'ws-loading' }, '加载中...'),
  })
  cache.set(tool.id, created)
  componentCache.value = new Map(cache)
  return created
}

const asyncComponent = computed(() => resolveComponent(props.tool))
</script>

<style scoped>
.tool-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ws-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.ws-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-color-primary);
}

.ws-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ws-body {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  overflow: auto;
}

:deep(.ws-loading) {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
