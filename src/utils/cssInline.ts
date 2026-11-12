/**
 * 极简 CSS 内联器：把「类/标签选择器写的主题样式」压成每个元素的 style 属性。
 *
 * 为什么不用 juice：
 * - juice 依赖 cheerio/commander，进渲染进程要额外打包与 node polyfill；
 * - 我们的主题 CSS 是自己写的子集（#md-root 前缀 + 简单选择器），
 *   用 querySelectorAll 直接匹配反而更可控，且能顺手处理 :first-child 这类伪类。
 *
 * 不支持的写法（会被跳过）：@media / @keyframes、::before / ::after、
 * :hover / :focus / :active / :visited 等交互态伪类。
 */

/** CSS 变量引用 */
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g

/** 无法内联、直接跳过的选择器特征 */
const SKIP_SELECTOR_RE =
  /::|:(?:hover|focus|focus-within|focus-visible|active|visited|link|target|first-line|first-letter|selection|placeholder|before|after)\b/i

interface CssRule {
  selector: string
  decls: Array<[string, string]>
}

/** 内联结果统计（便于排查主题不生效） */
export interface InlineStats {
  /** 解析出的规则数 */
  rules: number
  /** 应用到的元素次数 */
  applied: number
  /** 被跳过的选择器数 */
  skipped: number
  /** 因变量缺失被丢弃的声明数 */
  dropped: number
}

/** 解析样式表为规则列表（已剥离注释与 @ 块） */
function parseRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const len = text.length
  let i = 0

  while (i < len) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const selector = text.slice(i, open).trim()

    // 找到配对的右大括号（支持嵌套，如 @media）
    let depth = 1
    let j = open + 1
    while (j < len && depth > 0) {
      const ch = text[j]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)

    // @media / @font-face / @keyframes 等整块跳过
    if (selector && !selector.startsWith('@')) {
      rules.push({ selector, decls: parseDecls(body) })
    }
    i = j
  }

  return rules
}

/** 解析声明块 */
function parseDecls(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  // 只按分号切分：主题 CSS 里不含 url(data:...;base64,) 这类带分号的值
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const rawProp = part.slice(0, idx).trim()
    if (!rawProp) continue
    const prop = rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase()
    const value = part
      .slice(idx + 1)
      .trim()
      .replace(/\s*!important\s*$/i, '')
    if (!value) continue
    out.push([prop, value])
  }
  return out
}

/** 递归替换 var() 引用；无法解析时返回 null（表示丢弃该声明） */
function resolveVars(value: string, vars: Map<string, string>): string | null {
  let out = value
  for (let round = 0; round < 5; round++) {
    if (!out.includes('var(')) return out
    let changed = false
    out = out.replace(VAR_RE, (_match, name: string, fallback?: string) => {
      const hit = vars.get(name)
      if (hit !== undefined) {
        changed = true
        return hit
      }
      if (fallback !== undefined) {
        changed = true
        return fallback.trim()
      }
      return _match
    })
    if (!changed) break
  }
  return out.includes('var(') ? null : out
}

/**
 * 把 CSS 文本里的 var() 引用全部解析成字面值（不触碰 DOM）。
 *
 * juice.inlineContent 不解析 CSS 变量，而公众号编辑器不支持 var()，
 * 所以交给 juice 之前先做一轮文本级变量替换。
 */
export function resolveCssVars(
  css: string,
  initialVars: Record<string, string> = {},
): string {
  const rules = parseRules(css)
  const vars = new Map<string, string>(Object.entries(initialVars))

  // 先收集全部变量定义（后出现覆盖先出现），再解析变量之间的相互引用
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) {
      if (prop.startsWith('--')) vars.set(prop, value)
    }
  }
  for (const [name, value] of vars) {
    const resolved = resolveVars(value, vars)
    if (resolved !== null) vars.set(name, resolved)
  }

  const lines: string[] = []
  for (const rule of rules) {
    const decls: string[] = []
    for (const [prop, value] of rule.decls) {
      if (prop.startsWith('--')) continue
      const resolved = resolveVars(value, vars)
      if (resolved === null) continue
      decls.push(`${prop}: ${resolved}`)
    }
    if (decls.length) lines.push(`${rule.selector} { ${decls.join('; ')}; }`)
  }
  return lines.join('\n')
}

/**
 * 把 CSS 内联到 root 及其子孙元素。
 *
 * @param root 内容根节点（约定 id 为 md-root，也可不设：选择器里的 #md-root 会被剥离）
 * @param css 样式文本（建议「基线 + 主题 + 扩展 + 代码高亮 + 收尾」拼成一段传入，
 *            这样变量收集一次完成，后面的规则能覆盖前面的）
 * @param initialVars 初始变量表（如代码主题的 --code-bg）
 */
export function inlineStyles(
  root: HTMLElement,
  css: string,
  initialVars: Record<string, string> = {},
): InlineStats {
  const rules = parseRules(css)
  const vars = new Map<string, string>(Object.entries(initialVars))
  const stats: InlineStats = { rules: rules.length, applied: 0, skipped: 0, dropped: 0 }

  // 第一遍：收集变量（后出现的覆盖先出现的，主题因而能覆盖基线默认值）
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) {
      if (prop.startsWith('--')) vars.set(prop, value)
    }
  }

  // 第二遍：逐条规则匹配并写入 style
  for (const rule of rules) {
    for (const rawSelector of rule.selector.split(',')) {
      const selector = rawSelector.trim()
      if (!selector) continue
      if (SKIP_SELECTOR_RE.test(selector)) {
        stats.skipped++
        continue
      }

      // 子选择器降级为后代选择器（微信不认 >，内联后也无需精确层级）
      let query = selector.replace(/\s*>\s*/g, ' ')
      const hasRootPrefix = query.includes('#md-root')
      if (hasRootPrefix) query = query.replace(/#md-root/g, ' ').trim()

      let elements: Element[]
      if (!query) {
        elements = [root]
      } else if (!hasRootPrefix && !/^[a-zA-Z#.\[]/.test(query)) {
        continue
      } else {
        try {
          elements = Array.from(root.querySelectorAll(query))
        } catch {
          // 非法选择器（如 :is() 组合）直接跳过，不影响其它规则
          stats.skipped++
          continue
        }
      }
      if (!elements.length) continue

      for (const el of elements) {
        const style = (el as HTMLElement).style
        if (!style) continue
        for (const [prop, value] of rule.decls) {
          if (prop.startsWith('--')) continue
          const resolved = resolveVars(value, vars)
          if (resolved === null) {
            stats.dropped++
            continue
          }
          try {
            style.setProperty(prop, resolved)
          } catch {
            /* 个别属性名不合法时忽略 */
          }
          stats.applied++
        }
      }
    }
  }

  return stats
}
