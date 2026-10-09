<template>
  <el-tooltip :content="`工具集 (${SHORTCUT_TIP})`" placement="bottom">
    <el-button :icon="ToolsIcon" :type="visible ? 'primary' : ''" @click="toggle" />
  </el-tooltip>

  <el-drawer
    v-model="visible"
    :size="drawerSize"
    direction="rtl"
    :close-on-click-modal="true"
    class="tools-drawer"
  >
    <template #header>
      <div class="drawer-head">
        <span class="drawer-title">工具集</span>
        <el-button text size="small" :icon="FullScreen" @click="fullscreen = !fullscreen">
          {{ fullscreen ? '退出全屏' : '全屏' }}
        </el-button>
      </div>
    </template>
    <ToolPanel />
  </el-drawer>
</template>

<script setup lang="ts">
import { FullScreen, Tools as ToolsIcon } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ToolPanel from './ToolPanel.vue'
import { useToolPanel } from './useToolPanel'

/** 唤起快捷键的展示文案 */
const SHORTCUT_TIP = 'Ctrl+Alt+T'
/** 抽屉默认宽度 */
const DRAWER_DEFAULT_SIZE = '68%'

const { visible, open, close, toggle } = useToolPanel()

/** 抽屉是否全屏展示 */
const fullscreen = ref(false)

/** 抽屉宽度 */
const drawerSize = computed(() => (fullscreen.value ? '100%' : DRAWER_DEFAULT_SIZE))

/**
 * 判断是否命中工具集快捷键（Ctrl+Alt+T / Cmd+Alt+T）。
 *
 * @param event 键盘事件
 * @returns 命中返回 true
 */
function matchShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 't'
}

/**
 * 全局快捷键监听：命中时切换面板，并阻止默认行为。
 *
 * @param event 键盘事件
 */
function handleKeydown(event: KeyboardEvent): void {
  if (!matchShortcut(event)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (visible.value) {
    close()
  } else {
    open()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped>
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.drawer-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
