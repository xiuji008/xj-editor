<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus, Refresh, Switch } from '@element-plus/icons-vue'
import { formatGitDate } from '../utils/git'

/** 分支管理弹窗：查看本地 / 远程分支，切换、新建、删除分支 */

const props = defineProps<{
  modelValue: boolean
  /** 仓库根目录 */
  repoRoot: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 分支发生变化（切换 / 新建 / 删除） */
  changed: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 本地分支 */
const local = ref<GitBranchInfo[]>([])
/** 远程分支 */
const remote = ref<GitBranchInfo[]>([])
/** 当前分支名 */
const current = ref('')
/** 列表加载中 */
const loading = ref(false)
/** 正在操作的分支名（空表示无） */
const acting = ref('')
/** 过滤关键字 */
const keyword = ref('')
/** 展示的分组 */
const tab = ref<'local' | 'remote'>('local')
/** 新分支名 */
const newName = ref('')
/** 新分支起点（留空表示当前 HEAD） */
const newFrom = ref('')

/** 按关键字过滤后的本地分支 */
const filteredLocal = computed(() => filterList(local.value))
/** 按关键字过滤后的远程分支 */
const filteredRemote = computed(() => filterList(remote.value))

/** 关键字过滤（匹配分支名与最近提交标题） */
function filterList(list: GitBranchInfo[]): GitBranchInfo[] {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return list
  return list.filter(
    (b) => b.name.toLowerCase().includes(key) || (b.subject || '').toLowerCase().includes(key),
  )
}

/** 加载分支列表 */
async function load() {
  if (!props.repoRoot || !window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.git.branches(props.repoRoot)
    if (!res?.ok) {
      ElMessage.error(res?.message || '读取分支列表失败')
      return
    }
    local.value = res.local || []
    remote.value = res.remote || []
    current.value = res.current || ''
  } finally {
    loading.value = false
  }
}

/** 切换分支（本地已存在则直接切换，否则视为基于远程分支新建本地分支） */
async function switchTo(branch: GitBranchInfo) {
  if (branch.current || acting.value || !window.mdAPI) return
  const existsLocally = local.value.some((b) => b.name === branch.name)
  const shortName = branch.name.includes('/') ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name
  const target = existsLocally ? branch.name : shortName
  acting.value = branch.name
  try {
    const res = await window.mdAPI.git.checkout({
      repoRoot: props.repoRoot,
      branch: target,
      create: !existsLocally,
      from: existsLocally ? '' : branch.name,
    })
    if (!res?.ok) {
      ElMessage.error(res?.message || '切换分支失败')
      return
    }
    ElMessage.success(`已切换到 ${target}`)
    visible.value = false
    emit('changed')
  } finally {
    acting.value = ''
  }
}

/** 新建并切换到新分支 */
async function createBranch() {
  const name = newName.value.trim()
  if (!name || acting.value || !window.mdAPI) return
  acting.value = name
  try {
    const res = await window.mdAPI.git.checkout({
      repoRoot: props.repoRoot,
      branch: name,
      create: true,
      from: newFrom.value.trim() || '',
    })
    if (!res?.ok) {
      ElMessage.error(res?.message || '新建分支失败')
      return
    }
    newName.value = ''
    newFrom.value = ''
    ElMessage.success(`已创建并切换到 ${name}`)
    visible.value = false
    emit('changed')
  } finally {
    acting.value = ''
  }
}

/** 删除本地分支（-d 失败时询问是否强制删除） */
async function removeBranch(branch: GitBranchInfo) {
  if (acting.value || !window.mdAPI) return
  try {
    await ElMessageBox.confirm(
      `确定删除本地分支「${branch.name}」吗？该分支未合并的提交可能丢失。`,
      '删除分支',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  acting.value = branch.name
  try {
    let res = await window.mdAPI.git.deleteBranch({ repoRoot: props.repoRoot, branch: branch.name })
    if (!res?.ok && res?.error !== 'CURRENT_BRANCH') {
      try {
        await ElMessageBox.confirm(
          `无法删除「${branch.name}」：${res?.message || '该分支可能尚未合并'}。是否强制删除（-D）？`,
          '强制删除',
          { type: 'warning', confirmButtonText: '强制删除', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      res = await window.mdAPI.git.deleteBranch({ repoRoot: props.repoRoot, branch: branch.name, force: true })
    }
    if (!res?.ok) {
      ElMessage.error(res?.message || '删除分支失败')
      return
    }
    ElMessage.success(`已删除 ${branch.name}`)
    await load()
    emit('changed')
  } finally {
    acting.value = ''
  }
}

/** 展示同步状态文案 */
function syncText(branch: GitBranchInfo): string {
  if (!branch.upstream) return '无上游'
  if (!branch.ahead && !branch.behind) return `与 ${branch.upstream} 同步`
  return `↑${branch.ahead} ↓${branch.behind} · ${branch.upstream}`
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    keyword.value = ''
    tab.value = 'local'
    load()
  },
)
</script>

<template>
  <el-dialog v-model="visible" title="分支管理" width="640px" top="8vh" class="git-branch-dialog">
    <!-- 新建分支 -->
    <div class="branch-create">
      <el-input v-model="newName" size="small" placeholder="新分支名，如 feature/note" clearable />
      <el-input
        v-model="newFrom"
        size="small"
        placeholder="起点（可选，默认当前 HEAD）"
        clearable
      />
      <el-button
        size="small"
        type="primary"
        :icon="Plus"
        :loading="acting === newName.trim() && !!newName.trim()"
        @click="createBranch"
      >
        新建并切换
      </el-button>
    </div>

    <!-- 搜索与分组切换 -->
    <div class="branch-toolbar">
      <el-input v-model="keyword" size="small" placeholder="搜索分支名 / 提交信息" clearable />
      <el-radio-group v-model="tab" size="small">
        <el-radio-button value="local">本地 ({{ local.length }})</el-radio-button>
        <el-radio-button value="remote">远程 ({{ remote.length }})</el-radio-button>
      </el-radio-group>
      <el-button text size="small" :icon="Refresh" :loading="loading" @click="load" />
    </div>

    <div v-loading="loading" class="branch-list">
      <!-- 本地分支 -->
      <template v-if="tab === 'local'">
        <div v-for="branch in filteredLocal" :key="`l-${branch.name}`" class="branch-item">
          <div class="branch-main">
            <div class="branch-title">
              <span class="branch-name" :class="{ current: branch.current }">{{ branch.name }}</span>
              <el-tag v-if="branch.current" size="small" type="success" effect="plain">当前</el-tag>
            </div>
            <div class="branch-meta">
              <span class="branch-sha">{{ branch.sha }}</span>
              <span class="branch-subject">{{ branch.subject }}</span>
            </div>
            <div class="branch-meta dim">
              <span>{{ syncText(branch) }}</span>
              <span v-if="branch.date">{{ formatGitDate(branch.date) }}</span>
            </div>
          </div>
          <div class="branch-actions">
            <el-tooltip v-if="!branch.current" content="切换到该分支" placement="top">
              <el-button
                text
                size="small"
                :icon="Switch"
                :loading="acting === branch.name"
                @click="switchTo(branch)"
              />
            </el-tooltip>
            <el-tooltip v-if="!branch.current" content="删除该分支" placement="top">
              <el-button
                text
                size="small"
                :icon="Delete"
                :disabled="!!acting"
                @click="removeBranch(branch)"
              />
            </el-tooltip>
          </div>
        </div>
        <div v-if="!loading && !filteredLocal.length" class="branch-empty">没有匹配的本地分支</div>
      </template>

      <!-- 远程分支：无对应本地分支时自动创建同名本地分支并跟踪 -->
      <template v-else>
        <div v-for="branch in filteredRemote" :key="`r-${branch.name}`" class="branch-item">
          <div class="branch-main">
            <div class="branch-title">
              <span class="branch-name">{{ branch.name }}</span>
            </div>
            <div class="branch-meta">
              <span class="branch-sha">{{ branch.sha }}</span>
              <span class="branch-subject">{{ branch.subject }}</span>
            </div>
            <div class="branch-meta dim">
              <span v-if="branch.date">{{ formatGitDate(branch.date) }}</span>
            </div>
          </div>
          <div class="branch-actions">
            <el-tooltip content="检出为本地分支" placement="top">
              <el-button
                text
                size="small"
                :icon="Switch"
                :loading="acting === branch.name"
                @click="switchTo(branch)"
              />
            </el-tooltip>
          </div>
        </div>
        <div v-if="!loading && !filteredRemote.length" class="branch-empty">没有匹配的远程分支</div>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.branch-create {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.branch-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.branch-toolbar :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.branch-list {
  height: 46vh;
  min-height: 260px;
  overflow: auto;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
}

.branch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

.branch-item:last-child {
  border-bottom: none;
}

.branch-main {
  min-width: 0;
  flex: 1;
}

.branch-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.branch-name {
  font-size: 13px;
  color: var(--text-color-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-name.current {
  font-weight: 600;
  color: var(--color-primary, #409eff);
}

.branch-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.branch-meta.dim {
  color: var(--text-color-secondary, #a8abb2);
}

.branch-sha {
  font-family: Consolas, monospace;
  flex: 0 0 auto;
}

.branch-subject {
  overflow: hidden;
  text-overflow: ellipsis;
}

.branch-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.branch-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}
</style>
