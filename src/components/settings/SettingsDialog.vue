<template>
  <el-dialog
    v-model="visible"
    title="设置"
    width="900px"
    top="6vh"
    class="settings-dialog"
    :before-close="handleBeforeClose"
    @open="onOpen"
  >
    <div class="settings-body">
      <!-- 左侧：设置分类（常规桌面程序的设置导航） -->
      <nav class="settings-nav">
        <div
          v-for="item in categories"
          :key="item.key"
          class="settings-nav-item"
          :class="{ 'is-active': item.key === activeKey }"
          @click="selectCategory(item.key)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span class="nav-label">{{ item.label }}</span>
        </div>

        <div class="settings-nav-footer">
          <el-button text size="small" :icon="DataLine" @click="onOpenAiLog">
            AI 调用日志
          </el-button>
        </div>
      </nav>

      <!-- 右侧：当前分类的配置区 -->
      <section class="settings-content">
        <header class="settings-content-header">
          <h3 class="settings-title">{{ activeCategory?.label }}</h3>
          <p class="settings-desc">{{ activeCategory?.desc }}</p>
        </header>

        <div class="settings-content-body">
          <AppearancePanel
            v-if="activeKey === 'appearance'"
            ref="panelRef"
            :view-mode="viewMode"
            :code-theme="codeTheme"
            :preview-font="previewFont"
            :source-font="sourceFont"
            :editor-bg="editorBg"
            @update:view-mode="onViewModeChange"
            @update:code-theme="onCodeThemeChange"
            @update:preview-font="onPreviewFontChange"
            @update:source-font="onSourceFontChange"
            @update:editor-bg="onEditorBgChange"
          />
          <ImageHostingPanel v-else-if="activeKey === 'image'" ref="panelRef" />
          <PlantUmlPanel v-else-if="activeKey === 'plantuml'" ref="panelRef" />
          <AiConfigPanel v-else-if="activeKey === 'ai'" ref="panelRef" />
          <QuickAiPanel v-else-if="activeKey === 'quickai'" ref="panelRef" />
          <FileAssociationsPanel v-else-if="activeKey === 'assoc'" ref="panelRef" />
        </div>
      </section>
    </div>

    <template #footer>
      <el-button @click="handleCloseClick">关闭</el-button>
      <el-button v-if="activeCategory?.savable" type="primary" @click="handleSave">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Brush, Picture, Connection, MagicStick, EditPen, Link, DataLine } from '@element-plus/icons-vue'
import AppearancePanel from './AppearancePanel.vue'
import ImageHostingPanel from './ImageHostingPanel.vue'
import PlantUmlPanel from './PlantUmlPanel.vue'
import AiConfigPanel from './AiConfigPanel.vue'
import QuickAiPanel from './QuickAiPanel.vue'
import FileAssociationsPanel from './FileAssociationsPanel.vue'
import { DEFAULT_PREVIEW_FONT, DEFAULT_SOURCE_FONT } from '../../utils/fonts'
import { DEFAULT_EDITOR_BG } from '../../utils/editorBackground'

/** 视图模式：编辑 / 分屏 / 预览 */
type ViewMode = 'edit' | 'split' | 'preview'

/** 设置面板统一暴露的能力 */
type SettingsPanel = {
  /** 重新载入配置 */
  load?: () => void | Promise<void>
  /** 保存配置，返回是否成功（无保存动作的分类不提供） */
  save?: () => boolean | Promise<boolean>
  /** 是否存在未保存的修改 */
  isDirty?: () => boolean
}

interface SettingsCategory {
  key: string
  label: string
  desc: string
  icon: Component
  /** 是否需要「保存」按钮（即时生效的分类不需要） */
  savable: boolean
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** 默认视图模式 */
  viewMode: ViewMode
  /** 代码高亮主题 */
  codeTheme?: string
  /** 预览区正文字体 */
  previewFont?: string
  /** 源码编辑区字体 */
  sourceFont?: string
  /** Markdown 编辑区底色（内置浅色底色的 value） */
  editorBg?: string
}>(), {
  codeTheme: '',
  previewFont: DEFAULT_PREVIEW_FONT,
  sourceFont: DEFAULT_SOURCE_FONT,
  editorBg: DEFAULT_EDITOR_BG,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'update:viewMode', value: ViewMode): void
  (e: 'update:codeTheme', value: string): void
  (e: 'update:previewFont', value: string): void
  (e: 'update:sourceFont', value: string): void
  (e: 'update:editorBg', value: string): void
  (e: 'open-ai-log'): void
}>()

/** 转发外观面板的即时修改（无需点保存，立即生效） */
const onViewModeChange = (value: ViewMode) => emit('update:viewMode', value)
const onCodeThemeChange = (value: string) => emit('update:codeTheme', value)
const onPreviewFontChange = (value: string) => emit('update:previewFont', value)
const onSourceFontChange = (value: string) => emit('update:sourceFont', value)
const onEditorBgChange = (value: string) => emit('update:editorBg', value)

/** 分类导航：图片 / PlantUML / AI / 文件关联等原工具栏入口统一收在此处 */
const categories: SettingsCategory[] = [
  {
    key: 'appearance',
    label: '外观',
    desc: '应用主题（浅色 / 深色 / 跟随系统）、默认视图模式、Markdown 编辑区底色、显示字体与代码高亮主题。',
    icon: Brush,
    savable: false,
  },
  {
    key: 'image',
    label: '图片与图床',
    desc: '插入 / 粘贴图片时的存储方式：本地保存、PicGo 或自有图床。',
    icon: Picture,
    savable: true,
  },
  {
    key: 'plantuml',
    label: 'PlantUML',
    desc: 'PlantUML 图表渲染服务地址，默认使用官方在线服务。',
    icon: Connection,
    savable: true,
  },
  {
    key: 'ai',
    label: 'AI 服务',
    desc: 'AI 厂商的接口地址、模型、密钥与默认厂商，供润色 / 扩写 / 图表生成使用。',
    icon: MagicStick,
    savable: true,
  },
  {
    key: 'quickai',
    label: '快捷 AI',
    desc: '定制 AI 面板快捷类型的提示词、适用范围与结果处理方式，可新增自定义类型。',
    icon: EditPen,
    savable: true,
  },
  {
    key: 'assoc',
    label: '文件关联',
    desc: '注册后可在资源管理器中直接用本编辑器打开 Markdown 等文本文件。',
    icon: Link,
    savable: false,
  },
]

/** 记忆上次打开的分类，避免每次都从第一项开始找 */
const LAST_CATEGORY_KEY = 'md-settings-category'

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const activeKey = ref<string>(
  categories.some((c) => c.key === localStorage.getItem(LAST_CATEGORY_KEY))
    ? (localStorage.getItem(LAST_CATEGORY_KEY) as string)
    : 'appearance',
)
const panelRef = ref<SettingsPanel | null>(null)

const activeCategory = computed(() => categories.find((c) => c.key === activeKey.value))

watch(activeKey, (key) => {
  localStorage.setItem(LAST_CATEGORY_KEY, key)
})

/** 打开对话框时重载当前分类，避免展示上一次的过期配置 */
function onOpen() {
  void panelRef.value?.load?.()
}

/**
 * 切换分类前先处理未保存的修改。
 * @returns {Promise<boolean>} 允许切换返回 true，用户取消返回 false
 */
async function confirmDiscard(): Promise<boolean> {
  const panel = panelRef.value
  if (!panel?.isDirty?.() || !panel.save) return true
  try {
    await ElMessageBox.confirm('当前分类有未保存的修改，是否保存？', '提示', {
      type: 'warning',
      confirmButtonText: '保存',
      cancelButtonText: '放弃修改',
      distinguishCancelAndClose: true,
    })
  } catch (action) {
    // 关闭确认框（Esc / 右上角 X）视为取消切换，保留在当前分类
    return action !== 'close'
  }
  // 保存失败（如校验不通过）时放弃切换，避免丢失填写内容
  return (await panel.save()) !== false
}

/** 切换分类 */
async function selectCategory(key: string) {
  if (key === activeKey.value) return
  if (!(await confirmDiscard())) return
  activeKey.value = key
}

/** 保存当前分类 */
async function handleSave() {
  const panel = panelRef.value
  if (!panel?.save) return
  if ((await panel.save()) === false) return
  ElMessage.success('已保存')
}

/** 点击「关闭」按钮 */
async function handleCloseClick() {
  if (!(await confirmDiscard())) return
  visible.value = false
}

/** 对话框关闭前（右上角 X / Esc / 点击遮罩）拦截未保存的修改 */
const handleBeforeClose = (done: () => void) => {
  void (async () => {
    if (await confirmDiscard()) done()
  })()
}

/** 打开 AI 调用日志窗口（日志为独立窗口，避免挤占设置内容区） */
function onOpenAiLog() {
  emit('open-ai-log')
}
</script>

<style scoped>
.settings-body {
  display: flex;
  height: 440px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

/* ========== 左侧分类导航 ========== */
.settings-nav {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 8px;
  background: var(--bg-color-page);
  border-right: 1px solid var(--el-border-color-lighter);
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-color-regular);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s, color 0.15s;
}

.settings-nav-item:hover {
  background: var(--el-fill-color-light);
}

.settings-nav-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.nav-icon {
  font-size: 15px;
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-nav-footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

/* ========== 右侧配置区 ========== */
.settings-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-content-header {
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.settings-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.settings-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-secondary);
}

.settings-content-body {
  flex: 1;
  min-height: 0;
  padding: 16px 18px;
  overflow: auto;
}
</style>
