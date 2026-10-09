/**
 * 文件 / 路径工具函数（渲染进程使用，无法依赖 Node 的 path 模块）。
 *
 * 提供：文件名 / 目录名 / 扩展名提取、路径拼接与解析、
 * 文件类型分类、mdlocal:// 本地协议 URL 构造、图片 base64 转换。
 *
 * @module utils/fileUtils
 */

// ==================== 路径工具 ====================

/** 将反斜杠统一为斜杠 */
export function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 提取文件名（含扩展名） */
export function basename(p: string): string {
  const parts = normalize(p).split('/')
  return parts[parts.length - 1] || ''
}

/** 提取扩展名（含点号，如 ".md"），无扩展名返回空串 */
export function extname(p: string): string {
  const base = basename(p)
  const idx = base.lastIndexOf('.')
  return idx > 0 ? base.slice(idx) : ''
}

/** 提取目录部分（保留 Windows 盘符） */
export function dirname(p: string): string {
  const norm = normalize(p)
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return norm.startsWith('/') ? '/' : '.'
  return norm.slice(0, idx)
}

/** 是否为绝对路径（Windows 盘符、UNC、/ 开头） */
export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith('/')
}

/**
 * 拼接 baseDir 与相对路径，处理 . 与 ..
 * @param baseDir 基准目录
 * @param target 相对或绝对路径
 */
export function resolvePath(baseDir: string, target: string): string {
  if (!target) return baseDir
  // 绝对路径直接返回
  if (/^[a-zA-Z]:[\\/]/.test(target)) return normalize(target)
  // / 开头的绝对路径（类 Unix），去掉前导斜杠
  if (target.startsWith('/') && !/^[a-zA-Z]:/.test(target)) {
    return normalize(target.replace(/^\/+/, ''))
  }
  // 相对路径：baseDir + target 并规范化
  const stack: string[] = []
  for (const seg of normalize(`${baseDir}/${target}`).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      stack.pop()
    } else {
      stack.push(seg)
    }
  }
  let result = stack.join('/')
  // 保留盘符形式 C:/xxx
  if (/^[a-zA-Z]:/.test(result) && !result.includes(':')) {
    result = `${result.charAt(0)}:/${result.slice(2)}`
  }
  return result
}

/** 拼接多个路径段 */
export function joinPath(...parts: string[]): string {
  const stack: string[] = []
  for (const p of parts) {
    for (const seg of normalize(p).split('/')) {
      if (seg === '' || seg === '.') continue
      stack.push(seg)
    }
  }
  let result = stack.join('/')
  if (/^[a-zA-Z]:$/.test(parts[0] || '')) {
    result = `${parts[0]}/${stack.slice(1).join('/')}`
  }
  if (/^[a-zA-Z]:\//.test(result) || /^[a-zA-Z]:[^/]/.test(result)) {
    // 确保盘符后跟斜杠
    result = result.replace(/^([a-zA-Z]:)([^/])/, '$1/$2')
  }
  return result
}

/**
 * 将本地文件路径转换为 mdlocal:// 协议 URL，供渲染进程加载本地文件。
 * 必须使用带明确 host（local）的形式：mdlocal://local/C:/my%20dir/a.png。
 * 若使用 mdlocal:///C:/...（host 为空），在 standard scheme 下 Chromium 网络层
 * 会把盘符 C: 规范化为 host 名，导致盘符丢失、文件 404、图片无法显示。
 */
export function toMdLocalUrl(filePath: string): string {
  const norm = normalize(filePath)
  return `mdlocal://local/${encodeURI(norm).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

/** 将 mdlocal://local/xxx URL 还原为本地文件路径；非 mdlocal URL 返回空串 */
export function fromMdLocalUrl(url: string): string {
  const m = /^mdlocal:\/\/local\/(.*)$/i.exec(url)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

// ==================== 文件类型分类 ====================

/** 文件类型 */
export type FileKind =
  | 'markdown'
  | 'html'
  | 'json'
  | 'text'
  | 'image'
  | 'pdf'
  | 'office'
  | 'archive'
  | 'other'

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd'])
const HTML_EXTS = new Set(['html', 'htm'])
const JSON_EXTS = new Set(['json'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
/** 压缩包扩展名：与 @open-file-viewer/core 的 archivePlugin 支持范围保持一致 */
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'])

/** 根据文件名 / 扩展名与二进制标记分类文件 */
export function classifyFile(filePath: string, isText: boolean): FileKind {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase()
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (HTML_EXTS.has(ext)) return 'html'
  if (JSON_EXTS.has(ext)) return 'json'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (OFFICE_EXTS.has(ext)) return 'office'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  if (isText) return 'text'
  return 'other'
}

/** 是否为纯文本扩展名（用于打开对话框筛选的提示） */
export function isTextExt(ext: string): boolean {
  const TEXT_EXTS = new Set([
    'txt', 'sql', 'log', 'json', 'xml', 'yaml', 'yml', 'csv', 'ini', 'conf', 'properties',
    'java', 'py', 'js', 'ts', 'jsx', 'tsx', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php',
    'sh', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'vue',
  ])
  return TEXT_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

/** 格式化文件大小 */
export function formatSize(bytes: number): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ==================== 图片 base64 ====================

/** 将 File 对象读取为 base64 data URL */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 将 base64 data URL 转换为 File 对象 */
export function dataUrlToFile(dataUrl: string, name: string): File | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  try {
    const mime = match[1]
    const bin = atob(match[2])
    const len = bin.length
    const buf = new Uint8Array(len)
    for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
    return new File([buf], name, { type: mime })
  } catch {
    return null
  }
}
