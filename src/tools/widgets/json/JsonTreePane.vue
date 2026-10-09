<template>
  <div class="json-tree-pane">
    <div ref="viewportRef" class="tree-viewport" @scroll="onScroll">
      <div class="tree-canvas" :style="{ height: totalHeight + 'px' }">
        <div
          v-for="item in visibleRows"
          :key="item.key"
          class="tree-row"
          :class="{
            'is-selected': item.node.path === selectedPath,
            'is-hit': item.hit,
            'is-more': item.kind === 'more',
          }"
          :style="{ transform: `translateY(${item.top}px)`, paddingLeft: item.depth * 14 + 6 + 'px' }"
          @click="onRowClick(item)"
        >
          <template v-if="item.kind === 'more'">
            <span class="row-more">还有 {{ item.remaining }} 项，点击加载更多</span>
          </template>
          <template v-else>
            <span class="row-caret" @click.stop="onToggle(item)">
              <el-icon v-if="item.expandable" :size="12">
                <component :is="item.expanded ? ArrowDown : ArrowRight" />
              </el-icon>
            </span>
            <span class="row-key">{{ item.node.key }}</span>
            <span class="row-split">:</span>
            <span class="row-value" :class="`v-${item.node.type}`">{{ item.preview }}</span>
            <span v-if="item.expandable && !item.expanded" class="row-badge">{{ item.node.childCount }}</span>
          </template>
        </div>
      </div>

      <div v-if="!rows.length" class="tree-empty">
        <span>{{ emptyText }}</span>
      </div>
    </div>

    <div v-if="selected" class="tree-detail">
      <div class="detail-head">
        <code class="detail-path">{{ selected.path }}</code>
        <el-button text size="small" @click="copyPath">复制路径</el-button>
        <el-button text size="small" @click="copyValue">复制值</el-button>
      </div>
      <pre class="detail-value">{{ detailText }}</pre>
    </div>

    <div class="tree-foot">
      <span>可见 {{ rows.length }} 行</span>
      <span v-if="search">命中 {{ search.count }} 条<template v-if="search.truncated">（已截断）</template></span>
      <span v-if="truncated" class="foot-warn">行数超过上限，已折叠展示</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useClipboard } from '../../useClipboard'
import {
  flattenTree,
  nodePreview,
  showMore,
  stringifyNode,
  toggleNode,
  type JsonNode,
  type JsonTreeStore,
  type SearchResult,
  type TreeRow,
} from './jsonTree'

const props = withDefaults(
  defineProps<{
    /** 树状态容器 */
    store: JsonTreeStore
    /** 结构版本号，递增后重新扁平化 */
    version: number
    /** 搜索结果，为空表示不过滤 */
    search?: SearchResult | null
    /** 空状态文案 */
    emptyText?: string
  }>(),
  { search: null, emptyText: '暂无可展示的数据' },
)

const emit = defineEmits<{
  /** 树结构发生变更，宿主需递增 version */
  (e: 'change'): void
}>()

/** 行高，需与 CSS 中 .tree-row 的 height 保持一致 */
const ROW_HEIGHT = 24
/** 详情区最大展示字符数，超出仅截断显示，复制仍为完整内容 */
const DETAIL_MAX_LENGTH = 4000

const { copy } = useClipboard()

/** 滚动容器 */
const viewportRef = ref<HTMLElement | null>(null)
/** 纵向滚动偏移 */
const scrollTop = ref(0)
/** 滚动容器可视高度 */
const viewportHeight = ref(320)
/** 当前选中节点的 path */
const selectedPath = ref('')
/** 当前选中节点 */
const selected = shallowRef<JsonNode | null>(null)

/** 扁平化结果：依赖 version 触发重算 */
const flatten = computed(() => {
  void props.version
  return flattenTree(props.store, props.search ?? null)
})

/** 可见行列表 */
const rows = computed<TreeRow[]>(() => flatten.value.rows)
/** 是否因超过上限被截断 */
const truncated = computed(() => flatten.value.truncated)
/** 画布总高度 */
const totalHeight = computed(() => rows.value.length * ROW_HEIGHT)

/** 渲染窗口起始下标 */
const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - 6))
/** 渲染窗口结束下标 */
const endIndex = computed(() =>
  Math.min(rows.value.length, Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + 6),
)

/** 带定位信息的可见行，仅渲染窗口内的行以保证大 JSON 流畅 */
const visibleRows = computed(() =>
  rows.value.slice(startIndex.value, endIndex.value).map((row, offset) => ({
    kind: row.kind,
    node: row.node,
    depth: row.depth,
    expandable: row.expandable,
    expanded: row.expanded,
    remaining: row.remaining,
    preview: row.kind === 'more' ? '' : nodePreview(row.node),
    hit: props.search ? props.search.hits.has(row.node.path) : false,
    key: `${row.kind}-${row.node.path}`,
    top: (startIndex.value + offset) * ROW_HEIGHT,
  })),
)

/** 选中节点的详情文本 */
const detailText = computed(() => {
  if (!selected.value) {
    return ''
  }
  const full = stringifyNode(selected.value, '  ')
  return full.length > DETAIL_MAX_LENGTH ? `${full.slice(0, DETAIL_MAX_LENGTH)}\n… 内容过长已截断，复制可获取完整数据` : full
})

/**
 * 记录滚动位置，驱动窗口重算。
 */
function onScroll(): void {
  scrollTop.value = viewportRef.value?.scrollTop ?? 0
}

/**
 * 展开或折叠节点。
 *
 * @param row 目标行
 */
function onToggle(row: TreeRow): void {
  toggleNode(props.store, row.node)
  emit('change')
}

/**
 * 加载更多子节点。
 *
 * @param row 「加载更多」占位行
 */
function onRowClick(row: TreeRow): void {
  if (row.kind === 'more') {
    showMore(props.store, row.node)
    emit('change')
    return
  }
  selected.value = row.node
  selectedPath.value = row.node.path
}

/**
 * 复制选中节点的 JSONPath。
 */
function copyPath(): void {
  if (selected.value) {
    void copy(selected.value.path, '路径已复制')
  }
}

/**
 * 复制选中节点的完整值。
 */
function copyValue(): void {
  if (selected.value) {
    void copy(stringifyNode(selected.value, '  '), '节点值已复制')
  }
}

/** 尺寸监听句柄 */
let observer: ResizeObserver | null = null

onMounted(() => {
  if (viewportRef.value) {
    viewportHeight.value = viewportRef.value.clientHeight
    observer = new ResizeObserver((entries) => {
      viewportHeight.value = entries[0]?.contentRect.height ?? viewportHeight.value
    })
    observer.observe(viewportRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// 数据或过滤条件变化时回到顶部，并清除旧树的选中态
watch([() => props.search, () => props.store], () => {
  selected.value = null
  selectedPath.value = ''
  scrollTop.value = 0
  if (viewportRef.value) {
    viewportRef.value.scrollTop = 0
  }
})
</script>

<style scoped>
.json-tree-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-blank);
}

.tree-viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}

.tree-canvas {
  position: relative;
  width: 100%;
}

.tree-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  font-size: 13px;
  line-height: 24px;
  white-space: nowrap;
  cursor: pointer;
}

.tree-row:hover {
  background: var(--el-fill-color-light);
}

.tree-row.is-selected {
  background: var(--el-color-primary-light-9);
}

.tree-row.is-hit .row-key,
.tree-row.is-hit .row-value {
  background: var(--el-color-warning-light-7);
  border-radius: 3px;
}

.row-caret {
  width: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.row-key {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.row-split {
  color: var(--el-text-color-placeholder);
}

.row-value {
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-value.v-string {
  color: #67c23a;
}

.row-value.v-number {
  color: #e6a23c;
}

.row-value.v-boolean {
  color: #409eff;
}

.row-value.v-null {
  color: var(--el-text-color-placeholder);
}

.row-value.v-object,
.row-value.v-array {
  color: var(--el-text-color-secondary);
}

.row-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 16px;
}

.row-more {
  color: var(--el-color-primary);
  font-size: 12px;
}

.tree-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  pointer-events: none;
}

.tree-detail {
  flex-shrink: 0;
  max-height: 30%;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
}

.detail-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-color-primary);
}

.detail-value {
  margin: 0;
  padding: 0 10px 8px;
  overflow: auto;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-all;
}

.tree-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.foot-warn {
  color: var(--el-color-warning);
}
</style>
