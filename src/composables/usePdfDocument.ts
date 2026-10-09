/**
 * PDF 文档加载（pdf.js）
 *
 * 说明：
 * - worker 以源码字符串内联后转 Blob URL，避免 Electron 以 file:// 加载本地脚本时
 *   因 CORS 限制无法创建 Worker 的问题；
 * - PDF 数据通过 mdlocal:// 协议读取（主进程已注册且开启 supportFetchAPI），
 *   一次性载入 ArrayBuffer 后交给 pdf.js，避免自定义协议不支持 Range 请求导致的流式失败；
 * - cMaps / 标准字体指向 public/pdfjs 下的资源（由 scripts/copy-pdf-assets.cjs 生成），
 *   缺失时仅影响未嵌入字体的特殊 PDF，会在控制台告警但不阻塞渲染。
 *
 * @module composables/usePdfDocument
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import { toMdLocalUrl } from '../utils/fileUtils'

/** pdf.js 资源目录（相对 index.html，由复制脚本生成） */
const CMAP_URL = './pdfjs/cmaps/'
const STANDARD_FONT_URL = './pdfjs/standard_fonts/'

/** 页面尺寸（PDF 单位 pt，scale = 1 时的视口大小） */
export interface PdfPageSize {
  /** 宽度（pt） */
  w: number
  /** 高度（pt） */
  h: number
}

/** 加载完成的文档句柄（仅暴露组件需要的成员，避免外部依赖 pdf.js 内部类型） */
export interface PdfDocumentHandle {
  /** 总页数 */
  numPages: number
  /** 按页码获取页面对象 */
  getPage: (pageNumber: number) => Promise<any>
  /** 销毁文档，释放 worker 资源 */
  destroy: () => Promise<void>
}

/** 加载结果 */
export interface PdfLoadResult {
  /** 文档句柄 */
  doc: PdfDocumentHandle
  /** 每页尺寸（pt，下标 0 对应第 1 页） */
  sizes: PdfPageSize[]
}

/** worker 是否已初始化 */
let workerReady = false

/**
 * 注入给 pdf.js worker 的兼容代码（纯 JS 字符串，worker 是独立全局环境）。
 * 内容与 installEsCompat 一致：补齐 Map / WeakMap 的 upsert 方法与 Uint8Array 的编码方法。
 */
const ES_COMPAT_SOURCE = `;(function () {
  if (typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = function (values) {
      var sum = 0, comp = 0
      for (var i = 0; i < values.length; i++) {
        var x = values[i]
        var t = sum + x
        if (Math.abs(sum) >= Math.abs(x)) comp += (sum - t) + x
        else comp += (x - t) + sum
        sum = t
      }
      return sum + comp
    }
  }
  if (typeof Map.prototype.getOrInsert !== 'function') {
    Map.prototype.getOrInsert = function (key, value) {
      if (!this.has(key)) this.set(key, value)
      return this.get(key)
    }
    Map.prototype.getOrInsertComputed = function (key, callbackfn) {
      if (!this.has(key)) this.set(key, callbackfn(key))
      return this.get(key)
    }
    WeakMap.prototype.getOrInsert = function (key, value) {
      if (!this.has(key)) this.set(key, value)
      return this.get(key)
    }
    WeakMap.prototype.getOrInsertComputed = function (key, callbackfn) {
      if (!this.has(key)) this.set(key, callbackfn(key))
      return this.get(key)
    }
  }
  var proto = Uint8Array.prototype
  if (typeof proto.toHex !== 'function') {
    proto.toHex = function () {
      var out = ''
      for (var i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, '0')
      return out
    }
  }
  if (typeof proto.toBase64 !== 'function') {
    proto.toBase64 = function () {
      var bin = ''
      for (var i = 0; i < this.length; i++) bin += String.fromCharCode(this[i])
      return btoa(bin)
    }
  }
})();`

/**
 * ES2025 兼容层：Electron 33 的 Chromium 130 尚未实现以下 pdf.js v6 依赖的新方法：
 * - Map / WeakMap 的 getOrInsert / getOrInsertComputed（upsert 提案，渲染缓存大量使用）；
 * - Uint8Array.prototype.toHex / toBase64（文档指纹与注释图片 data URL）；
 * - Math.sumPrecise（精确求和，用于字体度量累加）。
 * 前两类缺失会直接抛错导致文档打不开或渲染中断，这里给出最小实现；
 * Math.sumPrecise 用 Neumaier 补偿求和近似，精度满足排版计算需求。
 */
function installEsCompat(): void {
  if (typeof (Math as any).sumPrecise !== 'function') {
    ;(Math as any).sumPrecise = function (values: number[]): number {
      let sum = 0
      let comp = 0
      for (const x of values) {
        const t = sum + x
        if (Math.abs(sum) >= Math.abs(x)) comp += sum - t + x
        else comp += x - t + sum
        sum = t
      }
      return sum + comp
    }
  }
  const mapProto = Map.prototype as any
  const weakMapProto = WeakMap.prototype as any
  if (typeof mapProto.getOrInsert !== 'function') {
    mapProto.getOrInsert = function (key: any, value: any) {
      if (!this.has(key)) this.set(key, value)
      return this.get(key)
    }
    mapProto.getOrInsertComputed = function (key: any, callbackfn: (key: any) => any) {
      if (!this.has(key)) this.set(key, callbackfn(key))
      return this.get(key)
    }
    weakMapProto.getOrInsert = function (key: any, value: any) {
      if (!this.has(key)) this.set(key, value)
      return this.get(key)
    }
    weakMapProto.getOrInsertComputed = function (key: any, callbackfn: (key: any) => any) {
      if (!this.has(key)) this.set(key, callbackfn(key))
      return this.get(key)
    }
  }
  const proto = Uint8Array.prototype as any
  if (typeof proto.toHex !== 'function') {
    proto.toHex = function (this: Uint8Array): string {
      let out = ''
      for (const byte of this) out += byte.toString(16).padStart(2, '0')
      return out
    }
  }
  if (typeof proto.toBase64 !== 'function') {
    proto.toBase64 = function (this: Uint8Array): string {
      let bin = ''
      for (const byte of this) bin += String.fromCharCode(byte)
      return btoa(bin)
    }
  }
}

// 模块加载即安装，保证任何 pdf.js 调用点之前生效
installEsCompat()

/** 初始化 pdf.js worker（内联源码 → Blob URL） */
function ensureWorker(): void {
  if (workerReady) return
  installEsCompat()
  // worker 是独立的全局环境，polyfill 需要一并注入（文档指纹 / 渲染缓存在 worker 内计算）
  const blob = new Blob([ES_COMPAT_SOURCE, '\n', workerCode], { type: 'text/javascript' })
  GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
  workerReady = true
}

/**
 * 同步读取所有页面尺寸，用于一次性计算整体布局（滚动高度与页偏移）。
 * @param doc pdf.js 文档对象
 * @returns 每页尺寸数组
 */
async function readPageSizes(doc: any): Promise<PdfPageSize[]> {
  const sizes: PdfPageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    sizes.push({ w: viewport.width, h: viewport.height })
  }
  return sizes
}

/**
 * 加载本地 PDF 文件。
 * @param filePath PDF 绝对路径
 * @returns 文档句柄与页面尺寸
 * @throws 打开失败 / 需要密码时抛出带 message 的错误
 */
export async function loadPdfDocument(filePath: string): Promise<PdfLoadResult> {
  ensureWorker()
  const url = toMdLocalUrl(filePath)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`无法读取文件（HTTP ${response.status}）`)
  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) throw new Error('文件为空')

  const task = getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    useSystemFonts: true,
    disableAutoFetch: true,
  })

  let doc: any
  try {
    doc = await task.promise
  } catch (err: any) {
    const name = String(err?.name || '')
    const message = String(err?.message || '')
    if (name === 'PasswordException' || /password/i.test(message)) {
      throw new Error('该 PDF 已加密，请先解密后再阅读')
    }
    if (name === 'InvalidPDFException' || /invalid/i.test(message)) {
      throw new Error('不是有效的 PDF 文件')
    }
    throw new Error(`PDF 打开失败：${message || '未知错误'}`)
  }

  const sizes = await readPageSizes(doc)
  return { doc: doc as PdfDocumentHandle, sizes }
}

/**
 * 销毁文档并释放 worker 资源。
 * @param doc 文档句柄，可为空
 */
export async function destroyPdfDocument(doc: PdfDocumentHandle | null): Promise<void> {
  if (!doc) return
  try {
    await doc.destroy()
  } catch {
    /* 销毁失败无需处理，页面已不可达 */
  }
}
