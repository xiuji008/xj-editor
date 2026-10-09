<template>
  <div class="quick-ai-panel">
    <!-- 左侧：快捷 AI 生成类型列表 -->
    <div class="action-list">
      <div class="list-header">
        <span>生成类型</span>
        <el-button text type="primary" size="small" @click="addCustom">+ 自定义</el-button>
      </div>
      <div class="list-body">
        <div
          v-for="a in actions"
          :key="a.id"
          class="action-item"
          :class="{ active: a.id === selectedId }"
          @click="selectAction(a.id)"
        >
          <el-icon class="item-icon"><component :is="quickIcon(a.icon)" /></el-icon>
          <span class="item-name">{{ a.name }}</span>
          <el-tag v-if="a.builtin" size="small" type="info" effect="plain">内置</el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">自定义</el-tag>
          <el-tooltip :content="a.enabled === false ? '已停用（面板中不显示）' : '已启用'" placement="top">
            <el-switch v-model="a.enabled" size="small" @click.stop />
          </el-tooltip>
        </div>
      </div>
      <div class="list-footer">
        <el-button size="small" :disabled="!canMoveUp" @click="moveSelected(-1)">上移</el-button>
        <el-button size="small" :disabled="!canMoveDown" @click="moveSelected(1)">下移</el-button>
      </div>
    </div>

    <!-- 右侧：当前类型的提示词与行为配置 -->
    <div class="action-form" v-if="selected">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        内置类型的提示词可自由修改，其中 <b>{content}</b> 会在发送时替换为待处理内容。改坏了点「恢复默认」即可还原。
      </el-alert>

      <el-form label-width="100px" label-position="right">
        <el-form-item label="类型名称">
          <el-input v-model="selected.name" placeholder="如：润色" />
        </el-form-item>
        <el-form-item label="用途说明">
          <el-input v-model="selected.desc" placeholder="展示在列表与提示中的一句话说明" />
        </el-form-item>
        <el-form-item label="适用范围">
          <el-select v-model="selected.scope" style="width: 100%">
            <el-option v-for="o in QUICK_SCOPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果处理">
          <el-select v-model="selected.apply" style="width: 100%">
            <el-option v-for="o in QUICK_APPLY_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="selected.icon" placeholder="Element Plus 图标名，如 EditPen" style="width: 100%" />
        </el-form-item>
        <el-form-item label="提示词">
          <el-input
            v-model="selected.prompt"
            type="textarea"
            :rows="12"
            resize="vertical"
            placeholder="输入该类型的提示词模板，用 {content} 引用待处理内容"
          />
        </el-form-item>
      </el-form>

      <div class="form-tip" :class="{ warn: !hasPlaceholder }">
        {{ hasPlaceholder ? '提示词已包含 {content} 占位符，将插入到该位置。' : '提示词未包含 {content} 占位符，待处理内容会自动追加到提示词末尾。' }}
      </div>

      <div class="form-actions">
        <el-button @click="resetCurrent">恢复该类型默认</el-button>
        <el-button @click="resetAll">恢复全部默认</el-button>
        <el-button v-if="!selected.builtin" type="danger" plain @click="removeSelected">删除该类型</el-button>
      </div>
    </div>

    <div v-else class="action-form empty-form">
      <el-empty description="请选择一个生成类型" :image-size="80" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  QUICK_SCOPE_OPTIONS,
  QUICK_APPLY_OPTIONS,
  QUICK_PROMPT_PLACEHOLDER,
  createQuickAction,
  getQuickAiConfig,
  quickIcon,
  resetQuickAiActions,
  saveQuickAiConfig,
} from '../../utils/quickAi'

const actions = ref<QuickAiAction[]>([])
const selectedId = ref('')

/** 载入时的配置快照，用于判断是否存在未保存的修改 */
let snapshot = ''

const selected = computed(() => actions.value.find((a) => a.id === selectedId.value) || null)
const selectedIndex = computed(() => actions.value.findIndex((a) => a.id === selectedId.value))
const canMoveUp = computed(() => selectedIndex.value > 0)
const canMoveDown = computed(() => selectedIndex.value >= 0 && selectedIndex.value < actions.value.length - 1)

/** 提示词是否包含内容占位符 */
const hasPlaceholder = computed(() => (selected.value?.prompt || '').includes(QUICK_PROMPT_PLACEHOLDER))

/** 载入配置（父级打开面板时调用） */
async function load() {
  const cfg = await getQuickAiConfig()
  actions.value = cfg.actions || []
  if (!actions.value.some((a) => a.id === selectedId.value)) {
    selectedId.value = actions.value[0]?.id || ''
  }
  snapshot = JSON.stringify(actions.value)
}

/** 是否存在未保存的修改 */
function isDirty(): boolean {
  return snapshot !== JSON.stringify(actions.value)
}

/**
 * 保存配置。
 * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
 */
async function save(): Promise<boolean> {
  if (!actions.value.length) {
    ElMessage.warning('至少保留一个生成类型')
    return false
  }
  const empty = actions.value.find((a) => !a.name?.trim() || !a.prompt?.trim())
  if (empty) {
    ElMessage.warning(`「${empty.name || '未命名'}」的名称或提示词不能为空`)
    return false
  }
  const res = await saveQuickAiConfig(actions.value)
  if (res.ok) {
    snapshot = JSON.stringify(actions.value)
    return true
  }
  ElMessage.error(res.error || '保存失败')
  return false
}

function selectAction(id: string) {
  selectedId.value = id
}

/** 新增自定义类型 */
function addCustom() {
  const action = createQuickAction()
  actions.value.push(action)
  selectedId.value = action.id
}

/** 删除自定义类型（内置类型只能停用或恢复默认） */
function removeSelected() {
  const idx = selectedIndex.value
  if (idx < 0 || actions.value[idx].builtin) return
  actions.value.splice(idx, 1)
  selectedId.value = actions.value[Math.min(idx, actions.value.length - 1)]?.id || ''
}

/** 调整当前类型的顺序（决定在 AI 面板中的展示先后） */
function moveSelected(offset: number) {
  const idx = selectedIndex.value
  const target = idx + offset
  if (idx < 0 || target < 0 || target >= actions.value.length) return
  const [moved] = actions.value.splice(idx, 1)
  actions.value.splice(target, 0, moved)
}

/**
 * 恢复默认：用主进程返回的内置配置替换本地列表（只改内容，不落盘）
 * @param {object} res 主进程返回的默认配置
 */
function applyReset(res: { ok: boolean; config?: QuickAiConfig; error?: string }) {
  if (!res.ok || !res.config?.actions?.length) {
    ElMessage.error(res.error || '恢复默认失败')
    return
  }
  actions.value = res.config.actions
  if (!actions.value.some((a) => a.id === selectedId.value)) {
    selectedId.value = actions.value[0]?.id || ''
  }
}

/** 恢复当前类型的内置默认提示词 */
async function resetCurrent() {
  if (!selected.value) return
  applyReset(await resetQuickAiActions(selected.value.id))
  ElMessage.success('已恢复该类型的默认配置，点击保存后生效')
}

/** 恢复全部内置默认类型 */
async function resetAll() {
  applyReset(await resetQuickAiActions())
  ElMessage.success('已恢复全部默认配置，点击保存后生效')
}

defineExpose({ load, save, isDirty })
</script>

<style scoped>
.quick-ai-panel {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 380px;
}

.action-list {
  width: 210px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-color-secondary);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--bg-color-page);
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.action-item:hover {
  background: var(--el-fill-color-light);
}

.action-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.item-icon {
  flex-shrink: 0;
  font-size: 15px;
}

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-footer {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid var(--el-border-color);
}

.list-footer .el-button {
  flex: 1;
  margin-left: 0;
}

.action-form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.empty-form {
  align-items: center;
  justify-content: center;
}

.form-tip {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-secondary);
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
}

.form-tip.warn {
  color: var(--el-color-warning);
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.form-actions .el-button {
  margin-left: 0;
}
</style>
