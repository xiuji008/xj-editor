# 修改日志

> 每次修改记录一行：二级标题日期    内容：改了啥 。


## 2026-11-11

-   Markdown 内嵌白板支持自动缩放适配：挂载后 zoom-to-fit 把全部内容缩小到展示框大小（scrollToContent fitToViewport，留 15% 边距）
-   修复白板打开报「Excalidraw 组件加载失败」：组件经 React.memo 包装后是对象而非函数，桥接层校验误判；同时 React 渲染原语改存模块级变量，不再挂载到冻结的 ESM 命名空间上

-   Markdown 工具栏新增「表情」按钮：弹出分类表情面板（最近/笑脸/手势/人物/动物/自然/食物/活动/旅行/物品/符号），点击插入光标处并记忆最近使用（localStorage）

- 打包产物统一命名为 xj-editor.exe（安装包 artifactName + 应用主程序 executableName）

-  白板功能 P0+P1：新增 .board 白板文件类型（Excalidraw 编辑/主题跟随/Ctrl+S+自动保存/导出 PNG·SVG），支持 Markdown ```whiteboard 块内嵌只读渲染



## 2026-11-10

- 新增目录树搜索：侧边栏搜索框输入关键字后，文件名或文本内容命中的文件 / 文件夹会高亮并自动展开，内容命中项带「内容 N」徽标与上下文片段提示（主进程 `dir:searchText` 单次遍历实现，仅搜文本类文件，跳过 node_modules / .git 等重型目录）。

-  Word 预览搜索框增加上下箭头，可在匹配项间循环切换（Enter/Shift+Enter 同步支持），当前匹配橙色高亮、计数显示为「当前/总数」 
