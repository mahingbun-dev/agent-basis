---
name: event-delivery-workflow
description: 活动策划全流程 SOP(婚礼/周年庆/发布会/峰会/开业/团建/展会通用)。接到活动策划、排期、物料、风险、复盘类任务的默认入口;预算与比选走 budget-sourcing-approval。
metadata:
  evo:
    entries:
      - { id: S-event-delivery-workflow-001, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
      - { id: S-event-delivery-workflow-002, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
      - { id: S-event-delivery-workflow-003, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
---
## 澄清(任何活动任务先过这一步)

<!-- E: S-event-delivery-workflow-001 -->
1. 五要素逐项确认:人数 / 预算(硬顶还是软顶)/ 日期与时长 / 场地(已定还是待选)/ 合规红线;
2. 缺项先问,不猜;预算必须问清是否含税、是否含 AV 与服务费;
3. 把约束原样落进 [需求自查表](references/brief-checklist.md),后续交付物逐条对照。
<!-- /E -->

## 交付物(文件落地,不在对话里说一遍)

<!-- E: S-event-delivery-workflow-002 -->
1. 策划案(out/*.md 草稿,可转 docx):当日流程 / 分项预算 / 分工 / 预案四章齐备;
2. 排期表(out/*.csv,环节,开始,结束,负责人):分钟级,环节不重叠、不超时段,
   交付前用 schedule_conflict_check 自查;
3. 物料清单(out/*.csv,物料,数量,单价,小计):小计=数量×单价,末行合计;
4. 口径示例见 [交付物模板](references/deliverable-templates.md)。
<!-- /E -->

## 风险与复盘

<!-- E: S-event-delivery-workflow-003 -->
1. 风险预案至少覆盖天气/设备/嘉宾三类,每类给概率/影响评估、应对措施、责任人;
   户外活动先查 weather_query,降水概率>40% 必须给 B 计划与切换时点;
2. 复盘报告:数据引用与输入逐字一致(到场率/满意度/预算执行),结构 = 数据 → 亮点 →
   问题 → 改进行动(每条含负责人与截止);复盘只分析,不改任何预算、不发任何付款。
<!-- /E -->
