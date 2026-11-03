<template>
  <div class="process-manager">
    <el-alert
      v-if="!supported"
      type="warning"
      :closable="false"
      show-icon
      title="进程管理仅在桌面端可用"
      description="浏览器环境无法访问系统进程，请在 XJ-Editor 桌面应用中打开本工具。"
    />

    <template v-if="supported">
      <div class="pm-bar">
        <el-input
          v-model="keyword"
          placeholder="端口号 / 进程名 / PID / 启动参数关键字（如 8080、java、hifar）"
          clearable
          class="pm-keyword"
          @keyup.enter="search"
          @clear="search"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="mode" class="pm-mode" @change="search">
          <el-option label="自动" value="auto" />
          <el-option label="端口" value="port" />
          <el-option label="进程名" value="name" />
          <el-option label="PID" value="pid" />
          <el-option label="命令行" value="cmdline" />
        </el-select>
        <el-button type="primary" :icon="Search" :loading="loading" @click="search">查询</el-button>
        <el-button :icon="Refresh" :disabled="loading" @click="search">刷新</el-button>
      </div>

      <div class="pm-opts">
        <el-checkbox v-model="onlyPorts" @change="search">只看占用端口的进程</el-checkbox>
        <el-checkbox v-model="deep" @change="search">搜索启动参数（命令行）</el-checkbox>
        <el-checkbox v-model="autoRefresh" @change="toggleAutoRefresh">3 秒自动刷新</el-checkbox>
        <span class="pm-summary">
          命中 {{ summary.total }} / 扫描 {{ summary.scanned }} 个进程，耗时 {{ summary.elapsedMs }}ms
        </span>
      </div>

      <el-alert v-if="error" type="error" :closable="false" :title="error" class="pm-alert" />

      <div class="pm-actions">
        <el-button
          type="danger"
          plain
          size="small"
          :disabled="!killableSelection.length"
          @click="killSelected"
        >
          结束选中（{{ killableSelection.length }}）
        </el-button>
        <el-button size="small" :disabled="!rows.length" @click="copyKillCommands">复制结束命令</el-button>
        <el-button size="small" :disabled="!rows.length" @click="copyPidList">复制 PID</el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        height="420"
        size="small"
        row-key="pid"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="46" :selectable="canSelect" />
        <el-table-column label="PID" width="92">
          <template #default="{ row }">
            <span class="pm-mono pm-link" title="点击复制 PID" @click="copy(String(row.pid))">
              {{ row.pid }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进程名" min-width="150">
          <template #default="{ row }">
            <span class="pm-name">{{ row.name }}</span>
            <el-tag v-if="row.critical" size="small" type="info" effect="plain" class="pm-tag">受保护</el-tag>
            <el-tag v-else-if="row.matchedBy === 'cmdline'" size="small" type="warning" effect="plain" class="pm-tag">
              命令行命中
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="占用端口" min-width="210">
          <template #default="{ row }">
            <template v-if="row.ports.length">
              <el-tooltip
                v-for="port in row.ports.slice(0, 4)"
                :key="`${port.proto}-${port.port}-${port.state}-${port.local}`"
                :content="`${port.proto} ${port.local}${port.remote && port.remote !== '0.0.0.0:0' ? ' → ' + port.remote : ''} ${port.state || ''}`"
                placement="top"
              >
                <el-tag
                  size="small"
                  :type="port.listening ? 'success' : 'info'"
                  effect="plain"
                  class="pm-port"
                >
                  {{ port.port }}
                </el-tag>
              </el-tooltip>
              <span v-if="row.ports.length > 4" class="pm-dim">+{{ row.ports.length - 4 }}</span>
            </template>
            <span v-else class="pm-dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="内存" width="100">
          <template #default="{ row }">
            <span class="pm-mono">{{ formatMemory(row.memory) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="启动命令行" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="pm-dim">{{ row.commandLine || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="196" fixed="right">
          <template #default="{ row }">
            <el-button text type="danger" size="small" :disabled="row.critical" @click="killRow(row)">
              结束
            </el-button>
            <el-button
              text
              type="danger"
              size="small"
              :disabled="row.critical"
              title="连同子进程一起结束"
              @click="killRow(row, true)"
            >
              结束树
            </el-button>
            <el-button text size="small" @click="copyKillCommand(row)">命令</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span class="pm-dim">
            {{ error ? '查询失败' : keyword ? '没有匹配的进程' : '暂无进程数据' }}
          </span>
        </template>
      </el-table>

      <div class="pm-tip">
        结束进程不会保存任何数据；系统关键进程与编辑器自身进程已禁止结束，其余进程若提示权限不足请以管理员身份运行本应用。
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useClipboard } from '../useClipboard'

/** 主进程暴露的进程管理能力，浏览器环境下为空 */
const api = typeof window !== 'undefined' ? window.mdAPI?.process : undefined
/** 是否支持进程管理（需 Electron 桌面端） */
const supported = !!api

/** 搜索关键字 */
const keyword = ref('')
/** 匹配模式：auto / port / name / pid / cmdline */
const mode = ref('auto')
/** 是否采集并匹配启动命令行 */
const deep = ref(true)
/** 是否只显示占用端口的进程 */
const onlyPorts = ref(true)
/** 是否定时刷新 */
const autoRefresh = ref(false)
/** 是否正在查询 */
const loading = ref(false)
/** 错误信息 */
const error = ref('')
/** 进程列表 */
const rows = ref<ProcItem[]>([])
/** 已勾选的进程 */
const selection = ref<ProcItem[]>([])
/** 查询统计 */
const summary = ref({ total: 0, scanned: 0, elapsedMs: 0 })
/** 自动刷新定时器 */
let timer: number | null = null
/** 当前操作系统（用于生成结束命令） */
const platform = ref('win32')

const { copy } = useClipboard()

/** 勾选行中可结束的进程（排除受保护进程） */
const killableSelection = computed(() => selection.value.filter((row) => !row.critical))

/**
 * 该行是否允许勾选。
 *
 * @param row 进程条目
 * @returns 允许返回 true
 */
function canSelect(row: ProcItem): boolean {
  return !row.critical
}

/**
 * 格式化内存显示。
 *
 * @param kb 内存（KB）
 * @returns 格式化后的文本
 */
function formatMemory(kb: number): string {
  const value = Number(kb) || 0
  if (!value) return '—'
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} GB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} MB`
  return `${value} KB`
}

/**
 * 查询进程列表。
 *
 * @returns 无返回值
 */
async function search(): Promise<void> {
  if (!api) {
    error.value = '当前环境不支持进程管理'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await api.search({
      keyword: keyword.value,
      mode: mode.value,
      deep: deep.value,
      onlyPorts: onlyPorts.value,
    })
    if (!res?.ok) {
      error.value = res?.message || res?.error || '查询进程失败'
      rows.value = []
      summary.value = { total: 0, scanned: 0, elapsedMs: 0 }
      return
    }
    rows.value = res.items || []
    summary.value = {
      total: res.total ?? rows.value.length,
      scanned: res.scanned ?? 0,
      elapsedMs: res.elapsedMs ?? 0,
    }
    if (res.platform) platform.value = res.platform
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    rows.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 勾选变化。
 *
 * @param list 当前勾选的进程
 */
function onSelectionChange(list: ProcItem[]): void {
  selection.value = list
}

/**
 * 生成结束进程的命令行。
 *
 * @param row 进程条目
 * @returns 结束命令
 */
function killCommand(row: ProcItem): string {
  return platform.value === 'win32' ? `taskkill /f /pid ${row.pid}` : `kill -9 ${row.pid}`
}

/**
 * 复制单个进程的结束命令。
 *
 * @param row 进程条目
 */
function copyKillCommand(row: ProcItem): void {
  copy(killCommand(row), '已复制结束命令')
}

/**
 * 复制勾选（未勾选时为全部）进程的结束命令。
 */
function copyKillCommands(): void {
  const list = selection.value.length ? selection.value : rows.value
  copy(list.map(killCommand).join('\n'), `已复制 ${list.length} 条结束命令`)
}

/**
 * 复制勾选（未勾选时为全部）进程的 PID。
 */
function copyPidList(): void {
  const list = selection.value.length ? selection.value : rows.value
  copy(list.map((row) => String(row.pid)).join(' '), `已复制 ${list.length} 个 PID`)
}

/**
 * 结束单个进程。
 *
 * @param row 进程条目
 * @param tree 是否连同子进程一起结束
 * @returns 无返回值
 */
async function killRow(row: ProcItem, tree = false): Promise<void> {
  if (!api) return
  if (row.critical) {
    ElMessage.warning('该进程受保护，已阻止结束')
    return
  }
  const ports = row.ports.length ? `，占用端口 ${row.ports.map((p) => p.port).join('、')}` : ''
  try {
    await ElMessageBox.confirm(
      `确定结束 ${row.name}（PID ${row.pid}${ports}）？${tree ? '其子进程也会一起结束。' : ''}未保存的数据会丢失。`,
      '结束进程',
      {
        type: 'warning',
        confirmButtonText: '结束进程',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  const res = await api.kill({ pid: row.pid, name: row.name, tree })
  if (res?.ok) {
    ElMessage.success(res.message || `已结束 ${row.name}`)
  } else {
    ElMessage.error(res?.error || `结束 ${row.name} 失败`)
  }
  search()
}

/**
 * 批量结束勾选的进程。
 *
 * @returns 无返回值
 */
async function killSelected(): Promise<void> {
  if (!api) return
  const list = killableSelection.value
  if (!list.length) return
  try {
    await ElMessageBox.confirm(
      `确定结束这 ${list.length} 个进程？未保存的数据会丢失。`,
      '批量结束进程',
      {
        type: 'warning',
        confirmButtonText: '结束进程',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  let success = 0
  let failed = 0
  for (const row of list) {
    const res = await api.kill({ pid: row.pid, name: row.name })
    if (res?.ok) success += 1
    else failed += 1
  }
  if (failed) ElMessage.warning(`已结束 ${success} 个，失败 ${failed} 个`)
  else ElMessage.success(`已结束 ${success} 个进程`)
  search()
}

/**
 * 切换自动刷新。
 */
function toggleAutoRefresh(): void {
  stopTimer()
  if (autoRefresh.value) {
    timer = window.setInterval(() => {
      if (!loading.value) search()
    }, 3000)
  }
}

/** 停止自动刷新定时器 */
function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  if (supported) search()
})

onBeforeUnmount(stopTimer)
</script>

<style scoped>
.process-manager {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pm-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.pm-keyword {
  flex: 1;
  min-width: 220px;
}

.pm-mode {
  width: 110px;
  flex-shrink: 0;
}

.pm-opts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.pm-summary {
  color: var(--el-text-color-secondary);
}

.pm-alert {
  margin-top: 2px;
}

.pm-actions {
  display: flex;
  gap: 8px;
}

.pm-mono {
  font-family: var(--el-font-family-monospace, monospace);
}

.pm-link {
  cursor: pointer;
}

.pm-link:hover {
  color: var(--el-color-primary);
}

.pm-name {
  font-weight: 600;
}

.pm-tag {
  margin-left: 6px;
}

.pm-port {
  margin-right: 4px;
}

.pm-dim {
  color: var(--el-text-color-secondary);
}

.pm-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
</style>
