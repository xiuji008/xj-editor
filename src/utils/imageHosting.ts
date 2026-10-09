/**
 * 图床配置与上传工具。
 *
 * 支持两种图床类型：
 * 1. PicGo — 通过 PicGo 本地 HTTP Server 上传（默认 http://127.0.0.1:36677/upload）
 * 2. 自有图床 — 通过 multipart/form-data POST 到用户配置的上传接口
 *
 * 配置持久化在 localStorage，key 为 IMAGE_HOSTING_CONFIG_KEY。
 * 参考自前端知识库编辑器（frontend/apps/knowledge/src/utils/imageHosting.ts）。
 *
 * @module utils/imageHosting
 */

// ==================== 类型定义 ====================

/** 图床类型 */
export type ImageHostingType = 'none' | 'picgo' | 'custom'

/** 图床配置 */
export interface ImageHostingConfig {
  /** 图床类型 */
  type: ImageHostingType
  /** PicGo 服务器地址（如 http://127.0.0.1:36677） */
  picgoUrl: string
  /** 自有图床上传接口 URL（如 http://localhost:9003/api/1/upload/upload） */
  customUrl: string
  /** 自有图床 API Key（作为 X-API-Key 请求头发送） */
  customToken: string
  /** 自有图床响应中图片 URL 的 JSON 路径（如 image.url / data.url），默认 image.url */
  customUrlField: string
}

// ==================== 常量 ====================

const STORAGE_KEY = 'knowledge_image_hosting_config'

/** 默认配置 */
export const DEFAULT_CONFIG: ImageHostingConfig = {
  type: 'none',
  picgoUrl: 'http://127.0.0.1:36677',
  customUrl: '',
  customToken: '',
  customUrlField: 'image.url',
}

// ==================== 配置读写 ====================

/**
 * 读取图床配置，若未配置则返回默认值。
 * @returns 图床配置
 */
export function getImageHostingConfig(): ImageHostingConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 保存图床配置到 localStorage。
 * @param config 图床配置
 */
export function saveImageHostingConfig(config: ImageHostingConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

/**
 * 图床是否已启用（type 不为 none 且必要参数已填）。
 * @returns 是否启用
 */
export function isImageHostingEnabled(): boolean {
  const config = getImageHostingConfig()
  if (config.type === 'none') return false
  if (config.type === 'picgo') return !!config.picgoUrl
  if (config.type === 'custom') return !!config.customUrl
  return false
}

// ==================== 上传逻辑 ====================

/**
 * 从 JSON 响应中按点号路径提取 URL。
 * 支持如 "data.url"、"data"、"url"、"result.0" 等路径。
 * @param obj 响应对象
 * @param path 点号分隔的路径
 * @returns 提取到的 URL 字符串，找不到时返回 null
 */
function extractUrlByPath(obj: any, path: string): string | null {
  if (!obj || typeof obj !== 'object') return null
  const parts = path.split('.')
  let current: any = obj
  for (const part of parts) {
    if (current == null) return null
    // 支持数组索引
    if (/^\d+$/.test(part) && Array.isArray(current)) {
      current = current[Number(part)]
    } else {
      current = current[part]
    }
  }
  if (typeof current === 'string') return current
  return null
}

/**
 * 智能从响应中提取 URL（当配置路径无法匹配时尝试常见路径）。
 * @param obj 响应对象
 * @returns URL 字符串
 */
function smartExtractUrl(obj: any): string | null {
  const commonPaths = [
    'image.url',
    'data.url',
    'data',
    'url',
    'result.0',
    'result',
    'data.link',
    'data.image.url',
    'data.image',
  ]
  for (const p of commonPaths) {
    const url = extractUrlByPath(obj, p)
    if (url) return url
  }
  return null
}

/** 上传结果 */
export interface UploadResult {
  /** 图片访问 URL */
  url: string
  /** 原始文件名 */
  fileName: string
}

/**
 * 通过 PicGo Server API 上传图片（FormData 方式，字段名 files，支持多图）。
 *
 * @param files 图片文件数组
 * @param config 图床配置
 * @returns 上传结果数组
 */
async function uploadViaPicGo(files: File[], config: ImageHostingConfig): Promise<UploadResult[]> {
  const uploadUrl = config.picgoUrl.replace(/\/+$/, '') + '/upload'

  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  })

  if (!resp.ok) {
    throw new Error(`PicGo 服务返回 HTTP ${resp.status}`)
  }

  const data = await resp.json()
  if (data.success === false) {
    throw new Error(data.message || 'PicGo 上传失败')
  }

  // 提取 URL 列表：优先 result 数组，其次尝试常见路径
  let urls: string[] = []
  if (Array.isArray(data.result)) {
    urls = data.result.filter((u: any) => typeof u === 'string')
  } else if (typeof data.result === 'string') {
    urls = [data.result]
  } else {
    // 尝试从其他常见字段提取
    const single = smartExtractUrl(data)
    if (single) urls = [single]
  }

  if (urls.length === 0) {
    throw new Error('PicGo 返回结果中未找到图片 URL')
  }

  // 按文件顺序匹配 URL（若 URL 数量少于文件数，取第一个兜底）
  return files.map((file, idx) => ({
    url: urls[idx] || urls[0],
    fileName: file.name,
  }))
}

/**
 * 通过自有图床上传图片（Chevereto API v1 兼容）。
 *
 * @param files 图片文件数组
 * @param config 图床配置
 * @returns 上传结果数组
 */
async function uploadViaCustom(files: File[], config: ImageHostingConfig): Promise<UploadResult[]> {
  const headers: Record<string, string> = {}
  if (config.customToken) {
    headers['X-API-Key'] = config.customToken
  }

  const results: UploadResult[] = []
  for (const file of files) {
    const formData = new FormData()
    formData.append('source', file)

    const resp = await fetch(config.customUrl, {
      method: 'POST',
      headers,
      body: formData,
    })

    const data = await resp.json().catch(() => null)

    // Chevereto 错误响应：HTTP 非 200 或响应含 error 字段
    if (!resp.ok || (data && data.error)) {
      const errMsg = data?.error?.message || data?.message || `图床服务返回 HTTP ${resp.status}`
      throw new Error(errMsg)
    }

    // 按配置路径提取 URL，失败时尝试常见路径
    let url: string | null = null
    if (config.customUrlField) {
      url = extractUrlByPath(data, config.customUrlField)
    }
    if (!url) {
      url = smartExtractUrl(data)
    }
    if (!url) {
      throw new Error(`无法从图床响应中解析图片「${file.name}」的 URL，请检查 URL 路径配置`)
    }

    results.push({ url, fileName: file.name })
  }
  return results
}

/**
 * 批量上传图片到已配置的图床。
 * PicGo 会将所有文件打包在一次 FormData 请求中上传；
 * 自有图床逐个上传。
 *
 * @param files 图片文件数组
 * @returns 上传结果数组（与输入文件一一对应）
 * @throws 如果未配置图床或上传失败
 */
export async function uploadImages(files: File[]): Promise<UploadResult[]> {
  if (files.length === 0) return []

  const config = getImageHostingConfig()

  if (config.type === 'none') {
    throw new Error('未配置图床，请先在配置中设置图床')
  }

  if (config.type === 'picgo') {
    return uploadViaPicGo(files, config)
  }

  if (config.type === 'custom') {
    return uploadViaCustom(files, config)
  }

  throw new Error(`不支持的图床类型: ${config.type}`)
}

/**
 * 上传单张图片到已配置的图床（uploadImages 的便捷封装）。
 *
 * @param file 图片文件
 * @returns 上传结果（含图片 URL）
 * @throws 如果未配置图床或上传失败
 */
export async function uploadImage(file: File): Promise<UploadResult> {
  const results = await uploadImages([file])
  return results[0]
}

/**
 * 检查粘贴事件中是否包含图片文件。
 * @param clipboardData 剪贴板数据
 * @returns 图片文件数组（可能为空）
 */
export function getImagesFromClipboard(clipboardData: DataTransfer): File[] {
  const images: File[] = []
  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) images.push(file)
    }
  }
  return images
}
