/**
 * Windows 文件关联注册 / 注销 / 查询。
 *
 * 全部写入 HKCU\Software\Classes（当前用户），无需管理员权限。
 * 注册后：
 *  - 右键 Markdown / 文本文件 →「打开方式」→「选择其他应用」中会出现本编辑器；
 *  - 双击 .md / .markdown 等文件默认使用本编辑器打开；
 *  - 把文档拖拽到桌面快捷方式 / 应用图标上即可打开。
 */
const { execFile } = require('child_process')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/** 本应用 ProgID */
const PROG_ID = 'MarkdownEditor.Document'
const FRIENDLY_NAME = 'Markdown 编辑器'

/** Markdown 扩展名：注册为默认打开程序 */
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd']
/** 其余文本 / 代码扩展名：仅加入「打开方式」候选，不改动系统默认程序 */
const TEXT_EXTS = [
  'txt', 'json', 'xml', 'yaml', 'yml', 'csv', 'log', 'sql', 'ini', 'conf', 'properties',
  'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'vue',
  'java', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'php', 'sh',
]

const HKCU_CLASSES = 'HKCU\\Software\\Classes'

function isWindows() {
  return process.platform === 'win32'
}

/** 打包后为应用 exe；开发模式为 electron.exe（仅用于测试流程） */
function exePath() {
  return process.execPath
}

/** reg add 封装：写一个键值 */
async function regSet(key, data, name) {
  const args = ['add', key, '/f']
  if (name === undefined || name === '') args.push('/ve')
  else args.push('/v', name)
  args.push('/t', 'REG_SZ', '/d', data)
  await execFileAsync('reg', args)
}

/** reg delete 封装：删除一个键（不存在时忽略） */
async function regDelete(key) {
  try {
    await execFileAsync('reg', ['delete', key, '/f'])
  } catch {
    /* 键不存在或已被删除，忽略 */
  }
}

/** 查询注册表键的默认值（无值或不存在返回 null） */
async function regQueryDefault(key) {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/ve'])
    const m = stdout.match(/REG_SZ\s+(.*)/)
    if (!m) return null
    const val = m[1].trim()
    // reg 输出中"(value not set)" / "(默认值未设置)"表示默认值为空
    if (/^\(.*\)$/.test(val) && /not set|未设置/.test(val)) return null
    return val
  } catch {
    return null
  }
}

/** 注册文件关联 */
async function register() {
  if (!isWindows()) return { ok: false, error: '文件关联仅在 Windows 上可用' }
  const exe = exePath()
  const exeName = path.basename(exe)
  const exeQuoted = `"${exe}"`
  const runCmd = `${exeQuoted} "%1"`

  // 1) 应用级注册：让本应用出现在文件右键「打开方式 → 选择其他应用」
  await regSet(`${HKCU_CLASSES}\\Applications\\${exeName}\\shell\\open\\command`, runCmd)
  await regSet(`${HKCU_CLASSES}\\Applications\\${exeName}\\DefaultIcon`, `${exeQuoted},0`)
  await regSet(`${HKCU_CLASSES}\\Applications\\${exeName}\\FriendlyAppName`, FRIENDLY_NAME)

  // 2) ProgID 定义（含图标与打开命令）
  await regSet(`${HKCU_CLASSES}\\${PROG_ID}`, `${FRIENDLY_NAME} 文档`)
  await regSet(`${HKCU_CLASSES}\\${PROG_ID}\\DefaultIcon`, `${exeQuoted},0`)
  await regSet(`${HKCU_CLASSES}\\${PROG_ID}\\shell\\open\\command`, runCmd)

  // 3) Markdown 扩展名：设为默认打开程序，并加入「打开方式」
  for (const ext of MARKDOWN_EXTS) {
    await regSet(`${HKCU_CLASSES}\\.${ext}`, PROG_ID)
    await regSet(`${HKCU_CLASSES}\\.${ext}\\OpenWithProgids\\${PROG_ID}`, '')
    await regSet(`${HKCU_CLASSES}\\Applications\\${exeName}\\SupportedTypes\\.${ext}`, '')
  }

  // 4) 文本扩展名：仅加入「打开方式」候选
  for (const ext of TEXT_EXTS) {
    await regSet(`${HKCU_CLASSES}\\Applications\\${exeName}\\SupportedTypes\\.${ext}`, '')
  }

  return { ok: true }
}

/** 取消文件关联（只删除本应用写入的键，不影响其他程序） */
async function unregister() {
  if (!isWindows()) return { ok: false, error: '文件关联仅在 Windows 上可用' }
  const exe = exePath()
  const exeName = path.basename(exe)

  // 删除 ProgID 与应用级注册
  await regDelete(`${HKCU_CLASSES}\\${PROG_ID}`)
  await regDelete(`${HKCU_CLASSES}\\Applications\\${exeName}`)

  // 删除各扩展名下的 OpenWithProgids 项
  for (const ext of [...MARKDOWN_EXTS, ...TEXT_EXTS]) {
    await regDelete(`${HKCU_CLASSES}\\.${ext}\\OpenWithProgids\\${PROG_ID}`)
  }

  // Markdown 扩展名若仍指向本 ProgID，则仅恢复默认值为空，
  // 避免连带删除其他程序写入的子键（OpenWithProgids / OpenWithList 等）
  for (const ext of MARKDOWN_EXTS) {
    const current = await regQueryDefault(`${HKCU_CLASSES}\\.${ext}`)
    if (current === PROG_ID) {
      await regSet(`${HKCU_CLASSES}\\.${ext}`, '')
    }
  }

  return { ok: true }
}

/** 查询文件关联是否已注册 */
async function status() {
  if (!isWindows()) return { ok: true, registered: false }
  const exeName = path.basename(exePath())
  try {
    const { stdout } = await execFileAsync('reg', [
      'query', `${HKCU_CLASSES}\\Applications\\${exeName}\\shell\\open\\command`, '/ve',
    ])
    return { ok: true, registered: !!stdout && stdout.length > 0 }
  } catch {
    return { ok: true, registered: false }
  }
}

module.exports = { register, unregister, status }
