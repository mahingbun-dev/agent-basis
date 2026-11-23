/**
 * DshExecutor——在每工单一条持久 DSH worker session 与租户 realm 工作区下的 R4 目录里
 * 执行 Assignment(35 号 A14;34 号 §2.4 dsh 行)。
 *
 * 设计依据:24 号 §5.2 表 Executor 行(worker session 建在租户 realm 内、不照搬 worktree)、
 * §2.3-4(Assignment+WorkerSlots)、§5.3-4(副作用只经 Effects);27 号 §3.1-4(槽位制)、
 * §3.2-④(插队/唤醒优先)。语义自 SA src/executor/dsh.ts 重写级校对移植,不变量原样:
 * launch 与 input 投递经 Effects 排队、并发经 WorkerSlots 管理、宿主四类事件
 * (agent/status、agent/inbox/claimed、session/event、agent/error)订阅后把状态迁移
 * 报告回 Engine;瞬时网络/供应商错误指数退避重试;`workerIdle` 的 30 分钟后台限与
 * `BACKGROUND_LIMIT_MS` 保留。
 *
 * ★A14 改造(交付原文「去 worktree:ticketExecution/ticketWorktreeName 删除」):
 * - 工作区不再是 git worktree:每工单目录 = `<租户 realm 工作区>/.ticket/<id>/`
 *   (24 号 §5.5-R4 原文目录名;A15 workspace.ts 落地其内部产物布局);
 * - Execution.name 取工单 id(R4 目录名),assignment 文本保留 SA 组合(规则优先级 +
 *   路由注记),仅删 worktree 命名;
 * - prepare 命令的子进程执行经宿主 `prepare` 钩子注入(SA prepareDirectory 的
 *   runAsWorker/verifyDirectory 半边属装配面,35 号 A16);未注入时只建目录;
 * - worker 结束语经宿主 session 事件跟踪(本仓 seam 的 snapshotEvents 已标弃用,
 *   35 号 A0/A16 seam 复核后的投影面替代)。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { key, latestAssignment, latestReport, liveTicket, runningAssignment, threadKey, waitsForPerson } from '../core/index.ts'
import type { AssessmentOutcome, Assignment, EngineForExecutor, Execution, PolicyEffect, Ticket, TicketInput, Trigger } from '../core/index.ts'
import type { Settings } from '../policy/settings.ts'
import type { Store } from '../store/store.ts'
import { Later, type Effects, type HealthEntry } from '../effects/effects.ts'
import type { Outbox } from '../effects/outbox.ts'
import type { Sessions } from '../session/sessions.ts'
import { workerToolsFor, type WorkerToolsHost } from '../tools/worker.ts'
import { toDshTool } from '../tools/tool.ts'
import { budgetUsage, effortGuide, ticketBudgetEntry, type TicketBudgetEntry, type TicketBudgetUsage } from './budget.ts'
import { GATE_CONTRACT_CLAUSE } from './gates.ts'
import { ticketDir } from './workspace.ts'
import { WorkerSlots } from './slots.ts'
import { cancelled, collectJob, killJobs, runningJobs, stopBackground, stopSubagents, until, untilQuiet } from './background.ts'

const now = (): string => new Date().toISOString()
/** 一张工单的 worker session id(`worker-<ticketId>`;SA dsh.ts:24 原样保留)。 */
export const workerSessionId = (ticketId: string): string => `worker-${ticketId}`
/** 从 worker session id 反解工单 id;非 worker session 返回 undefined。 */
export const ticketOfSession = (sessionId: string): string | undefined =>
  sessionId.startsWith('worker-') ? sessionId.slice('worker-'.length) : undefined
/** 一次工单工作区 prepare 的最长运行时间。 */
const PREPARE_TIMEOUT_MS = 10 * 60_000
/** 一次 launch 或 worker 回合的瞬时重试次数上限,与其恢复回合前的初始退避。 */
const TRANSIENT_TRIES = 3, TRANSIENT_BACKOFF_MS = 15_000
/** worker 回合结束后其后台工作至多再跑多久,超时被停止并令 worker 报 waiting。 */
const BACKGROUND_LIMIT_MS = 30 * 60_000
/** 宿主关停时,等各 worker 后台工作停止的时间。 */
const SHUTDOWN_STOP_MS = 10_000
/** 一次过性失败后干活的 worker等 worker 槽、或等处理恢复时,两次张望的间隔。 */
const SLOT_WAIT_MS = 5000
/** 一条 input 是否来自人(非 context 的人 trigger,或状态请求一类的直接文本)。 */
const fromPerson = (input?: TicketInput): boolean =>
  input?.kind === 'trigger' ? !!input.human && !input.context : input?.kind === 'text'
/**
 * 工单工作区 prepare 命令失败时抛出的内部错误。DshExecutor 捕获它立即把工单记为
 * failed 而非自动重试:已存在的目录即算已预备,自动重试会把失败的 prepare 命令留在
 * 目录里的东西当作预备好的工作区。
 */
class PrepareFailed extends Error {}
const PASSING = new RegExp(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR', 'socket hang up', 'fetch failed',
  'network error', 'overloaded', 'rate limit', '\\b(?:408|429|50[0-4])\\b'].join('|'), 'i')
/**
 * 一个错误是否代表一次性的网络或模型供应商失败:HTTP 408、429、5xx,或被拒、被重置、
 * 超时、无法解析宿主的连接。
 */
export function transient(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500
  const code = (error as { code?: unknown } | undefined)?.code
  const text = error instanceof Error
    ? `${error.name} ${error.message} ${typeof code === 'string' ? code : ''}`
    : String(error)
  return PASSING.test(text)
}
/** `DshExecutor` 的宿主依赖。 */
export interface ExecutorHost {
  /** DSH Cordis context:session 注册表与四类宿主事件。 */
  readonly context: Context
  /** Executor 向其报告 Assignment 与 Input 事实的 Engine 面(worker 面工具的 reply/markUnrelated/handback/followForContext 同源)。 */
  readonly engine: Pick<EngineForExecutor, 'assignmentStarted' | 'inputsDelivered' | 'inputsRead' | 'turnEnded' | 'deliveryFailed' | 'report'
    | 'assignmentInterrupted' | 'reply' | 'markUnrelated' | 'handback' | 'followForContext'>
  /** 回执出站面(worker 面工具的 ack 状态读与 sent 等待;WorkerToolsHost 半边)。 */
  readonly outbox: Pick<Outbox, 'status' | 'sent'>
  readonly store: Pick<Store, 'tickets' | 'triggers' | 'set' | 'settings' | 'atomic' | 'afterCommit' | 'workspaceDir'
    | 'replyStatus' | 'threads' | 'read' | 'blockRevision' | 'decisions'>
  /** launch 与 input 投递经它排队的持久 effect 队列。 */
  readonly effects: Pick<Effects, 'enqueue' | 'handle'>
  /** `worker` 健康项:报告 worker 事件处理是否失败。 */
  readonly health: HealthEntry
  readonly lifetime: AbortSignal
  /** worker session 管理与向主会话的 relay(35 号 A22)。 */
  readonly sessions: Pick<Sessions, 'ensure' | 'prompt' | 'promptedId' | 'relay' | 'holds'>
  closing(): boolean
  /** 处理是否暂停中:暂停扣住 launch 与 input 投递。 */
  paused(): boolean
  /** 工单工作区的 prepare 钩子(SA prepareDirectory 的子进程半边;A16 装配注入,未注入只建目录)。 */
  prepare?(ticket: Ticket, directory: string, signal: AbortSignal): Promise<void>
  /** 一条 Trigger 的来源消息链接(A21 sources 接线;未注入时卡片不带链接)。 */
  sourceLink?(trigger: Trigger, signal?: AbortSignal): Promise<{ source_url?: string; source_url_read?: string }>
  /** `trigger` 在回复某条已存 Trigger 时,那条被回复的 Trigger;未知返回 undefined。 */
  repliedTo?(trigger: Trigger): Trigger | undefined
}
/** 在 Store 里查一张工单的发起 Trigger。 */
export const sourceTrigger = (host: { store: Pick<Store, 'triggers'> }, ticket: Ticket): Trigger | undefined =>
  host.store.triggers.get(ticket.origin.triggerId)
/**
 * ★改造(A14 去 worktree):新接受工单的 Execution 元数据——R4 工作区目录与 assignment
 * 文本。目录 = `<租户 realm 工作区>/.ticket/<id>/`(24 号 §5.5-R4 原文目录名,经
 * executor/workspace.ts `ticketDir` 派生;A22「worker session 一律建在租户 realm 工作区内」);
 * name 即目录名(工单 id);assignment 文本保留 SA 的规则优先级与路由注记组合,仅删 worktree 命名。
 * ★A15(R2):执行契约追加 `GATE_CONTRACT_CLAUSE`——「ready=门禁通过」写进 Mandate 执行契约,
 * worker 自述不可绕过(G2-A4)。★A17(R1):accept 固化的 effort 档位进契约文本与 `Execution.effort`
 * (24 §5.5-R1 三档分级;预算守卫按它取 settings.budget.caps 分档上限)。
 */
export function ticketExecution(ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>, settings: Settings,
  workspaceDir: string): Execution {
  const note = outcome.note ? `\nRouting note (not the source request): ${outcome.note}` : ''
  const ruleIds = ticket.mandate.basis.rules
  const rules = settings.policy.rules.filter(rule => ruleIds?.includes(rule.id))
    .map(rule => `\n- ${rule.name} (${rule.id}): ${rule.instruction}`).join('')
  const precedence = rules ? `\nMatched rules; their procedure and communication instructions take precedence over the default acknowledgement and messaging policy for this ticket:${rules}` : ''
  const effort = outcome.effort ? `\nEffort tier: ${outcome.effort} (subagent budget: ${effortGuide(outcome.effort)}).` : ''
  // 发起 Trigger 随 assignment 一起投递,故 `assignment` 不重复其文本。
  const assignment = (ticket.mandate.strength === 'inferred' && ruleIds
    ? `Proactively accepted under ${ruleIds.join(', ')}. Scope: ${outcome.scope}.${precedence}${note}`
    : note.trim()) + effort + GATE_CONTRACT_CLAUSE
  return { name: ticket.id, directory: ticketDir(workspaceDir, ticket.id), assignment,
    ...(outcome.effort ? { effort: outcome.effort } : {}) }
}
/** worker 消息里内联 assignment 与 trigger 文本的字符上限;更长的经其资源读取。 */
const ASSIGNMENT_CHARS = 1500, TRIGGER_CHARS = 600
/** `text` 截至 `limit` 字符;超限时给截断预览、总字符数与读全文的资源路径。 */
const capped = (text: string, limit: number, read: string) =>
  text.length <= limit ? { text } : { text: `${text.slice(0, limit)}…`, chars: text.length, read }
/**
 * 为 worker 投递格式化一条 Trigger:作者、线程、时间、截至 `TRIGGER_CHARS` 的文本、
 * 来源消息链接、可选路由注记,以及 worker 尚未读过的被回复消息的预览。
 */
export function triggerMessage(trigger: Trigger, link: { source_url?: string; source_url_read?: string }, note?: string,
  repliesTo?: Trigger) {
  // SA 不变量:threads[0] 恒存在(Trigger 的主线程);非空断言与 SA 原样
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const primary = trigger.threads[0]!
  return { trigger_id: trigger.id, from: trigger.actor.id, thread: threadKey(primary), at: trigger.at,
    ...capped(trigger.text, TRIGGER_CHARS, `trigger/${trigger.id}`), ...link, ...(note ? { routing_note: note } : {}),
    ...(repliesTo ? { replies_to: { trigger_id: repliesTo.id, preview: repliesTo.text.replace(/\s+/g, ' ').slice(0, 160) } } : {}) }
}
/** 一张工单接受批次里的同伴 trigger:作者、时间、160 字符预览与读取资源路径。 */
export const batchLine = (trigger: Trigger): object => ({ trigger_id: trigger.id, from: trigger.actor.id, at: trigger.at,
  preview: trigger.text.replace(/\s+/g, ' ').slice(0, 160), read: `trigger/${trigger.id}` })
/** 工单接受批次里的其他 Trigger(不含主 `origin.triggerId`),最旧在前。 */
export const batchOf = (host: { store: Pick<Store, 'triggers'> }, ticket: Ticket): Trigger[] =>
  ticket.origin.triggerIds.filter(id => id !== ticket.origin.triggerId).flatMap(id => host.store.triggers.get(id) ?? [])
const RESUMED = 'This ticket ended earlier and the message that follows, on its thread, resumed it under the same mandate. If it asks for '
  + 'more within the original scope, inspect the ticket workspace and the work already done and continue; if it asks for work beyond that '
  + 'scope or for another ticket, hand it back and report dropped; if it needs nothing, such as thanks, report dropped without a message. '
  + 'Report ready when the follow-up is done. Do not repeat completed work.'
const RETRIED = 'A person retried this ticket. Continue the assignment from the current state of the ticket workspace and the work already done.'
/** 为 worker 格式化一条 policy-changed input;effect 字段出现之前记录的回退为一般通知。 */
function policyMessage(effect?: PolicyEffect): string {
  if (!effect) return 'Policy change: the access or admission rules changed. Check that the remaining work stays within the assignment.'
  return ['Policy change:',
    ...(effect.rules ?? []).map(rule => rule.change === 'disabled'
      ? `Rule ${rule.name} (${rule.id}), which this ticket was accepted under, no longer applies: finish only a change within it, or report dropped.`
      : `Rule ${rule.name} (${rule.id}), which this ticket was accepted under, changed. Keep the remaining work within it as it reads now: ${rule.instruction}`),
    ...effect.proactive === false ? ['Work inferred from a rule is no longer accepted, as the accept mode is no longer auto: finish only '
      + 'what is in progress within the assignment, or report dropped, and take on nothing new.'] : [],
    ...effect.requesterAllowed === false ? [`The sender this ticket is for, ${effect.requester ? `${effect.requester.id} on ${effect.requester.source}` : 'who '
      + 'asked for it'}, may no longer start work here: finish the assignment within its scope, and take no new requests from them on it.`] : []].join('\n')
}
/** worker session 读取工单 input 全文的资源路径。 */
export const inputResource = (ticketId: string, inputId: string): string => `ticket/${ticketId}/input/${key(inputId)}`
/**
 * 为 worker 投递格式化一条工单 input:`trigger` 经 `triggerMessage` 渲染(缺 Trigger 时
 * 以其 id 与读取路径代替)、`policy-changed` 通知、`resumed` 通知、orchestrator 的
 * `note`、`text` 原样。旧版 `reopen` input 仅属历史,返回 undefined。
 */
export function inputMessage(input: TicketInput, trigger?: object): string | undefined {
  // 标记仅以 context 订阅到达的 trigger,使 worker 知道它不是发给该工单的。
  if (input.kind === 'trigger') return JSON.stringify({ ...trigger ?? { trigger_id: input.triggerId, read: `trigger/${input.triggerId}` },
    ...input.context ? { context: true } : {} })
  if (input.kind === 'policy-changed') return policyMessage(input.effect)
  if (input.kind === 'resumed') return RESUMED
  if (input.kind === 'note') return `Note from the orchestrator, for context only: ${input.text}`
  return input.kind === 'text' ? input.text : undefined
}
/**
 * 把一份 worker 报告的结论转成主会话的 relay 载荷:id 自工单与报告内容派生(同一结论
 * 不重发)、超长摘要截断为 600 字符、`read` 指向工单结果资源。SA resultRelay 的
 * `ticket` 卡片字段依赖 cards.ts(未移植,A19 落地),此处以 ticket_id/title 最小字段
 * 替代——relay 的幂等 id 与读取路径语义原样。
 */
export function resultRelay(ticket: Ticket, state: string, text: string): { id: string; text: string } {
  const id = key('worker-result', ticket.id, ticket.updatedAt, text)
  const summary = text.length > 600 ? { summary: text.slice(0, 600), chars: text.length } : { summary: text }
  return { id: `report:${id}`, text: JSON.stringify({ kind: 'worker_report', ticket_id: ticket.id, title: ticket.title, state,
    ...summary, read: `ticket/${ticket.id}/result` }) }
}
/**
 * 在每工单一条持久 DSH worker session、租户 realm 工作区下的 R4 目录里执行工单
 * assignment。launch 与 input 投递经 Effects 排队,并发经 WorkerSlots 管理,监听
 * Cordis context 上的 `agent/status`、`agent/inbox/claimed`、`session/event` 与
 * `agent/error` 四类事件,并把状态迁移报告回 Engine。Runtime、Engine、worker 工具与
 * 管理路由经它预备、启动、投递、停止与恢复工单 assignment。
 */
export class DshExecutor {
  private readonly disposers: (() => void)[] = []
  private readonly slots: WorkerSlots
  /** 已试过的瞬时失败次数:worker 回合按 `assignment.id`、launch 按 `launch:<assignment.id>`。 */
  private readonly transientTries = new Map<string, number>()
  /** 正在瞬时失败退避计时、等待恢复其 worker 回合的 assignment。 */
  private readonly resuming = new Set<string>()
  /** 各工单对闲下来 worker 的后台工作的张望;worker 再跑或 Assignment 结束时结束。 */
  private readonly settling = new Map<string, AbortController>()
  /** 正在跑的各工单后台工作停止;该工单的 launch 或投递等它。 */
  private readonly stopping = new Map<string, Promise<void>>()
  /** worker 交接给人时留给人的 job,按工单;及其结束的收集。 */
  private readonly left = new Map<string, { jobs: Set<string>; collect: AbortController }>()
  /** 人最后一次在 worker 的 session 里直接输入、开了一个回合的时刻,按工单。 */
  private readonly personal = new Map<string, string>()
  /** 干活的 worker 的最后一段结束语(assistant 文本),按 session id——经宿主事件跟踪。 */
  private readonly said = new Map<string, string>()
  /** 各工单的 R1 预算守卫(35 号 A17:单工单上限跨其 assignment 累计;工单结束销账)。 */
  private readonly budgets = new Map<string, TicketBudgetEntry>()
  /** 一次过性失败后继续干的 worker 的计时器;dispose 时清。 */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  /** 注册 `launch` 与 `delivery` effect handler;两者在处理暂停期间被扣住(并发限 0)。 */
  private readonly host: ExecutorHost
  /** 已装过 worker 工具面的 agent(每 agent 作用域注册一次;WeakSet 跟随对象生命周期)。 */
  private readonly workerToolsAgents = new WeakSet<object>()
  constructor(host: ExecutorHost) {
    this.host = host
    this.slots = new WorkerSlots(() => this.host.store.tickets.open().filter(ticket => this.running(ticket)).map(ticket => ticket.id),
      () => this.host.store.settings().executor.maxWorkers)
    // 每个 launch 占一个 worker 槽,槽空着时 launch 并行跑。
    this.host.effects.handle('launch', payload => this.launchQueued(payload), { limit: () => this.host.paused() ? 0 : this.slots.launches(),
      retry: [5000, 300_000] })
    // 失败的 input 投递记在工单自身,而非经 `delivery` effect 健康项上报(`quiet: true`)。
    this.host.effects.handle('delivery', payload => this.deliverQueued(payload.ticketId), { limit: () => this.host.paused() ? 0 : 4, quiet: true })
  }
  /** 人插队累计次数(D2 指标;计数的暴露点在 WorkerSlots,observe 消费面归 packages/observe)。 */
  personBarges(): number { return this.slots.personBarges() }
  /** 当前占用的 worker 槽数(在跑回合 + 正在启动的 launch;[active-tickets] n/m 展示面,35 号 A24 ★A22 接线)。 */
  usedSlots(): number { return this.slots.used() }
  /** 一张工单的双轨预算用量(35 号 A17 R1 计量:token 技术轨 + credits 产品轨;observe/探针消费)。 */
  usageOf(ticketId: string): TicketBudgetUsage | undefined {
    const entry = this.budgets.get(ticketId)
    return entry && budgetUsage(entry)
  }
  /** 工单首次启动时建其预算档(单工单上限跨 assignment 累计;已有档保留,不重置记账)。 */
  private budgetFor(ticket: Ticket): TicketBudgetEntry {
    const existing = this.budgets.get(ticket.id)
    if (existing) return existing
    const entry = ticketBudgetEntry(this.host.store.settings().budget, ticket.execution?.effort)
    this.budgets.set(ticket.id, entry)
    return entry
  }
  /** 预算已耗尽时的 failed 摘要;未耗尽返回 undefined。 */
  private exhaustedSummary(ticketId: string): string | undefined {
    const entry = this.budgets.get(ticketId)
    if (!entry) return undefined
    const violations = entry.guard.check()
    return violations.length
      ? `Budget exhausted (${entry.effort ?? 'no effort tier declared'}): ${violations.map(violation => violation.message).join('; ')}.`
      : undefined
  }
  /** worker 事件的预算记账(35 号 A17 R1):usage/turn 进工单 guard;新违规即取消其回合并记 failed——超限走 failed 报告而非无限重试。 */
  private chargeBudget(ticketId: string, event: { type: string; data: unknown }): void {
    const entry = this.budgets.get(ticketId)
    if (!entry) return
    const fresh = entry.guard.applyEvent(event)
    if (!fresh.length) return
    const summary = `Budget exhausted: ${fresh.map(violation => violation.message).join('; ')}.`
    this.host.context.agents.get(SessionId(workerSessionId(ticketId)))?.cancel({ kind: 'hook', reason: summary }, { keepInbox: false })
    this.failed(ticketId, summary)
  }
  /** 为新接受的工单填 `execution`(R4 工作区目录与 assignment 文本;Engine 的 prepareTicket 钩子)。 */
  prepare(ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>): Ticket {
    return { ...ticket, execution: ticketExecution(ticket, outcome, this.host.store.settings(), this.host.store.workspaceDir) }
  }
  /**
   * 为新工单工作区建目录;宿主注入了 prepare 钩子时先在其父目录里以工单上下文跑它。
   * 失败的 prepare 抛 `PrepareFailed`,不自动重试;它留下的空目录被移除,非空的保留。
   * @throws PrepareFailed 附 prepare 的输出,当 prepare 失败时。
   */
  private async prepareDirectory(ticket: Ticket): Promise<void> {
    const directory = ticket.execution?.directory ?? ''
    await mkdir(dirname(directory), { recursive: true })
    // 设超时,使挂住的 prepare(如停在凭据提示上)令工单失败,而非无限占住 worker 槽。
    const signal = AbortSignal.any([this.host.lifetime, AbortSignal.timeout(PREPARE_TIMEOUT_MS)])
    if (this.host.prepare) {
      await this.host.prepare(ticket, directory, signal).catch((error: unknown) => {
        // 移除失败的 prepare 留下的空目录,后来的重试不会把它当作已预备。
        void rm(directory).catch(() => { /* 不存在,或留着它写下的东西,输出自会解释。 */ })
        throw new PrepareFailed(`The prepare command failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    await mkdir(directory, { recursive: true })
  }
  /** 为已接受或恢复的 assignment 排一个 `launch` effect;槽空出来时按队列序启动。 */
  start(ticket: Ticket, assignment: Assignment): void {
    this.host.effects.enqueue('launch', assignment.id, { ticketId: ticket.id, assignmentId: assignment.id })
  }
  /** 排一个 `delivery` effect,把等待中的 inputs 引进工单运行中的 worker session。 */
  deliver(ticket: Ticket, _assignment: Assignment): void { this.host.effects.enqueue('delivery', ticket.id, { ticketId: ticket.id }) }
  /** 启动排队的 assignment;其工单已结束、或已有更新的 assignment 接手时跳过。 */
  private async launchQueued({ ticketId, assignmentId }: { ticketId: string; assignmentId: string }): Promise<void> {
    const ticket = this.host.store.tickets.get(ticketId)
    const assignment = ticket && latestAssignment(ticket)
    if (!ticket || !liveTicket(ticket) || assignment?.id !== assignmentId || assignment.state !== 'pending') return
    this.slots.reserve(ticketId, 'launch')
    try { await this.launch(ticket, assignment); this.transientTries.delete(`launch:${assignmentId}`) }
    catch (error) {
      // 关停或暂停把 launch 重排等恢复;瞬时网络/供应商错误退避后重试。失败的 prepare
      // 不自动重试——已存在的目录即算已预备,重试会把失败命令留在目录里的东西当作
      // 预备好的工作区;工单记 failed,等新的人消息或显式重试。
      if (this.host.closing() || error instanceof Later) throw error
      if (!(error instanceof PrepareFailed) && this.retries(`launch:${assignmentId}`, error)) throw error
      this.launchFailed(ticketId, assignmentId, error)
    }
    finally { this.slots.free(ticketId) }
  }
  /**
   * 把排队的 inputs 逐条投给运行中的 assignment,每条投递前重读工单状态:工单结束或
   * 别的 assignment 接手,投递立即停。
   */
  private async deliverQueued(ticketId: string): Promise<void> {
    // 后台工作的停止以一次 cancel 结束,那会丢掉期间投递的东西。
    await this.stopped(ticketId)
    const first = this.host.store.tickets.get(ticketId)
    const target = first && liveTicket(first) ? runningAssignment(first) : undefined
    if (!first || !target || !first.undelivered.length) return
    let woken = false
    try {
      for (;;) {
        const ticket = this.host.store.tickets.get(ticketId)
        const assignment = ticket && liveTicket(ticket) ? runningAssignment(ticket) : undefined
        const inputId = ticket?.undelivered[0]
        if (!ticket || !assignment || inputId === undefined) return
        // 唤醒闲着的 worker 占一个槽(含给人消息留的那个)。
        const sessionId = workerSessionId(ticketId)
        if (!woken && !this.running(ticket)) {
          // 人的消息在留给它的槽里,先于新的 launch 唤醒其 worker。
          const person = ticket.undelivered.some(id => fromPerson(ticket.inputs.find(item => item.id === id)))
          this.slots.reserve(ticketId, person ? 'person' : 'wake')
          woken = true
        }
        const input = ticket.inputs.find(item => item.id === inputId)
        try {
          // worker session 被外部删除时重建它。
          if (!this.host.context.agents.get(SessionId(sessionId))) {
            await this.host.sessions.ensure(sessionId, ticket.execution?.directory ?? '', ticket.title, 'worker')
          }
          // 每 agent 工具面安装幂等:跨重启 resume 的存量 worker 会话在此恢复工具面。
          const workerAgent = this.host.context.agents.get(SessionId(sessionId))
          if (workerAgent !== undefined) this.installWorkerTools(workerAgent, ticketId)
          if (input) await this.deliverInput(ticket, assignment, input)
        }
        catch (error) {
          if (this.host.closing() || error instanceof Later) throw error
          const current = this.host.store.tickets.get(ticketId)
          if (!current || !liveTicket(current) || runningAssignment(current)?.id !== assignment.id) return
          this.host.engine.deliveryFailed(ticketId, assignment.id, String(error))
          throw error
        }
        this.host.engine.inputsDelivered(ticketId, assignment.id, [inputId])
      }
    }
    finally { if (woken) this.slots.free(ticketId) }
  }
  private async deliverInput(ticket: Ticket, assignment: Assignment, input: TicketInput): Promise<void> {
    // 就在投递前再核一遍:等 sourceLink 期间工单可能已结束。
    const live = (): void => {
      const current = this.host.store.tickets.get(ticket.id)
      if (!current || !liveTicket(current) || runningAssignment(current)?.id !== assignment.id) {
        throw new Error('The ticket ended or another Assignment took it over')
      }
      // 期间开始的该 worker 后台工作停止以 cancel 结束,那会丢掉这条 input。
      if (this.stopping.has(ticket.id)) throw new Later('The worker\'s background work is stopping')
    }
    live()
    const trigger = input.kind === 'trigger' ? await this.triggerCard(ticket, input.triggerId, input.note) : undefined
    const message = inputMessage(input, trigger)
    if (message === undefined) return
    const text = message.length > ASSIGNMENT_CHARS
      ? JSON.stringify(capped(message, ASSIGNMENT_CHARS, inputResource(ticket.id, input.id)))
      : message
    await this.host.sessions.prompt(workerSessionId(ticket.id), input.id, text, 'steer', live)
  }
  /** 为 worker 格式化工单上的一条 trigger;worker 未读过被回复消息时附其预览。 */
  private async triggerCard(ticket: Ticket, triggerId: string, note?: string): Promise<object | undefined> {
    const trigger = this.host.store.triggers.get(triggerId)
    if (!trigger) return undefined
    const parent = this.host.repliedTo?.(trigger)
    const seen = parent && (parent.id === ticket.origin.triggerId
      || ticket.inputs.some(item => item.kind === 'trigger' && item.triggerId === parent.id))
    return triggerMessage(trigger, await this.sourceLink(trigger), note, seen ? undefined : parent)
  }
  private async sourceLink(trigger: Trigger): Promise<{ source_url?: string; source_url_read?: string }> {
    return await (this.host.sourceLink?.(trigger) ?? {})
  }
  /**
   * 结束事务提交之后(回滚则 worker 继续跑,同事务排入的 launch 在其后启动):结束对其
   * 后台工作的张望,除非其最后的话是不带新 input 的 `ready`/`dropped` 报告、否则取消其
   * 回合;并停止其 shell job 与 subagent,包括留给人的 job。
   */
  stop(ticket: Ticket, assignment: Assignment, reason: string): void {
    this.transientTries.delete(assignment.id); this.transientTries.delete(`launch:${assignment.id}`)
    const report = assignment.report
    const busy = !!assignment.deliveredAt && !!report && assignment.deliveredAt >= report.at
    const ownTurn = (report?.state === 'ready' || report?.state === 'dropped') && !busy
    const sessionId = workerSessionId(ticket.id)
    this.host.store.afterCommit(() => {
      this.settling.get(ticket.id)?.abort()
      if (!ownTurn) this.host.context.agents.get(SessionId(sessionId))?.cancel({ kind: 'user' }, { keepInbox: false })
      // 其 shell job 与 subagent 随之停止,自结回合的 worker 的也一样。
      this.stopWork(ticket.id, reason)
      this.left.get(ticket.id)?.collect.abort(); this.left.delete(ticket.id); this.personal.delete(ticket.id)
      // R1 预算档销账:单工单上限的生命周期界 = 工单结束(35 号 A17)。
      this.budgets.delete(ticket.id)
    })
  }
  /** 停掉一张工单的 worker 在后台跑的(见 `stopBackground`)。 */
  private stopWork(ticketId: string, reason: string, keepInbox = false): void {
    this.track(ticketId, stopBackground(this.host.context, workerSessionId(ticketId), reason, keepInbox))
  }
  /** 该工单后台工作的一次停止;该工单的 launch 或投递在其运行期间等它。 */
  private track(ticketId: string, stop: Promise<void>): void {
    const entry: Promise<void> = Promise.all([this.stopping.get(ticketId), stop.catch(() => {})]).then(() => {})
      .finally(() => { if (this.stopping.get(ticketId) === entry) this.stopping.delete(ticketId) })
    this.stopping.set(ticketId, entry)
    void this.background(stop)
  }
  /** 等该工单正在跑的后台工作停止;宿主先行停止时不等。 */
  private async stopped(ticketId: string): Promise<void> {
    const stopping = this.stopping.get(ticketId)
    if (stopping) await until(stopping, this.host.lifetime)
  }
  /**
   * 宿主停止时,限时:停每个在载 worker 的后台工作、保留其 inbox;然后结束留给人
   * 的 job(已被 kill)的收集,并取消期间开始的 worker 回合、保留其 inbox。
   */
  async shutdown(): Promise<void> {
    const agents = this.host.store.tickets.list().map(ticket => this.host.context.agents.get(SessionId(workerSessionId(ticket.id))))
      .filter((agent): agent is Agent => agent !== undefined)
    const stop = async (): Promise<void> => {
      await Promise.allSettled(agents.map(agent => stopBackground(this.host.context, agent.id, 'tasks executor stopped', true)))
      for (const { collect } of this.left.values()) collect.abort()
      const running = agents.filter(agent => agent.status !== 'idle')
      for (const agent of running) agent.cancel({ kind: 'user' }, { keepInbox: true })
      await Promise.allSettled(running.map(agent => agent.whenIdle()))
    }
    await until(stop(), undefined, SHUTDOWN_STOP_MS)
  }
  /** 其 worker 占着 worker 槽的开放工单数:其回合在跑,或回合结束后其 shell job 或 subagent 仍在跑。 */
  activeCount(): number { return this.host.store.tickets.open().filter(ticket => this.running(ticket)).length }
  /** 一张工单的 worker 是否占着 worker 槽:其回合在跑,或回合结束后其 shell job/subagent 仍在跑。 */
  private running(ticket: Ticket): boolean {
    if (!runningAssignment(ticket)) return false
    return this.host.context.agents.get(SessionId(workerSessionId(ticket.id)))?.status === 'running' || this.settling.has(ticket.id)
  }
  /** launch 失败后把工单记 failed;工单等新的人消息或显式重试。 */
  private launchFailed(ticketId: string, assignmentId: string, error: unknown): void {
    const ticket = this.host.store.tickets.get(ticketId)
    if (!ticket || !liveTicket(ticket) || latestAssignment(ticket)?.id !== assignmentId) return
    this.failed(ticketId, String(error))
  }
  /** 在一个事务里把工单记 `failed` 报告,并把失败 relay 给主会话。 */
  private failed(ticketId: string, summary: string): void {
    this.host.store.atomic(() => {
      const updated = this.host.engine.report(ticketId, { state: 'failed', summary })
      const relay = resultRelay(updated, 'failed', summary)
      this.host.sessions.relay(relay.id, relay.text)
    })
  }
  private async launch(ticket: Ticket, assignment: Assignment): Promise<void> {
    const current = (): boolean => {
      if (this.host.closing()) throw new Error('The tasks executor is stopping')
      if (this.host.paused()) throw new Later('Processing is paused')
      const stored = this.host.store.tickets.get(ticket.id)
      return !!stored && liveTicket(stored) && latestAssignment(stored)?.id === assignment.id
    }
    const source = sourceTrigger(this.host, ticket)
    const workspace = ticket.execution?.directory ?? ''
    if (!current()) return
    // 工作区目录只预备一次;已存在的目录即算已预备(prepare 命令面世前建的也一样)。
    if (!await stat(workspace).then(() => true, () => false)) {
      await this.prepareDirectory(ticket)
      if (!current()) return
    }
    if (!current()) return
    const sessionId = workerSessionId(ticket.id)
    // R1 预算档(35 号 A17):首次启动建档,配置 = settings.budget.caps 按工单 effort 档取用。
    this.budgetFor(ticket)
    const agent = await this.host.sessions.ensure(sessionId, workspace, ticket.title, 'worker')
    if (!current()) return
    // worker 工具面每 agent 安装(launch 是新建与重启复用的公共必经点)。
    this.installWorkerTools(agent, ticket.id)
    // 本 assignment 替换的那个的后台工作先停,使它的结束不清掉这一个的消息。
    await this.stopped(ticket.id)
    if (!current()) return
    // 为本 assignment 放回的消息可能还在 session 里等(重启的 cancel 保留、或跨崩溃
    // 持久),本 launch 的消息会把它带进旁边的步骤:投递的副本才是唯一那份。
    for (const id of this.host.store.tickets.get(ticket.id)?.undelivered ?? []) agent.inbox.remove(this.host.sessions.promptedId(id))
    // 第一条消息带 assignment 与发起 Trigger;后续 assignment 的只说新的,除非 session
    // 丢了第一条(如被人删了)。
    const first = `assignment:${ticket.id}`
    const later = ticket.assignments.length > 1
    const told = later && await this.host.sessions.holds(sessionId, first)
    if (!current()) return
    const retried = ticket.assignments.at(-2)?.endedReason === 'retried' ? { note: RETRIED } : {}
    const assignmentText = ticket.execution?.assignment ?? ''
    const { text: brief, chars, read } = capped(assignmentText, ASSIGNMENT_CHARS, `ticket/${ticket.id}/assignment`)
    const card = told || !source ? undefined : await this.triggerCard(ticket, source.id)
    if (!current()) return
    const batch = told ? [] : batchOf(this.host, ticket).map(batchLine)
    const text = told ? JSON.stringify({ ticket_id: ticket.id, assignment: ticket.assignments.length, ...retried })
      : JSON.stringify({ ticket_id: ticket.id, title: ticket.title, ...(brief ? { assignment: brief } : {}),
        ...(read ? { assignment_chars: chars, assignment_read: read } : {}), ...(card ? { trigger: card } : {}),
        ...(batch.length ? { batch } : {}), ...retried })
    const requestId = later ? `assignment:${ticket.id}:${assignment.id}` : first
    await this.host.sessions.prompt(sessionId, requestId, text, 'queue',
      () => { if (!current()) throw new Error('Launch authorization changed before worker delivery') },
      () => { this.host.engine.assignmentStarted(ticket.id, assignment.id) })
    this.host.engine.assignmentStarted(ticket.id, assignment.id)
  }
  /** `agent` 是 worker session 时返回其存储的工单;否则 undefined。 */
  private ticketOf(agent: Agent): Ticket | undefined {
    const ticketId = ticketOfSession(agent.id)
    return ticketId === undefined ? undefined : this.host.store.tickets.get(ticketId)
  }
  /**
   * worker 工具面的每 agent 安装(2026-11-23 线上修复的正解形态):worker session 的
   * cwd 是工单子目录(`.ticket/<id>/`,R4),其工具作用域与 realm 工作区不同层——宿主
   * 层 ctx.tools.register(全局/realm 层)对它不可见(隔离容器 E2E 实测:master 51 工具
   * 含全部 orchestrator_*,worker 43 个零 orchestrator_*),且 `orchestrator_read` 与
   * orchestrator 面同名,全局层重复注册即抛错。宿主报错信息即正解:"for a per-agent
   * variant, register through that agent's `agent.ctx` instead"——经 agent.ctx 每 agent
   * 注册,作用域=该会话,天然实现 24 §8.3-4 分面;orchestrator_read 以 per-agent 变体
   * 遮蔽全局同名(worker 命中窄化读)。幂等:每 agent 只装一次;ctx.tools 缺席 fail-open
   * (宿主无工具服务时不阻断投递)。
   */
  installWorkerTools(agent: Agent, ticketId: string): void {
    if (this.workerToolsAgents.has(agent)) return
    const ctx = (agent as { readonly ctx?: { readonly tools?: { register(definition: unknown, options?: unknown): () => void } } }).ctx
    const tools = ctx?.tools
    if (tools === undefined || typeof tools.register !== 'function') return
    const workerHost: WorkerToolsHost = {
      engine: this.host.engine,
      store: this.host.store,
      outbox: this.host.outbox,
      resources: { store: this.host.store },
      relay: (requestId, text): void => { this.host.effects.enqueue('relay', requestId, { text }) },
    }
    for (const definition of workerToolsFor(workerHost, () => ticketId)) {
      this.disposers.push(tools.register(toDshTool(definition), {}))
    }
    this.workerToolsAgents.add(agent)
  }
  /** 订阅宿主的 `agent/status`、`agent/inbox/claimed`、`session/event` 与 `agent/error` 事件(启动时调一次)。 */
  install(): void {
    const ctx = this.host.context
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      // 开始的回合结束对其 worker 后台工作的张望;该回合自己的 idle 再张望新一轮。
      if (status === 'running') { this.settling.get(ticketOfSession(agent.id) ?? '')?.abort(); return }
      // 走到这里 status 只剩 idle(AgentStatus 两态);被停止 subagent 唤醒又取消的
      // 那个回合,不是 worker 自己的。
      if (cancelled.delete(agent) || this.host.closing()) return
      const ticket = this.ticketOf(agent)
      const assignment = ticket && runningAssignment(ticket)
      if (ticket && assignment && liveTicket(ticket)) void this.background(this.workerIdle(ticket, assignment, agent))
    }))
    // 人在 worker 的 session 里直接输入的消息;工单不记录它。
    this.disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const ticketId = ticketOfSession(agent.id)
      if (ticketId !== undefined && message.source.kind === 'user') this.personal.set(ticketId, now())
    }))
    // R1 硬截断 seam(35 号 A17;33 号 G2-A3 判据「超限即停在 agent/turn-stopping seam,
    // 不留半成品静默」):worker 回合收口边界上预算已超限即 cancel({kind:'hook'})——
    // 记账与截断动作都在 governance BudgetGuard(deny 优先、fail-closed),本层只路由。
    this.disposers.push(ctx.on('agent/turn-stopping', (payload) => {
      const entry = this.budgets.get(ticketOfSession(payload.agent.id) ?? '')
      void entry?.guard.onTurnStopping(payload)
    }))
    // 本包投递的消息所带的 inputs:session 把消息纳入步骤后 worker 才读到;此前声称
    // 它的步骤可能被取消或失败,消息被丢回。
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const ticketId = ticketOfSession(session.id)
      if (ticketId === undefined || this.host.closing()) return
      if (event.type === 'assistant/message') {
        const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
        this.said.set(session.id, text)
        // R1 预算记账(35 号 A17):assistant/message 的 usage 计入工单 guard;超限在 chargeBudget 内截断。
        this.chargeBudget(ticketId, { type: event.type, data: event.data })
        return
      }
      // R1:回合收口计入 turn 数(maxTurns 档;35 号 A17 接 governance budget 全维度)。
      if (event.type === 'turn/end') { this.chargeBudget(ticketId, { type: event.type, data: event.data }); return }
      if (event.type !== 'user/message' || event.data.source.kind !== 'eterna-tasks') return
      void this.background(Promise.resolve().then(() => {
        const read = this.host.store.tickets.get(ticketId)?.inputs.filter(input => input.kind === 'trigger' && !input.readAt
          && String(this.host.sessions.promptedId(input.id)) === String(event.data.id)).map(input => input.id) ?? []
        if (read.length) this.host.engine.inputsRead(ticketId, read)
      }))
    }))
    this.disposers.push(ctx.on('agent/error', ({ agent, error }) => {
      const ticket = this.ticketOf(agent)
      const assignment = ticket && runningAssignment(ticket)
      if (!ticket || !assignment || !liveTicket(ticket) || this.host.closing()) return
      // R1:预算耗尽不是瞬时失败——走 failed 记账而非重试(35 号 A17「超限走 failed 报告而非无限重试」)。
      const exhausted = this.exhaustedSummary(ticket.id)
      if (exhausted) { void this.background(Promise.resolve().then(() => { this.failed(ticket.id, exhausted) })); return }
      if (this.retries(assignment.id, error)) { this.resumeAfter(ticket.id, assignment.id, error); return }
      void this.background(Promise.resolve().then(() => { this.failed(ticket.id, String(error)) }))
    }))
  }
  /** 退订宿主事件,并清掉待处理的瞬时重试计时器。 */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
  /**
   * 宿主重启后对账各开放工单的在跑与待启动 assignment:通知 Engine 被打断的在跑
   * assignment,并重排待启动的 launch;失败的 launch(`waitsForPerson`)等人的消息或重试。
   */
  resume(): void {
    // 待启动工单按接受顺序(createdAt)启动。
    for (const ticket of [...this.host.store.tickets.open()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const running = runningAssignment(ticket), latest = latestAssignment(ticket)
      if (running) {
        // 本进程内的重启留下了 DSH 的 session、job 与 subagent 在跑:先停。inbox 保留
        // 已交接但未被取走的 input。
        this.host.context.agents.get(SessionId(workerSessionId(ticket.id)))?.cancel({ kind: 'user' }, { keepInbox: true })
        this.stopWork(ticket.id, 'The tasks executor restarted', true)
        this.host.engine.assignmentInterrupted(ticket.id, running.id)
      }
      else if (latest?.state === 'pending' && !waitsForPerson(ticket)) this.start(ticket, latest)
    }
  }
  /** 跑后台的 worker 事件处理,失败或恢复时更新 `worker` 健康项。 */
  private background(work: Promise<void>): Promise<void> {
    const { health } = this.host
    return work.then(() => {
      if (health.get()?.state === 'error') health.set({ state: 'ready', detail: 'Worker events are handled', at: now() })
    }, (error: unknown) => { health.set({ state: 'error', detail: String(error), at: now() }) })
  }
  /**
   * `error` 是否是 `key` 下仍有重试余量的一次性失败,并记账:重试中自增计数并返回
   * true;非一次性或重试耗尽时删除 `key` 并返回 false。
   */
  private retries(key: string, error: unknown): boolean {
    const tries = this.transientTries.get(key) ?? 0
    if (!transient(error) || tries >= TRANSIENT_TRIES) { this.transientTries.delete(key); return false }
    this.transientTries.set(key, tries + 1)
    return true
  }
  /** 一次过性的供应商或网络错误后,按指数退避安排 worker 回合重试。 */
  private resumeAfter(ticketId: string, assignmentId: string, error: unknown): void {
    const tries = this.transientTries.get(assignmentId)
    if (tries === undefined) return
    const text = `Your last turn failed for a passing reason (${String(error).slice(0, 200)}). Continue the assignment where it stopped.`
    this.resuming.add(assignmentId)
    const go = (): void => {
      if (this.host.closing()) return
      const ticket = this.host.store.tickets.get(ticketId)
      if (!ticket || !liveTicket(ticket) || runningAssignment(ticket)?.id !== assignmentId) { this.resuming.delete(assignmentId); return }
      // R1:退避重试落到这里时预算已耗尽即记 failed,不再重试(35 号 A17)。
      const exhausted = this.exhaustedSummary(ticketId)
      if (exhausted) { this.resuming.delete(assignmentId); this.failed(ticketId, exhausted); return }
      // 处理暂停或无唤醒槽时空等下一轮张望。
      if (this.host.paused()) { this.after(SLOT_WAIT_MS, go); return }
      const sessionId = workerSessionId(ticketId)
      const waking = !this.running(ticket)
      try { if (waking) this.slots.reserve(ticketId, 'wake') }
      catch (failure) {
        if (!(failure instanceof Later)) throw failure
        this.after(SLOT_WAIT_MS, go); return
      }
      const sent = this.host.sessions.prompt(sessionId, `retry:${assignmentId}:${tries}`, text, 'queue')
      void this.background(sent.finally(() => { if (waking) this.slots.free(ticketId); this.resuming.delete(assignmentId) })
        .catch((failure: unknown) => { this.failed(ticketId, String(failure)) }))
    }
    this.after(TRANSIENT_BACKOFF_MS * 2 ** (tries - 1), go)
  }
  /** `dispose()` 先行时不跑地,在 `ms` 毫秒后安排 `then`。 */
  private after(ms: number, then: () => void): void {
    const timer = setTimeout(() => { this.timers.delete(timer); then() }, ms)
    timer.unref()
    this.timers.add(timer)
  }
  /**
   * 交接给人的 worker 释放其槽:其 subagent 停,其 shell job(如替人跑的服务)留给人
   * 直到 assignment 结束;它们不占槽、跑过任何时限;其结束被收集,不会在槽外唤醒
   * worker,worker 在下一回合读到每个的汇报。
   */
  private handOff(ticketId: string, agent: Agent): void {
    this.track(ticketId, stopSubagents(this.host.context, agent, true))
    const left = this.left.get(ticketId) ?? { jobs: new Set<string>(), collect: new AbortController() }
    this.left.set(ticketId, left)
    for (const job of runningJobs(this.host.context, agent.id, left.jobs)) {
      left.jobs.add(job.id)
      void this.background(collectJob(this.host.context, agent.id, job, left.collect.signal).then(async (ended) => {
        if (!ended) return
        const note = `Your background job ${ended.name} ended: ${ended.status}.`
        await this.host.sessions.prompt(agent.id, `ended:${job.id}`, note, { inject: 'Background job ended' })
      }))
    }
  }
  private async workerIdle(ticket: Ticket, idle: Assignment, agent: Agent): Promise<void> {
    await agent.whenIdle()
    // 一次过性失败后继续的回合,其退避不算回合结束。
    if (this.resuming.has(idle.id) || agent.status !== 'idle') return
    // 如常结束的回合,重新开始计一次过性失败。
    this.transientTries.delete(idle.id)
    // 该 assignment 闲下来时,其跑着的工单。
    const live = (): Ticket | undefined => {
      const stored = this.host.store.tickets.get(ticket.id)
      return stored && liveTicket(stored) && runningAssignment(stored)?.id === idle.id ? stored : undefined
    }
    // 最后的话是结果、给人的问题、或 blocked/failed 报告的 worker 交接给了人;其结果
    // 或问题之后到达的 input 是新工作。
    const handedOff = (stored: Ticket): boolean => {
      const assignment = runningAssignment(stored), report = assignment?.report
      const since = !!assignment?.deliveredAt && !!report && assignment.deliveredAt >= report.at
      return ((report?.state === 'ready' || !!stored.attention) && !since) || waitsForPerson(stored)
    }
    const before = live()
    if (!before || this.host.closing()) return
    // 人在 session 里开的回合是人的工作,它像任何回合一样在后台继续。
    const report = runningAssignment(before)?.report, person = this.personal.get(ticket.id)
    // worker 读完回合结束前到达它的内容:它交接时带的,或其后台工作结束的汇报。
    if (handedOff(before) && !(report && person && person > report.at)) {
      this.host.engine.turnEnded(ticket.id, idle.id)
      this.handOff(ticket.id, agent)
      return
    }
    // 其回合在它后台什么都不跑后结束,期间占住其槽:至多到本次 idle 起的时限,直到
    // worker 再跑或 assignment 结束。
    this.settling.get(ticket.id)?.abort()
    const look = new AbortController(), limit = new AbortController()
    this.settling.set(ticket.id, look)
    const timer = setTimeout(() => { limit.abort() }, BACKGROUND_LIMIT_MS)
    timer.unref()
    let quiet: boolean
    const left = this.left.get(ticket.id)?.jobs
    try { quiet = await untilQuiet(this.host.context, agent, AbortSignal.any([this.host.lifetime, look.signal, limit.signal]), left) }
    finally { clearTimeout(timer); if (this.settling.get(ticket.id) === look) this.settling.delete(ticket.id) }
    const current = live()
    if (this.host.closing() || look.signal.aborted || (!quiet && !limit.signal.aborted) || !current || this.resuming.has(idle.id)) return
    if (quiet) this.host.engine.turnEnded(ticket.id, idle.id)
    let stopped = ''
    if (!quiet) {
      // 跑过时限的 shell job 被 kill,worker 下回合被告知;其 subagent 的停止会唤醒
      // 它,故继续跑。
      const sessionId = workerSessionId(ticket.id), minutes = BACKGROUND_LIMIT_MS / 60_000
      const jobs = runningJobs(this.host.context, sessionId, left).map(job => job.name)
      if (jobs.length) {
        void this.background(killJobs(this.host.context, sessionId, 'The job ran past its limit', left))
        const note = `Your background jobs ran ${minutes} minutes after your turn ended and were killed: ${jobs.join(', ')}.`
        void this.background(this.host.sessions.prompt(sessionId, `killed:${jobs.join(',')}`, note, { inject: 'Background jobs killed' }))
      }
      stopped = jobs.length ? `Background jobs ran ${minutes} minutes after the worker's turn ended and were killed: ${jobs.join(', ')}.`
        : `Subagents still ran ${minutes} minutes after the worker's turn ended.`
    }
    // worker 可能在回合结束时已报告;被人的消息解救的 blocked/failed 报告是陈旧的。
    if (handedOff(current)) return
    const said = this.said.get(agent.id) ?? ''
    const text = [said, stopped].filter(Boolean).join('\n\n')
    this.host.store.atomic(() => {
      const previous = latestReport(current)?.summary ?? ''
      const updated = this.host.engine.report(ticket.id, { state: 'waiting', summary: text || previous })
      // orchestrator 报告后安静的收尾不是新状态,也不是空交接。
      if (text) {
        const relay = resultRelay(updated, 'waiting', text)
        this.host.sessions.relay(relay.id, relay.text)
      }
      else if (!previous.trim()) {
        const relay = resultRelay(updated, 'waiting', 'Worker ended without a status report. Request one with a status request.')
        this.host.sessions.relay(relay.id, relay.text)
      }
    })
  }
}
