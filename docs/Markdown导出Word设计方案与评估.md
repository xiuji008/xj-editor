# Markdown 导出 Word（.docx）设计方案与评估

> 目标：在 XJ-Editor 中把当前 Markdown 文档一键导出为 `.docx`，要求**本地完成、不联网、不依赖外部程序**，并尽量保留现有预览的视觉效果（代码高亮、表格、提示块、图表、公式、图片）。
> 本文先给出可行性结论与选型评估，再给出推荐方案的模块设计、映射规则、风险与落地节奏。

---

## 1. 结论先行

| 结论 | 说明 |
| --- | --- |
| **可行，且成本低于预期** | 关键依据是 `docx@9.11.0` 新增了 `docx/html` 子路径，提供 `htmlToContent()`：直接把 HTML（含 CSS class、`<img>`、`<table>`、`<input type=checkbox>`、MathML）转成 Word 原生段落/表格。我们已有的「Markdown → 富 HTML」管线可以整体复用，不必自研 DOM→docx 映射 |
| **推荐方案 A：docx 库 + HTML 转换器** | 复用 `renderMarkdown` + `enhanceRenderedDom` 的渲染产物，做一层「HTML 规范化」后交给 `htmlToContent`，主进程只负责写盘。预估 **4~6 人日** |
| 不推荐方案 C：HTML altChunk 包装 | 产物本质是「包着 HTML 的 docx」，WPS / LibreOffice / 在线预览兼容性差，与「真 Word 文档」目标不符 |
| 不推荐方案 D：Pandoc 等外部程序 | 需要用户安装外部二进制，违背应用「离线可用、零配置」的定位 |
| **落地节奏** | P0 核心语法与图片（2~3 人日）→ P1 图表与公式（1~2 人日）→ P2 版式与导出选项（1~2 人日） |

---

## 2. 范围界定

### 2.1 目标（P0 必须）

- Markdown 基础语法：标题、段落、列表（有序/无序/嵌套）、任务列表、表格、引用、分隔线、行内代码、加粗/斜体/删除线、链接。
- 代码块与**语法高亮**（沿用当前代码主题配色）。
- 图片：本地相对路径、`mdlocal://`、图床 `http(s)`、`data:` base64，全部**嵌入** docx。
- GitHub 提示块（`> [!NOTE]` 等）、YAML Front Matter 卡片。
- 中文排版可用（默认字体、A4 页面、合理边距）。

### 2.2 目标（P1）

- Mermaid / sequence 图表、Chart.js 图表、PlantUML 图、KaTeX 公式。

### 2.3 非目标

- docx → Markdown（已由 `electron/docConvert.cjs` + anydoc 实现，anydoc 是**单向**的，不支持反向）。
- 导出后回导、双向同步、Word 在线协同。
- 脚注（渲染管线本身不支持，全仓搜索 `footnote` 无命中）。

---

## 3. 现状：可直接复用的资产

| # | 资产 | 位置 | 对导出的价值 |
| --- | --- | --- | --- |
| 1 | `renderMarkdown(md)` 同步输出 HTML | `src/utils/markdown.ts:1012` | 导出输入源，不必重新解析 Markdown |
| 2 | `enhanceRenderedDom(el, baseName)` 异步渲染图表 | `src/utils/markdown.ts:1094` | 复用 Mermaid / Chart.js / PlantUML / KaTeX 的渲染结果 |
| 3 | `getMarkdownExtensionStyles()` 返回扩展样式 CSS 字符串 | `src/utils/markdown.ts:1409` | 直接作为 `htmlToContent` 的 `stylesheet` 入参 |
| 4 | 12 套代码高亮主题 CSS | `src/styles/code-themes/*.css`（`markdown.ts:25-26` 以 `?inline` 引入） | 代码块 class 取色来源 |
| 5 | 导出 HTML 管线（离屏取 HTML + 拼样式） | `src/App.vue:1120-1189` | UI 入口、默认文件名、交互可直接照搬 |
| 6 | 预览 DOM 真实挂载在 document 中 | `MarkdownEditor.vue:198-214`（`.preview-content > .preview-zoom-inner.markdown-body`） | 可 `getComputedStyle` / `canvas.toDataURL` / SVG 序列化 |
| 7 | 本地图片重写为 `mdlocal://local/<path>` | `MarkdownEditor.vue:482-507`、`src/utils/fileUtils.ts:100` | 导出时按此协议回读字节 |
| 8 | 主进程已有二进制写盘先例 | `main.cjs:1013-1044`（`image:saveData`，`Buffer.from(base64)`）、`dialog:exportHtml`（`main.cjs:848-857`） | 新增一个 `dialog:exportDocx` 即可 |
| 9 | 主进程已有 `net.fetch` 取远程资源先例 | `main.cjs:1201` | 图床 / PlantUML 图片离线取字节 |

**结论：渲染侧与主进程侧的基础设施齐备，本次真正的增量只有一个「规范化 + 转换 + 写盘」的转换层。**

---

## 4. 技术选型评估

评分 1~5（5 最好）。

| 维度（权重） | A. docx + htmlToContent（推荐） | B. 自研 DOM→docx 映射 | C. HTML altChunk 包装（html-docx-js） | D. 外部程序（Pandoc/LibreOffice） |
| --- | --- | --- | --- | --- |
| 实现成本（30%） | **5** | 2 | **5** | 3 |
| 产物质量「真 Word」（25%） | **4** | **5** | 2 | 4 |
| 兼容性（WPS/LibreOffice/在线预览）（15%） | **4** | **4** | 1 | 4 |
| 离线零依赖（15%） | **5** | **5** | **5** | 1 |
| 可维护性（10%） | **4** | 2 | 3 | 2 |
| 视觉还原度（5%） | **4** | 4 | 3 | 2 |
| **加权总分** | **4.45** | 3.30 | 2.65 | 2.95 |

### A. `docx` + `docx/html`（推荐）

`htmlToContent(html, options)` 的能力边界（已核对 `docx@9.11.0` 类型声明 `dist/html.d.ts`）：

- **支持**：标题/段落/换行；粗斜体、下划线、删除线、上下标、颜色、背景、字体、字号、间距；对齐、缩进、行距、段落边框与底纹；列表（含嵌套、编号起始与样式）；表格（合并单元格、表头行、宽度、边框、背景、对齐）；图片（尺寸、alt、浮动、**SVG + PNG fallback**）；链接与内部锚点；**复选框（任务列表）**；**math（MathML → Word 公式）**；分页符；批注式修订。
- **样式来源**：`options.stylesheet`（CSS 字符串，会解析 `<style>`/class 选择器）、`options.styleMap`（CSS 选择器 → Word 样式 id）。
- **图片**：`options.images`，可传 `{ 地址: Uint8Array | ArrayBuffer | base64 | dataURL }` 或 `(src) => data` 回调；**不联网下载**，缺失会走 `onWarning('missing-image')`。
- **其他**：`maxImageWidth`（默认 601px，正好是 A4 正文宽度）、`baseUrl`、`notes`（footnotes/endnotes）、`onWarning`（收集被丢弃/不支持的元素）。

依赖体积：tgz 4.7MB（含全格式 dist），实际进入 bundle 的仅 `dist/index.mjs` + `dist/html.mjs`，打包增量约数百 KB；运行时依赖 `jszip / xml / xml-js / nanoid / hash.js` 全为纯 JS，浏览器可用，`Packer.toBlob()` 明确支持浏览器端。

### B. 自研 DOM → docx 映射（备选）

只用 `docx` 的构造 API，自己遍历 DOM 生成 `Paragraph/Table/TextRun`。控制力最强，但列表编号、表格合并、嵌套样式等细节极易踩坑，工作量至少 +4~6 人日，且后续每加一种 Markdown 扩展语法都要同步改映射。**仅当 A 的 `htmlToContent` 对某些结构支持不达标时，针对该结构局部改用 B。**

### C. HTML altChunk 包装（不推荐）

`html-docx-js` 把整段 HTML 以 MHT 形式塞进 `altChunk`，由 Word 打开时自行转换。省事（约 0.5 人日），但：非 Word 的读者（WPS 旧版、LibreOffice、各类在线预览）往往直接显示空白或源码；样式不可控；与"导出 HTML"能力重合，用户价值低。

### D. 外部程序（不推荐）

Pandoc 质量高，但要求用户安装并配置路径；LibreOffice 同理。违背"数据不出本机、开箱即用"的产品定位。

---

## 5. 推荐方案设计

### 5.1 数据流

```
Markdown 源码
   │  ① 离屏渲染（renderMarkdown → 挂载 → enhanceRenderedDom）
   ▼
富 HTML DOM（含 svg / canvas / img / katex）
   │  ② 规范化 normalizeForDocx()：去装饰节点、自定义 class → 语义标签 + inline style
   │     图表 → <img src="docx-asset://N">；公式 → MathML <math>
   ▼
规范化 HTML 字符串 + 图片字节表 + CSS（stylesheet）
   │  ③ htmlToContent(html, { stylesheet, styleMap, images, maxImageWidth, onWarning })
   ▼
docx 的 Paragraph[] / Table[]  →  ④ new Document({ styles, sections }) → Packer.toBlob()
   │  ⑤ IPC：Uint8Array → 主进程 fs.writeFileSync
   ▼
xxx.docx（默认与 .md 同名同目录，走「另存为」对话框）
```

### 5.2 模块划分

| 文件 | 改动 | 职责 |
| --- | --- | --- |
| `src/utils/docxExport.ts` | **新增** | 导出主流程：离屏渲染、HTML 规范化、图片收集、样式拼装、生成 Blob、错误与降级收集 |
| `src/utils/markdown.ts` | 小改 | `renderKatex()` 增加 `output` 参数（导出时用 `htmlAndMathml`，供 MathML → Word 公式） |
| `src/App.vue` | 小改 | 工具栏「导出 Word」按钮 + `exportDocx()`；复用 `buildExportHtml` 里已有的样式拼装逻辑 |
| `electron/main.cjs` | 新增 handler | `dialog:exportDocx`（二进制写盘）、`file:readBinary`（读本地图片字节）、`net:fetchBinary`（取图床/PlantUML 图片字节） |
| `electron/preload.cjs` | 小改 | 暴露上述三个 API |
| `package.json` | 新增依赖 | `docx": "^9.11.0"`（放在 `dependencies`，随 Vite 打包进渲染进程） |

### 5.3 离屏渲染（不依赖当前视图模式）

导出不能在"纯源码模式"下失败，因此不直接取预览 DOM，而是自建离屏容器：

```ts
const host = document.createElement('div')
host.className = 'markdown-body'
// 必须真实参与布局（不能用 display:none，否则 getComputedStyle / canvas 尺寸异常）
host.style.cssText = 'position:fixed;left:-100000px;top:0;width:820px;'
host.innerHTML = renderMarkdown(md, { mathOutput: 'htmlAndMathml' })
document.body.appendChild(host)
await enhanceRenderedDom(host, baseName)   // mermaid / chart / plantuml 渲染完成
await waitImagesLoaded(host)               // 尤其 plantuml 的 loading="lazy"
```

### 5.4 HTML 规范化映射表（核心工作量）

`htmlToContent` 只认识"标准 HTML 语义 + CSS"，我们的自定义结构必须在喂给它之前摊平：

| 预览中的结构 | 规范化动作 | 落到 Word |
| --- | --- | --- |
| `h1~h6`（`markdown.ts` 注入了 `data-line`） | 保留，去掉 `data-line` | Word 内置 Heading 1~6（可用 `styleMap` 绑定） |
| `p / ul / ol / li` | 保留 | 正文 / ListParagraph |
| 任务列表 `<li><input type=checkbox checked>` | 保留 `input` | Word 复选框（`htmlToContent` 原生支持） |
| `table / thead / th / td` | 保留，`th` 自动成为表头行 | Word 表格（含边框、表头重复） |
| `blockquote` | 保留 | Quote 样式 |
| `div.github-alert.alert-note`（`markdown.ts:679`） | → `<blockquote style="border-left:4px solid #409eff;background:#ecf5ff;padding:8px 12px">` | 带左边框与底纹的引用块 |
| `div.code-block-wrapper`（`markdown.ts:941`） | 丢掉 `.code-block-header`（语言标签/复制/下载按钮），`<pre><code class="hljs language-x">` 保留，`pre` 加 `background/color/padding` inline style | 带底纹的等宽字体段落，token 颜色由 `stylesheet` 里的 `.hljs-keyword` 等规则提供 |
| `figure.md-figure` + `figcaption`（`markdown.ts:979`） | 拆成 `<p><img></p>` + `<p style="text-align:center;color:#909399;font-size:12px"><em>图注</em></p>` | 图 + 居中灰色图注 |
| `div.mermaid-container` → 内联 `<svg>` | 序列化 SVG → `<img src="docx-asset://1.svg">`，同时 canvas 转 PNG 作 fallback | 矢量图（Word 2016+ 显示 SVG，旧版显示 PNG） |
| `div.chart-container` → `<canvas>` | `canvas.toDataURL('image/png')` → `<img src="docx-asset://2.png">` | PNG 图片 |
| `img.plantuml-img`（服务 URL） | 取字节 → `<img src="docx-asset://3.svg">`（+PNG fallback） | 图片 |
| `div.math-block` / 行内 KaTeX | 改为输出 MathML：`<math xmlns="…">…</math>` | **Word 原生公式**（可编辑，非图片） |
| Front Matter 卡片 | P0 转成小型 `table`（字段/值两列）；P2 可选做成封面页 | 表格 / 封面 |
| `hr` | 保留 | 分隔线 |
| `a[href]` | 保留（锚点转内部链接） | Hyperlink 样式 |

### 5.5 图片处理

在调用 `htmlToContent` **之前**先把所有图片字节取齐（它的 `images` 是同步回调，不能异步）：

```ts
type Resolved = { data: Uint8Array; fallback?: Uint8Array }
const images = new Map<string, Resolved>()
// 遍历规范化后的 DOM，按 src 形态分派：
//  mdlocal://  → 渲染进程 fetch(mdlocal) → arrayBuffer（PDF 预览已有先例）
//  相对/绝对本地 → 转 mdlocal:// 后同上，或走新增 IPC file:readBinary
//  data:       → 直接解 base64
//  http(s)     → 主进程 net:fetchBinary（绕开渲染进程 CORS；离线时失败 → 降级提示）
```

关键约束与处理：

- **Word 不支持 WebP / AVIF**（会触发 `unsupported-image` 警告）→ 用 `<img>` + canvas 转 PNG 后再嵌入。
- **SVG**：以 `{ data: svg, fallback: png }` 形式提供（`HtmlImage` 类型明确支持该结构）。
- **宽度**：`maxImageWidth` 默认 601px，超出自动缩放；超大图（如 4K 截图）建议在编码前降采样，控制 docx 体积。
- **失败降级**：取不到字节的图，替换为一个灰色占位段落 `[图片加载失败: xxx]`，并在导出结束的提示里汇总（`"3 张图片未嵌入，详见导出报告"`）。

### 5.6 样式与版式

- `stylesheet` = `.markdown-body` 基础样式 + `getMarkdownExtensionStyles()` + 当前代码主题 CSS + `katex.min.css`。
- `styleMap` 建议：`{ "h1":"Heading1", …, "blockquote":"Quote", "code":"InlineCode", "table":"TableGrid" }`（Word 样式 id 需在 `Document.styles` 中定义，或使用模板文档）。
- 默认字体需显式处理中文：`Document.styles.default.document.run.font` 同时设置 `ascii / eastAsia / cs`，建议 `ascii: "Consolas"` 仅用于代码块，正文用 `"微软雅黑"`（Windows 端观感接近预览）。
- 页面：A4 + 上下 2.54cm / 左右 3.18cm（Word 默认），P2 可开放为导出选项。

### 5.7 写盘与交互

- 新增 IPC `dialog:exportDocx({ data: Uint8Array, defaultPath })`：主进程 `fs.writeFileSync(path, Buffer.from(data))`（参考 `dialog:exportHtml`，`main.cjs:848-857`）。Uint8Array 走结构化克隆，直接可传。
- UI：工具栏在「导出 HTML」旁新增「导出 Word」按钮（`activeFileType !== 'markdown'` 时禁用，同 `App.vue:2362`）；弹出另存为对话框，默认路径为当前 md 同目录同名 `.docx`。
- 导出期间显示 loading（Mermaid 串行渲染 + 图片编码可能数秒），结束提示成功并给出「在文件夹中显示」入口；有降级项时汇总提示。

---

## 6. 关键风险与降级策略

| # | 风险 | 影响 | 概率 | 应对 |
| --- | --- | --- | --- | --- |
| 1 | `docx/html` 对 MathML → OMML 的支持未实测（类型声明写明支持 "math, as Word's equations"，但输入形态需验证） | 公式不可用 | 中 | 先做 spike 验证；失败则降级：块级公式用 SVG foreignObject 截图、行内公式保留 LaTeX 文本 |
| 2 | Mermaid SVG 转 PNG 时，含 `<foreignObject>` 或外部字体的图可能渲染异常 | 图表 fallback 图异常 | 中 | 优先只提供 SVG（Word 2016+ 原生支持）；PNG 仅作 fallback，生成失败就放弃 fallback |
| 3 | 图床 / PlantUML 图片需联网，离线取不到 | 图片缺失 | 中 | 主进程 `net:fetchBinary` + 超时（5s）；失败降级占位并计入报告 |
| 4 | WebP / AVIF 图片 Word 不支持 | 图片丢失 | 中 | canvas 转 PNG（渲染进程可完成） |
| 5 | `htmlToContent` 丢弃不支持的元素（如 `<video>`/`<iframe>`） | 内容缺失 | 低（当前预览不产生这类元素） | 用 `onWarning` 收集，导出后统一提示 |
| 6 | 超长文档（数百图 / 上万行）内存与耗时 | 卡顿 | 中 | 分阶段 await 让出主线程、图片降采样、超过阈值时提示预计耗时 |
| 7 | bundle 体积增加 | 包体变大 | 低 | 仅引入 `docx` + `docx/html`，构建后核对增量（预计数百 KB） |
| 8 | 中文字体在未装「微软雅黑」的机器上回退 | 版式轻微差异 | 低 | 字体族给回退链；P2 允许在设置中指定导出字体 |

---

## 7. 落地计划

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| **Spike（0.5 人日，先做）** | 装 `docx@9.11`，在渲染进程写最小 demo：`htmlToContent('<h1>..</h1><p>..</p>')` + `Packer.toBlob()`；验证 ①MathML 公式 ②SVG+PNG fallback 图片 ③表格与任务列表 ④Vite/Electron 打包可运行 | 0.5 人日 |
| **P0** | 依赖接入、离屏渲染、规范化（基础语法 + 提示块 + 代码块 + 图片图注）、图片收集（本地/data/http）、写盘 IPC、工具栏入口、loading 与降级提示 | 2~3 人日 |
| **P1** | Mermaid / sequence / Chart.js / PlantUML 转图嵌入；KaTeX → MathML → Word 公式（含 `renderKatex` 增加 output 参数） | 1~2 人日 |
| **P2** | 页眉页脚与页码、目录（TOC）、Front Matter 封面、导出选项（纸张/边距/字体/代码主题/是否嵌图）、导出报告弹窗 | 1~2 人日 |
| **合计** | | **约 5~7.5 人日（含 Spike）** |

---

## 8. 验收清单

- [ ] 含全部基础语法的样例文档导出后，在 Word 与 WPS 中打开无报错、结构正确（标题可进导航窗格）。
- [ ] 表格边框、表头、合并单元格（如有）正确；任务列表显示复选框且勾选态保留。
- [ ] 代码块保留等宽字体与语法高亮配色，语言标签栏/复制按钮不出现在文档里。
- [ ] 本地图片、图床图片、data base64 图片均嵌入；WebP 可正常显示（已转 PNG）。
- [ ] Mermaid / Chart / PlantUML 图嵌入且清晰（放大不失真优先 SVG）。
- [ ] 公式在 Word 中**可编辑**（OMML），至少块级公式如此。
- [ ] Front Matter 元数据正确呈现。
- [ ] 纯源码模式下（预览未渲染）也能导出成功。
- [ ] 断网状态下导出不失败，缺失图片有明确提示。
- [ ] 打包后（`npm run dist`）功能与开发环境一致。

---

## 9. 与现有能力的边界

- **不与「一键转 Markdown」冲突**：`electron/docConvert.cjs` 走 anydoc，是 Office/PDF → Markdown；本次是反向链路，两者共用工具栏不同入口。
- **不与「导出 HTML」重复**：HTML 侧继续保留（适合发布/网页场景），Word 侧面向"交付、评审、打印"场景。两者共用同一套样式来源（`getMarkdownExtensionStyles()`），后续改样式只改一处。
