# 历史复习日期哨兵的只读兼容

## 已核实事实

Ubuntu 隔离测试库只读聚合报告5条 next_review 精确为 NaN-NaN-NaN，resolved=0、review_stage=0；updated_at完整时间戳和日期部分均合法5/5。没有读取生产库，没有传递学生身份/答案，没有回填。四轮新日期逻辑已由该测试员实际HTTP验证，覆盖错后+1、复习正确+2/+4及第三次掌握。该报告不证明生产数据受影响。

## 选择与限制

首选只读查询兼容，不推断历史应复习日期、不批量改库。到期计数和复习队列将精确NaN-NaN-NaN视为立即可复习；原本的 user_id、resolved=0、题目审核权限、50题上限均不变。正常作答仍走现有写入逻辑，自然写入正确日期。

使用HEX比较确切字节，兼容MySQL/SQLite，避免MySQL不区分大小写及忽略尾空格的等号规则扩大范围。空值、正常过去/今天/未来日期保持原规则。其他异常文本只审计，不自动修正。

不建议据updated_at直接加1天：其他入口也更新该时间，不能证明它就是最后一次作答时间。也不建议自动设resolved、stage或删除记录。若未来决定回填，须先有可恢复备份、明确批准范围及精确原值条件，在隔离事务预演，保留逐行前像和受影响行数；本补丁不提供或执行回填。

## 只读核验

仅在获准的隔离库运行：

SELECT next_review,resolved,review_stage,COUNT(*) n FROM mistakes WHERE next_review LIKE '%NaN%' GROUP BY next_review,resolved,review_stage;

分别比较同一测试学生的到期计数及队列，验证未掌握哨兵入队，已掌握、他人、未审核题仍不入队；正常未来日期不入队。核验前后原记录字节不变。不要外传身份或答案。生产库仍不得连接/修改。

本机15/15真实SQL/路由回归，内存SQLite设query_only=ON，逐测试前后全表比较；最初14条5红9绿，加入大小写边界后最终15绿。完整takeover623/623及额外脚本exit0，两JS语法通过。尚待独立审阅和MySQL真实兼容复测。

基线为第六轮，新增测试 astra-review-legacy-sentinel-test.js；日志 evidence/legacy。源bank.js在第四至第六轮未改，因此后端可单独在四轮验收副本核验，但完整第七轮增量清单必须接第六轮使用，不得混淆版本。
