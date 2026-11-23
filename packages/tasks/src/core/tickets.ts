/**
 * Tickets——工单自 accept 起的生命周期、其 Subscription 与 Inputs(35 号 A8)。
 *
 * 设计依据:34 号 §2.1 tickets 行;语义自 SA/src/core/tickets.ts 重写级校对移植,不变量原样。
 * 本仓拍板改造三处:
 * - ★policyChanged「只通知不撤销」(27 号 §3.2-④ 权力层级;35 号 A8):SA 原语义保留并钉死——
 *   只为 effects 命中的开放工单注入 policy-changed Input,绝不碰 Mandate;在跑工单钉住创建时
 *   策略版本,新规则只影响新工单(G2-A15 的 tasks 半边,断言在 tests/mandate-policy.spec.ts);
 * - ★`ticket.ended` 事件载荷带 realm(34 §2.1 ports 行;35 号 A5 表②-2):记忆整固与 observe
 *   冲突指标按 realm 归账;
 * - ★交接 handoff 路径(24a 拍板记录·A6;26 §6.2;35 号 A8):accept 带 `handoffOf` 时,新工单
 *   Mandate 独立(本就如此,不继承原工单授权)、记录 `references`,且原 Ticket 订阅新工单线程
 *   ——跨工单协调走交接、不走 agent 互聊(27 号 §2.1-2)。
 * `attach` 挂到已有工单而非新建(27 号 §3.3-B「合并请求替代竞速」)与 `wake`/`refuse` 的
 * Mandate revalidate 均为 SA 原语义,原样保留。
 */
import { key } from './ids.ts'
import { UserError } from './errors.ts'
import { latestAssignment, liveTicket, readUntil, runningAssignment, settled, threadKey, waitsForPerson } from './model.ts'
import type { Assignment, ChannelRef, Evaluation, Follow, Mandate, PolicyEffect, ThreadRef, Ticket, TicketEndBy, TicketInput, TicketOutcome,
  Trigger, TriggerDisposition } from './model.ts'
import type { AssessmentOutcome } from './ports.ts'
import { EnginePart, type EngineOptions } from './part.ts'
import type { Replies } from './replies.ts'
import { canRetry } from './stage.ts'

const sameChannel = (a: ChannelRef, b: ChannelRef): boolean => JSON.stringify(a) === JSON.stringify(b)
/** Input 是否为非人消息:如 CI 的、bot 的、或主 Session 的 note。 */
export const automatic = (input: TicketInput | undefined): boolean => input?.kind === 'note' || (input?.kind === 'trigger' && !input.human)
/**
 * 工单的 worker 是否在 `until`(其最新报告或一轮结束)之前读过一条 Trigger Input:其 Session 在
 * 那之前把携带它的消息纳入过步骤。读记录之前送达的,到达 worker 即视为已读。
 */
const readBefore = (input: Extract<TicketInput, { kind: 'trigger' }>, until: string): boolean => input.readAt === undefined
  ? (input.deliveredAt && input.deliveredAt > input.at ? input.deliveredAt : input.at) <= until : !!input.readAt && input.readAt < until
const STATUS_REQUEST = 'Report the current ticket status with orchestrator_report. This is a status-only request: do not resume implementation or perform external actions.'

/**
 * 管理每张工单的生命周期:为 accept 决定建带 Mandate、Subscription 与首个 Assignment 的工单,
 * 绑定并 attach 线程、添加 Input、恢复、重试、重启与结束工单,以及撤掉 Subscription。与 Replies
 * 协作 accept 携带的确认回执,与 Executor 协作启动、投递与停止 assignment。Intake、Evals、
 * Assignments 与 Engine 把工单与订阅的变更都委托到这里。
 */
export class Tickets extends EnginePart {
  private readonly replies: Replies
  constructor(options: EngineOptions, replies: Replies) { super(options); this.replies = replies }

  /**
   * 建 accept 决定的工单:带 `mandate`(★realm 已由 Eval 固化,Ticket 与 Mandate 同 realm)、
   * Eval 各 Trigger 的 channels 与线程、首个 Assignment 与 accept 携带的确认回执,并排队启动。
   * 其 origin 是给批次以强度的可受理 Trigger,或 `primary` 存在之前记录的 Eval 的末条 Trigger。
   * ★交接(A8/24a A6):outcome 带 `handoffOf` 时先校验原工单(存在且未结束,否则整单回滚),
   * 新工单记录 `references`,并在订阅完自身线程后让原工单订阅这些线程(新工单线程上的动静
   * 作为上下文扇出到原工单)——Mandate 独立,不继承。
   */
  create(id: string, decisionId: string, mandate: Mandate, evaluation: Pick<Evaluation, 'triggerIds' | 'primary'>,
    outcome: Extract<AssessmentOutcome, { kind: 'accept' }>, at: string): void {
    const { triggerIds } = evaluation
    // ★交接前置校验:原工单未知或已结束即拒——整个 accept 在 Engine 的事务内回滚。
    if (outcome.handoffOf) {
      const original = this.repo.tickets.get(outcome.handoffOf)
      if (!original) throw new UserError('unknownTicket')
      if (!liveTicket(original)) throw new UserError('ticketEnded')
    }
    // 为 primary 存在之前记录的 Eval 回退到末条 trigger。
    // SA 不变量:triggerIds 恒非空且已落库;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const primary = this.repo.triggers.get(evaluation.primary ?? triggerIds.at(-1)!)
    // 同上:triggerIds 恒非空且已落库;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const origin = { triggerId: primary?.id ?? triggerIds[0]!, triggerIds }
    let ticket: Ticket = { id, title: outcome.title, decisionId, realm: mandate.realm, mandate, channels: [], assignments: [], inputs: [],
      undelivered: [], createdAt: at, updatedAt: at, origin, ...outcome.handoffOf ? { references: [outcome.handoffOf] } : {} }
    for (const triggerId of triggerIds) {
      const channel = this.repo.triggers.get(triggerId)?.channel
      if (channel && !ticket.channels.some(item => sameChannel(item, channel))) ticket.channels.push(channel)
    }
    ticket = this.options.prepareTicket?.(ticket, outcome) ?? ticket
    const assignment = this.newAssignment(ticket)
    this.repo.tickets.save(ticket)
    // ★派发渠道纪律(2026-11-23):主会话线程(orchestrator-<realm>)不因 accept 隐式订阅——
    // 否则人在主会话里发下一条新话题时会先扇出成这张单的 Input、被 followupOwners 判归本单,
    // 候选卡不生成(见 EngineOptions.isDispatchThread 注)。交接(handoffOf)同一条纪律。
    for (const triggerId of triggerIds) {
      for (const ref of this.repo.triggers.get(triggerId)?.threads ?? []) {
        this.subscribeUnlessDispatch(id, ref, (tid, r) => { this.subscribe(tid, r) })
      }
    }
    // ★交接落点(A8):原 Ticket 订阅新工单线程——原工单的 worker 据此读到新工单线程上的动静(上下文)。
    if (outcome.handoffOf) {
      for (const triggerId of triggerIds) {
        for (const ref of this.repo.triggers.get(triggerId)?.threads ?? []) {
          this.subscribeUnlessDispatch(outcome.handoffOf, ref, (tid, r) => { this.subscribe(tid, r) })
        }
      }
    }
    if (outcome.acknowledgement && primary) this.replies.acknowledgeAccepted(id, primary, outcome.acknowledgement)
    this.options.executor.start(this.require(id), assignment)
    this.emit('ticket.created', { ticketId: id, decisionId, strength: mandate.strength })
  }
  /**
   * 让开放工单订阅 `thread`,并记入 `ticket.follows`(工单自开的为 `own`)。
   * @throws UserError 当工单未知或已结束。
   */
  bind(ticketId: string, thread: ThreadRef, own: boolean): Ticket {
    if (!liveTicket(this.require(ticketId))) throw new UserError('ticketEnded')
    this.subscribe(ticketId, thread)
    const ticket = this.require(ticketId)
    const followed = threadKey(thread)
    const follow = ticket.follows?.find(item => item.thread === followed)
    // 重绑先前关闭过的线程会重开它;`own` 一经设置保持。
    if (follow) { follow.own ||= own; delete follow.closed } else ticket.follows = [...ticket.follows ?? [], { thread: followed, own }]
    ticket.updatedAt = this.now()
    this.repo.tickets.save(ticket)
    return ticket
  }
  /**
   * 记录开放工单跟随的某线程关闭,并对每张已随其线程完成的工单收尾(见 followsDone)——除非其
   * 工作尚未完成(见 unfinished);后者待其报告 ready 时再收尾。
   */
  threadClosed(thread: ThreadRef, outcome: 'merged' | 'closed', at: string): void {
    const closed = threadKey(thread)
    for (const ticket of this.repo.tickets.open()) {
      const follow = ticket.follows?.find(item => item.thread === closed && !item.closed)
      if (!follow) continue
      follow.closed = { at, outcome }
      this.repo.tickets.save(ticket)
      const done = this.followsDone(ticket)
      if (!done || this.unfinished(ticket, at)) continue
      // 关闭之后恢复并完成的工作现在收尾。
      const resumed = Date.parse(latestAssignment(ticket)?.createdAt ?? '') > Date.parse(at)
      this.end(ticket.id, 'executor', done.outcome, resumed ? this.now() : done.at)
    }
  }
  /**
   * 跟随线程的工单何时算随线程完成:它自开的(`own`)线程无一还开着,或(一条也没开时)跟随的
   * 线程全部关闭。它以这些线程中最晚的关闭收尾;未完成时为 undefined。
   */
  followsDone(ticket: Ticket): Follow['closed'] {
    const follows = ticket.follows ?? []
    const own = follows.filter(item => item.own)
    const counted = own.length ? own : follows
    if (!counted.length || counted.some(item => !item.closed)) return undefined
    // SA 不变量:上一行已滤掉未关闭的 follows,此处 closed 恒在;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    return counted.map(item => item.closed!).sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  }
  /**
   * 待 attach 到工单的 Trigger,在工单可以接收它时。
   * @throws UserError 当 trigger 或工单未知、某工单的 worker 仍裁决该 trigger、人 stop 过该工单、
   * 或已结束工单的 Mandate 不再通过校验。
   */
  attachable(ticketId: string, triggerId: string): Trigger {
    const trigger = this.repo.triggers.get(triggerId)
    if (!trigger) throw new UserError('unknownTrigger')
    // 到达过工单的后续消息,只有在裁决它的 worker 们交回之后才可他去。
    this.leftToWorkers(trigger)
    const current = this.require(ticketId)
    if (current.ended?.by === 'human') throw new UserError('ticketStopped')
    if (!liveTicket(current) && !this.policy().revalidate(current.mandate)) throw new UserError('mandateRevoked')
    return trigger
  }
  /**
   * 让工单订阅被 attach 的 Trigger 的线程,并把该 Trigger 作为一条 Input 加入,附注记。此后其
   * worker 裁决它,如同裁决到达其自有线程的消息;不把它当自己工单内容的 worker 会把它当作一条
   * 新 Input,任何被 attach 的消息都会这样唤醒已结束的工单。
   */
  attach(ticketId: string, trigger: Trigger, note?: string): void {
    // ★派发渠道纪律(2026-11-23):attach 到主会话线程时不订阅它——否则下一次新话题又会被
    // 扇出成本单的 Input(与 accept 同一根因)。attach 的意图仍是"这条属于这张单":该
    // Trigger 本身照样以 Input 进来、disposition.fanout 照样记本单(followupOwners 据此判
    // 归属),只是**不订阅线程**——之后的同线程新消息继续走候选卡,要不要再挂由主会话裁决。
    for (const ref of trigger.threads) this.subscribeUnlessDispatch(ticketId, ref, (tid, r) => { this.subscribe(tid, r) })
    // 人把它送进 Eval 的那一次已了结,它「仅为上下文而读」的标记也一样。
    const current: TriggerDisposition = this.repo.triggers.disposition(trigger.id) ?? { fanout: [], at: this.now() }
    const { context, requeued, ...disposition } = current
    const followed = context?.filter(id => id !== ticketId)
    this.repo.triggers.saveDisposition(trigger.id, { ...disposition, fanout: [...new Set([...disposition.fanout, ticketId])],
      ...followed?.length ? { context: followed } : {} })
    const ticket = this.require(ticketId)
    const id = key('input', ticketId, 'trigger', trigger.id)
    const existing = ticket.inputs.find(input => input.id === id)
    const at = this.now()
    const input = (inputId: string): TicketInput => ({ id: inputId, kind: 'trigger', triggerId: trigger.id, at, ...(note ? { note } : {}),
      ...trigger.human ? { human: true } : {} })
    if (existing?.kind !== 'trigger') this.addInput(ticket, input(id))
    else if (note && ticket.undelivered.includes(id)) { existing.note = note; ticket.updatedAt = at; this.repo.tickets.save(ticket) }
    // 人把它送进了 Eval、或工单在其 worker 接手前放开过它、仅以上下文读过它、或在 worker 持有
    // 它之后结束过——worker 都要再拿到它一次。
    else if (requeued || !current.fanout.includes(ticketId) || context?.includes(ticketId) || !liveTicket(ticket)) {
      this.addInput(ticket, input(key('input', ticketId, 'trigger', trigger.id, 'attached', at)))
    }
    // worker 已持有该消息,故注记随它再来一次。
    else if (note) this.addInput(ticket, input(key('input', ticketId, 'trigger', trigger.id, 'note', note)))
  }
  /**
   * 请最新报告为 `waiting` 的运行中 worker 汇报一次状态;其他工单一概不动。
   * @returns 是否排入了状态请求 Input。
   * @throws UserError 当工单未知。
   */
  requestStatus(ticketId: string): boolean {
    const ticket = this.require(ticketId)
    if (!liveTicket(ticket) || runningAssignment(ticket)?.report?.state !== 'waiting') return false
    this.addInput(ticket, { id: `status:${ticketId}:${ticket.updatedAt}`, kind: 'text', text: STATUS_REQUEST, at: this.now() })
    return true
  }
  /**
   * 代人 stop 一张工单,结束其一切活动 assignment。
   * @throws UserError 当工单未知。
   */
  stop(ticketId: string, reason?: string): Ticket {
    this.end(ticketId, 'human', 'stopped', this.now(), reason)
    return this.require(ticketId)
  }
  /**
   * 结束可重试开放工单(报 `failed`/`blocked` 或 Input 投递失败)卡住的 assignment,另起新的。
   * @throws UserError 当工单未知或不可重试。
   */
  retry(ticketId: string): Ticket {
    const ticket = this.require(ticketId)
    const latest = latestAssignment(ticket)
    if (!canRetry(ticket) || !latest) throw new UserError('notRetryable')
    this.endAssignment(ticket, latest, 'retried')
    this.requeueUntaken(ticket, latest)
    const assignment = this.newAssignment(ticket)
    ticket.updatedAt = this.now()
    this.repo.tickets.save(ticket)
    this.options.executor.stop(ticket, latest, 'retried')
    this.options.executor.start(ticket, assignment)
    return ticket
  }
  /**
   * 撤掉工单对某线程的 Subscription(worker 判定其与工单无关),并把它裁决的该线程上人的消息连同
   * `reason` 交回。
   * @throws UserError 当工单未知,或 `thread` 是 origin 线程、绑定的 `follows` 线程、或未订阅的线程。
   */
  markUnrelated(ticketId: string, thread: string, reason: string): void {
    const ticket = this.require(ticketId)
    if (this.source(ticket)?.threads.some(ref => threadKey(ref) === thread)) throw new UserError('sourceThread')
    if (ticket.follows?.some(item => item.thread === thread)) throw new UserError('followedThread')
    if (!this.repo.threads.get(thread)?.subscriptions.includes(ticketId)) throw new UserError('notFollowing')
    this.dropSubscriptions(thread, 'executor', ticketId, reason)
    // 其 worker 发现该线程不是本工单的:把它裁决的该线程上人的消息连同理由交回。
    for (const trigger of this.triggersOf(ticket)) {
      if (trigger.threads.some(ref => threadKey(ref) === thread) && this.owners(trigger).includes(ticketId))
        this.handBack(ticketId, trigger, reason)
    }
  }
  /**
   * ★只通知不撤销(27 号 §3.2-④;35 号 A8):把 Policy 变更对每张受影响开放工单的影响告知其
   * worker,按接受顺序从旧到新;其余工单一概不动。在跑工单的 Mandate 钉住创建时策略版本,
   * 新规则只影响新工单——绝不在此撤销或改写任何 Mandate。
   */
  policyChanged(from: string, to: string, effects: ReadonlyMap<string, PolicyEffect>): void {
    const at = this.now()
    // 按接受顺序从旧到新迭代,使投递按接受顺序排队。
    for (const ticket of this.repo.tickets.open().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const effect = effects.get(ticket.id)
      // `at` 进 Input key,使同一对版本间的反复切换仍各记一条新 Input。
      if (effect) this.addInput(ticket, { id: key('input', ticket.id, 'policy', from, to, at), kind: 'policy-changed', from, to, at, effect })
    }
  }
  /**
   * 撤掉某线程的 Subscription——每张工单的、或仅 `ticketId` 的,并宣告之;无 Subscription 可撤时
   * 为 false。曾跟随该线程的工单不再跟随,其关闭也不再结束该工单。每张工单对其从该线程收到过的
   * 消息仍保有裁决权。
   */
  dropSubscriptions(thread: string, by: 'person' | 'executor', ticketId?: string, reason?: string): boolean {
    const current = this.repo.threads.get(thread)
    const tickets = current?.subscriptions.filter(id => ticketId === undefined || id === ticketId) ?? []
    if (!current || !tickets.length) return false
    current.subscriptions = current.subscriptions.filter(id => !tickets.includes(id))
    this.repo.threads.save(current)
    for (const id of tickets) {
      const ticket = this.repo.tickets.get(id)
      if (!ticket?.follows?.some(item => item.thread === thread)) continue
      const { follows: before, ...rest } = ticket
      const follows = before.filter(item => item.thread !== thread)
      this.repo.tickets.save(follows.length ? { ...rest, follows } : rest)
    }
    for (const id of tickets) this.emit('thread.unsubscribed', { threadKey: current.key, ticketId: id, by, ...(reason ? { reason } : {}) })
    return true
  }
  /**
   * 幂等地添加一条 Input 并请 Executor 投递之;或在不等人时重新启动投递失败过的 pending
   * Assignment:Policy 变更本身不会重新启动它。
   */
  addInput(ticket: Ticket, input: TicketInput): void {
    if (ticket.inputs.some(existing => existing.id === input.id)) return
    ticket.inputs.push(input); ticket.updatedAt = this.now()
    // worker 等人期间,自动 Input 暂扣不发。
    const held = liveTicket(ticket) && automatic(input) && waitsForPerson(ticket)
    if (!held) ticket.undelivered.push(input.id)
    this.repo.tickets.save(ticket)
    if (!liveTicket(ticket) || held) return
    const running = runningAssignment(ticket), latest = latestAssignment(ticket)
    if (running) this.options.executor.deliver(ticket, running)
    else if (latest?.state === 'pending' && !waitsForPerson(ticket)) this.options.executor.start(ticket, latest)
  }
  /**
   * 当人的消息在工单某线程上等它时,在 Mandate 不变的前提下恢复已结束的工单:无 Eval 也无
   * Decision,因为没有新的授权发生。Mandate 不再通过当前 Policy 校验的工单保持结束、什么都
   * 不收(见 refuse)。处理暂停期间消息等待,暂停后的首次 pass 在彼时的 Policy 下恢复工单。
   * 重读工单,故幂等,且不动已恢复的工单。
   */
  wake(ticketId: string): void {
    const ticket = this.repo.tickets.get(ticketId)
    if (!ticket || liveTicket(ticket) || ticket.ended?.by === 'human' || !ticket.undelivered.length) return
    const policy = this.policy()
    if (policy.paused) return
    if (!policy.revalidate(ticket.mandate)) { this.refuse(ticket); return }
    // 只有人写的消息恢复已结束工单;bot/CI 的 trigger 与工单结束前的 Input 一并等待。
    const first = ticket.undelivered.map(id => ticket.inputs.find(input => input.id === id)).find(input => input?.kind === 'trigger' && input.human)
    if (first?.kind !== 'trigger') return
    const at = this.now()
    delete ticket.ended; ticket.updatedAt = at
    const assignment = this.newAssignment(ticket)
    // resumed 标记排到最前,先于等待中的消息投递。
    const resumed: TicketInput = { id: key('input', ticket.id, 'resumed', first.triggerId), kind: 'resumed', triggerId: first.triggerId, at }
    ticket.inputs.push(resumed); ticket.undelivered.unshift(resumed.id)
    this.repo.tickets.save(ticket)
    this.options.executor.start(ticket, assignment)
    this.emit('ticket.resumed', { ticketId, triggerId: first.triggerId })
  }
  /** 工单 trigger Inputs 对应的 Trigger,或其中 Input id 在 `ids` 内的那些。 */
  private triggersOf(ticket: Ticket, ids?: readonly string[]): Trigger[] {
    return ticket.inputs.flatMap(input => input.kind === 'trigger' && (!ids || ids.includes(input.id))
      // 空数组占位以保持 flatMap 形状与 SA 原样
      ? this.repo.triggers.get(input.triggerId) ?? [] : [])
  }
  /**
   * 工单的 worker 是否接手了某条人的消息——以确认或答复的方式。确认记录到 disposition 之前的
   * 时代,只有 outbox 里存在该确认消息这一证据。
   */
  private takenUp(ticket: Ticket, trigger: Trigger): boolean {
    const acked = this.repo.triggers.disposition(trigger.id)?.acked
    return acked ? acked.includes(ticket.id) : this.options.outbox.status(key('ack', trigger.id)) !== undefined
  }
  /** 工单 Inputs `ids` 中,它所裁决且 worker 尚未接手的人的消息。 */
  private untaken(ticket: Ticket, ids: readonly string[]): Trigger[] {
    return this.triggersOf(ticket, ids).filter(trigger => this.owners(trigger).includes(ticket.id) && !this.takenUp(ticket, trigger))
  }
  /**
   * 已结束、或无法恢复的工单,放开其 worker 从未收到的消息(`waiting`),与其裁决过但未必接手
   * 过的人的消息(`left`):它不再算作「到达过」它们;`left` 中没有其他工单裁决的每条进 Eval,
   * 如同到达过任何工单的人消息一样——除非某工单接手了它、一个 Decision 已裁决它、或它正是
   * 结束本工单的那条 stop 消息。
   */
  private letGo(ticketId: string, waiting: readonly Trigger[], left: readonly Trigger[]): void {
    for (const trigger of [...waiting, ...left]) {
      const disposition = this.repo.triggers.disposition(trigger.id)
      if (disposition?.fanout.includes(ticketId)) {
        this.repo.triggers.saveDisposition(trigger.id, { ...disposition, fanout: disposition.fanout.filter(id => id !== ticketId) })
      }
    }
    for (const trigger of left) {
      const disposition = this.repo.triggers.disposition(trigger.id)
      const decision = disposition?.decisionId ? this.repo.decisions.get(disposition.decisionId) : undefined
      // 在该消息上 stop 了本工单的主 Session,自行裁决该消息的其余部分——除非有工单交回过它。
      const stopped = decision?.kind === 'stop' && decision.ticketId === ticketId && !disposition?.handbacks?.length
      const decided = !!decision && (settled(decision) || stopped)
      if (!this.owners(trigger).length && !disposition?.acked?.length && !decided) this.queueForEval(trigger)
    }
  }
  /** 无法恢复的已结束工单,不再接收等它的任何消息(见 letGo)。 */
  private refuse(ticket: Ticket): void {
    const waiting = this.triggersOf(ticket, ticket.undelivered), left = this.untaken(ticket, ticket.undelivered)
    ticket.undelivered = []
    this.repo.tickets.save(ticket)
    this.letGo(ticket.id, waiting, left)
  }
  /** 以先收到 `note` 的新 Assignment 替换工单运行中的 Assignment,并排队启动。 */
  restart(ticket: Ticket, running: Assignment, reason: string, note: string): void {
    this.endAssignment(ticket, running, reason)
    this.requeueUntaken(ticket, running)
    const assignment = this.newAssignment(ticket)
    const at = this.now()
    const input: TicketInput = { id: key('input', ticket.id, 'restart', assignment.id), kind: 'text', text: note, at }
    ticket.inputs.push(input); ticket.undelivered.push(input.id); ticket.updatedAt = at
    this.repo.tickets.save(ticket)
    this.options.executor.start(ticket, assignment)
  }
  /**
   * 把投递到 `replaced` 而 worker 无任何步骤摄入过的 trigger Inputs 放回等待队列最前:取消可能
   * 丢弃了它们,或摄入它们的步骤被打断;新 Assignment 的启动会带走仍在 Session 里等待的副本,
   * 故其投递是唯一一份。更早的结束已放开更早 Assignment 留下的。
   */
  private requeueUntaken(ticket: Ticket, replaced: Assignment): void {
    const untaken = ticket.inputs.filter(input => input.kind === 'trigger' && input.readAt === null && input.deliveredTo === replaced.id
      && !ticket.undelivered.includes(input.id))
    ticket.undelivered.unshift(...untaken.map(input => input.id))
  }
  /**
   * 以某 outcome 结束工单。`at` 记录结束事实发生的时刻(如 PR 合并时刻),`reason` 以文字说明
   * 缘由,缺省即 outcome。工单放开(见 letGo)其 worker 从未收到的消息,与其裁决过、但 worker
   * 在最新报告或一轮结束之前没有读过(含结束工单的这条报告本身,见 readBefore)、且未确认、
   * 未答复、也未交回的人的消息:它可能恰在 worker 写结束报告时、或其一轮结束后到达,两种情况
   * 下 worker 都已无法再交回它。
   */
  end(ticketId: string, by: TicketEndBy, outcome: TicketOutcome, at = this.now(), reason?: string): void {
    const ticket = this.require(ticketId)
    if (!liveTicket(ticket)) return
    const stopping = ticket.assignments.filter(assignment => assignment.state !== 'ended')
    const why = reason && reason !== outcome ? { reason } : {}
    const until = readUntil(ticket)
    const waiting = this.triggersOf(ticket, ticket.undelivered)
    const left = this.untaken(ticket, ticket.inputs.flatMap(input => input.kind === 'trigger'
      && (!readBefore(input, until) || ticket.undelivered.includes(input.id)) ? [input.id] : []))
    // 更早发生的结束时刻(如 PR 的合并)不把工单的最后变更时间往回挪。
    ticket.ended = { at, by, outcome, ...why }; ticket.undelivered = []; ticket.updatedAt = this.now()
    delete ticket.attention; delete ticket.delivery
    // 结束所停止的各 Assignment 随之结束;工单的结束说明缘由。
    for (const assignment of stopping) { assignment.state = 'ended'; assignment.endedAt = at }
    this.repo.tickets.save(ticket)
    this.letGo(ticketId, waiting, left)
    // ★本仓改造(34 §2.1 ports 行;35 号 A5):载荷带 realm——记忆整固与冲突指标按 realm 归账。
    this.emit('ticket.ended', { ticketId, realm: ticket.realm, by, outcome, ...why })
    for (const assignment of stopping) this.options.executor.stop(ticket, assignment, reason ?? outcome)
  }
  /**
   * 工单的工作在 `at` 时刻的关闭处是否尚未完成:其 worker 接手了工单裁决的人的消息且自其
   * Session 摄入该消息后未报过 progress 之外的报告、或未结束过一轮;或关闭后恢复的工作(其后
   * 启动的 Assignment)尚无 ready 报告、或其后还有 Input 到达;Policy 变更不算工作。
   */
  private unfinished(ticket: Ticket, at: string): boolean {
    const until = readUntil(ticket, false)
    const taken = this.triggersOf(ticket, ticket.inputs.flatMap(input => input.kind === 'trigger' && !readBefore(input, until) ? [input.id] : []))
      .some(trigger => this.owners(trigger).includes(ticket.id) && this.takenUp(ticket, trigger))
    const latest = latestAssignment(ticket)
    if (taken || !(Date.parse(latest?.createdAt ?? '') > Date.parse(at))) return taken
    const report = latest?.report
    const later = ticket.inputs.some(input => input.kind !== 'policy-changed' && Date.parse(input.at) > Date.parse(report?.at ?? ''))
    return report?.state !== 'ready' || ticket.undelivered.length > 0 || later
  }
  /** 添加一条 pending Assignment;对前一条的投递失败不再记在本工单上。 */
  private newAssignment(ticket: Ticket): Assignment {
    const assignment: Assignment = { id: key('assignment', ticket.id, String(ticket.assignments.length)), state: 'pending', createdAt: this.now() }
    ticket.assignments.push(assignment)
    delete ticket.delivery
    return assignment
  }
  private endAssignment(ticket: Ticket, assignment: Assignment, reason: string): void {
    assignment.state = 'ended'; assignment.endedAt = this.now(); assignment.endedReason = reason
    this.emit('assignment.ended', { ticketId: ticket.id, assignmentId: assignment.id, reason })
  }
  /**
   * 以 note Input 把一条事实交给开放工单的 Executor,如另一工单的发现;它不请求任何事、不授予
   * 任何权力(见 TicketInput)。
   * @throws UserError 当工单未知或已结束。
   */
  note(ticketId: string, text: string): Ticket {
    const ticket = this.require(ticketId)
    if (!liveTicket(ticket)) throw new UserError('ticketEnded')
    const at = this.now()
    this.addInput(ticket, { id: key('input', ticketId, 'note', at, text), kind: 'note', text, at })
    return this.require(ticketId)
  }
  /**
   * 让开放工单为其 Executor 订阅一条相关线程,仅为上下文:见 `Thread.context`。
   * @returns 工单已跟随该线程时为 false。
   * @throws UserError 当工单未知或已结束。
   */
  followForContext(ticketId: string, ref: ThreadRef): boolean {
    if (!liveTicket(this.require(ticketId))) throw new UserError('ticketEnded')
    if (this.thread(ref).subscriptions.includes(ticketId)) return false
    this.subscribe(ticketId, ref)
    const thread = this.thread(ref)
    thread.context = [...thread.context ?? [], ticketId]
    this.repo.threads.save(thread)
    return true
  }
  /** 让工单订阅一条线程;其后其上的 Trigger 作为 Input 到达工单,先前仅为上下文的成为其自有。 */
  private subscribe(ticketId: string, ref: ThreadRef): void {
    const thread = this.thread(ref)
    if (!thread.subscriptions.includes(ticketId)) { thread.subscriptions.push(ticketId); this.emit('thread.subscribed', { threadKey: thread.key, ticketId }) }
    if (thread.context?.includes(ticketId)) thread.context = thread.context.filter(id => id !== ticketId)
    this.repo.threads.save(thread)
  }
}
