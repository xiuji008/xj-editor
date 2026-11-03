<template>
  <div class="cfg-panel">
    <el-form label-width="120px" label-position="right">
      <el-form-item label="应用主题">
        <el-radio-group :model-value="theme" @update:model-value="onThemeChange">
          <el-radio-button v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
        <div class="form-tip">
          界面配色：选择「跟随系统」时随操作系统的浅色 / 深色模式自动切换；工具栏上的太阳 / 月亮按钮可随时快速切换。
        </div>
      </el-form-item>

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

      <el-form-item label="正文字体">
        <el-select
          :model-value="previewFont"
          filterable
          placeholder="正文字体"
          style="width: 260px"
          @update:model-value="onPreviewFontChange"
        >
          <el-option-group v-for="g in FONT_GROUPS" :key="g.label" :label="g.label">
            <el-option v-for="f in g.options" :key="f.value" :label="f.label" :value="f.value">
              <span class="font-option" :style="{ fontFamily: f.stack }">{{ f.label }}</span>
            </el-option>
          </el-option-group>
        </el-select>
        <div class="form-tip">
          Markdown 预览区正文所用的字体，切换后立即生效；代码块为保证对齐始终使用等宽字体。
        </div>
      </el-form-item>

      <el-form-item label="编辑器字体">
        <el-select
          :model-value="sourceFont"
          filterable
          placeholder="编辑器字体"
          style="width: 260px"
          @update:model-value="onSourceFontChange"
        >
          <el-option-group v-for="g in FONT_GROUPS" :key="g.label" :label="g.label">
            <el-option v-for="f in g.options" :key="f.value" :label="f.label" :value="f.value">
              <span class="font-option" :style="{ fontFamily: f.stack }">{{ f.label }}</span>
            </el-option>
          </el-option-group>
        </el-select>
        <div class="form-tip">
          源码编辑区（Markdown / HTML / JSON / 纯文本）所用的字体，等宽字体更利于表格 Markdown 对齐。
        </div>
      </el-form-item>
    </el-form>

    <!-- 字体样例：按当前选择实时渲染 -->
    <div class="theme-preview">
      <div class="theme-preview-title">字体样例</div>
      <div class="font-sample">
        <div class="font-sample-row">
          <span class="font-sample-label">正文</span>
          <span class="font-sample-text" :style="{ fontFamily: previewStack }">
            正文中英示例 ABCabc 123 —— 落霞与孤鹜齐飞
          </span>
        </div>
        <div class="font-sample-row">
          <span class="font-sample-label">编辑器</span>
          <span class="font-sample-text" :style="{ fontFamily: sourceStack }">
            # 源码示例 ABCabc 123 | 列1 | 列2 |
          </span>
        </div>
      </div>
    </div>

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
import {
  DEFAULT_PREVIEW_FONT,
  DEFAULT_SOURCE_FONT,
  FONT_GROUPS,
  getFontStack,
} from '../../utils/fonts'
import { useTheme, type AppTheme } from '../../composables/useTheme'

/** 视图模式：编辑 / 分屏 / 预览 */
type ViewMode = 'edit' | 'split' | 'preview'

const props = withDefaults(defineProps<{
  /** 当前默认视图模式 */
  viewMode: ViewMode
  /** 当前代码高亮主题名 */
  codeTheme?: string
  /** 当前预览区正文字体 */
  previewFont?: string
  /** 当前源码编辑区字体 */
  sourceFont?: string
}>(), {
  codeTheme: DEFAULT_CODE_THEME,
  previewFont: DEFAULT_PREVIEW_FONT,
  sourceFont: DEFAULT_SOURCE_FONT,
})

const emit = defineEmits<{
  (e: 'update:viewMode', value: ViewMode): void
  (e: 'update:codeTheme', value: string): void
  (e: 'update:previewFont', value: string): void
  (e: 'update:sourceFont', value: string): void
}>()

/** 视图模式选项（与工具栏视图切换一致） */
const viewOptions: { label: string; value: ViewMode }[] = [
  { label: '编辑', value: 'edit' },
  { label: '分屏', value: 'split' },
  { label: '预览', value: 'preview' },
]

/** 应用主题（浅色 / 深色 / 跟随系统，直接写入全局主题状态，立即生效） */
const { theme, setTheme } = useTheme()
const themeOptions: { label: string; value: AppTheme }[] = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'auto' },
]

/** 当前主题的变量集合，用于渲染预览块 */
const previewStyle = computed(() => {
  const theme = CODE_THEMES.find((t) => t.name === props.codeTheme) || CODE_THEMES[0]
  return theme?.vars || {}
})

/** 当前选择的字体对应的 font-family 字体栈（供样例实时渲染） */
const previewStack = computed(() => getFontStack(props.previewFont, DEFAULT_PREVIEW_FONT))
const sourceStack = computed(() => getFontStack(props.sourceFont, DEFAULT_SOURCE_FONT))

/** 视图模式变更（el-radio-group 回传值收窄为视图模式） */
const onViewModeChange = (value: string | number | boolean) =>
  emit('update:viewMode', value as ViewMode)
/** 应用主题变更（el-radio-group 回传值收窄为主题） */
const onThemeChange = (value: string | number | boolean) => setTheme(value as AppTheme)
const onCodeThemeChange = (value: string) => emit('update:codeTheme', value)
const onPreviewFontChange = (value: string) => emit('update:previewFont', value)
const onSourceFontChange = (value: string) => emit('update:sourceFont', value)
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

/* ========== 字体样例 ========== */
.font-sample {
  padding: 10px 14px;
  border: 1px solid var(--border-color-lighter);
  border-radius: 6px;
  background: var(--bg-color-white);
}

.font-sample-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.font-sample-row + .font-sample-row {
  margin-top: 8px;
}

.font-sample-label {
  flex-shrink: 0;
  width: 52px;
  font-size: 12px;
  color: var(--text-color-secondary);
}

.font-sample-text {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下拉项以字体本身渲染，便于直接对照字形 */
.font-option {
  display: block;
  font-size: 14px;
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
