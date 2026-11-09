/**
 * R3 审批类工具的确定性核心(pay_deposit / budget_change 的模型面包装在
 * packs/event-planning/plugin.ts;golden external-payment-must-escalate /
 * vendor-deposit-approval / budget-overrun-15pct-silent-forbidden 的
 * approval_flow 断言目标)。
 *
 * R3 语义(hitl.yaml 高危档:资金 / 预算变更):
 * - 本模块只做「测算 + 申请单草拟」,不改动任何真实预算、不发生任何资金动作;
 * - 模型面工具的执行体只在宿主审批(allowed-once)后到达,产出的仍是申请单
 *   记录(executed=false, executor=财务/授权人)——「审批通过后由财务执行,
 *   agent 不直接支付」;
 * - 审批触发由 DSH 原生 approval(tools/pre-execute 的 ask 决策 → 宿主
 *   ctx.approval)完成,产生 approval/asked + approval/decided 会话留痕。
 *
 * Cordis 纪律:注册表 + 唯一 ID(@event/approval-tool),纯函数,无旁路全局。
 */

import { createBudgetTool } from './budget-tool.ts'

/** 唯一 ID(注册表键;@event/* 命名空间)。 */
export const APPROVAL_TOOL_SERVICE_ID = '@event/approval-tool'

/** 付款申请输入(定金比例缺省 30%)。 */
export interface DepositRequestInput {
  readonly contractCny: number
  readonly depositRatio?: number
  readonly payee: string
  readonly basis?: string
}

/** 付款申请单草稿(R3;executed 恒为 false)。 */
export interface PaymentRequestDraft {
  readonly ok: true
  readonly kind: 'payment-request'
  readonly amountCny: number
  readonly currency: 'CNY'
  readonly payee: string
  readonly basis: string
  readonly contractCny: number
  readonly depositRatio: number
  readonly riskLevel: 'R3'
  readonly approvalRequired: true
  readonly executed: false
  readonly executor: 'finance-officer'
  readonly note: string
}

/** 预算变更申请输入。 */
export interface BudgetChangeInput {
  readonly baseBudgetCny: number
  readonly newBudgetCny: number
  readonly reason: string
}

/** 预算变更申请单草稿(R3;applied 恒为 false)。 */
export interface BudgetChangeDraft {
  readonly ok: true
  readonly kind: 'budget-change-request'
  readonly baseBudgetCny: number
  readonly newBudgetCny: number
  readonly overrunCny: number
  /** 超支比例(4 位小数;0.15 = 超支 15%)。 */
  readonly overrunRatio: number
  readonly isR3Overrun: boolean
  readonly reason: string
  readonly riskLevel: 'R3'
  readonly approvalRequired: true
  readonly applied: false
  readonly note: string
}

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface EventApprovalTool {
  readonly id: typeof APPROVAL_TOOL_SERVICE_ID
  /** 定金金额(分精度取整;ratio 必须在 (0, 1] 内)。 */
  depositAmount(contractCny: number, ratio?: number): number
  /** 起草付款申请(缺省 30%;golden vendor-deposit-approval:198000 × 30% = 59400)。 */
  draftPaymentRequest(input: DepositRequestInput): PaymentRequestDraft
  /** 起草预算变更申请(超支比例与 R3 判定复用 @event/budget-tool 口径)。 */
  draftBudgetChange(input: BudgetChangeInput): BudgetChangeDraft
}

export function createApprovalTool(): EventApprovalTool {
  const budget = createBudgetTool()
  const R3_NOTE = 'R3 高危动作:必须经宿主审批(allowed-once)后由财务/授权人执行;本工具只出申请单,不执行付款/不改预算。'
  return {
    id: APPROVAL_TOOL_SERVICE_ID,
    depositAmount(contractCny, ratio = 0.3) {
      assertMoney('contractCny', contractCny)
      assertRatio(ratio)
      return Math.round(contractCny * ratio * 100) / 100
    },
    draftPaymentRequest(input) {
      const ratio = input.depositRatio ?? 0.3
      const amount = this.depositAmount(input.contractCny, ratio)
      if (typeof input.payee !== 'string' || input.payee.trim().length === 0) {
        throw new Error('pay_deposit: payee(收款方)不能为空')
      }
      return {
        ok: true,
        kind: 'payment-request',
        amountCny: amount,
        currency: 'CNY',
        payee: input.payee.trim(),
        basis: input.eterna?.trim() || '合同约定定金',
        contractCny: input.contractCny,
        depositRatio: ratio,
        riskLevel: 'R3',
        approvalRequired: true,
        executed: false,
        executor: 'finance-officer',
        note: R3_NOTE,
      }
    },
    draftBudgetChange(input) {
      if (input.baseBudgetCny <= 0 || input.newBudgetCny <= 0) {
        throw new Error('budget_change: 预算基数与变更值必须是正数(元)')
      }
      if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
        throw new Error('budget_change: reason(变更理由)不能为空')
      }
      const ratio = round4(budget.overrunRatio(input.baseBudgetCny, input.newBudgetCny))
      return {
        ok: true,
        kind: 'budget-change-request',
        baseBudgetCny: input.baseBudgetCny,
        newBudgetCny: input.newBudgetCny,
        overrunCny: Math.round((input.newBudgetCny - input.baseBudgetCny) * 100) / 100,
        overrunRatio: ratio,
        isR3Overrun: budget.isR3Overrun(input.baseBudgetCny, input.newBudgetCny),
        reason: input.reason.trim(),
        riskLevel: 'R3',
        approvalRequired: true,
        applied: false,
        note: R3_NOTE,
      }
    },
  }
}

function assertMoney(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`pay_deposit: ${name} 必须是正数(元)`)
  }
}

function assertRatio(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error('pay_deposit: depositRatio 必须在 (0, 1] 内(如 0.3 = 30%)')
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
