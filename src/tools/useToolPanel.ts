import { computed, ref } from 'vue'

/**
 * 工具面板是否为展开状态（全局单例，顶部按钮与面板共享）。
 */
const visible = ref(false)

/**
 * 当前打开的工具 id，为空表示停留在工具列表页。
 */
const activeToolId = ref('')

/**
 * 工具面板状态与操作。采用模块级单例，保证任意位置调用都作用于同一个面板。
 */
export function useToolPanel() {
  /**
   * 打开面板（停留在列表页或上次打开的工具）。
   */
  function open(initialToolId?: string): void {
    if (initialToolId) {
      activeToolId.value = initialToolId
    }
    visible.value = true
  }

  /**
   * 关闭面板。
   */
  function close(): void {
    visible.value = false
  }

  /**
   * 切换面板展开状态。
   */
  function toggle(): void {
    visible.value = !visible.value
  }

  /**
   * 打开指定工具的工作区。
   *
   * @param id 工具唯一标识
   */
  function openTool(id: string): void {
    activeToolId.value = id
    visible.value = true
  }

  /**
   * 返回工具列表页（关闭工具时自动持久化无需处理）。
   */
  function backToList(): void {
    activeToolId.value = ''
  }

  /** 是否有工具处于工作区 */
  const hasActiveTool = computed(() => !!activeToolId.value)

  return { visible, activeToolId, hasActiveTool, open, close, toggle, openTool, backToList }
}
