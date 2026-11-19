/**
 * 领域 Engine——内核唯一事务入口,及其调用方拿到的角色接口(35 号 A5)。
 *
 * 设计依据:34 号 §2.1 engine 行、§3 五角色接口清单;35 号 A5。语义自 SA/src/core/engine.ts
 * 重写级校对移植,不变量原样:
 * - 单写者(24 号 §5.3-6;27 号 §3.2-①「单写者=可串行化」):Trigger/Thread/Decision/Ticket/
 *   Assignment 的每次变更都经 `repo.atomic` 包成一个同步事务,跨聚合变更委托给兄弟部件、
 *   全部发生在同一事务之内(Repositories 全同步契约是可串行化的根基,34 号 §2.1);
 * - 五部件编排(34 号 §2.1):Sources→Intake、主 Session→Evals/Replies/Tickets、
 *   Executor/worker→Assignments/Tickets/Evals、Settings→Tickets/Evals;
 * - 调用方只拿角色裁剪的 Pick 接口,不拿完整 Engine(SA engine.ts:261-270 签名不变);
 * - `evaluateDue` 的 pass 驱动由本仓 pass 周期调用(28 号 §8-3;35 号 A16 装配面接线)。
 *
 * realm 首参路由(34 号 §2.1/§2.3;24a A1):Engine 实例本身绑定单 realm 的仓储聚合;
 * Trigger 的 realm 由 intake 落库时经 `EngineOptions.realmOf` 标注(见 part.ts/intake.ts),
 * accept 固化 Mandate 时随之写入——一租户一 SQLite 的 realm→Store 路由落在 35 号 A11
 * src/store/realm.ts,本文件不承担路由。
 */
import { UserError } from './errors.ts'
import { isoTime, liveTicket } from './model.ts'
import type { Decision, PolicyEffect, ThreadRef, Ticket, Trigger } from './model.ts'
import type { Candidate, Repositories } from './ports.ts'
import type { EngineOptions } from './part.ts'
import { Assignments, type WorkerReport } from './assignments.ts'
import { Evals, type Outcome } from './evals.ts'
import { Intake, type ReceiveResult } from './intake.ts'
import { Replies, type Reply, type ReplyRequest } from './replies.ts'
import { Tickets } from './tickets.ts'

export type { EngineOptions } from './part.ts'
export type { WorkerReport } from './assignments.ts'
export type { Outcome } from './evals.ts'
export type { ReceiveResult } from './intake.ts'
export type { Reply, ReplyRequest } from './replies.ts'

/**
 * 变更 Trigger、Thread、Decision、Ticket 与 Assignment 的唯一事务入口:在同步仓储事务内协调
 * Intake、Evals、Tickets、Assignments 与 Replies 五部件,副作用只经端口排队。调用方拿到的是
 * 角色裁剪的 Pick 接口,而非完整 Engine。
 */
export class Engine {
  private readonly repo: Repositories
  private readonly replies: Replies
  private readonly tickets: Tickets
  private readonly assignments: Assignments
  private readonly evals: Evals
  private readonly intake: Intake
  // 字段一律显式声明(不用 constructor 参数属性):宿主 Loader 走 Node strip-only TS,
  // 参数属性报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX、整条 import 链 failed to import
  // (2026-11-17 super/base 双 boot 实测;本包其余构造器同款口径)。
  private readonly options: EngineOptions
  constructor(options: EngineOptions) {
    this.options = options
    this.repo = options.repo
    this.replies = new Replies(options)
    this.tickets = new Tickets(options, this.replies)
    this.assignments = new Assignments(options, this.tickets, this.replies)
    this.evals = new Evals(options, this.tickets)
    this.intake = new Intake(options, this.tickets)
  }

  // Sources

  /**
   * 某 Source 请求收进一条 Trigger:落库一次,扇出到订阅其线程的工单(对已结束的工单只有人的
   * 消息,且立即恢复它——除非处理暂停中、或人已 stop 该工单),并把没有工单 worker 裁决的它
   * (见 `followupOwners`)排到其主线程等 Eval。某线程的 Eval 在跑时到达的 Trigger 一起等下一次。
   */
  receive(trigger: Trigger): ReceiveResult { return this.repo.atomic(() => this.intake.receive(trigger)) }
  /**
   * 某 Source 请求让一张开放工单跟随它的某条线程,例如 pull request 的;`own` 表示工单自己开的:
   * 工单订阅它,`ready` 报告只在 `followsDone` 成立时结束工单(见 `Tickets.followsDone`)。
   * @throws UserError 当工单未知或已结束。
   */
  bindThread(ticketId: string, thread: ThreadRef, own: boolean): Ticket {
    return this.repo.atomic(() => this.tickets.bind(ticketId, thread, own))
  }
  /**
   * 某 Source 的事实:某线程在其时刻关闭了,例如它的 pull request 被合并。跟随它的开放工单
   * 在完成其所跟随线程的工作时结束——除非关闭后恢复的工作尚未完成,或其 worker 在最新报告
   * 之后接手了一条由该工单裁决的人的消息。
   */
  threadClosed(thread: ThreadRef, outcome: 'merged' | 'closed', at: string): void {
    // 归一 Source 时间戳(如 GitHub 的整秒)为规范 ISO 形态。
    this.repo.atomic(() => { this.tickets.threadClosed(thread, outcome, isoTime(at)) })
  }

  // 时钟(pass 周期)

  /**
   * 把到期的 Eval 重排至多 `REQUEUES` 次后记 `unavailable`(未送达的 Eval 永不过期),启动排队
   * Trigger 所在线程的 Eval,并恢复处理暂停期间有人的消息等待的已结束工单。处理暂停期间一切
   * 不到期:每个在跑 Eval 记下暂停开始时刻,恢复后其 deadline 按暂停时长顺延。每个 Eval 与每次
   * 工单更新各占一个事务。
   */
  evaluateDue(): void {
    const policy = this.options.policy()
    for (const thread of this.repo.threads.active()) if (thread.evaluating) this.repo.atomic(() => { this.evals.due(thread, policy) })
    if (policy.paused) return
    for (const ticket of this.repo.tickets.active()) {
      if (!liveTicket(ticket) && ticket.undelivered.length) this.repo.atomic(() => { this.tickets.wake(ticket.id) })
    }
    for (const thread of this.repo.threads.active()) {
      if (thread.pending.length && !thread.evaluating) this.repo.atomic(() => { this.evals.start(thread.key, policy) })
    }
  }

  // 主 Session

  /** 持有某条 Trigger 的 Eval 的候选,如其 assessor 所见;无 Eval 持有它时为 undefined。 */
  candidate(triggerId: string): Candidate | undefined { return this.evals.candidate(triggerId) }
  /**
   * 裁决一条 Trigger:持有它的那个 Eval,或没有 Eval 持有它时仅它一条的直接 Eval——例如主
   * Session 路由的人的显式请求。推断候选仅在 `auto` 档且评估命中启用的规则时可 accept;已开过
   * 工单的 Trigger 返回那张工单的 Decision。无效 stop 记为 `ignore`;在旧版 Policy 下裁决的记为
   * `unavailable`。★R3(35 号 A7):accept 缺任一委派四要素抛 `UserError('delegationIncomplete')`。
   * @throws UserError 当 Trigger 未知或不可受理、`outcome.evalId` 点名的 Eval 已结束、某工单的
   * worker 仍裁决该 Trigger 且结果不是 stop、推断候选在 auto 档之外或无启用匹配规则时被 accept、
   * 或 accept 缺 R3 委派四要素。
   */
  decide(triggerId: string, outcome: Outcome): Decision { return this.repo.atomic(() => this.evals.decide(triggerId, outcome)) }
  /**
   * 把一条 Trigger attach 到消息所指的工单:工单订阅该 Trigger 的线程并把它作为一条带路由注记的
   * Input 收下,持有它的 Eval 随之终结——工单已持有它;其批次里的其他 Trigger 等一次新 Eval。
   * worker 已收到过的 Input 的注记作为新 Input 再发一次;工单放过过的、仅为上下文读过的、或结束前
   * 就有的消息也一样。已结束的工单在其 Mandate 下恢复,处理暂停期间除外(35 号 A8:attach 挂到
   * 已有工单而非新建,27 号 §3.3-B「合并请求替代竞速」)。
   * @throws UserError 对人 stop 过的工单(Mandate 已撤回)、或其 Mandate 已不被当前 Policy 持有的工单。
   */
  attach(ticketId: string, triggerId: string, note?: string): Ticket {
    return this.repo.atomic(() => {
      // 某工单的 worker 交回过的消息不是它的工作:attach 到这里,没有 worker 会裁决它,也无法再交回一次。
      const handedBack = this.repo.triggers.disposition(triggerId)?.handbacks?.some(item => item.ticketId === ticketId)
      if (handedBack) throw new UserError('handedBackHere')
      const trigger = this.tickets.attachable(ticketId, triggerId)
      this.evals.withdraw(trigger)
      this.tickets.attach(ticketId, trigger, note)
      this.evals.routed(triggerId, ticketId)
      this.tickets.wake(ticketId)
      // SA 不变量:attachable 已 require 校验该工单存在且可接收;非空断言与 SA 原样
      // oxlint-disable-next-line typescript/no-non-null-assertion
      return this.repo.tickets.get(ticketId)!
    })
  }
  /**
   * 请一个以 `waiting` 状态等待的运行中 worker 汇报一次状态;其他工单一概不动。
   * @returns 是否向该 worker 发出了请求。
   * @throws UserError 当工单未知。
   */
  requestStatus(ticketId: string): boolean { return this.repo.atomic(() => this.tickets.requestStatus(ticketId)) }
  /**
   * 把一条消息排到其 purpose 指名的渠道:确认或答复发往人的消息被写下的地方,attention 发往
   * 提出该问题的消息处,否则如结果一样发往工单发起的会话。先前排队过的不再排队(见 `Replies.reply`)。
   * @throws UserError 当工单或 trigger 未知,或 purpose 的规则拒绝它——例如未就绪工单的 result。
   */
  reply(request: ReplyRequest): Reply { return this.repo.atomic(() => this.replies.reply(request)) }

  // 人(经面板或主 Session)

  /** assessor 已把某 Eval 的候选卡投递到其 Session:该 Eval 的 deadline 自此刻起算。 */
  candidateDelivered(evalId: string): void { this.repo.atomic(() => { this.evals.delivered(evalId, this.options.policy()) }) }
  /**
   * 启动对账(★assessor resume,2026-11-18):装配时调用——持 evaluating 且从未 delivered 的
   * 线程以 `hostRestarted` 重排(pass 周期开新 Eval 重排候选卡),治愈「assessment effect 已随
   * 旧装配丢失、Eval 永不过期」的死锁。与 executor.resume() 的重启对账同位。
   * @returns 被对账重排的线程数。
   */
  resumeAssessments(): number { return this.repo.atomic(() => this.evals.resume()) }
  /**
   * 把一条已落库的 Trigger 排到新 Eval,例如人的重放;有 Eval 持有它时返回 false。
   * @throws UserError 当 Trigger 未知。
   */
  reevaluate(triggerId: string): boolean { return this.repo.atomic(() => this.evals.reevaluate(triggerId)) }
  /**
   * 人关闭一条 unavailable Decision 所示的问题:总览不再列出它。
   * @throws UserError 当 Decision 未知或不是 unavailable。
   */
  dismiss(decisionId: string): Decision { return this.repo.atomic(() => this.evals.dismiss(decisionId)) }
  /**
   * 撤掉每张工单对某线程的 Subscription,直到新的 Decision 再订阅其一。
   * @returns 是否撤掉了 Subscription。
   */
  unsubscribe(thread: string): boolean { return this.repo.atomic(() => this.tickets.dropSubscriptions(thread, 'person')) }
  /**
   * 人 stop 一张工单,撤回其 Mandate:工单结束、此后什么都收不到(24 号 §5.3-2「只有人的
   * stop 才撤销授权」——stop 是唯一撤销路径,27 号 §3.2-④)。
   * @throws UserError 当工单未知。
   */
  stopTicket(ticketId: string, reason?: string): Ticket { return this.repo.atomic(() => this.tickets.stop(ticketId, reason)) }
  /**
   * 人重试一张 worker 报了 failed 或 blocked(或其 Input 投递失败)的工单:卡住的 Assignment
   * 结束,同一 Mandate 下另起新的。
   * @throws UserError 当工单未知、已结束或不可重试。
   */
  retryTicket(ticketId: string): Ticket { return this.repo.atomic(() => this.tickets.retry(ticketId)) }

  // Executor

  /**
   * Executor 的事实:某 Assignment 在跑;等待它的各 Input 出发投递。
   * @throws UserError 当工单未知。
   */
  assignmentStarted(ticketId: string, assignmentId: string): void {
    this.repo.atomic(() => { this.assignments.started(ticketId, assignmentId) })
  }
  /**
   * Executor 的事实:各 Input 到达了跑着工单的那条 Assignment,清除一次投递失败。不再运行的
   * Assignment 的事实被丢弃。其 worker 的 Session 把各条纳入步骤后才算读(`inputsRead`)。
   */
  inputsDelivered(ticketId: string, assignmentId: string, inputIds: string[]): void {
    this.repo.atomic(() => { this.assignments.delivered(ticketId, assignmentId, inputIds) })
  }
  /**
   * Executor 的事实:开放工单 worker 的 Session 把携带各 Input 的消息纳入了步骤,此后其模型
   * 可读到它们:之后的报告或一轮结束在工单结束时把它们计为已读。
   * @throws UserError 当工单未知。
   */
  inputsRead(ticketId: string, inputIds: string[]): void {
    this.repo.atomic(() => { this.assignments.read(ticketId, inputIds) })
  }
  /** Executor 的事实:跑着工单的 Assignment 的 worker 结束了一轮(报告之后也算)。 */
  turnEnded(ticketId: string, assignmentId: string): void {
    this.repo.atomic(() => { this.assignments.turnEnded(ticketId, assignmentId) })
  }
  /** Executor 的事实:向跑着工单的 Assignment 投递 Input 失败;工单显示它,直到某次投递成功。 */
  deliveryFailed(ticketId: string, assignmentId: string, error: string): void {
    this.repo.atomic(() => { this.assignments.deliveryFailed(ticketId, assignmentId, error) })
  }
  /**
   * 某 worker 经其 Executor 的请求:把 attach 到其工单的某线程标记为无关——只撤该工单的
   * Subscription,直到新的 Decision 再订阅它。
   * @throws UserError 当工单未知,或线程是工单的 origin 线程、Source 绑给它的(如它的 pull
   * request)、或它未订阅的。
   */
  markUnrelated(ticketId: string, thread: string, reason: string): void {
    this.repo.atomic(() => { this.tickets.markUnrelated(ticketId, thread, reason) })
  }
  /**
   * 某 Executor 发现相关而仅为上下文订阅的线程:见 `Tickets.followForContext` 与 `Thread.context`。
   * @returns 工单已跟随该线程时为 false。
   * @throws UserError 当工单未知或已结束。
   */
  followForContext(ticketId: string, thread: ThreadRef): boolean {
    return this.repo.atomic(() => this.tickets.followForContext(ticketId, thread))
  }
  /**
   * 主 Session 交给开放工单 Executor 的一条事实:见 `Tickets.note`。
   * @throws UserError 当工单未知或已结束。
   */
  note(ticketId: string, text: string): Ticket { return this.repo.atomic(() => this.tickets.note(ticketId, text)) }
  /**
   * 某 Executor 交回一条到达其工单、但请求超出其范围的消息:见 `Evals.handback`。
   * @returns 是否排入了 Eval:另一工单仍裁决它时为 false,本工单未曾裁决它的(见 `Evals.handback`)也是。
   * @throws UserError 当工单或 trigger 未知、trigger 未到达该工单、或工单已交回过它。
   */
  handback(ticketId: string, triggerId: string, reason: string): boolean {
    return this.repo.atomic(() => this.evals.handback(ticketId, triggerId, reason))
  }
  /**
   * 在开放工单当前的 Assignment 上记录一份 worker 报告。它给人的问题(`attention`)被提出、
   * 保留或清除(`null` 或 `ready` 报告),被替换的 attention 问题尚未发出的回执从 outbox 撤回。
   * `blocked`/`failed` 报告压住自动 Input,直到人的消息到来。`dropped` 报告结束工单,`ready`
   * 报告也结束它:无跟随线程时 `completed`,否则在 `followsDone` 成立时以该 outcome 收尾
   * (24 号 §2.3-5 六态;35 号 A9——ready 报告在 Engine 内部不改,门禁挂 executor 侧)。
   * @throws UserError 当工单未知或已结束、Assignment 已结束、问题伴随 ready 结果或答复而来、
   * 或问题/答复点名的不是人的消息或未到达工单。
   */
  report(ticketId: string, report: WorkerReport): Ticket { return this.repo.atomic(() => this.assignments.report(ticketId, report)) }
  /**
   * 处理宿主停止时还在运行的 Assignment:带恢复注记重启它——除非其最新报告是 `waiting`、
   * `ready`、`blocked` 或 `failed`、且其后没有 Input 到达其 worker,后者保住其 Session 与状态,
   * 并把等待它的各 Input 投给它。
   */
  assignmentInterrupted(ticketId: string, assignmentId: string): void {
    this.repo.atomic(() => { this.assignments.interrupted(ticketId, assignmentId) })
  }

  // Settings

  /**
   * Policy 变更了:`effects` 命中的每张开放工单被告知变更如何影响它(只注入 `policy-changed`
   * Input、绝不撤销 Mandate——27 号 §3.2-④「策略新版本只通知不撤销」,35 号 A8),在跑的
   * Eval 在新版本下重新开始。
   */
  policyChanged(from: string, to: string, effects: ReadonlyMap<string, PolicyEffect> = new Map()): void {
    this.repo.atomic(() => { this.tickets.policyChanged(from, to, effects); this.evals.policyChanged(from, to) })
  }
}

/** Sources 请求与告知 Engine 的面。 */
export type EngineForSources = Pick<Engine, 'receive' | 'bindThread' | 'threadClosed'>
/** 主 Session 请求 Engine 的面。 */
export type EngineForMainSession = Pick<Engine, 'candidate' | 'candidateDelivered' | 'decide' | 'attach' | 'reply' | 'requestStatus' | 'note'>
/** 人(经面板或主 Session)请求 Engine 的面。 */
export type EngineForPeople = Pick<Engine, 'stopTicket' | 'retryTicket' | 'reevaluate' | 'unsubscribe' | 'dismiss'>
/** Settings 告知 Engine 的面。 */
export type EngineForSettings = Pick<Engine, 'policyChanged'>
/** Executor 告知 Engine 的面,及其 worker 请求 Engine 的面。 */
export type EngineForExecutor = Pick<Engine, 'assignmentStarted' | 'inputsDelivered' | 'inputsRead' | 'turnEnded' | 'deliveryFailed'
  | 'assignmentInterrupted' | 'report' | 'markUnrelated' | 'handback' | 'followForContext' | 'reply'>
