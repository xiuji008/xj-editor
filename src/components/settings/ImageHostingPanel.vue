<template>
  <div class="cfg-panel">
    <el-form :model="form" label-width="120px" label-position="right">
      <el-form-item label="图片模式">
        <el-radio-group v-model="form.type">
          <el-radio value="none">本地保存</el-radio>
          <el-radio value="picgo">PicGo</el-radio>
          <el-radio value="custom">自有图床</el-radio>
        </el-radio-group>
        <div class="form-tip" style="width: 100%">
          本地保存：图片自动复制到当前 Markdown 文件所在目录的 <code>images/</code> 文件夹，并插入相对路径。
        </div>
      </el-form-item>

      <!-- PicGo 配置 -->
      <template v-if="form.type === 'picgo'">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        >
          PicGo 需安装「picgo-server」插件并启动本地服务。
          插入 / 粘贴图片时将自动通过 PicGo 上传。
        </el-alert>
        <el-form-item label="PicGo 服务地址">
          <el-input
            v-model="form.picgoUrl"
            placeholder="http://127.0.0.1:36677"
          />
        </el-form-item>
      </template>

      <!-- 自有图床配置 -->
      <template v-if="form.type === 'custom'">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        >
          自有图床兼容 Chevereto API v1 规范。
          接口接收 multipart/form-data（字段名 source），认证通过 X-API-Key 请求头。
          响应为 JSON，默认从 image.url 路径提取图片地址。
        </el-alert>
        <el-form-item label="上传接口 URL">
          <el-input
            v-model="form.customUrl"
            placeholder="http://localhost:9003/api/1/upload/upload"
          />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="form.customToken"
            placeholder="图床 API Key（作为 X-API-Key 请求头发送）"
          />
        </el-form-item>
        <el-form-item label="URL 响应路径">
          <el-input
            v-model="form.customUrlField"
            placeholder="image.url"
          />
          <div class="form-tip">
            从上传响应 JSON 中提取图片 URL 的路径，如
            <code>image.url</code>、<code>data.url</code>、<code>url</code>
          </div>
        </el-form-item>
      </template>

      <!-- 测试区域 -->
      <el-form-item v-if="form.type !== 'none'" label="">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleFileSelected"
        />
        <el-button @click="triggerFileSelect" :loading="testing">
          选择图片测试上传
        </el-button>
        <span v-if="testResult" class="test-result" :class="testResult.type">
          {{ testResult.message }}
        </span>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getImageHostingConfig,
  saveImageHostingConfig,
  uploadImage,
  DEFAULT_CONFIG,
  type ImageHostingConfig,
} from '../../utils/imageHosting'

const testing = ref(false)
const testResult = ref<{ type: 'success' | 'error'; message: string } | null>(null)
const fileInputRef = ref<HTMLInputElement>()

const form = reactive<ImageHostingConfig>({ ...DEFAULT_CONFIG })
/** 载入时的配置快照，用于判断是否存在未保存的修改 */
let snapshot = ''

/** 载入当前配置（父级打开面板时调用） */
function load() {
  Object.assign(form, getImageHostingConfig())
  testResult.value = null
  snapshot = JSON.stringify(form)
}

/** 是否存在未保存的修改 */
function isDirty(): boolean {
  return snapshot !== JSON.stringify(form)
}

/**
 * 保存配置。
 * @returns {boolean} 校验通过并保存成功返回 true，否则 false
 */
function save(): boolean {
  if (form.type === 'picgo' && !form.picgoUrl.trim()) {
    ElMessage.warning('请填写 PicGo 服务地址')
    return false
  }
  if (form.type === 'custom' && !form.customUrl.trim()) {
    ElMessage.warning('请填写上传接口 URL')
    return false
  }
  saveImageHostingConfig({ ...form })
  snapshot = JSON.stringify(form)
  return true
}

/** 触发文件选择对话框 */
const triggerFileSelect = () => {
  testResult.value = null
  fileInputRef.value?.click()
}

/**
 * 用户选择图片后的处理：保存配置并上传所选图片。
 * @param e 文件选择事件
 */
const handleFileSelected = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 清空 input 的值，以便同一文件可以再次选择
  input.value = ''

  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }

  testing.value = true
  testResult.value = null
  try {
    // 先保存配置（测试需要用到最新配置）
    saveImageHostingConfig({ ...form })
    snapshot = JSON.stringify(form)

    const result = await uploadImage(file)
    testResult.value = {
      type: 'success',
      message: `上传成功：${result.url}`,
    }
  } catch (err: any) {
    testResult.value = {
      type: 'error',
      message: err?.message || '上传失败',
    }
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
