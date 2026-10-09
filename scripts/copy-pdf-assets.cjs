/**
 * 复制 pdf.js 运行时资源（cMaps / 标准字体）到 public/pdfjs
 *
 * 这两个目录由 pdf.js 在解析 PDF 时按需加载：
 * - cmaps：预定义字符编码表，中文 / 日文等 CJK PDF 依赖它正确取字；
 * - standard_fonts：未嵌入文档时的标准字体替代字形。
 *
 * 放到 public 后由 Vite 原样拷贝到 dist，运行时按相对路径 ./pdfjs/... 访问，
 * 因此打包成 Electron 应用（file:// 加载）时也能保持目录结构。
 *
 * 用法：node scripts/copy-pdf-assets.cjs
 */
const fs = require('fs')
const path = require('path')

/** 项目根目录 */
const root = path.resolve(__dirname, '..')
/** pdf.js 包目录 */
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist')
/** 输出根目录（Vite 的 publicDir） */
const outRoot = path.join(root, 'public', 'pdfjs')

/** 需要复制的资源目录：源相对路径 → 目标相对路径 */
const ASSETS = [
  { from: 'cmaps', to: 'cmaps' },
  { from: 'standard_fonts', to: 'standard_fonts' },
]

/**
 * 递归复制目录。
 * @param {string} src 源目录
 * @param {string} dest 目标目录
 * @returns {number} 复制的文件数
 */
function copyDir(src, dest) {
  let count = 0
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDir(from, to)
    } else {
      fs.copyFileSync(from, to)
      count++
    }
  }
  return count
}

function main() {
  if (!fs.existsSync(pdfjsDir)) {
    console.error('[pdf-assets] 未找到 pdfjs-dist，请先执行 npm install')
    process.exit(1)
  }
  let total = 0
  for (const asset of ASSETS) {
    const src = path.join(pdfjsDir, asset.from)
    if (!fs.existsSync(src)) {
      console.warn(`[pdf-assets] 跳过不存在的资源目录：${asset.from}`)
      continue
    }
    const dest = path.join(outRoot, asset.to)
    const count = copyDir(src, dest)
    total += count
    console.log(`[pdf-assets] ${asset.from} → public/pdfjs/${asset.to}（${count} 个文件）`)
  }
  console.log(`[pdf-assets] 完成，共 ${total} 个文件`)
}

main()
