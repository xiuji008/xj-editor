<template>
  <div class="cfg-panel">
    <el-form label-width="120px" label-position="right">
      <el-form-item label="默认视图模式">
        <el-radio-group :model-value="viewMode" @update:model-value="onViewModeChange">
          <el-radio-button v-for="opt in viewOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
        <div class="form-tip">打开文档时的默认分栏方式，工具栏上的视图切换可随时临时改变。</div>
      </el-form-item>

      <el-form-item label="代码高亮主题">
        <el-select
          :model-value="codeTheme"
          placeholder="代码主题"
          style="width: 260px"
          @update:model-value="onCodeThemeChange"
        >
          <el-option
            v-for="t in CODE_THEMES"
            :key="t.name"
            :label="t.label"
            :value="t.name"
          />
        </el-select>
        <div class="form-tip">用于 Markdown 预览中代码块与图表配色，导出 HTML 时同步使用该主题。</div>
      </el-form-item>
    </el-form>

    <!-- 主题预览 -->
    <div class="theme-preview">
      <div class="theme-preview-title">预览</div>
      <pre class="theme-preview-code" :style="previewStyle"><code>function hello() {
  // 当前主题下的代码配色
  const msg = 'Hello Markdown'
  return msg
}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CODE_THEMES, DEFAULT_CODE_THEME } from '../../utils/markdown'

/** 视图模式：编辑 / 分屏 / 预览 */
type ViewMode = 'edit' | 'split' | 'preview'

const props = withDefaults(defineProps<{
  /** 当前默认视图模式 */
  viewMode: ViewMode
  /** 当前代码高亮主题名 */
  codeTheme?: string
}>(), {
  codeTheme: DEFAULT_CODE_THEME,
})

const emit = defineEmits<{
  (e: 'update:viewMode', value: ViewMode): void
  (e: 'update:codeTheme', value: string): void
}>()

/** 视图模式选项（与工具栏视图切换一致） */
const viewOptions: { label: string; value: ViewMode }[] = [
  { label: '编辑', value: 'edit' },
  { label: '分屏', value: 'split' },
  { label: '预览', value: 'preview' },
]

/** 当前主题的变量集合，用于渲染预览块 */
const previewStyle = computed(() => {
  const theme = CODE_THEMES.find((t) => t.name === props.codeTheme) || CODE_THEMES[0]
  return theme?.vars || {}
})

/** 视图模式变更（el-radio-group 回传值收窄为视图模式） */
const onViewModeChange = (value: string | number | boolean) =>
  emit('update:viewMode', value as ViewMode)
const onCodeThemeChange = (value: string) => emit('update:codeTheme', value)
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
  width: 100%;
}

.theme-preview {
  margin-top: 8px;
}

.theme-preview-title {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-bottom: 6px;
}

.theme-preview-code {
  margin: 0;
  padding: 12px 14px;
  border-radius: 6px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
}
</style>
