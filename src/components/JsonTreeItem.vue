<template>
  <div class="jti" :class="{ 'is-root': root }">
    <!-- 节点行 -->
    <div
      class="jti-row"
      :class="{ 'is-container': isContainer, 'is-editing': isEditing }"
      :style="{ paddingLeft: indent + 'px' }"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <!-- 展开 / 收起箭头 -->
      <span v-if="isContainer" class="jti-caret" :title="isExpanded ? '折叠' : '展开'" @click="toggle">
        <el-icon :size="13"><ArrowDown v-if="isExpanded" /><ArrowRight v-else /></el-icon>
      </span>
      <span v-else class="jti-caret placeholder" />

      <!-- 键名（对象属性可编辑，数组下标固定） -->
      <template v-if="!root">
        <input
          v-if="isEditingKey"
          ref="keyInputRef"
          v-model="keyDraft"
          class="jti-input jti-key-input"
          spellcheck="false"
          @click.stop
          @keydown.enter="commitKey"
          @keydown.esc="cancelEdit"
          @blur="commitKey"
        />
        <span
          v-else
          class="jti-key"
          :class="{ editable: labelKind === 'key' }"
          :title="labelKind === 'key' ? '双击编辑键名' : ''"
          @dblclick="labelKind === 'key' && startEditKey()"
          >{{ label }}</span
        >
        <span class="jti-colon">:</span>
      </template>

      <!-- 值区域 -->
      <template v-if="isContainer">
        <span class="jti-brace">{{ isExpanded ? (isArray ? '[' : '{') : isArray ? '[ … ]' : '{ … }' }}</span>
        <span v-if="!isExpanded" class="jti-badge">{{ containerCount }} 项</span>
        <span v-if="isExpanded" class="jti-brace">{{ isArray ? ']' : '}' }}</span>
      </template>
      <template v-else>
        <!-- 布尔值：内联选择，始终可编辑 -->
        <el-select
          v-if="typeName === 'boolean'"
          :model-value="Boolean(value)"
          size="small"
          class="jti-bool-select"
          @change="(v: any) => setValue(v)"
        >
          <el-option :value="true" label="true" />
          <el-option :value="false" label="false" />
        </el-select>
        <!-- 空值 / 字符串 / 数字：双击进入编辑 -->
        <input
          v-else-if="isEditingValue"
          ref="valueInputRef"
          v-model="valueDraft"
          class="jti-input jti-value-input"
          spellcheck="false"
          :class="{ 'is-error': valueDraftError }"
          @click.stop
          @keydown.enter="commitValue(false)"
          @keydown.esc="cancelEdit"
          @blur="commitValue(true)"
        />
        <span
          v-else
          class="jti-value"
          :class="valueClass"
          :title="typeName === 'null' ? '点击修改类型' : '双击编辑'"
          @dblclick="typeName !== 'null' && startEditValue()"
          >{{ displayValue }}</span
        >
      </template>

      <!-- 类型切换 -->
      <el-dropdown
        trigger="click"
        class="jti-type-drop"
        @command="(t: string) => changeType(t)"
        @click.stop
      >
        <el-icon class="jti-type-btn" :title="'类型：' + typeLabel"><Switch /></el-icon>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="t in TYPE_OPTIONS" :key="t.type" :command="t.type">
              {{ t.label }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 行操作（hover 显示） -->
      <span v-if="hovered && !root" class="jti-actions" @click.stop>
        <el-tooltip content="删除" placement="top">
          <el-icon class="jti-act jti-act-del" title="删除" @click="removeSelf"><Delete /></el-icon>
        </el-tooltip>
        <template v-if="isArray && parentKind === 'array'">
          <el-tooltip content="上移" placement="top">
            <el-icon class="jti-act" title="上移" @click="move(-1)"><Top /></el-icon>
          </el-tooltip>
          <el-tooltip content="下移" placement="top">
            <el-icon class="jti-act" title="下移" @click="move(1)"><Bottom /></el-icon>
          </el-tooltip>
        </template>
      </span>
    </div>

    <!-- 子节点 -->
    <template v-if="isContainer && isExpanded">
      <template v-if="isArray">
        <JsonTreeItem
          v-for="(child, idx) in value"
          :key="`${path}[${idx}]`"
          :value="child"
          :path="`${path}[${idx}]`"
          :depth="depth + 1"
          :label="String(idx)"
          label-kind="index"
          :parent="value"
          parent-kind="array"
          :prop-key="idx"
          :expanded="expanded"
          :editing="editing"
          @update-editing="onChildEditing"
          @change="emitChange"
        />
      </template>
      <template v-else>
        <JsonTreeItem
          v-for="(child, childKey) in value"
          :key="`${path}[${JSON.stringify(childKey)}]`"
          :value="child"
          :path="`${path}[${JSON.stringify(childKey)}]`"
          :depth="depth + 1"
          :label="String(childKey)"
          label-kind="key"
          :parent="value"
          parent-kind="object"
          :prop-key="childKey"
          :expanded="expanded"
          :editing="editing"
          @update-editing="onChildEditing"
          @change="emitChange"
        />
      </template>
      <!-- 添加属性 / 元素 -->
      <div
        class="jti-add"
        :style="{ paddingLeft: (indent + 26) + 'px' }"
        @click="addChild"
      >
        <el-icon :size="12"><Plus /></el-icon>
        <span>添加{{ isArray ? '元素' : '属性' }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * JSON 树形编辑节点（递归组件）。
 *
 * 以「所见即所得」的方式展示并编辑 JSON：对象 / 数组可展开折叠，
 * 键名与字符串 / 数字值可双击内联编辑，布尔值直接下拉切换，
 * 支持添加 / 删除 / 上移 / 下移与类型切换，所有操作即时序列化回源码。
 *
 * @module components/JsonTreeItem
 */
import { computed, ref, watch, nextTick } from 'vue'
import { ArrowDown, ArrowRight, Plus, Delete, Top, Bottom, Switch } from '@element-plus/icons-vue'

/** 可切换的 JSON 值类型 */
const TYPE_OPTIONS = [
  { type: 'string', label: '字符串' },
  { type: 'number', label: '数字' },
  { type: 'boolean', label: '布尔' },
  { type: 'null', label: '空值' },
  { type: 'object', label: '对象' },
  { type: 'array', label: '数组' },
] as const

interface EditingState {
  path: string
  field: 'key' | 'value'
}

const props = withDefaults(
  defineProps<{
    /** 当前节点值（容器为 reactive 对象 / 数组，可直接修改） */
    value: any
    /** 节点唯一路径（如 $["a"][0]），用于展开记忆与编辑定位 */
    path: string
    /** 嵌套深度（决定缩进） */
    depth: number
    /** 是否为根节点 */
    root?: boolean
    /** 显示标签：对象键名或数组下标 */
    label?: string
    /** 标签类型：key=对象键（可编辑），index=数组下标（固定） */
    labelKind?: 'key' | 'index'
    /** 父容器（reactive），根节点为 null */
    parent?: any
    /** 父容器类型 */
    parentKind?: 'object' | 'array'
    /** 当前节点在父容器中的键名 / 下标 */
    propKey?: string | number
    /** 展开路径集合（reactive Set，共享状态，直接增删） */
    expanded: Set<string>
    /** 当前正在编辑的节点（由父组件统一维护，保证同时只有一个输入框） */
    editing: EditingState | null
  }>(),
  {
    root: false,
    label: '',
    labelKind: 'key',
    parent: null,
    parentKind: 'object',
    propKey: '',
    editing: null,
  },
)

const emit = defineEmits<{
  /** 通知父组件更新全局编辑状态 */
  (e: 'update-editing', state: EditingState | null): void
  /** 树中数据发生变更，请求父组件序列化回源码 */
  (e: 'change'): void
  /** 根节点值被整体替换 */
  (e: 'update-root', value: any): void
}>()

/* ========== 类型与展示 ========== */

const isContainer = computed(() => typeof props.value === 'object' && props.value !== null)
const isArray = computed(() => Array.isArray(props.value))
const typeName = computed(() => {
  if (props.value === null) return 'null'
  if (Array.isArray(props.value)) return 'array'
  if (typeof props.value === 'object') return 'object'
  return typeof props.value // string | number | boolean
})

const typeLabel = computed(() => TYPE_OPTIONS.find((t) => t.type === typeName.value)?.label || typeName.value)

const containerCount = computed(() => {
  if (!isContainer.value) return 0
  if (isArray.value) return props.value.length
  return Object.keys(props.value).length
})

const indent = computed(() => Math.min(props.depth * 16, 192))

/** 当前节点是否处于展开状态（作用于容器节点） */
const isExpanded = computed(() => props.expanded.has(props.path))

const displayValue = computed(() => {
  const v = props.value
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${v}"`
  return String(v)
})

const valueClass = computed(() => `jti-val-${typeName.value}`)

/** 数组子节点（上移 / 下移用） */
const parentIsArray = computed(() => props.parentKind === 'array' && Array.isArray(props.parent))

/* ========== 展开 / 折叠 ========== */

function toggle() {
  if (!isContainer.value) return
  if (props.expanded.has(props.path)) props.expanded.delete(props.path)
  else props.expanded.add(props.path)
}

/* ========== 编辑状态（全局唯一，由父组件维护） ========== */

const isEditingKey = computed(() => !props.root && props.editing?.path === props.path && props.editing.field === 'key')
const isEditingValue = computed(() => !isContainer.value && props.editing?.path === props.path && props.editing.field === 'value')
const isEditing = computed(() => isEditingKey.value || isEditingValue.value)

const hovered = ref(false)
const keyInputRef = ref<HTMLInputElement>()
const valueInputRef = ref<HTMLInputElement>()
const keyDraft = ref('')
const valueDraft = ref('')
const valueDraftError = ref(false)

function startEditKey() {
  if (props.root) return
  keyDraft.value = String(props.label)
  emit('update-editing', { path: props.path, field: 'key' })
}

function startEditValue() {
  if (isContainer.value || typeName.value === 'null') return
  valueDraft.value = String(props.value)
  valueDraftError.value = false
  emit('update-editing', { path: props.path, field: 'value' })
}

// 进入编辑状态时自动聚焦输入框（含添加属性/元素后的新节点）
watch(
  () => props.editing,
  (state) => {
    if (!state || state.path !== props.path) return
    nextTick(() => {
      if (state.field === 'key') keyInputRef.value?.select()
      else valueInputRef.value?.select()
    })
  },
)

function cancelEdit() {
  emit('update-editing', null)
}

function onChildEditing(state: EditingState | null) {
  emit('update-editing', state)
}

/* ========== 值 / 键 / 结构修改 ========== */

/** 替换当前节点的值（根节点走 update-root，其余直接改父容器） */
function setValue(newValue: any) {
  if (props.root) {
    emit('update-root', newValue)
  } else if (props.parent) {
    props.parent[props.propKey as any] = newValue
  }
  emitChange()
}

/** 提交值编辑（字符串 / 数字，数字做合法性校验；失焦时非法则放弃修改并关闭） */
function commitValue(fromBlur = false) {
  const draft = valueDraft.value
  if (typeName.value === 'number') {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      if (!fromBlur) {
        valueDraftError.value = true
        return
      }
      emit('update-editing', null)
      return
    }
    setValue(n)
  } else {
    setValue(draft)
  }
  emit('update-editing', null)
}

/** 提交键名编辑：删除旧键并写入新键 */
function commitKey() {
  const newKey = keyDraft.value.trim()
  if (props.root || !props.parent) return
  if (newKey && newKey !== String(props.propKey)) {
    const oldKey = String(props.propKey)
    const val = props.parent[oldKey]
    delete props.parent[oldKey]
    props.parent[newKey] = val
    emitChange()
  }
  emit('update-editing', null)
}

/** 删除当前节点 */
function removeSelf() {
  if (props.root || !props.parent) return
  if (parentIsArray.value) {
    props.parent.splice(Number(props.propKey), 1)
  } else {
    delete props.parent[String(props.propKey)]
  }
  emit('update-editing', null)
  emitChange()
}

/** 数组元素上移 / 下移 */
function move(dir: -1 | 1) {
  if (!parentIsArray.value) return
  const arr = props.parent as unknown[]
  const i = Number(props.propKey)
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  const tmp = arr[i]
  arr[i] = arr[j]
  arr[j] = tmp
  emit('update-editing', null)
  emitChange()
}

/** 添加属性 / 元素，并立即进入新节点的编辑状态 */
function addChild() {
  if (!isContainer.value) return
  let newPath = ''
  if (isArray.value) {
    props.value.push('')
    newPath = `${props.path}[${props.value.length - 1}]`
    emit('update-editing', { path: newPath, field: 'value' })
  } else {
    const base = 'key'
    let n = 1
    let name = `${base}${n}`
    while (name in props.value) {
      n++
      name = `${base}${n}`
    }
    props.value[name] = ''
    newPath = `${props.path}[${JSON.stringify(name)}]`
    emit('update-editing', { path: newPath, field: 'key' })
  }
  emitChange()
}

/** 切换值类型（字符串 / 数字 / 布尔 / 空值 / 对象 / 数组） */
function changeType(type: string) {
  const v = props.value
  let next: any
  switch (type) {
    case 'string':
      next = typeof v === 'string' ? v : JSON.stringify(v)
      break
    case 'number': {
      const n = Number(v)
      next = Number.isFinite(n) ? n : 0
      break
    }
    case 'boolean':
      next = typeof v === 'boolean' ? v : v != null
      break
    case 'null':
      next = null
      break
    case 'object':
      next = typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
      break
    case 'array':
      next = Array.isArray(v) ? v : []
      break
    default:
      return
  }
  emit('update-editing', null)
  setValue(next)
}

function emitChange() {
  emit('change')
}
</script>

<style scoped>
.jti {
  font-family: 'Consolas', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}

/* ========== 节点行 ========== */
.jti-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px 1px 0;
  border-radius: 4px;
  min-height: 24px;
  white-space: nowrap;
  transition: background-color 0.12s;
}

.jti-row:hover {
  background: var(--el-fill-color-light);
}

.jti-row.is-editing {
  background: var(--color-primary-light-9);
}

.jti-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-color-secondary);
  cursor: pointer;
  border-radius: 3px;
}

.jti-caret:hover {
  background: var(--el-fill-color);
  color: var(--color-primary);
}

.jti-caret.placeholder {
  cursor: default;
}

/* ========== 键名 / 冒号 ========== */
.jti-key {
  color: #0b6bcb;
  font-weight: 500;
}

.jti-key.editable {
  cursor: text;
}

.jti-key.editable:hover {
  text-decoration: underline dotted;
}

.jti-colon {
  color: var(--text-color-secondary);
  margin-right: 2px;
}

/* ========== 容器（对象 / 数组） ========== */
.jti-brace {
  color: var(--text-color-primary);
}

.jti-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  height: 18px;
  border-radius: 9px;
  background: var(--el-fill-color);
  color: var(--text-color-secondary);
  font-size: 11px;
}

/* ========== 基本值 ========== */
.jti-value {
  cursor: text;
  border-bottom: 1px dashed transparent;
}

.jti-value:hover {
  border-bottom-color: var(--border-color-light);
}

.jti-val-string {
  color: #1a7f37;
}

.jti-val-number {
  color: #d97706;
}

.jti-val-boolean {
  color: #7c3aed;
}

.jti-val-null {
  color: var(--text-color-placeholder);
  font-style: italic;
}

/* 布尔值内联下拉：紧凑样式 */
.jti-bool-select {
  width: 92px;
}

.jti-bool-select :deep(.el-select__wrapper) {
  min-height: 22px;
  padding: 0 8px;
  box-shadow: none;
  border: 1px solid var(--border-color-lighter);
  border-radius: 4px;
}

.jti-bool-select :deep(.el-select__wrapper:hover) {
  border-color: var(--color-primary);
}

.jti-bool-select :deep(.el-select__selected-item) {
  font-family: 'Consolas', 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #7c3aed;
}

/* ========== 内联编辑输入框 ========== */
.jti-input {
  width: 160px;
  max-width: 320px;
  min-width: 80px;
  padding: 1px 6px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color-primary);
  background: #fff;
}

.jti-key-input {
  color: #0b6bcb;
  font-weight: 500;
}

.jti-value-input.is-error {
  border-color: #f56c6c;
  background: var(--el-color-danger-light-9);
}

/* ========== 类型切换 ========== */
.jti-type-drop {
  display: inline-flex;
}

.jti-type-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 12px;
  color: var(--text-color-placeholder);
  cursor: pointer;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.12s, background-color 0.12s, color 0.12s;
}

.jti-row:hover .jti-type-btn,
.jti-type-btn:hover {
  opacity: 1;
}

.jti-type-btn:hover {
  background: var(--el-fill-color);
  color: var(--color-primary);
}

/* ========== 行操作 ========== */
.jti-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}

.jti-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 13px;
  color: var(--text-color-secondary);
  cursor: pointer;
  border-radius: 3px;
}

.jti-act:hover {
  background: var(--el-fill-color);
  color: var(--color-primary);
}

.jti-act-del:hover {
  background: var(--el-color-danger-light-9);
  color: #f56c6c;
}

/* ========== 添加属性 / 元素 ========== */
.jti-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 2px 0 4px;
  border: 1px dashed var(--border-color);
  border-radius: 4px;
  color: var(--text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background-color 0.12s;
}

.jti-add:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background: var(--color-primary-light-9);
}

/* ========== 根节点 ========== */
.jti.is-root > .jti-row {
  padding-left: 8px;
  font-weight: 600;
}
</style>
