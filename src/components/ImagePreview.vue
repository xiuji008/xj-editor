<template>
  <div class="image-preview-container">
    <!-- 工具栏 -->
    <div class="image-toolbar">
      <el-button-group>
        <el-button size="small" @click="zoomOut" title="缩小">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <el-button size="small" @click="zoomReset">{{ Math.round(scale * 100) }}%</el-button>
        <el-button size="small" @click="zoomIn" title="放大">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
      </el-button-group>
      <el-button size="small" @click="rotate += 90" title="顺时针旋转">
        <el-icon><RefreshRight /></el-icon>旋转
      </el-button>
      <el-button size="small" @click="toggleFit">
        {{ fit ? '原始尺寸' : '适应窗口' }}
      </el-button>
    </div>

    <!-- 图片舞台 -->
    <div class="image-stage" ref="stageRef" @wheel.prevent="onWheel">
      <img
        v-if="fileUrl"
        :src="fileUrl"
        class="preview-img"
        :class="{ 'fit-mode': fit }"
        :style="{ transform: `scale(${scale}) rotate(${rotate}deg)` }"
        @load="onLoad"
        @error="onError"
        draggable="false"
        alt="图片预览"
      />
      <div v-if="loadError" class="image-error">
        <el-icon :size="48" color="#f56c6c"><WarningFilled /></el-icon>
        <p>图片加载失败</p>
        <p class="image-error-hint">{{ loadErrorMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ZoomIn, ZoomOut, RefreshRight, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 图片访问 URL */
  fileUrl: string
  /** 文件格式（扩展名，用于错误提示等） */
  fileFormat?: string
}>()

const scale = ref(1)
const rotate = ref(0)
const fit = ref(true)
const loadError = ref(false)
const loadErrorMessage = ref('')
const stageRef = ref<HTMLElement>()

const zoomIn = () => {
  scale.value = Math.min(scale.value * 1.2, 10)
}

const zoomOut = () => {
  scale.value = Math.max(scale.value / 1.2, 0.1)
}

const zoomReset = () => {
  scale.value = 1
  rotate.value = 0
}

const toggleFit = () => {
  fit.value = !fit.value
  scale.value = 1
}

/** 滚轮缩放 */
const onWheel = (e: WheelEvent) => {
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

const onLoad = () => {
  loadError.value = false
}

const onError = () => {
  loadError.value = true
  loadErrorMessage.value = props.fileUrl || ''
}
</script>

<style scoped>
.image-preview-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-color-page, #f5f7fa);
}

.image-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-color-white, #fff);
  border-bottom: 1px solid var(--border-color-lighter, #ebeef5);
  flex-shrink: 0;
}

.image-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 24px;
}

.preview-img {
  max-width: none;
  max-height: none;
  transition: transform 0.12s ease;
  user-select: none;
  -webkit-user-drag: none;
}

.preview-img.fit-mode {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #909399;
}

.image-error-hint {
  font-size: 12px;
  max-width: 480px;
  word-break: break-all;
  text-align: center;
}
</style>
