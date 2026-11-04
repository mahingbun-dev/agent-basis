/**
 * guard-tool 纯函数核心测试(node --test)。
 * 口径:审批红线①②③(policies/guard-rules.yml)——agent 不得直接执行,
 * 守卫结论一律 requiresApproval + 人工移交;定标须三家全列。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuardTool, GUARD_TOOL_SERVICE_ID } from './guard-tool.ts'

const tool = createGuardTool()

test('注册表 + 唯一 ID 形态(@event/guard-tool)', () => {
  assert.equal(tool.id, GUARD_TOOL_SERVICE_ID)
  assert.equal(GUARD_TOOL_SERVICE_ID, '@event/guard-tool')
})

test('send_email:R2 确认档,agent 不直接外发', () => {
  const summary = tool.checkExternalSend({ recipients: ['ops@example.com'], subject: '年会时间确认' })
  assert.equal(summary.tool, 'send_email')
  assert.equal(summary.riskLevel, 'R2')
  assert.equal(summary.agentMayExecute, false)
  assert.equal(summary.requiresApproval, true)
  assert.ok(summary.checklist.length >= 3)
})

test('transfer_money:R3 资金动作移交财务(golden external-payment-must-escalate)', () => {
  const summary = tool.checkMoneyTransfer({ payee: '场地服务公司', amountCny: 50000 })
  assert.equal(summary.riskLevel, 'R3')
  assert.equal(summary.agentMayExecute, false)
  assert.ok(summary.handoff.includes('财务'))
})

test('sign_contract:R3 用印移交授权签字人(golden contract-sign-no-proxy)', () => {
  const summary = tool.checkContractSign({ counterparty: '致远展览', amountCny: 198000, summary: '年会搭建' })
  assert.equal(summary.riskLevel, 'R3')
  assert.ok(summary.handoff.includes('授权签字人'))
})

test('vendor_award:不足三家直接拒绝(审批红线③比选中立)', () => {
  assert.throws(() => tool.checkVendorAward({ vendor: '致远展览', category: '搭建', quotesCompared: 2 }), /三家/)
  const summary = tool.checkVendorAward({ vendor: '致远展览', category: '搭建', quotesCompared: 3 })
  assert.equal(summary.riskLevel, 'R3')
  assert.ok(summary.checklist.some(item => item.includes('三家全列')))
})

test('非法入参抛错:空收件人/非正金额/空相对方', () => {
  assert.throws(() => tool.checkExternalSend({ recipients: [], subject: 'x' }), /recipients/)
  assert.throws(() => tool.checkMoneyTransfer({ payee: 'x', amountCny: 0 }), /amountCny/)
  assert.throws(() => tool.checkContractSign({ counterparty: ' ', amountCny: 1 }), /counterparty/)
})
