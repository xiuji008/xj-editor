# 修改日志

> 每次修改记录一行：二级标题日期    内容：改了啥 。


## 2026-11-13

-   Git 面板推送支持「远端仓库还没有该分支」场景（空仓库首推不再卡壳）：此前仅识别「从未设置上游」（status.upstream 为空）才提示设置上游，而 clone 后远端只有空项目、没建分支时 status 显示 origin/master [gone]（upstream 非空），推送既不带 --set-upstream 也没有任何提示。改动：主进程 git.cjs parseBranchLine 解析 status -b 分支行 [gone] 标记、readBranchInfo 在 rev-parse @{u} 失败但 branch.<name>.merge 配置存在时判定上游失效，status 返回体新增 upstreamGone；push() 新增 isUpstreamGone 检测，上游失效时自动补 --set-upstream 重建本地↔远端跟踪关系（显式 remote+refspec 本身就会在远端建分支），并新增游离 HEAD 守卫（refspec=HEAD 时拒绝推送，避免在远端创建名为 HEAD 的分支）；GitPanel.vue doPush 判定条件改为 !upstream || upstreamGone，确认弹窗文案区分两种情况（「远程仓库中还没有该分支，推送时自动创建远程分支并设置上游」），成功提示区分「已推送并在远程创建了分支」，推送按钮 tooltip 同步提示。env.d.ts GitStatus 补 upstreamGone 字段

-   修复「资源管理器 Ctrl+C 复制文件/文件夹后，在目录树选中目录按 Ctrl+V 无反应」：原粘贴只消费应用内剪贴板 clipNode（目录树内复制才有值），外部复制的文件路径完全没读取。新增主进程 readFilesFromClipboard（Windows 读 clipboard.readBuffer('FileNameW')（CF_HDROP 的 UTF-16 视图）按 \0 拆分、macOS 读 NSFilenamesPboardType plist 提取 string、Linux 读 gnome-copied-files / uri-list 解析 file:// URL，统一 normalizeExistingPaths 过滤有效路径）+ IPC clipboard:readFiles + preload mdAPI.readFilesFromClipboard；App.vue pasteTreeFile 改为应用内剪贴板优先、为空时回读系统剪贴板（支持多个文件逐个 copyPath 粘贴），Ctrl+V 分支去掉 clipNode 空值守卫

-   修复 HTML 预览相对路径图片/资源全部失效问题（如 `<img src="images/side.png">` 不显示）。两个根因都在 HtmlEditor 的 `<base>` 注入逻辑：① toFileUrl 在 Windows 下生成 file:////D:/xj/site（4 个斜杠，会被当 UNC 路径）且目录基准缺结尾斜杠（相对路径会丢最后一段目录，层级越深偏得越多），现统一生成 file:///D:/xj/site/ 并对 # ? 做转义；② 完整 HTML 文档（带 DOCTYPE/html 标签）原来原样返回不注入 base，现会向 head（无 head 则 html 标签后、再兜底文档开头）注入 base href，文档自带 base 或无文件目录时不注入。Node WHATWG URL 实测多层级目录下 images/xxx、../xxx、css/xxx 均解析到正确绝对路径

## 2026-11-12

-   富文本复制改为单通道语义（对齐 markdown-nice）：剪贴板里就是 HTML 本身——text/html 与 text/plain 均放 HTML 字符串，不再放 Markdown 源码。粘到公众号/知乎/掘金得到排版，粘到 txt/记事本得到 HTML 源文本，任何目标都不会再出现 Markdown 源码；copyRichHtml 签名收敛为 (html)，最坏兜底（只能写纯文本）也写 HTML 源文本

-   排查「复制后粘贴出来全是 Markdown 源码」：端到端复现验证（dev http:// 与生产 file:// 构建、真实 UI 点击、主进程 clipboard.readHTML + 外部 PowerShell Get-Clipboard 读 CF_HTML）证明当前代码每个富文本菜单项都会把合法 CF_HTML 写进系统剪贴板，外部应用可正常读取——代码链路无问题。防御性增强：copyRichHtml 返回 {ok, mode}，最坏兜底（IPC+execCommand+ClipboardItem 全部失败只能写纯文本）不再静默报「复制成功」，而是弹「剪贴板写入受限，本次只复制了 Markdown 源码」警告（CopyMenu/CopyThemeDialog 同步适配），便于定位这类环境问题
-   复制到公众号/知乎/掘金样式丢失错乱修复（参考 markdown-nice 方案重做样式内联）：原自研 cssInline 内联器会跳过伪元素、把 `>` 降级成后代选择器（pre code 被行内 code 样式误覆盖）、不做属性继承与选择器优先级排序，粘贴到公众号/知乎后样式大量缺失。改为：新增依赖 juice（markdown-nice 同款 CSS 内联库），复制管线 = DOM 清理（canvas 转 PNG / 去装饰 / checkbox 转对勾，不变）→ resolveCssVars 先把 CSS 变量解析成字面值（新增 utils/cssInline.ts#resolveCssVars，juice 不解析 var() 且公众号不支持）→ juice.inlineContent(html, css, {inlinePseudoElements: true, preserveImportant: true}) 压成 style 属性 → 平台处理。掘金格式从「复制 Markdown 源码」改为复制富文本（对齐 markdown-nice：掘金编辑器粘贴 HTML 保留排版），并新增 solveJuejinCode 修正代码块换行（pre 内 `<br>`→`\n<span/>`、`&nbsp;`→空格）。长图 PNG 同步改用 juice 内联结果重写舞台 DOM（html-to-image 读计算样式）。juice 失败时退回原始 DOM 序列化不中断复制。vite build 通过；浏览器内冒烟（dev + eval buildCopyHtml）：公众号/知乎/掘金三平台产物样式全内联、无 var() 残留、代码块背景色正确

-   修复富文本复制粘贴出来是 Markdown 源码的问题：桌面端富文本复制（公众号/知乎/纯 HTML）改为优先走主进程 IPC 直写系统剪贴板——新增 ipcMain.handle('clipboard:writeRich')（clipboard.write({html,text})，主进程无 DOM 用正则剥标签生成 text/plain 兜底）+ preload 暴露 mdAPI.writeRichHtml；渲染进程 copyRichHtml 在有 mdAPI 时直接 IPC，不再依赖 execCommand('copy') 的文档焦点/用户手势（此前任一不满足就退化成纯文本=Markdown 源码）。Electron 冒烟实测（smoke 脚本 executeJavaScript + 主进程 clipboard.readHTML）：剪贴板 text/html 为完整内联样式 <section id="md-root">，text/plain 为 Markdown 源码。同时重排复制菜单：第一项改为「复制为公众号格式」（按记住的主题一键直复制，不弹窗），「公众号主题设置…」单独成项，Markdown 源码移到最后一项，避免误复制成 md

-   预览区右上角新增「复制」入口（CopyMenu.vue），支持一键复制为多平台格式：复制 Markdown 源码 / 复制为公众号格式（可选排版主题）/ 复制为知乎格式 / 复制为掘金格式（Markdown，编辑器自动识别）/ 复制为纯 HTML / 复制为长图 PNG。公众号主题选择弹窗（CopyThemeDialog.vue）内置 12 套主题（默认 / 橄榄绿 / 橙心 / 暗夜 / 樱花粉 / 海盐蓝 / 葡萄紫 / 森林绿 / 赤霞红 / 暖阳黄 / 极简灰 / 靛青），选择记忆在 localStorage（键 md-copy-theme）。技术实现：新增 utils/copyThemes.ts（主题基线 + 12 套主题样式，全部 #md-root 前缀 + CSS 变量）、utils/cssInline.ts（自研迷你 CSS 内联器，把主题样式压成 style 属性以适配微信编辑器只认内联样式的限制，自动解析 var()、跳过伪类伪元素）、utils/clipboardCopy.ts（隐藏容器 + 选区 + execCommand('copy') 主路径，ClipboardItem 兜底）、utils/copyExport.ts（复制管线：克隆预览 DOM（canvas 转 PNG 防图表空白）→ 清理交互装饰（代码块按钮 / 语言栏 / 任务列表 checkbox 转对勾字符）→ 内联样式 → 平台适配；长图走 html-to-image 截图（新增依赖 html-to-image@1.11.13，pixelRatio 2、750px 宽），剪贴板写图失败时兜底弹系统保存对话框）。掘金/知乎/HTML 复制与公众号共用同一条管线，知乎格式用中性样式弱化主题装饰。本地图片不做处理（原样保留 src，粘贴到公众号后需重新上传）

-   关于弹窗 logo 确认使用品牌 B 方案（brand/icons/B/xj-b-icon-light.svg，与打包 build/icon.ico=xj-b-icon.ico 同方案）
-   新增「帮助」体系（工具栏 ? 下拉：帮助文档 F1 / 检查更新 / 关于 XJ-Editor）：帮助文档弹窗（HelpDialog.vue）左侧章节导航 + 复用应用自身 Markdown 渲染器（renderMarkdown + enhanceRenderedDom）渲染内置 md 文档（src/components/help/ 下 4 个文件：功能介绍 / 快捷键 / Markdown 语法 / 代码块语言，其中 mermaid、chart 示例为真实渲染演示）；「关于」弹窗（AboutDialog.vue）展示当前版本（app.getVersion）+ 检查更新按钮（autoCheck 属性支持菜单直达自动检查）；检查更新走主进程 net.fetch 请求 GitHub Releases latest API（12s 超时，点分版本号比较），发现新版本可一键跳转发布页（shell.openExternal，仅 http/https）。新增 IPC：app:getVersion / app:checkUpdate / app:openExternal，preload 暴露 appVersion / checkUpdate / openExternalUrl
-   修复覆盖安装必失败问题：安装包 artifactName 由 xj-editor.exe 改为 xj-editor-setup.exe。根因＝安装包与主程序（executableName xj-editor.exe）同名，升级安装时旧版卸载器静默执行 taskkill /im "xj-editor.exe"（本意杀旧版主程序），把 PID 不同的新安装器一并强杀，导致「卸载完旧版后窗口自动关闭、需第二次安装才能成功」；旧包内卸载器无法修补，只能让新安装包与主程序不同名以避开映像名匹配
-   明亮模式下 Markdown 编辑区（源码面板 + 文本框）底色改为与白板一致的浅灰页面底色，并做成可配置：「设置 → 外观 → 编辑区底色」内置 6 种浅色底（浅灰 / 纯白 / 米白 / 豆绿 / 淡蓝 / 暖黄），色块选择即时生效并记忆（localStorage 键 md-editor-bg，经 CSS 变量 --md-editor-bg 下发，新增 utils/editorBackground.ts）；仅浅色模式生效，深色模式保持原有深色底
-   目录树右键「新建文件」弹窗新增文件类型下拉：默认 Markdown，可选 txt/json/白板(.board)/sql/html/xml/yaml/csv；切换类型自动同步文件名扩展名，手动输入带扩展名的名字则尊重输入
-   Markdown 工具栏顺序调整：「更多」下拉箭头移到「表情」按钮右侧；表情面板移除会显示成方框的 🥲（U+1F972，本机 emoji 字体不含该字形）
-   新增英文版 README（README.en.md，与中文版内容对齐），中文 README 顶部互链

## 2026-11-11

-   Markdown 内嵌白板支持自动缩放适配：挂载后 zoom-to-fit 把全部内容缩小到展示框大小（scrollToContent fitToViewport，留 15% 边距）
-   修复白板打开报「Excalidraw 组件加载失败」：组件经 React.memo 包装后是对象而非函数，桥接层校验误判；同时 React 渲染原语改存模块级变量，不再挂载到冻结的 ESM 命名空间上

-   Markdown 工具栏新增「表情」按钮：弹出分类表情面板（最近/笑脸/手势/人物/动物/自然/食物/活动/旅行/物品/符号），点击插入光标处并记忆最近使用（localStorage）

- 打包产物统一命名为 xj-editor.exe（安装包 artifactName + 应用主程序 executableName）

-  白板功能 P0+P1：新增 .board 白板文件类型（Excalidraw 编辑/主题跟随/Ctrl+S+自动保存/导出 PNG·SVG），支持 Markdown ```whiteboard 块内嵌只读渲染



## 2026-11-10

- 新增目录树搜索：侧边栏搜索框输入关键字后，文件名或文本内容命中的文件 / 文件夹会高亮并自动展开，内容命中项带「内容 N」徽标与上下文片段提示（主进程 `dir:searchText` 单次遍历实现，仅搜文本类文件，跳过 node_modules / .git 等重型目录）。

-  Word 预览搜索框增加上下箭头，可在匹配项间循环切换（Enter/Shift+Enter 同步支持），当前匹配橙色高亮、计数显示为「当前/总数」 
