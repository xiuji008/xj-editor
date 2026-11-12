<template>
  <el-dialog
    v-model="visible"
    title="关于 XJ-Editor"
    width="560px"
    align-center
    @open="onOpen"
  >
    <div class="about-body">
      <div class="about-head">
        <img class="about-logo" :src="appLogo" alt="logo" />
        <div class="about-title">
          <h2>XJ-Editor</h2>
          <p class="about-sub">Markdown 桌面编辑器（编辑 / 预览 / AI / Git / 白板）</p>
        </div>
      </div>

      <el-divider />

      <div class="about-version">
        <span class="version-label">当前版本</span>
        <el-tag :type="updateChecked && !hasUpdate ? 'success' : 'info'" effect="plain" size="large">
          v{{ version || '…' }}
        </el-tag>
        <el-button type="primary" :loading="checking" @click="checkUpdate">
          {{ updateChecked ? '重新检查' : '检查更新' }}
        </el-button>
      </div>

      <el-alert
        v-if="hasUpdate"
        type="warning"
        :closable="false"
        show-icon
        class="about-result"
        title="发现新版本"
      >
        <template #default>
          <p class="about-result-line">
            最新版本 <b>v{{ latestVersion }}</b>
            <span v-if="publishedAt">（发布于 {{ formatDate(publishedAt) }}）</span>
          </p>
          <p class="about-result-line">
            <el-button size="small" type="warning" @click="openReleasePage">前往下载页面</el-button>
          </p>
        </template>
      </el-alert>
      <el-alert
        v-else-if="updateChecked && !checkError"
        type="success"
        :closable="false"
        show-icon
        class="about-result"
        title="当前已是最新版本"
      />
      <el-alert
        v-if="checkError"
        type="error"
        :closable="false"
        show-icon
        class="about-result"
        :title="`检查更新失败：${checkError}`"
        description="请确认网络可访问 github.com 后重试"
      />

      <el-divider />

      <div class="about-links">
        <el-button text type="primary" :icon="Link" @click="openProjectPage">GitHub 项目主页</el-button>
        <el-button text type="primary" @click="$emit('open-help')">帮助文档</el-button>
      </div>
      <p class="about-license">MIT License · 基于Electron + Vue3 构建</p>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Link } from '@element-plus/icons-vue'
import appLogo from '../../brand/icons/B/xj-b-icon-light.svg'

const visible = defineModel<boolean>({ default: false })

const props = withDefaults(
  defineProps<{
    /** 打开时是否立即自动检查更新（工具栏「检查更新」入口使用） */
    autoCheck?: boolean
  }>(),
  { autoCheck: false },
)

defineEmits<{ (e: 'open-help'): void }>()

const version = ref('')
const projectUrl = ref('https://github.com/xiuji008/xj-editor')
const checking = ref(false)
/** 是否已完成过一次检查（决定按钮文案与「已是最新」提示的显隐） */
const updateChecked = ref(false)
const hasUpdate = ref(false)
const latestVersion = ref('')
const publishedAt = ref('')
const releaseUrl = ref('')
const checkError = ref('')

/** 打开弹窗时读取当前版本号；autoCheck 为真时顺带自动检查更新 */
async function onOpen() {
  checkError.value = ''
  if (!version.value) {
    const res = await window.mdAPI?.appVersion?.()
    if (res?.ok) {
      version.value = res.version
      projectUrl.value = res.projectUrl || projectUrl.value
    }
  }
  if (props.autoCheck) void checkUpdate()
}

/** 请求 GitHub Releases 检查最新版本 */
async function checkUpdate() {
  if (checking.value) return
  if (!window.mdAPI?.checkUpdate) {
    checkError.value = '此功能仅在桌面版可用'
    return
  }
  checking.value = true
  checkError.value = ''
  const res = await window.mdAPI.checkUpdate().catch(() => null)
  checking.value = false
  updateChecked.value = true
  if (!res?.ok) {
    hasUpdate.value = false
    checkError.value = res?.error || '网络请求失败'
    return
  }
  version.value = res.currentVersion || version.value
  latestVersion.value = res.latestVersion || ''
  publishedAt.value = res.publishedAt || ''
  releaseUrl.value = res.releaseUrl || ''
  hasUpdate.value = res.hasUpdate === true
}

/** 在系统浏览器打开发布页 */
function openReleasePage() {
  const url = releaseUrl.value || projectUrl.value
  window.mdAPI?.openExternalUrl?.(url)
}

/** 在系统浏览器打开项目主页 */
function openProjectPage() {
  window.mdAPI?.openExternalUrl?.(projectUrl.value)
}

/** 发布日期格式化为 YYYY-MM-DD */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
</script>

<style scoped>
.about-body {
  padding: 0 8px;
}
.about-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.about-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.about-title h2 {
  margin: 0 0 4px;
  font-size: 22px;
}
.about-sub {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.about-version {
  display: flex;
  align-items: center;
  gap: 12px;
}
.version-label {
  color: var(--el-text-color-secondary);
}
.about-result {
  margin-top: 14px;
}
.about-result-line {
  margin: 4px 0;
}
.about-links {
  display: flex;
  gap: 8px;
}
.about-license {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
