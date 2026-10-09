<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Refresh } from '@element-plus/icons-vue'
import GitDiffViewer from './GitDiffViewer.vue'
import { countDiffStats, parseGitDiff } from '../utils/git'

/** 差异查看弹窗：支持工作区 / 暂存区 / 指定提交三种差异来源 */

const props = defineProps<{
  modelValue: boolean
  repoRoot: string
  payload: GitDiffPayload | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** diff 原文 */
const diffText = ref('')
/** 是否加载中 */
const loading = ref(false)
/** 展示方式 */
const mode = ref<'inline' | 'split'>('inline')
/** 差异查看器实例（用于读取统计） */
const viewerRef = ref<InstanceType<typeof GitDiffViewer> | null>(null)

/** 新增 / 删除行数统计 */
const stats = computed(() => countDiffStats(parseGitDiff(diffText.value)))

/** 弹窗标题 */
const dialogTitle = computed(() => {
  const suffix = props.payload?.title || (props.payload?.paths?.length ? props.payload.paths.join('、') : '全部变更')
  if (props.payload?.sha) return `提交差异 · ${suffix}（${props.payload.sha.slice(0, 7)}）`
  if (props.payload?.staged) return `已暂存差异 · ${suffix}`
  return `工作区差异 · ${suffix}`
})

/** 加载差异内容 */
async function loadDiff() {
  if (!props.payload || !props.repoRoot || !window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.git.diff({
      repoRoot: props.repoRoot,
      paths: props.payload.paths || [],
      staged: !!props.payload.staged,
      sha: props.payload.sha || '',
    })
    diffText.value = res?.ok ? res.diff || '' : ''
    if (res && !res.ok) ElMessage.error(`读取差异失败：${res.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

/** 复制原始 diff 到剪贴板 */
async function copyDiff() {
  if (!diffText.value) return
  try {
    await navigator.clipboard.writeText(diffText.value)
    ElMessage.success('已复制差异内容')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

watch(
  () => [props.modelValue, props.repoRoot, props.payload],
  () => {
    if (props.modelValue) loadDiff()
  },
  { deep: true },
)
</script>

<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="900px" top="6vh" class="git-diff-dialog">
    <div class="diff-toolbar">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="inline">内联</el-radio-button>
        <el-radio-button value="split">并排</el-radio-button>
      </el-radio-group>
      <div class="toolbar-right">
        <span class="diff-stats">
          <span class="stat-add">+{{ stats.add }}</span>
          <span class="stat-del">-{{ stats.del }}</span>
        </span>
        <el-button text size="small" :icon="CopyDocument" @click="copyDiff">复制</el-button>
        <el-button text size="small" :icon="Refresh" :loading="loading" @click="loadDiff">刷新</el-button>
      </div>
    </div>

    <div v-loading="loading" class="diff-container">
      <GitDiffViewer ref="viewerRef" :diff="diffText" :mode="mode" />
    </div>
  </el-dialog>
</template>

<style scoped>
.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.diff-stats {
  display: flex;
  gap: 6px;
  font-family: Consolas, monospace;
  font-size: 12px;
}

.stat-add {
  color: #67c23a;
}

.stat-del {
  color: #f56c6c;
}

.diff-container {
  height: 60vh;
  min-height: 300px;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  overflow: hidden;
}

.diff-container :deep(.git-diff-viewer) {
  height: 100%;
}
</style>
