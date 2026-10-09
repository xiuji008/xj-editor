<template>
  <svg
    class="myhub-file-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    :aria-hidden="true"
  >
    <!-- 文件图标：品牌色圆角底片 + 辨识字形；文件夹图标：仅渲染图形本身 -->
    <rect v-if="!def.folder" width="24" height="24" rx="5.5" :fill="def.bg" />
    <g v-html="def.glyph" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getFileIconDef, getFolderIconDef } from '../utils/fileIcons'

const props = withDefaults(
  defineProps<{
    /** 文件扩展名（不带点号，大小写不敏感） */
    ext?: string
    /** 文件名（用于识别 Dockerfile / README 等按名称区分的文件） */
    name?: string
    /** 是否为目录 */
    isDirectory?: boolean
    /** 目录是否展开（仅 isDirectory 时生效） */
    expanded?: boolean
    /** 图标尺寸（px） */
    size?: number
  }>(),
  {
    ext: '',
    name: '',
    isDirectory: false,
    expanded: false,
    size: 16,
  },
)

const def = computed(() =>
  props.isDirectory ? getFolderIconDef(props.expanded) : getFileIconDef(props.ext, props.name),
)
</script>

<style scoped>
.myhub-file-icon {
  display: block;
  flex-shrink: 0;
  user-select: none;
}
</style>
