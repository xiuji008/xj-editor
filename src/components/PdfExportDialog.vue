<template>
  <el-dialog
    :model-value="modelValue"
    title="导出 PDF"
    width="500px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="pdf-export">
      <div class="file-line">
        <el-icon><Document /></el-icon>
        <span class="name" :title="fileName">{{ fileName || '未命名文档' }}</span>
        <el-tag size="small" type="info" effect="plain">{{ kindLabel }}</el-tag>
      </div>

      <el-form label-width="86px" size="small" class="settings" @submit.prevent>
        <el-form-item label="纸张">
          <el-select v-model="form.paper" class="w-full">
            <el-option label="A4（210 × 297 mm）" value="A4" />
            <el-option label="A5（148 × 210 mm）" value="A5" />
            <el-option label="A3（297 × 420 mm）" value="A3" />
            <el-option label="Letter（216 × 279 mm）" value="Letter" />
            <el-option label="自定义尺寸" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.paper === 'custom'" label="宽 × 高">
          <div class="size-row">
            <el-input-number
              v-model="form.customWidthMm"
              :min="50"
              :max="1200"
              :step="5"
              controls-position="right"
            />
            <span class="unit">×</span>
            <el-input-number
              v-model="form.customHeightMm"
              :min="50"
              :max="1200"
              :step="5"
              controls-position="right"
            />
            <span class="unit">mm</span>
          </div>
        </el-form-item>

        <el-form-item label="方向">
          <el-radio-group v-model="form.landscape">
            <el-radio-button :value="false">纵向</el-radio-button>
            <el-radio-button :value="true">横向</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="页边距">
          <el-select v-model="form.marginMm" class="w-full">
            <el-option :value="8" label="窄（8 mm，内容更多）" />
            <el-option :value="14" label="普通（14 mm）" />
            <el-option :value="20" label="宽（20 mm）" />
            <el-option :value="25" label="很宽（25 mm）" />
          </el-select>
        </el-form-item>

        <el-form-item label="内容缩放">
          <el-select v-model="form.scale" class="w-full">
            <el-option v-for="s in scaleOptions" :key="s" :value="s" :label="`${Math.round(s * 100)}%`" />
          </el-select>
        </el-form-item>

        <el-form-item label="页码">
          <el-switch v-model="form.showPageNumber" />
          <span class="inline-tip">页脚显示「第 N 页 / 共 M 页」</span>
        </el-form-item>
      </el-form>

      <div class="preview-line">
        <span class="label">输出尺寸</span>
        <span class="value">{{ paperText }}</span>
      </div>

      <div class="tips">
        <p v-if="kindHint">{{ kindHint }}</p>
        <p v-if="dirtyHint" class="warn">{{ dirtyHint }}</p>
        <p>
          提示：PDF 阅读器按「适应宽度」显示时，A4 页面在大窗口里可能被放大到 200% 左右；
          若希望打开即接近实际大小，可改用 A5 或调小内容缩放。
        </p>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <el-button text size="small" @click="resetDefaults">恢复默认</el-button>
        <span class="spacer" />
        <el-button @click="close">取消</el-button>
        <el-button type="primary" @click="confirm">导出</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Document } from '@element-plus/icons-vue'
import {
  DEFAULT_PDF_PAGE,
  resolvePaperMm,
  type PdfPageSettings,
  type PrintableKind,
} from '../utils/printExport'

const props = defineProps<{
  /** 对话框显隐 */
  modelValue: boolean
  /** 源文件类型（null 表示不支持） */
  kind: PrintableKind | null
  /** 文件名（展示用） */
  fileName: string
  /** 文件是否有未保存修改 */
  dirty?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', page: PdfPageSettings): void
}>()

/** 版面设置记忆键（全局一份，下次打开沿用） */
const STORAGE_KEY = 'md-pdf-page-settings'

/** 可选缩放档位 */
const scaleOptions = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 2]

/** 表单（与 DEFAULT_PDF_PAGE 同构，避免缺字段） */
const form = reactive<PdfPageSettings>({ ...DEFAULT_PDF_PAGE })

/** 类型标签 */
const kindLabel = computed(() => {
  switch (props.kind) {
    case 'markdown':
      return 'Markdown'
    case 'html':
      return 'HTML'
    case 'json':
      return 'JSON'
    case 'text':
      return '纯文本'
    case 'image':
      return '图片'
    case 'docx':
      return 'Word'
    default:
      return '不支持'
  }
})

/** 类型相关的说明 */
const kindHint = computed(() => {
  switch (props.kind) {
    case 'docx':
      return 'Word 文档由 docx-preview 渲染，字体替换后分页位置可能与 Word 略有差异。'
    case 'html':
      return 'HTML 直接按源文件打印，外部样式与相对路径图片正常；页面固定高度（overflow:hidden）的内容可能被截断。'
    case 'image':
      return '图片按原比例缩放到页面内并居中，一图一页。'
    default:
      return ''
  }
})

/** 未保存修改提示 */
const dirtyHint = computed(() =>
  props.dirty && (props.kind === 'html' || props.kind === 'image')
    ? '当前文件有未保存修改，将导出磁盘上的版本，如需包含最新修改请先保存。'
    : '',
)

/** 输出尺寸文案（毫米） */
const paperText = computed(() => {
  const { w, h } = resolvePaperMm(form)
  return `${Math.round(w * 10) / 10} × ${Math.round(h * 10) / 10} mm（${form.landscape ? '横向' : '纵向'}）`
})

/** 打开时读取上次设置 */
function onOpen(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<PdfPageSettings>
      Object.assign(form, DEFAULT_PDF_PAGE, saved)
    }
  } catch {
    // 读取失败按默认值走
  }
}

/** 恢复默认设置 */
function resetDefaults(): void {
  Object.assign(form, DEFAULT_PDF_PAGE)
}

/** 关闭 */
function close(): void {
  emit('update:modelValue', false)
}

/** 确认导出：记住设置并上抛 */
function confirm(): void {
  const page: PdfPageSettings = { ...form }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(page))
  } catch {
    // 存储不可用不影响导出
  }
  emit('confirm', page)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.pdf-export {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  font-size: 13px;
}

.file-line .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.settings {
  margin-top: 4px;
}

.settings :deep(.el-form-item) {
  margin-bottom: 14px;
}

.w-full {
  width: 100%;
}

.size-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.size-row :deep(.el-input-number) {
  width: 108px;
}

.unit {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}

.inline-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.preview-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-regular, #606266);
}

.preview-line .label {
  color: var(--el-text-color-secondary, #909399);
}

.preview-line .value {
  font-variant-numeric: tabular-nums;
}

.tips {
  font-size: 12px;
  line-height: 1.65;
  color: var(--el-text-color-secondary, #909399);
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-lighter, #fafafa);
}

.tips p {
  margin: 0;
}

.tips p + p {
  margin-top: 4px;
}

.tips .warn {
  color: var(--el-color-warning, #e6a23c);
}

.footer {
  display: flex;
  align-items: center;
  width: 100%;
}

.footer .spacer {
  flex: 1;
}
</style>
