<template>
  <el-dialog v-model="visible" title="AI 调用日志" width="1080px" top="4vh" @open="onOpen">
    <div class="ai-log">
      <!-- 筛选栏 -->
      <div class="log-toolbar">
        <el-select v-model="month" size="small" class="w140" placeholder="月份" @change="reload">
          <el-option label="全部月份" value="" />
          <el-option v-for="m in months" :key="m.month" :label="`${m.month}（${m.count}）`" :value="m.month" />
        </el-select>
        <el-select v-model="scene" size="small" class="w130" placeholder="场景" clearable @change="reload">
          <el-option v-for="(label, key) in AI_SCENE_LABELS" :key="key" :label="label" :value="key" />
        </el-select>
        <el-select v-model="status" size="small" class="w110" @change="reload">
          <el-option label="全部状态" value="all" />
          <el-option label="成功" value="ok" />
          <el-option label="失败" value="fail" />
        </el-select>
        <el-input
          v-model="keyword"
          size="small"
          class="w220"
          clearable
          placeholder="厂商 / 模型 / 错误关键字"
          @keydown.enter="reload"
          @clear="reload"
        />
        <el-button size="small" type="primary" :loading="loading" @click="reload">查询</el-button>
        <el-button size="small" :disabled="loading" @click="reload">刷新</el-button>
        <div class="toolbar-right">
          <el-button size="small" @click="handleOpenDir">打开日志目录</el-button>
          <el-button size="small" type="danger" plain :disabled="!total" @click="handleClear">清空</el-button>
        </div>
      </div>

      <!-- 统计概览 -->
      <div class="log-stats">
        <div class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">调用次数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            <span class="ok">{{ stats.okCount }}</span>
            <span class="sep">/</span>
            <span class="fail">{{ stats.failCount }}</span>
          </div>
          <div class="stat-label">成功 / 失败</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ fmtNum(stats.inputTokens) }}</div>
          <div class="stat-label">输入 Token</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ fmtNum(stats.outputTokens) }}</div>
          <div class="stat-label">输出 Token</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ fmtNum(stats.totalTokens) }}</div>
          <div class="stat-label">合计 Token</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ fmtDuration(stats.avgElapsedMs) }}</div>
          <div class="stat-label">平均耗时</div>
        </div>
      </div>

      <!-- 列表 -->
      <el-table
        v-loading="loading"
        :data="items"
        size="small"
        height="380"
        stripe
        class="log-table"
        @row-click="openDetail"
      >
        <el-table-column prop="time" label="时间" width="150">
          <template #default="{ row }">
            <span class="mono">{{ formatTime(row.time) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.providerName || '未知厂商' }}</span>
            <span class="dim"> · </span>
            <span class="model">{{ row.model || '未知模型' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="场景" width="130">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ aiSceneLabel(row.scene) }}</el-tag>
            <el-tag v-if="row.skillName" size="small" effect="plain" class="ml4">{{ row.skillName }}</el-tag>
            <span v-if="row.step" class="dim ml4">S{{ row.step }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.ok" size="small" type="success" effect="light">
              {{ row.stopped ? '已停止' : row.fallback ? '降级成功' : '成功' }}
            </el-tag>
            <el-tag v-else size="small" type="danger" effect="light">失败</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Token" width="150">
          <template #default="{ row }">
            <span>{{ fmtNum(row.inputTokens) }} → {{ fmtNum(row.outputTokens) }}</span>
            <el-tag v-if="row.estimated" size="small" type="warning" effect="plain" class="ml4">估算</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">
            <span class="mono">{{ fmtDuration(row.elapsedMs) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="响应预览" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="dim">{{ row.error || row.preview || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click.stop="openDetail(row)">详情</el-button>
            <el-button text type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span class="dim">暂无调用记录</span>
        </template>
      </el-table>

      <div class="log-footer">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          size="small"
          @current-change="loadList"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <template #footer>
      <span class="dim footer-tip">日志按月保存在应用数据目录 ai-logs 下，密钥已脱敏、图片内容不落盘</span>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>

  <!-- 详情抽屉 -->
  <el-drawer v-model="detailVisible" title="调用详情" size="62%" :append-to-body="true">
    <div v-if="detail" class="log-detail">
      <el-descriptions :column="2" border size="small" class="detail-desc">
        <el-descriptions-item label="时间">{{ formatTime(detail.time) }}</el-descriptions-item>
        <el-descriptions-item label="场景">
          <el-tag size="small" effect="plain">{{ aiSceneLabel(detail.scene) }}</el-tag>
          <el-tag v-if="detail.skill?.name" size="small" effect="plain" class="ml4">
            {{ detail.skill.name }}（{{ skillSourceLabel(detail.skill.source) }}）
          </el-tag>
          <el-tag v-if="detail.stopped" size="small" type="warning" effect="plain" class="ml4">已停止</el-tag>
          <el-tag v-if="detail.fallback" size="small" type="info" effect="plain" class="ml4">降级请求</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="厂商">{{ detail.provider?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="模型">{{ detail.provider?.model || '—' }}</el-descriptions-item>
        <el-descriptions-item label="协议">{{ detail.provider?.format || '—' }}</el-descriptions-item>
        <el-descriptions-item label="服务地址">
          <span class="mono break">{{ detail.provider?.baseUrl || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="请求地址">
          <span class="mono break">{{ detail.request?.url || '—' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="请求方式 / 流式">
          {{ detail.request?.method || 'POST' }} / {{ detail.request?.stream ? '流式' : '一次性' }}
        </el-descriptions-item>
        <el-descriptions-item label="耗时">{{ fmtDuration(detail.elapsedMs) }}</el-descriptions-item>
        <el-descriptions-item label="结束原因">{{ detail.response?.finishReason || '—' }}</el-descriptions-item>
        <el-descriptions-item label="输入 Token">
          {{ fmtNum(detail.usage?.input) }}
          <el-tag v-if="detail.usage?.estimated" size="small" type="warning" effect="plain" class="ml4">估算</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="输出 Token">{{ fmtNum(detail.usage?.output) }}</el-descriptions-item>
        <el-descriptions-item label="合计 Token">{{ fmtNum(detail.usage?.total) }}</el-descriptions-item>
        <el-descriptions-item label="请求 ID">
          <span class="mono break">{{ detail.id }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="运行 ID / 步序" v-if="detail.runId">
          <span class="mono break">{{ detail.runId }}</span>
          <span class="dim ml4">第 {{ detail.step }} 步</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-tabs v-model="detailTab" class="detail-tabs">
        <el-tab-pane label="响应内容" name="response">
          <div class="pane-toolbar">
            <el-tag v-if="detail.ok" size="small" type="success" effect="light">调用成功</el-tag>
            <el-tag v-else size="small" type="danger" effect="light">调用失败</el-tag>
            <span class="dim">{{ detail.response?.contentChars || 0 }} 字符</span>
            <el-button text size="small" @click="copyText(detail.response?.content || '')">复制</el-button>
          </div>
          <div v-if="detail.error" class="error-box">{{ detail.error }}</div>
          <details v-if="detail.response?.thinking" class="thinking-box">
            <summary>思考过程（{{ detail.response.thinking.length }} 字符）</summary>
            <pre class="code-block">{{ detail.response.thinking }}</pre>
          </details>
          <pre class="code-block">{{ detail.response?.content || '（无内容）' }}</pre>
        </el-tab-pane>

        <el-tab-pane v-if="detail.tools?.length" :label="`工具调用（${detail.tools.length}）`" name="tools">
          <div class="pane-toolbar">
            <span class="dim">本步的工具调用（入参 / 结果已截断保存）</span>
          </div>
          <div v-for="(t, idx) in detail.tools" :key="idx" class="tool-block">
            <div class="msg-head">
              <el-tag size="small" :type="t.ok ? 'success' : 'danger'" effect="plain">{{ t.name }}</el-tag>
              <span class="dim">{{ t.elapsedMs != null ? fmtDuration(t.elapsedMs) : '—' }}</span>
              <span v-if="t.error" class="dim">{{ t.error }}</span>
              <el-button text size="small" @click="copyText(`${t.name}\n入参：\n${t.argsSnippet}\n结果：\n${t.resultSnippet}`)">复制</el-button>
            </div>
            <div class="tool-io">
              <pre class="code-block">{{ t.argsSnippet || '（无入参）' }}</pre>
              <pre v-if="t.resultSnippet" class="code-block">{{ t.resultSnippet }}</pre>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="`请求消息（${detail.request?.messageCount || 0}）`" name="messages">
          <div class="pane-toolbar">
            <span class="dim">共 {{ detail.request?.promptChars || 0 }} 字符（超长内容已截断保存）</span>
          </div>
          <div v-for="(m, idx) in detail.request?.messages || []" :key="idx" class="msg-block">
            <div class="msg-head">
              <el-tag size="small" :type="roleTagType(m.role)" effect="plain">{{ roleLabel(m.role) }}</el-tag>
              <span class="dim">{{ m.chars }} 字符</span>
            </div>
            <template v-if="m.parts?.length">
              <div v-for="(p, pi) in m.parts" :key="pi" class="part-block">
                <div v-if="p.type === 'image'" class="part-image">{{ p.note }}</div>
                <pre v-else class="code-block">{{ p.text }}</pre>
              </div>
            </template>
            <pre v-else class="code-block">{{ m.text }}</pre>
          </div>
        </el-tab-pane>

        <el-tab-pane label="请求参数" name="params">
          <div class="pane-toolbar">
            <span class="dim">不含消息体的其他请求参数</span>
            <el-button text size="small" @click="copyText(paramsJson)">复制</el-button>
          </div>
          <pre class="code-block">{{ paramsJson }}</pre>
        </el-tab-pane>

        <el-tab-pane label="请求头" name="headers">
          <div class="pane-toolbar">
            <span class="dim">密钥字段已脱敏</span>
            <el-button text size="small" @click="copyText(headersJson)">复制</el-button>
          </div>
          <pre class="code-block">{{ headersJson }}</pre>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-else class="dim detail-empty">未加载到记录</div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  AI_SCENE_LABELS, aiSceneLabel, clearAiLogs, deleteAiLogs, getAiLogDetail, getAiLogMonths,
  listAiLogs, openAiLogDir,
} from '../utils/ai'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 当前月份（空串表示全部月份） */
const months = ref<AiLogMonth[]>([])
const month = ref('')
const scene = ref<AiLogScene | ''>('')
const status = ref<'all' | 'ok' | 'fail'>('all')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<AiLogSummary[]>([])
const loading = ref(false)
const stats = ref<AiLogStats>({
  total: 0, okCount: 0, failCount: 0, inputTokens: 0, outputTokens: 0,
  totalTokens: 0, elapsedMs: 0, avgElapsedMs: 0, byProvider: [], byScene: [],
})

/** 详情抽屉 */
const detailVisible = ref(false)
const detailTab = ref('response')
const detail = ref<AiLogRecord | null>(null)

/** 打开对话框时加载月份与列表 */
async function onOpen() {
  months.value = await getAiLogMonths()
  if (month.value && !months.value.some((m) => m.month === month.value)) month.value = ''
  await reload()
}

/** 重新查询（回到第一页） */
async function reload() {
  page.value = 1
  await loadList()
}

/** 加载列表 */
async function loadList() {
  loading.value = true
  try {
    const res = await listAiLogs({
      month: month.value || undefined,
      scene: scene.value || undefined,
      status: status.value,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (!res.ok) {
      ElMessage.error(res.error || '查询调用日志失败')
      return
    }
    items.value = res.items || []
    total.value = res.total || 0
    if (res.stats) stats.value = res.stats
  } finally {
    loading.value = false
  }
}

function onSizeChange(size: number) {
  pageSize.value = size
  reload()
}

/** 打开某条记录的详情 */
async function openDetail(row: AiLogSummary) {
  const record = await getAiLogDetail(row.id, row.month)
  if (!record) {
    ElMessage.warning('记录不存在或已被清理')
    return
  }
  detail.value = record
  detailTab.value = 'response'
  detailVisible.value = true
}

/** 删除单条记录 */
async function handleDelete(row: AiLogSummary) {
  try {
    await ElMessageBox.confirm('删除后不可恢复，确认删除该条调用记录？', '删除记录', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  const res = await deleteAiLogs([row.id], row.month)
  if (!res.ok) {
    ElMessage.error(res.error || '删除失败')
    return
  }
  ElMessage.success('已删除')
  if (detail.value?.id === row.id) detailVisible.value = false
  await loadList()
}

/** 清空当前筛选月份的日志 */
async function handleClear() {
  const target = month.value || '全部月份'
  try {
    await ElMessageBox.confirm(`将清空 ${target} 的调用日志，且不可恢复，是否继续？`, '清空日志', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  const res = await clearAiLogs(month.value || undefined)
  if (!res.ok) {
    ElMessage.error(res.error || '清空失败')
    return
  }
  ElMessage.success(`已清空 ${res.removed} 条记录`)
  detailVisible.value = false
  months.value = await getAiLogMonths()
  await loadList()
}

/** 在系统文件管理器中打开日志目录 */
async function handleOpenDir() {
  const res = await openAiLogDir()
  if (!res.ok) ElMessage.error(res.error || '打开日志目录失败')
}

/** 千分位数字 */
function fmtNum(n?: number | null): string {
  return (Number(n) || 0).toLocaleString('en-US')
}

/** 毫秒 -> 可读耗时 */
function fmtDuration(ms?: number | null): string {
  const v = Number(ms) || 0
  if (!v) return '—'
  if (v < 1000) return `${v} ms`
  return `${(v / 1000).toFixed(2)} s`
}

/** skill 来源展示名 */
function skillSourceLabel(source?: string): string {
  if (source === 'builtin') return '内置'
  if (source === 'workspace') return '工作区'
  if (source === 'claude-compat') return '.claude'
  return source || ''
}

/** ISO 时间 -> 本地可读时间 */
function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function roleLabel(role?: string): string {
  return role === 'system' ? '系统' : role === 'assistant' ? '助手' : '用户'
}

function roleTagType(role?: string): 'success' | 'warning' | 'info' {
  return role === 'system' ? 'warning' : role === 'assistant' ? 'success' : 'info'
}

/** 复制文本到剪贴板 */
function copyText(text: string) {
  navigator.clipboard?.writeText(text || '').then(
    () => ElMessage.success('已复制到剪贴板'),
    () => ElMessage.warning('复制失败'),
  )
}

const paramsJson = computed(() => JSON.stringify(detail.value?.request?.params || {}, null, 2))
const headersJson = computed(() => JSON.stringify(detail.value?.request?.headers || {}, null, 2))

watch(visible, (v) => {
  if (!v) detailVisible.value = false
})
</script>

<style scoped>
.ai-log {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.w110 { width: 110px; }
.w130 { width: 130px; }
.w140 { width: 140px; }
.w220 { width: 220px; }

.log-stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.stat-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--el-fill-color-lighter);
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-label {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stat-value .ok { color: var(--el-color-success); }
.stat-value .fail { color: var(--el-color-danger); }
.stat-value .sep { color: var(--el-text-color-secondary); margin: 0 2px; }

.log-table {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.log-footer {
  display: flex;
  justify-content: flex-end;
}

.dim { color: var(--el-text-color-secondary); }
.mono { font-family: Consolas, Monaco, monospace; }
.break { word-break: break-all; }
.ml4 { margin-left: 4px; }
.model { color: var(--el-text-color-regular); }

.footer-tip {
  margin-right: auto;
  font-size: 12px;
}

.log-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-desc :deep(.el-descriptions__label) {
  width: 110px;
}

.pane-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.error-box {
  margin-bottom: 8px;
  padding: 8px 10px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 6px;
  font-size: 13px;
}

/* 思考过程折叠块 */
.thinking-box {
  margin-bottom: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.thinking-box summary {
  cursor: pointer;
  user-select: none;
}
.thinking-box .code-block {
  margin-top: 6px;
  max-height: 200px;
  background: transparent;
  border: none;
  padding: 0;
}

/* 工具调用块 */
.tool-block {
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
}
.tool-io {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tool-io .code-block {
  max-height: 180px;
}

.msg-block {
  margin-bottom: 12px;
}

.msg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.part-block {
  margin-bottom: 6px;
}

.part-image {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 4px;
}

.detail-empty {
  padding: 20px;
  text-align: center;
}
</style>
