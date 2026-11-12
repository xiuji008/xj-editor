<script setup lang="ts">
/**
 * 预览区右上角的「复制」入口。
 *
 * 支持的复制目标：
 * - Markdown 源码（纯文本）
 * - 公众号格式（内联样式的富文本，主题可在弹窗里选）
 * - 知乎格式（富文本，弱化装饰）
 * - 掘金格式（富文本，代码块换行已按掘金要求修正）
 * - 纯 HTML（富文本，默认主题）
 * - 长图 PNG（html-to-image 截图后写剪贴板）
 */
import { ref } from 'vue'
import { ElLoading, ElMessage } from 'element-plus'
import { DocumentCopy } from '@element-plus/icons-vue'
import { readStoredCopyTheme } from '../utils/copyThemes'
import {
  copyAsLongImage,
  copyAsPlatform,
  copyMarkdownSource,
} from '../utils/copyExport'
import CopyThemeDialog from './CopyThemeDialog.vue'

const props = withDefaults(
  defineProps<{
    /** Markdown 源码 */
    markdown: string
    /** 当前代码高亮主题 */
    codeTheme?: string
    /** 当前文档名 */
    fileName?: string
    /** 预览容器（.preview-zoom-inner） */
    sourceEl?: HTMLElement | null
  }>(),
  { codeTheme: '', fileName: '', sourceEl: null },
)

/** 公众号主题选择弹窗 */
const themeDialogVisible = ref(false)

function notify(successText: string, warnings: string[], plainMode?: boolean): void {
  if (plainMode) {
    ElMessage.warning('剪贴板写入受限，本次只复制了 HTML 源文本（重启应用后再试通常可恢复）')
    return
  }
  if (warnings.length) ElMessage.warning(`${successText}（${warnings[0]}）`)
  else ElMessage.success(successText)
}

async function handleCommand(command: string): Promise<void> {
  if (command === 'wechat') {
    // 一键直复制：用记住的公众号主题，不弹窗
    await copyWechat()
    return
  }

  if (command === 'wechat-theme') {
    themeDialogVisible.value = true
    return
  }

  if (command === 'markdown') {
    const ok = await copyMarkdownSource(props.markdown)
    if (!ok) {
      ElMessage.error('复制失败，请检查剪贴板权限')
      return
    }
    ElMessage.success('已复制 Markdown 源码')
    return
  }

  if (command === 'image') {
    await handleLongImage()
    return
  }

  // zhihu / juejin / html：走同一套富文本管线
  const platform = command === 'zhihu' ? 'zhihu' : command === 'juejin' ? 'juejin' : 'html'
  try {
    const { ok, warnings, mode } = await copyAsPlatform({
      markdown: props.markdown,
      platform,
      themeKey: readStoredCopyTheme(),
      codeTheme: props.codeTheme,
      fileName: props.fileName,
      sourceEl: props.sourceEl,
    })
    if (!ok) {
      ElMessage.error('复制失败，请检查剪贴板权限')
      return
    }
    const texts: Record<string, string> = {
      zhihu: '已复制知乎格式，去知乎编辑器粘贴',
      juejin: '已复制掘金格式，去掘金编辑器粘贴',
      html: '已复制 HTML 富文本',
    }
    notify(texts[platform] || '已复制富文本', warnings, mode === 'plain')
  } catch (err) {
    ElMessage.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 一键复制公众号格式（当前记住的主题） */
async function copyWechat(): Promise<void> {
  try {
    const { ok, warnings, mode } = await copyAsPlatform({
      markdown: props.markdown,
      platform: 'wechat',
      themeKey: readStoredCopyTheme(),
      codeTheme: props.codeTheme,
      fileName: props.fileName,
      sourceEl: props.sourceEl,
    })
    if (!ok) {
      ElMessage.error('复制失败，请检查剪贴板权限')
      return
    }
    notify('已复制公众号格式，去公众号编辑器粘贴', warnings, mode === 'plain')
  } catch (err) {
    ElMessage.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 长图较慢（截图 + 编码），用全屏 loading 兜住 */
async function handleLongImage(): Promise<void> {
  const loading = ElLoading.service({ lock: true, text: '正在生成长图…' })
  try {
    const res = await copyAsLongImage({
      markdown: props.markdown,
      themeKey: readStoredCopyTheme(),
      codeTheme: props.codeTheme,
      fileName: props.fileName,
      sourceEl: props.sourceEl,
    })
    if (res.ok) notify('已复制长图 PNG', res.warnings)
    else ElMessage.error(`长图生成失败：${res.error || '未知错误'}`)
  } finally {
    loading.close()
  }
}
</script>

<template>
  <el-dropdown
    trigger="click"
    placement="bottom-end"
    :disabled="!markdown"
    @command="handleCommand"
  >
    <el-button text size="small" class="copy-trigger" title="复制 Markdown / 公众号 / 知乎 / 长图">
      <el-icon><DocumentCopy /></el-icon>
      <span class="copy-trigger-text">复制</span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="wechat">复制为公众号格式</el-dropdown-item>
        <el-dropdown-item command="wechat-theme">公众号主题设置…</el-dropdown-item>
        <el-dropdown-item command="zhihu" divided>复制为知乎格式</el-dropdown-item>
        <el-dropdown-item command="juejin">复制为掘金格式</el-dropdown-item>
        <el-dropdown-item command="html">复制为纯 HTML</el-dropdown-item>
        <el-dropdown-item command="image" divided>复制为长图 PNG</el-dropdown-item>
        <el-dropdown-item command="markdown">复制 Markdown 源码</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <CopyThemeDialog
    v-model="themeDialogVisible"
    :markdown="markdown"
    :code-theme="codeTheme"
    :file-name="fileName"
    :source-el="sourceEl"
  />
</template>

<style scoped>
.copy-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12.5px;
  color: var(--text-color-secondary, #606266);
}

.copy-trigger:hover {
  color: var(--color-primary, #409eff);
}

.copy-trigger-text {
  line-height: 1;
}
</style>
