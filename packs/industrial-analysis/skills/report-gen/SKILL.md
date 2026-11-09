---
name: report-gen
description: 工业报告生成纪律(首场景④:实查成稿→异步任务→产物引用→确认外发)。凡涉及报告/日报/分析报告产出、异步渲染任务与产物下载,必须走本 SOP:每个数字带数据出处与时间窗 → report_jobs 提交(status 进度回报/fetch 产物引用)→ 对外下发必须确认(R2);产物≠已发送。
metadata:
  evo:
    entries:
      - { id: S-report-gen-001, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
      - { id: S-report-gen-002, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
      - { id: S-report-gen-003, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
---
## 成稿纪律(每个数字带数据出处与时间窗)

<!-- E: S-report-gen-001 -->
1. 报告里每个数字标注来源:测点 + 时间窗(timeseries_query 实查)/ 告警 id + 规则 id
   (alert_list)/ 知识 citation + 版本(kb_search);汇总口径写明(窗口、聚合方式、
   限值来源 RULE-*),限值不自行发明;
2. 样例数据必须声明「样例」,不得冒充实测;低限类异常单独点出,不给「全天正常」
   笼统结论;缺口写「待确认」,不用推测填空;
3. 结论先行,待确认项集中列出;报告时间窗贯穿全文(标题、出处、任务提交三处一致)。
<!-- /E -->

## 异步任务(report_jobs;图纸⑦ 任务队列+进度回报+产物落存储+前端下载)

<!-- E: S-report-gen-002 -->
1. 成稿后 submit 异步渲染任务:标题 + 报告时间窗 + 出处清单(sources,逐条 kind+ref)
   + 草稿路径;缺时间窗或缺出处任务桩直接拒收(fail-closed)= 报告缺出处不通过 ——
   被拒是红线生效不是故障:补齐后重新提交,不绕过、不改桩;
2. 提交返回 job id:以 job id 追踪,进度用 status 查询(完成有回报,不 busy-poll、
   不空转等待,等待期做独立步骤,对齐 tool-jobs 语义);任务未完成不编造产物;
3. completed 后 fetch 产物引用:产物落本地对象存储桩(路径 stub://objects/…,
   MiniO 接入后换存储后端,接口不变);交付说明必须带 job id + 产物引用 + 草稿路径,
   前端下载链按产物引用走。
<!-- /E -->

## 交付与红线(产物≠已发送)

<!-- E: S-report-gen-003 -->
1. 对外下发报告(邮件 / 群发 / 报告下发)是 R2:起草全文 → 确认 → 再发,withhold-或-补偿;
   report_jobs 产物只是内部渲染件,fetch 成功≠已发送,不做裸发射;
2. 产物引用如实:artifactId、storagePath、时间窗、出处清单只来自工具返回,不虚构;
   出处清单渲染进产物页脚,引用逐字不改写;
3. 速查见 [出处与异步任务](references/report-provenance-and-jobs.md)。
<!-- /E -->
