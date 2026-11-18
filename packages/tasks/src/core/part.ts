/**
 * EnginePart 基类与 EngineOptions——五部件(Intake/Evals/Tickets/Assignments/Replies)
 * 共享的装配面:仓储、策略、时钟与事件发射的统一访问。
 *
 * 设计依据:34 号 §2.1 part 行、§3;35 号 A5。语义自 SA/src/core/part.ts 重写级校对移植,
 * 不变量原样;本仓拍板改造仅一处:`EngineOptions` 增加 `realmOf` 注入项
 * (34 §2.1 part 行——intake 落库时用它标注 realm,24a A1「realm 进内核模型」)。
 */
import { UserError } from './errors.ts'
import { followupOwners, reached, threadKey } from './model.ts'
import type { EffortTier, Thread, ThreadRef, Ticket, Trigger } from './model.ts'
import type { Assessor, AssessmentOutcome, DomainEvent, DomainEvents, Executor, Outbox, Policy, Repositories, SourceScope } from './ports.ts'

export interface EngineOptions {
  repo: Repositories
  policy: () => Policy
  /** ★本仓改造(34 §2.1):Trigger 归属的 realm 由调用侧解析注入(intake 落库时标注 realm)。 */
  realmOf: (trigger: Trigger) => string
  /**
   * ★本仓改造(24 §5.5-R1;26 §4.1 effort 段;35 号 A17):候选卡的 R1 effort 档位来源——
   * 领域包 effort 档位声明段(26 §4.1 五段之一,schema 待 G2-A18 拍板)由装配面解析后注入,
   * Evals 在候选卡(`Candidate.effort`)上携带;声明缺席时返回 undefined(内核不发明默认档)。
   */
  effort?: () => EffortTier | undefined
  /** 判断某 Source 是否监听一条 Trigger;不监听的以 `filtered` 处置落库。 */
  scope: SourceScope
  assessor: Assessor
  executor: Executor
  outbox: Outbox
  prepareTicket?: (ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>) => Ticket
  now?: () => string
  emit?: (event: DomainEvent) => void
}

/**
 * Intake、Evals、Tickets、Assignments、Replies 五部件的共享基类:提供对仓储、策略、时钟与事件发射的访问。
 * 各子类只改动自己的领域聚合,跨聚合的变更委托给兄弟部件——全部发生在 Engine 打开的事务之内。
 */
export abstract class EnginePart {
  protected readonly repo: Repositories
  protected readonly options: EngineOptions
  constructor(options: EngineOptions) { this.options = options; this.repo = options.repo }
  protected now(): string { return this.options.now?.() ?? new Date().toISOString() }
  protected policy(): Policy { return this.options.policy() }
  /**
   * ★本仓改造(34 §2.1 model/evals 行;35 号 A6/A7):一条 Trigger 的租户 realm——以 intake 落库时
   * 经 `realmOf` 标注的 `disposition.realm` 为准(「realm 首参路由」的落库面);仅对未带标注的更早
   * 记录回退现算。accept 固化 Mandate 时写 `mandate.realm`,即经此读取。
   */
  protected realmOf(trigger: Trigger): string {
    return this.repo.triggers.disposition(trigger.id)?.realm ?? this.options.realmOf(trigger)
  }
  /** 其 worker 决定某人后续消息归属的工单集合:见 `followupOwners`。 */
  protected owners(trigger: Trigger): string[] { return followupOwners(trigger, this.repo) }
  /** 拒绝主会话路由一条仍由某工单 worker 决定的后续消息。 */
  protected leftToWorkers(trigger: Trigger): void {
    const owners = this.owners(trigger)
    if (owners.length) throw new UserError('workerDecides', { tickets: owners.join(', ') })
  }
  /**
   * 记录某工单的 worker 把一条到达该工单的 Trigger 交回(附原因),并在「该工单决定了它、且已无其他工单仍决定它」
   * 时把它排回 Eval。该工单未曾决定它的——例如 bot 的消息、某人直接发给 Eval 的、或它仅为上下文跟随的线程上的——
   * 无需经它即已去了 Eval。
   * @returns 是否排入了 Eval。
   */
  protected handBack(ticketId: string, trigger: Trigger, reason: string): boolean {
    const decided = this.owners(trigger).includes(ticketId)
    const disposition = this.repo.triggers.disposition(trigger.id) ?? { fanout: [], at: this.now() }
    const handbacks = [...disposition.handbacks ?? [], { ticketId, reason, at: this.now() }]
    this.repo.triggers.saveDisposition(trigger.id, { ...disposition, handbacks })
    return decided && !this.owners(trigger).length && this.queueForEval(trigger)
  }
  /** 记录某工单的 worker 把某人的消息收进工单内——以确认或回答它的方式。 */
  protected takeUp(ticketId: string, triggerId: string): void {
    const disposition = this.repo.triggers.disposition(triggerId)
    if (disposition && !disposition.acked?.includes(ticketId)) {
      this.repo.triggers.saveDisposition(triggerId, { ...disposition, acked: [...disposition.acked ?? [], ticketId] })
    }
  }
  /** 把一条 Trigger 排到其主线程等下一次 Eval;若它已在等、或某次 Eval 正持有它,则不排。 */
  protected queueForEval(trigger: Trigger): boolean {
    // SA 不变量:threads[0] 恒存在(Trigger 的主线程,docs/model);非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const primary = this.thread(trigger.threads[0]!)
    if (primary.pending.includes(trigger.id) || primary.evaluating?.triggerIds.includes(trigger.id)) return false
    primary.pending.push(trigger.id)
    this.repo.threads.save(primary)
    return true
  }
  protected emit<K extends keyof DomainEvents>(type: K, data: DomainEvents[K]): void {
    this.options.emit?.({ type, at: this.now(), data } as DomainEvent)
  }
  protected require(ticketId: string): Ticket { const ticket = this.repo.tickets.get(ticketId); if (!ticket) throw new UserError('unknownTicket'); return ticket }
  /** 返回已存储的线程;没有则给一个未保存的空线程聚合。 */
  protected thread(ref: ThreadRef): Thread {
    const k = threadKey(ref)
    return this.repo.threads.get(k) ?? {
      key: k,
      ref: { source: ref.source, id: ref.id },
      createdAt: this.now(),
      subscriptions: [],
      correlated: [],
      pending: [],
      meta: {},
    }
  }
  protected ticketsOnThread(thread: Thread): Ticket[] {
    return thread.subscriptions.flatMap((id) => { const ticket = this.repo.tickets.get(id); return ticket ? [ticket] : [] })
  }
  protected source(ticket: Ticket): Trigger | undefined { return this.repo.triggers.get(ticket.origin.triggerId) }
  protected reaches(ticket: Ticket, trigger: Trigger, context = true): boolean {
    return reached(ticket, trigger, k => this.repo.threads.get(k), context)
  }
}
