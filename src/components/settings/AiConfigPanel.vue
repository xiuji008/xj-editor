<template>
  <div class="ai-config">
    <!-- 左侧：厂商列表 -->
    <div class="provider-list">
      <div class="list-header">
        <span>AI 厂商</span>
        <el-button text type="primary" size="small" @click="addCustom">+ 自定义</el-button>
      </div>
      <div class="list-body">
        <div
          v-for="(p, idx) in providers"
          :key="p.id"
          class="provider-item"
          :class="{
            active: p.id === selectedId,
            dragging: idx === dragIndex,
            'drag-over': idx === dragOverIndex,
          }"
          draggable="true"
          @click="selectProvider(p.id)"
          @dragstart="onDragStart(idx)"
          @dragover="onDragOver($event, idx)"
          @dragleave="onDragLeave(idx)"
          @drop.prevent="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <span class="provider-name">{{ p.name }}</span>
          <el-tag v-if="p.builtin" size="small" type="info" effect="plain">内置</el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">自定义</el-tag>
          <el-tooltip content="设为默认" placement="top" :disabled="isDefault(p.id)">
            <el-button
              text
              circle
              size="small"
              class="default-btn"
              :class="{ 'is-default': isDefault(p.id) }"
              @click.stop="toggleDefault(p.id)"
            >
              <el-icon><StarFilled v-if="isDefault(p.id)" /><Star v-else /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 右侧：配置表单 -->
    <div class="provider-form">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        内置常用 AI 厂商，可修改接口地址、模型与 API Key；也支持添加自定义厂商（OpenAI 兼容 / Anthropic / Gemini）。拖动左侧列表可调整顺序，点击星标设为默认厂商。
      </el-alert>
      <el-form label-width="90px" label-position="right">
        <el-form-item label="厂商名称">
          <el-input v-model="form.name" :disabled="isBuiltin" placeholder="如：OpenAI" />
        </el-form-item>
        <el-form-item label="协议格式">
          <el-select v-model="form.format" :disabled="isBuiltin" style="width: 100%">
            <el-option label="OpenAI 兼容" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="Google Gemini" value="gemini" />
          </el-select>
        </el-form-item>
        <el-form-item label="接口地址">
          <el-input v-model="form.baseUrl" placeholder="如：https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            autocomplete="off"
            placeholder="用于请求鉴权，Ollama 等本地模型可不填"
          />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="form.model" placeholder="如：gpt-4o-mini" />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input />
        </el-form-item>
      </el-form>

      <div class="form-actions">
        <el-button :loading="testing" @click="handleTest">测试连接</el-button>
        <el-button v-if="!isBuiltin" type="danger" plain @click="removeCustom">删除该厂商</el-button>
        <span v-if="testResult" class="test-result" :class="testResult.type">
          {{ testResult.message }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { getAiConfig, saveAiConfig, aiTest } from '../../utils/ai'

const testing = ref(false)
const testResult = ref<{ type: 'success' | 'error'; message: string } | null>(null)
const providers = ref<AiProvider[]>([])
const selectedId = ref('')
/** 默认厂商 id（保存后写入 activeProviderId） */
const defaultId = ref('')
/** 拖拽状态 */
const dragIndex = ref(-1)
const dragOverIndex = ref(-1)

const form = reactive<AiProvider>({
  id: '',
  name: '',
  format: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
})

/** 载入时的配置快照，用于判断是否存在未保存的修改 */
let snapshot = ''

const isBuiltin = computed(() => {
  const p = providers.value.find((item) => item.id === selectedId.value)
  return !!p?.builtin
})

/** 当前编辑状态的快照（厂商列表 + 默认项 + 表单） */
function takeSnapshot(): string {
  return JSON.stringify({ providers: providers.value, defaultId: defaultId.value, form })
}

/** 载入当前配置（父级打开面板时调用） */
async function load() {
  testResult.value = null
  const cfg = await getAiConfig()
  if (cfg) {
    providers.value = cfg.providers || []
    defaultId.value = cfg.activeProviderId || providers.value[0]?.id || ''
    selectedId.value = defaultId.value
    applyForm(selectedId.value)
  }
  snapshot = takeSnapshot()
}

/** 是否存在未保存的修改 */
function isDirty(): boolean {
  return snapshot !== takeSnapshot()
}

/** 将某个厂商的配置填充到表单 */
function applyForm(id: string) {
  const p = providers.value.find((item) => item.id === id)
  if (!p) return
  Object.assign(form, {
    id: p.id,
    name: p.name,
    format: p.format || 'openai',
    baseUrl: p.baseUrl || '',
    apiKey: p.apiKey || '',
    model: p.model || '',
    temperature: p.temperature ?? 0.7,
  })
}

function selectProvider(id: string) {
  selectedId.value = id
  testResult.value = null
  applyForm(id)
}

/** 新增自定义厂商 */
function addCustom() {
  const id = `custom-${Date.now()}`
  providers.value.push({
    id,
    name: '自定义厂商',
    format: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    builtin: false,
    custom: true,
  })
  // 当前没有默认厂商时，将新厂商设为默认
  if (!defaultId.value) defaultId.value = id
  selectProvider(id)
}

/** 删除自定义厂商 */
function removeCustom() {
  const idx = providers.value.findIndex((p) => p.id === selectedId.value)
  if (idx === -1) return
  providers.value.splice(idx, 1)
  testResult.value = null
  // 删除的是默认厂商时，默认转移到列表首个
  if (defaultId.value === selectedId.value) {
    defaultId.value = providers.value[0]?.id || ''
  }
  const next = providers.value[0]
  if (next) selectProvider(next.id)
  else selectedId.value = ''
}

/** 是否为默认厂商 */
function isDefault(id: string): boolean {
  return id === defaultId.value
}

/** 点击星标：设为 / 取消默认（取消后默认回到列表首个） */
function toggleDefault(id: string) {
  defaultId.value = isDefault(id) ? providers.value[0]?.id || '' : id
}

/** 拖拽排序：开始拖动 */
function onDragStart(index: number) {
  dragIndex.value = index
}

/** 拖拽排序：经过目标项，允许放置 */
function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  if (index !== dragIndex.value && index !== dragOverIndex.value) {
    dragOverIndex.value = index
  }
}

/** 拖拽排序：离开目标项 */
function onDragLeave(index: number) {
  if (dragOverIndex.value === index) dragOverIndex.value = -1
}

/** 拖拽排序：放置，将拖拽项移动到目标位置 */
function onDrop(index: number) {
  const from = dragIndex.value
  dragOverIndex.value = -1
  dragIndex.value = -1
  if (from < 0 || from === index) return
  const list = providers.value
  const [moved] = list.splice(from, 1)
  list.splice(index, 0, moved)
}

/** 拖拽排序：结束 */
function onDragEnd() {
  dragIndex.value = -1
  dragOverIndex.value = -1
}

/** 校验当前表单 */
function validateForm(): string {
  if (!form.name.trim()) return '请填写厂商名称'
  if (!form.baseUrl.trim()) return '请填写接口地址'
  if (!form.model.trim()) return '请填写模型名称'
  if (form.format === 'anthropic' && !form.apiKey.trim()) return 'Anthropic 需要填写 API Key'
  if (form.format === 'gemini' && !form.apiKey.trim()) return 'Gemini 需要填写 API Key'
  return ''
}

/** 测试连接 */
async function handleTest() {
  const msg = validateForm()
  if (msg) {
    ElMessage.warning(msg)
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const res = await aiTest({ ...form })
    testResult.value = res.ok
      ? { type: 'success', message: `连接成功（${res.elapsed}ms）：${res.reply || 'OK'}` }
      : { type: 'error', message: res.error || '连接失败' }
  } catch (err: any) {
    testResult.value = { type: 'error', message: err?.message || '连接失败' }
  } finally {
    testing.value = false
  }
}

/**
 * 保存配置。
 * @returns {Promise<boolean>} 保存成功返回 true，校验失败或写入失败返回 false
 */
async function save(): Promise<boolean> {
  const msg = validateForm()
  if (msg) {
    ElMessage.warning(msg)
    return false
  }
  // 将表单内容写回当前厂商
  const idx = providers.value.findIndex((p) => p.id === selectedId.value)
  if (idx >= 0) {
    providers.value[idx] = { ...providers.value[idx], ...form, apiKey: form.apiKey.trim() }
  }
  const res = await saveAiConfig({ activeProviderId: defaultId.value, providers: providers.value })
  if (res.ok) {
    snapshot = takeSnapshot()
    return true
  }
  ElMessage.error(res.error || '保存失败')
  return false
}

onMounted(load)

defineExpose({ load, save, isDirty })
</script>

<style scoped>
.ai-config {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 360px;
}

.provider-list {
  width: 190px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
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

.provider-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 5px;
  cursor: grab;
  font-size: 13px;
  transition: background 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 0 1.5px transparent;
}

.provider-item:hover {
  background: var(--el-fill-color-light);
}

.provider-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.provider-item.dragging {
  opacity: 0.45;
}

/* 拖拽经过目标项时显示顶部插入指示线 */
.provider-item.drag-over {
  box-shadow: 0 -2px 0 0 var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.provider-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-btn {
  flex-shrink: 0;
}

.default-btn.is-default .el-icon {
  color: #f7ba2a;
}

.provider-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
}

.test-result {
  font-size: 12px;
  line-height: 1.4;
}

.test-result.success {
  color: var(--el-color-success);
}

.test-result.error {
  color: var(--el-color-danger);
}
</style>
