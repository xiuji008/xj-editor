/**
 * PDF 批注与笔记侧栏
 *
 * 设计要点：
 * - 默认「只显示当前页」：阅读时不被整篇批注干扰，滚动到哪一页就看到哪一页的笔记；
 *   需要纵观时切换到「全部」；
 * - 列表以「标记为主线」组织：高亮标记与其笔记合并为一张卡片，纯页码笔记单独成卡；
 * - 每张卡片的具体呈现与交互（Markdown 渲染、编辑、配色、AI）由 PdfNoteCard 承担。
 *
 * @module components/pdf/PdfNotesPanel
 */
<template>
  <div class="pdf-notes-panel">
    <div class="panel-head">
      <span class="panel-title">批注与笔记</span>
      <div class="panel-actions">
        <el-tooltip content="在当前页新增笔记" placement="bottom">
          <el-button size="small" text @click="emit('add-note', currentPage)">
            <el-icon><Plus /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="导出为 Markdown" placement="bottom">
          <el-button size="small" text :disabled="!total" @click="emit('export')">
            <el-icon><Download /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip :content="`在文件夹中显示 ${sidecarName}`" placement="bottom">
          <el-button size="small" text @click="emit('reveal')">
            <el-icon><FolderOpened /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div class="panel-filter">
      <el-radio-group v-model="onlyCurrent" size="small">
        <el-radio-button :value="true">
          本页&nbsp;<span class="count">{{ currentCount }}</span>
        </el-radio-button>
        <el-radio-button :value="false">
          全部&nbsp;<span class="count">{{ total }}</span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="!visibleItems.length" class="panel-empty">
      <el-icon :size="28" color="#c0c4cc"><EditPen /></el-icon>
      <p>{{ onlyCurrent ? `第 ${currentPage} 页还没有批注` : '还没有批注' }}</p>
      <p class="hint">开启「高亮标注」后选中文本即可标记，或直接为当前页添加笔记</p>
    </div>

    <div v-else class="panel-list">
      <PdfNoteCard
        v-for="item in visibleItems"
        :key="item.key"
        :item="item"
        :current="item.page === currentPage"
        :ai-running="aiKey === item.key"
        :stream-text="aiKey === item.key ? aiText : ''"
        :colors="colors"
        @jump="emit('jump', $event)"
        @save="(note, text) => emit('save', note, text)"
        @add-note="(page, markId) => emit('add-note', page, markId)"
        @remove-mark="emit('remove-mark', $event)"
        @remove-note="emit('remove-note', $event)"
        @set-color="(id, color) => emit('set-color', id, color)"
        @ai="emit('ai', $event)"
        @ai-stop="emit('ai-stop', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Download, FolderOpened, EditPen } from '@element-plus/icons-vue'
import PdfNoteCard, { type PdfNoteItem } from './PdfNoteCard.vue'
import type { PdfMark, PdfMarkColor, PdfNote } from '../../utils/pdfNotes'

const props = defineProps<{
  /** 高亮标记列表 */
  marks: PdfMark[]
  /** 笔记列表 */
  notes: PdfNote[]
  /** 当前阅读页码（1 起） */
  currentPage: number
  /** sidecar 文件名（悬浮提示用） */
  sidecarName: string
  /** 高亮颜色预设 */
  colors: PdfMarkColor[]
  /** 正在生成 AI 笔记的条目 key，无则为空串 */
  aiKey: string
  /** AI 流式增量文本 */
  aiText: string
}>()

const emit = defineEmits<{
  /** 跳转到指定页 */
  (e: 'jump', page: number): void
  /** 新增笔记：页码 + 可选关联标记 id */
  (e: 'add-note', page: number, markId?: string): void
  /** 保存笔记正文 */
  (e: 'save', note: PdfNote, text: string): void
  /** 删除标记（连带其笔记） */
  (e: 'remove-mark', id: string): void
  /** 删除笔记 */
  (e: 'remove-note', id: string): void
  /** 修改高亮颜色 */
  (e: 'set-color', id: string, color: string): void
  /** 请求 AI 生成 / 完善笔记 */
  (e: 'ai', payload: { key: string; page: number; quote: string; markId?: string; existing?: string }): void
  /** 中断 AI 生成 */
  (e: 'ai-stop', key: string): void
  /** 导出为 Markdown */
  (e: 'export'): void
  /** 在文件夹中显示 sidecar 文件 */
  (e: 'reveal'): void
}>()

/** 是否只显示当前阅读页的批注 */
const onlyCurrent = ref(true)

/** 全部条目：以标记为主线，笔记挂在标记上；无标记的笔记单独成条 */
const items = computed<PdfNoteItem[]>(() => {
  const list: PdfNoteItem[] = []
  const usedNoteIds = new Set<string>()
  for (const mark of props.marks) {
    const note = props.notes.find((n) => n.markId === mark.id)
    if (note) usedNoteIds.add(note.id)
    list.push({ key: `m-${mark.id}`, page: mark.page, mark, note })
  }
  for (const note of props.notes) {
    if (usedNoteIds.has(note.id)) continue
    list.push({ key: `n-${note.id}`, page: note.page, note })
  }
  return list.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    // 同页内按时间顺序（创建早的在前），便于顺着阅读顺序查看
    const ta = a.note?.createdAt || a.mark?.createdAt || ''
    const tb = b.note?.createdAt || b.mark?.createdAt || ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })
})

/** 当前页条目数 */
const currentCount = computed(() => items.value.filter((i) => i.page === props.currentPage).length)

/** 总条目数 */
const total = computed(() => items.value.length)

/** 过滤后的展示列表 */
const visibleItems = computed(() =>
  onlyCurrent.value ? items.value.filter((i) => i.page === props.currentPage) : items.value,
)
</script>

<style scoped>
.pdf-notes-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  width: 320px;
  border-left: 1px solid var(--border-color-lighter, #ebeef5);
  background: var(--bg-color-white, #fff);
}

.panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 2px 12px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.panel-filter {
  flex-shrink: 0;
  padding: 4px 12px 6px;
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
}

.panel-filter :deep(.el-radio-button__inner) {
  padding: 4px 10px;
  font-size: 12px;
}

.count {
  color: #909399;
}

.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px 16px;
  color: #909399;
  font-size: 13px;
}

.panel-empty p {
  margin: 0;
}

.panel-empty .hint {
  font-size: 12px;
  color: #c0c4cc;
  text-align: center;
  line-height: 1.6;
}

.panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 6px 10px;
}
</style>
