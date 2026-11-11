/**
 * Excalidraw（React 组件）与 Vue 应用的桥接层。
 *
 * 设计要点：
 * - Excalidraw 是 React 组件，本项目是 Vue 3 应用；通过 createRoot 把 React 子树
 *   挂载到 Vue 模板提供的容器 div 内，props 更新时重新 render（受控重渲）。
 * - 所有依赖（react / react-dom / @excalidraw/excalidraw）走动态 import，
 *   由 Vite 分包（manualChunks.whiteboard），只有真正打开白板时才加载；
 * - 模块缓存为单例：多次打开白板复用同一份模块，卸载只 unmount React 根节点；
 * - 运行时资源（字体 / 语言包）通过 window.EXCALIDRAW_ASSET_PATH 指向本地
 *   public/excalidraw-assets（由 scripts/copy-whiteboard-assets.cjs 复制），
 *   避免桌面离线环境回退到 unpkg CDN 导致字体 / 中文界面加载失败。
 */
import type { ComponentType } from 'react'

/** Excalidraw 组件 props 的白鸭子类型（只声明本应用用到的字段） */
export interface ExcalidrawProps {
  initialData?: {
    elements?: readonly unknown[]
    appState?: Record<string, unknown>
  }
  theme?: 'light' | 'dark'
  langCode?: string
  viewModeEnabled?: boolean
  gridModeEnabled?: boolean
  onChange?: (elements: readonly unknown[], appState: Record<string, unknown>, files: unknown) => void
  /** 实例就绪回调（透传给 Excalidraw 的 excalidrawAPI prop） */
  excalidrawAPI?: (api: ExcalidrawApiLike) => void
}

/** Excalidraw 实例 API 的鸭子类型（本应用用到的能力） */
export interface ExcalidrawApiLike {
  getAppState(): Record<string, unknown> & { zoom?: { value?: number } }
  scrollToContent(target: unknown, opts?: Record<string, unknown>): void
}

/** 动态加载的 Excalidraw 模块鸭子类型（本应用用到的导出） */
export interface ExcalidrawModule {
  Excalidraw: ComponentType<Record<string, unknown>>
  exportToBlob: (opts: Record<string, unknown>) => Promise<Blob>
  exportToSvg: (opts: Record<string, unknown>) => Promise<SVGSVGElement>
  serializeAsJSON: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: unknown,
    type: 'local' | 'publication',
  ) => string
  restore: (data: unknown, localAppState?: unknown, localElements?: unknown) => unknown
}

let modulePromise: Promise<ExcalidrawModule> | null = null
/** 模块加载后设置的本地资源路径（只设一次） */
let assetPathInitialized = false
/** 缓存的 React 渲染原语（ESM 命名空间不可扩展，不能挂在模块对象上） */
let hFn: ((type: unknown, props?: Record<string, unknown>, ...children: unknown[]) => unknown) | null = null
let createRootFn: ((container: HTMLElement) => { render(node: unknown): void; unmount(): void }) | null = null

/**
 * 判断值是否为合法的 React 组件。
 * Excalidraw 组件经 React.memo() 包装后是对象（{ $$typeof, type, compare }）而非函数，
 * 不能用 typeof === 'function' 判断。
 */
function isReactComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).$$typeof === 'symbol'
  )
}

/**
 * 惰性加载 Excalidraw 模块（含 React 运行时与样式），结果缓存。
 * 首次调用时设置 window.EXCALIDRAW_ASSET_PATH 指向本地资源目录。
 */
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      if (!assetPathInitialized) {
        assetPathInitialized = true
        // BASE_URL：dev 为 '/'，打包后为 './'，保证 file:// 下相对路径可用
        ;(window as unknown as Record<string, unknown>).EXCALIDRAW_ASSET_PATH =
          `${import.meta.env.BASE_URL}excalidraw-assets/`
      }
      const [reactMod, reactDomMod, exMod, cssMod] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('@excalidraw/excalidraw'),
        import('@excalidraw/excalidraw/index.css'),
      ])
      void cssMod
      const mod = exMod as unknown as ExcalidrawModule
      if (!isReactComponent(mod.Excalidraw)) {
        throw new Error('Excalidraw 组件加载失败')
      }
      // React 渲染原语缓存到模块级变量（ESM 命名空间对象不可扩展，禁止挂属性）
      hFn = reactMod.createElement as typeof hFn
      createRootFn = reactDomMod.createRoot as typeof createRootFn
      return mod
    })().catch((err) => {
      // 失败时清空缓存，允许下次重试
      modulePromise = null
      throw err
    })
  }
  return modulePromise
}

/** 已挂载的 Excalidraw 实例句柄 */
export interface ExcalidrawHandle {
  /** 更新 props（如主题切换），内部重新 render React 元素 */
  update(props: ExcalidrawProps): void
  /** 卸载 React 子树并清空容器 */
  unmount(): void
}

/**
 * 在指定容器内挂载 Excalidraw 画布。
 * @param container 容器元素（需有确定尺寸）
 * @param props 初始 props
 */
export async function mountExcalidraw(
  container: HTMLElement,
  props: ExcalidrawProps,
): Promise<ExcalidrawHandle> {
  const mod = await loadExcalidraw()
  if (!hFn || !createRootFn) {
    throw new Error('React 渲染原语未就绪')
  }
  const h = hFn as (
    type: ComponentType<Record<string, unknown>> | string,
    props?: Record<string, unknown>,
    ...children: unknown[]
  ) => unknown
  const createRoot = createRootFn

  const root = createRoot(container)
  root.render(h(mod.Excalidraw, { ...props }))

  return {
    update(next: ExcalidrawProps) {
      root.render(h(mod.Excalidraw, { ...next }))
    },
    unmount() {
      // unmount 可能触发同步重排，放进微任务避免阻塞 Vue 卸载流程
      queueMicrotask(() => {
        try {
          root.unmount()
        } catch {
          /* 重复卸载忽略 */
        }
        container.innerHTML = ''
      })
    },
  }
}
