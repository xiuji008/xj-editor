<template>
  <div class="cfg-panel">
    <el-form :model="form" label-width="120px" label-position="right">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      >
        默认使用 PlantUML 官方在线服务渲染图表；填写私有化部署地址后，
        所有 PlantUML 图表将改由该服务渲染。
      </el-alert>
      <el-form-item label="服务地址">
        <el-input
          v-model="form.serverBaseUrl"
          :placeholder="DEFAULT_CONFIG.serverBaseUrl"
        />
        <div class="form-tip">
          填写「基础地址」即可，格式后缀（如 <code>/svg/</code>）会自动拼接。
          例如私有化部署：<code>http://localhost:8080/plantuml</code>
        </div>
      </el-form-item>
      <el-form-item label="">
        <el-button :loading="testing" @click="handleTest">测试连接</el-button>
        <span v-if="testResult" class="test-result" :class="testResult.type">
          {{ testResult.message }}
        </span>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
  getPlantUmlConfig,
  savePlantUmlConfig,
  DEFAULT_CONFIG,
  type PlantUmlConfig,
} from '../../utils/plantUmlConfig'
import { testPlantUmlConnection } from '../../utils/markdown'

const testing = ref(false)
const testResult = ref<{ type: 'success' | 'error'; message: string } | null>(null)

const form = reactive<PlantUmlConfig>({ ...DEFAULT_CONFIG })
/** 载入时的配置快照，用于判断是否存在未保存的修改 */
let snapshot = ''

/** 载入当前配置（父级打开面板时调用） */
function load() {
  Object.assign(form, getPlantUmlConfig())
  testResult.value = null
  snapshot = JSON.stringify(form)
}

/** 是否存在未保存的修改 */
function isDirty(): boolean {
  return snapshot !== JSON.stringify(form)
}

/** 保存配置 */
function save(): boolean {
  savePlantUmlConfig({ ...form })
  snapshot = JSON.stringify(form)
  return true
}

/** 测试私有化服务连通性 */
async function handleTest() {
  testing.value = true
  testResult.value = null
  try {
    const ok = await testPlantUmlConnection(form.serverBaseUrl)
    testResult.value = ok
      ? { type: 'success', message: '连接成功' }
      : { type: 'error', message: '连接失败，请检查服务地址' }
  } catch (err: any) {
    testResult.value = { type: 'error', message: err?.message || '连接失败' }
  } finally {
    testing.value = false
  }
}

onMounted(load)

defineExpose({ load, save, isDirty })
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.form-tip code {
  background: var(--bg-color-page);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
}

.test-result {
  margin-left: 12px;
  font-size: 13px;
}

.test-result.success {
  color: var(--el-color-success);
}

.test-result.error {
  color: var(--el-color-danger);
}
</style>
