/**
 * 文档转 Markdown 模块（Electron 主进程）
 *
 * 基于 @firecrawl/anydoc-wasm（Rust 库 anydoc 的 WebAssembly 绑定）在本地将
 * 各类办公文档转换为 GitHub Flavored Markdown：
 * - 完全本地转换，不发起任何网络请求，文件不离开本机
 * - 支持格式：Word（doc/docx/docm）、PPT（ppt/pptx/pps/pot/pptm/ppsx/ppsm）、
 *   Excel（xls/xlsx/xlsm/xlsb）、OpenDocument（odt/ods/odp）、RTF、EPUB、CSV、PDF
 * - 嵌入图片：anydoc 在 Markdown 正文中把嵌入图片渲染为其 alt 文本（通常为空），
 *   原始字节保留在文档模型的 assets 中。本模块按「图片配置」处理这些图片：
 *   - 本地保存（未配置图床）：导出到 `<md名>-assets/` 目录，Markdown 用相对路径引用
 *   - 图床上传（PicGo / 自有图床）：上传图片到图床，Markdown 用返回的 URL 引用
 *   （PDF 不支持文档模型，只能直接输出 Markdown 文本，无法提取图片）
 */
const fs = require('fs')
const path = require('path')

/** anydoc wasm 模块（懒加载，进程内只初始化一次） */
let wasmPromise = null

/** 加载并初始化 anydoc wasm（Node 环境用 initSync 直接加载 wasm 字节，不走 fetch） */
function loadAnydoc() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasmPath = require.resolve('@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm')
      const wasmBytes = fs.readFileSync(wasmPath)
      const mod = await import('@firecrawl/anydoc-wasm')
      mod.initSync({ module: wasmBytes })
      return mod
    })()
  }
  return wasmPromise
}

/** 转换错误码 -> 用户可读提示 */
const ERROR_MESSAGES = {
  needsOcr: 'PDF 为扫描件（无文本层），本地无法解析，请先使用 OCR 工具转为可搜索 PDF',
  encrypted: '文档已加密或受密码保护，无法转换',
  malformed: '文档结构损坏，无法提取有效内容',
  unsupported: '暂不支持转换该格式，请确认文件是否完整',
  resourceLimit: '文档超出安全限制（解压/嵌套/节点数），无法转换',
  missingPart: '文档缺少关键组成部分，无法转换',
}

/** 将转换异常规范化为 { code, message } */
function formatError(err) {
  const code = err && err.code
  return { code: code || '', message: ERROR_MESSAGES[code] || err?.message || String(err) }
}

/** MIME 类型 -> 文件扩展名（导出嵌入资源用），无法识别时返回 bin */
function extFromMime(mime) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'image/avif': 'avif',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
    'text/csv': 'csv',
  }
  if (map[mime]) return map[mime]
  const sub = String(mime || '').split('/')[1]
  return sub && /^[\w.+-]+$/.test(sub) ? sub : 'bin'
}

/** 判断文件类型：CSV 无文件签名必须显式指定格式，其余交给 anydoc 内容检测 */
function detectFormat(filePath) {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  return ext === 'csv' ? 'csv' : null
}

/** 生成同目录同名 .md 目标路径，重名时自动追加序号（report.md -> report-1.md） */
function resolveTargetPath(filePath) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  let target = path.join(dir, `${base}.md`)
  for (let i = 1; fs.existsSync(target); i++) {
    target = path.join(dir, `${base}-${i}.md`)
  }
  return target
}

/**
 * 将文件转换为 Markdown 文本（不写盘），供 AI 引用等场景复用。
 * 注意：此路径不处理嵌入图片（图片在 anydoc 中只渲染为 alt 文本）。
 * @param {string} filePath 源文件绝对路径
 * @returns {Promise<{ok:boolean, markdown?:string, code?:string, error?:string}>}
 */
async function toMarkdown(filePath) {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return { ok: false, error: '目标不是文件' }
    const bytes = new Uint8Array(await fs.promises.readFile(filePath))
    const mod = await loadAnydoc()
    try {
      const markdown = mod.toMarkdownBytes(bytes, detectFormat(filePath))
      return { ok: true, markdown }
    } catch (err) {
      const e = formatError(err)
      return { ok: false, code: e.code, error: e.message }
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/* ==================== 嵌入图片处理 ==================== */

/** 是否为图片 MIME 类型 */
function isImageMime(mime) {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('image/')
}

/**
 * 从 JSON 响应中按点号路径提取 URL（与渲染进程 imageHosting.ts 保持一致）。
 * @param {any} obj 响应对象
 * @param {string} p 点号分隔路径（如 data.url / result.0）
 * @returns {string|null}
 */
function extractUrlByPath(obj, p) {
  if (!obj || typeof obj !== 'object') return null
  const parts = String(p || '').split('.')
  let cur = obj
  for (const part of parts) {
    if (cur == null) return null
    if (/^\d+$/.test(part) && Array.isArray(cur)) cur = cur[Number(part)]
    else cur = cur[part]
  }
  return typeof cur === 'string' ? cur : null
}

/** 从图床响应中按常见路径智能提取 URL（与渲染进程保持一致） */
function smartExtractUrl(obj) {
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

/** 上传图片最大等待时长（毫秒） */
const UPLOAD_TIMEOUT = 30000

/**
 * 通过 PicGo Server API 上传单张图片（FormData，字段名 files）。
 * @param {Uint8Array|Buffer} data 图片字节
 * @param {string} mediaType MIME 类型
 * @param {string} fileName 文件名
 * @param {object} config 图片配置
 * @returns {Promise<string>} 图片 URL
 */
async function uploadViaPicGo(data, mediaType, fileName, config) {
  const uploadUrl = String(config.picgoUrl || '').replace(/\/+$/, '') + '/upload'
  const form = new FormData()
  form.append('files', new Blob([data], { type: mediaType || 'application/octet-stream' }), fileName)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT)
  try {
    const resp = await fetch(uploadUrl, { method: 'POST', body: form, signal: controller.signal })
    if (!resp.ok) throw new Error(`PicGo 服务返回 HTTP ${resp.status}`)
    const json = await resp.json().catch(() => null)
    if (json && json.success === false) throw new Error(json.message || 'PicGo 上传失败')
    let urls = []
    if (Array.isArray(json?.result)) urls = json.result.filter((u) => typeof u === 'string')
    else if (typeof json?.result === 'string') urls = [json.result]
    else {
      const single = smartExtractUrl(json)
      if (single) urls = [single]
    }
    if (!urls.length) throw new Error('PicGo 返回结果中未找到图片 URL')
    return urls[0]
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 通过自有图床上传单张图片（Chevereto API v1 兼容，字段名 source）。
 * @param {Uint8Array|Buffer} data 图片字节
 * @param {string} mediaType MIME 类型
 * @param {string} fileName 文件名
 * @param {object} config 图片配置
 * @returns {Promise<string>} 图片 URL
 */
async function uploadViaCustom(data, mediaType, fileName, config) {
  const headers = {}
  if (config.customToken) headers['X-API-Key'] = config.customToken

  const form = new FormData()
  form.append('source', new Blob([data], { type: mediaType || 'application/octet-stream' }), fileName)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT)
  try {
    const resp = await fetch(config.customUrl, { method: 'POST', headers, body: form, signal: controller.signal })
    const json = await resp.json().catch(() => null)
    if (!resp.ok || (json && json.error)) {
      throw new Error(json?.error?.message || json?.message || `图床服务返回 HTTP ${resp.status}`)
    }
    let url = config.customUrlField ? extractUrlByPath(json, config.customUrlField) : null
    if (!url) url = smartExtractUrl(json)
    if (!url) throw new Error(`无法从图床响应中解析图片「${fileName}」的 URL，请检查 URL 路径配置`)
    return url
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 按图片配置上传图片字节。
 * @param {Uint8Array} data 图片字节
 * @param {string} mediaType MIME 类型
 * @param {string} fileName 文件名
 * @param {object} imageConfig 图片配置（type: none/picgo/custom）
 * @returns {Promise<string>} 图片 URL
 */
async function uploadImageBytes(data, mediaType, fileName, imageConfig) {
  const type = imageConfig?.type
  if (type === 'picgo') return uploadViaPicGo(data, mediaType, fileName, imageConfig)
  if (type === 'custom') return uploadViaCustom(data, mediaType, fileName, imageConfig)
  throw new Error('未配置图床，无法上传图片')
}

/* ==================== 文档模型遍历与 Markdown 定位 ==================== */

/**
 * 遍历文档模型，按渲染顺序收集文本片段、图片片段与结构标记，用于在 anydoc
 * 输出的 Markdown 中定位嵌入图片的位置。
 *
 * 关键背景：anydoc 把嵌入图片渲染为 alt 文本（通常为空），因此图片在 Markdown
 * 中往往没有任何可见字符。结构标记用于把「空 alt 图片」锚定到正确位置：
 * - blockStart/blockEnd：段落/标题边界，把图片锚定到块内容起点
 * - linkStart/linkEnd：链接标签边界，把图片锚定到标签内
 * - table：表格整块，行/列与 Markdown 表格行/单元格一一对应
 *
 * @param {Array} blocks 文档块（doc.blocks）
 * @returns {Array<object>}
 */
function collectSegments(blocks) {
  const segments = []

  const walkInlines = (inlines) => {
    for (const inline of inlines || []) {
      switch (inline?.kind) {
        case 'text':
          if (inline.text) segments.push({ kind: 'text', text: inline.text, style: inline.style })
          break
        case 'link':
          // 链接内容以 [label](url) 渲染，内容里的图片需要参与定位
          segments.push({ kind: 'linkStart' })
          walkInlines(inline.content)
          segments.push({ kind: 'linkEnd' })
          break
        case 'image':
          segments.push({
            kind: 'image',
            alt: inline.alt || '',
            assetId: inline.source?.kind === 'asset' ? inline.source.assetId : undefined,
            external: inline.source?.kind === 'external',
          })
          break
        default:
          break // anchor / noteRef / lineBreak / math / checkbox 渲染为固定语法，容错匹配会自动跳过
      }
    }
  }

  const walkBlocks = (list) => {
    for (const block of list || []) {
      switch (block?.kind) {
        case 'heading':
        case 'paragraph':
          // 叶子内容块：以块边界标记包裹，供空 alt 图片定位
          segments.push({ kind: 'blockStart' })
          walkInlines(block.content)
          segments.push({ kind: 'blockEnd' })
          break
        case 'list':
          for (const item of block.list?.items || []) walkBlocks(item.blocks)
          break
        case 'table': {
          // 整块收集：单元格内片段递归收集，供单元格定位
          const rows = []
          for (const row of block.table?.grid || []) {
            const cells = []
            for (const slot of row) {
              cells.push(slot?.cell?.blocks ? collectSegments(slot.cell.blocks) : [])
            }
            rows.push(cells)
          }
          segments.push({ kind: 'table', rows })
          break
        }
        case 'blockQuote':
          walkBlocks(block.blocks)
          break
        default:
          break // codeBlock / rule / math 无内嵌图片，正文由容错匹配自动跳过
      }
    }
  }

  walkBlocks(blocks)
  return segments
}

/**
 * 在 Markdown 中从 pos 开始按顺序匹配文本（容忍转义反斜杠与 Markdown 语法字符）。
 * 由于 anydoc 渲染时会转义文本并插入标记语法，这里用「逐字符 + 跳过语法字符」的方式
 * 定位，保证即使文本被包裹在 **、`、链接、列表标记等语法中也能找到。
 * @param {string} md Markdown 文本
 * @param {number} pos 起始位置
 * @param {string} text 待匹配的原始文本
 * @param {number} [maxPos] 匹配上限（不含，用于表格单元格等受限区域）
 * @returns {{start:number, end:number}|null} 匹配区间（end 为匹配结束位置）
 */
function matchTextFrom(md, pos, text, maxPos) {
  const limit = maxPos == null ? md.length : maxPos
  let i = 0
  let start = -1
  while (i < text.length) {
    if (pos >= limit) return null
    const ch = md[pos]
    if (ch === '\\') {
      // 转义符：跳过反斜杠，其后字符按转义结果参与匹配（\* 匹配 *）
      pos++
      continue
    }
    if (ch === text[i]) {
      if (start < 0) start = pos
      pos++
      i++
      continue
    }
    // 语法字符（* _ ` [ ] ( ) # > 等）与块标记：跳过继续找
    pos++
  }
  return start < 0 ? null : { start, end: pos }
}

/** 在图片引用标签中兜底转义裸方括号，避免提前终止 ![]()（已转义的保留） */
function escapeLabelBrackets(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if ((ch === '[' || ch === ']') && s[i - 1] !== '\\') out += '\\'
    out += ch
  }
  return out
}

/** 格式化 Markdown 图片地址：转义 < > |，含空白或括号时用尖括号包裹 */
function formatImageUrl(url) {
  const escaped = String(url)
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\|/g, '%7C')
  return /[\s()]/.test(escaped) ? `<${escaped}>` : escaped
}

/**
 * 跳过 Markdown 中的块分隔符、空白与紧邻的列表标记，返回下一个可见内容的位置。
 * 用于「空 alt 图片」独占块（段落/列表项）时，把图片锚定到块内容起点。
 * - 段落之间的 \n\n 会被跳过，图片随后补一个空行保持分隔
 * - 列表项的标记仅在未跨空行时跳过（避免把下一块的标记吞掉），且不越过项内换行
 * @param {number} [maxPos] 匹配上限（不含）
 */
function skipBlockSeparator(md, pos, maxPos) {
  const limit = maxPos == null ? md.length : maxPos
  let p = pos
  let newlineCount = 0
  while (p < limit && /\s/.test(md[p])) {
    if (md[p] === '\n') newlineCount++
    p++
  }
  // 仅跳过紧邻的列表标记（未跨空行），且标记后只跳过空格，不越过项内换行
  if (p < limit && newlineCount < 2) {
    const m = md.slice(p, Math.min(p + 4, limit)).match(/^(?:[-*+] |\d+\. )/)
    if (m) {
      p += m[0].length
      while (p < limit && (md[p] === ' ' || md[p] === '\t')) p++
    }
  }
  return p
}

/** 解析一个 Markdown 表格单元格，返回其内容区间（含空单元格） */
function parseCellSegment(line, s, e, base) {
  const raw = line.slice(s, e)
  const content = raw.trim()
  if (!content) {
    // 空单元格：内容起点在首空格之后，终点在末空格之前
    const start = base + s + (raw[0] === ' ' ? 1 : 0)
    const end = base + e - (raw[raw.length - 1] === ' ' ? 1 : 0)
    return { raw, content, contentStart: start, contentEnd: Math.max(end, start) }
  }
  const lead = raw.indexOf(content)
  const trail = raw.length - (lead + content.length)
  return { raw, content, contentStart: base + s + lead, contentEnd: base + e - trail }
}

/** 按未转义的 | 拆分表格行为单元格列表 */
function parseRowLine(line, base) {
  const cells = []
  let s = 0
  for (let i = 0; i <= line.length; i++) {
    const ch = i < line.length ? line[i] : '|'
    if (ch === '|' && (i === 0 || line[i - 1] !== '\\')) {
      cells.push(parseCellSegment(line, s, i, base))
      s = i + 1
    }
  }
  return cells
}

/**
 * 从 pos 所在行开始解析连续的 Markdown 表格行（自动跳过分隔行如 | --- |）。
 * @returns {{rows:Array<{start:number,end:number,cells:Array,separator:boolean}>, end:number}}
 */
function parseTableRegion(md, pos) {
  const rows = []
  // 从包含 pos 的行首开始扫描，保证表格位于文档开头时也能识别
  let lineStart = pos
  while (lineStart > 0 && md[lineStart - 1] !== '\n') lineStart--
  let scan = lineStart
  while (scan < md.length) {
    while (scan < md.length && (md[scan] === '\n' || md[scan] === '\r')) scan++
    if (scan >= md.length) break
    const s = scan
    let e = s
    while (e < md.length && md[e] !== '\n') e++
    const line = md.slice(s, e)
    if (!/^\s*\|/.test(line)) {
      scan = e
      continue
    }
    const cells = parseRowLine(line, s)
    const nonEmpty = cells.filter((c) => c.content)
    const separator = nonEmpty.length > 0 && nonEmpty.every((c) => /^:?-{3,}:?$/.test(c.content.trim()))
    rows.push({ start: s, end: e, cells, separator })
    scan = e
  }
  return { rows, end: rows.length ? rows[rows.length - 1].end : scan }
}

/**
 * 处理一段片段序列，生成 Markdown 重写操作（追加到 ops）。
 * @param {string} md 原始 Markdown
 * @param {Array} segments 片段序列（blockStart/blockEnd/linkStart/linkEnd/text/image）
 * @param {Array} ops 重写操作收集数组
 * @param {Map} assetRefs 资源 id -> 引用信息
 * @param {number} startPos 起始搜索位置
 * @param {object} [ctx]
 * @param {{start:number,end:number}} [ctx.range] 受限匹配区间（表格单元格）
 * @param {boolean} [ctx.inCell] 是否处于表格单元格内（抑制独占图片补空行）
 * @returns {number} 处理后的搜索位置
 */
function processSegments(md, segments, ops, assetRefs, startPos, ctx = {}) {
  const maxPos = ctx.range ? ctx.range.end : md.length
  let pos = startPos
  /** 当前块是否「只有空 alt 图片、没有任何可见文本/alt」（用于决定插入后是否补空行） */
  let blockImageOnly = false
  /** 链接标签栈：{ labelStart, hasContent } */
  const linkStack = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    // 块开始：预定位块内容起点，避免空 alt 图片插到相邻段落
    if (seg.kind === 'blockStart') {
      blockImageOnly = false
      let anchorText = null
      let imageOnly = true
      for (let j = i + 1; j < segments.length && segments[j].kind !== 'blockEnd'; j++) {
        const s = segments[j]
        if (s.kind === 'text') {
          const t = (s.text || '').trim()
          if (t) {
            anchorText = t
            imageOnly = false
            break
          }
        } else if (s.kind === 'image') {
          const a = (s.alt || '').trim()
          if (a) {
            anchorText = a // 非空 alt 图片本身就有可见文本，可作为锚点
            imageOnly = false
            break
          }
        }
      }
      if (anchorText) {
        const found = matchTextFrom(md, pos, anchorText, maxPos)
        if (found) pos = found.start
      } else if (imageOnly) {
        // 整块没有任何可见文本（如只有一个空 alt 图片）：跳过块分隔符
        pos = skipBlockSeparator(md, pos, maxPos)
        blockImageOnly = true
      }
      continue
    }
    if (seg.kind === 'blockEnd') {
      blockImageOnly = false
      continue
    }

    if (seg.kind === 'linkStart') {
      // 定位链接标签起点（[ 之后），供空 alt 图片锚定到标签内
      let p = pos
      let labelStart = pos
      while (p >= 0) {
        if (md[p] === '[' && (p === 0 || md[p - 1] !== '\\')) {
          labelStart = p + 1
          break
        }
        p--
      }
      linkStack.push({ labelStart, hasContent: false })
      continue
    }

    if (seg.kind === 'linkEnd') {
      // 消费链接收尾 ](url)，使后续内容从链接之后开始匹配
      let p = pos
      while (p < md.length && (md[p] !== ']' || (p > 0 && md[p - 1] === '\\'))) p++
      if (p < md.length) {
        p++
        if (md[p] === '(') {
          let depth = 1
          p++
          while (p < md.length && depth > 0) {
            if (md[p] === '(') depth++
            else if (md[p] === ')') depth--
            if (depth > 0) p++
          }
          if (depth === 0) p++
        }
        pos = p
      }
      linkStack.pop()
      continue
    }

    if (seg.kind === 'text') {
      const rawText = seg.text || ''
      const text = rawText.trim()
      if (!text) continue
      const found = matchTextFrom(md, pos, text, maxPos)
      if (found) {
        pos = found.end
        // 原文本段带尾随空白时消费对应空白，使紧随的空 alt 图片保持正确间距
        const trailing = rawText.length - rawText.replace(/\s+$/, '').length
        for (let n = 0; n < trailing && pos < maxPos && (md[pos] === ' ' || md[pos] === '\t'); n++) pos++
        if (linkStack.length) linkStack[linkStack.length - 1].hasContent = true
        // 消费本段文本的样式收尾定界符（** * ~~ `），避免空 alt 图片插到定界符内部
        const style = seg.style || {}
        let closers = ''
        if (style.code) closers += '`'
        if (style.bold) closers += '**'
        if (style.italic) closers += '*'
        if (style.strike) closers += '~~'
        if (closers && pos + closers.length <= maxPos && md.startsWith(closers, pos)) pos += closers.length
      }
      continue
    }

    if (seg.kind === 'image') {
      // 外部图片已带 URL，无需处理
      if (seg.external) continue
      const info = assetRefs.get(seg.assetId)
      if (!info || info.ref == null || info.nonImage) continue

      const alt = (seg.alt || '').trim()
      if (alt) {
        const found = matchTextFrom(md, pos, alt, maxPos)
        if (found) {
          // 替换定位到的 alt 文本；使用原始 Markdown 中的转义文本作标签内容
          const rawAlt = md.slice(found.start, found.end)
          ops.push({
            type: 'replace',
            start: found.start,
            end: found.end,
            insert: `![${escapeLabelBrackets(rawAlt)}](${formatImageUrl(info.ref)})`,
          })
          pos = found.end
          if (linkStack.length) linkStack[linkStack.length - 1].hasContent = true
        } else {
          ops.push({ type: 'insert', pos, insert: `![${escapeLabelBrackets(alt)}](${formatImageUrl(info.ref)})` })
        }
      } else {
        // 空 alt 图片：插入到块内容起点（blockStart 已锚定）或当前位置；
        // 链接标签内首个元素锚定到 [ 之后；独占图片段落补一个空行分隔
        let insertPos = pos
        let inLinkLabel = false
        if (linkStack.length && !linkStack[linkStack.length - 1].hasContent) {
          insertPos = Math.max(insertPos, linkStack[linkStack.length - 1].labelStart)
          linkStack[linkStack.length - 1].hasContent = true
          inLinkLabel = true
        }
        let suffix = ''
        // 独占图片块：块分隔符已被跳过，需在图片后补空行；若下一字符本就是换行（如列表项），无需再补
        if (blockImageOnly && !ctx.inCell && !inLinkLabel && insertPos < maxPos && md[insertPos] !== '\n' && md[insertPos] !== '\r') {
          suffix = '\n\n'
        }
        ops.push({ type: 'insert', pos: insertPos, insert: `![](${formatImageUrl(info.ref)})${suffix}` })
      }
      continue
    }
  }
  return pos
}

/**
 * 根据图片片段与资源引用，构建 Markdown 重写操作。
 * - 普通块：processSegments 按文本顺序定位（含样式定界符、链接边界）
 * - 表格：解析 Markdown 表格行，按单元格区间逐个处理，保证图片落在所属单元格内
 * @param {string} md 原始 Markdown
 * @param {Array} segments collectSegments 的结果
 * @param {Map<number,{ref:string, nonImage?:boolean}>} assetRefs 资源 id -> 引用信息
 * @returns {Array<{type:'replace'|'insert', pos?:number, start?:number, end?:number, insert:string}>}
 */
function buildImageOps(md, segments, assetRefs) {
  const ops = []
  let pos = 0
  let batch = []
  const flush = () => {
    if (batch.length) {
      pos = processSegments(md, batch, ops, assetRefs, pos)
      batch = []
    }
  }

  for (const seg of segments) {
    if (seg.kind === 'table') {
      flush()
      const parsed = parseTableRegion(md, pos)
      if (parsed.rows.length) {
        const dataRows = parsed.rows.filter((r) => !r.separator)
        for (let r = 0; r < seg.rows.length && r < dataRows.length; r++) {
          const modelRow = seg.rows[r]
          const mdRow = dataRows[r]
          for (let c = 0; c < modelRow.length && c + 1 < mdRow.cells.length; c++) {
            const cellSegs = modelRow[c]
            if (!cellSegs || !cellSegs.length) continue
            // 行首与行尾各有一个由外层 | 产生的空单元格，真实列从下标 1 开始
            const cell = mdRow.cells[c + 1]
            processSegments(md, cellSegs, ops, assetRefs, cell.contentStart, {
              range: { start: cell.contentStart, end: cell.contentEnd },
              inCell: true,
            })
          }
        }
        pos = parsed.end
        // 跳过表格后的换行，避免与下一块衔接错位
        while (pos < md.length && (md[pos] === '\n' || md[pos] === '\r')) pos++
      } else {
        // 表格区域解析失败（如单格布局表渲染为普通块）：降级为普通块处理
        pos = processSegments(md, seg.rows.flat(), ops, assetRefs, pos)
      }
      continue
    }
    batch.push(seg)
  }
  flush()
  return ops
}

/** 将重写操作一次性应用到 Markdown（单遍扫描，支持插入与替换混合） */
function applyOps(md, ops) {
  if (!ops.length) return md
  const sorted = [...ops].sort((a, b) => {
    const ka = a.type === 'insert' ? a.pos : a.start
    const kb = b.type === 'insert' ? b.pos : b.start
    return ka - kb
  })
  let out = ''
  let cursor = 0
  for (const op of sorted) {
    const pos = op.type === 'insert' ? op.pos : op.start
    if (pos < cursor) continue // 防御：已越过的操作丢弃（文本匹配异常时）
    out += md.slice(cursor, pos)
    out += op.insert
    cursor = op.type === 'insert' ? pos : op.end
  }
  out += md.slice(cursor)
  return out
}

/**
 * 将嵌入资源保存到 `<md名>-assets/` 目录。
 * @param {object} asset 资源（{id, mediaType, data}）
 * @param {string} fileName 资源文件名
 * @param {string} assetsDir 资源目录
 * @returns {Promise<string>} 资源文件绝对路径
 */
async function saveAssetLocal(asset, fileName, assetsDir) {
  await fs.promises.mkdir(assetsDir, { recursive: true })
  const dest = path.join(assetsDir, fileName)
  await fs.promises.writeFile(dest, Buffer.from(asset.data))
  return dest
}

/**
 * 一键转换：将文件转换为 Markdown 并写入目标路径，同时按图片配置处理嵌入图片。
 * @param {string} filePath 源文件绝对路径
 * @param {object} [options]
 * @param {string} [options.targetPath] 目标 .md 路径；缺省时在同目录生成同名 .md（重名自动加序号）
 * @param {boolean} [options.exportAssets] 是否处理嵌入图片等资源（默认 true，PDF 不支持文档模型）
 * @param {object} [options.imageConfig] 图片配置（type: none/picgo/custom，含 picgoUrl/customUrl/customToken/customUrlField）
 * @returns {Promise<{ok:boolean, targetPath?:string, markdown?:string, exportedAssets?:Array, warnings?:Array, code?:string, error?:string}>}
 */
async function convertFileToMarkdown(filePath, options = {}) {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return { ok: false, error: '目标不是文件' }
    const bytes = new Uint8Array(await fs.promises.readFile(filePath))
    const mod = await loadAnydoc()

    let markdown
    try {
      markdown = mod.toMarkdownBytes(bytes, detectFormat(filePath))
    } catch (err) {
      const e = formatError(err)
      return { ok: false, code: e.code, error: e.message }
    }

    const targetPath = options.targetPath || resolveTargetPath(filePath)
    const exportedAssets = []
    const warnings = []
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
    const isPdf = ext === 'pdf'

    // 处理嵌入图片（PDF 不支持文档模型，直接跳过）
    if (options.exportAssets !== false && !isPdf) {
      try {
        const document = mod.toDocument(bytes, detectFormat(filePath))
        const assetsById = new Map((document?.assets || []).map((a) => [a.id, a]))

        // 只处理被正文图片引用的资源（避免把无关的嵌入对象也上传到图床）
        const segments = collectSegments(document?.blocks)
        const referencedAssets = new Map()
        const collectImages = (list) => {
          for (const seg of list || []) {
            if (seg.kind === 'image') {
              if (seg.external) continue
              const asset = assetsById.get(seg.assetId)
              if (asset) referencedAssets.set(seg.assetId, asset)
            } else if (seg.kind === 'table') {
              for (const row of seg.rows) for (const cell of row) collectImages(cell)
            }
          }
        }
        collectImages(segments)

        if (referencedAssets.size) {
          const mdBase = path.basename(targetPath, '.md')
          const assetsDir = path.join(path.dirname(targetPath), `${mdBase}-assets`)
          const imageConfig = options.imageConfig || {}
          const hostingMode = imageConfig.type === 'picgo' || imageConfig.type === 'custom'
          const assetRefs = new Map()

          for (const [assetId, asset] of referencedAssets) {
            const fileName = `asset-${asset.id}.${extFromMime(asset.mediaType)}`
            // 非图片资源（OLE 对象等）：仅本地导出，不写入 Markdown 引用
            if (!isImageMime(asset.mediaType)) {
              try {
                await saveAssetLocal(asset, fileName, assetsDir)
              } catch {
                /* 资源导出失败不影响正文 */
              }
              assetRefs.set(assetId, { ref: null, fileName, nonImage: true, mediaType: asset.mediaType })
              continue
            }

            if (hostingMode) {
              try {
                const url = await uploadImageBytes(asset.data, asset.mediaType, fileName, imageConfig)
                assetRefs.set(assetId, { ref: url, fileName, mediaType: asset.mediaType, uploaded: true })
              } catch (err) {
                // 上传失败回退本地保存，保证图片不丢失
                try {
                  await saveAssetLocal(asset, fileName, assetsDir)
                } catch {
                  /* 本地保存失败也不阻断正文 */
                }
                const ref = `${mdBase}-assets/${fileName}`
                assetRefs.set(assetId, { ref, fileName, mediaType: asset.mediaType, uploaded: false })
                warnings.push(`上传图片「${fileName}」失败，已改为本地保存：${err?.message || String(err)}`)
              }
            } else {
              try {
                await saveAssetLocal(asset, fileName, assetsDir)
              } catch {
                /* 本地保存失败也不阻断正文 */
              }
              const ref = `${mdBase}-assets/${fileName}`
              assetRefs.set(assetId, { ref, fileName, mediaType: asset.mediaType, uploaded: false })
            }
          }

          // 在 Markdown 中插入图片引用
          markdown = applyOps(markdown, buildImageOps(markdown, segments, assetRefs))

          for (const [assetId, info] of assetRefs) {
            exportedAssets.push({
              id: assetId,
              mediaType: info.mediaType,
              fileName: info.fileName,
              ref: info.ref,
              uploaded: !!info.uploaded,
            })
          }
        }
      } catch {
        /* 文档模型解析失败：退回原行为（仅导出可用的资源） */
        try {
          const document = mod.toDocument(bytes, detectFormat(filePath))
          if (document && Array.isArray(document.assets) && document.assets.length) {
            const mdBase = path.basename(targetPath, '.md')
            const assetsDir = path.join(path.dirname(targetPath), `${mdBase}-assets`)
            await fs.promises.mkdir(assetsDir, { recursive: true })
            for (const asset of document.assets) {
              if (!asset || !asset.data || !asset.data.length) continue
              const fileName = `asset-${asset.id}.${extFromMime(asset.mediaType)}`
              await fs.promises.writeFile(path.join(assetsDir, fileName), Buffer.from(asset.data))
              exportedAssets.push({ id: asset.id, mediaType: asset.mediaType || '', fileName })
            }
          }
        } catch {
          /* 嵌入资源导出失败不影响正文转换 */
        }
      }
    }

    await fs.promises.writeFile(targetPath, markdown, 'utf-8')
    return { ok: true, targetPath, markdown, exportedAssets, warnings }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

module.exports = {
  toMarkdown,
  convertFileToMarkdown,
  _internal: { matchTextFrom, collectSegments, processSegments, buildImageOps, applyOps, skipBlockSeparator, parseTableRegion },
}
