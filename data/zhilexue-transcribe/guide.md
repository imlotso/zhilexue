# 智学课堂转写导入

此扩展沿用 `mofang-question-pack` v1；格式说明和随包的 `validate`、`pack` 工具继续适用。最终 JSON 或含图 ZIP 在智学课堂「录题中心 → JSON / 技能包」导入，进入待审核，老师核对分类与内容后入库。原文没有答案或解析时必须为 `null`，不得猜测或补造。

## 英语单题

在 `metadata.subject` 中填写 `{"label":"英语","basis":"source"}`（来自用户默认值或推断时，`basis` 改为 `user-default` 或 `inferred`）。原文明确的细分题型写入 `metadata.questionType.label`。智学课堂当前识别：听力选择、听力填空、听力判断、听力排序、单项选择、语法选择、语法填空、短文填空（单题）、单词拼写、所给词正确形式填空、句型转换、完成句子、连词成句。其它题型照原文保留，不要强行映射到不相符的题型。

选项使用 `content.options` 的 `{label,text}` 数组；填空、判断等仍按实际题意填写。原始资料包含听力音频时，保留来源说明；目前技能包不导入音频文件，老师须在待审核编辑时上传音频并设置播放次数。不要声称音频已自动导入。

## 材料 + 小题

每个小题单独生成一条 `questions` 记录，题干写自己的问题，选项、答案和解析各自保存。将共有的原文逐题放在该记录 `metadata.extra.zhilexue.material`。同一材料的小题使用相同的 `group_ref` 和从 1 开始的 `group_position`，跨不同材料使用不同的 `group_ref`，每题使用稳定且不同的 `recordKey`。完整示例见 `assets/examples/zhilexue-english.json`。

```json
"metadata": {
  "subject": {"label":"英语","basis":"source"},
  "questionType": {"label":"单项选择","basis":"source"},
  "extra": {"zhilexue": {
    "material":"原文完整材料",
    "group_ref":"阅读材料-1",
    "group_position":1,
    "grade":"七年级"
  }}
}
```

`material` 是原文，不得臆造；`group_ref` 是包内同组标识，不是数据库 ID；`group_position` 为 1–30 的整数；`grade` 仅在资料明确时填写。没有组合关系时不写 `group_ref` 和 `group_position`。图片仍用正式 `assets` / `figures` 打包，不要把网页链接冒充已打包图片。已实现的组题以共同材料和小题关系保存，导入后仍应逐题核对。随包原有工具验证魔方 v1 结构；智学课堂导入端还会校验本扩展字段。

## 十级难度

有明确的十级评分时，可在 `metadata.extra.zhilexue.difficulty_score_10` 填写 1–10 的整数；没有可靠评分就省略。原有 `metadata.difficulty.raw` 仍表示五星难度；同时填写时必须对应（十级 1–2 对应 1 星，3–4 对应 2 星，依次类推）。只有五星或难度文字时，不要猜成具体的十级分数。AI 对难度的判断仅为建议，需由老师在待审核时核对。
