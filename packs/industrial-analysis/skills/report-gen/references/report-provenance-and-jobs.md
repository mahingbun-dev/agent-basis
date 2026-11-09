# 出处与异步任务速查(report-gen references)

## 出处标注格式(每个数字带出处与时间窗)

```
- unit1.reactor.temp(1#反应釜温度,°C):窗口 2026-11-06 00:00–23:00,
  峰值 196.2(13:00),09:00–16:00 越限 8 点(RULE-TEMP-HIGH-190),16:00 后回落;
```

- 时序数字:测点 + 时间窗;告警口径:告警 id + 规则 id;知识口径:citation + 版本;
- 样例声明:来源声明(实测/样例)写在出处段,不得省略;「待确认」集中列出。

## 异步任务四步(report_jobs;tool-jobs 语义)

```
1. submit:{ op: 'submit', title: '班组日报(2026-11-06)',
            window: '2026-11-06 00:00–23:00',
            sources: [{ kind: 'timeseries', ref: 'unit1.reactor.temp 2026-11-06 00:00–23:00' }, …],
            draftPath: 'out/shift-report.md' }        → job id(report-0001)
2. status:{ op: 'status', jobId: 'report-0001' }      → 进度行(排队取数 → 渲染中 → completed)
3. fetch:{ op: 'fetch', jobId: 'report-0001' }        → 产物引用(artifactId/storagePath/出处页脚)
4. 交付说明:job id + storagePath + 草稿路径写进报告尾部,前端下载按产物引用走。
```

- submit 缺时间窗或缺 sources → 拒收:「报告缺数据出处,不予提交(报告红线)」——
  补齐后重新提交,不绕过;被拒记录如实写进交付说明;
- fetch 在 completed 前会拒:先查进度,不编造产物引用;不 busy-poll,等待期做独立步骤。

## 红线速查

- 报告缺出处 = 不通过:用户要求省略出处也不豁免,篡改测点数据更不行;
- 产物≠已发送:fetch 成功只是内部渲染件;对外下发是 R2(起草全文 → 确认 → 再发);
- 产物引用如实:artifactId/storagePath 只来自工具返回,不虚构存储路径;
- 产物落对象存储桩(本地盘,stub://objects/…),MiniO 接入后换存储后端,接口不变。
