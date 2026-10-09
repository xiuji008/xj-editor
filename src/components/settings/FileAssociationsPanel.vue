<template>
  <div class="cfg-panel">
    <div class="assoc-tip">
      注册后即可在资源管理器中直接用本编辑器打开文件：
      <ul class="assoc-list">
        <li>双击 <code>.md / .markdown / .mdown / .mkd</code> 文件默认用本编辑器打开</li>
        <li>右键任意 Markdown / 文本文件 →「打开方式」→「选择其他应用」中可选择「Markdown 编辑器」</li>
        <li>将文档直接拖拽到桌面快捷方式 / 应用图标上即可打开</li>
      </ul>
      <div class="assoc-note">仅写入当前用户注册表（HKCU），无需管理员权限，不影响其他程序的关联。</div>
    </div>

    <div class="assoc-status">
      <span class="assoc-status-label">当前状态：</span>
      <el-tag v-if="checking" type="info" size="small">检测中…</el-tag>
      <el-tag v-else :type="registered ? 'success' : 'info'" size="small" effect="light">
        {{ registered ? '已注册文件关联' : '未注册文件关联' }}
      </el-tag>
    </div>

    <div class="assoc-actions">
      <el-button
        v-if="!registered"
        type="primary"
        :loading="loading"
        @click="doRegister"
      >
        注册文件关联
      </el-button>
      <el-button
        v-else
        type="danger"
        :loading="loading"
        @click="doUnregister"
      >
        取消文件关联
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const registered = ref(false)
const checking = ref(false)
const loading = ref(false)

/** 查询当前注册状态（父级打开面板时调用） */
async function load() {
  if (!window.mdAPI) return
  checking.value = true
  try {
    const res = await window.mdAPI.isFileAssociationsRegistered()
    registered.value = !!res?.registered
  } finally {
    checking.value = false
  }
}

/** 注册文件关联 */
async function doRegister() {
  if (!window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.registerFileAssociations()
    if (res?.ok) {
      registered.value = true
      ElMessage.success('文件关联已注册，可在资源管理器中用本编辑器打开文件')
    } else {
      ElMessage.error(`注册失败：${res?.error || '未知错误'}`)
    }
  } finally {
    loading.value = false
  }
}

/** 取消文件关联 */
async function doUnregister() {
  if (!window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.unregisterFileAssociations()
    if (res?.ok) {
      registered.value = false
      ElMessage.success('已取消文件关联')
    } else {
      ElMessage.error(`取消失败：${res?.error || '未知错误'}`)
    }
  } finally {
    loading.value = false
  }
}

/** 该面板即时生效，无待保存的修改 */
function isDirty(): boolean {
  return false
}

onMounted(load)

defineExpose({ load, isDirty })
</script>

<style scoped>
.assoc-tip {
  font-size: 13px;
  color: var(--text-color-primary);
  line-height: 1.8;
}

.assoc-list {
  margin: 6px 0 10px;
  padding-left: 20px;
}

.assoc-list code {
  background: var(--bg-color-page);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
}

.assoc-note {
  font-size: 12px;
  color: var(--text-color-secondary);
}

.assoc-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  background: var(--bg-color-page);
  border-radius: 6px;
}

.assoc-status-label {
  font-size: 13px;
  color: var(--text-color-regular);
}

.assoc-actions {
  margin-top: 16px;
}
</style>
