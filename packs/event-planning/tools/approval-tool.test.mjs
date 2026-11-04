/**
 * approval-tool 纯函数核心测试(node --test)。
 * 口径与 golden vendor-deposit-approval(198000 × 30% = 59400)、
 * budget-overrun-15pct-silent-forbidden(30 万 → 34.5 万 ≈ +15%,R3,rejected+not_executed)同源。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createApprovalTool, APPROVAL_TOOL_SERVICE_ID } from './approval-tool.ts'

const tool = createApprovalTool()

test('注册表 + 唯一 ID 形态(@event/approval-tool)', () => {
  assert.equal(tool.id, APPROVAL_TOOL_SERVICE_ID)
  assert.equal(APPROVAL_TOOL_SERVICE_ID, '@event/approval-tool')
})

test('golden vendor-deposit-approval:198000 × 30% = 59400', () => {
  assert.equal(tool.depositAmount(198000), 59400)
  assert.equal(tool.depositAmount(198000, 0.3), 59400)
})

test('付款申请单:R3 语义字段齐全,executed=false', () => {
  const draft = tool.draftPaymentRequest({ contractCny: 198000, payee: '致远展览', basis: '年会搭建合同 #ZB-2026-11' })
  assert.equal(draft.ok, true)
  assert.equal(draft.kind, 'payment-request')
  assert.equal(draft.amountCny, 59400)
  assert.equal(draft.payee, '致远展览')
  assert.equal(draft.riskLevel, 'R3')
  assert.equal(draft.approvalRequired, true)
  assert.equal(draft.executed, false)
  assert.equal(draft.executor, 'finance-officer')
})

test('付款申请单:非法入参直接抛错(比例越界/金额非正/收款方空)', () => {
  assert.throws(() => tool.draftPaymentRequest({ contractCny: 100, depositRatio: 1.5, payee: 'x' }), /depositRatio/)
  assert.throws(() => tool.draftPaymentRequest({ contractCny: -1, payee: 'x' }), /contractCny/)
  assert.throws(() => tool.draftPaymentRequest({ contractCny: 100, payee: '  ' }), /payee/)
})

test('golden budget-overrun-15pct:30 万 → 34.5 万,超支 15% 判 R3,applied=false', () => {
  const draft = tool.draftBudgetChange({ baseBudgetCny: 300000, newBudgetCny: 345000, reason: '餐饮标准 1500→1800 元/人' })
  assert.equal(draft.overrunCny, 45000)
  assert.equal(draft.overrunRatio, 0.15)
  assert.equal(draft.isR3Overrun, true)
  assert.equal(draft.riskLevel, 'R3')
  assert.equal(draft.applied, false)
  assert.equal(draft.approvalRequired, true)
})

test('预算变更:5% 边界不判 R3,但 riskLevel 仍为 R3(类别高危,必问)', () => {
  const draft = tool.draftBudgetChange({ baseBudgetCny: 100000, newBudgetCny: 105000, reason: '物料补采' })
  assert.equal(draft.overrunRatio, 0.05)
  assert.equal(draft.isR3Overrun, false)
  assert.equal(draft.riskLevel, 'R3')
})

test('预算变更:降本(负超支)正常出单', () => {
  const draft = tool.draftBudgetChange({ baseBudgetCny: 300000, newBudgetCny: 288000, reason: '场地议价' })
  assert.equal(draft.overrunCny, -12000)
  assert.equal(draft.overrunRatio, -0.04)
})

test('预算变更:非法入参抛错', () => {
  assert.throws(() => tool.draftBudgetChange({ baseBudgetCny: 0, newBudgetCny: 1, reason: 'x' }), /正数/)
  assert.throws(() => tool.draftBudgetChange({ baseBudgetCny: 1, newBudgetCny: 2, reason: '' }), /reason/)
})
