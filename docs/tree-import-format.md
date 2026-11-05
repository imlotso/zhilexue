# 树导入格式（zhilexue-tree v1）

给"本地电脑 agent 从洋葱 / 组卷网采回来的树"用的统一格式，也是后台「知识树管理 → 导出 JSON / 导入 JSON」用的格式。导入是**幂等**的：同一个文件导多少遍结果都一样，只增不删。

## 一棵树

```json
{
  "format": "zhilexue-tree",
  "version": 1,
  "kind": "textbook",
  "subject": "数学",
  "stage": "primary",
  "edition": "苏教版",
  "name": "苏教版数学·教材章节",
  "source": "yangcong:2026-11",
  "nodes": [
    { "name": "三年级", "children": [
      { "name": "上册", "children": [
        { "name": "一 混合运算与数量关系（一）", "children": [
          { "name": "混合运算与数量关系", "children": [
            { "name": "混合运算与数量关系" },
            { "name": "列算式解决问题" }
          ] }
        ] }
      ] }
    ] }
  ]
}
```

一个文件可以是**单棵树对象**，也可以是**树数组**（`[ {...}, {...} ]`，章节树和知识点树可以放在一个文件里）。

### 顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `"zhilexue-tree"` |
| `version` | 是 | 目前 `1` |
| `kind` | 是 | `textbook`（章节树：版本 → 年级 → 册 → 单元/章 → 小节 → 知识点）或 `knowledge`（知识点树：模块 → 主题 → 知识点 → 细分知识点） |
| `subject` | 是 | 学科，如 `数学` `英语` `物理` `化学` |
| `stage` | 是 | `primary` 小学 / `junior` 初中 / `senior` 高中 |
| `edition` | textbook 必填 | 教材版本：`苏教版`（小学数学）、`苏科版`（初中数学、初中物理）、`译林版`（英语）、`沪教版`（初中化学）。知识点树可留空 `""` = 通用（不分版本） |
| `name` | 否 | 树名；新建树时用，缺省为「<版本><学科>·教材章节」/「<学科>·知识点（<学段>）」。树已存在时**不会**改名 |
| `source` | 否 | 来源标记，如 `yangcong:2026-11`、`zujuan:2026-11`；新建树时写入 `bank_trees.source`，缺省 `import` |
| `nodes` | 是 | 非空数组，节点见下 |

### 节点

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 节点名，最长 120 字（超出截断）；首尾空格会去掉 |
| `children` | 否 | 子节点数组，最多 12 层 |
| `code` | 否 | 外部编号（如洋葱 / 组卷网的节点 id），≤100 字，存在 `bank_tree_nodes.code` |
| `note` | 否 | 备注，存在 `bank_tree_nodes.note` |

节点也可以直接写成字符串（只有名字，没有 code / note / children）：`"children": ["小节一", "小节二"]`。同一个文件里节点总数上限 60000。

## 导入规则

1. 按 `kind + subject + stage + edition` 找树；没有就新建（所以同一 学段+学科 下每个版本一棵，互不影响）。
2. 节点**按路径合并**：同一个父节点下同名节点视为同一个，不重复建；只新增，不删除、不改名、不移动。已有节点的 `code` / `note` 为空时才补上。
3. 新增的节点排在同级现有节点之后，并保持文件里的先后顺序（`sort`）。
4. 同一个文件重复导入：新增 0。
5. 整个文件先校验：有一棵树格式错，整个文件都不写库，错误信息里带"第几棵树 / 哪个节点"。
6. 注意"路径"是靠名字对的：不同年级下都有"上册"是两个节点（路径不同）；同一父节点下名字完全相同的两个节点会被合并成一个。

## 三种导入方式

- **后台**：`/admin/#/ktree` →「导入 JSON」。先预检（显示将新增多少节点）再确认。导出同一页的「导出 JSON」，格式相同，导出再导入新增 0。
- **接口**：`POST /api/admin/bank/mf/trees/import`，body 是上面的 JSON（对象或数组）；或 multipart 上传 `.json`（字段 `file`）。`?dry=1` 只统计不写库。返回 `{results:[{tree_id,name,kind,subject,stage,edition,created_tree,added,existing,total}], added, existing}`。导出：`GET /api/admin/bank/mf/trees/:id/export`。
- **命令行**（给本地 agent 采完直接导入）：

  ```bash
  node scripts/import-trees.js <文件或目录> [更多文件或目录…] [--dry-run]
  ```

  目录会递归读取里面所有 `.json`。开头打印目标库名；每棵树打印 新增 / 已存在 / 文件共 多少节点；`--dry-run` 只统计。目标库由环境变量 `MYSQL_DATABASE` 等决定（见 `docs/architecture.md`）。**写真实库前先备份**，先 `--dry-run` 看一遍。

## 草稿数据

`data/trees/draft/` 下是物理（苏科版）、化学（沪教版）的**初版草稿**，树名带「（草稿·待核对）」、`source` 为 `draft:needs-verify`。它们不会随服务启动自动导入，需要时手动 `node scripts/import-trees.js data/trees/draft`。教材目录要由本地电脑 agent 对照组卷网 / 洋葱核对后，用同样的格式导入正式版（建议新建 `edition` 相同的树前先在后台删掉草稿树，或让正式文件沿用草稿的 `edition` 和 `name` 直接合并）。
