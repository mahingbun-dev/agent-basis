// 确定性工具桩测试(确定性:样例数据写死在桩内,断言值可精确复核)。
// node --test tools/industrial-tools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimeseriesTool, TIMESERIES_TOOL_SERVICE_ID } from './timeseries-tool.ts'
import { createAlertListTool, ALERT_LIST_TOOL_SERVICE_ID } from './alert-list-tool.ts'
import { createAlertRecordsTool, ALERT_RECORDS_TOOL_SERVICE_ID } from './alert-records-tool.ts'

test('SERVICE_ID 全部落在 @industrial-analysis/* 命名空间(CORD004)', () => {
  for (const id of [TIMESERIES_TOOL_SERVICE_ID, ALERT_LIST_TOOL_SERVICE_ID, ALERT_RECORDS_TOOL_SERVICE_ID]) {
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
