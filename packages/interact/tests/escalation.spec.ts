/**
 * escalate→channels / cooling_period / double_confirm / on_no_answer 运行时接线测试
 * (39 号 §3-E4/E5/E6,门禁 G2-E4:超时正确升级、R3 冷静期内二次确认生效、
 * 无人值守按 on_no_answer 挂起(暂停非失败、replay 可恢复))。
 *
 * 真令牌、假时钟、注入发送桩:令牌用 channels ApprovalTokenService 真实现
 * (:memory: sqlite,防重放/双花语义即 G2-E5 的同一套),出站 sendCard 为记录桩
 * (「不真连」,channels cards.ts:10-11 先例),时钟注入推进超时/冷静期。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { ApprovalTokenService, validateOutboundCard } from '@eterna/channels'
import type { OutboundCard } from '@eterna/channels'
import {
  ApprovalSignalBus, buildApprovalCard, cardToQuestionItems, confirmGate, EscalationRuntime,
  HitlPolicy,
} from '../src/index.ts'
import type { ApprovalCard, CardR3Controls, OnSuspendedEvent } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'eterna-interact-escalation-'))
const openDbs: DatabaseSync[] = []
afterAll(() => {
  for (const db of openDbs) db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fakeClock(startMs = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = startMs
  return { now: (): number => current, advance: (ms: number): void => { current += ms } }
}

function openTokens(now: () => number): ApprovalTokenService {
  const db = new DatabaseSync(':memory:')
  openDbs.push(db)
  return new ApprovalTokenService(db, { now })
}

function createSendStub(): {
  sent: { card: OutboundCard; recipient: string }[]
  sendCard: (card: OutboundCard, recipient: string) => Promise<{ delivered: true }>
} {
  const sent: { card: OutboundCard; recipient: string }[] = []
  return {
    sent,
    sendCard: async (card: OutboundCard, recipient: string) => {
      sent.push({ card, recipient })
      return { delivered: true }
    },
  }
}

const MAIN_QUESTION_ID = 'approve:payment-redline'
const CONFIRM_QUESTION_ID = `${MAIN_QUESTION_ID}:confirm`

function buildR3Card(controls: Partial<CardR3Controls> = {}): ApprovalCard {
  return buildApprovalCard({
    action: { kind: 'command', name: 'pay_order', params: { order: 'O-123', amount: 50000 } },
    why: { source: 'sop', name: '预算红线 SOP', entry: '§3 对外付款' },
    impact: { externalSystems: [{ system: '支付网关', object: '订单 O-123' }] },
    rollback: { reversible: false },
    matchedRule: { ruleId: 'payment-redline', grade: 'R3', reason: '预算红线:对外付款需人工复核' },
    r3: { escalateTo: ['finance-lead'], coolingPeriodSec: 300, doubleConfirm: true, ...controls },
  })
}

function createRuntime(
  tokens: ApprovalTokenService,
  sendCard: (card: OutboundCard, recipient: string) => Promise<{ delivered: true }>,
  now: () => number,
): EscalationRuntime {
  return new EscalationRuntime({
    tokens,
    sendCard,
    channel: 'feishu/card',
    approvalBaseUrl: 'https://eterna.example.com/hook',
    now,
  })
}

describe('E4 escalate 运行时接线(超时正确升级)', () => {
  it('① R3 + on_no_answer=escalate:假时钟推进超时后恰一次出站升级卡,载荷含双令牌,Attention 单问', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    const card = buildR3Card()
    const rule = { id: 'payment-redline', grade: 'R3' as const, onNoAnswer: 'escalate' as const }

    clock.advance(300_000) // 桥超时窗口走完 → unavailable 终局(假时钟注入)
    const dispatch = await runtime.dispatchNoAnswer({
      rule,
      outcome: 'unavailable',
      approvalRequestId: 'apr-e4-1',
      card,
      sessionId: 'sess-1',
    })

    expect(dispatch.action).toBe('escalated')
    expect(dispatch.escalation?.status).toBe('escalated')
    expect(stub.sent).toHaveLength(1)
    expect(stub.sent[0]?.recipient).toBe('finance-lead') // 寻址缺省=原样透传(§9-2 悬置)

    const outbound = stub.sent[0]!.card
    expect(() => { validateOutboundCard(outbound) }).not.toThrow() // channels 强校验路径
    expect(outbound.kind).toBe('approval')
    const payload = outbound.approval
    expect(payload?.approvalRequestId).toBe('apr-e4-1')
    expect(payload?.channel).toBe('feishu/card') // ApprovalActionPayload 归因
    const approveAction = payload?.actions.find(action => action.decision === 'approve')
    const rejectAction = payload?.actions.find(action => action.decision === 'reject')
    expect(approveAction).toBeDefined() // 双令牌:approve/reject 各一枚
    expect(rejectAction).toBeDefined()
    expect(approveAction?.token).not.toEqual(rejectAction?.token)
    expect(approveAction?.label).toBe('允许执行一次') // §5-6 同源文案(card.ts:199-205)
    expect(rejectAction?.label).toBe('拒绝')
    expect(approveAction?.url).toBe(`https://eterna.example.com/hook/approval/${approveAction?.token}`)

    // Attention 单问纪律(§5-3):出站卡只带 cardToQuestionItems 主问,第二问文案不出现
    const mainQuestion = cardToQuestionItems(card)[0]
    expect(mainQuestion).toBeDefined()
    expect(outbound.title).toBe(mainQuestion!.question)
    expect(outbound.body).not.toContain('仍要执行该高危动作')
    expect(outbound.body).toContain('R3 附加控制') // renderedDetail 的 R3 控制三行展示仍在(§5-8)

    // 恰一次:超时后再次分派同 approvalRequestId 被去重(升级不并发,24 §8.1-3)
    clock.advance(300_000)
    const again = await runtime.dispatchNoAnswer({
      rule,
      outcome: 'unavailable',
      approvalRequestId: 'apr-e4-1',
      card,
      sessionId: 'sess-1',
    })
    expect(again.action).toBe('escalated')
    expect(again.escalation?.status).toBe('duplicate')
    expect(stub.sent).toHaveLength(1)
  })

  it('② 同 approvalRequestId 二次 escalate 被去重:不再出站、不再签新令牌', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    const card = buildR3Card()

    const first = await runtime.escalate(card, [], { approvalRequestId: 'apr-e4-2', sessionId: 'sess-2' })
    expect(first.status).toBe('escalated')
    expect(runtime.pendingEscalations).toContain('apr-e4-2')
    const pendingAfterFirst = tokens.pendingCount('apr-e4-2')
    expect(pendingAfterFirst).toBe(2) // approve/reject 各一枚在途

    const second = await runtime.escalate(card, [], { approvalRequestId: 'apr-e4-2', sessionId: 'sess-2' })
    expect(second.status).toBe('duplicate')
    expect(stub.sent).toHaveLength(1) // 不重复出站
    expect(tokens.pendingCount('apr-e4-2')).toBe(pendingAfterFirst) // 不重复签发
  })

  it('③ 令牌 redeemed 后 pendingCount 归零且 revokeAll 清余票;重放被拒;双确认卡回收后仍待第二问', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    const card = buildR3Card()
    await runtime.escalate(card, [], { approvalRequestId: 'apr-e4-3', sessionId: 'sess-3' })
    expect(tokens.pendingCount('apr-e4-3')).toBe(2)

    const outbound = stub.sent[0]!.card
    const approveToken = outbound.approval?.actions.find(action => action.decision === 'approve')?.token
    expect(approveToken).toBeDefined()

    const settle = await runtime.settleWithToken(approveToken!)
    expect(settle.redemption).toEqual({
      ok: true,
      approvalRequestId: 'apr-e4-3',
      sessionId: 'sess-3',
      decision: 'approve',
    })
    expect(tokens.pendingCount('apr-e4-3')).toBe(0) // 兑付一枚 + revokeAll 清 reject 余票
    expect(runtime.pendingEscalations).not.toContain('apr-e4-3') // 在途登记显式清理
    expect(settle.gate).toBe('await-cooling') // doubleConfirm 卡仅主问应答 → 未生效(E5)

    // 重放同令牌不再产生审批副作用:settle 的 revokeAll 已整行删除该请求令牌
    // (token.ts:169-173 DELETE 无 redeemed_at 过滤),故返回 unknown-token——与
    // already-used 同为 fail-closed 拒绝,接线不绕过防重放。
    const replay = await runtime.settleWithToken(approveToken!)
    expect(replay.redemption.ok).toBe(false)
    expect(replay.redemption).toEqual({ ok: false, reason: 'unknown-token' })
  })

  it('边界:escalate_to 为空且未注入 targets → no-recipients,不出站不签令牌', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    const card = buildR3Card({ escalateTo: [] })

    const outcome = await runtime.escalate(card, [], { approvalRequestId: 'apr-e4-4', sessionId: 'sess-4' })
    expect(outcome.status).toBe('no-recipients')
    expect(stub.sent).toHaveLength(0)
    expect(tokens.pendingCount('apr-e4-4')).toBe(0)
  })
})

describe('E5 冷静期 + 双确认运行时判定(R3 冷静期内二次确认生效)', () => {
  it('① doubleConfirm 卡只有主问 approve、第二问未答 → 不生效(仍处等待窗口)', () => {
    const card = buildR3Card()
    expect(confirmGate(card, { [MAIN_QUESTION_ID]: 'approve' }, 1_700_000_300_000, 1_700_000_000_000))
      .toBe('await-cooling')
  })

  it('② 两问均 approve 且已过冷静期 → allowed-once(一次性授权)', () => {
    const card = buildR3Card()
    const issuedAt = 1_700_000_000_000
    const answers = { [MAIN_QUESTION_ID]: 'approve', [CONFIRM_QUESTION_ID]: 'approve' } as const
    expect(confirmGate(card, answers, issuedAt + 300_000, issuedAt)).toBe('allow-once') // now-issuedAt = coolingPeriodSec
  })

  it('③ 两问均 approve 但仍在冷静期 → await-cooling,推进假时钟后放行', () => {
    const card = buildR3Card()
    const issuedAt = 1_700_000_000_000
    const answers = { [MAIN_QUESTION_ID]: 'approve', [CONFIRM_QUESTION_ID]: 'approve' } as const
    expect(confirmGate(card, answers, issuedAt + 60_000, issuedAt)).toBe('await-cooling') // 300s 冷静期只过 60s
    expect(confirmGate(card, answers, issuedAt + 300_001, issuedAt)).toBe('allow-once')
  })

  it('④ 任一 reject → rejected', () => {
    const card = buildR3Card()
    expect(confirmGate(card, { [MAIN_QUESTION_ID]: 'reject' }, 1_700_000_400_000, 1_700_000_000_000))
      .toBe('reject')
    expect(confirmGate(
      card,
      { [MAIN_QUESTION_ID]: 'approve', [CONFIRM_QUESTION_ID]: 'reject' },
      1_700_000_400_000,
      1_700_000_000_000,
    )).toBe('reject')
  })

  it('⑤ doubleConfirm=false 的 R3 卡单问即决(现行行为)', () => {
    const card = buildR3Card({ doubleConfirm: false, coolingPeriodSec: 0 })
    const issuedAt = 1_700_000_000_000
    expect(confirmGate(card, { [MAIN_QUESTION_ID]: 'approve' }, issuedAt, issuedAt)).toBe('allow-once')
    expect(confirmGate(card, { [MAIN_QUESTION_ID]: 'reject' }, issuedAt, issuedAt)).toBe('reject')
  })
})

describe('E6 on_no_answer 运行时接线(无人值守三策略分派)', () => {
  it('① suspend:任务暂停非失败——无 denied、不出站、onSuspended 事件恰一次、无负信号', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    const events: OnSuspendedEvent[] = []
    runtime.onSuspended(event => events.push(event))

    const dispatch = await runtime.dispatchNoAnswer({
      rule: { id: 'payment-redline', grade: 'R3', onNoAnswer: 'suspend' },
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-1',
      card: buildR3Card(),
      sessionId: 'sess-6',
    })

    expect(dispatch.action).toBe('suspended')
    expect(dispatch.denied).toBeUndefined() // 暂停非失败,不产出 denied/rejected
    expect(dispatch.escalation).toBeUndefined()
    expect(stub.sent).toHaveLength(0)
    expect(events).toHaveLength(1) // onSuspended 恰一次
    expect(events[0]).toMatchObject({
      kind: 'on-suspended',
      approvalRequestId: 'apr-e6-1',
      ruleId: 'payment-redline',
      grade: 'R3',
    })
    // 负信号诚实边界:unavailable 无应答者 fail-closed 不是用户否定,负信号面零发布
    // (negative.ts:12-13;词表沿用 approval-bridge「不冒充用户拒绝」)
    expect(new ApprovalSignalBus().recordOutcome('unavailable', { toolName: 'pay_order', grade: 'R3' }))
      .toBeUndefined()
  })

  it('② escalate:转 E4 出站(断言复用:恰一张审批卡、双令牌载荷)', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)

    const dispatch = await runtime.dispatchNoAnswer({
      rule: { id: 'payment-redline', grade: 'R3', onNoAnswer: 'escalate' },
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-2',
      card: buildR3Card(),
      sessionId: 'sess-6',
    })

    expect(dispatch.action).toBe('escalated')
    expect(stub.sent).toHaveLength(1)
    const payload = stub.sent[0]!.card.approval
    const decisions = payload?.actions.map(action => action.decision).sort()
    expect(decisions).toEqual(['approve', 'reject'])
    // 升级行为与去重纪律继承(E4):同请求再分派被去重
    const again = await runtime.dispatchNoAnswer({
      rule: { id: 'payment-redline', grade: 'R3', onNoAnswer: 'escalate' },
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-2',
      card: buildR3Card(),
      sessionId: 'sess-6',
    })
    expect(again.escalation?.status).toBe('duplicate')
    expect(stub.sent).toHaveLength(1)
  })

  it('③ fail:以 denied 收场,reasons 引用规则 id;不出站、无负信号', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)

    const dispatch = await runtime.dispatchNoAnswer({
      rule: { id: 'payment-redline', grade: 'R3', onNoAnswer: 'fail' },
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-3',
    })

    expect(dispatch.action).toBe('failed')
    expect(dispatch.denied?.reasons.join('; ')).toContain('payment-redline') // reasons 引用规则 id
    expect(stub.sent).toHaveLength(0)
    expect(tokens.pendingCount()).toBe(0) // 未签任何令牌
    // denied 是策略收场,不是用户否定——不发布 rejected(negative.ts:12-13)
    expect(new ApprovalSignalBus().recordOutcome('unavailable', { toolName: 'pay_order', grade: 'R3' }))
      .toBeUndefined()
  })

  it('④ 全局缺省 suspend 与逐条覆盖两级行为对齐(hitl.ts:120/:234 解析期归一)', async () => {
    const policy = HitlPolicy.parse(`
default_grade: R3
rules:
  - id: inherit-global
    grade: R3
    tools: ['pay_*']
  - id: override-fail
    grade: R3
    tools: ['drop_*']
    on_no_answer: fail
`)
    expect(policy.ruleById('inherit-global')?.onNoAnswer).toBe('suspend') // 全局缺省
    expect(policy.ruleById('override-fail')?.onNoAnswer).toBe('fail') // 逐条覆盖

    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)

    const inherited = await runtime.dispatchNoAnswer({
      rule: policy.ruleById('inherit-global')!,
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-4a',
    })
    expect(inherited.action).toBe('suspended')

    const overridden = await runtime.dispatchNoAnswer({
      rule: policy.ruleById('override-fail')!,
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-4b',
    })
    expect(overridden.action).toBe('failed')
  })

  it('边界:escalate 分派缺 card/sessionId → fail-closed 拒绝(不静默降级)', async () => {
    const clock = fakeClock()
    const tokens = openTokens(clock.now)
    const stub = createSendStub()
    const runtime = createRuntime(tokens, stub.sendCard, clock.now)
    await expect(runtime.dispatchNoAnswer({
      rule: { id: 'payment-redline', grade: 'R3', onNoAnswer: 'escalate' },
      outcome: 'unavailable',
      approvalRequestId: 'apr-e6-5',
    })).rejects.toThrow(/escalate 分派需要 card 与 sessionId/)
    expect(stub.sent).toHaveLength(0)
  })
})
