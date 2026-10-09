<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Select } from '@element-plus/icons-vue'

/** .gitignore 编辑弹窗：查看与修改仓库根目录下的忽略规则 */

const props = defineProps<{
  modelValue: boolean
  /** 仓库根目录 */
  repoRoot: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 忽略规则发生变化 */
  changed: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 文件内容 */
const content = ref('')
/** .gitignore 完整路径 */
const filePath = ref('')
/** 读取中 */
const loading = ref(false)
/** 保存中 */
const saving = ref(false)
/** 是否有未保存修改 */
const dirty = ref(false)

/** 规则行数（非空且非注释） */
const ruleCount = computed(
  () =>
    content.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')).length,
)

/** 读取 .gitignore */
async function load() {
  if (!props.repoRoot || !window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.git.readGitignore(props.repoRoot)
    if (!res?.ok) {
      ElMessage.error(res?.message || '读取 .gitignore 失败')
      return
    }
    content.value = res.content || ''
    filePath.value = res.path || ''
    dirty.value = false
  } finally {
    loading.value = false
  }
}

/** 保存 .gitignore */
async function save() {
  if (!props.repoRoot || saving.value || !window.mdAPI) return
  saving.value = true
  try {
    const res = await window.mdAPI.git.writeGitignore({ repoRoot: props.repoRoot, content: content.value })
    if (!res?.ok) {
      ElMessage.error(res?.message || '保存 .gitignore 失败')
      return
    }
    dirty.value = false
    ElMessage.success('已保存 .gitignore')
    emit('changed')
  } finally {
    saving.value = false
  }
}

/** 有未保存修改时提醒后再关闭 */
async function close() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('有未保存的修改，确定关闭吗？', '提示', {
        type: 'warning',
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
      })
    } catch {
      return
    }
  }
  visible.value = false
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)
</script>

<template>
  <el-dialog
    v-model="visible"
    title=".gitignore"
    width="640px"
    top="8vh"
    class="git-ignore-dialog"
    :before-close="(done: () => void) => (dirty ? close().then(done) : done())"
  >
    <div class="ignore-toolbar">
      <span class="ignore-path" :title="filePath">{{ filePath || '.gitignore' }}</span>
      <span class="ignore-count">{{ ruleCount }} 条规则</span>
      <div class="toolbar-actions">
        <el-button text size="small" :icon="Refresh" :loading="loading" @click="load">重新读取</el-button>
        <el-button size="small" type="primary" :icon="Select" :loading="saving" @click="save">
          保存
        </el-button>
      </div>
    </div>

    <el-input
      v-model="content"
      class="ignore-editor"
      type="textarea"
      :rows="16"
      resize="none"
      spellcheck="false"
      placeholder="每行一条规则，例如：&#10;node_modules/&#10;*.log&#10;/dist/"
      @input="dirty = true"
    />

    <div class="ignore-tips">
      规则以 <code>/</code> 开头表示仅匹配仓库根路径；以 <code>/</code> 结尾表示目录。
      已被跟踪的文件加入忽略规则后不会自动生效，需先执行
      <code>git rm --cached &lt;文件&gt;</code>。
    </div>
  </el-dialog>
</template>

<style scoped>
.ignore-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}

.ignore-path {
  flex: 1;
  min-width: 0;
  color: var(--text-color-secondary, #909399);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ignore-count {
  flex: 0 0 auto;
  color: var(--text-color-secondary, #909399);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ignore-editor :deep(textarea) {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.ignore-tips {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-color-secondary, #909399);
}

.ignore-tips code {
  padding: 0 3px;
  font-family: Consolas, Monaco, monospace;
  background: var(--fill-color-light, #f5f7fa);
  border-radius: 3px;
}
</style>
