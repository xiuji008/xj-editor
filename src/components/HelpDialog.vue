<template>
  <el-dialog
    v-model="visible"
    title="帮助文档"
    width="920px"
    top="6vh"
    class="help-dialog"
    @open="onOpen"
    @closed="onClosed"
  >
    <div class="help-body">
      <!-- 左侧：章节导航 -->
      <nav class="help-nav">
        <div
          v-for="item in sections"
          :key="item.key"
          class="help-nav-item"
          :class="{ 'is-active': item.key === activeKey }"
          @click="activeKey = item.key"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span class="nav-label">{{ item.label }}</span>
        </div>
        <div class="help-nav-footer">
          <el-button text size="small" :icon="Link" @click="openProjectPage">
            GitHub 项目主页
          </el-button>
        </div>
      </nav>

      <!-- 右侧：文档内容（由本应用自身的 Markdown 渲染器渲染） -->
      <section class="help-content">
        <div ref="contentRef" class="markdown-body help-markdown" v-html="renderedHtml"></div>
        <div v-if="rendering" class="help-rendering">渲染中…</div>
      </section>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, type Component } from 'vue'
import {
  Document,
  Key,
  EditPen,
  MagicStick,
  Link,
} from '@element-plus/icons-vue'
import { renderMarkdown, enhanceRenderedDom } from '../utils/markdown'
import { unmountAllWhiteboardEmbeds } from '../utils/whiteboardEmbed'
import featuresMd from './help/help-features.md?raw'
import shortcutsMd from './help/help-shortcuts.md?raw'
import markdownMd from './help/help-markdown.md?raw'
import codeLangsMd from './help/help-codelangs.md?raw'

const visible = defineModel<boolean>({ default: false })

/** 帮助章节：功能介绍 / 快捷键 / Markdown 语法 / 代码块语言 */
const sections: { key: string; label: string; icon: Component; md: string }[] = [
  { key: 'features', label: '功能介绍', icon: Document, md: featuresMd },
  { key: 'shortcuts', label: '快捷键', icon: Key, md: shortcutsMd },
  { key: 'markdown', label: 'Markdown 语法', icon: EditPen, md: markdownMd },
  { key: 'codelangs', label: '代码块语言', icon: MagicStick, md: codeLangsMd },
]

const activeKey = ref('features')
const renderedHtml = ref('')
const rendering = ref(false)
const contentRef = ref<HTMLElement | null>(null)

/** 当前章节的渲染序列号：切换章节后丢弃上一轮的异步渲染结果 */
let renderSeq = 0

/** 首次打开时渲染默认章节 */
function onOpen() {
  if (!renderedHtml.value) {
    void renderActive()
  }
}

/** 切换章节后重新渲染（卸载上一轮内嵌的白板 React 根，避免泄漏） */
async function renderActive() {
  const seq = ++renderSeq
  const section = sections.find((s) => s.key === activeKey.value)
  rendering.value = true
  renderedHtml.value = renderMarkdown(section?.md || '')
  await nextTick()
  if (seq !== renderSeq) return
  const container = contentRef.value
  if (container) {
    try {
      await enhanceRenderedDom(container)
    } catch {
      /* 帮助文档增强失败不影响基础 HTML 展示 */
    }
  }
  if (seq === renderSeq) rendering.value = false
}

/** 关闭后卸载文档中内嵌的白板 / 图表，释放资源 */
function onClosed() {
  renderSeq++
  unmountAllWhiteboardEmbeds()
}

function openProjectPage() {
  window.mdAPI?.openExternalUrl?.('https://github.com/xiuji008/xj-editor')
}

watch(activeKey, () => {
  void renderActive()
})
</script>

<style scoped>
.help-body {
  display: flex;
  gap: 16px;
  height: 66vh;
}
.help-nav {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 8px;
}
.help-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--el-text-color-primary);
  font-size: 14px;
  margin-bottom: 2px;
}
.help-nav-item:hover {
  background: var(--el-fill-color-light);
}
.help-nav-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.nav-icon {
  font-size: 15px;
}
.help-nav-footer {
  margin-top: auto;
  padding: 4px 2px;
}
.help-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 16px 4px;
}
.help-rendering {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 6px 0;
}

/* 文档渲染样式（与编辑器预览区一致的排版基调） */
.help-markdown {
  font-size: 14px;
  line-height: 1.75;
  color: var(--el-text-color-primary);
}
.help-markdown :deep(h1) {
  font-size: 22px;
  margin: 8px 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.help-markdown :deep(h2) {
  font-size: 17px;
  margin: 22px 0 10px;
}
.help-markdown :deep(h3) {
  font-size: 15px;
  margin: 16px 0 8px;
}
.help-markdown :deep(p) {
  margin: 8px 0;
}
.help-markdown :deep(ul),
.help-markdown :deep(ol) {
  padding-left: 22px;
  margin: 6px 0;
}
.help-markdown :deep(li) {
  margin: 3px 0;
}
.help-markdown :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--el-color-primary);
  background: var(--el-fill-color-light);
  border-radius: 0 6px 6px 0;
  color: var(--el-text-color-regular);
}
.help-markdown :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 13px;
}
.help-markdown :deep(th),
.help-markdown :deep(td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 12px;
  text-align: left;
}
.help-markdown :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}
.help-markdown :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  background: var(--el-fill-color);
  padding: 1px 5px;
  border-radius: 4px;
}
.help-markdown :deep(.code-block-wrapper) {
  margin: 12px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--code-border, #383838);
}
.help-markdown :deep(.code-block-wrapper .code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--code-header-bg, #2d2d2d);
  border-bottom: 1px solid var(--code-border, #383838);
}
.help-markdown :deep(.code-block-wrapper .code-lang) {
  font-size: 12px;
  color: var(--code-lang-color, #999);
  font-family: 'Consolas', monospace;
}
.help-markdown :deep(.code-block-wrapper pre) {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  background: var(--code-bg, #1e1e1e);
}
.help-markdown :deep(.code-block-wrapper pre code) {
  padding: 0;
  background: transparent;
  color: var(--code-text, #d4d4d4);
  font-size: 13px;
  line-height: 1.6;
}
.help-markdown :deep(.github-alert) {
  margin: 14px 0;
  border-radius: 8px;
  border: 1px solid;
  overflow: hidden;
}
.help-markdown :deep(.github-alert .alert-header) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-weight: 600;
  font-size: 13px;
}
.help-markdown :deep(.github-alert .alert-body) {
  padding: 8px 16px 12px;
  font-size: 13px;
}
.help-markdown :deep(.mermaid-container),
.help-markdown :deep(.chart-container),
.help-markdown :deep(.plantuml-container),
.help-markdown :deep(.math-block),
.help-markdown :deep(.whiteboard-embed) {
  margin: 12px 0;
  overflow-x: auto;
}
</style>
