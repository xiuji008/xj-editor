/**
 * electron-builder afterPack 钩子：为 Windows 可执行文件补写版本信息与图标。
 *
 * 背景：electron-builder 自带 rcedit 调用（--set-version-string / --set-icon）在
 * 本机稳定失败并报 "Fatal error: Unable to commit changes"。原因是刚复制出来的
 * electron.exe（约 180MB）会被安全软件（腾讯电脑管家实时防护）短暂独占扫描，
 * rcedit 的 EndUpdateResource 提交阶段拿不到写权限；electron-builder 的重试是
 * 连续立即重试，扫描结束前就全部耗尽。
 *
 * 处理办法：关闭 electron-builder 自带的 rcedit（win.signAndEditExecutable=false），
 * 改由本钩子在打包产物上带退避重试地执行 rcedit，最多重试 20 次、每次间隔 3 秒，
 * 从而避开文件被短暂占用的时间窗口。afterPack 发生在 NSIS 打包之前，
 * 因此写入的图标与版本信息会一并进入最终安装包。
 *
 * @author myhub
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')

/** rcedit 最大尝试次数 */
const MAX_ATTEMPTS = 20
/** 每次尝试之间的等待时间（毫秒），用于避开安全软件对 exe 的独占扫描窗口 */
const RETRY_DELAY_MS = 3000

/**
 * 定位 electron-builder 缓存中的 rcedit-x64.exe。
 * 不硬编码 winCodeSign 版本号，按目录名倒序取最新的可用版本。
 *
 * @returns {string|null} rcedit 可执行文件的绝对路径，未找到时返回 null
 */
function findRcedit() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
  if (!fs.existsSync(cacheRoot)) {
    return null
  }

  const versions = fs
    .readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('winCodeSign-'))
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const version of versions) {
    const candidate = path.join(cacheRoot, version, 'rcedit-x64.exe')
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * 把 3 段版本号（1.0.0）补齐为 Windows 资源要求的 4 段版本号（1.0.0.0）。
 *
 * @param {string} version 原始版本号
 * @returns {string} 4 段版本号
 */
function toFourPartVersion(version) {
  return String(version).split('.').length >= 4 ? String(version) : `${version}.0`
}

/**
 * afterPack 钩子主逻辑：仅处理 win32 平台，为产物 exe 写入版本信息与图标。
 *
 * @param {object} context electron-builder 传入的打包上下文
 * @returns {Promise<void>} 无返回值，失败时仅告警不中断打包
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const projectDir = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
  const productName = (pkg.build && pkg.build.productName) || pkg.name
  const iconPath = path.join(projectDir, ((pkg.build && pkg.build.win && pkg.build.win.icon) || 'build/icon.ico'))
  const exeName = `${(context.packager.appInfo && context.packager.appInfo.productFilename) || productName}.exe`
  const exePath = path.join(context.appOutDir, exeName)

  if (!fs.existsSync(exePath)) {
    console.warn(`[after-pack] 未找到可执行文件，跳过版本信息写入：${exePath}`)
    return
  }

  const rceditPath = findRcedit()
  if (!rceditPath) {
    console.warn('[after-pack] 未找到 rcedit-x64.exe，跳过版本信息写入（exe 将保留 Electron 默认图标）')
    return
  }

  const args = [
    exePath,
    '--set-version-string', 'FileDescription', pkg.description || '',
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'LegalCopyright', `Copyright © ${new Date().getFullYear()} ${pkg.author || ''}`,
    '--set-file-version', pkg.version,
    '--set-product-version', toFourPartVersion(pkg.version),
    '--set-version-string', 'InternalName', productName,
    '--set-version-string', 'OriginalFilename', '',
    '--set-version-string', 'CompanyName', pkg.author || ''
  ]
  if (fs.existsSync(iconPath)) {
    args.push('--set-icon', iconPath)
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      execFileSync(rceditPath, args, { stdio: 'pipe' })
      console.log(`[after-pack] 已写入 exe 版本信息与图标（第 ${attempt} 次尝试）：${exeName}`)
      return
    } catch (error) {
      const detail = `${error.stderr ? error.stderr.toString().trim() : ''}${error.message || ''}`.trim()
      console.warn(`[after-pack] 第 ${attempt}/${MAX_ATTEMPTS} 次写入失败：${detail}`)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  console.warn('[after-pack] 达到最大重试次数，exe 未写入自定义图标与版本信息，打包流程继续')
}
