<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { COMMIT_TEMPLATE_VARS, getCommitSpec, resetCommitSpec, saveCommitSpec } from '../utils/commitSpec'
import AiConfigDialog from './AiConfigDialog.vue'

/**
 * Git 提交规范设置弹窗
 * 内置默认规范与 AI 提示词模板，支持页面编辑、切换规范预设（完整版 / 精简版）与恢复默认。
 */

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** 弹窗显隐 */
const visible = ref(props.modelValue)
/** 保存中 */
const saving = ref(false)
/** AI 配置弹窗显隐（未配置 AI 时可一键前往配置） */
const aiConfigVisible = ref(false)
/** 当前规范预设 */
const preset = ref<CommitSpecPreset>('full')
/** 提交规范正文 */
const spec = ref('')
/** AI 提示词模板 */
const promptTemplate = ref('')
/** 提交前是否校验格式 */
const validateBeforeCommit = ref(false)
/** 是否附带最近提交作风格参考 */
const includeRecentCommits = ref(true)
/** 当前编辑的页签 */
const activeTab = ref('spec')

watch(
  () => props.modelValue,
  async (val) => {
    visible.value = val
    if (!val) return
    activeTab.value = 'spec'
    const cfg = await getCommitSpec()
    if (!cfg) {
      ElMessage.error('读取提交规范失败')
      return
    }
    applyConfig(cfg)
  },
)

watch(visible, (val) => emit('update:modelValue', val))

/** 将配置填充到表单 */
function applyConfig(cfg: CommitSpecConfig) {
  preset.value = cfg.preset || 'full'
  spec.value = cfg.spec || ''
  promptTemplate.value = cfg.promptTemplate || ''
  validateBeforeCommit.value = cfg.validateBeforeCommit === true
  includeRecentCommits.value = cfg.includeRecentCommits !== false
}

/**
 * 切换规范预设：读取对应内置规范替换正文（不影响已编辑的提示词模板）
 * @param next 预设名
 */
async function switchPreset(next: CommitSpecPreset) {
  const res = await resetCommitSpec(next)
  if (!res.ok || !res.config) {
    ElMessage.error(res.error || '切换规范失败')
    return
  }
  preset.value = next
  spec.value = res.config.spec
  ElMessage.success(next === 'brief' ? '已切换为精简版规范' : '已切换为完整版规范')
}

/** 恢复内置提示词模板 */
async function resetPrompt() {
  const res = await resetCommitSpec(preset.value)
  if (!res.ok || !res.config) {
    ElMessage.error(res.error || '恢复默认提示词失败')
    return
  }
  promptTemplate.value = res.config.promptTemplate
  ElMessage.success('已恢复内置提示词模板')
}

/** 保存配置 */
async function handleSave() {
  if (!spec.value.trim()) {
    ElMessage.warning('提交规范不能为空')
    return
  }
  if (!promptTemplate.value.trim()) {
    ElMessage.warning('提示词模板不能为空')
    return
  }
  saving.value = true
  try {
    const res = await saveCommitSpec({
      preset: preset.value,
      spec: spec.value,
      promptTemplate: promptTemplate.value,
      validateBeforeCommit: validateBeforeCommit.value,
      includeRecentCommits: includeRecentCommits.value,
    })
    if (!res.ok) {
      ElMessage.error(res.error || '保存失败')
      return
    }
    ElMessage.success('已保存提交规范')
    visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="Git 提交规范设置" width="760px" top="5vh">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      规范与提示词内置于应用，可在此修改；修改后的内容会作为 AI 生成提交信息的依据。
    </el-alert>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="提交规范" name="spec">
        <div class="toolbar">
          <span class="toolbar-label">规范预设：</span>
          <el-button size="small" :type="preset === 'full' ? 'primary' : ''" @click="switchPreset('full')">
            完整规范
          </el-button>
          <el-button size="small" :type="preset === 'brief' ? 'primary' : ''" @click="switchPreset('brief')">
            精简版（省 token）
          </el-button>
        </div>
        <el-input v-model="spec" type="textarea" :rows="16" resize="vertical" placeholder="提交规范正文" />
      </el-tab-pane>

      <el-tab-pane label="AI 提示词" name="prompt">
        <div class="toolbar">
          <el-button size="small" @click="resetPrompt">恢复内置提示词</el-button>
          <span class="toolbar-tip">生成时把下列占位符替换为真实上下文</span>
        </div>
        <div class="var-list">
          <span v-for="v in COMMIT_TEMPLATE_VARS" :key="v.key" class="var-item" :title="v.desc">
            <code>{{ v.key }}</code> {{ v.desc }}
          </span>
        </div>
        <el-input
          v-model="promptTemplate"
          type="textarea"
          :rows="16"
          resize="vertical"
          placeholder="AI 生成提交信息的提示词模板"
        />
      </el-tab-pane>
    </el-tabs>

    <div class="switch-row">
      <el-switch v-model="validateBeforeCommit" />
      <span class="switch-text">提交前校验格式（不合规时提示，仍可继续提交）</span>
    </div>
    <div class="switch-row">
      <el-switch v-model="includeRecentCommits" />
      <span class="switch-text">生成时附带最近 5 条提交标题作为风格参考</span>
    </div>

    <template #footer>
      <el-button @click="aiConfigVisible = true">AI 配置…</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>

    <AiConfigDialog v-model="aiConfigVisible" />
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-label {
  font-size: 12px;
  color: var(--text-color-regular, #606266);
}

.toolbar-tip {
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}

.var-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}

.var-item code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--fill-color-light, #f5f7fa);
  color: var(--color-primary, #409eff);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.switch-text {
  font-size: 12px;
  color: var(--text-color-regular, #606266);
}
</style>
