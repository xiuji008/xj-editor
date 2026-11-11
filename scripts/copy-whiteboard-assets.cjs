/**
 * 复制 Excalidraw（白板）运行时资源到 public/excalidraw-assets
 *
 * Excalidraw 0.18 通过 window.EXCALIDRAW_ASSET_PATH 加载运行时资源，
 * 未设置时回退到 unpkg CDN —— 桌面离线环境必须本地化：
 * - fonts：Excalifont 等手绘字体的 unicode-range 子集（浏览器按需加载，磁盘全量 ~13MB）；
 * - locales：界面语言包（只复制 zh-CN，1 个文件）；
 * - data：内置图片等杂项资源。
 *
 * 放到 public 后由 Vite 原样拷贝到 dist，运行时按 ./excalidraw-assets/... 相对路径访问，
 * 打包成 Electron 应用（file:// 加载）时目录结构保持不变。
 *
 * 用法：node scripts/copy-whiteboard-assets.cjs
 */
const fs = require('fs')
const path = require('path')

/** 项目根目录 */
const root = path.resolve(__dirname, '..')
/** @excalidraw/excalidraw 包目录 */
const excalidrawDir = path.join(root, 'node_modules', '@excalidraw', 'excalidraw')
/** 输出根目录（Vite 的 publicDir） */
const outRoot = path.join(root, 'public', 'excalidraw-assets')

/** 需要复制的资源：源相对路径 → 目标相对路径；filter 为文件名过滤正则（仅对文件生效） */
const ASSETS = [
  { from: 'fonts', to: 'fonts' },
  { from: 'locales', to: 'locales', filter: /^zh-CN-/ },
  { from: 'data', to: 'data' },
]

/**
 * 递归复制目录（可选按文件名过滤）。
 * @param {string} src 源目录
 * @param {string} dest 目标目录
 * @param {RegExp} [filter] 文件名过滤正则
 * @returns {number} 复制的文件数
 */
function copyDir(src, dest, filter) {
  let count = 0
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !entry.isDirectory() && !filter.test(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDir(from, to, filter)
    } else {
      fs.copyFileSync(from, to)
      count++
    }
  }
  return count
}

function main() {
  const distProd = path.join(excalidrawDir, 'dist', 'prod')
  if (!fs.existsSync(distProd)) {
    console.error('[wb-assets] 未找到 @excalidraw/excalidraw，请先执行 npm install')
    process.exit(1)
  }
  let total = 0
  for (const asset of ASSETS) {
    const src = path.join(distProd, asset.from)
    if (!fs.existsSync(src)) {
      console.warn(`[wb-assets] 跳过不存在的资源目录：${asset.from}`)
      continue
    }
    const dest = path.join(outRoot, asset.to)
    const count = copyDir(src, dest, asset.filter)
    total += count
    console.log(`[wb-assets] ${asset.from} → public/excalidraw-assets/${asset.to}（${count} 个文件）`)
  }
  console.log(`[wb-assets] 完成，共 ${total} 个文件`)
}

main()
