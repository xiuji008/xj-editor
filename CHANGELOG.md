# 修改日志

本文件记录 markdown-desktop 的功能变更与修复，最新改动在最上方。

## 2026-11-10

- 新增目录树搜索：侧边栏搜索框输入关键字后，文件名或文本内容命中的文件 / 文件夹会高亮并自动展开，内容命中项带「内容 N」徽标与上下文片段提示（主进程 `dir:searchText` 单次遍历实现，仅搜文本类文件，跳过 node_modules / .git 等重型目录）。

-  Word 预览搜索框增加上下箭头，可在匹配项间循环切换（Enter/Shift+Enter 同步支持），当前匹配橙色高亮、计数显示为「当前/总数」 ｜ src/components/FilePreview.vue
