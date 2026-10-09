<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { repoNameFromUrl } from '../utils/git'

/** 从 Git 打开：输入仓库地址与存放目录，克隆完成后自动打开该项目目录 */

/** 上次使用的存放目录（持久化，便于下次直接复用） */
const CLONE_PARENT_KEY = 'md-clone-parent-dir'
/** 日志最多保留的行数 */
const LOG_MAX = 200

const props = defineProps<{
  modelValue: boolean
  /** 默认存放目录（一般为当前已打开的目录） */
  defaultParentDir?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 克隆完成，参数为本地仓库目录 */
  cloned: [dir: string]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 仓库地址 */
const url = ref('')
/** 存放该仓库的父目录 */
const parentDir = ref('')
/** 存放目录下新建的项目目录名 */
const dirName = ref('')
/** 用户是否手动改过项目目录名（改过之后不再随地址自动填充） */
const dirNameEdited = ref(false)
/** 指定分支（可选） */
const branch = ref('')
/** 克隆中 */
const cloning = ref(false)
/** 当前进度：阶段名 + 百分比（-1 表示该阶段无百分比） */
const progress = ref({ phase: '', percent: 0, text: '' })
/** 克隆输出日志 */
const logs = ref<string[]>([])
/** 日志容器（用于自动滚动到底部） */
const logBoxRef = ref<HTMLElement | null>(null)
/** 取消订阅克隆进度的函数 */
let unsubscribe: (() => void) | null = null

/** 克隆后的完整路径（仅用于展示） */
const targetPath = computed(() => {
  const parent = parentDir.value.replace(/[\\/]+$/, '')
  if (!parent || !dirName.value.trim()) return ''
  const sep = parent.includes('\\') ? '\\' : '/'
  return `${parent}${sep}${dirName.value.trim()}`
})

/** 是否可以开始克隆 */
const canClone = computed(
  () => !!url.value.trim() && !!parentDir.value && !!dirName.value.trim() && !cloning.value,
)

/** 追加一行日志并自动滚动到底部 */
function pushLog(text: string) {
  const line = String(text || '').trim()
  if (!line) return
  if (logs.value[logs.value.length - 1] === line) return
  logs.value.push(line)
  if (logs.value.length > LOG_MAX) logs.value.shift()
  nextTick(() => {
    if (logBoxRef.value) logBoxRef.value.scrollTop = logBoxRef.value.scrollHeight
  })
}

/** 选择存放 Git 项目的目录 */
async function chooseDir() {
  if (!window.mdAPI) return
  const res = await window.mdAPI.openDirectory({
    title: '选择存放 Git 项目的目录',
    defaultPath: parentDir.value || undefined,
  })
  if (res.canceled || !res.path) return
  parentDir.value = res.path
}

/** 开始克隆：订阅进度 -> 执行克隆 -> 完成后回调父组件打开目录 */
async function startClone() {
  if (!window.mdAPI) {
    ElMessage.warning('此功能仅在桌面版可用')
    return
  }
  if (!url.value.trim()) {
    ElMessage.warning('请输入仓库地址')
    return
  }
  if (!parentDir.value) {
    ElMessage.warning('请选择存放 Git 项目的目录')
    return
  }
  if (!dirName.value.trim()) {
    ElMessage.warning('请输入项目目录名')
    return
  }
  const targetParent = parentDir.value
  cloning.value = true
  logs.value = []
  progress.value = { phase: '准备克隆', percent: 0, text: '' }
  unsubscribe = window.mdAPI.git.onCloneProgress((info) => {
    progress.value = {
      phase: info.phase || progress.value.phase,
      percent: info.percent >= 0 ? info.percent : progress.value.percent,
      text: info.text || '',
    }
    pushLog(info.text)
  })
  try {
    const res = await window.mdAPI.git.clone({
      url: url.value.trim(),
      targetDir: targetParent,
      dirName: dirName.value.trim(),
      branch: branch.value.trim() || undefined,
    })
    if (!res?.ok) {
      ElMessage.error(res?.message || '克隆失败')
      pushLog(res?.message || '克隆失败')
      return
    }
    const dir = res.path || targetPath.value
    // 记住本次存放目录，下次打开弹窗时复用
    localStorage.setItem(CLONE_PARENT_KEY, targetParent)
    ElMessage.success('克隆完成')
    emit('cloned', dir)
    visible.value = false
  } finally {
    unsubscribe?.()
    unsubscribe = null
    cloning.value = false
  }
}

/** 克隆过程中禁止关闭弹窗 */
function beforeClose(done: () => void) {
  if (cloning.value) {
    ElMessage.info('正在克隆，请等待完成')
    return
  }
  done()
}

watch(url, (value) => {
  // 未手动改过目录名时，跟随仓库地址自动填充
  if (dirNameEdited.value) return
  dirName.value = repoNameFromUrl(value)
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    cloning.value = false
    logs.value = []
    progress.value = { phase: '', percent: 0, text: '' }
    url.value = ''
    branch.value = ''
    dirNameEdited.value = false
    dirName.value = ''
    if (!parentDir.value) {
      parentDir.value = props.defaultParentDir || localStorage.getItem(CLONE_PARENT_KEY) || ''
    }
  },
)
</script>

<template>
  <el-dialog
    v-model="visible"
    title="从 Git 打开（克隆仓库）"
    width="620px"
    top="8vh"
    class="git-clone-dialog"
    :close-on-click-modal="!cloning"
    :close-on-press-escape="!cloning"
    :before-close="beforeClose"
  >
    <div class="clone-form">
      <div class="clone-row">
        <span class="clone-label">仓库地址</span>
        <el-input
          v-model="url"
          size="small"
          placeholder="https://github.com/user/repo.git 或 git@github.com:user/repo.git"
          clearable
          :disabled="cloning"
        />
      </div>

      <div class="clone-row">
        <span class="clone-label">存放目录</span>
        <el-input v-model="parentDir" size="small" placeholder="选择用于存放该项目的目录" readonly>
          <template #append>
            <el-button :icon="FolderOpened" :disabled="cloning" @click="chooseDir">选择</el-button>
          </template>
        </el-input>
      </div>

      <div class="clone-row">
        <span class="clone-label">项目目录名</span>
        <el-input
          v-model="dirName"
          size="small"
          placeholder="按仓库地址自动生成，可修改"
          :disabled="cloning"
          @input="dirNameEdited = true"
        />
      </div>

      <div class="clone-row">
        <span class="clone-label">分支（可选）</span>
        <el-input v-model="branch" size="small" placeholder="留空则使用远程默认分支" :disabled="cloning" />
      </div>

      <div v-if="targetPath" class="clone-target">
        将克隆到：<span class="clone-target-path">{{ targetPath }}</span>
      </div>

      <div v-if="cloning || logs.length" class="clone-progress">
        <el-progress :percentage="progress.percent" :stroke-width="10" />
        <div class="clone-progress-text">{{ progress.phase || '克隆中' }}</div>
        <div v-if="logs.length" ref="logBoxRef" class="clone-log">
          <div v-for="(line, i) in logs" :key="i" class="clone-log-line">{{ line }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button size="small" :disabled="cloning" @click="visible = false">取消</el-button>
      <el-button size="small" type="primary" :icon="Download" :loading="cloning" :disabled="!canClone" @click="startClone">
        开始克隆
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.clone-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.clone-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.clone-label {
  flex: 0 0 90px;
  text-align: right;
  font-size: 13px;
  color: var(--text-color-regular, #606266);
}

.clone-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.clone-target {
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
  padding-left: 100px;
  word-break: break-all;
}

.clone-target-path {
  font-family: Consolas, monospace;
  color: var(--color-primary, #409eff);
}

.clone-progress {
  margin-top: 4px;
}

.clone-progress-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}

.clone-log {
  margin-top: 6px;
  max-height: 160px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  background: var(--bg-color-page, #f5f7fa);
}

.clone-log-line {
  font-family: Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-color-regular, #606266);
  word-break: break-all;
}
</style>
