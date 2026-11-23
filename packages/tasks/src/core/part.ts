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
  /**
   * ★派发渠道纪律(2026-11-23 线上修复;主会话话题分治的结构半边):该线程是否只是
   * **派发渠道**而非话题线程——是的话,工单不因 accept/attach 隐式订阅它,于是其上的
   * 每条新消息仍走候选卡,由主会话按 dispatch 纪律逐条 accept/attach/ignore。
   *
   * 为什么需要:webchat 线程就是主会话本身(`orchestrator-<realm>`,sources/webchat.ts:67)。
   * 修复前 accept 让工单订阅了主会话线程(tickets.ts:81),此后人在主会话里发**任何新话题**
   * 都会先被 intake 扇出成旧工单的一条 Input,`followupOwners`(model.ts:86-99)据此判
   * 「归该工单的 worker 裁决」——候选卡不生成、orchestrator 看不到,新任务因此被默认绑定到
   * 前一张工单(生产实证 2026-11-23:第二张单的调研请求成为第一张单的 handback 报告)。
   *
   * 注入面归装配(内核不认 webchat 与 masterId 词汇):plugin.ts 注入
   * `ref.source === 'webchat' && ref.id === masterId`。缺省(未注入)恒 false——既有
   * 语义逐字不变。
   */
  isDispatchThread?: (ref: ThreadRef) => boolean
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
  /**
   * 该线程是否只是派发渠道(见 `EngineOptions.isDispatchThread`):工单不因 accept/attach
   * 隐式订阅它,其上的每条消息仍走候选卡。缺省 false(未注入 = 既有语义)。
   */
  protected dispatchThread(ref: ThreadRef): boolean { return this.options.isDispatchThread?.(ref) === true }
  /**
   * 为工单订阅一条线程,**派发渠道除外**——这是订阅面的唯一闸(`Tickets.subscribe` 之外
   * 的每个订阅点都经此,见 tickets.ts 的 create/attach 两处)。
   * @returns 是否真的订阅了。
   */
  protected subscribeUnlessDispatch(ticketId: string, ref: ThreadRef, subscribe: (id: string, thread: ThreadRef) => void): boolean {
    if (this.dispatchThread(ref)) return false
    subscribe(ticketId, ref)
    return true
  }
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
  /**
   * 候选卡的相关工单面(`related_tickets`/`tickets_total`):线程上订阅的工单 ∪ 从该线程
   * **真正到达过**的工单(其 Input 带该线程的某条 Trigger,或在该线程上被 accept)。
   *
   * 为什么需要兜底(2026-11-23 派发渠道化):派发渠道线程(webchat 主会话)上的工单不再订阅
   * 该线程(`subscribeUnlessDispatch`),于是 `ticketsOnThread` 在其上恒空——评估主会话新话题时
   * 候选卡就看不到「这个窗口里已经有哪些单」,而 dispatch.md:8 要求 related_tickets 为空时
   * 先用 orchestrator_read 查,却又禁「凭记忆」。此兜底按落库事实补齐,评估方的可见性不因
   * 结构简化而回退。gate 的准入判定仍只看 `ticketsOnThread`(见 evals/directEval)——
   * 兜底只喂候选卡,不改任何权力。
   *
   * 归账口径:工单 `origin.triggerIds` 之一的 Trigger 落在该线程、或其 Inputs 里有该线程的
   * Trigger。已结束工单照旧计入(27 号 §3.3-B 重复判定防线)。
   */
  protected relatedTicketsOnThread(thread: Thread): Ticket[] {
    const reachable = new Set(thread.subscriptions)
    for (const ticket of this.repo.tickets.list()) {
      for (const triggerId of [...ticket.origin.triggerIds, ...ticket.inputs.flatMap(input => input.kind === 'trigger' ? [input.triggerId] : [])]) {
        const trigger = this.repo.triggers.get(triggerId)
        if (trigger?.threads.some(ref => threadKey(ref) === thread.key)) { reachable.add(ticket.id); break }
      }
    }
    return [...reachable].flatMap((id) => { const ticket = this.repo.tickets.get(id); return ticket ? [ticket] : [] })
  }
  protected source(ticket: Ticket): Trigger | undefined { return this.repo.triggers.get(ticket.origin.triggerId) }
  protected reaches(ticket: Ticket, trigger: Trigger, context = true): boolean {
    return reached(ticket, trigger, k => this.repo.threads.get(k), context)
  }
}
