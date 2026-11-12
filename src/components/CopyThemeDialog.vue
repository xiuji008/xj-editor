<script setup lang="ts">
/**
 * 「复制为公众号格式」主题选择弹窗。
 *
 * 只负责选主题 + 触发复制，真正的 HTML 组装在 utils/copyExport.ts。
 * 主题选择会记住（localStorage），下次打开直接选中。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  COPY_THEMES,
  readStoredCopyTheme,
  storeCopyTheme,
  getCopyTheme,
} from '../utils/copyThemes'
import { buildCopyHtml, copyAsLongImage } from '../utils/copyExport'
import { copyRichHtml } from '../utils/clipboardCopy'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Markdown 源码（纯文本兜底） */
    markdown: string
    /** 当前代码高亮主题 */
    codeTheme?: string
    /** 当前文档名 */
    fileName?: string
    /** 预览容器：克隆已渲染结果 */
    sourceEl?: HTMLElement | null
  }>(),
  { codeTheme: '', fileName: '', sourceEl: null },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** 当前选中主题 key */
const currentKey = ref(readStoredCopyTheme())
const copying = ref(false)
const longLoading = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) currentKey.value = readStoredCopyTheme()
  },
)

watch(currentKey, (key) => storeCopyTheme(key))

const currentTheme = computed(() => getCopyTheme(currentKey.value))

/** 统一提示：复制成功 + 警告合并成一条，避免连续弹窗 */
function notify(successText: string, warnings: string[]): void {
  if (warnings.length) {
    ElMessage.warning(`${successText}（${warnings[0]}）`)
  } else {
    ElMessage.success(successText)
  }
}

/** 复制公众号富文本 */
async function doCopyWechat(): Promise<void> {
  if (copying.value) return
  copying.value = true
  try {
    const payload = await buildCopyHtml({
      markdown: props.markdown,
      platform: 'wechat',
      themeKey: currentKey.value,
      codeTheme: props.codeTheme,
      fileName: props.fileName,
      sourceEl: props.sourceEl,
    })
    const res = await copyRichHtml(payload.html)
    if (!res.ok) {
      ElMessage.error('复制失败，请检查剪贴板权限')
      return
    }
    if (res.mode === 'plain') {
      ElMessage.warning('剪贴板写入受限，本次只复制了 HTML 源文本（重启应用后再试通常可恢复）')
      return
    }
    notify(`已复制「${payload.theme.label}」格式，去公众号编辑器粘贴`, payload.warnings)
  } catch (err) {
    ElMessage.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    copying.value = false
  }
}

/** 复制为长图 PNG */
async function doCopyLongImage(): Promise<void> {
  if (longLoading.value) return
  longLoading.value = true
  try {
    const res = await copyAsLongImage({
      markdown: props.markdown,
      themeKey: currentKey.value,
      codeTheme: props.codeTheme,
      fileName: props.fileName,
      sourceEl: props.sourceEl,
    })
    if (res.ok) {
      notify('已复制长图 PNG，可直接粘贴到公众号', res.warnings)
    } else {
      ElMessage.error(`长图生成失败：${res.error || '未知错误'}`)
    }
  } finally {
    longLoading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="复制为公众号格式"
    width="680px"
    append-to-body
    class="copy-theme-dialog"
  >
    <p class="copy-theme-tip">
      选择排版主题后点击「复制到剪贴板」，到微信公众平台编辑器（或壹伴 / 秀米）直接粘贴。
      正文样式已全部转成内联样式，粘贴后不会丢色。
    </p>

    <div class="copy-theme-grid">
      <button
        v-for="theme in COPY_THEMES"
        :key="theme.key"
        type="button"
        class="copy-theme-card"
        :class="{ 'is-active': theme.key === currentKey }"
        @click="currentKey = theme.key"
      >
        <span
          class="copy-theme-swatch"
          :style="{ background: theme.background, borderColor: theme.primary }"
        >
          <span class="swatch-title" :style="{ background: theme.primary }" />
          <span class="swatch-text" :class="{ 'is-dark': theme.key === 'dark' }" />
          <span class="swatch-text short" :class="{ 'is-dark': theme.key === 'dark' }" />
          <span class="swatch-block" :style="{ background: theme.primary }" />
        </span>
        <span class="copy-theme-name">{{ theme.label }}</span>
      </button>
    </div>

    <p class="copy-theme-note">
      当前主题：{{ currentTheme.label }}。文稿中的本地图片粘贴到公众号后需要重新上传，建议改用「复制为长图 PNG」。
    </p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button :loading="longLoading" @click="doCopyLongImage">复制为长图 PNG</el-button>
      <el-button type="primary" :loading="copying" @click="doCopyWechat">
        复制到剪贴板
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.copy-theme-tip {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-secondary, #606266);
}

.copy-theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.copy-theme-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: var(--bg-color-white, #fff);
  border: 1px solid var(--border-color-light, #e4e7ed);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.copy-theme-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}

.copy-theme-card.is-active {
  border-color: var(--color-primary, #409eff);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.18);
}

.copy-theme-swatch {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  height: 78px;
  border: 1px solid transparent;
  border-radius: 6px;
  overflow: hidden;
}

.swatch-title {
  width: 46%;
  height: 8px;
  border-radius: 3px;
}

.swatch-text {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(120, 120, 130, 0.32);
}

.swatch-text.short {
  width: 72%;
}

.swatch-text.is-dark {
  background: rgba(220, 222, 230, 0.42);
}

.swatch-block {
  margin-top: auto;
  width: 100%;
  height: 18px;
  border-radius: 4px;
  opacity: 0.85;
}

.copy-theme-name {
  font-size: 12.5px;
  text-align: center;
  color: var(--text-color-primary, #303133);
}

.copy-theme-note {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-secondary, #909399);
}
</style>
