---
name: timeseries-query
description: 工业时序查询纪律(首场景①:时序查询/趋势与异常摘要)。凡涉及测点数据、温度/压力/振动曲线、趋势分析、越限统计,必须走本 SOP:TDengine 检索(经 MCP)→ 趋势/异常摘要 → 结论带出处与时间窗;绝不编造测点数据。
metadata:
  evo:
    entries:
      - { id: S-timeseries-query-001, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
      - { id: S-timeseries-query-002, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
      - { id: S-timeseries-query-003, helpful: 0, harmful: 0, updated: 2026-11-07, origin: init }
---
## 检索(TDengine MCP → timeseries_query)

<!-- E: S-timeseries-query-001 -->
1. 先定四要素再查:测点 tag / 资产 / 时间窗 / 聚合口径(原始点 or 按小时聚合),
   缺哪个先问清,不猜;测点名不确定时核对测点台账(工具返回的 tag 目录),绝不臆造测点名;
2. timeseries_query 只经 MCP 检索:入参 tag + 起止时间(可选限值做越限判定),
   返回值带单位与数据来源声明;不直连库、不要求贴库凭据、不拼接 SQL;
3. 查不到 = 明说查不到(测点不存在 / 窗口无数据 / 口径不明),不编造、
   不拿邻近测点或旧窗口数据冒充;样例数据必须声明「样例」。
<!-- /E -->

## 趋势与异常摘要

<!-- E: S-timeseries-query-002 -->
1. 趋势:首末值与方向、峰值/谷值及出现时刻,全部标注时间窗;环比/同比需另取窗口,
   不得拿单窗口脑补「历史水平」;
2. 异常:越限次数与时刻(对照限值,限值来自预警规则库 RULE-*,引用规则 id);
   低限类异常(如流量骤降)不在越限(上限)统计里 —— 必须单独点出,不能只说「无越限」;
3. 摘要三行式:现象(带时间窗)→ 数据出处(测点 + 窗口 + 来源声明)→ 待确认项。
<!-- /E -->

## 交付与红线

<!-- E: S-timeseries-query-003 -->
1. 结论带出处与时间窗,不确定不说死:数据只覆盖到某时点就写「数据截至某时点」,
   缺口写「待确认」,不用推测填空;
2. 时序查询是 R0 只读:不得借查询通道做任何写入;达梦写权限仅限预警记录表
   (alert_records 单点白名单,其余写动作 deny);
3. 参数口径速查见 [检索口径](references/query-conventions.md)。
<!-- /E -->
