<template>
  <div v-show="scriptPanelVisible" class="script-panel">
    <div class="sp-header">
      <span class="sp-title">
        <el-icon><CaretRight /></el-icon>
        <span>脚本输出</span>
      </span>
      <span class="sp-label" :title="scriptLabel">{{ scriptLabel }}</span>
      <span v-if="scriptRunning" class="sp-running">
        <el-icon class="is-loading"><Loading /></el-icon>
        运行中
      </span>
      <span v-else-if="scriptExitCode !== null" class="sp-exit" :class="{ error: scriptExitCode !== 0 }">
        退出码 {{ scriptExitCode }}
      </span>
      <div class="sp-actions">
        <el-tooltip content="清空输出" placement="top">
          <el-button text size="small" :icon="Brush" @click="clearScriptOutput" />
        </el-tooltip>
        <el-tooltip :content="scriptRunning ? '停止运行' : '已停止'" placement="top">
          <el-button
            text
            size="small"
            :icon="VideoPause"
            :disabled="!scriptRunning"
            @click="stopScript"
          />
        </el-tooltip>
        <el-tooltip content="关闭面板" placement="top">
          <el-button text size="small" :icon="Close" @click="closeScriptPanel" />
        </el-tooltip>
      </div>
    </div>
    <div ref="bodyRef" class="sp-body">
      <div v-if="!scriptLines.length" class="sp-empty">尚未运行任何脚本</div>
      <pre class="sp-output">
        <span
          v-for="(line, idx) in scriptLines"
          :key="idx"
          class="sp-line"
          :class="`sp-${line.stream}`"
        >{{ line.text }}</span>
      </pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { CaretRight, Loading, Brush, VideoPause, Close } from '@element-plus/icons-vue'
import {
  scriptPanelVisible,
  scriptRunning,
  scriptLabel,
  scriptExitCode,
  scriptLines,
  clearScriptOutput,
  stopScript,
  closeScriptPanel,
} from '../utils/scriptRunner'

const bodyRef = ref<HTMLElement>()

// 新输出后自动滚到底部
watch(
  () => scriptLines.value.length,
  () => {
    void nextTick(() => {
      const el = bodyRef.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)
</script>

<style scoped>
.script-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 220px;
  background: var(--bg-color-overlay, #fff);
  border-top: 1px solid var(--el-border-color-light);
}

.sp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
}

.sp-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.sp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sp-running {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-color-primary);
  white-space: nowrap;
}

.sp-exit {
  font-size: 12px;
  color: var(--el-color-success);
  white-space: nowrap;
}

.sp-exit.error {
  color: var(--el-color-danger);
}

.sp-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.sp-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  background: var(--bg-color-page, #f2f3f5);
}

.sp-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sp-output {
  margin: 0;
  font-family: Consolas, 'Courier New', 'Microsoft YaHei', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-primary);
}

.sp-line {
  display: inline;
}

.sp-line.sp-stderr {
  color: var(--el-color-danger);
}

.sp-line.sp-system {
  color: var(--el-text-color-secondary);
}
</style>
