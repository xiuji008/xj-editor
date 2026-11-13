# 风格令牌（style tokens）

`theme` 决定整体风格，`tone` 决定单个节点的语义色。

## theme

| theme | 线条 | 适用 |
|---|---|---|
| `professional` | 精细实线（roughness 1），低饱和底色 | 默认；商务/工作文档 |
| `colorful` | 同 professional，底色更明快 | 教学、演示 |
| `mono` | 深灰描边，全部白底 | 打印、正式交付物 |
| `hand-drawn` | 手绘抖动线条（roughness 2 + hachure 填充） | 头脑风暴、非正式草图 |

## tone → 颜色语义

| tone | 语义 | professional 配色 |
|---|---|---|
| `start` | 起点/入口 | 绿底 `#d8f3dc` / 深绿描边 |
| `end` | 终点/出口 | 红底 `#ffe3e3` / 深红描边 |
| `ok` | 通过/成功 | 青底 `#c3fae8` |
| `warn` | 注意/人工介入 | 黄底 `#fff3bf` |
| `error` | 异常/失败 | 浅红底 `#ffc9c9` |
| `highlight` | 重点/高亮 | 蓝底 `#d0ebff` |
| `neutral` | 普通步骤（默认） | 灰底 `#e9ecef` |

## 使用建议

- 一张图里 tone 不要超过 4 种，否则失去强调作用；
- 判断分支的两个出口：`ok`（是）/ `error` 或 `warn`（否）；
- `mono` 主题下 tone 只保留形状语义，颜色全部一致，黑白打印安全；
- 分组容器配色由系统按主题自动选择，无需指定。
