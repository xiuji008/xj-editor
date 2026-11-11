/**
 * 文件类型图标模块（渲染进程使用）。
 *
 * 为目录树中的不同文件类型提供「品牌色圆角色块 + 辨识字形」图标：
 * 颜色与图形均对齐行业通用惯例（TypeScript 蓝、Vue 绿、PDF 红、Office 品牌色、
 * 数据库圆柱、音乐音符等），一眼即可识别文件类型；
 * 未匹配的扩展名回退为灰色折角文档图标。
 *
 * @module utils/fileIcons
 */

/** 文件图标定义 */
export interface FileIconDef {
  /** 图标语义类型（用于调试 / 语义区分） */
  type: string
  /** 是否为文件夹（文件夹不渲染色块底片） */
  folder: boolean
  /** 色块底片颜色（仅文件图标使用） */
  bg: string
  /** 内部 SVG 标记（24×24 坐标系） */
  glyph: string
}

/* ==================== 公共 SVG 片段 ==================== */

/** 文本字形公共属性 */
const TXT = 'font-family="Segoe UI, Arial, sans-serif" font-weight="700"'

/** 白色描边公共属性 */
const STROKE =
  'fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'

/**
 * 以文本形式生成字形（自动水平居中）。
 * @param text 显示文本（如 "TS"、"PDF"）
 * @param fontSize 字号（24×24 坐标系内）
 * @param color 文本颜色，默认白色
 */
function textGlyph(text: string, fontSize: number, color = '#FFFFFF'): string {
  const x = ((24 - text.length * fontSize * 0.6) / 2).toFixed(1)
  const y = (12.6 + fontSize * 0.36).toFixed(1)
  return `<text x="${x}" y="${y}" font-size="${fontSize}" ${TXT} fill="${color}">${text}</text>`
}

/** 快速构造文件图标定义 */
const def = (type: string, bg: string, glyph: string): FileIconDef => ({ type, bg, glyph, folder: false })

/* ==================== 各类型字形 ==================== */

/** Markdown：官方 "M↓" 徽标 */
const GLYPH_MARKDOWN = `
  <text x="3" y="16.9" font-size="13.5" ${TXT} fill="#FFFFFF">M</text>
  <path d="M15.8 8.4 v4.5" ${STROKE}/>
  <path d="M13.9 11.6 l1.9 1.9 1.9 -1.9" ${STROKE}/>
`

/** JavaScript：字母徽标 */
const GLYPH_JS = textGlyph('JS', 12.5, '#1E293B')

/** TypeScript：字母徽标 */
const GLYPH_TS = textGlyph('TS', 12.5)

/** Vue：V 字徽标 */
const GLYPH_VUE = '<path d="M4.2 5.6 L12 19.2 L19.8 5.6 H15.9 L12 12.6 L8.1 5.6 Z" fill="#FFFFFF"/>'

/** HTML5 / XML：尖括号 */
const GLYPH_TAG = textGlyph('</>', 10.5)

/** CSS / C#：# 字形 */
const GLYPH_HASH = `
  <path d="M9.6 5.2 L8.4 18.8" ${STROKE}/>
  <path d="M15.6 5.2 L14.4 18.8" ${STROKE}/>
  <path d="M5 9.7 L19 8.4" ${STROKE}/>
  <path d="M5 15.6 L19 14.3" ${STROKE}/>
`

/** JSON：花括号 */
const GLYPH_JSON = textGlyph('{}', 13, '#1E293B')

/** 配置：调节滑块 */
const GLYPH_CONFIG = `
  <path d="M4.5 7 H19.5" ${STROKE}/>
  <circle cx="9" cy="7" r="2.4" fill="#4A5568" stroke="#FFFFFF" stroke-width="1.6"/>
  <path d="M4.5 12.5 H19.5" ${STROKE}/>
  <circle cx="15.5" cy="12.5" r="2.4" fill="#4A5568" stroke="#FFFFFF" stroke-width="1.6"/>
  <path d="M4.5 18 H19.5" ${STROKE}/>
  <circle cx="7.5" cy="18" r="2.4" fill="#4A5568" stroke="#FFFFFF" stroke-width="1.6"/>
`

/** Java：咖啡杯 */
const GLYPH_JAVA = `
  <path d="M6.6 9.2 h10.8 v4.4 a5.4 5.4 0 0 1 -10.8 0 Z" ${STROKE}/>
  <path d="M17.4 10.6 h1.2 a2.1 2.1 0 0 1 0 4.2 h-1.2" ${STROKE}/>
  <path d="M8.6 6.4 q0.9 -1.1 0 -2.3" ${STROKE}/>
  <path d="M12.6 6.4 q0.9 -1.1 0 -2.3" ${STROKE}/>
  <path d="M16.2 6.4 q0.9 -1.1 0 -2.3" ${STROKE}/>
`

/** Ruby：宝石 */
const GLYPH_RUBY = `
  <path d="M7.2 4.6 h9.6 l3.6 5.4 L12 19.8 3.6 10 Z" ${STROKE}/>
  <path d="M7.2 4.6 L12 19.8 L16.8 4.6 M7.2 4.6 L20.4 10 H3.6" ${STROKE}/>
`

/** Shell：终端提示符 */
const GLYPH_SHELL = `
  <path d="M6 8.6 l3.4 3.4 L6 15.4" ${STROKE}/>
  <path d="M14.5 15.4 H18" ${STROKE}/>
`

/** SQL：数据库圆柱 */
const GLYPH_SQL = `
  <ellipse cx="12" cy="6.4" rx="5.2" ry="2" ${STROKE}/>
  <path d="M6.8 6.4 v8.4 a5.2 2 0 0 0 10.4 0 V6.4" ${STROKE}/>
  <path d="M6.8 10.6 a5.2 2 0 0 0 10.4 0" ${STROKE}/>
`

/** 图片：相框 + 山 + 太阳 */
const GLYPH_IMAGE = `
  <rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2" ${STROKE}/>
  <path d="M4.6 16.6 l4.4 -4.6 3.1 3.1 2.7 -2.9 5 4.4" ${STROKE}/>
  <circle cx="16" cy="8.6" r="1.3" fill="#FFFFFF"/>
`

/** 文本文档：页 + 横线 */
const GLYPH_TEXT = `
  <path d="M7.6 4.5 h6 l4 4 v11 H7.6 Z" ${STROKE}/>
  <path d="M10.4 10.8 h4.4 M10.4 13.2 h4.4 M10.4 15.6 h3" ${STROKE}/>
`

/** 通用文件：折角文档 */
const GLYPH_GENERIC = `
  <path d="M7.6 4.5 h6 l4 4 v11 H7.6 Z" ${STROKE}/>
  <path d="M13.6 4.5 v4 h4" ${STROKE}/>
`

/** 电子书：摊开的书 */
const GLYPH_BOOK = `
  <path d="M4.2 6.2 a2.2 2.2 0 0 1 2.2 -2.2 H12 v13.6 H6.4 a2.2 2.2 0 0 1 -2.2 -2.2 Z" ${STROKE}/>
  <path d="M19.8 6.2 a2.2 2.2 0 0 0 -2.2 -2.2 H12 v13.6 h5.6 a2.2 2.2 0 0 0 2.2 -2.2 Z" ${STROKE}/>
`

/** 压缩包：带拉链的箱子 */
const GLYPH_ARCHIVE = `
  <path d="M4.2 9.4 h15.6 v8.6 a1.5 1.5 0 0 1 -1.5 1.5 H5.7 a1.5 1.5 0 0 1 -1.5 -1.5 Z" ${STROKE}/>
  <path d="M4.2 9.4 L7.6 5.6 h8.8 l3.4 3.8" ${STROKE}/>
  <path d="M11 9.4 v6.4" ${STROKE}/>
`

/** 音频：音符 */
const GLYPH_AUDIO = `
  <path d="M9.8 16.6 V7.8 l7.4 -1.7 v8.6" ${STROKE}/>
  <ellipse cx="7.8" cy="16.8" rx="2.2" ry="1.7" ${STROKE}/>
  <ellipse cx="15.2" cy="14.9" rx="2.2" ry="1.7" ${STROKE}/>
`

/** 视频：圆角框 + 播放键 */
const GLYPH_VIDEO = `
  <rect x="3.8" y="6" width="16.4" height="12" rx="2.5" ${STROKE}/>
  <path d="M10.4 9.2 l4.4 2.8 -4.4 2.8 Z" fill="#FFFFFF"/>
`

/** 安装程序：下载进托盘 */
const GLYPH_INSTALL = `
  <path d="M12 3.8 v7.6" ${STROKE}/>
  <path d="M9.2 8.4 l2.8 2.8 2.8 -2.8" ${STROKE}/>
  <path d="M5 13.6 v3.4 a1.6 1.6 0 0 0 1.6 1.6 h10.8 a1.6 1.6 0 0 0 1.6 -1.6 v-3.4" ${STROKE}/>
`

/** Git：分支 */
const GLYPH_GIT = `
  <circle cx="7.5" cy="5.5" r="2.2" ${STROKE}/>
  <circle cx="15.5" cy="17.5" r="2.2" ${STROKE}/>
  <path d="M7.5 7.7 v3.1 a3.8 3.8 0 0 0 3.8 3.8 h4.2" ${STROKE}/>
`

/** 密钥 / 证书：挂锁 */
const GLYPH_LOCK = `
  <rect x="7.2" y="10.6" width="9.6" height="7.6" rx="1.8" ${STROKE}/>
  <path d="M9.6 10.6 V8.8 a2.4 2.4 0 0 1 4.8 0 v1.8" ${STROKE}/>
  <circle cx="12" cy="14.2" r="1.1" fill="#FFFFFF"/>
`

/* ==================== 字母徽标字形 ==================== */

const GLYPH_PDF = textGlyph('PDF', 9.5)
const GLYPH_W = textGlyph('W', 12.5)
const GLYPH_X = textGlyph('X', 12.5)
const GLYPH_P = textGlyph('P', 12.5)
const GLYPH_S = textGlyph('S', 12)
const GLYPH_L = textGlyph('L', 12)
const GLYPH_PY = textGlyph('Py', 11)
const GLYPH_C = textGlyph('C', 13)
const GLYPH_CPP = textGlyph('C++', 9.5)
const GLYPH_GO = textGlyph('Go', 11)
const GLYPH_RS = textGlyph('Rs', 11.5)
const GLYPH_PHP = textGlyph('PHP', 9)
const GLYPH_FONT = textGlyph('Aa', 11.5)
const GLYPH_DOCKER = textGlyph('D', 12)

/* ==================== 图标规则 ==================== */

interface IconRule {
  exts: string[]
  def: FileIconDef
}

interface NameRule {
  /** 文件名匹配（已转小写） */
  test: (name: string) => boolean
  def: FileIconDef
}

/** 按扩展名匹配的图标规则（顺序无影响，最终按 Map 索引） */
const ICON_RULES: IconRule[] = [
  // —— 文档 ——
  { exts: ['md', 'markdown', 'mdown', 'mkd'], def: def('markdown', '#24292F', GLYPH_MARKDOWN) },
  // 白板草图（Excalidraw 手绘紫）
  { exts: ['board', 'excalidraw'], def: def('whiteboard', '#6965DB', textGlyph('Bo', 10.5)) },
  { exts: ['txt', 'log', 'rtf', 'text'], def: def('text', '#64748B', GLYPH_TEXT) },
  { exts: ['pdf'], def: def('pdf', '#E53935', GLYPH_PDF) },
  // —— Office / 电子书 ——
  { exts: ['doc', 'docx', 'docm'], def: def('word', '#2B579A', GLYPH_W) },
  { exts: ['xls', 'xlsx', 'xlsm', 'xlsb', 'csv'], def: def('excel', '#217346', GLYPH_X) },
  { exts: ['ppt', 'pptx', 'pps', 'pot', 'pptm', 'ppsx', 'ppsm'], def: def('ppt', '#D24726', GLYPH_P) },
  { exts: ['epub', 'mobi', 'azw3', 'fb2'], def: def('ebook', '#409EFF', GLYPH_BOOK) },
  // —— 前端代码 ——
  { exts: ['js', 'mjs', 'cjs', 'jsx'], def: def('js', '#F7DF1E', GLYPH_JS) },
  { exts: ['ts', 'tsx', 'mts', 'cts'], def: def('ts', '#3178C6', GLYPH_TS) },
  { exts: ['vue'], def: def('vue', '#42B883', GLYPH_VUE) },
  { exts: ['html', 'htm'], def: def('html', '#E44D26', GLYPH_TAG) },
  { exts: ['css'], def: def('css', '#1572B6', GLYPH_HASH) },
  { exts: ['scss', 'sass'], def: def('scss', '#CD6799', GLYPH_S) },
  { exts: ['less'], def: def('less', '#1D365D', GLYPH_L) },
  // —— 后端 / 脚本代码 ——
  { exts: ['py', 'pyw'], def: def('python', '#3776AB', GLYPH_PY) },
  { exts: ['java', 'jsp'], def: def('java', '#E76F00', GLYPH_JAVA) },
  { exts: ['c', 'h'], def: def('c', '#00599C', GLYPH_C) },
  { exts: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], def: def('cpp', '#00599C', GLYPH_CPP) },
  { exts: ['cs'], def: def('csharp', '#68217A', GLYPH_HASH) },
  { exts: ['go'], def: def('go', '#00ADD8', GLYPH_GO) },
  { exts: ['rs'], def: def('rust', '#CE422B', GLYPH_RS) },
  { exts: ['php'], def: def('php', '#777BB4', GLYPH_PHP) },
  { exts: ['rb', 'rake'], def: def('ruby', '#CC342D', GLYPH_RUBY) },
  { exts: ['sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1'], def: def('shell', '#3E3E3E', GLYPH_SHELL) },
  { exts: ['kt', 'kts'], def: def('kotlin', '#7F52FF', textGlyph('Kt', 10)) },
  { exts: ['swift'], def: def('swift', '#F05138', textGlyph('Sw', 10)) },
  { exts: ['dart'], def: def('dart', '#00B4AB', textGlyph('Da', 10)) },
  { exts: ['lua'], def: def('lua', '#00007C', textGlyph('Lu', 10)) },
  { exts: ['r', 'rmd'], def: def('r', '#276DC3', textGlyph('R', 12)) },
  { exts: ['pl', 'pm'], def: def('perl', '#0298C3', textGlyph('Pl', 10)) },
  { exts: ['ex', 'exs'], def: def('elixir', '#4B275F', textGlyph('Ex', 10)) },
  { exts: ['erl', 'hrl'], def: def('erlang', '#A90533', textGlyph('Er', 10)) },
  { exts: ['scala'], def: def('scala', '#DC322F', textGlyph('Sc', 10)) },
  { exts: ['groovy', 'gradle'], def: def('groovy', '#4298B8', textGlyph('Gr', 10)) },
  { exts: ['hs'], def: def('haskell', '#5E5086', textGlyph('Hs', 10)) },
  // —— 数据 / 配置 ——
  { exts: ['json'], def: def('json', '#F9A825', GLYPH_JSON) },
  { exts: ['xml', 'xaml'], def: def('xml', '#5C6BC0', GLYPH_TAG) },
  { exts: ['sql', 'db', 'sqlite', 'sqlite3'], def: def('sql', '#F59E0B', GLYPH_SQL) },
  {
    exts: ['yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env', 'editorconfig', 'prettierrc', 'eslintrc'],
    def: def('config', '#4A5568', GLYPH_CONFIG),
  },
  // —— 媒体 ——
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff', 'heic'], def: def('image', '#00BFA5', GLYPH_IMAGE) },
  { exts: ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'wma', 'opus'], def: def('audio', '#EC4899', GLYPH_AUDIO) },
  { exts: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'm2ts'], def: def('video', '#F97316', GLYPH_VIDEO) },
  // —— 打包 / 安装 / 安全 ——
  { exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'tgz'], def: def('archive', '#B45309', GLYPH_ARCHIVE) },
  { exts: ['exe', 'msi', 'appx', 'apk', 'dmg', 'deb', 'rpm'], def: def('installer', '#64748B', GLYPH_INSTALL) },
  { exts: ['pem', 'key', 'crt', 'cer', 'pub', 'p12'], def: def('security', '#0EA5E9', GLYPH_LOCK) },
  // —— 字体 / 版本控制 ——
  { exts: ['ttf', 'otf', 'woff', 'woff2', 'eot'], def: def('font', '#8E44AD', GLYPH_FONT) },
  { exts: ['gitignore', 'gitattributes', 'gitmodules', 'gitkeep'], def: def('git', '#F05033', GLYPH_GIT) },
]

/** 按文件名（而非扩展名）识别的特殊文件 */
const NAME_RULES: NameRule[] = [
  { test: (n) => /^dockerfile/.test(n), def: def('docker', '#2496ED', GLYPH_DOCKER) },
  { test: (n) => /^makefile/.test(n), def: def('makefile', '#7C3AED', textGlyph('Mk', 10)) },
  { test: (n) => /^readme/.test(n), def: def('readme', '#0EA5E9', GLYPH_TEXT) },
  { test: (n) => /^license/.test(n), def: def('license', '#10B981', GLYPH_TEXT) },
  { test: (n) => /^changelog/.test(n), def: def('changelog', '#8B5CF6', GLYPH_TEXT) },
  { test: (n) => n.startsWith('.git'), def: def('git', '#F05033', GLYPH_GIT) },
]

/** 通用文件回退图标 */
const DEFAULT_FILE = def('file', '#94A3B8', GLYPH_GENERIC)

/** 按扩展名索引的图标映射表 */
const RULE_MAP = new Map<string, FileIconDef>()
for (const rule of ICON_RULES) {
  for (const ext of rule.exts) RULE_MAP.set(ext, rule.def)
}

/** 文件夹图标（收起状态） */
const FOLDER_CLOSED: FileIconDef = {
  type: 'folder',
  folder: true,
  bg: '',
  glyph:
    '<path d="M3.6 8 V7.3 a1.8 1.8 0 0 1 1.8 -1.8 h3.9 l1.9 1.9 h7.4 a1.8 1.8 0 0 1 1.8 1.8 v7.5 a1.8 1.8 0 0 1 -1.8 1.8 H5.4 a1.8 1.8 0 0 1 -1.8 -1.8 Z" fill="#E6A23C"/>',
}

/** 文件夹图标（展开状态：双层开口） */
const FOLDER_OPENED: FileIconDef = {
  type: 'folder-open',
  folder: true,
  bg: '',
  glyph: [
    '<path d="M3.6 7.6 V7.2 a1.8 1.8 0 0 1 1.8 -1.8 h3.9 l1.9 1.9 h7.4 a1.8 1.8 0 0 1 1.8 1.8 v1.7 H9.3 a2 2 0 0 0 -1.9 1.4 l-1.9 5.7 a1.6 1.6 0 0 1 -1.55 1.1 H4.4 a1.6 1.6 0 0 1 -1.6 -2.1 Z" fill="#C98A2B"/>',
    '<path d="M4.6 11.8 H18.4 a0.8 0.8 0 0 1 0.78 1 l-1.4 5.5 a1.8 1.8 0 0 1 -1.75 1.4 H6.6 a1.8 1.8 0 0 1 -1.74 -1.4 L3.4 12.8 a0.8 0.8 0 0 1 0.77 -1 Z" fill="#E6A23C"/>',
  ].join(''),
}

/**
 * 获取文件图标定义。
 * @param ext 扩展名（可带点号，大小写不敏感）
 * @param name 文件名（用于识别 Dockerfile / README 等按名称区分的文件）
 */
export function getFileIconDef(ext: string, name = ''): FileIconDef {
  const key = String(ext || '').toLowerCase().replace(/^\./, '')
  const matched = RULE_MAP.get(key)
  if (matched) return matched
  const lower = String(name || '').toLowerCase()
  if (lower) {
    for (const rule of NAME_RULES) {
      if (rule.test(lower)) return rule.def
    }
  }
  return DEFAULT_FILE
}

/**
 * 获取文件夹图标定义（按展开状态切换）。
 * @param expanded 目录是否处于展开状态
 */
export function getFolderIconDef(expanded: boolean): FileIconDef {
  return expanded ? FOLDER_OPENED : FOLDER_CLOSED
}
