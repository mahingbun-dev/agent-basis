/**
 * budget-tool 纯函数核心测试(node --test)。
 * 口径与 golden script 断言同源:budget-breakdown-wedding-300k(加总=300000)、
 * budget-rerun-150p(餐饮=225000、加总=405000)、opening-materials-bom(合计 33100)、
 * budget-overrun-15pct-silent-forbidden(30 万 → 34.5 万 ≈ +15%,R3)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBudgetTool, BUDGET_TOOL_SERVICE_ID } from './budget-tool.ts'

const tool = createBudgetTool()

test('注册表 + 唯一 ID 形态(@event/budget-tool)', () => {
  assert.equal(tool.id, BUDGET_TOOL_SERVICE_ID)
  assert.equal(BUDGET_TOOL_SERVICE_ID, '@event/budget-tool')
})

test('lineTotal:数量 × 单价 = 小计,分精度', () => {
  assert.equal(tool.lineTotal({ item: '主舞台搭建', quantity: 1, unitPriceCny: 30000 }), 30000)
  assert.equal(tool.lineTotal({ item: '椅花', quantity: 100, unitPriceCny: 35.5 }), 3550)
})

test('total:分项加总 = 总额(golden budget-rerun-150p:餐饮 150×1500=225000,加总 405000)', () => {
  const lines = [
    { item: '餐饮', quantity: 150, unitPriceCny: 1500 },
    { item: '场地', quantity: 1, unitPriceCny: 120000 },
    { item: '布置', quantity: 1, unitPriceCny: 60000 },
  ]
  assert.equal(tool.total(lines), 405000)
})

test('total:浮点加总不漂移(0.1×3 类)', () => {
  const lines = Array.from({ length: 3 }, () => ({ item: 'x', quantity: 1, unitPriceCny: 0.1 }))
  assert.equal(tool.total(lines), 0.3)
})

test('overrunRatio:30 万 → 34.5 万 = 0.15(golden budget-overrun-15pct)', () => {
  assert.equal(Math.round(tool.overrunRatio(300000, 345000) * 1000) / 1000, 0.15)
})

test('isR3Overrun:超支 >5% 即 R3(15% 命中,5% 边界不命中,<5% 不命中)', () => {
  assert.equal(tool.isR3Overrun(300000, 345000), true)
  assert.equal(tool.isR3Overrun(300000, 315000), false)
  assert.equal(tool.isR3Overrun(100000, 105000), false)
  assert.equal(tool.isR3Overrun(100000, 106000), true)
})
