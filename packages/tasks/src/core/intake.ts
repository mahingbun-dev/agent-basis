/**
 * Intake——Trigger 摄取、线程关联、订阅扇出与 Eval 排队(35 号 A6)。
 *
 * 设计依据:34 号 §2.1 intake 行;语义自 SA/src/core/intake.ts 重写级校对移植,
 * `receive` 幂等三态 stored/duplicate/filtered 原样(SA intake.ts:19-62;
 * 27 号 §3.2-② 幂等键机制 + 24a 拍板记录·D2 duplicate 冲突指标的数据源)。
 * 本仓拍板改造一处(24a A1「realm 进内核模型」;34 §2.1 intake 行「Trigger 保存前用 realmOf
 * 标注 realm」):首次落库前经 `EngineOptions.realmOf` 解析租户 realm,随 disposition 一并落库
 * (stored 与 filtered 两条路径都标注;duplicate 不重复写)——evals accept 固化 Mandate 时读取。
 */
import { key } from './ids.ts'
import { isoTime, liveTicket, threadKey } from './model.ts'
import type { Ticket, Trigger } from './model.ts'
import { EnginePart, type EngineOptions } from './part.ts'
import type { Tickets } from './tickets.ts'

export type ReceiveResult = 'stored' | 'duplicate' | 'filtered'

/**
 * 摄取 Source 送来的 trigger:先去重、再按 SourceScope 过滤,然后记录线程关联;把被监听的
 * trigger 经 Tickets 扇出到订阅工单,并把没有工单 worker 裁决的每条 trigger(见 followupOwners)
 * 排到其主线程等 Eval。Engine 把 trigger 接收委托给本部件。
 */
export class Intake extends EnginePart {
  private readonly tickets: Tickets
  constructor(options: EngineOptions, tickets: Tickets) { super(options); this.tickets = tickets }

  receive(received: Trigger): ReceiveResult {
    // 归一 Source 时间戳(如 GitHub 的整秒)为规范 ISO 形态。
    const trigger = { ...received, at: isoTime(received.at) }
    if (!trigger.threads.length) throw new Error('A trigger must belong to at least one thread')
    if (this.repo.triggers.get(trigger.id)) return 'duplicate'
    const at = this.now()
    // ★realm 首参路由(A6):Trigger 保存前解析并标注租户 realm——一租户一 SQLite 的路由依据(34 §2.3)。
    const realm = this.options.realmOf(trigger)
    const filter = this.options.scope.scope(trigger)
    if (!filter.listened) {
      this.repo.triggers.save(trigger)
      this.repo.triggers.saveDisposition(trigger.id, { filtered: { code: filter.reason }, fanout: [], realm, at })
      return 'filtered'
    }
    this.repo.triggers.save(trigger)
    const keys = trigger.threads.map(threadKey)
    // 跟踪到达的工单与其是否仅经 context 线程到达(工单自有线程使 context 为 false)。
    const reached = new Map<string, { ticket: Ticket; context: boolean }>()
    for (const ref of trigger.threads) {
      const thread = this.thread(ref)
      if (!thread.lastAt || trigger.at > thread.lastAt) thread.lastAt = trigger.at
      thread.correlated = [...new Set([...thread.correlated, ...keys.filter(other => other !== thread.key)])]
      for (const ticketId of thread.subscriptions) {
        const ticket = this.repo.tickets.get(ticketId)
        // 只有非 context 线程上的人的消息才恢复已结束工单;bot 与 CI 不恢复(Executor 恢复时会重读
        // 线程),而被人 stop 的工单什么都收不到——其 Mandate 已被撤回。
        const followed = !!thread.context?.includes(ticketId)
        const resumes = trigger.human && ticket?.ended?.by !== 'human' && !followed
        if (!ticket || (!liveTicket(ticket) && !resumes)) continue
        reached.set(ticketId, { ticket, context: followed && (reached.get(ticketId)?.context ?? true) })
      }
      this.repo.threads.save(thread)
    }
    for (const [ticketId, { ticket, context: followed }] of reached) {
      this.tickets.addInput(ticket, { id: key('input', ticketId, 'trigger', trigger.id), kind: 'trigger', triggerId: trigger.id, at,
        ...trigger.human ? { human: true } : {}, ...followed ? { context: true } : {} })
    }
    const fanout = [...reached.keys()], context = fanout.filter(id => reached.get(id)?.context === true)
    const disposition = { fanout, realm, ...context.length ? { context } : {}, at }
    this.repo.triggers.saveDisposition(trigger.id, disposition)
    // 没有工单裁决的人的消息(如只到达了被人 stop 的工单、或仅以 context 跟随该线程的工单),与所有
    // bot 的消息,都进 Eval。
    if (!this.owners(trigger).length) this.queueForEval(trigger)
    for (const ticketId of fanout) this.tickets.wake(ticketId)
    this.emit('trigger.received', { triggerId: trigger.id, threads: trigger.threads.map(threadKey) })
    return 'stored'
  }
}
