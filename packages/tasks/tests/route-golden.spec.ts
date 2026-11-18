/**
 * 路由金集 v0 回放(35 号 A26 验收门禁的 vitest 半边;28 号 §5;24a C4)。
 *
 * 两层断言:
 * 1. 形态:恰 20 条(24a C4 拍板起步值)、四类齐备、id 唯一、每条触发原文非空
 *    (「触发原文」列 = 压缩强制保留项,21 号 D3;28 号 §5);
 * 2. 干净态回放:每条判例独立起一个模拟宿主(tests/fixtures/host.ts)走
 *    receive → 候选 → 回放的裁决(decide/attach),断言落点——accept 开新单
 *    (title/R3 四要素随 Decision 落库)、attach 挂到对象工单(线程订阅 + Input,
 *    已结束工单被恢复)、ignore 无新单、stop 结束工单(ended by human;已结束工单的
 *    stop 退化为 ignore,stop 后同线程消息不再恢复)。
 *
 * 「在压缩后的会话状态上跑」的衰减度量归 dsh-evals replay 跑法(压缩前后各一遍,
 * `scripts/diff-pass-rate.mjs` 待建,G2-A9;验收口径 = 通过率差 ≤2 个百分点视为无衰减)
 * ——以 tests/route-golden/ 的判例为数据源;本 spec 是金集自身的正确性守护,不替代
 * 衰减度量。跑动口径:压缩前后各一遍的回归随 **nightly CI 口径**执行(35 号 A26 任务
 * 指令注明;§12-10「挂 CI 还是发布门禁」未拍板,nightly 为暂登记口径,拍板后随落位
 * 一并迁移);驱动脚本与 pack 适配随 G2-A9 落地,落地前按 G2-A9 落地前判据 = 两份
 * report.md 归档 + 差值一行记入里程碑评审登记。
 */
import { expect, it } from 'vitest'
import { humanTrigger, startHost, SOURCE, type Host } from './fixtures/host.ts'
import { threadKey, type Decision, type Trigger } from '../src/core/index.ts'
import { ROUTING_GOLDEN, type GoldenEntry, type GoldenKind } from './route-golden/entries.ts'

/** 判例的触发消息(humanTrigger 约定:id 数字位作时间偏移秒)。 */
const triggerOf = (entry: GoldenEntry): Trigger => {
  const spec = entry.trigger
  const overrides: Record<string, unknown> = {}
  if (spec.human === false) {
    overrides.human = false
    overrides.addressed = undefined
    overrides.actor = { source: SOURCE, id: spec.bot ?? `bot-${spec.id}` }
  }
  if (spec.actor && spec.human !== false) overrides.actor = { source: SOURCE, id: spec.actor }
  if (spec.addressed !== undefined) overrides.addressed = spec.addressed
  return humanTrigger(spec.id, spec.text, overrides)
}

/** 应用判例前置:名单/bots 扩展 + 种子工单(可先报 ready 使其结束);返回对象工单 id。 */
async function setupOf(host: Host, entry: GoldenEntry): Promise<string | undefined> {
  if (!entry.setup) return undefined
  const { allowed, bots, id, text, ready } = entry.setup
  if (allowed?.length || bots?.length) {
    const settings = host.store.settings()
    const part = settings.policy.sources[SOURCE] ?? { allowed: [], admission: {} }
    host.store.saveSettings({ ...settings, policy: { ...settings.policy,
      sources: { ...settings.policy.sources, [SOURCE]: { ...part,
        allowed: [...part.allowed, ...(allowed ?? []).map(member => ({ id: member }))],
        ...(bots?.length ? { bots: bots.map(bot => ({ id: bot })) } : {}) } } } })
  }
  if (!id || !text) return undefined
  const { ticket } = await host.accept(humanTrigger(id, text))
  if (ready) host.engine.report(ticket.id, { state: 'ready', summary: '完成。' })
  return ticket.id
}

/** 候选到达回放点:receive → pass → 候选投递。 */
function deliverCandidate(host: Host, entry: GoldenEntry): void {
  host.engine.receive(triggerOf(entry))
  host.pass()
  const candidate = host.requested.at(-1)
  expect(candidate, `${entry.id}: 应产生候选`).toBeDefined()
  host.engine.candidateDelivered(candidate!.evalId)
}

it('形态:恰 20 条、四类齐备(6/5/5/4)、id 唯一、触发原文非空(28 §5;24a C4)', () => {
  expect(ROUTING_GOLDEN).toHaveLength(20)
  const count = (kind: GoldenKind) => ROUTING_GOLDEN.filter(entry => entry.kind === kind).length
  expect({ accept: count('accept'), attach: count('attach'), 'ignore-bot': count('ignore-bot'), stop: count('stop') })
    .toEqual({ accept: 6, attach: 5, 'ignore-bot': 5, stop: 4 })
  expect(new Set(ROUTING_GOLDEN.map(entry => entry.id)).size).toBe(ROUTING_GOLDEN.length)
  for (const entry of ROUTING_GOLDEN) {
    expect(entry.id).toMatch(/^RG-\d{2}$/)
    expect(entry.trigger.text.trim(), `${entry.id}: 触发原文(压缩强制保留项)不得为空`).not.toBe('')
    expect(entry.why.trim(), `${entry.id}: 判例理据不得为空`).not.toBe('')
  }
  // attach/stop 判例必须有对象工单种子(stop 的负判例是「已结束工单」,仍需种子)。
  for (const entry of ROUTING_GOLDEN.filter(item => item.kind === 'attach' || item.kind === 'stop')) {
    expect(entry.setup?.id, `${entry.id}: attach/stop 判例需带种子工单`).toBeDefined()
    expect(entry.setup?.text).toBeDefined()
  }
})

it('accept 判例:裁决 accept、开出唯一新工单,title 与 R3 四要素随 Decision 落库、触发线程被订阅', async () => {
  for (const entry of ROUTING_GOLDEN.filter(item => item.kind === 'accept')) {
    const host = await startHost()
    try {
      await setupOf(host, entry)
      const replay = entry.replay
      if (replay.kind !== 'accept') throw new Error(`${entry.id}: 判例类型与回放不符`)
      const trigger = triggerOf(entry)
      host.engine.receive(trigger)
      host.pass()
      const candidate = host.requested.at(-1)!
      host.engine.candidateDelivered(candidate.evalId)
      const decision = host.engine.decide(trigger.id, { kind: 'accept', title: replay.title, scope: replay.scope,
        reason: replay.reason, delegation: replay.delegation })
      expect(decision.kind, entry.id).toBe('accept')
      expect(decision.strength, `${entry.id}: 名单内对准请求应记 explicit`).toBe('explicit')
      expect(decision.delegation, `${entry.id}: R3 四要素随 Decision 落库`).toMatchObject(replay.delegation)
      const ticket = host.store.tickets.get(decision.ticketId!)
      expect(ticket, entry.id).toBeDefined()
      expect(ticket!.title).toBe(replay.title)
      expect(host.store.tickets.active().map(item => item.id), `${entry.id}: 唯一活动工单即新单`).toEqual([decision.ticketId!])
      expect(host.store.threads.get(threadKey(trigger.threads[0]!))?.subscriptions, `${entry.id}: accept 订阅触发线程`)
        .toContain(decision.ticketId!)
    } finally { await host.stop() }
  }
})

it('attach 判例:不开新单,trigger 落为对象工单的 Input、其线程被订阅;已结束工单被恢复', async () => {
  for (const entry of ROUTING_GOLDEN.filter(item => item.kind === 'attach')) {
    const host = await startHost()
    try {
      const ticketId = await setupOf(host, entry)
      expect(ticketId, entry.id).toBeDefined()
      const replay = entry.replay
      if (replay.kind !== 'attach') throw new Error(`${entry.id}: 判例类型与回放不符`)
      const trigger = triggerOf(entry)
      host.engine.receive(trigger)
      host.pass()
      host.engine.attach(ticketId!, trigger.id, replay.note)
      // attach 不开新单:活动面只含对象工单(已结束者被恢复而重回活动面)。
      expect(host.store.tickets.active().map(item => item.id).sort(), entry.id).toEqual([ticketId!])
      const ticket = host.store.tickets.get(ticketId!)!
      expect(ticket.inputs.find(item => item.kind === 'trigger' && item.triggerId === trigger.id),
        `${entry.id}: trigger 应成为对象工单的 Input`).toBeDefined()
      expect(host.store.threads.get(threadKey(trigger.threads[0]!))?.subscriptions, `${entry.id}: attach 订阅该线程`)
        .toContain(ticketId!)
    } finally { await host.stop() }
  }
})

it('ignore-bot 判例:无新工单、Decision 为 ignore(byGate 者由策略门落,路由器未见候选)', async () => {
  for (const entry of ROUTING_GOLDEN.filter(item => item.kind === 'ignore-bot')) {
    const host = await startHost()
    try {
      await setupOf(host, entry)
      const replay = entry.replay
      if (replay.kind !== 'ignore') throw new Error(`${entry.id}: 判例类型与回放不符`)
      const trigger = triggerOf(entry)
      host.engine.receive(trigger)
      host.pass()
      let decision: Decision | undefined
      if (replay.byGate) {
        // 名单外 bot:策略门在 pass 即落 ignore 决定,无候选被请求。
        expect(host.requested.length, `${entry.id}: 名单外 bot 不产生候选`).toBe(0)
        decision = host.store.decisions.byThread(threadKey(trigger.threads[0]!)).at(-1)
      } else {
        deliverCandidate(host, entry)
        decision = host.engine.decide(trigger.id, { kind: 'ignore', reason: replay.reason })
      }
      expect(decision?.kind, entry.id).toBe('ignore')
      expect(host.store.tickets.active(), `${entry.id}: ignore 不开工单`).toHaveLength(0)
    } finally { await host.stop() }
  }
})

it('stop 判例:人的明确 stop 结束工单,同线程后续消息不再恢复;已结束工单的 stop 退化为 ignore', async () => {
  for (const entry of ROUTING_GOLDEN.filter(item => item.kind === 'stop')) {
    const host = await startHost()
    try {
      const ticketId = await setupOf(host, entry)
      expect(ticketId, entry.id).toBeDefined()
      const replay = entry.replay
      if (replay.kind !== 'stop') throw new Error(`${entry.id}: 判例类型与回放不符`)
      deliverCandidate(host, entry)
      const trigger = triggerOf(entry)
      const decision = host.engine.decide(trigger.id, { kind: 'stop', ticketId: ticketId!, reason: replay.reason })
      const ticket = host.store.tickets.get(ticketId!)!
      if (entry.setup?.ready) {
        // 负判例(RG-20):工单已结束,stop 无对象 → stopUnknown 的 ignore,工单保持已结束。
        expect(decision.kind, `${entry.id}: 已结束工单的 stop 应退化`).toBe('ignore')
        expect(ticket.ended, entry.id).toBeDefined()
      } else {
        expect(decision.kind, entry.id).toBe('stop')
        expect(ticket.ended, `${entry.id}: stop 结束工单`).toMatchObject({ by: 'human' })
        // 同线程(工单自有线程)后续人消息不再恢复被 stop 的工单。
        const later = humanTrigger('99', '这个修得怎么样了', { threads: [{ source: SOURCE, id: `thread-${entry.setup!.id}` }] })
        host.engine.receive(later)
        host.pass()
        expect(host.store.tickets.get(ticketId!)?.ended, `${entry.id}: stop 后不被同线程消息恢复`).toBeDefined()
        expect(host.store.tickets.active(), `${entry.id}: stop 后无活动工单`).toHaveLength(0)
      }
    } finally { await host.stop() }
  }
})
