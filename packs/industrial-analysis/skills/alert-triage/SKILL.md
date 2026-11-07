---
name: alert-triage
description: 工业预警研判纪律(首场景③:预警规则与记录→分级→处置建议)。凡涉及告警列表、预警分级、处置与升级建议,必须走本 SOP:读规则与记录(alert_list/alert_records)→ 分级 → 处置建议;写回仅限预警记录表,对外通报必须确认(R2)。
metadata:
  evo:
    entries:
      - { id: S-alert-triage-001, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
      - { id: S-alert-triage-002, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
      - { id: S-alert-triage-003, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
---
## 读规则与记录(alert_list / alert_records)

<!-- E: S-alert-triage-001 -->
1. alert_list 拉当前告警(可按 severity / asset / status 过滤):先看规则 id(RULE-*)、
   触发值与限值、触发时刻,不凭印象分级;
2. 历史处置看 alert_records(预警记录表):同类告警此前怎么处置、谁处理、是否复发;
3. 数据与规则只经 MCP 读取;不要求贴库凭据、不直连达梦。
<!-- /E -->

## 分级与处置建议

<!-- E: S-alert-triage-002 -->
1. 分级对齐规则库:P0(立即处置 / 安全联锁)→ P1(限产 / 重点监控)→ P2(计划检修);
   规则库没覆盖的情形,给「建议分级 + 依据」并明说待确认,不硬套;
2. 处置建议给可执行步骤:即时动作 / 参数核查 / 升级路径(班组→工艺→设备→调度),
   每步带依据出处(规则 id / 测点 + 时间窗 / 知识条目);
3. 不确定不说死:影响面拿不准就写「待现场确认」,不替现场拍板;
4. 必要时回查 timeseries_query 拿告警前后的时序佐证(趋势是否持续恶化),引用窗口。
<!-- /E -->

## 记录与对外通报(红线:写回仅限预警记录表;对外发送 R2)

<!-- E: S-alert-triage-003 -->
1. 研判结论写回 alert_records(alertId / treatment / outcome / note)——
   这是唯一放行的达梦写路径(R1,静默 + 事后变更卡片);其余任何库表写动作 deny;
2. 对外通报(短信 / 邮件 / 群发 / 报告下发)是 R2:起草全文(收件人 / 口径 / 依据)
   后必须确认再发,withhold-或-补偿,不做裸发射;
3. 分级口径与红线速查见 [分级与红线](references/severity-and-redlines.md)。
<!-- /E -->
