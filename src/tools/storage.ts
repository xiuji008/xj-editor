/** 收藏工具 id 列表的存储键 */
const FAVORITE_KEY = 'md-tools-favorites'
/** 最近使用工具 id 列表的存储键 */
const RECENT_KEY = 'md-tools-recent'
/** 最近使用最多保留的条数 */
const RECENT_MAX = 8

/**
 * 读取本地存储的字符串数组，解析失败时回退为空数组。
 *
 * @param key localStorage 键名
 * @returns 解析出的字符串数组
 */
function readList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return (Array.isArray(parsed) ? parsed : []).filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * 写入字符串数组到本地存储。
 *
 * @param key localStorage 键名
 * @param list 待写入的列表
 */
function writeList(key: string, list: string[]): void {
  localStorage.setItem(key, JSON.stringify(list))
}

/**
 * 读取收藏的工具 id 列表。
 *
 * @returns 收藏的工具 id 列表
 */
export function readFavorites(): string[] {
  return readList(FAVORITE_KEY)
}

/**
 * 判断指定工具是否已收藏。
 *
 * @param id 工具唯一标识
 * @returns 已收藏返回 true
 */
export function isFavorite(id: string): boolean {
  return readFavorites().includes(id)
}

/**
 * 切换工具的收藏状态。
 *
 * @param id 工具唯一标识
 * @returns 切换后是否为收藏状态
 */
export function toggleFavorite(id: string): boolean {
  const list = readFavorites()
  const index = list.indexOf(id)
  if (index >= 0) {
    list.splice(index, 1)
  } else {
    list.unshift(id)
  }
  writeList(FAVORITE_KEY, list)
  return index < 0
}

/**
 * 读取最近使用的工具 id 列表（按最近使用时间倒序）。
 *
 * @returns 最近使用的工具 id 列表
 */
export function readRecent(): string[] {
  return readList(RECENT_KEY)
}

/**
 * 记录一次工具使用，超出上限时淘汰最久未使用的一条。
 *
 * @param id 工具唯一标识
 */
export function pushRecent(id: string): void {
  const list = readRecent().filter((item) => item !== id)
  list.unshift(id)
  writeList(RECENT_KEY, list.slice(0, RECENT_MAX))
}
