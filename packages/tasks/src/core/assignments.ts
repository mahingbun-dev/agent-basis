/**
 * Assignments——Executor 及其 worker 对跑着工单的各 Assignment 的汇报(35 号 A9)。
 *
 * 设计依据:34 号 §2.1 assignments 行;语义自 SA/src/core/assignments.ts 重写级校对移植,
 * 不变量原样:六态报告(progress/waiting/ready/blocked/failed/dropped,24 号 §2.3-5)+
 * Attention 生命周期(24 号 §5.5-R5:一次一个结构化问题,被替换/清除时撤回未发回执;
 * ready 报告清除问题)。blocked/failed 压住自动 Input 直到人的消息到达(等人的 worker 不被
 * 自动消息惊醒);dropped 与 followsDone 成立时的 ready 结束工单。
 * ready 报告在 Engine 内部不改——门禁挂 executor 侧(35 号 A15),本部件不知门禁。
 */
import { key } from './ids.ts'
import { UserError } from './errors.ts'
import { latestAssignment, liveTicket, runningAssignment } from './model.ts'
import type { ReportState, Ticket } from './model.ts'
import { EnginePart, type EngineOptions } from './part.ts'
import type { Replies } from './replies.ts'
import { automatic, type Tickets } from './tickets.ts'

/** Assignment 的汇报:worker 的报告,或 Executor 自己的(空闲一轮后的 `waiting`、出错后的 `failed`)。 */
export interface WorkerReport {
  state: ReportState
  summary: string
  /** 给人的开放问题:字符串即提出,`null` 清除现有问题,`undefined` 保持现状。 */
  question?: string | null
  /** 提出该问题的人的消息;把问题路由到它被写下的渠道。 */
  askedBy?: string
  /** 本报告答复的人的提问,worker 以此接手它;授权主 Session 发出 answer 回执。 */
  answers?: string
}
const RECOVERY_NOTE = 'The host restarted during this ticket. Inspect the current worktree, git history and GitHub state before continuing. Do not repeat an already completed external operation. Finish the original assignment and report its status.'

/**
 * Assignments 记录 Executor 及其 worker 就跑着工单的 Assignment 汇报的事实:assignment 启动、
 * Input 到达或投递失败、worker 的 Session 把 Input 摄入步骤、其一轮结束、宿主重启打断、以及带
 * 给人问题的 worker 报告。它依赖 Tickets 重启或结束工单、依赖 Replies 撤回被报告替换的问题;
 * Engine 把 Executor 的生命周期回调与其 worker 的报告路由到这里。
 */
export class Assignments extends EnginePart {
  private readonly tickets: Tickets
  private readonly replies: Replies
  constructor(options: EngineOptions, tickets: Tickets, replies: Replies) { super(options); this.tickets = tickets; this.replies = replies }

  /** 把未结束的 assignment 标记为运行,排队投递开放工单等待中的 inputs,并发 `assignment.started`。 */
  started(ticketId: string, assignmentId: string): void {
    const ticket = this.require(ticketId)
    const assignment = ticket.assignments.find(item => item.id === assignmentId)
    if (!assignment || assignment.state === 'ended') return
    assignment.state = 'running'; assignment.startedAt ??= this.now()
    ticket.updatedAt = this.now()
    this.repo.tickets.save(ticket)
    if (liveTicket(ticket) && ticket.undelivered.length) this.options.executor.deliver(ticket, assignment)
    this.emit('assignment.started', { ticketId, assignmentId })
  }
  /**
   * 在工单运行中的 assignment 上把 `inputIds` 记为已投递,并清除先前的 `delivery` 失败;assignment
   * 不再运行时忽略。其 worker 的 Session 摄入各条后它们才被读(见 read)。
   */
  delivered(ticketId: string, assignmentId: string, inputIds: string[]): void {
    const ticket = this.running(ticketId, assignmentId)
    if (!ticket) return
    ticket.undelivered = ticket.undelivered.filter(id => !inputIds.includes(id)); ticket.updatedAt = this.now()
    // SA 不变量:running() 已确认 runningAssignment 在位;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    runningAssignment(ticket)!.deliveredAt = ticket.updatedAt
    for (const input of ticket.inputs) {
      if (input.kind === 'trigger' && inputIds.includes(input.id)) { input.readAt ??= null; input.deliveredTo = assignmentId }
    }
    delete ticket.delivery
    this.repo.tickets.save(ticket)
  }
  /** 记录开放工单 worker 的 Session 把 `inputIds` 摄入步骤的时刻,此后其模型可读到它们。 */
  read(ticketId: string, inputIds: string[]): void {
    const ticket = this.require(ticketId)
    if (!liveTicket(ticket)) return
    for (const input of ticket.inputs) if (input.kind === 'trigger' && inputIds.includes(input.id)) input.readAt ||= this.now()
    this.repo.tickets.save(ticket)
  }
  turnEnded(ticketId: string, assignmentId: string): void {
    const ticket = this.running(ticketId, assignmentId)
    if (!ticket) return
    // 同 delivered:running() 保证在位
    // oxlint-disable-next-line typescript/no-non-null-assertion
    runningAssignment(ticket)!.idleAt = this.now()
    this.repo.tickets.save(ticket)
  }
  deliveryFailed(ticketId: string, assignmentId: string, error: string): void {
    const ticket = this.running(ticketId, assignmentId)
    if (!ticket) return
    ticket.delivery = { error: error.slice(0, 300), at: this.now() }
    this.repo.tickets.save(ticket)
  }
  /**
   * 处理宿主重启打断的运行中 assignment:除非其最新报告是 `waiting`/`ready`/`blocked`/`failed`
   * 且其后没有 Input 到达 worker,否则带恢复注记重启它;前者保住其 Session 与状态,并投递等它的
   * 各 Input。
   */
  interrupted(ticketId: string, assignmentId: string): void {
    const ticket = this.running(ticketId, assignmentId)
    const running = ticket && runningAssignment(ticket)
    if (!ticket || !running) return
    const report = running.report
    const busy = !!running.deliveredAt && !!report && running.deliveredAt >= report.at
    const settled = !!report && ['waiting', 'ready', 'blocked', 'failed'].includes(report.state) && !busy
    if (!settled) this.tickets.restart(ticket, running, 'hostRestarted', RECOVERY_NOTE)
    else if (ticket.undelivered.length) this.options.executor.deliver(ticket, running)
  }
  /**
   * 在开放工单当前的 assignment 上记录 worker 状态报告,更新 `attention`、`answers`、被压住的
   * 自动 inputs,并在 `dropped`、或 `ready` 且不等待所跟随线程(followsDone)时结束工单。
   * @throws UserError 当工单未知或已结束、assignment 已结束、问题伴随 ready 结果或答复而来、
   * 或问题/答复点名的不是人的消息或未到达工单。
   */
  report(ticketId: string, report: WorkerReport): Ticket {
    const ticket = this.require(ticketId)
    if (!liveTicket(ticket)) throw new UserError('ticketEnded')
    if (report.question && (report.state === 'ready' || report.answers)) throw new UserError('questionWithResult')
    if (report.askedBy && !report.question) throw new UserError('askerWithoutQuestion')
    const person = (id: string, channel: boolean) => {
      const trigger = this.repo.triggers.get(id)
      return !!trigger?.human && (!channel || !!trigger.channel) && this.reaches(ticket, trigger, false)
    }
    if (report.askedBy && !person(report.askedBy, true)) throw new UserError('notAsker')
    if (report.answers && !person(report.answers, false)) throw new UserError('notAnswerable')
    const assignment = runningAssignment(ticket) ?? latestAssignment(ticket)
    if (!assignment) throw new UserError('unknownAssignment')
    if (assignment.state === 'ended') throw new UserError('assignmentEnded')
    const at = this.now()
    const previous = ticket.attention
    const ask = (question: string) => ({ id: key('attention', ticketId, question, at), question, ...(report.askedBy ? { triggerId: report.askedBy } : {}) })
    const asked = report.question && report.question !== previous?.question ? ask(report.question) : previous
    const attention = report.question === null || report.state === 'ready' ? undefined : asked
    if (attention) ticket.attention = attention
    else delete ticket.attention
    // 被替换或清除的 attention 问题,从 outbox 撤回其尚未发出的回执。
    if (previous && previous.id !== attention?.id) this.replies.withdrawAttention(previous.id)
    assignment.report = { state: report.state, summary: report.summary, at }
    ticket.updatedAt = at
    if (report.answers && !ticket.answers?.includes(report.answers)) ticket.answers = [...ticket.answers ?? [], report.answers]
    if (report.answers) this.takeUp(ticketId, report.answers)
    if (report.state === 'blocked' || report.state === 'failed') ticket.undelivered = ticket.undelivered.filter(id => !automatic(ticket.inputs.find(input => input.id === id)))
    this.repo.tickets.save(ticket)
    // 跟随线程的工单随其线程收尾:ready 报告只在 followsDone 成立时结束工单,并以该 outcome 收尾。
    const ready = !ticket.follows?.length ? 'completed' : this.tickets.followsDone(ticket)?.outcome
    // 工单推迟过的关闭之后的 dropped 报告,按该关闭的 outcome 收尾,其最终通知会说明。
    const outcome = report.state === 'dropped' ? this.tickets.followsDone(ticket)?.outcome ?? 'dropped' : report.state === 'ready' ? ready : undefined
    if (outcome) this.tickets.end(ticketId, 'executor', outcome, at)
    return this.require(ticketId)
  }
  /** 工单,当其开放且 `assignmentId` 正跑着它时。 */
  private running(ticketId: string, assignmentId: string): Ticket | undefined {
    const ticket = this.require(ticketId)
    return liveTicket(ticket) && runningAssignment(ticket)?.id === assignmentId ? ticket : undefined
  }
}
