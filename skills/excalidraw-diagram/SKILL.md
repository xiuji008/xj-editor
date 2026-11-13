---
name: excalidraw-diagram
description: 把自然语言或文档结构画成 Excalidraw 白板图（流程图、架构图、时序图、泳道图、思维导图）。当用户要求"画图/画个流程/画个架构/白板上画/梳理成图"时使用。
version: 1.0.0
allowed-tools: whiteboard_get_scene, whiteboard_apply_elements, skill_read_reference
targets: [whiteboard]
---

# 何时使用

- 用户想「画一张图」「梳理流程」「画架构图/时序图/泳道图/思维导图」；
- 用户粘贴了一段大纲、步骤、组织结构，希望可视化；
- 用户在白板上已有内容，希望围绕它补充图示。

# 执行步骤

1. 若需了解画布现状，调用 `whiteboard_get_scene`（空画布 elementCount=0）。
2. 拿不准某种布局怎么组织节点/边时，调用 `skill_read_reference` 读 `references/layout-recipes.md`。
3. 构造 **CanvasSpec**（字段见 `references/canvas-spec.md`），调用 `whiteboard_apply_elements`。
4. 工具只生成预览，**不会直接写入画布**；用户会在界面上确认插入。调用完成后用一句话告诉用户查看预览并点击插入，**不要重复调用工具**。

# 输出规则

- 只通过 `whiteboard_apply_elements` 的 `spec` 参数输出图，不要在回复正文里粘贴 JSON。
- 一次回答只调用一次 `whiteboard_apply_elements`；需要修改时重新生成完整 spec 再调用一次。

# 布局选型

| 场景 | layout |
|---|---|
| 步骤/审批流/因果链，强调先后顺序 | `flow-v`（竖排）或 `flow-h`（横排，节点名较长时） |
| 总分结构、层级展开、头脑风暴 | `mindmap` |
| 按角色/部门/阶段分职责 | `swimlane`（配合 groups） |
| 对象之间的消息交互顺序 | `sequence` |
| 不确定且有分组 | `swimlane`；无分组则 `flow-v` |

# 主题与色调

- `professional`（默认）：低饱和底色，商务场景；
- `colorful`：明快配色，教学/演示；
- `mono`：黑白，打印/正式文档；
- `hand-drawn`：手绘线条感。

节点 `tone` 语义：`start` 起点（绿）、`end` 终点（红）、`ok` 通过（青）、`warn` 注意（黄）、`error` 异常（红）、`highlight` 重点（蓝）、`neutral` 普通（灰）。

# 检查清单（生成 spec 前自查）

- [ ] 每个 node 有唯一 `id` 和非空 `label`；
- [ ] 每条 edge 的 `from`/`to` 都存在于 nodes，且不自环；
- [ ] groups 的 children 都存在于 nodes，且一个节点只属于一个分组；
- [ ] 节点 ≤ 40、边 ≤ 80、分组 ≤ 10、label ≤ 18 字（超限时建议用户拆图，不要硬塞）；
- [ ] label 是短名词/短语，不是整句话；补充信息放 `sub`（副文案）；
- [ ] 判断类节点用 `shape: diamond`；起止用 `rounded` + `tone: start/end`。

# 好例子

用户说「用户提交申请，主管审批，金额大于 5 万要财务复核，否则直接通过」：

```json
{
  "layout": "flow-v",
  "theme": "professional",
  "title": "采购审批流程",
  "nodes": [
    { "id": "n1", "label": "提交申请", "shape": "rounded", "tone": "start" },
    { "id": "n2", "label": "主管审批" },
    { "id": "n3", "label": "金额 > 5 万？", "shape": "diamond" },
    { "id": "n4", "label": "财务复核", "tone": "highlight" },
    { "id": "n5", "label": "通过", "shape": "rounded", "tone": "end" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" },
    { "from": "n3", "to": "n4", "label": "是" },
    { "from": "n3", "to": "n5", "label": "否" },
    { "from": "n4", "to": "n5" }
  ]
}
```
