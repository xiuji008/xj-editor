<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import GitDiffViewer from './GitDiffViewer.vue'
import { formatGitDate } from '../utils/git'

/** 提交历史弹窗：支持仓库整体历史与单文件历史（--follow） */

const props = defineProps<{
  modelValue: boolean
  repoRoot: string
  /** 文件路径（仓库内相对路径），为空表示整个仓库 */
  filePath?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 每页加载条数 */
const PAGE_SIZE = 200

/** 提交列表 */
const commits = ref<GitCommitInfo[]>([])
/** 已加载条数（用于加载更多） */
const skip = ref(0)
/** 是否加载中 */
const loading = ref(false)
/** 是否正在加载更多 */
const loadingMore = ref(false)
/** 是否已全部加载 */
const noMore = ref(false)
/** 过滤关键字 */
const keyword = ref('')
/** 选中的提交 SHA */
const selectedSha = ref('')
/** 选中提交对应的差异文本 */
const diffText = ref('')
/** 差异加载中 */
const diffLoading = ref(false)

/** 过滤后的提交列表 */
const filteredCommits = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return commits.value
  return commits.value.filter((c) =>
    `${c.message} ${c.author} ${c.email} ${c.sha}`.toLowerCase().includes(key),
  )
})

/** 选中的提交 */
const selectedCommit = computed(
  () => commits.value.find((c) => c.sha === selectedSha.value) || null,
)

/** 标题：区分仓库历史与单文件历史 */
const dialogTitle = computed(() =>
  props.filePath ? `提交历史 · ${props.filePath}` : '提交历史',
)

/** 加载提交列表 */
async function loadCommits(append = false) {
  if (!props.repoRoot || !window.mdAPI) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    const res = await window.mdAPI.git.log({
      repoRoot: props.repoRoot,
      path: props.filePath || '',
      limit: PAGE_SIZE,
      skip: append ? skip.value : 0,
      follow: !!props.filePath,
    })
    if (!res?.ok) {
      ElMessage.error(`读取历史失败：${res?.message || '未知错误'}`)
      return
    }
    const list = res.commits || []
    commits.value = append ? [...commits.value, ...list] : list
    skip.value = append ? skip.value + list.length : list.length
    noMore.value = list.length < PAGE_SIZE
    if (!append && list.length) selectedSha.value = list[0].sha
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

/** 加载更多历史 */
function loadMore() {
  if (loadingMore.value || noMore.value) return
  loadCommits(true)
}

/** 加载选中提交的差异 */
async function loadDiff() {
  if (!selectedSha.value || !props.repoRoot || !window.mdAPI) {
    diffText.value = ''
    return
  }
  diffLoading.value = true
  try {
    const res = await window.mdAPI.git.diff({
      repoRoot: props.repoRoot,
      paths: props.filePath ? [props.filePath] : [],
      sha: selectedSha.value,
    })
    diffText.value = res?.ok ? res.diff || '' : ''
  } finally {
    diffLoading.value = false
  }
}

watch(selectedSha, () => loadDiff())

watch(
  () => [props.modelValue, props.repoRoot, props.filePath],
  () => {
    if (!props.modelValue) return
    keyword.value = ''
    commits.value = []
    skip.value = 0
    noMore.value = false
    selectedSha.value = ''
    diffText.value = ''
    loadCommits()
  },
)
</script>

<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="900px" top="6vh" class="git-history-dialog">
    <div class="history-wrap">
      <!-- 左侧：提交列表 -->
      <div class="history-list">
        <div class="list-toolbar">
          <el-input v-model="keyword" size="small" placeholder="搜索提交信息 / 作者" clearable />
          <el-button text size="small" :icon="Refresh" :loading="loading" @click="loadCommits()" />
        </div>
        <div v-loading="loading" class="list-body">
          <div
            v-for="c in filteredCommits"
            :key="c.sha"
            class="commit-item"
            :class="{ active: c.sha === selectedSha }"
            @click="selectedSha = c.sha"
          >
            <div class="commit-message" :title="c.message">{{ c.message || '(无提交信息)' }}</div>
            <div class="commit-meta">
              <span class="commit-sha">{{ c.shortSha }}</span>
              <span class="commit-author">{{ c.author }}</span>
              <span class="commit-date">{{ formatGitDate(c.date) }}</span>
            </div>
            <el-tag v-if="c.refs" size="small" type="info" effect="plain" class="commit-refs">
              {{ c.refs.replace(/^[ (]+|[ )]+$/g, '') }}
            </el-tag>
          </div>
          <div v-if="!loading && !filteredCommits.length" class="list-empty">暂无提交记录</div>
          <div v-if="filteredCommits.length" class="list-more">
            <el-button v-if="!noMore" text size="small" :loading="loadingMore" @click="loadMore">
              加载更多
            </el-button>
            <span v-else class="no-more">已加载全部</span>
          </div>
        </div>
      </div>

      <!-- 右侧：选中提交的差异 -->
      <div class="history-detail">
        <div v-if="selectedCommit" class="detail-header">
          <div class="detail-message">{{ selectedCommit.message }}</div>
          <div class="detail-meta">
            {{ selectedCommit.author }} · {{ selectedCommit.email }} ·
            {{ formatGitDate(selectedCommit.date) }} · {{ selectedCommit.sha }}
          </div>
        </div>
        <div v-loading="diffLoading" class="detail-diff">
          <GitDiffViewer :diff="diffText" mode="inline" />
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.history-wrap {
  display: flex;
  gap: 12px;
  height: 60vh;
  min-height: 320px;
}

.history-list {
  display: flex;
  flex-direction: column;
  width: 320px;
  flex: 0 0 320px;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  overflow: hidden;
}

.list-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

.list-body {
  flex: 1;
  overflow: auto;
}

.commit-item {
  position: relative;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
  cursor: pointer;
}

.commit-item:hover {
  background: var(--fill-color-light, #f5f7fa);
}

.commit-item.active {
  background: var(--color-primary-light-9, #ecf5ff);
}

.commit-message {
  font-size: 13px;
  color: var(--text-color-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
}

.commit-sha {
  font-family: Consolas, monospace;
}

.commit-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-refs {
  margin-top: 4px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.list-empty,
.no-more {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}

.list-more {
  padding: 8px;
  text-align: center;
}

.history-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  overflow: hidden;
}

.detail-header {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

.detail-message {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-primary, #303133);
  word-break: break-all;
}

.detail-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
  word-break: break-all;
}

.detail-diff {
  flex: 1;
  overflow: hidden;
}

.detail-diff :deep(.git-diff-viewer) {
  height: 100%;
}
</style>
