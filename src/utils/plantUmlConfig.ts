/**
 * PlantUML 渲染服务配置。
 *
 * 默认使用 PlantUML 官方在线服务，也可自定义为私有化部署地址。
 * 配置持久化在 localStorage，key 为 PLANTUML_CONFIG_KEY。
 * 后续新增配置项时，在 PlantUmlConfig 接口中扩展字段即可（配置弹窗表单同步扩展）。
 *
 * @module utils/plantUmlConfig
 */

/** PlantUML 渲染服务配置 */
export interface PlantUmlConfig {
  /** 服务基础地址（不含 /svg/、/png/ 等格式后缀），默认 PlantUML 官方在线服务 */
  serverBaseUrl: string
}

const STORAGE_KEY = 'knowledge_plantuml_config'

/** 配置变更事件名（保存后派发，预览端监听并刷新已渲染的图表地址） */
export const PLANTUML_CONFIG_CHANGED_EVENT = 'plantuml-config-changed'

/** 默认配置：PlantUML 官方在线服务 */
export const DEFAULT_CONFIG: PlantUmlConfig = {
  serverBaseUrl: 'https://www.plantuml.com/plantuml',
}

/**
 * 读取 PlantUML 配置，未配置或解析失败时返回默认值。
 * @returns PlantUML 配置
 */
export function getPlantUmlConfig(): PlantUmlConfig {
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
 * 保存 PlantUML 配置到 localStorage，并派发配置变更事件，
 * 供预览中已渲染的 PlantUML 图表刷新为新的服务地址。
 * @param config PlantUML 配置
 */
export function savePlantUmlConfig(config: PlantUmlConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new CustomEvent(PLANTUML_CONFIG_CHANGED_EVENT))
}

/**
 * 获取格式化后的服务基础地址：去除末尾斜杠；为空或非法时回退默认地址。
 * @returns 服务基础地址
 */
export function getPlantUmlBaseUrl(): string {
  const url = getPlantUmlConfig().serverBaseUrl.trim().replace(/\/+$/, '')
  return url || DEFAULT_CONFIG.serverBaseUrl
}

/**
 * 拼接指定格式的渲染地址，如 `<base>/svg/<encoded>`。
 * @param encoded PlantUML 编码后的图表数据
 * @param format 渲染格式，默认 svg
 * @returns 完整渲染地址
 */
export function getPlantUmlRenderUrl(encoded: string, format: 'svg' | 'png' = 'svg'): string {
  return `${getPlantUmlBaseUrl()}/${format}/${encoded}`
}
