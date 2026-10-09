<template>
  <div class="json-code-pane" :class="{ 'is-dragging': dragging }" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
    <div ref="bodyRef" class="pane-body">
      <div class="code-gutter" :style="{ width: gutterWidth + 'px' }">
        <div class="gutter-inner" :style="{ transform: `translateY(${-scrollTop}px)` }">
          <span
            v-for="line in visibleLines"
            :key="line"
            class="line-no"
            :class="{ 'is-error': line === errorLine, 'is-caret': line === caretLine }"
            :style="{ top: (line - 1) * LINE_HEIGHT + 'px' }"
          >
            {{ line }}
          </span>
        </div>
      </div>

      <textarea
        ref="areaRef"
        class="code-area"
        :value="modelValue"
        :readonly="readonly"
        :placeholder="placeholder"
        spellcheck="false"
        wrap="off"
        @input="onInput"
        @scroll="onScroll"
        @click="updateCaret"
        @keyup="updateCaret"
      />
    </div>

    <div class="pane-foot">
      <span>行 {{ caretLine }} : 列 {{ caretColumn }}</span>
      <span>{{ lineCount }} 行</span>
      <span>{{ sizeText }}</span>
      <span v-if="dragging" class="foot-tip">松开鼠标即可载入文件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { countLines, formatSize, positionToLineColumn } from './jsonUtils'

const props = withDefaults(
  defineProps<{
    /** 编辑内容 */
    modelValue: string
    /** 需要高亮的错误行号，无错误时为 null */
    errorLine?: number | null
    /** 占位提示 */
    placeholder?: string
    /** 是否只读 */
    readonly?: boolean
  }>(),
  { errorLine: null, placeholder: '在此粘贴或输入 JSON 文本，也可以直接拖入 .json 文件', readonly: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'file', file: File): void
}>()

/** 行高，需与 CSS 中的 line-height 保持一致 */
const LINE_HEIGHT = 20

/** 文本域元素 */
const areaRef = ref<HTMLTextAreaElement | null>(null)
/** 编辑区容器，用于监听尺寸变化 */
const bodyRef = ref<HTMLElement | null>(null)
/** 当前行数 */
const lineCount = ref(1)
/** 光标所在行 */
const caretLine = ref(1)
/** 光标所在列 */
const caretColumn = ref(1)
/** 文本域纵向滚动位置 */
const scrollTop = ref(0)
/** 可视高度，用于计算需要渲染的行号范围 */
const viewportHeight = ref(320)
/** 是否正在拖拽文件 */
const dragging = ref(false)

/** 文本体积文案 */
const sizeText = computed(() => formatSize(props.modelValue.length))

/** 行号栏宽度：按行数位数动态计算 */
const gutterWidth = computed(() => Math.max(2, String(lineCount.value).length) * 8 + 18)

/** 只渲染可视范围内的行号，避免大文件产生海量 DOM */
const visibleLines = computed<number[]>(() => {
  const start = Math.max(1, Math.floor(scrollTop.value / LINE_HEIGHT) + 1 - 2)
  const end = Math.min(lineCount.value, Math.ceil((scrollTop.value + viewportHeight.value) / LINE_HEIGHT) + 2)
  const list: number[] = []
  for (let i = start; i <= end; i++) {
    list.push(i)
  }
  return list
})

/** 行数统计定时器，输入过程防抖，避免逐字符扫描超大文本 */
let countTimer: number | undefined

/**
 * 重新统计行数（防抖执行）。
 */
function scheduleCount(): void {
  window.clearTimeout(countTimer)
  countTimer = window.setTimeout(() => {
    lineCount.value = countLines(props.modelValue)
  }, 150)
}

/**
 * 文本输入事件：向上抛出新值并异步刷新行数。
 */
function onInput(): void {
  const value = areaRef.value?.value ?? ''
  emit('update:modelValue', value)
  scheduleCount()
  updateCaret()
}

/**
 * 同步滚动位置到行号栏。
 */
function onScroll(): void {
  scrollTop.value = areaRef.value?.scrollTop ?? 0
}

/**
 * 更新光标所在行列号。
 */
function updateCaret(): void {
  const area = areaRef.value
  if (!area) {
    return
  }
  const { line, column } = positionToLineColumn(props.modelValue, area.selectionStart)
  caretLine.value = line
  caretColumn.value = column
}

/**
 * 处理文件拖放：仅接收第一个文件并向上抛出。
 *
 * @param event 拖放事件
 */
function onDrop(event: DragEvent): void {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    emit('file', file)
  }
}

/** 尺寸监听句柄 */
let observer: ResizeObserver | null = null

onMounted(() => {
  lineCount.value = countLines(props.modelValue)
  if (bodyRef.value) {
    viewportHeight.value = bodyRef.value.clientHeight
    observer = new ResizeObserver((entries) => {
      viewportHeight.value = entries[0]?.contentRect.height ?? viewportHeight.value
    })
    observer.observe(bodyRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.clearTimeout(countTimer)
})

// 外部改动内容（如格式化、载入文件）时同步行数与滚动位置
watch(
  () => props.modelValue,
  () => {
    scheduleCount()
  },
)
</script>

<style scoped>
.json-code-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-blank);
}

.json-code-pane.is-dragging {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8) inset;
}

.pane-body {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.code-gutter {
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border-right: 1px solid var(--el-border-color-lighter);
  user-select: none;
}

.gutter-inner {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  will-change: transform;
}

.line-no {
  position: absolute;
  right: 8px;
  height: 20px;
  line-height: 20px;
  font-size: 12px;
  font-family: Consolas, 'Courier New', monospace;
  color: var(--el-text-color-placeholder);
}

.line-no.is-caret {
  color: var(--el-text-color-primary);
}

.line-no.is-error {
  color: var(--el-color-danger);
  font-weight: 700;
}

.code-area {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 20px;
  font-family: Consolas, 'Courier New', monospace;
  color: var(--el-text-color-primary);
  background: transparent;
  white-space: pre;
  overflow: auto;
  tab-size: 2;
}

.code-area::placeholder {
  color: var(--el-text-color-placeholder);
}

.pane-foot {
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

.foot-tip {
  color: var(--el-color-primary);
}
</style>
