/**
 * Evals——线程级评估批次与其终结的 Decision(35 号 A7)。
 *
 * 设计依据:34 号 §2.1 evals 行;语义自 SA/src/core/evals.ts 重写级校对移植,不变量原样。
 * 本仓拍板改造三处:
 * - ★R3 四要素硬约束(24 §5.5-R3;34 §2.1 evals 行;35 号 A7):accept 结果必须携带委派四要素
 *   (objective/outputFormat/toolGuidance/taskBoundaries),缺任一在 `decide` 抛
 *   `UserError('delegationIncomplete')`——比 SA 的卡片约定更硬,结构校验不靠 prompt;
 * - ★realm(24a A1;35 号 A7):accept 固化 Mandate 时写入 realm(取 intake 落库标注,见 part.realmOf);
 * - ★四要素随 Decision 落库(35 号表②-6:审计 trace「Trigger→候选卡→Decision 理由→四要素」全链可查)。
 * observe 档 would_accept 全量记录的语义在 Policy 实现面(35 号 A4/A10,24a B1);本部件承接的
 * 内核半边是:`decide` 的 inferred 只在策略 `admitsInferred`(即 auto 档启用规则)时可 accept。
 */
import { key } from './ids.ts'
import { UserError } from './errors.ts'
import { liveTicket, threadKey } from './model.ts'
import type { Decision, DecisionKind, Delegation, EffortTier, Evaluation, Mandate, MandateBasis, Strength, Thread, Trigger } from './model.ts'
import type { AssessmentOutcome, Candidate, Policy } from './ports.ts'
import { said, type Reason } from './reasons.ts'
import { EnginePart, type EngineOptions } from './part.ts'
import type { Tickets } from './tickets.ts'

/** 对持有某条 Trigger 的 Eval 的裁决;`evalId` 点名所裁决的 Eval,更晚的 Eval 会拒绝它。 */
export type Outcome = AssessmentOutcome & { evalId?: string }
/** 一个 Eval 的终局,如它的 Decision 所记录的那样。 */
interface Finished {
  kind: DecisionKind
  reason: Reason[]
  audit?: Record<string, unknown>
  ticketId?: string
  mandate?: Mandate
  delegation?: Delegation
  /** ★R1 effort 档位随 accept Decision 落库(35 号 A17;24 §5.5-R1)。 */
  effort?: EffortTier
}

/** 裁决理由:结果自带的码,否则其 assessor 或人写下的话。 */
const reasonOf = (reason: string | Reason): Reason[] => [typeof reason === 'string' ? said(reason) : reason]
const stronger = (a: Strength, b: Strength): Strength => a === 'explicit' || b === 'explicit' ? 'explicit' : 'inferred'
/** 过期 Eval 连续把其 Trigger 重新排队的次数上限,超过记 unavailable。 */
const REQUEUES = 2
/**
 * ★R3 委派四要素完备性(35 号 A7):四要素齐备且非空白才算完整;缺任一,decide 拒收。
 * 「缺失」含字段缺席与非字符串值——一律 `UserError('delegationIncomplete')`,不得以裸 TypeError
 * 漏成非结构化拒绝(35 号 A7 验收门禁:结构校验,不靠 prompt)。
 */
const completeDelegation = (delegation: Delegation | undefined): boolean => !!delegation
  && [delegation.objective, delegation.outputFormat, delegation.toolGuidance, delegation.taskBoundaries]
    .every(part => typeof part === 'string' && part.trim().length > 0)

/**
 * Evals 承跑各线程的 Eval:把线程排队中的 Trigger 合成一批 Eval,强度、行动者与准入依据取自
 * gate;询问 assessor、在处理暂停期间保住其 deadline,并记录其终结的 Decision:accept、stop、
 * ignore 或 unavailable。它依赖 Tickets 建 accept 决定的工单、结束 stop 点名的工单;Engine 把主
 * Session 的裁决、人的重放、worker 的 handback 与 pass 周期的 Eval 工作都路由到这里。
 */
export class Evals extends EnginePart {
  private readonly tickets: Tickets
  constructor(options: EngineOptions, tickets: Tickets) { super(options); this.tickets = tickets }

  /**
   * 到期的线程 Eval 过期处理(见 expire);处理暂停期间不到期:Eval 记下暂停开始时刻,恢复后其
   * deadline 按暂停时长顺延。候选尚未到达 assessor Session 的 Eval 不过期。
   */
  due(thread: Thread, policy: Policy): void {
    const evaluation = thread.evaluating
    if (!evaluation || (policy.paused && evaluation.pausedAt)) return
    const now = this.now()
    if (policy.paused) evaluation.pausedAt = now
    else if (evaluation.pausedAt) {
      evaluation.deadline = new Date(Date.parse(evaluation.deadline) + Date.parse(now) - Date.parse(evaluation.pausedAt)).toISOString()
      delete evaluation.pausedAt
    } else if (evaluation.delivered && evaluation.deadline <= now) { this.expire(thread); return }
    else return
    this.repo.threads.save(thread)
  }
  /** Eval 的候选已被主会话回合收走(进入回合,不是仅入 inbox):其 deadline 自此刻起算。 */
  delivered(evalId: string, policy: Policy): void {
    const thread = this.repo.threads.active().find(item => item.evaluating?.id === evalId)
    if (!thread?.evaluating || thread.evaluating.delivered) return
    const now = this.now()
    thread.evaluating.delivered = now
    thread.evaluating.deadline = new Date(Date.parse(now) + policy.evalTimeoutMs).toISOString()
    this.repo.threads.save(thread)
  }
  /**
   * 启动对账(★assessor resume,2026-11-18):持 `evaluating` 且从未 `delivered` 的线程,其
   * 'assessment' effect 已随上次装配丢失(旧装配未投递即结算、或投递面当时缺席)——这样的
   * Eval 按原语义永不过期,陷入永不投递的死锁。以 `hostRestarted` 终结为 unavailable 并把
   * Trigger 排回队首,pass 周期即开新 Eval 重排候选卡(deliver 面就绪后送达才起 deadline,
   * 与 executor.resume() 的重启对账同位)。
   * @returns 被对账重排的线程数。
   */
  resume(): number {
    let resumed = 0
    for (const thread of this.repo.threads.active()) {
      if (!thread.evaluating || thread.evaluating.delivered) continue
      this.reassess(thread, { code: 'hostRestarted' })
      resumed += 1
    }
    return resumed
  }
  /**
   * 过期的 Eval 把其 Trigger 重新排队等一次新 Eval,至多连续 `REQUEUES` 次——忙碌的 assessor
   * 因此不丢请求;此后记为 unavailable。
   */
  private expire(thread: Thread): void {
    const expired = (thread.expired ?? 0) + 1
    if (expired > REQUEUES) {
      // SA 不变量:本方法仅在 thread.evaluating 存在时被调;非空断言与 SA 原样
      // oxlint-disable-next-line typescript/no-non-null-assertion
      this.finish(thread, thread.evaluating!, { kind: 'unavailable', reason: [{ code: 'timeout' }] })
      return
    }
    // 同上:expire 的调用前提是 evaluating 在位
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const { id, triggerIds } = thread.evaluating!
    delete thread.evaluating
    thread.expired = expired
    thread.pending = [...triggerIds, ...thread.pending.filter(item => !triggerIds.includes(item))]
    this.repo.threads.save(thread)
    this.options.assessor.release?.(id)
  }
  /** 开一次线程排队 Trigger 的 Eval,gate 裁定之,并向 assessor 请求评估。 */
  start(threadKeyValue: string, policy: Policy): void {
    // SA 不变量:start 只对 threads.active() 中的线程调用,库内恒有该线程;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const thread = this.repo.threads.get(threadKeyValue)!
    const at = this.now()
    // 仍被某工单裁决的人的后续消息归该工单:更早版本排进队列的,离开队列且不留 Decision。
    const delivered = (id: string) => {
      const trigger = this.repo.triggers.get(id)
      return !!trigger && this.owners(trigger).length > 0
    }
    if (thread.pending.some(delivered)) {
      const followups = thread.pending.filter(delivered)
      thread.pending = thread.pending.filter(id => !followups.includes(id))
      this.repo.threads.save(thread)
      for (const triggerId of followups) this.emit('trigger.followup', { triggerId })
      if (!thread.pending.length) return
    }
    // 已开出过工单的 Trigger 不能再借出授权或开出重复工单。
    const accepted = this.accepted(thread.key)
    const started = thread.pending.filter(id => accepted.has(id))
    // SA 不变量:started 中的 id 必在 accepted 内且带 ticketId;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const startedTicket = (id: string): Reason => ({ code: 'startedTicket', triggerId: id, values: { ticket: accepted.get(id)!.ticketId! } })
    if (started.length) this.ignore(thread, started, started.map(startedTicket), policy, at)
    const triggers = thread.pending.flatMap((id) => { const trigger = this.repo.triggers.get(id); return trigger ? [trigger] : [] })
    const tickets = this.ticketsOnThread(thread)
    const reasons: Reason[] = []
    let strongest: { trigger: Trigger; strength: Strength; basis: MandateBasis } | undefined
    for (const trigger of triggers) {
      const gate = policy.gate(trigger, thread, tickets)
      if (!gate.admissible) { reasons.push({ code: gate.reason, triggerId: trigger.id }); continue }
      const later = gate.strength === strongest?.strength && trigger.at >= strongest.trigger.at
      const weaker = !strongest || stronger(strongest.strength, gate.strength) !== strongest.strength
      if (weaker || later) strongest = { trigger, strength: gate.strength, basis: gate.basis }
    }
    if (!strongest) {
      if (thread.pending.length) this.ignore(thread, [...thread.pending], reasons.length ? reasons : [{ code: 'noAdmissible' }], policy, at)
      this.repo.threads.save(thread)
      return
    }
    const evalId = key('eval', thread.key, policy.version, at, ...thread.pending)
    const deadline = new Date(Date.parse(at) + policy.evalTimeoutMs).toISOString()
    const { strength, trigger: { actor }, basis } = strongest
    thread.evaluating = { id: evalId, threadKey: thread.key, triggerIds: thread.pending, primary: strongest.trigger.id, strength, actor,
      basis, policyVersion: policy.version, startedAt: at, deadline }
    thread.pending = []
    this.repo.threads.save(thread)
    for (const trigger of triggers) {
      this.repo.triggers.saveDisposition(trigger.id, { ...(this.repo.triggers.disposition(trigger.id) ?? { fanout: [], at }), evalId })
    }
    this.emit('eval.started', { evalId, threadKey: thread.key, triggerIds: thread.evaluating.triggerIds, strength: strongest.strength })
    this.options.assessor.request(this.candidateOf(thread))
  }
  /** 持有 `triggerId` 的 Eval 的候选;无 Eval 持有时为 undefined。 */
  candidate(triggerId: string): Candidate | undefined {
    const thread = this.holding(triggerId)
    return thread && this.candidateOf(thread)
  }
  /**
   * 裁决一条 Trigger:持有它的 Eval,或没有 Eval 持有时的仅它一条的直接 Eval。
   * ★R3 落点(A7):accept 结果缺任一委派四要素即拒(`delegationIncomplete`)。
   * @throws UserError 当 Trigger 未知或不可受理、`outcome.evalId` 点名的 Eval 已结束、某工单的
   * worker 仍裁决该 Trigger 且结果不是 stop、accept 缺 R3 四要素,或推断候选在 auto 档之外、
   * 无启用匹配规则时被 accept。
   */
  decide(triggerId: string, outcome: Outcome): Decision {
    // ★R3 四要素硬约束(35 号 A7):结构校验先于一切状态读取——缺任一要素,候选卡即被拒。
    if (outcome.kind === 'accept' && !completeDelegation(outcome.delegation)) throw new UserError('delegationIncomplete')
    const trigger = this.repo.triggers.get(triggerId)
    if (!trigger) throw new UserError('unknownTrigger')
    const held = this.holding(triggerId)
    if (outcome.evalId && held?.evaluating?.id !== outcome.evalId) throw new UserError('evalFinished', { eval: outcome.evalId })
    // 已开出过工单的重放 Trigger 不开第二张。
    // SA 不变量:threads[0] 恒存在(Trigger 的主线程);非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const earlier = outcome.kind === 'accept' ? this.accepted(threadKey(trigger.threads[0]!)).get(triggerId) : undefined
    if (earlier) {
      // 只有更早版本启动的 Eval 还可能持有它;不带它重评其余 Trigger,或仅它一条时忽略它。
      const others = held?.evaluating?.triggerIds.filter(id => id !== triggerId) ?? []
      if (held && others.length) this.reassess(held, { code: 'acceptedBefore', values: { trigger: triggerId } }, [triggerId])
      else if (held) {
        // SA 不变量:此处 held 的 evaluating 在位、earlier 必有 ticketId(accepted() 已过滤);非空断言与 SA 原样
        // oxlint-disable-next-line typescript/no-non-null-assertion
        this.finish(held, held.evaluating!, { kind: 'ignore', reason: [{ code: 'startedTicket', triggerId, values: { ticket: earlier.ticketId! } }] })
      }
      return earlier
    }
    // 到达过工单的后续消息归其 worker 裁决:主 Session 对它只能 stop 该工单的工作。
    if (outcome.kind !== 'stop') this.leftToWorkers(trigger)
    // 同上:threads[0] 恒存在
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const thread = held ?? this.thread(trigger.threads[0]!)
    const evaluation = held?.evaluating ?? this.directEval(thread, trigger, outcome.kind, outcome.kind === 'stop' ? outcome.ticketId : undefined)
    // 推断候选仅在评估命中且启用的规则上可 accept;评估面(observe 档)则记录 would_accept 而不接受。
    if (outcome.kind === 'accept' && evaluation.strength !== 'explicit' && !this.policy().admitsInferred(outcome.rules ?? [])) {
      throw new UserError('notExplicit')
    }
    return this.decideEval(thread, evaluation, outcome)
  }
  /**
   * 把一条已落库的 Trigger 排到其主线程等新 Eval 并发 `trigger.requeued`;有 Eval 持有它时返回 false。
   * @throws UserError 当 Trigger 未知。
   */
  reevaluate(triggerId: string): boolean {
    if (!this.requeue(triggerId)) return false
    this.emit('trigger.requeued', { triggerId })
    return true
  }
  /** 把一条 Trigger 排到其主线程等新 Eval;有 Eval 持有它时为 false。 */
  private requeue(triggerId: string): boolean {
    const trigger = this.repo.triggers.get(triggerId)
    if (!trigger) throw new UserError('unknownTrigger')
    if (this.holding(triggerId)) return false
    this.queueForEval(trigger)
    const disposition = this.repo.triggers.disposition(triggerId) ?? { fanout: [], at: this.now() }
    this.repo.triggers.saveDisposition(triggerId, { ...disposition, requeued: true })
    return true
  }
  /**
   * 记录某工单的 Executor 把一条到达该工单的 Trigger 交回为超出工单,并在「该工单裁决它、且无其他
   * 工单仍裁决它」时把它排回 Eval(见 handBack):gate 按其线程上的任何消息一样裁决它,其候选带着
   * 理由,故此前不会有 requeue 通知。工单保住其 Subscription,且一条 Trigger 只交回一次。
   * @returns 是否排入:另一工单仍裁决它、或本工单未曾裁决它时为 false。
   */
  handback(ticketId: string, triggerId: string, reason: string): boolean {
    const ticket = this.require(ticketId)
    if (!ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === triggerId)) throw new UserError('notReached')
    if (this.repo.triggers.disposition(triggerId)?.handbacks?.some(item => item.ticketId === ticketId)) throw new UserError('handedBack')
    // SA 不变量:handback 前置校验保证该 Trigger 已落库;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    return this.handBack(ticketId, this.repo.triggers.get(triggerId)!, reason)
  }
  /**
   * 把一条 unavailable Decision 标记为已关闭,总览不再列出它。
   * @throws UserError 当 Decision 未知或不是 unavailable。
   */
  dismiss(decisionId: string): Decision {
    const decision = this.repo.decisions.get(decisionId)
    if (decision?.kind !== 'unavailable') throw new UserError('unknownProblem')
    decision.dismissed = true
    this.repo.decisions.save(decision)
    return decision
  }
  /** 因被手工路由,把一条 Trigger 移出其线程队列。 */
  withdraw(trigger: Trigger): void {
    // 同 decide:threads[0] 恒存在
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const thread = this.repo.threads.get(threadKey(trigger.threads[0]!))
    if (!thread?.pending.includes(trigger.id)) return
    thread.pending = thread.pending.filter(id => id !== trigger.id)
    this.repo.threads.save(thread)
  }
  /**
   * 结束持有被路由到某工单的 Trigger 的 Eval——工单已持有它:还持有其他 Trigger 的,不带它
   * 重新排队等新 Eval。
   */
  routed(triggerId: string, ticketId: string): void {
    const held = this.holding(triggerId)
    const reason: Reason = { code: 'routed', values: { ticket: ticketId } }
    if (held?.evaluating?.triggerIds.length === 1) this.finish(held, held.evaluating, { kind: 'ignore', reason: [reason] })
    else if (held) this.reassess(held, { ...reason, triggerId }, [triggerId])
  }
  /** 把进行中的 Eval 在新 Policy 版本下重新开始,并宣告版本变更。 */
  policyChanged(from: string, to: string): void {
    for (const thread of this.repo.threads.active()) if (thread.evaluating) this.reassess(thread, { code: 'policyChanged' })
    this.emit('policy.changed', { from, to })
  }
  /** 以 `reason` 把线程的 Eval 终结为 unavailable,并把其 Trigger(除 `without` 外)排到队列最前等新 Eval。 */
  private reassess(thread: Thread, reason: Reason, without: string[] = []): Decision {
    // SA 不变量:reassess 只在有 evaluating 的线程上调用;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const ids = thread.evaluating!.triggerIds.filter(id => !without.includes(id))
    // 同上
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const decision = this.finish(thread, thread.evaluating!, { kind: 'unavailable', reason: [reason] })
    // 同上:reassess 后线程恒在库内
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = this.repo.threads.get(thread.key)!
    current.pending = [...ids, ...current.pending.filter(id => !ids.includes(id))]
    this.repo.threads.save(current)
    return decision
  }
  /** 其 Eval 持有一条 Trigger 的线程:Eval 跑在其持有每条 Trigger 的主线程上。 */
  private holding(triggerId: string): Thread | undefined {
    const trigger = this.repo.triggers.get(triggerId)
    // threads[0] 恒存在(Trigger 不变量)
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const thread = trigger && this.repo.threads.get(threadKey(trigger.threads[0]!))
    return thread?.evaluating?.triggerIds.includes(triggerId) ? thread : undefined
  }
  private candidateOf(thread: Thread): Candidate {
    // SA 不变量:candidateOf 只对 evaluating 在位的线程调用;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const evaluation = thread.evaluating!
    const triggers = evaluation.triggerIds.flatMap((id) => { const trigger = this.repo.triggers.get(id); return trigger ? [trigger] : [] })
    const { id: evalId, strength, policyVersion } = evaluation
    // ★R1 effort 档位进候选卡字段(35 号 A17):领域包声明经 EngineOptions.effort 注入,缺席不带。
    const effort = this.options.effort?.()
    return { evalId, thread, triggers, strength, policyVersion, tickets: this.ticketsOnThread(thread), ...(effort ? { effort } : {}) }
  }
  /**
   * 记录线程排队中的 Trigger `ids` 不开 Eval,附理由,并把它们移出队列。其 id 与 Eval 的不同,
   * 故不会顶替同批 Trigger 更早 Eval 的 Decision。
   */
  private ignore(thread: Thread, ids: string[], reason: Reason[], policy: Policy, at: string): void {
    const evaluation = { id: key('eval', thread.key, 'ignored', policy.version, at, ...ids), threadKey: thread.key, triggerIds: ids, strength: 'inferred' as const,
      actor: { source: thread.ref.source, id: '' }, basis: { via: 'followup' as const }, policyVersion: policy.version, startedAt: at, deadline: at }
    this.record(thread, evaluation, { kind: 'ignore', reason })
    thread.pending = thread.pending.filter(id => !ids.includes(id))
    delete thread.expired
  }
  /**
   * 主线程为 `threadKey` 的各 Trigger 的 accept Decision,按 Trigger 索引:每条各开出了什么。
   * Eval 与其 Decision 都跑在其 Trigger 的主线程上,故该线程的 Decision 按序读即得其全貌。
   */
  private accepted(threadKey: string): Map<string, Decision> {
    const accepted = new Map<string, Decision>()
    for (const decision of this.repo.decisions.byThread(threadKey)) {
      if (decision.kind !== 'accept' || !decision.ticketId) continue
      for (const id of decision.triggerIds) if (!accepted.has(id)) accepted.set(id, decision)
    }
    return accepted
  }
  /**
   * 仅 gate 的一条 Trigger 的直接 Eval,用于没有排队 Eval 时的裁决——如到达过工单的后续消息。
   * 它当场裁决,可与该线程进行中的 Eval 并存,并把该 Trigger 移出队列。其 id 含结果类型,
   * 故同一时刻对同一消息的 stop 与 accept 是两条 Decision。
   */
  private directEval(thread: Thread, trigger: Trigger, kind: AssessmentOutcome['kind'], ticketId?: string): Evaluation {
    const policy = this.policy()
    const gate = policy.gate(trigger, thread, this.ticketsOnThread(thread))
    if (!gate.admissible) throw new UserError('notAdmissible', { reason: gate.reason })
    const at = this.now()
    if (thread.pending.includes(trigger.id)) {
      thread.pending = thread.pending.filter(id => id !== trigger.id); this.repo.threads.save(thread)
    }
    const id = key('eval', thread.key, 'direct', trigger.id, kind, ...ticketId ? [ticketId] : [], at)
    return { id, threadKey: thread.key, triggerIds: [trigger.id], primary: trigger.id,
      strength: gate.strength, actor: trigger.actor, basis: gate.basis, policyVersion: policy.version, startedAt: at, deadline: at }
  }
  /** 把一个结果施加到线程的 Eval 上:进行中的那个,或仅 gate 的那个。 */
  private decideEval(thread: Thread, evaluation: Evaluation, outcome: AssessmentOutcome): Decision {
    const audit = outcome.audit ? { audit: outcome.audit } : {}
    // Policy 变了而没有活的 policyChanged 调用(如跨升级或重启)时重新排队。
    if (this.policy().version !== evaluation.policyVersion) {
      if (thread.evaluating?.id === evaluation.id) return this.reassess(thread, { code: 'policyChanged' })
      return this.finish(thread, evaluation, { kind: 'unavailable', reason: [{ code: 'policyChanged' }], ...audit })
    }
    // 未经评估、仅凭卡片忽略的推断候选,在所给理由之外说明这一点。
    const unassessed = outcome.kind === 'ignore' && evaluation.strength !== 'explicit' && !outcome.audit ? [{ code: 'ignoredFromCard' }] : []
    if (outcome.kind === 'ignore' || outcome.kind === 'unavailable') return this.finish(thread, evaluation, { kind: outcome.kind,
      reason: [...unassessed, ...reasonOf(outcome.reason)], ...audit })
    if (outcome.kind === 'stop') {
      const ticket = this.repo.tickets.get(outcome.ticketId)
      if (!ticket || !liveTicket(ticket)) return this.finish(thread, evaluation, { kind: 'ignore', reason: [{ code: 'stopUnknown' }],
        ...audit })
      if (evaluation.strength !== 'explicit') return this.finish(thread, evaluation, { kind: 'ignore',
        reason: [{ code: 'stopNotExplicit' }], ...audit })
      const decision = this.finish(thread, evaluation, { kind: 'stop', reason: reasonOf(outcome.reason), ticketId: ticket.id, ...audit })
      this.tickets.end(ticket.id, 'human', 'stopped', this.now(), typeof outcome.reason === 'string' ? outcome.reason : undefined)
      return decision
    }
    return this.accept(thread, evaluation, outcome)
  }
  /**
   * 记录一次 accept 与 Eval 给出的 Mandate(★含 realm,取 intake 落库标注——35 号 A7),
   * 并让 Tickets 开出其工单;★四要素随 Decision 落库(35 号表②-6 审计链);★A17:R1 effort
   * 档位随 Decision 落库(24 §5.5-R1;26 §4.1 effort 段——评估方回填候选卡档位,缺席不带)。
   */
  private accept(thread: Thread, evaluation: Evaluation, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>): Decision {
    const at = this.now()
    const basis = { ...evaluation.basis, ...(outcome.rules ? { rules: outcome.rules } : {}) }
    // SA 不变量:批次内每条 Trigger 都由 intake 落过库,primary 恒在(与 Tickets.create 同构回退到批次末条)。
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const origin = this.repo.triggers.get(evaluation.primary ?? evaluation.triggerIds.at(-1)!)!
    const { strength, policyVersion, actor } = evaluation
    // ★realm 首参路由(A7):Mandate 的 realm 取 origin Trigger 的 intake 落库标注(无标注时回退现算)。
    const mandate: Mandate = { strength, policyVersion, basis, actor, scope: outcome.scope, realm: this.realmOf(origin) }
    const ticketId = key('ticket', evaluation.id)
    const audit = outcome.audit ? { audit: outcome.audit } : {}
    const decision = this.finish(thread, evaluation, { kind: 'accept', reason: reasonOf(outcome.reason), ...audit, mandate, ticketId,
      delegation: outcome.delegation, ...(outcome.effort ? { effort: outcome.effort } : {}) })
    this.tickets.create(ticketId, decision.id, mandate, evaluation, outcome, at)
    return decision
  }
  /** 记录 Eval 的 Decision;线程自己的 Eval 随之终结,而仅 gate 的那个不打断线程的 Eval。 */
  private finish(thread: Thread, evaluation: Evaluation, outcome: Finished): Decision {
    const decision = this.record(thread, evaluation, outcome)
    // 直接(gate-only)评估不清除线程进行中的评估。
    if (thread.evaluating?.id !== evaluation.id) return decision
    delete thread.evaluating; delete thread.expired
    this.repo.threads.save(thread)
    this.options.assessor.release?.(evaluation.id)
    return decision
  }
  private record(thread: Thread, evaluation: Evaluation, outcome: Finished): Decision {
    const at = this.now()
    const decision: Decision = { id: key('decision', evaluation.id), evalId: evaluation.id, threadKey: thread.key, triggerIds: evaluation.triggerIds,
      policyVersion: evaluation.policyVersion, at, kind: outcome.kind, reason: outcome.reason, strength: evaluation.strength,
      ...(outcome.ticketId ? { ticketId: outcome.ticketId } : {}), ...(outcome.mandate ? { mandate: outcome.mandate } : {}),
      ...(outcome.delegation ? { delegation: outcome.delegation } : {}), ...(outcome.effort ? { effort: outcome.effort } : {}),
      ...(outcome.audit ? { audit: outcome.audit } : {}) }
    this.repo.decisions.save(decision)
    for (const id of evaluation.triggerIds) {
      const disposition = this.repo.triggers.disposition(id) ?? { fanout: [], at }
      this.repo.triggers.saveDisposition(id, { ...disposition, evalId: evaluation.id, decisionId: decision.id })
    }
    this.emit('decision.recorded', { decisionId: decision.id, kind: decision.kind, threadKey: thread.key })
    return decision
  }
}
