<template>
  <div class="timestamp-converter">
    <div class="now-card">
      <div class="now-item">
        <span class="now-label">当前时间戳（秒）</span>
        <span class="now-value clickable" @click="copy(String(secondsNow))">{{ secondsNow }}</span>
      </div>
      <div class="now-item">
        <span class="now-label">当前时间戳（毫秒）</span>
        <span class="now-value clickable" @click="copy(String(nowMs))">{{ nowMs }}</span>
      </div>
      <div class="now-item">
        <span class="now-label">当前时间</span>
        <span class="now-value clickable" @click="copy(formatLocal(nowMs))">{{ formatLocal(nowMs) }}</span>
      </div>
    </div>

    <el-divider content-position="left">时间戳转日期</el-divider>

    <div class="row">
      <el-input v-model="tsInput" placeholder="输入时间戳（自动识别秒 / 毫秒）" class="row-input" />
    </div>

    <el-descriptions v-if="fromTimestamp" :column="1" size="small" border class="result-table">
      <el-descriptions-item label="识别单位">{{ fromTimestamp?.unitLabel }}</el-descriptions-item>
      <el-descriptions-item label="本地时间">{{ fromTimestamp?.local }}</el-descriptions-item>
      <el-descriptions-item label="ISO 8601">{{ fromTimestamp?.iso }}</el-descriptions-item>
      <el-descriptions-item label="UTC">{{ fromTimestamp?.utc }}</el-descriptions-item>
    </el-descriptions>
    <el-alert v-else-if="tsInput.trim()" type="error" :closable="false" title="请输入合法的时间戳数字" />

    <el-divider content-position="left">日期转时间戳</el-divider>

    <div class="row">
      <el-date-picker
        v-model="dateInput"
        type="datetime"
        placeholder="选择日期时间"
        format="YYYY-MM-DD HH:mm:ss"
        value-format="x"
        class="row-input"
      />
    </div>

    <div v-if="fromDate" class="result-inline">
      <el-tag type="info" effect="light" class="clickable" @click="copy(String(fromDate.seconds))">
        秒：{{ fromDate.seconds }}
      </el-tag>
      <el-tag type="info" effect="light" class="clickable" @click="copy(String(fromDate.millis))">
        毫秒：{{ fromDate.millis }}
      </el-tag>
      <el-tag type="info" effect="light" class="clickable" @click="copy(fromDate.iso)">
        ISO：{{ fromDate.iso }}
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useClipboard } from '../useClipboard'

const { copy } = useClipboard()

/** 毫秒级时间戳的判定阈值：小于该值视为秒级时间戳 */
const SECOND_THRESHOLD = 1e11

/** 当前毫秒时间戳，每秒刷新 */
const nowMs = ref(Date.now())
/** 秒级时间戳 */
const secondsNow = computed(() => Math.floor(nowMs.value / 1000))

/** 待转换的时间戳字符串 */
const tsInput = ref('')
/** 待转换的日期（el-date-picker 的毫秒时间戳字符串） */
const dateInput = ref<string | null>(null)

/** 定时器句柄，用于组件卸载时清理 */
let timer: number | null = null

/**
 * 把毫秒时间戳格式化为本地时间字符串。
 *
 * @param millis 毫秒时间戳
 * @returns yyyy-MM-dd HH:mm:ss 格式的本地时间
 */
function formatLocal(millis: number): string {
  const date = new Date(millis)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** 时间戳解析结果，输入非法时为 null */
const fromTimestamp = computed(() => {
  const raw = tsInput.value.trim()
  if (!raw || !/^-?\d+$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  const isSecond = Math.abs(value) < SECOND_THRESHOLD
  const millis = isSecond ? value * 1000 : value
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return {
    unitLabel: isSecond ? '秒' : '毫秒',
    local: formatLocal(millis),
    iso: date.toISOString(),
    utc: date.toUTCString(),
  }
})

/** 日期转时间戳的结果，未选择日期时为 null */
const fromDate = computed(() => {
  if (!dateInput.value) {
    return null
  }
  const millis = Number(dateInput.value)
  if (!Number.isFinite(millis)) {
    return null
  }
  return {
    millis,
    seconds: Math.floor(millis / 1000),
    iso: new Date(millis).toISOString(),
  }
})

onMounted(() => {
  timer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.timestamp-converter {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.now-card {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.now-item {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.now-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.now-value {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--el-font-family-monospace, monospace);
  color: var(--el-text-color-primary);
}

.clickable {
  cursor: pointer;
}

.clickable:hover {
  color: var(--el-color-primary);
}

.row {
  display: flex;
  gap: 8px;
}

.row-input {
  flex: 1;
  max-width: 320px;
}

.result-table {
  max-width: 520px;
}

.result-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
