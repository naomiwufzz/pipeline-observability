# 埋点哨兵约定

跑 SDD 研发流水线时，在文本回复里打这几种哨兵行（采集器事后扫）：

- 工作流开始（一次）：`⟦TRACK wf rdc=<spec/plan的topic-slug> id=<8位随机串> title="需求标题"⟧`
- 每阶段进入：`⟦TRACK phase name=<阶段名> nth=<第几次>⟧`（首次可省 nth）
- 每门禁结论：`⟦TRACK gate phase=<阶段名> result=PASS|FAIL|PARTIAL⟧`
- 工作流收尾（可选，一次）：`⟦TRACK wf-end result=SUCCESS|FAIL|ABANDON⟧`

阶段名固定枚举：需求澄清 / 方案设计 / 计划拆解 / TDD实现 / 门禁检查
回退重进某阶段时 nth+1（如「方案设计 第2次」→ nth=2）。
rdc 用当次 spec/plan 的 topic-slug（如 2026-09-24-xxx）。

## wf 可选元信息

`⟦TRACK wf⟧` 支持三个可选字段，CC transcript 无对应硬数据，**打了才在看板显示**，不打则整行隐藏，绝不编造：

- `owner=<负责人>`：如 `owner=张三`
- `doc=<关联文档链接>`：如 `doc=feishu.cn/docx/xxx`
- `days=<投入人天>`：如 `days=5.5`

完整示例：`⟦TRACK wf rdc=2026-09-24-xxx id=a1b2c3d4 title="交易核心链路优化" owner=张三 doc=feishu.cn/x days=5.5⟧`

## wf-end 与任务成功率

`wf-end` 显式标注任务最终结果，喂给看板的「任务成功率」指标：

- `SUCCESS`：需求达成、验收通过
- `FAIL`：未达成、门禁卡死
- `ABANDON`：主动放弃/需求取消

不打 `wf-end` 时，看板按末阶段门禁**推断**任务结果（末阶段 PASS→success、FAIL→fail、其余→unknown），并标注「(推断)」。想要准确成功率就显式打。
