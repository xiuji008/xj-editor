# Markdown 桌面编辑器（XJ-Editor）

一款为「自己」而写的桌面版 Markdown 编辑器，可在 Windows 上独立运行。

## 为什么做这个程序

做这个程序的初衷**不是为了重复造轮子**。市面上的 Markdown 编辑器很多，但用下来总是差那么一点：

- 想要**一个应用同时搞定 Markdown / HTML / JSON / 文本**编辑，还要能**预览图片、PDF、Office 文档**，而不是装一堆软件来回切换；
- 想要**图床自动上传、文档一键转 Markdown、AI 一键润色/扩写**这些工作流级的能力，而不是零散拼装插件；
- 想要**所见即所得**的图表（Mermaid / PlantUML / Chart.js）、KaTeX 公式、GitHub 风格提示块这些日常刚需，而不是每次都要额外配置；
- 想要一个**尊重本地文件、离线可用、数据不出本机**的编辑器。

市面上没有一款编辑器恰好同时满足这些需求。因此这个程序不是替代品，而是一个**按自己的使用习惯定制的工具**——哪里不顺手就改哪里，为真实的工作流而生。

---

## 功能总览

### 多格式编辑与预览

| 格式 | 能力 |
| --- | --- |
| **Markdown** | 源码编辑 + 实时预览，支持扩展语法、图表、公式、代码高亮（见下） |
| **HTML** | 源码编辑 + iframe 实时预览，本地相对资源自动解析，可手动重新加载脚本 |
| **JSON** | 源码编辑 + 所见即所得树形视图，双向同步、格式化/压缩、实时有效性校验 |
| **文本** | 纯文本编辑（txt / sql / xml 等），实时行数/字符统计；`.js / .mjs / .cjs` 额外提供「运行」按钮 |
| **图片** | png / jpg / jpeg / gif / webp / svg / bmp / ico / avif 预览 |
| **PDF** | 内置阅读器：页码跳转 / 缩放 / 适应宽度与整页 / 高亮标注 / 批注面板 / 阅读进度与笔记，基于 pdf.js 本地渲染 |
| **Office** | doc / docx / xls / xlsx / ppt / pptx 预览，旧版 .doc 自适应缩放 |
| **压缩包** | zip / tar / gz / tgz / bz2 / xz 在线浏览包内目录与文件；rar / 7z 显示文件头信息 |

Markdown / HTML / JSON 均支持**编辑 / 分屏 / 预览**三种视图模式一键切换。

### Markdown 渲染能力

- **完整语法**：标题、列表、表格、引用、任务列表、脚注、删除线等
- **代码高亮**：12 种主题（GitHub Dark/Light、Dracula、Monokai、Nord、Atom、Xcode、VS、Solarized 等），代码块带语言标签栏、一键复制与一键下载（按语言导出为对应类型文件，如 `js`→`.js`、`python`→`.py`、`mermaid`→`.mmd`，未识别语言默认 `.txt`）
- **运行脚本**：` ```js`（含 `javascript / mjs / cjs / node`）代码块右上角显示「运行」按钮，点击后在底部「脚本输出」面板用 Node 执行并回显结果（无需安装 Node，见「运行脚本」章节）
- **Mermaid 图表**：流程图、时序图、甘特图等（支持 `sequence` 时序图别名）
- **PlantUML 图表**：默认官方在线服务，可配置为私有化部署地址，支持 SVG / PNG
- **Chart.js 图表**：极简 JSON 语法即可绘制 pie / bar / line / area / radar / doughnut，也支持完整原生配置
- **数学公式**：KaTeX 渲染行内 `$...$` 与块级 `$$...$$` 公式
- **提示块**：`> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` GitHub 风格，可自定义标题
- **YAML Front Matter 卡片**：文档头部元信息（标题 / 标签 / 分类 / 描述 / 时间）渲染为信息卡片
- **图片增强**：`![说明](url)` 自动渲染为带图注（figcaption）的图文

### 界面与外观

- **浅色 / 深色 / 跟随系统**：工具栏太阳 / 月亮按钮一键切换（「设置 → 外观」可改为跟随系统），首屏无闪白、多窗口同步；深色覆盖工具栏、目录树、编辑区、预览、对话框、Git 与终端面板，图表容器与 PDF 纸面保持浅色，导出 HTML / Word 不受主题影响
- **显示字体**：正文字体（Markdown 预览）与编辑器字体（源码区）分开设置，内置中文常用 / 书法艺术 / 西文 / 等宽四组预设并带实时样例，切换即时生效、重启记忆
- **预览缩放**：Markdown / HTML 预览支持 25% ~ 500% 缩放（步长 10%），工具栏 `-` / 百分比（点击恢复 100%）/ `+` 操作，`Ctrl + 滚轮` 以预览区中线为锚点缩放，缩放值持久化记忆
- **代码高亮主题**：12 套主题随时切换，预览与导出 HTML 同步使用

### 编辑体验

- **目录导航（TOC）**：预览区浮动目录，自动提取 h1–h6，点击平滑滚动，随阅读高亮当前章节
- **同步滚动**：源码与预览基于行号锚定的双向同步滚动，图表/图片异步加载下依然精准
- **查找 / 替换**：`Ctrl+F` 查找、`Ctrl+H` 替换，支持区分大小写、实时高亮全部匹配与当前项、替换/全部替换、F3 跳转
- **智能撤销 / 重做**：自绘历史栈（连续输入合并为一步，工具操作独立一步，上限 200 步），`Ctrl+Z` / `Ctrl+Y` 可靠回退
- **选中文本浮动按钮**：选中文本即弹出「问 AI」与「生成图表」入口，一键带入 AI 助手提问或按描述生成图表代码
- **工具栏自适应**：按钮空间不足时自动收进「更多」下拉；常用模板（标题 / 列表 / 代码块 / 链接 / 表格 / 图表 / 公式 / 提示块）一键插入
- **插入链接弹窗**：分别填写跳转链接与展示文本，链接缺协议时自动补 `https://`，未选文本时以链接地址作为展示文本
- **预览链接外开**：预览中的 `http(s)` / `mailto:` / `tel:` 链接交给系统默认浏览器打开，不会把应用窗口导航走；指向本地文件的链接仍在应用内打开
- **粘贴图片反馈**：粘贴图片后在粘贴位置显示「图片上传中…」（多图时显示数量），上传完成或失败自动移除，滚动时跟随并滚出可视区后隐藏
- **大文件保护**：超过 2 MB 的纯文本（txt / sql / log 等）只读预览前 512 K 个字符，避免原生 textarea 一次性布局超大文本卡死；此类文件禁止就地保存，可改用「用系统默认程序打开」

### 文档元数据（YAML Front Matter）

文档头部的 `---` 元数据块会渲染为蓝色主题卡片（标题 / 分类 / 系列 / 标签 / 关键词 / 作者 / 状态 / 创建时间 / 更新时间 / 摘要）。

- **一键更新元数据**：AI 面板「一键更新元数据」按钮（或工具栏同名按钮）读取全文，生成 / 补全元数据后合并回文档头部，支持 `Ctrl+Z` 回退
- **时间由系统维护**：`createDate` 沿用首次写入的值、`lastUpdateDate` 在更新元数据与每次保存时自动刷新；AI 返回的这两个字段会被忽略，用户手改也会在保存时被覆盖
- **只写入支持的字段**：共 9 个业务字段（`title`、`emoji`、`description`、`keywords`、`tags`、`category`、`series`、`author`、`status`）加 2 个系统时间字段；AI 只输出能确定的字段，无把握的不写入（也不留空值占位），已有值合理时不会改写；不支持的字段不会写入元数据块
- **元数据块无注释**：只写 `key: value`，不写分组标题与字段说明

示例（一键更新后写入的元数据块）：

```yaml
---
title: Markdown 元数据实践
emoji: 📝
description: 介绍 Markdown 元数据的字段设计，以及如何让 AI 自动维护。
keywords: Markdown、元数据、Front Matter、AI
tags: [Markdown, 元数据, 自动化]
category: 技术笔记
series: 编辑器实践
author: 张三
status: published
createDate: 2026-09-21 10:00:00
lastUpdateDate: 2026-09-21 11:22:33
---
```

### 图片处理

- **插入 / 粘贴图片**：多选本地图片或直接粘贴剪贴板图片
  - 本地模式：自动复制到当前文件同级 `images/` 目录，插入相对路径
  - 图床模式：自动上传并插入图片 URL
- **粘贴本地文件路径**自动转为 Markdown 链接
- **右键另存**：预览中的图片 / Mermaid / Chart 图表可一键导出 PNG 或保存文件

### 图床配置

- **本地保存**：默认模式，图片归入文档同级 `images/` 目录
- **PicGo**：对接 PicGo 本地 HTTP 服务（默认 `127.0.0.1:36677`），批量上传
- **自有图床**：兼容 Chevereto API v1 规范，自定义上传接口与 API Key，自动匹配响应中的图片 URL（含数组索引与多路径智能回退）
- 内置「选择图片测试上传」验证配置

### 一键转 Markdown

Office / PDF / RTF / EPUB / ODT / CSV 文档可在**本地**一键转换为 Markdown（基于 anydoc 本地转换，文件不离开本机，无需联网）：

- 支持 Word（doc/docx/docm）、PPT（ppt/pptx/pps/pot）、Excel（xls/xlsx/xlsm/xlsb）、OpenDocument（odt/ods/odp）、RTF、EPUB、CSV、PDF
- 转换后同目录生成同名 `.md`（重名自动加序号），并自动打开编辑
- 嵌入图片按图床配置处理：本地导出到 `xxx-assets/` 目录或上传图床（上传失败自动回退本地）
- 明确的错误提示（扫描版 PDF 需 OCR、加密、损坏等）

### AI 助手

内置 8 家厂商预设：**OpenAI、Anthropic Claude、Google Gemini、DeepSeek、Moonshot Kimi、阿里云百炼 Qwen、智谱 GLM、Ollama（本地）**，支持 OpenAI 兼容 / Anthropic / Google Gemini 三种协议，也可添加自定义厂商。

- **快捷任务**：内置 11 种生成类型——润色、扩写、精简、概要生成、标题生成、翻译、续写、校对纠错、格式整理、关键词摘要、元数据；一键作用于整篇文档或选中文本（超出 6 个的类型收入「更多」下拉）
- **提示词可定制**：每种内置类型都有内置提示词，可在「AI 面板 → 快捷提示词」或「设置 → 快捷 AI」中修改提示词、适用范围与结果处理方式，支持停用、排序、新增自定义类型与一键恢复默认（持久化到 `{userData}/quick-ai.json`）
- **生成图表**：选中描述文本（或直接在输入框输入），选择 **Mermaid / PlantUML / Chart** 类型后一键生成代码，支持插入到光标处（替换选中描述）或文末；新增类型只需在 `DIAGRAM_TYPES` 追加一项，下拉与提示词自动生效
- **概要生成**：自动插入 `> [!NOTE] 文章概要` 提示块到文章标题之下
- **一键更新元数据**：AI 读取全文生成 / 补全元数据并合并到文档头部，只写入工具支持的字段且不带注释；`createDate`、`lastUpdateDate` 由系统维护，AI 不改（详见「文档元数据」）
- **结果应用**：替换全文 / 插入文末 / 插入光标处 / 插入文首 / 插入标题之下 / 更新元数据 / 复制，均支持 `Ctrl+Z` 回退
- **引用文件**：多选文件作为上下文——文本（超长自动截断）、图片（多模态）、Office/PDF 等自动转 Markdown
- **多会话**：「新建对话」开启新会话，「历史对话」中按更新时间浏览、搜索、切换、重命名、删除；会话持久化到 `{userData}/ai-chats.json`，重启后仍在，并自动回到上次打开的会话
- **独立对话窗口**：一键把聊天搬到独立窗口（`#ai-chat`）边写边聊，与主窗口共享同一份会话数据并实时同步
- **流式响应**：回复边生成边渲染，可随时「停止生成」（保留已生成内容）；厂商不支持流式时自动降级为一次性返回
- **多轮上下文**：自由对话自动携带最近 20 条（约 1.6 万字）历史作为上下文；快捷任务 / 生成图表保持单轮，避免上下文干扰
- **测试连接**：一键验证厂商配置是否可用
- 配置持久化到本地 JSON；未填写 API Key 时面板给出提示

### AI 调用日志

每次大模型调用（润色 / 扩写 / 概要 / 图表 / 提交信息 / 连接测试）都会自动落盘，在「设置 → AI 调用日志」中查看：

- **按月存储**：`{userData}/ai-logs/ai-log-YYYY-MM.json`，可在界面一键打开日志目录、清空指定月份
- **记录内容**：时间、场景、厂商与模型、协议与请求地址、实际请求参数与消息、响应正文、结束原因、耗时、是否被中断 / 降级
- **Token 统计**：优先采用服务端返回的用量（流式请求通过 `stream_options` 索取）；服务端未返回时按字符数估算并标记「估算」，列表中可查看输入 / 输出 / 合计
- **聚合视图**：按月筛选、场景与状态筛选、关键字检索、分页，并给出调用次数、成功失败、输入 / 输出 / 合计 Token 与平均耗时
- **安全**：API Key 等密钥字段脱敏为 `***`，图片 base64 不落盘，超长文本截断保存

### 文件管理

- **目录树侧边栏**：打开目录后浏览全部文件，宽度可拖动，展开状态与最近目录**重启自动恢复**
- **文件操作**：新建、打开、保存、另存为、导出 HTML；右键菜单支持新建文件/文件夹、重命名、删除、复制粘贴（`Ctrl+C` / `Ctrl+V`）、在文件夹中显示、用系统默认程序打开
- **复制到系统 / 拖拽到系统**：目录树中 `Ctrl+C`（或右键「复制」）会同时写入系统剪贴板，可在桌面、资源管理器等任意位置 `Ctrl+V` 粘贴；直接把节点拖到桌面 / 文件夹，效果等同复制文件
- **多编码识别**：自动识别 UTF-8 / UTF-16LE / UTF-16BE 编码
- **顶部文件名点击即可重命名**；状态栏实时显示行数、字数、文件路径
- **未保存标记**：标题与文件名处醒目标识，切换/关闭前有保存确认
- **内置暂存区**：安装目录（不可写时回退到应用数据目录）下的固定文件 `暂存区.md`，用于临时拷贝 / 暂存信息；**不在左侧目录树中展示**，点击工具栏「暂存区」按钮一键打开，内容自动保存，可一键清空

### 导出 Word

- **两个入口**：工具栏「导出 Word（.docx）」（仅 Markdown 文件，另选保存位置）与编辑器工具栏「转 Word」（直接在同目录生成同名 `.docx`，已存在时先确认覆盖）
- **原生结构**：复用 Markdown 渲染管线生成富 HTML，再转成 Word 原生段落 / 表格（标题、列表、表格、引用、代码块保留主题配色、图片、Front Matter 信息卡）
- **图表与图片**：Mermaid / Chart 图表由 DOM 编码为图片嵌入，本地图片按 A4 正文宽度降采样，避免 docx 体积过大
- **本地完成**：整个转换在渲染进程内完成，不联网、不上传文件；无法转换的元素（如图片路径失效）会在导出后汇总提示

### 导出 PDF

工具栏「打印机」按钮可把当前文档导出为**矢量 PDF**（文字可选中、可搜索，非截图），导出前弹出设置对话框：

- **支持格式**：Markdown、HTML、JSON、纯文本、图片（一图一页、等比居中）、Word（仅 `.docx`）；`.doc` / Excel / PPT 暂不支持
- **版面设置**：A3 / A4 / A5 / Letter / 自定义毫米尺寸、纵向或横向、页边距（8 / 14 / 20 / 25 mm）、内容缩放（75% ~ 200%）、页脚「第 N 页 / 共 M 页」开关；选择记入 `localStorage`，下次沿用
- **内容保真**：Markdown 复用预览渲染管线（Mermaid 为矢量图、Chart.js 图表、KaTeX 公式、代码高亮与主题配色一并保留）；KaTeX 字体内联为 data URL，避免临时打印页加载不到字体
- **实现方式**：渲染进程生成打印用 HTML（或直接给出源文件路径），主进程用隐藏窗口的 Chromium `printToPDF` 输出；HTML / 图片直接打印源文件，相对 CSS 与图片天然可用；`.docx` 由 docx-preview 离屏渲染（图片转 base64），不会把应用窗口内容截成图片
- **降级提示**：个别图片路径无法解析等降级项会汇总成提示（最多列 5 条），不影响其余内容导出

### Git 版本管理

打开 Git 仓库目录后，左侧目录树下方自动出现 Git 面板（非仓库目录不显示；`Ctrl+Shift+G` 或工具栏 Git 按钮可切换显隐）：

- **从 Git 克隆**：工具栏「从 Git 打开」输入仓库地址（HTTPS / SSH / 本地路径）、存放目录与可选分支，实时显示克隆进度与日志，完成后自动打开该项目目录
- **自动检测**：通过 `git rev-parse` 识别仓库，支持在仓库的任意子目录打开；未安装 Git 时给出提示，并可在面板 ⋯ 菜单中手动指定 `git.exe` 路径
- **变更列表**：按「冲突 / 已暂存 / 未暂存（含未跟踪）」分组，文件带状态角标（M 修改、A 新增、D 删除、R 重命名、U 未跟踪、! 冲突），目录树节点同步显示状态角标与后代变更数量
- **暂存与提交**：勾选文件即暂存（取消勾选即取消暂存），支持整组勾选；提交信息支持多行、历史信息快速回填，`Ctrl+Enter` 提交；存在冲突或未暂存文件时禁止提交
- **AI 生成提交信息**：基于已暂存改动（无暂存时用全部改动）流式生成提交信息，生成中可中断，已填写内容时先确认覆盖
- **提交信息规范**：⋮ 菜单「提交规范设置…」可编辑规范正文与 AI 提示词模板（完整版 / 精简版预设、可恢复默认）；开启提交前校验后，不合规仅提示，确认后仍可提交
- **差异比对**：点击文件查看逐行 diff，支持内联 / 并排切换与复制，可查看工作区、暂存区或某次提交的差异
- **历史记录**：仓库整体历史与单文件历史（`--follow`，可追到重命名前），支持关键字过滤、加载更多，点击提交查看该次改动
- **还原文件**：目录树文件右键「还原此文件」可丢弃未提交的修改（二次确认）
- **分支管理**：点击面板中的分支名打开分支弹窗，可查看本地 / 远程分支（含上游与 ↑↓）、切换、新建并切换、删除本地分支（`-d` 失败可转 `-D`）；远程分支可检出为同名本地分支并自动跟踪
- **远程同步**：面板头部 ↓ / ↑ 按钮直接拉取 / 推送，⋮ 菜单另有「获取远程更新」（`fetch --prune`）；推送时若分支无上游会询问是否设置上游（`-u`）。远程操作 120s 超时并关闭交互式凭据输入，不会卡住界面；认证失败、非快进被拒、无上游、网络不可达、合并冲突等都会转成具体的中文提示
- **储藏（stash）**：⋮ 菜单「储藏（stash）…」可保存当前改动（支持说明、可选含未跟踪 `-u`），并支持应用（保留）、弹出（应用后删除）、删除
- **忽略规则**：⋮ 菜单「编辑 .gitignore…」直接编辑仓库根的忽略规则（规则计数、未保存关闭提醒）；也可在目录树右键「加入 .gitignore」，自动按文件 / 目录写入 `/file` 或 `/dir/` 并去重，若文件已被跟踪会提示需先 `git rm --cached`
- **实现说明**：主进程调用系统已安装的 git（`electron/git.cjs`），不引入第三方依赖；写操作按仓库串行执行，中文路径与 UTF-8 输出已统一处理；凭据不内置管理，依赖系统已配置的 SSH agent / credential helper

### 终端（命令行）

点击工具栏终端图标或按 `` Ctrl+` `` 在窗口下部打开终端面板（也可在目录树节点右键「在此处打开命令行」），样式与操作参考 VS Code：

- **就地打开**：默认在当前打开的目录中启动；右键文件节点时在其所在目录启动
- **多标签**：`+` 可同时开多个终端，标签显示 `1: PowerShell` 形式，可单独关闭；切换标签保留各自的输出与历史
- **可选 shell**：自动探测并列出 PowerShell / 命令提示符 / Git Bash / WSL（未安装的不显示），`▾` 可指定某一种新建，选择会被记住
- **常用操作**：`↑` `↓` 翻阅历史命令，`Ctrl+C` 中断（有选中文本时仍为复制），`Ctrl+L` 清屏，多行粘贴逐行执行，清屏 / 终止 / 关闭面板按钮齐备
- **执行反馈**：回车后命令回显到输出区，执行期间不显示输入行；命令执行结束（输出停止约 0.3 秒）后提示符与输入框才重新出现，同 VS Code
- **高度可调**：拖动面板顶部可调整高度并记忆；关闭面板不会结束其中的终端，再次打开即可继续
- **系统终端**：目录树节点右键「在系统终端中打开」，另开一个**真实终端窗口**（自动探测 Windows Terminal / Ghostty / PowerShell 7 / PowerShell / 命令提示符 / Git Bash 等，未安装的不显示），拥有完整 TTY，可正常运行 vim / less / tmux / Claude Code 等全屏程序；检测到多个时可在子菜单指定，选择会被记住

> 说明：内置面板由主进程（`electron/terminal.cjs`）通过管道启动系统 shell，不引入原生依赖；Windows 中文输出按 UTF-8 / GB18030 自动识别，不会乱码。受管道模式限制，面板内的 vim、less 等需要真实 TTY 的全屏程序无法使用（请改用上面的「在系统终端中打开」），普通命令与 `python` / `node` 等交互式 REPL 可正常使用。
>
> 面板接入真实 PTY（node-pty + xterm.js）的改造路线、验收标准与分阶段回滚方案见 `docs/内置终端接入PTY改造方案.md`。

### 运行脚本（JS）

编辑器内置 JS 脚本运行能力，两个入口共享同一个「脚本输出」底部面板：

- **运行 `.js` 文件**：打开 `.js / .mjs / .cjs` 文件后，顶部工具栏出现绿色「运行」按钮；点击执行当前脚本（有未保存改动会先保存），标准输出 / 标准错误实时回显到面板，结束显示退出码
- **运行 ` ```js` 代码块**：Markdown 预览中，`js / javascript / mjs / cjs / node` 代码块右上角显示「运行」按钮，点击即以代码块内容运行，工作目录为文档所在目录
- **输出面板**：底部「脚本输出」面板按标准输出（普通色）/ 标准错误（红色）/ 系统提示（灰色）区分，支持清空、停止运行、关闭；运行中显示状态，结束显示退出码（非 0 为红色）
- **无需安装 Node**：主进程优先使用系统 `node`（错误栈更友好），未安装时自动退回 Electron 内置 Node（`ELECTRON_RUN_AS_NODE`），打包后依然可用
- **保护措施**：默认 60 秒超时自动终止、输出累计 5 MB 上限截断、进程树清理、Windows 中文输出按 UTF-8 / GB18030 自动识别

> 说明：脚本运行在主进程 `electron/script.cjs` 中通过 `child_process` 启动 Node 子进程完成，输出经 `window.mdAPI.script` 流式回传（`contextIsolation` 下不暴露 Node 能力给渲染进程，仅 IPC 通道）。任意代码执行仅在用户主动点击「运行」时触发，绝不自动执行。

### 工具集

工具栏「工具集」按钮或 `Ctrl+Alt+T` 打开右侧抽屉（可全屏），内置常用开发小工具：

| 工具 | 分类 | 能力 |
| --- | --- | --- |
| **JSON 格式化** | 文本处理 | 源码 + 虚拟滚动树双栏工作台，大 JSON 懒加载与搜索，格式化 / 压缩 / 排序键 / 转义与去转义 |
| **Base64 编解码** | 编码转换 | 文本与 Base64 互转，支持 URL 安全字符集 |
| **哈希计算** | 哈希加密 | MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512，支持 HMAC 密钥 |
| **时间戳转换** | 时间日期 | 秒 / 毫秒自动识别，输出本地时间、ISO 与 UTC |
| **进程管理** | 开发辅助 | 按端口号 / 服务名 / PID 查进程并一键结束（含子进程），专治「端口被占用」；拦截系统关键进程与应用自身进程 |

- **通用能力**：分类筛选、关键字搜索、收藏与最近使用；部分工具（如 JSON 格式化）可把处理结果插入当前文档光标处
- **实现说明**：进程管理只调用系统自带命令（Windows 为 `netstat` / `tasklist` / `taskkill` / PowerShell，POSIX 为 `ps` / `lsof` / `kill`），不引入第三方依赖；PID 先转数字再拼命令，杜绝命令注入

### 系统集成

- **文件关联**：注册后双击 `.md` 文件默认用本编辑器打开；其余文本/代码扩展名（txt/json/xml/csv/html/js/ts/py 等约 30 种）加入「打开方式」候选（仅写入当前用户注册表，无需管理员权限，可一键取消）
- **拖拽 / 命令行打开**：拖到快捷方式或 `Markdown编辑器.exe 文档.md` 直接打开；应用已运行自动聚焦已有窗口
- **单实例**：重复启动自动把文件交给已有窗口
- **F12** 随时开关开发者工具（`--debug` 启动自动打开）

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+N` | 新建文档 |
| `Ctrl+O` / `Ctrl+Shift+O` | 打开文件 / 打开目录 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `F3` / `Shift+F3` | 下一个 / 上一个匹配 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+C` / `Ctrl+V`（目录树） | 复制 / 粘贴文件或文件夹（`Ctrl+C` 同时写入系统剪贴板，可粘贴到桌面等位置） |
| `Ctrl+Shift+T` | 打开内置暂存区 |
| `Ctrl+Shift+G` | 显示 / 隐藏 Git 面板 |
| `` Ctrl+` `` | 显示 / 隐藏终端面板 |
| `Ctrl+Alt+T` | 打开 / 关闭工具集 |
| `Ctrl+滚轮`（预览区） | 放大 / 缩小 Markdown 预览 |
| `F12` | 开发者工具 |

## 目录结构

```
xj-editor/
├── electron/                 # Electron 主进程与预加载脚本
│   ├── main.cjs              # 窗口、文件系统、单实例、mdlocal:// 协议、导出 PDF
│   ├── process.cjs           # 进程管理（按端口 / 服务名查询并结束，系统命令实现）
│   ├── docConvert.cjs        # 文档本地转 Markdown（anydoc WASM）
│   ├── ai.cjs                # AI 请求（多厂商 / 多协议 / 多模态）
│   ├── aiLogger.cjs          # AI 调用日志（按月 JSON 落盘 / 脱敏 / Token 统计）
│   ├── aiChats.cjs           # AI 对话会话持久化（多会话 / 历史对话，多窗口共享）
│   ├── quickAi.cjs           # 快捷 AI 类型与内置提示词（可定制，JSON 持久化）
│   ├── git.cjs               # Git 版本管理（调用系统 git，写操作串行）
│   ├── commitSpec.cjs        # Git 提交规范配置（AI 生成提交信息）
│   ├── fileassoc.cjs         # Windows 文件关联
│   ├── terminal.cjs          # 内置终端（管道 shell）与系统外部终端探测
│   ├── script.cjs            # JS 脚本运行（Node 子进程，运行 .js 文件 / ```js 代码块）
│   └── preload.cjs           # 渲染进程桥接层（window.mdAPI）
├── src/
│   ├── components/
│   │   ├── MarkdownEditor.vue    # 核心 Markdown 编辑器
│   │   ├── HtmlEditor.vue        # HTML 编辑 + 实时预览
│   │   ├── JsonEditor.vue        # JSON 编辑 + 树形视图
│   │   ├── TextEditor.vue        # 纯文本编辑
│   │   ├── FilePreview.vue       # 图片 / PDF / Office / 压缩包预览
│   │   ├── FindBar.vue           # 查找 / 替换通用组件
│   │   ├── AiPanel.vue           # AI 助手面板（多会话 / 流式回复）
│   │   ├── AiChatWindow.vue      # 独立 AI 对话窗口（#ai-chat，与面板共享会话）
│   │   ├── AiChatHistoryDialog.vue # 历史对话查看（搜索 / 切换 / 重命名 / 删除）
│   │   ├── AiConfigDialog.vue    # AI 厂商配置
│   │   ├── AiLogDialog.vue       # AI 调用日志查看（列表 / 统计 / 详情）
│   │   ├── TerminalPanel.vue     # 底部终端面板（多标签 / 高度可调）
│   │   ├── TerminalView.vue      # 单个终端视图（输出渲染 / 命令输入）
│   │   ├── TerminalIcon.vue      # 终端图标
│   │   ├── ScriptOutputPanel.vue # 脚本输出面板（.js 文件 / ```js 代码块运行结果）
│   │   ├── PdfExportDialog.vue   # 导出 PDF 版面设置（纸张 / 方向 / 边距 / 缩放 / 页码）
│   │   ├── pdf/                  # PDF 阅读器（pdf.js）
│   │   │   ├── PdfViewer.vue     # 阅读器外壳（页码 / 缩放 / 高亮标注 / 批注）
│   │   │   ├── PdfPage.vue       # 单页渲染与文本选择
│   │   │   ├── PdfNotesPanel.vue # 批注列表
│   │   │   └── PdfNoteCard.vue   # 批注卡片（Markdown 渲染 / AI 笔记）
│   │   ├── Git*.vue              # Git 面板与弹窗（变更 / 差异 / 历史 / 分支 / 储藏 / 克隆）
│   │   ├── ImageHostingConfigDialog.vue  # 图床配置
│   │   ├── PlantUmlConfigDialog.vue      # PlantUML 服务配置
│   │   ├── FileAssociationsDialog.vue    # 文件关联
│   │   └── settings/                     # 统一「设置」窗口（左侧分类 + 右侧配置）
│   │       ├── SettingsDialog.vue        # 设置窗口外壳（分类导航 / 保存与未保存提示）
│   │       ├── AppearancePanel.vue       # 外观：应用主题、默认视图、显示字体、代码高亮主题
│   │       ├── ImageHostingPanel.vue     # 图片与图床
│   │       ├── PlantUmlPanel.vue         # PlantUML 服务
│   │       ├── AiConfigPanel.vue         # AI 厂商配置
│   │       ├── QuickAiPanel.vue          # 快捷 AI 类型与内置提示词定制
│   │       └── FileAssociationsPanel.vue # 文件关联
│   ├── QuickAiPromptsDialog.vue  # 快捷 AI 提示词编辑弹窗（AI 面板入口）
│   ├── composables/
│   │   ├── useAiChat.ts          # AI 对话组合式逻辑（会话管理 / 流式 / 中断）
│   │   ├── useTheme.ts           # 浅色 / 深色 / 跟随系统主题（多窗口同步）
│   │   └── usePdfDocument.ts     # pdf.js 文档加载（worker / cmap / 运行时兼容补丁）
│   ├── utils/
│   │   ├── aiChat.ts             # AI 对话会话读写与上下文构建
│   │   ├── markdown.ts           # Markdown 渲染（图表/公式/高亮/同步滚动）
│   │   ├── docxExport.ts         # Markdown → Word（.docx）转换
│   │   ├── git.ts                # Git 输出解析与变更状态整理
│   │   ├── commitSpec.ts         # 提交规范与 AI 提交信息提示词
│   │   ├── metadata.ts           # 元数据字段清单与 AI 元数据合并（无注释、时间字段系统维护）
│   │   ├── history.ts            # 自定义撤销 / 重做历史栈
│   │   ├── find.ts               # 查找定位与高亮
│   │   ├── imageHosting.ts       # 图床上传
│   │   ├── ai.ts                 # AI 配置、对话与图表生成
│   │   ├── quickAi.ts            # 快捷 AI 类型配置与提示词渲染
│   │   ├── plantUmlConfig.ts     # PlantUML 服务配置
│   │   ├── previewZoom.ts        # 预览缩放（25% ~ 500%，Ctrl+滚轮）
│   │   ├── printExport.ts        # 多格式 PDF 导出（打印 HTML 生成 / 版面参数）
│   │   ├── fonts.ts              # 显示字体清单与 CSS 变量下发
│   │   ├── pdfNotes.ts           # PDF 标注与笔记（sidecar 落盘）
│   │   ├── pdfAi.ts              # PDF AI 笔记生成
│   │   ├── terminal.ts           # 终端行缓冲（ANSI 解析）与提示符计算
│   │   ├── scriptRunner.ts       # 脚本运行单例状态（订阅输出 / 面板显隐 / 停止）
│   │   └── fileUtils.ts          # 路径 / 文件类型 / mdlocal:// 工具
│   ├── styles/
│   │   ├── code-themes/          # 12 个代码高亮主题
│   │   └── dark.css              # 深色主题自定义变量与组件覆盖
│   ├── tools/                    # 工具集（注册表 / 分类 / 抽屉面板 / widgets 内置工具）
│   ├── App.vue                   # 应用外壳（工具栏 / 目录树 / 状态栏）
│   └── main.ts                   # 应用入口
├── docs/                     # 设计文档（如内置终端接入 PTY 改造方案）
├── scripts/                  # 构建脚本（复制 pdf.js 资源 / after-pack）
├── release_app/              # 打包产物
│   ├── Markdown编辑器 Setup 1.0.0.exe   # NSIS 安装程序
│   └── win-unpacked/                   # 免安装绿色版
└── package.json
```

## 开发调试

```bash
npm install
npm run dev:electron   # 启动 Vite 开发服务器 + Electron
```

## 打包为 exe

```bash
npm run dist
```

打包产物输出到 `release_app/` 目录：

- `Markdown编辑器 Setup 1.0.0.exe` —— 安装程序（推荐，安装时自动注册文件关联）
- `win-unpacked/` —— 免安装版，直接双击 `Markdown编辑器.exe` 即可运行

> 说明：`package.json` 已内置打包兼容配置，避免 Windows 非管理员环境下的常见问题：
> - `CSC_IDENTITY_AUTO_DISCOVERY=false`：跳过代码签名自动发现
> - `win.signAndEditExecutable=false`：跳过 exe 签名编辑（规避 `winCodeSign` 符号链接权限错误）
> - 输出目录固定为 `release_app/`（规避旧 `release/` 目录残留文件被系统句柄锁定的清理失败）

> 若打包遇到 `winCodeSign` 符号链接权限错误，可改用：
> ```bash
> npx electron-builder --win nsis --config.win.signAndEditExecutable=false
> ```

## 在资源管理器中打开文件

1. **文件关联**：打开「设置 → 文件关联」→「注册文件关联」。
   注册后（仅写入当前用户注册表 `HKCU`，无需管理员权限）：
   - 双击 `.md / .markdown / .mdown / .mkd` 默认用本编辑器打开
   - 右键文本类文件 →「打开方式」→「选择其他应用」中出现「Markdown 编辑器」
   - 安装版（NSIS）安装时自动注册上述扩展名关联

2. **拖拽到快捷方式**：把文档拖到桌面/开始菜单快捷方式或应用图标即可打开。
   编辑器已运行时文件交给已有窗口（单实例锁，自动前置聚焦）。命令行同样支持：`Markdown编辑器.exe 文档.md`。

## 技术栈

### 基础框架

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| UI 框架 | **Vue 3 + Element Plus** | 界面组件库（工具栏、目录树、对话框、状态栏等） |
| 桌面壳 | **Electron 33** | 跨平台桌面应用，主进程负责文件系统、窗口、协议与系统集成 |
| 构建 | **Vite + TypeScript + vue-tsc** | 前端构建、类型检查与热更新开发 |
| 打包 | **electron-builder**（NSIS） | 产出安装程序与免安装绿色版 |

### 内容渲染（Markdown / HTML / JSON）

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| Markdown 解析 | **marked 18** | 将 Markdown 源码解析为 HTML（GitHub 风格扩展） |
| 代码高亮 | **highlight.js** | 语言高亮，内置 12 套主题动态切换 |
| 数学公式 | **KaTeX** | 行内/块级 LaTeX 公式渲染 |
| 流程图 | **Mermaid 11** | 流程图、时序图、甘特图等图表渲染 |
| 统计图表 | **Chart.js 4** | 以极简 JSON 语法绘制饼图/柱状图/折线图等 |
| PlantUML | **pako**（deflate 压缩 + base64 编码） | 将 PlantUML 源码编码后请求渲染服务（默认官方在线，可配置私有化地址）生成 SVG/PNG |
| HTML 预览 | **iframe 沙箱** + 自动注入 `<base>` | 所见即所得预览本地 HTML，相对路径资源可加载 |
| JSON 视图 | **highlight.js + 自定义树组件** | JSON 语法高亮 + 树形节点编辑视图，源码与树双向同步 |

### Office 预览

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| Office 渲染 | **@open-file-viewer（vue + core，含 officePlugin）** | 在本地渲染 doc/docx/xls/xlsx/ppt/pptx 等 Office 文档 |
| 旧版 .doc | 容器宽度自适应缩放 | A4 比例缩放 + 最大视觉宽度居中，兼容旧版二进制格式 |
| 预览数据源 | 主进程 `mdlocal://` 特权协议 | 通过本地协议读取文件流，无需把文件内容暴露到浏览器网络栈 |

> 说明：Office / 压缩包预览在渲染进程内完成，文件通过 `mdlocal://` 协议读入，不需要第三方在线转换服务。

### 压缩包预览

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| 压缩包浏览 | **@open-file-viewer/core 的 archivePlugin** | 列出包内条目（名称 / 大小 / 目录结构），可预览或下载单个条目 |
| zip | **JSZip** | 完整解析，支持加密包识别 |
| tar / gz / tgz / bz2 / xz | **pako + seek-bzip + xz-decompress** | 解压后按 tar 条目或单文件展示 |
| rar / 7z | 文件头探测 | 浏览器端无法解压，展示格式信息与下载入口 |

> 说明：压缩包解析全部在本地渲染进程完成，不会上传文件；rar / 7z 因浏览器端缺少解压实现，仅展示文件头信息并提供下载。

### 文档转 Markdown

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| 转换引擎 | **@firecrawl/anydoc-wasm** | Rust 库 anydoc 的 WebAssembly 绑定，在 Electron 主进程本地完成转换 |
| 转换方式 | `initSync` 直接加载 wasm 字节 | 无需 fetch，**完全本地转换**，不发起网络请求、文件不离开本机 |
| 支持格式 | Word（doc/docx/docm）、PPT（ppt/pptx/pps/pot/pptm/ppsx/ppsm）、Excel（xls/xlsx/xlsm/xlsb）、OpenDocument（odt/ods/odp）、RTF、EPUB、CSV、PDF | 输出 GitHub Flavored Markdown，CSV 显式指定格式，其余内容自动检测 |
| 嵌入图片 | 文档模型 assets 提取 | 本地模式导出到 `xxx-assets/`；图床模式上传后引用 URL（上传失败自动回退本地） |
| 错误处理 | 错误码映射（needsOcr / encrypted / malformed 等） | 面向用户的清晰提示（如扫描版 PDF 需先 OCR） |

### PDF 阅读与导出

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| PDF 阅读 | **pdfjs-dist 6** + 自绘 PdfViewer | 本地渲染、仅渲染进入视口的页面；页码跳转、缩放、适应宽度 / 整页、文本选择高亮标注、批注面板、阅读进度记忆 |
| 运行时适配 | **polyfill + Blob Worker** | 补齐 Chromium 130 缺失的 ES2025 方法（`Math.sumPrecise`、`Map.getOrInsertComputed` 等）；worker 内联加载，规避 `file://` 下的 Worker CORS 限制 |
| 标注与笔记 | sidecar `原文件.notes.json` | 高亮标注与 Markdown 笔记随文档落盘，可调用 AI 生成笔记 |
| PDF 导出 | **Chromium `printToPDF`**（隐藏窗口） | 矢量输出、文字可选中；主进程统一控制纸张（含自定义毫米尺寸）、方向、边距，页脚页码由打印样式生成 |
| Word 转 PDF | **docx-preview 0.3.7** | 离屏渲染 `.docx`（样式提取 + 图片转 base64），再交给 `printToPDF` |
| 打印 HTML | **marked + KaTeX（字体内联）** | Markdown 复用预览渲染管线，Mermaid 为矢量、图片走 `mdlocal://` |

### 桌面能力

| 模块 | 技术 | 用途 |
| --- | --- | --- |
| 主进程桥接 | **preload.cjs（contextBridge）** | 以 `window.mdAPI` 安全暴露文件/AI/转换等能力，开启 contextIsolation |
| 自定义协议 | `mdlocal://` 特权协议 | 渲染进程安全加载本地图片/PDF/Office 文件 |
| 文件关联 | **fileassoc.cjs**（写入 `HKCU\Software\Classes`） | 注册/取消文件关联与「打开方式」候选，无需管理员权限 |
| AI 请求 | **ai.cjs**（原生 fetch + AbortController） | 统一封装 OpenAI 兼容 / Anthropic / Google Gemini 三种协议 |
| 单实例 | **requestSingleInstanceLock** | 重复启动时把文件转发给已有窗口并聚焦 |
| 进程管理 | **process.cjs**（netstat / tasklist / taskkill / PowerShell） | 按端口、服务名、PID 查询并结束进程；PID 先转数字再拼命令，拦截系统关键进程与应用自身 |
| 外部终端 | **terminal.cjs**（探测 + 分离进程启动） | 在系统终端（Windows Terminal / Ghostty / PowerShell / Git Bash 等）中打开指定目录，拥有完整 TTY |
| 脚本运行 | **script.cjs**（`child_process` + 内置 Node） | 运行 `.js` 文件 / ` ```js` 代码块，输出经 IPC 流式回传；优先系统 `node`，未安装退回 Electron 内置 Node |
| 主题 | **Element Plus dark css-vars + 自定义 dark.css** | `<html class="dark">` 驱动 CSS 变量级切换，跟随系统与多窗口同步 |
