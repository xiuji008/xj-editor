# CanvasSpec 字段说明

模型输出的 DSL 结构。顶层字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `layout` | string | 否 | `flow-v` / `flow-h` / `mindmap` / `swimlane` / `sequence`。缺省时：有 groups → swimlane，否则 flow-v |
| `theme` | string | 否 | `professional`（默认）/ `colorful` / `mono` / `hand-drawn` |
| `title` | string | 否 | 图的标题，显示在内容上方 |
| `groups` | array | 否 | 分组/泳道，最多 10 个，一层嵌套 |
| `nodes` | array | 是 | 1~40 个节点 |
| `edges` | array | 否 | 0~80 条连线 |

## node

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识，建议 `n1/n2/...` |
| `label` | string | 是 | 主文案，≤18 字的名词/短语（不要整句话） |
| `sub` | string | 否 | 副文案（补充说明，如「≤ 2 天」「负责人：张三」） |
| `shape` | string | 否 | `rect`（默认直角）/ `rounded`（圆角，起止推荐）/ `diamond`（判断）/ `ellipse`（椭圆） |
| `tone` | string | 否 | `neutral`（默认）/ `start` / `end` / `ok` / `warn` / `error` / `highlight` |

## edge

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `from` / `to` | string | 是 | 引用 node id，不可自环 |
| `label` | string | 否 | 连线文案（如分支条件「是/否」） |
| `kind` | string | 否 | `solid`（默认）/ `dashed`（可选路径）/ `dotted`（弱关联） |

## group

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` / `label` | string | 是 | 分组标识与名称 |
| `children` | array | 是 | 成员 node id（每个节点最多属于一个分组） |

## 示例（泳道）

```json
{
  "layout": "swimlane",
  "theme": "professional",
  "title": "请假审批",
  "groups": [
    { "id": "g1", "label": "员工", "children": ["n1"] },
    { "id": "g2", "label": "主管", "children": ["n2", "n3"] },
    { "id": "g3", "label": "HR", "children": ["n4"] }
  ],
  "nodes": [
    { "id": "n1", "label": "提交请假单", "shape": "rounded", "tone": "start" },
    { "id": "n2", "label": "审批" },
    { "id": "n3", "label": "是否驳回？", "shape": "diamond" },
    { "id": "n4", "label": "归档", "shape": "rounded", "tone": "end" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" },
    { "from": "n3", "to": "n4", "label": "通过" },
    { "from": "n3", "to": "n1", "label": "驳回", "kind": "dashed" }
  ]
}
```

## 示例（时序）

```json
{
  "layout": "sequence",
  "theme": "professional",
  "title": "登录流程",
  "nodes": [
    { "id": "u", "label": "用户", "shape": "rounded" },
    { "id": "f", "label": "前端" },
    { "id": "s", "label": "服务端" }
  ],
  "edges": [
    { "from": "u", "to": "f", "label": "输入账密" },
    { "from": "f", "to": "s", "label": "POST /login" },
    { "from": "s", "to": "f", "label": "token", "kind": "dashed" },
    { "from": "f", "to": "u", "label": "跳转首页" }
  ]
}
```
