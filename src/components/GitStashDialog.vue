<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, Refresh, Upload } from '@element-plus/icons-vue'
import { formatGitDate } from '../utils/git'

/** 储藏（stash）管理弹窗：保存储藏、查看列表、应用 / 弹出 / 删除 */

const props = defineProps<{
  modelValue: boolean
  /** 仓库根目录 */
  repoRoot: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 储藏发生变化 */
  changed: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 储藏列表 */
const stashes = ref<GitStashEntry[]>([])
/** 列表加载中 */
const loading = ref(false)
/** 正在操作的储藏序号（-1 表示无） */
const actingIndex = ref(-1)
/** 保存中 */
const saving = ref(false)
/** 储藏说明 */
const message = ref('')
/** 是否包含未跟踪文件 */
const includeUntracked = ref(false)

/** 加载储藏列表 */
async function load() {
  if (!props.repoRoot || !window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.git.stashList(props.repoRoot)
    if (!res?.ok) {
      ElMessage.error(res?.message || '读取储藏列表失败')
      return
    }
    stashes.value = res.stashes || []
  } finally {
    loading.value = false
  }
}

/** 保存储藏（把当前未提交的改动收进储藏栈） */
async function saveStash() {
  if (!props.repoRoot || saving.value || !window.mdAPI) return
  saving.value = true
  try {
    const res = await window.mdAPI.git.stashSave({
      repoRoot: props.repoRoot,
      message: message.value.trim() || '',
      includeUntracked: includeUntracked.value,
    })
    if (!res?.ok) {
      ElMessage.error(res?.message || '保存储藏失败')
      return
    }
    if (res.empty) {
      ElMessage.info('当前没有需要储藏的改动')
      return
    }
    message.value = ''
    includeUntracked.value = false
    ElMessage.success('已保存储藏')
    await load()
    emit('changed')
  } finally {
    saving.value = false
  }
}

/** 应用储藏（保留该储藏） */
async function applyStash(entry: GitStashEntry, pop = false) {
  if (actingIndex.value >= 0 || !window.mdAPI) return
  actingIndex.value = entry.index
  try {
    const res = await window.mdAPI.git.stashApply({
      repoRoot: props.repoRoot,
      index: entry.index,
      pop,
    })
    if (!res?.ok) {
      ElMessage.error(res?.message || '应用储藏失败')
      return
    }
    ElMessage.success(pop ? '已弹出储藏' : '已应用储藏')
    await load()
    emit('changed')
  } finally {
    actingIndex.value = -1
  }
}

/** 删除储藏 */
async function dropStash(entry: GitStashEntry) {
  if (actingIndex.value >= 0 || !window.mdAPI) return
  try {
    await ElMessageBox.confirm(
      `确定删除 ${entry.selector} 吗？该储藏中的改动将无法恢复。`,
      '删除储藏',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  actingIndex.value = entry.index
  try {
    const res = await window.mdAPI.git.stashDrop({ repoRoot: props.repoRoot, index: entry.index })
    if (!res?.ok) {
      ElMessage.error(res?.message || '删除储藏失败')
      return
    }
    ElMessage.success('已删除储藏')
    await load()
    emit('changed')
  } finally {
    actingIndex.value = -1
  }
}

/** 储藏条目标题：无说明时回退到分支名 */
function titleOf(entry: GitStashEntry): string {
  return entry.message || `WIP on ${entry.branch || '未知分支'}`
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)
</script>

<template>
  <el-dialog v-model="visible" title="储藏（stash）" width="640px" top="8vh" class="git-stash-dialog">
    <!-- 保存储藏 -->
    <div class="stash-create">
      <el-input
        v-model="message"
        size="small"
        placeholder="储藏说明（可选）"
        clearable
        @keydown.enter.prevent="saveStash"
      />
      <el-checkbox v-model="includeUntracked" size="small">含未跟踪</el-checkbox>
      <el-button size="small" type="primary" :icon="Upload" :loading="saving" @click="saveStash">
        保存储藏
      </el-button>
      <el-button text size="small" :icon="Refresh" :loading="loading" @click="load" />
    </div>

    <div v-loading="loading" class="stash-list">
      <div v-for="entry in stashes" :key="entry.selector" class="stash-item">
        <div class="stash-main">
          <div class="stash-title">
            <span class="stash-selector">{{ entry.selector }}</span>
            <span class="stash-message" :title="titleOf(entry)">{{ titleOf(entry) }}</span>
          </div>
          <div class="stash-meta">
            <span v-if="entry.branch">{{ entry.branch }}</span>
            <span v-if="entry.sha" class="stash-sha">{{ entry.sha.slice(0, 7) }}</span>
            <span v-if="entry.date">{{ formatGitDate(entry.date) }}</span>
          </div>
        </div>
        <div class="stash-actions">
          <el-tooltip content="应用（保留该储藏）" placement="top">
            <el-button
              text
              size="small"
              :icon="Check"
              :loading="actingIndex === entry.index"
              @click="applyStash(entry, false)"
            />
          </el-tooltip>
          <el-tooltip content="弹出（应用后删除）" placement="top">
            <el-button
              text
              size="small"
              :icon="Upload"
              :loading="actingIndex === entry.index"
              @click="applyStash(entry, true)"
            />
          </el-tooltip>
          <el-tooltip content="删除该储藏" placement="top">
            <el-button
              text
              size="small"
              :icon="Delete"
              :disabled="actingIndex >= 0"
              @click="dropStash(entry)"
            />
          </el-tooltip>
        </div>
      </div>
      <div v-if="!loading && !stashes.length" class="stash-empty">
        暂无储藏。可在上方输入说明后把当前未提交的改动收进储藏栈。
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.stash-create {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.stash-create :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.stash-list {
  height: 46vh;
  min-height: 240px;
  overflow: auto;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
}

.stash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

.stash-item:last-child {
  border-bottom: none;
}

.stash-main {
  min-width: 0;
  flex: 1;
}

.stash-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.stash-selector {
  flex: 0 0 auto;
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--color-primary, #409eff);
}

.stash-message {
  font-size: 13px;
  color: var(--text-color-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stash-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
}

.stash-sha {
  font-family: Consolas, monospace;
}

.stash-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.stash-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
  line-height: 1.6;
}
</style>
