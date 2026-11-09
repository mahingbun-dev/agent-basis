// 确定性工具桩测试(确定性:样例数据写死在桩内,断言值可精确复核)。
// node --test tools/industrial-tools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimeseriesTool, TIMESERIES_TOOL_SERVICE_ID } from './timeseries-tool.ts'
import { createAlertListTool, ALERT_LIST_TOOL_SERVICE_ID } from './alert-list-tool.ts'
import { createAlertRecordsTool, ALERT_RECORDS_TOOL_SERVICE_ID } from './alert-records-tool.ts'
import { createKbSearchTool, KB_SEARCH_TOOL_SERVICE_ID } from './kb-search-tool.ts'
import { createReportJobsTool, REPORT_JOBS_TOOL_SERVICE_ID } from './report-jobs-tool.ts'

test('SERVICE_ID 全部落在 @industrial-analysis/* 命名空间(CORD004)', () => {
  for (const id of [TIMESERIES_TOOL_SERVICE_ID, ALERT_LIST_TOOL_SERVICE_ID, ALERT_RECORDS_TOOL_SERVICE_ID, KB_SEARCH_TOOL_SERVICE_ID, REPORT_JOBS_TOOL_SERVICE_ID]) {
    assert.ok(id.startsWith('@industrial-analysis/'), id)
  }
})

test('timeseries_query:全天统计与趋势(24 点,avg 精确到分位)', () => {
  const ts = createTimeseriesTool()
  const result = ts.query('unit1.reactor.temp')
  assert.equal(result.count, 24)
  assert.equal(result.source, 'stub-sample')
  assert.deepEqual(result.stats, { min: 178.2, max: 196.2, avg: 187.24, first: 178.2, last: 180.4 })
  assert.equal(result.trend.direction, 'up')
  assert.equal(result.trend.delta, 2.2)
  assert.equal(result.trend.deltaRatio, 0.0123)
  assert.equal(result.trend.peak, 196.2)
  assert.equal(result.trend.peakAt, '2026-11-06 13:00')
})

test('timeseries_query:窗口过滤(含起止)与越限判定', () => {
  const ts = createTimeseriesTool()
  const windowed = ts.query('unit1.reactor.temp', { start: '2026-11-06 09:00', end: '2026-11-06 15:00' })
  assert.equal(windowed.count, 7)
  assert.equal(windowed.breaches, undefined)
  const breaches = ts.query('unit1.reactor.temp', { threshold: 190 })
  assert.equal(breaches.breaches.count, 8)
  assert.equal(breaches.breaches.moments[0], '2026-11-06 09:00')
  assert.equal(breaches.breaches.moments.at(-1), '2026-11-06 16:00')
  // 日期-only 窗口:start 补 00:00,end 补 23:59。
  assert.equal(ts.query('unit1.reactor.temp', { start: '2026-11-06', end: '2026-11-06' }).count, 24)
  // 低限类异常不在上限越限里(steam 14:00 骤降 33.5,threshold 42 → 0 越限)。
  assert.equal(ts.query('boiler1.steam.flow', { threshold: 42 }).breaches.count, 0)
  assert.equal(ts.query('unit1.reactor.press', { threshold: 0.6 }).breaches.count, 1)
  assert.equal(ts.query('line2.motor.vib', { threshold: 4.5 }).breaches.count, 2)
})

test('timeseries_query:测点不存在 / 窗口非法 → 抛错(不编造数据)', () => {
  const ts = createTimeseriesTool()
  assert.throws(() => ts.query('unit9.press'), /测点不存在/)
  assert.throws(() => ts.query('unit1.reactor.temp', { start: '2026-11-06 23:00', end: '2026-11-06 09:00' }), /start 晚于 end/)
  assert.throws(() => ts.query('unit1.reactor.temp', { start: '昨天' }), /时间必须是/)
  assert.throws(() => ts.query('unit1.reactor.temp', { threshold: Number.NaN }), /threshold/)
})

test('timeseries_query:台账 listTags 带 source=stub-sample 声明', () => {
  const tags = createTimeseriesTool().listTags()
  assert.equal(tags.length, 4)
  for (const meta of tags) assert.equal(meta.source, 'stub-sample')
})

test('alert_list:过滤 severity/asset/status,非法值抛错', () => {
  const alerts = createAlertListTool()
  assert.equal(alerts.list().count, 4)
  assert.equal(alerts.list({ severity: 'P1' }).count, 2)
  assert.equal(alerts.list({ asset: 'unit1.reactor' }).count, 2)
  assert.equal(alerts.list({ status: 'acknowledged' }).count, 1)
  const p0 = alerts.list({ severity: 'P0' }).alerts[0]
  assert.equal(p0.ruleId, 'RULE-PRESS-HIGH-060')
  assert.equal(p0.limit, 0.6)
  assert.throws(() => alerts.list({ severity: 'P9' }), /P0\|P1\|P2/)
  assert.throws(() => alerts.list({ status: 'open' }), /active\|acknowledged\|closed/)
})

test('alert_records:种子 + append 自增 recordId,agent 起草记录可识别', () => {
  const records = createAlertRecordsTool()
  assert.equal(records.list().count, 1)
  assert.equal(records.list().writeScope, 'alert-records-table-only')
  const appended = records.append({ alertId: 'AL-20261106-001', treatment: '联动工艺核查温控阀', outcome: '待现场反馈' })
  assert.equal(appended.recordId, 'REC-0002')
  assert.equal(appended.operator, 'agent-draft')
  assert.equal(records.list().count, 2)
  const manual = records.append({ alertId: 'AL-20261106-002', treatment: '点检轴承', operator: '设备乙班' })
  assert.equal(manual.operator, '设备乙班')
  assert.equal(records.list().count, 3)
  assert.throws(() => records.append({ alertId: ' ', treatment: 'x' }), /alertId/)
  assert.throws(() => records.append({ alertId: 'AL-1' }), /treatment/)
})

test('kb_search:词命中计分,citation 逐字带出处与版本(T10a 知识问答纪律面)', () => {
  const kb = createKbSearchTool()
  const result = kb.search('电机 轴承 振动 维护')
  assert.equal(result.outcome, 'hits')
  // 手册 4 词全中(标题×2=8),规则库速查摘要提「振动」×1:计分排序手册第一。
  assert.equal(result.count, 2)
  assert.equal(result.source, 'stub-sample')
  assert.equal(result.hits[0].docId, 'MAN-MOTOR-VIB-001')
  assert.equal(result.hits[0].score, 8)
  assert.equal(result.hits[0].kbId, 'equipment-manuals')
  assert.equal(result.hits[0].version, 'v2026.09')
  assert.equal(result.hits[0].rank, 1)
  assert.equal(result.hits[1].docId, 'RULE-KB-INDEX-003')
  assert.equal(result.hits[1].score, 1)
  assert.ok(result.hits[0].citation.includes('《2#线电机轴承振动维护手册》 v2026.09'), result.hits[0].citation)
  assert.ok(result.hits[0].citation.includes('equipment-manuals/MAN-MOTOR-VIB-001'))
})

test('kb_search:无命中不抛错,outcome=no-hit + hint(明说「知识库无命中」,不编造)', () => {
  const kb = createKbSearchTool()
  const miss = kb.search('SCR-300 维保周期 油品型号')
  assert.equal(miss.count, 0)
  assert.equal(miss.outcome, 'no-hit')
  assert.deepEqual(miss.hits, [])
  assert.match(miss.hint, /知识库无命中/)
  // 小写归一:大小写不同也能命中(iso 10816)。
  assert.equal(kb.search('ISO 10816').outcome, 'hits')
})

test('kb_search:非法入参抛错(口径不猜,错误指向语料清单)', () => {
  const kb = createKbSearchTool()
  assert.throws(() => kb.search('   '), /query 必填/)
  assert.throws(() => kb.search('电机', { topK: 0 }), /topK/)
  assert.throws(() => kb.search('电机', { topK: 1.5 }), /topK/)
  assert.throws(() => kb.search('电机', { kb: 'wiki' }), /不在语料清单内/)
})

test('kb_search:listKb 语料清单与 kb 过滤(4 库,stub-sample 声明)', () => {
  const kb = createKbSearchTool()
  const sources = kb.listKb()
  assert.equal(sources.length, 4)
  assert.deepEqual(sources.map(s => s.kbId), ['equipment-manuals', 'process-cards', 'rule-base', 'case-base'])
  for (const source of sources) assert.equal(source.source, 'stub-sample')
  const only = kb.search('规则 分级', { kb: 'rule-base' })
  assert.equal(only.kb, 'rule-base')
  assert.equal(only.count, 1)
  assert.equal(only.hits[0].docId, 'RULE-KB-INDEX-003')
})

test('report_jobs:submit→status 进度→fetch 产物引用(tool-jobs 语义,状态机确定性推进)', () => {
  const jobs = createReportJobsTool()
  const accepted = jobs.submit({
    title: '班组日报(2026-11-06)',
    window: '2026-11-06 00:00–23:00',
    sources: [{ kind: 'timeseries', ref: 'unit1.reactor.temp 2026-11-06 00:00–23:00' }],
    draftPath: 'out/shift-report.md',
  })
  assert.equal(accepted.jobId, 'report-0001')
  assert.equal(accepted.kind, 'report')
  assert.equal(accepted.status, 'running')
  assert.match(accepted.detail, /进度 0%/)
  const mid = jobs.status('report-0001')
  assert.equal(mid.status, 'running')
  assert.match(mid.detail, /渲染中/)
  const done = jobs.status('report-0001')
  assert.equal(done.status, 'completed')
  assert.equal(done.finishedAt, '2026-11-07 09:42')
  const { job, artifact } = jobs.fetch('report-0001')
  assert.equal(job.status, 'completed')
  assert.equal(artifact.artifactId, 'ART-report-0001')
  assert.equal(artifact.storagePath, 'stub://objects/reports/report-0001.md')
  assert.equal(artifact.draftPath, 'out/shift-report.md')
  assert.equal(artifact.sources.length, 1)
  assert.equal(jobs.list().count, 1)
  // 稳定期:completed 后 status 不再变化(确定性)。
  assert.equal(jobs.status('report-0001').status, 'completed')
})

test('report_jobs:缺出处或缺时间窗不予提交(报告缺出处=不通过,fail-closed)', () => {
  const jobs = createReportJobsTool()
  assert.throws(
    () => jobs.submit({ title: '日报', window: '2026-11-06 00:00–23:00', sources: [] }),
    /缺数据出处.*不予提交/,
  )
  assert.throws(
    () => jobs.submit({ title: '日报', window: ' ', sources: [{ kind: 'timeseries', ref: 'unit1.reactor.temp' }] }),
    /缺时间窗.*不予提交/,
  )
  assert.throws(() => jobs.submit({ title: ' ', window: '2026-11-06', sources: [{ kind: 'timeseries', ref: 'x' }] }), /title/)
  assert.throws(
    () => jobs.submit({ title: '日报', window: '2026-11-06', sources: [{ kind: 'wiki', ref: 'x' }] }),
    /timeseries\|alert\|knowledge\|rule/,
  )
  // 被拒的提交不入队:任务表仍为空,下一个 job id 仍是 report-0001。
  assert.equal(jobs.list().count, 0)
  const retried = jobs.submit({ title: '日报', window: '2026-11-06 00:00–23:00', sources: [{ kind: 'rule', ref: 'RULE-TEMP-HIGH-190' }] })
  assert.equal(retried.jobId, 'report-0001')
})

test('report_jobs:fetch 未完成拒绝 + 未知 jobId 抛错(不编造产物引用)', () => {
  const jobs = createReportJobsTool()
  jobs.submit({ title: '超温分析', window: '2026-11-06 00:00–23:00', sources: [{ kind: 'rule', ref: 'RULE-TEMP-HIGH-190' }] })
  assert.throws(() => jobs.fetch('report-0001'), /产物未就绪.*op=status/)
  assert.throws(() => jobs.status('report-9999'), /任务不存在/)
  assert.throws(() => jobs.fetch('report-9999'), /任务不存在/)
  // 实例内状态隔离:新实例从 report-0001 重新起号(不串台)。
  assert.equal(createReportJobsTool().submit({ title: '另一会话', window: '2026-11-06', sources: [{ kind: 'alert', ref: 'AL-20261106-004' }] }).jobId, 'report-0001')
})
