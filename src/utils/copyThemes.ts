/**
 * 富文本复制主题（公众号 / 知乎 / 掘金）。
 *
 * 设计约束（微信编辑器限制）：
 * 1. 最终由 juice.inlineContent 压成 style 属性，微信会过滤 <style> / class / id 选择器；
 * 2. 不支持 CSS 变量 → 由 cssInline.ts#resolveCssVars 在 juice 之前把 var() 解析成字面值；
 * 3. 伪元素装饰由 juice 的 inlinePseudoElements 转成真实节点，仍建议优先用 border / background；
 * 4. 正文宽度上限约 677px，图片用 max-width:100% 自适应。
 *
 * 因此这里只用「#md-root + 简单选择器」编写，颜色统一走 CSS 变量，
 * 主题之间只差变量值与少量标题装饰。
 */

/** 单个复制主题 */
export interface CopyTheme {
  /** 主题标识（持久化到 localStorage） */
  key: string
  /** 显示名称 */
  label: string
  /** 主色（用于主题卡片色块） */
  primary: string
  /** 卡片背景色（长图导出底色同源） */
  background: string
  /** 主题差异样式（颜色变量 + 标题装饰） */
  css: string
}

/**
 * 结构基线样式：所有主题共用。
 * 只描述排版结构，颜色全部取自变量，便于主题覆盖。
 */
export const COPY_BASE_CSS = `
#md-root {
  --md-text: #333333;
  --md-heading: #1a1a1a;
  --md-primary: #3f6fd8;
  --md-primary-weak: #eef3fd;
  --md-border: #e8e8ec;
  --md-quote-bg: #f7f8fa;
  --md-quote-text: #666666;
  --md-inline-code-bg: #f2f3f5;
  --md-inline-code-text: #c7254e;
  --md-link: #3f6fd8;
  --md-strong: #1a1a1a;
  --md-bg: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.8;
  letter-spacing: 0.02em;
  color: var(--md-text);
  background: var(--md-bg);
  word-break: break-word;
  text-align: left;
}
#md-root h1,
#md-root h2,
#md-root h3,
#md-root h4,
#md-root h5,
#md-root h6 {
  color: var(--md-heading);
  font-weight: 700;
  line-height: 1.4;
  margin: 28px 0 16px;
}
#md-root h1 { font-size: 24px; padding-bottom: 10px; border-bottom: 2px solid var(--md-primary); }
#md-root h2 { font-size: 20px; padding-bottom: 6px; border-bottom: 1px solid var(--md-primary-weak); }
#md-root h3 { font-size: 17px; }
#md-root h4 { font-size: 16px; }
#md-root h5,
#md-root h6 { font-size: 15px; }
#md-root p { margin: 0 0 16px; line-height: 1.8; }
#md-root ul,
#md-root ol { margin: 0 0 16px; padding-left: 24px; }
#md-root li { margin: 6px 0; line-height: 1.75; }
#md-root li > p { margin: 0 0 6px; }
#md-root a {
  color: var(--md-link);
  text-decoration: none;
  border-bottom: 1px solid var(--md-link);
  word-break: break-all;
}
#md-root strong { color: var(--md-strong); font-weight: 700; }
#md-root em { font-style: italic; }
#md-root hr {
  border: none;
  border-top: 1px dashed var(--md-border);
  margin: 28px 0;
}
#md-root blockquote {
  margin: 18px 0;
  padding: 12px 16px;
  background: var(--md-quote-bg);
  border-left: 4px solid var(--md-primary);
  border-radius: 0 6px 6px 0;
  color: var(--md-quote-text);
}
#md-root blockquote p { margin: 0 0 10px; }
#md-root blockquote p:last-child { margin-bottom: 0; }
#md-root img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  vertical-align: middle;
}
#md-root figure { margin: 18px 0; text-align: center; }
#md-root figcaption { margin-top: 6px; font-size: 13px; color: #999999; }
#md-root table {
  width: 100%;
  margin: 18px 0;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: auto;
}
#md-root th {
  background: var(--md-primary-weak);
  color: var(--md-heading);
  font-weight: 600;
  border: 1px solid var(--md-border);
  padding: 8px 12px;
  text-align: left;
}
#md-root td {
  border: 1px solid var(--md-border);
  padding: 8px 12px;
  vertical-align: top;
}
#md-root code {
  font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 0.9em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--md-inline-code-bg);
  color: var(--md-inline-code-text);
  word-break: break-all;
}
#md-root pre {
  margin: 18px 0;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--code-bg, #f6f8fa);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-all;
}
#md-root pre code {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-all;
}
#md-root .code-block-wrapper { margin: 18px 0; }
#md-root .code-block-wrapper pre { margin: 0; }
#md-root .task-list-item { list-style: none; margin-left: -20px; }
#md-root .math-block,
#md-root .katex-display { margin: 18px 0; text-align: center; }
#md-root svg { max-width: 100%; height: auto; }
`

/**
 * 收尾样式：放在所有样式（含代码高亮主题）之后，
 * 修掉 highlight.js 主题带来的布局属性，只保留配色。
 */
export const COPY_FINAL_CSS = `
#md-root pre { margin: 18px 0; padding: 14px 16px; border-radius: 8px; }
#md-root pre code { padding: 0; background: transparent; }
#md-root .code-block-wrapper pre { margin: 0; border-radius: 8px; }
`

/** 主题列表（首版 12 套，颜色体系参考常见公众号排版风格） */
export const COPY_THEMES: CopyTheme[] = [
  {
    key: 'default',
    label: '默认',
    primary: '#3f6fd8',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #333333;
  --md-heading: #1a1a1a;
  --md-primary: #3f6fd8;
  --md-primary-weak: #eef3fd;
  --md-border: #e8e8ec;
  --md-quote-bg: #f7f8fa;
  --md-quote-text: #666666;
  --md-link: #3f6fd8;
  --md-strong: #1a1a1a;
  --md-inline-code-bg: #f2f3f5;
  --md-inline-code-text: #c7254e;
}`,
  },
  {
    key: 'olive',
    label: '橄榄绿',
    primary: '#4a7c59',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #3d4a41;
  --md-heading: #2f4a3a;
  --md-primary: #4a7c59;
  --md-primary-weak: #eef4ef;
  --md-border: #dbe6dd;
  --md-quote-bg: #f3f7f3;
  --md-quote-text: #55665a;
  --md-link: #4a7c59;
  --md-strong: #2f4a3a;
  --md-inline-code-bg: #f0f5f0;
  --md-inline-code-text: #4a7c59;
}
#md-root h1 { border-bottom: 2px solid var(--md-primary); }
#md-root h2 {
  border-bottom: none;
  border-left: 4px solid var(--md-primary);
  padding: 2px 0 2px 10px;
  background: var(--md-primary-weak);
}`,
  },
  {
    key: 'orange',
    label: '橙心',
    primary: '#e07a3f',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #3a3226;
  --md-heading: #8a4b1f;
  --md-primary: #e07a3f;
  --md-primary-weak: #fdf1e8;
  --md-border: #f0e2d5;
  --md-quote-bg: #fdf7f2;
  --md-quote-text: #7a6553;
  --md-link: #d2691e;
  --md-strong: #8a4b1f;
  --md-inline-code-bg: #fdf1e8;
  --md-inline-code-text: #c05621;
}
#md-root h1 { border-bottom: 3px solid var(--md-primary); }
#md-root h2 {
  border-bottom: 1px dashed var(--md-primary);
  border-left: 4px solid var(--md-primary);
  padding-left: 10px;
}`,
  },
  {
    key: 'dark',
    label: '暗夜',
    primary: '#7aa2f7',
    background: '#1f2126',
    css: `
#md-root {
  --md-text: #c9ccd1;
  --md-heading: #ffffff;
  --md-primary: #7aa2f7;
  --md-primary-weak: #262a33;
  --md-border: #3a3f4b;
  --md-quote-bg: #262a33;
  --md-quote-text: #a8adb7;
  --md-link: #7aa2f7;
  --md-strong: #ffffff;
  --md-bg: #1f2126;
  --md-inline-code-bg: #2c313a;
  --md-inline-code-text: #ff9d7a;
}
#md-root h1 { border-bottom: 2px solid var(--md-border); }
#md-root h2 {
  border-bottom: none;
  border-left: 4px solid var(--md-primary);
  padding-left: 10px;
}
#md-root th { background: #262a33; }`,
  },
  {
    key: 'sakura',
    label: '樱花粉',
    primary: '#e77c96',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #4a3b40;
  --md-heading: #7a3b52;
  --md-primary: #e77c96;
  --md-primary-weak: #fdf1f4;
  --md-border: #f3dbe2;
  --md-quote-bg: #fdf5f7;
  --md-quote-text: #80636c;
  --md-link: #d3607f;
  --md-strong: #7a3b52;
  --md-inline-code-bg: #fdf1f4;
  --md-inline-code-text: #c9456b;
}
#md-root h1 { text-align: center; border-bottom: none; }
#md-root h2 {
  border-bottom: 1px dashed var(--md-primary);
  text-align: center;
}`,
  },
  {
    key: 'ocean',
    label: '海盐蓝',
    primary: '#3d7ea6',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #2f3c45;
  --md-heading: #1f4a63;
  --md-primary: #3d7ea6;
  --md-primary-weak: #eef5fa;
  --md-border: #d8e6ef;
  --md-quote-bg: #f3f9fc;
  --md-quote-text: #54707f;
  --md-link: #2f7fa8;
  --md-strong: #1f4a63;
  --md-inline-code-bg: #eef5fa;
  --md-inline-code-text: #2c6f96;
}
#md-root h2 {
  border-bottom: none;
  border-left: 5px solid var(--md-primary);
  padding-left: 10px;
}`,
  },
  {
    key: 'grape',
    label: '葡萄紫',
    primary: '#7c5cbf',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #3d3648;
  --md-heading: #3f2f5c;
  --md-primary: #7c5cbf;
  --md-primary-weak: #f3effb;
  --md-border: #e2d9f3;
  --md-quote-bg: #f8f5fd;
  --md-quote-text: #6a5f7d;
  --md-link: #6f4fae;
  --md-strong: #3f2f5c;
  --md-inline-code-bg: #f3effb;
  --md-inline-code-text: #6f4fae;
}
#md-root h2 {
  border-bottom: none;
  border-left: 4px solid var(--md-primary);
  padding: 2px 0 2px 10px;
  background: var(--md-primary-weak);
  border-radius: 0 4px 4px 0;
}`,
  },
  {
    key: 'forest',
    label: '森林绿',
    primary: '#2f7a53',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #33402f;
  --md-heading: #24431f;
  --md-primary: #2f7a53;
  --md-primary-weak: #edf6f0;
  --md-border: #d6e8da;
  --md-quote-bg: #f2f9f4;
  --md-quote-text: #55705c;
  --md-link: #2f7a53;
  --md-strong: #24431f;
  --md-inline-code-bg: #edf6f0;
  --md-inline-code-text: #2f7a53;
}
#md-root h2 {
  border-bottom: 3px solid var(--md-primary-weak);
  padding-bottom: 8px;
}`,
  },
  {
    key: 'crimson',
    label: '赤霞红',
    primary: '#c0392b',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #432b2b;
  --md-heading: #6b1f1f;
  --md-primary: #c0392b;
  --md-primary-weak: #fdeeec;
  --md-border: #f0d5d1;
  --md-quote-bg: #fdf6f5;
  --md-quote-text: #7d5b58;
  --md-link: #c0392b;
  --md-strong: #6b1f1f;
  --md-inline-code-bg: #fdeeec;
  --md-inline-code-text: #b03024;
}
#md-root h1 { border-bottom: 3px double var(--md-primary); }
#md-root h2 {
  border-bottom: none;
  border-left: 4px solid var(--md-primary);
  padding-left: 10px;
}`,
  },
  {
    key: 'sunny',
    label: '暖阳黄',
    primary: '#d69e2e',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #423a26;
  --md-heading: #6b5312;
  --md-primary: #d69e2e;
  --md-primary-weak: #fdf6e3;
  --md-border: #efe2c2;
  --md-quote-bg: #fdfaf0;
  --md-quote-text: #7a6a45;
  --md-link: #c08a1e;
  --md-strong: #6b5312;
  --md-inline-code-bg: #fdf6e3;
  --md-inline-code-text: #b07d12;
}
#md-root h2 {
  border-bottom: none;
  border-left: 6px solid var(--md-primary);
  padding: 2px 0 2px 10px;
}`,
  },
  {
    key: 'minimal',
    label: '极简灰',
    primary: '#4a4a4a',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #333333;
  --md-heading: #111111;
  --md-primary: #4a4a4a;
  --md-primary-weak: #f4f4f5;
  --md-border: #e4e4e7;
  --md-quote-bg: #fafafa;
  --md-quote-text: #666666;
  --md-link: #4a4a4a;
  --md-strong: #111111;
  --md-inline-code-bg: #f4f4f5;
  --md-inline-code-text: #333333;
}
#md-root h1 { border-bottom: 1px solid var(--md-border); }
#md-root h2 { border-bottom: 1px solid var(--md-border); }
#md-root blockquote { border-left: 3px solid var(--md-border); }`,
  },
  {
    key: 'indigo',
    label: '靛青',
    primary: '#3f51b5',
    background: '#ffffff',
    css: `
#md-root {
  --md-text: #303446;
  --md-heading: #1f2557;
  --md-primary: #3f51b5;
  --md-primary-weak: #eef0fb;
  --md-border: #dadeee;
  --md-quote-bg: #f5f6fd;
  --md-quote-text: #5a5f7d;
  --md-link: #3f51b5;
  --md-strong: #1f2557;
  --md-inline-code-bg: #eef0fb;
  --md-inline-code-text: #3949ab;
}
#md-root h2 {
  border-bottom: none;
  border-left: 4px solid var(--md-primary);
  padding: 2px 0 2px 10px;
  background: var(--md-primary-weak);
}`,
  },
]

/** 默认主题 key */
export const DEFAULT_COPY_THEME = 'default'

/** 主题持久化键 */
export const COPY_THEME_STORAGE_KEY = 'md-copy-theme'

/** 按 key 取主题（找不到时回退默认主题） */
export function getCopyTheme(key: string | null | undefined): CopyTheme {
  return (
    COPY_THEMES.find((t) => t.key === key) ||
    COPY_THEMES.find((t) => t.key === DEFAULT_COPY_THEME) ||
    COPY_THEMES[0]
  )
}

/** 读取上次选择的主题 key */
export function readStoredCopyTheme(): string {
  try {
    const raw = localStorage.getItem(COPY_THEME_STORAGE_KEY)
    if (raw && COPY_THEMES.some((t) => t.key === raw)) return raw
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return DEFAULT_COPY_THEME
}

/** 记住选择的主题 key */
export function storeCopyTheme(key: string): void {
  try {
    localStorage.setItem(COPY_THEME_STORAGE_KEY, key)
  } catch {
    /* 忽略写入失败 */
  }
}

/**
 * 知乎格式的中性收尾：去掉公众号味的标题装饰，只保留层次与分隔。
 * 知乎编辑器会再套一层自己的正文样式，这里只求结构清晰。
 */
export const ZHIHU_NEUTRAL_CSS = `
#md-root h1 { border-bottom: 1px solid var(--md-border); }
#md-root h2 { border-bottom: 1px solid var(--md-border); border-left: none; background: none; padding-left: 0; }
#md-root blockquote { border-left: 3px solid var(--md-border); background: #fafafa; }
`
