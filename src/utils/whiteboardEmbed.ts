/**
 * Markdown 预览中的 ```whiteboard 内嵌白板挂载器。
 *
 * markdown.ts 的 enhanceRenderedDom 会把 ```whiteboard 代码块替换为
 * `.whiteboard-embed__canvas[data-wb-src|data-wb-json]` 占位元素；
 * 本模块在增强阶段把这些占位元素挂载为只读 Excalidraw 画布：
 * - data-wb-src：白板文件路径（相对当前 md 所在目录或绝对路径），经 mdlocal:// fetch 读取；
 * - data-wb-json：内联 Excalidraw JSON（encodeURIComponent 编码）。
 *
 * 预览每次重新渲染都会替换整块 HTML，旧的 React 根随之失效；
 * 这里维护一个全局卸载注册表，在每次增强前统一 unmount，避免监听器/根节点堆积。
 */
import { toMdLocalUrl } from './fileUtils'
import { loadExcalidraw, mountExcalidraw } from '../components/whiteboard/excalidrawBridge'

/** 已挂载白板的卸载函数注册表（按渲染批次整体清空） */
const unmountFns: Array<() => void> = []

/** 卸载所有已挂载的内嵌白板（预览重新渲染前调用） */
export function unmountAllWhiteboardEmbeds(): void {
  while (unmountFns.length) {
    try {
      unmountFns.pop()?.()
    } catch {
      /* 忽略单个卸载失败 */
    }
  }
}

/** 读取场景数据：文件路径 / 内联 JSON → { elements, appState } */
async function loadScene(
  canvas: HTMLElement,
  cwd: string,
): Promise<{ elements?: readonly unknown[]; appState?: Record<string, unknown> } | null> {
  const src = decodeURIComponent(canvas.dataset.wbSrc || '')
  const inline = decodeURIComponent(canvas.dataset.wbJson || '')
  let raw = ''
  if (inline) {
    raw = inline
  } else if (src) {
    const target = resolveBoardPath(src, cwd)
    const res = await fetch(toMdLocalUrl(target))
    if (!res.ok) throw new Error(`读取白板文件失败（HTTP ${res.status}）：${target}`)
    raw = await res.text()
  }
  raw = raw.trim()
  if (!raw) return null
  const mod = await loadExcalidraw()
  const parsed = JSON.parse(raw)
  return mod.restore(parsed, null, null) as {
    elements?: readonly unknown[]
    appState?: Record<string, unknown>
  }
}

/** 解析白板路径：绝对路径原样，相对路径基于 md 所在目录 */
function resolveBoardPath(src: string, cwd: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('/')) return src
  const base = (cwd || '').replace(/\\/g, '/').replace(/\/$/, '')
  if (!base) return src
  return `${base}/${src.replace(/^\.\//, '')}`
}

/** 当前是否深色主题（预览内嵌白板跟随应用主题） */
function currentIsDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * 挂载容器内所有未处理的白板占位元素。
 * @param container 预览根元素
 * @param cwd 当前 md 文件所在目录（解析相对路径用）
 */
export async function mountWhiteboardEmbeds(container: HTMLElement, cwd?: string): Promise<void> {
  const canvases = container.querySelectorAll<HTMLElement>(
    '.whiteboard-embed__canvas[data-wb-src], .whiteboard-embed__canvas[data-wb-json]',
  )
  if (canvases.length === 0) return
  for (const canvas of Array.from(canvases)) {
    if (canvas.dataset.wbMounted === '1' || !canvas.isConnected) continue
    canvas.dataset.wbMounted = '1'
    try {
      const scene = await loadScene(canvas, cwd || '')
      const elements = scene?.elements ?? []
      const handle = await mountExcalidraw(canvas, {
        initialData: scene ? { elements, appState: scene.appState } : undefined,
        theme: currentIsDark() ? 'dark' : 'light',
        langCode: 'zh-CN',
        viewModeEnabled: true,
        // 内容自动缩放适配展示框（zoom-to-fit）
        excalidrawAPI: (api) => {
          // 实例句柄挂到占位元素上（调试 / 后续主题刷新用）
          ;(canvas as unknown as Record<string, unknown>).__wbApi = api
          if (elements.length === 0) return
          // 首帧渲染完成后再适配，过早调用视口尺寸未就绪
          window.setTimeout(() => {
            try {
              api.scrollToContent(elements, {
                fitToViewport: true,
                viewportZoomFactor: 0.85,
                animate: false,
              })
            } catch {
              /* 适配失败保持默认缩放 */
            }
          }, 150)
        },
      })
      unmountFns.push(handle.unmount)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      canvas.innerHTML = `<div style="color:#f56c6c;padding:12px;font-size:13px">白板渲染失败: ${msg}</div>`
    }
  }
}
