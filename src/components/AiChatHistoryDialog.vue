<template>
  <el-dialog v-model="visible" title="历史对话" width="620px" top="6vh" @open="onOpen">
    <div class="chat-history">
      <div class="history-toolbar">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          placeholder="搜索对话标题 / 内容"
          class="search-input"
        />
        <span class="total">共 {{ filtered.length }} 条</span>
      </div>

      <div class="history-list">
        <el-empty v-if="!filtered.length" description="暂无历史对话" :image-size="80" />
        <div
          v-for="s in paged"
          :key="s.id"
          class="history-item"
          :class="{ active: s.id === chat.activeId.value }"
          @click="handleOpen(s.id)"
        >
          <div class="item-main">
            <div class="item-title">
              <el-icon class="item-icon"><ChatDotRound /></el-icon>
              <span class="title-text">{{ s.title || '新对话' }}</span>
              <el-tag v-if="s.id === chat.activeId.value" size="small" effect="dark" class="current-tag">
                当前
              </el-tag>
            </div>
            <div class="item-preview">{{ sessionPreview(s) }}</div>
          </div>
          <div class="item-side">
            <div class="item-meta">
              <span>{{ formatSessionTime(s.updatedAt) }}</span>
              <span class="dot">·</span>
              <span>{{ s.messages.length }} 条</span>
            </div>
            <div class="item-actions">
              <el-button text size="small" type="primary" @click.stop="handleRename(s)">重命名</el-button>
              <el-button text size="small" type="danger" @click.stop="handleRemove(s)">删除</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页：历史对话按最后更新时间倒序展示，仅支持逐条删除，不提供清空 -->
      <div class="history-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="filtered.length"
          :page-sizes="[10, 20, 50]"
          :disabled="!filtered.length"
          size="small"
          background
          layout="sizes, prev, pager, next, jumper"
        />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatDotRound } from '@element-plus/icons-vue'
import { formatSessionTime, sessionPreview } from '../utils/aiChat'
import type { AiChatStore } from '../composables/useAiChat'

/**
 * 历史对话查看：按时间倒序分页浏览、搜索、切换、重命名、删除历史会话。
 * 会话数据与当前 AI 面板 / 独立对话窗口共享，切换后即时生效；
 * 历史对话只逐条删除，不提供「清空全部」。
 */
const props = defineProps<{
  modelValue: boolean
  /** AI 对话状态（来自 useAiChat） */
  chat: AiChatStore
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 搜索关键字（匹配标题与最后一条消息预览） */
const keyword = ref('')
/** 当前页码（从 1 开始） */
const page = ref(1)
/** 每页条数 */
const pageSize = ref(10)

/** 会话列表：按最后更新时间倒序（最近使用的在前） */
const sorted = computed(() =>
  [...props.chat.sessions.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
)

/** 关键字过滤后的会话（保持倒序） */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return sorted.value
  return sorted.value.filter((s) => {
    const text = `${s.title || ''} ${sessionPreview(s)}`.toLowerCase()
    return text.includes(kw)
  })
})

/** 当前页展示的会话 */
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// 搜索条件或每页条数变化时回到第一页
watch([keyword, pageSize], () => {
  page.value = 1
})

// 总数变化（删除会话、其它窗口新增）后校正页码，避免停留在空白页
watch(
  () => filtered.value.length,
  (total) => {
    const max = Math.max(1, Math.ceil(total / pageSize.value))
    if (page.value > max) page.value = max
  },
)

/** 打开弹窗时回到第一页并刷新一次，保证拿到其它窗口的最新数据 */
function onOpen() {
  page.value = 1
  void props.chat.loadSessions()
}

/** 切换到该会话并关闭弹窗 */
function handleOpen(id: string) {
  props.chat.selectSession(id)
  visible.value = false
}

/** 重命名会话 */
async function handleRename(session: AiChatSession) {
  try {
    const res = await ElMessageBox.prompt('输入新的对话标题', '重命名对话', {
      inputValue: session.title || '',
      inputPlaceholder: '留空则恢复为自动标题',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    await props.chat.renameSession(session.id, String(res.value || ''))
    ElMessage.success('已重命名')
  } catch {
    /* 取消或失败时忽略 */
  }
}

/** 删除会话 */
async function handleRemove(session: AiChatSession) {
  try {
    await ElMessageBox.confirm(`确定删除对话「${session.title || '新对话'}」吗？删除后不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await props.chat.removeSession(session.id)
  ElMessage.success('已删除')
}
</script>

<style scoped>
.chat-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input {
  flex: 1;
}

.total {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.history-list {
  height: 400px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px;
}

.history-pager {
  display: flex;
  justify-content: flex-end;
}

.history-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-item:hover {
  background: var(--el-fill-color-light);
}

.history-item.active {
  background: var(--el-color-primary-light-9);
}

.item-main {
  min-width: 0;
  flex: 1;
}

.item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.item-icon {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.current-tag {
  flex-shrink: 0;
  transform: scale(0.9);
}

.item-preview {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-side {
  flex-shrink: 0;
  text-align: right;
}

.item-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.item-meta .dot {
  margin: 0 4px;
}

.item-actions {
  margin-top: 2px;
}

.item-actions .el-button {
  padding: 0 4px;
}
</style>
