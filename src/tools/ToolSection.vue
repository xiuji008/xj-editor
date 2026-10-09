<template>
  <section class="tool-section">
    <header class="section-head">
      <span class="section-title">{{ title }}</span>
      <div class="section-actions">
        <slot name="actions" />
        <el-button v-if="copyable" text size="small" :icon="DocumentCopy" @click="handleCopy">
          复制
        </el-button>
      </div>
    </header>
    <slot />
  </section>
</template>

<script setup lang="ts">
import { DocumentCopy } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useClipboard } from './useClipboard'

const props = withDefaults(
  defineProps<{
    /** 区块标题 */
    title: string
    /** 是否展示复制按钮，需同时提供 text 或传入 #default 文本截取逻辑 */
    copyable?: boolean
    /** 待复制的文本，未传值时取默认插槽的外部传入值 */
    text?: string
  }>(),
  { copyable: true },
)

const { copy } = useClipboard()

/** 实际复制的内容：优先取显式传入的 text */
const copyText = computed(() => props.text ?? '')

/**
 * 复制当前区块内容到剪贴板。
 */
function handleCopy(): void {
  void copy(copyText.value)
}
</script>

<style scoped>
.tool-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
