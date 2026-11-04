/**
 * schedule-tool 纯函数核心测试(node --test)。
 * 口径与 golden annual-gala-timeline-8seg 的 script 断言同源:
 * 8 环节、区间 [840,1080)、按开始排序、相邻不重叠(前一结束 ≤ 后一开始)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScheduleTool, SCHEDULE_TOOL_SERVICE_ID } from './schedule-tool.ts'

const tool = createScheduleTool()

/** golden 形态:14:00-18:00(分钟 840-1080)8 环节首尾相接。 */
const GALA = [
  { name: '签到入场', startMinute: 840, endMinute: 870 },
  { name: '开场致辞', startMinute: 870, endMinute: 895 },
  { name: '年度回顾', startMinute: 895, endMinute: 915 },
  { name: '荣誉颁奖', startMinute: 915, endMinute: 965 },
  { name: '才艺汇演', startMinute: 965, endMinute: 1020 },
  { name: '幸运抽奖', startMinute: 1020, endMinute: 1040 },
  { name: '纪念仪式', startMinute: 1040, endMinute: 1065 },
  { name: '闭幕合影', startMinute: 1065, endMinute: 1080 },
]

test('注册表 + 唯一 ID 形态(@event/schedule-tool)', () => {
  assert.equal(tool.id, SCHEDULE_TOOL_SERVICE_ID)
  assert.equal(SCHEDULE_TOOL_SERVICE_ID, '@event/schedule-tool')
})

test('golden 正例:8 环节首尾相接、窗口内、无重叠 → ok', () => {
  const result = tool.check(GALA, { startMinute: 840, endMinute: 1080 })
  assert.equal(result.ok, true)
  assert.equal(result.sortedSegments.length, 8)
  assert.deepEqual(result.overlaps, [])
  assert.deepEqual(result.outOfWindow, [])
})

test('乱序输入:按开始时间排序输出', () => {
  const shuffled = [...GALA].reverse()
  const result = tool.check(shuffled)
  assert.deepEqual(result.sortedSegments.map(seg => seg.startMinute), [...GALA].map(seg => seg.startMinute).sort((a, b) => a - b))
})

test('重叠检测:相邻环节重叠 15 分钟被点名', () => {
  const result = tool.check([
    { name: '签到', startMinute: 840, endMinute: 900 },
    { name: '致辞', startMinute: 885, endMinute: 920 },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.overlaps.length, 1)
  assert.equal(result.overlaps[0].a, '签到')
  assert.equal(result.overlaps[0].b, '致辞')
  assert.equal(result.overlaps[0].overlapMinutes, 15)
})

test('跨环节重叠:长环节与后续多个环节冲突(runningEnd 口径)', () => {
  const result = tool.findOverlaps([
    { name: '彩排', startMinute: 800, endMinute: 900 },
    { name: '签到', startMinute: 840, endMinute: 870 },
    { name: '致辞', startMinute: 870, endMinute: 900 },
  ])
  assert.equal(result.length, 2)
})

test('窗口越界:超出活动时段被点名(golden awk 口径 840 ≤ 开始 < 结束 ≤ 1080)', () => {
  const result = tool.check([
    { name: '彩排', startMinute: 820, endMinute: 860 },
    { name: '收尾', startMinute: 1000, endMinute: 1100 },
  ], { startMinute: 840, endMinute: 1080 })
  assert.equal(result.ok, false)
  assert.deepEqual(result.outOfWindow, ['彩排', '收尾'])
})

test('非法区间:start ≥ end 进 invalid', () => {
  const result = tool.check([{ name: '坏环节', startMinute: 900, endMinute: 900 }])
  assert.equal(result.ok, false)
  assert.deepEqual(result.invalid, ['坏环节'])
})
