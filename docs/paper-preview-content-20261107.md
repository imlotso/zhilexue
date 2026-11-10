# R7 试卷预览题面完整性

基线为四轮累计补丁后的 `zhilexue-review-calendar-20261107`。第五轮独立副本，不修改前四轮冻结包。任务书 R7 要求详情预览，R4 要求预览中的公式与题图可见。

此前试卷预览只渲染题干及未引用图片。材料、选项、匹配提示没有展示，而 stemImagesHTML 已把这些字段引用的图片视为已显示，所以部分图片也完全消失。

现在只读预览显示原文材料、完整选项、匹配提示、各字段内的题图和 LaTeX 文本，继续调用现有 MathJax 和图片灯箱绑定。不显示答案、解析、答案专用图。不增加音频播放器，不改变已有播放次数规则。预览仍限前五题；开始作答仍传入完整原始试卷。

验证：10 条执行真实生产模块的合成 DOM 测试，修复前 7 条断言失败、3 条通过，修复后 10/10；test:takeover 597/597 node:test 用例通过，额外脚本退出0；两文件 node --check 通过。没有 HTTP、MySQL、真实浏览器布局或 MathJax 视觉验收。

测试命令：`node --test astra-paper-preview-content-test.js`、`npm run test:takeover`。红绿及全套日志位于 evidence/preview。未使用外部教材、真实题库、AI 或生产服务。
