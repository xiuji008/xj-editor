<template>
  <div class="note-card" :class="{ 'is-current': current, 'is-editing': editing }">
    <!-- 左侧色条：高亮颜色，纯页码笔记时为灰色 -->
    <div class="card-bar" :style="{ background: barColor }" />

    <div class="card-main">
      <header class="card-head" @click="emit('jump', item.page)">
        <span class="page-tag">P{{ item.page }}</span>
        <el-tag v-if="item.note?.source === 'ai'" size="small" type="success" effect="plain">AI</el-tag>
        <span class="time-text">{{ timeText }}</span>
        <span class="head-spacer" />

        <div class="ops" @click.stop>
          <!-- 高亮颜色：预设 + 自定义 -->
          <el-popover v-if="item.mark" placement="bottom-end" :width="176" trigger="click">
            <template #reference>
              <el-button text size="small" title="高亮颜色">
                <span class="color-dot" :style="{ background: item.mark.color }" />
              </el-button>
            </template>
            <div class="color-grid">
              <button
                v-for="c in colors"
                :key="c.value"
                type="button"
                class="color-item"
                :class="{ 'is-active': item.mark.color === c.value }"
                :style="{ background: c.value }"
                :title="c.label"
                @click="emit('set-color', item.mark!.id, c.value)"
              />
              <el-color-picker size="small" :model-value="item.mark.color" @change="onCustomColor" />
            </div>
          </el-popover>

          <el-tooltip content="编辑笔记" placement="top">
            <el-button v-if="item.note && !editing" text size="small" @click="startEdit">
              <el-icon><Edit /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="item.note ? 'AI 完善笔记' : 'AI 生成笔记'" placement="top">
            <el-button v-if="!aiRunning" text size="small" @click="emitAi">
              <el-icon><MagicStick /></el-icon>
            </el-button>
          </el-tooltip>
          <el-popconfirm :title="removeTitle" width="220" @confirm="onRemove">
            <template #reference>
              <el-button text size="small" title="删除">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>
          </el-popconfirm>
        </div>
      </header>

      <!-- 高亮原文 -->
      <div v-if="item.mark" class="quote" :style="{ borderLeftColor: item.mark.color }">
        {{ item.mark.quote || '（高亮区域）' }}
      </div>

      <!-- AI 流式生成中：直接展示纯文本，避免频繁重渲染 Markdown -->
      <div v-if="aiRunning" class="ai-running">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>AI 正在生成…</span>
        <el-button text size="small" @click.stop="emit('ai-stop', item.key)">停止</el-button>
        <div v-if="streamText" class="stream-text">{{ streamText }}</div>
      </div>

      <template v-else-if="item.note">
        <!-- 编辑态 -->
        <div v-if="editing" class="edit-area">
          <el-input v-model="draft" type="textarea" :rows="4" size="small" resize="vertical" placeholder="写下你的想法，支持 Markdown…" />
          <div class="edit-foot">
            <span class="md-hint">支持 Markdown</span>
            <div class="edit-btns">
              <el-button size="small" text @click="cancelEdit">取消</el-button>
              <el-button size="small" type="primary" @click="saveNote">保存</el-button>
            </div>
          </div>
        </div>
        <!-- 展示态：Markdown 渲染 -->
        <div
          v-else-if="item.note.text.trim()"
          ref="mdRef"
          class="note-md"
          title="点击编辑"
          v-html="renderedHtml"
          @click="startEdit"
        />
        <div v-else class="note-empty" @click="startEdit">点击添加笔记内容…</div>
      </template>

      <!-- 仅有高亮、还没有笔记 -->
      <el-button v-if="!item.note" size="small" text class="add-note" @click.stop="emit('add-note', item.page, item.mark?.id)">
        <el-icon><EditPen /></el-icon>&nbsp;添加笔记
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Delete, Edit, EditPen, Loading, MagicStick } from '@element-plus/icons-vue'
import { enhanceRenderedDom, renderMarkdown } from '../../utils/markdown'
import type { PdfMarkColor, PdfMark, PdfNote } from '../../utils/pdfNotes'

/** 侧栏列表条目 */
export interface PdfNoteItem {
  /** 列表唯一键（标记或笔记其一必存在） */
  key: string
  /** 页码 */
  page: number
  /** 关联的高亮标记 */
  mark?: PdfMark
  /** 关联的笔记 */
  note?: PdfNote
}

const props = defineProps<{
  /** 列表条目 */
  item: PdfNoteItem
  /** 是否为当前阅读页（用于强调底色） */
  current: boolean
  /** 是否正在为该条目生成 AI 笔记 */
  aiRunning: boolean
  /** AI 流式增量文本 */
  streamText: string
  /** 高亮颜色预设 */
  colors: PdfMarkColor[]
}>()

const emit = defineEmits<{
  /** 跳转到所属页 */
  (e: 'jump', page: number): void
  /** 保存笔记正文 */
  (e: 'save', note: PdfNote, text: string): void
  /** 新增笔记 */
  (e: 'add-note', page: number, markId?: string): void
  /** 删除标记（连带笔记） */
  (e: 'remove-mark', id: string): void
  /** 删除笔记 */
  (e: 'remove-note', id: string): void
  /** 修改高亮颜色 */
  (e: 'set-color', id: string, color: string): void
  /** 请求 AI 生成 / 完善笔记 */
  (e: 'ai', payload: { key: string; page: number; quote: string; markId?: string; noteId?: string; existing?: string }): void
  /** 中断 AI 生成 */
  (e: 'ai-stop', key: string): void
}>()

/** Markdown 渲染容器 */
const mdRef = ref<HTMLElement | null>(null)
/** 是否处于编辑态 */
const editing = ref(false)
/** 编辑草稿 */
const draft = ref('')

/** 左侧色条颜色：无高亮时用中性灰 */
const barColor = computed(() => props.item.mark?.color || '#dcdfe6')

/** 展示用时间（今天只显示时分，跨天显示月日） */
const timeText = computed(() => {
  const raw = props.item.note?.updatedAt || props.item.mark?.createdAt
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

/** 删除确认文案 */
const removeTitle = computed(() => {
  if (props.item.mark && props.item.note) return '删除该高亮及其笔记？'
  return props.item.mark ? '删除该高亮标记？' : '删除该笔记？'
})

/** 笔记正文 → Markdown HTML */
const renderedHtml = computed(() => {
  const text = props.item.note?.text
  return text ? renderMarkdown(text) : ''
})

/** 渲染完成后增强 DOM（代码块高亮 / 复制按钮 / 图表） */
async function enhance() {
  await nextTick()
  const el = mdRef.value
  if (el) await enhanceRenderedDom(el, 'PDF 笔记')
}

watch(() => [props.item.note?.text, props.item.note?.id], enhance, { immediate: true })
onMounted(enhance)

/** 进入编辑态：以当前正文为草稿 */
function startEdit() {
  if (!props.item.note) return
  draft.value = props.item.note.text
  editing.value = true
}

/** 取消编辑：丢弃草稿 */
function cancelEdit() {
  editing.value = false
  if (props.item.note && !props.item.note.text.trim()) {
    // 空笔记取消编辑时保持原样（等待用户补充或删除）
  }
}

/** 保存编辑结果 */
function saveNote() {
  if (!props.item.note) return
  editing.value = false
  emit('save', props.item.note, draft.value)
}

/** 自定义颜色（取色器可能返回 null，此时忽略） */
function onCustomColor(value: string | null) {
  if (!value || !props.item.mark) return
  emit('set-color', props.item.mark.id, value)
}

/** 请求 AI 生成：带上原文与已有笔记 */
function emitAi() {
  const payload = {
    key: props.item.key,
    page: props.item.page,
    quote: props.item.mark?.quote || '',
    markId: props.item.mark?.id,
    noteId: props.item.note?.id,
    existing: props.item.note?.text || '',
  }
  emit('ai', payload)
}

/** 删除：按条目类型派发 */
function onRemove() {
  if (props.item.mark) {
    emit('remove-mark', props.item.mark.id)
    return
  }
  if (props.item.note) emit('remove-note', props.item.note.id)
}
</script>

<style scoped>
.note-card {
  display: flex;
  margin-bottom: 6px;
  border: 1px solid var(--border-color-lighter, #ebeef5);
  border-radius: 6px;
  background: var(--bg-color-white, #fff);
  overflow: hidden;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.note-card:hover {
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

.note-card.is-current {
  border-color: #b3d8ff;
}

.card-bar {
  flex-shrink: 0;
  width: 3px;
}

.card-main {
  flex: 1;
  min-width: 0;
  padding: 6px 8px 8px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.page-tag {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 12px;
  line-height: 18px;
}

.time-text {
  font-size: 11px;
  color: #c0c4cc;
}

.head-spacer {
  flex: 1;
}

.ops {
  display: flex;
  align-items: center;
  gap: 0;
}

.ops :deep(.el-button + .el-button) {
  margin-left: 0;
}

.color-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 50%;
}

.color-grid {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-item {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
}

.color-item.is-active {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 1px;
}

.quote {
  margin: 6px 0 4px;
  padding-left: 6px;
  border-left: 3px solid #ffe58f;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-color-regular, #606266);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.note-md {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-color-primary, #303133);
  cursor: text;
  word-break: break-word;
}

.note-md :deep(p) {
  margin: 4px 0;
}

.note-md :deep(p:last-child) {
  margin-bottom: 0;
}

.note-md :deep(h1),
.note-md :deep(h2),
.note-md :deep(h3),
.note-md :deep(h4) {
  margin: 6px 0 4px;
  font-size: 13px;
  font-weight: 600;
}

.note-md :deep(ul),
.note-md :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}

.note-md :deep(li) {
  margin: 2px 0;
}

.note-md :deep(a) {
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
}

.note-md :deep(code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #e96900;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}

.note-md :deep(pre) {
  margin: 6px 0;
  padding: 8px;
  border-radius: 4px;
  background: #f5f7fa;
  overflow-x: auto;
}

.note-md :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.note-md :deep(blockquote) {
  margin: 6px 0;
  padding: 2px 10px;
  border-left: 3px solid #dcdfe6;
  color: #606266;
}

.note-md :deep(strong) {
  font-weight: 600;
}

.note-md :deep(table) {
  margin: 6px 0;
  border-collapse: collapse;
  font-size: 12px;
}

.note-md :deep(th),
.note-md :deep(td) {
  padding: 3px 6px;
  border: 1px solid #ebeef5;
}

.note-empty {
  font-size: 12px;
  color: #c0c4cc;
  cursor: text;
}

.edit-area {
  margin-top: 4px;
}

.edit-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.md-hint {
  font-size: 11px;
  color: #c0c4cc;
}

.ai-running {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  padding: 4px 6px;
  border-radius: 4px
;
  background: var(--el-color-primary-light-9, #ecf5ff);
  font-size: 12px;
  color: var(--el-color-primary, #409eff);
  flex-wrap: wrap;
}

.stream-text {
  flex-basis: 100%;
  max-height: 120px;
  overflow-y: auto;
  color: var(--text-color-regular, #606266);
  white-space: pre-wrap;
  line-height: 1.5;
}

.add-note {
  margin-top: 2px;
  font-size: 12px;
}
</style>
