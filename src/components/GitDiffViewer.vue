<script setup lang="ts">
import { computed } from 'vue'
import { buildSplitRows, countDiffStats, isBinaryDiff, parseGitDiff, type GitSplitRow } from '../utils/git'

/** 差异查看器：支持内联与并排两种展示方式 */

const props = withDefaults(
  defineProps<{
    /** diff 原文（unified diff） */
    diff: string
    /** 展示方式：内联或并排 */
    mode?: 'inline' | 'split'
  }>(),
  { mode: 'inline' },
)

/** 解析后的 hunk 列表 */
const hunks = computed(() => parseGitDiff(props.diff))

/** 是否为二进制差异 */
const binary = computed(() => isBinaryDiff(props.diff))

/** 新增 / 删除行数统计 */
const stats = computed(() => countDiffStats(hunks.value))

/** 并排模式的展示项（hunk 头与行混排） */
const splitItems = computed(() => {
  const items: Array<{ kind: 'header'; text: string } | { kind: 'row'; row: GitSplitRow }> = []
  for (const hunk of hunks.value) {
    items.push({ kind: 'header', text: hunk.header })
    for (const row of buildSplitRows([hunk])) items.push({ kind: 'row', row })
  }
  return items
})

/** 内联模式的行前缀符号 */
function signOf(type: string): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ' '
}

defineExpose({ stats })
</script>

<template>
  <div class="git-diff-viewer" :class="mode">
    <div v-if="binary" class="diff-empty">二进制文件，无法显示文本差异</div>
    <div v-else-if="!hunks.length" class="diff-empty">没有差异</div>

    <!-- 内联模式 -->
    <template v-else-if="mode === 'inline'">
      <div v-for="(hunk, hi) in hunks" :key="`i-${hi}`" class="diff-hunk">
        <div class="hunk-header">{{ hunk.header }}</div>
        <div v-for="(line, li) in hunk.lines" :key="li" class="diff-line" :class="line.type">
          <span class="ln">{{ line.oldNo ?? '' }}</span>
          <span class="ln">{{ line.newNo ?? '' }}</span>
          <span class="sign">{{ signOf(line.type) }}</span>
          <span class="text">{{ line.text || ' ' }}</span>
        </div>
      </div>
    </template>

    <!-- 并排模式 -->
    <template v-else>
      <div class="diff-hunk">
        <template v-for="(item, idx) in splitItems" :key="`s-${idx}`">
          <div v-if="item.kind === 'header'" class="hunk-header">{{ item.text }}</div>
          <div v-else class="split-row">
            <span class="ln">{{ item.row.left?.oldNo ?? '' }}</span>
            <span class="text" :class="item.row.left?.type">{{ item.row.left?.text || ' ' }}</span>
            <span class="ln">{{ item.row.right?.newNo ?? '' }}</span>
            <span class="text" :class="item.row.right?.type">{{ item.row.right?.text || ' ' }}</span>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.git-diff-viewer {
  font-family: Consolas, 'Courier New', 'Microsoft YaHei', monospace;
  font-size: 12.5px;
  line-height: 1.65;
  overflow: auto;
}

.diff-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-color-secondary, #909399);
  font-size: 13px;
}

.hunk-header {
  padding: 2px 10px;
  color: var(--text-color-secondary, #909399);
  background: var(--fill-color-light, #f5f7fa);
  border-top: 1px solid var(--border-color-lighter, #ebeef5);
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
  white-space: pre;
}

.diff-line {
  display: flex;
  white-space: pre;
}

.diff-line.add {
  background: rgba(129, 184, 139, 0.22);
}

.diff-line.del {
  background: rgba(199, 78, 57, 0.14);
}

.ln {
  flex: 0 0 48px;
  padding: 0 8px;
  text-align: right;
  color: var(--text-color-secondary, #a8abb2);
  background: var(--fill-color-light, #fafafa);
  user-select: none;
}

.sign {
  flex: 0 0 16px;
  text-align: center;
  color: var(--text-color-secondary, #909399);
}

.text {
  flex: 1;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 并排模式：左行号 / 左内容 / 右行号 / 右内容 */
.split-row {
  display: grid;
  grid-template-columns: 48px 1fr 48px 1fr;
}

.split-row .text {
  border-right: 1px solid var(--border-color-lighter, #ebeef5);
}

.split-row .text.add {
  background: rgba(129, 184, 139, 0.22);
}

.split-row .text.del {
  background: rgba(199, 78, 57, 0.14);
}
</style>
