/**
 * 候选卡构造——主会话评估一张主动候选所需的有界事实,与决策局部化的窗口计算
 * (35 号 A19;34 号 §2.5 candidate 行「候选卡构造:bounded 事实 + related_tickets ≤8」)。
 *
 * 设计依据(决策局部化,28 号 §1.1 表逐行):
 * - 触发原文:卡片文本 ≤4000 字符(TRIGGER_CHARS);
 * - 对话上下文:线程窗口 = 前 5 条 + 触发点前后各 5 条(400/1200 字符),其余折叠为 50 字符存根
 *   (threadWindow + WINDOW_CHARS/NEAR_CHARS/STUB_CHARS);
 * - 相关工单:`related_tickets` ≤8(open 优先)+ `tickets_total`——**Engine 计算,不靠模型记忆**
 *   (数据源是 Engine 的 Candidate.tickets,含已结束工单——27 号 §3.3-B「Eval 强制看到线程上
 *   所有工单含已结束 → attach」的情况 B 防线);
 * - policy_version:候选所属 Eval 构建时的规则版本(Engine 的 Candidate.policyVersion),
 *   对照主会话 Policy 段即可发现版本漂移。
 *
 * 语义自 SA src/sources/admission-context.ts(threadWindow/admissionContext)与
 * SA src/app/cards.ts、assessment.ts context() 的模型面投影半边重写级校对移植;
 * SA cards.ts 的 HTTP/面板渲染半边不移植(34 号 §0 不做清单,30 号 workbench 承接)。
 * 本文件全部为纯函数、零 I/O(线程上下文经 assessor.ts 的 TriggerContext 端口注入)。
 */
import { latestReport, reasonText, threadKey, ticketStage, type Decision, type Thread, type Ticket, type Trigger, type TriggerDisposition } from '../core/index.ts'
import type { ContextMessage, ThreadPage, TriggerContext } from './assessor.ts'

/** 卡片文本(触发原文)字符上限(28 号 §1.1「卡片文本 ≤4000 字符」;SA assessment.ts:37 原值)。 */
export const TRIGGER_CHARS = 4000
/** 窗口内普通消息的字符上限(28 号 §1.1「400/1200」的前值;SA 同原值)。 */
export const WINDOW_CHARS = 400
/** 触发点两个近邻消息的字符上限(28 号 §1.1「400/1200」的后值;SA 同原值)。 */
export const NEAR_CHARS = 1200
/** 窗口外已加载消息的存根预览字符上限(28 号 §1.1「50 字符存根」;SA 同原值)。 */
export const STUB_CHARS = 50
/** 候选卡携带的相关工单上限(open 优先;28 号 §1.1「related_tickets ≤8」)。 */
export const RELATED_TICKETS = 8
/** admissionContext 单次评估至多读取的线程页数(随 settings admissionContextMaxPages 配置,SA 同名)。 */
export const ADMISSION_CONTEXT_MAX_PAGES = 100

/** 折叠空白并把文本截至 `limit` 字符的展示预览(代码、尖括号与链接对模型读者保持原样)。 */
export function preview(text: string): string { return text.replace(/\s+/g, ' ').slice(0, 160) }

/**
 * 有界截断:`text` 不超 `limit` 时原样给出;超限给截断文本(`…` 结尾)与完整长度 `chars`——
 * 模型据此知道还有多少未读,并可用读路径取全文(SA assessment.ts cut 同构)。
 */
export function cut(text: string, limit: number): { text: string; chars?: number } {
  return text.length <= limit ? { text } : { text: `${text.slice(0, limit)}…`, chars: text.length }
}

/**
 * 按 UTF-16 码元分页切文本,拼接各页可复原原文(SA cards.ts textPage 同构);资源读取面的
 * 通用返回形态:`next_offset` 为 null 即读完。
 */
export function textPage(resource: string, text: string, offset: number, limit: number) {
  const end = Math.min(text.length, offset + limit)
  return { resource, offset, total_chars: text.length, next_offset: end < text.length ? end : null, text: text.slice(offset, end) }
}

/**
 * 选取线程开头的前 5 条消息,加上触发点前后的各 5 条,并记录被省略的缺口数
 * (SA admission-context.ts threadWindow 原样移植,28 号 §1.1「前 5 条 + 触发点前后各 5 条」)。
 * `entries[i].omitted_before` 是它与上一条入选消息之间被省略的条数(首位入选之前的缺口为
 * 其前置下标);`omitted_after` 是最后一条入选之后被省略的条数;`source_found` 说明触发
 * 消息是否在已加载的消息里。
 */
export function threadWindow(messages: ContextMessage[], sourceId: string) {
  const trigger = messages.findIndex(message => message.id === sourceId)
  const selected = messages.map((message, index) => ({ message, index }))
    .filter(({ index }) => index < 5 || (trigger >= 0 && Math.abs(index - trigger) <= 5))
  let previous = -1
  const entries = selected.map(({ message, index }) => {
    const omitted_before = index - previous - 1
    previous = index
    return { message, position: index + 1, omitted_before }
  })
  return { entries, source_found: trigger >= 0, loaded_messages: messages.length, omitted_after: messages.length - previous - 1 }
}

/** 工单卡展示的状态:开放工单取其阶段(docs/003 阶段表),已结束工单取其结局。 */
export const TICKET_STATES = ['person/delivery', 'person/answer', 'person/review', 'person/blocked', 'person/failed', 'working', 'working/queued', 'idle',
  'completed', 'merged', 'closed', 'dropped', 'stopped'] as const
export type TicketCardState = typeof TICKET_STATES[number]
function cardState(ticket: Ticket): TicketCardState {
  if (ticket.ended) return ticket.ended.outcome
  const stage = ticketStage(ticket)
  if (stage.stage === 'person') return `person/${stage.action}`
  return stage.stage === 'idle' ? 'idle' : stage.stage === 'working' && stage.action ? 'working/queued' : 'working'
}

/** 工单的有界模型面卡片(全文留在可读资源之后:`ticket/<id>`)。 */
export function ticketCard(ticket: Ticket) {
  const ended = ticket.ended && { at: ticket.ended.at, by: ticket.ended.by, reason: ticket.ended.reason ?? ticket.ended.outcome }
  const { attention } = ticket
  return {
    ticket_id: ticket.id, title: ticket.title, state: cardState(ticket), strength: ticket.mandate.strength,
    ...(ended ? { ended } : {}),
    ...(attention ? { attention: { question: attention.question,
      ...attention.triggerId ? { trigger_id: attention.triggerId } : {} } } : {}),
    preview: preview(latestReport(ticket)?.summary ?? ''), read: `ticket/${ticket.id}`,
  }
}

/** 一条 trigger 的有界模型面卡片(全文留在可读资源之后:`trigger/<id>`)。 */
export function triggerCard(trigger: Trigger, disposition?: TriggerDisposition) {
  return {
    trigger_id: trigger.id, source: trigger.source, ...(trigger.url ? { source_url: trigger.url } : {}), actor: trigger.actor.id,
    thread: threadKey(trigger.threads[0] ?? { source: trigger.source, id: '' }), human: trigger.human, at: trigger.at,
    preview: preview(trigger.text), chars: trigger.text.length, read: `trigger/${trigger.id}`,
    ...(disposition ? { disposition: { ...(disposition.filtered ? { filtered: reasonText(disposition.filtered) } : {}),
      ...(disposition.decisionId ? { decision_id: disposition.decisionId } : {}), delivered_to: disposition.fanout } } : {}),
  }
}

/** 一条 Decision 的有界模型面卡片(审计细节留在 `decision/<id>`)。 */
export function decisionCard(decision: Decision) {
  return { decision_id: decision.id, kind: decision.kind, thread: decision.threadKey, trigger_ids: decision.triggerIds,
    ...(decision.ticketId ? { ticket_id: decision.ticketId } : {}), at: decision.at, read: `decision/${decision.id}` }
}

/** 一条线程的有界模型面卡片(标签/链接归 channels 面投影;此处只投影领域事实)。 */
export function threadCard(thread: Thread) {
  return { thread: thread.key, source: thread.ref.source, tickets: thread.subscriptions,
    ...(thread.evaluating ? { evaluating: { since: thread.evaluating.startedAt, deadline: thread.evaluating.deadline } } : {}),
    pending: thread.pending.length, read: `thread/${thread.key}` }
}

/**
 * 相关工单的有界投影:`related_tickets` ≤8(**open 优先**,同级按创建时间新在前)+
 * `tickets_total` 全数——数据来自 Engine 的 Candidate.tickets,**含已结束工单**
 * (27 号 §3.3-B 情况 B 防线:评估强制看到线程上已有过的工单,重复讨论走 attach/ignore
 * 而非竞速开新单;Engine 计算,不靠模型记忆,28 号 §1.1)。SA cards.ts relatedTickets 原样移植。
 */
export function relatedTickets(tickets: readonly Ticket[]) {
  const order = [...tickets].sort((a, b) => Number(!a.ended) === Number(!b.ended)
    ? b.createdAt.localeCompare(a.createdAt) : a.ended ? 1 : -1)
  return { related_tickets: order.slice(0, RELATED_TICKETS).map(ticketCard), tickets_total: tickets.length }
}

/**
 * 把已加载的线程消息按窗口展开为候选卡的 `thread` 投影:窗口内消息给截断文本
 * (触发点两个近邻 NEAR_CHARS,其余 WINDOW_CHARS),窗口外已加载消息给 STUB_CHARS 存根;
 * 触发点自身只标 `trigger: true`(其全文已在卡片顶层给出一次,不重复)。
 * 计数字段(`complete`/`loaded_messages`/`source_found`)只描述本次已加载快照,
 * 绝非声称读过全部历史(SA admissionContext 注释原语义)。逐字段断言在
 * tests/candidate-context.spec.ts(35 号 A19 门禁)。
 */
export function windowProjection(loaded: LoadedThreadContext, sourceId: string) {
  const shown = new Map(loaded.window.entries.map(entry => [entry.message.id, entry]))
  const at = loaded.messages.findIndex(message => message.id === sourceId)
  const projection = loaded.messages.map((message, index) => {
    const author = { id: message.id, from: message.from, ...message.bot ? { bot: true } : {} }
    if (message.deleted) return { ...author, deleted: true }
    if (!shown.has(message.id)) return { ...author, preview: message.text.replace(/\s+/g, ' ').slice(0, STUB_CHARS) }
    // 触发点自身的全文已在卡片顶层;线程投影里只标位次。
    if (index === at) return { ...author, at: message.at, trigger: true }
    const near = at >= 0 && Math.abs(index - at) <= 2
    return { ...author, at: message.at, ...cut(message.text, near ? NEAR_CHARS : WINDOW_CHARS) }
  })
  return { complete: loaded.complete, loaded_messages: loaded.window.loaded_messages, source_found: loaded.window.source_found,
    ...loaded.next ? { next_cursor: loaded.next } : {}, ...loaded.status ? { status: loaded.status } : {}, messages: projection }
}

/** 一次线程初载的已加载快照(admissionContext 的同步返回形态;windowProjection 消费)。 */
/** 一次线程初载的已加载快照(admissionContext 的同步返回形态;windowProjection 消费)。 */
export interface LoadedThreadContext {
  messages: ContextMessage[]
  window: ReturnType<typeof threadWindow>
  complete: boolean
  next: string | null
  status?: string
}

/**
 * 读取一条触发消息所在线程的有界上下文(候选评估的线程窗口):
 * 至多 `maxPages` 页、按 `TriggerContext` 端口分页,去重后构建 threadWindow
 * (SA admissionContext 重写级移植;Commands 面换成端口注入与 AbortSignal——
 * 24 号 §8.2 不采纳具体 Source 实现,读取面由 channels/Source 适配器供,A21 接线)。
 * `status` 报告回退模式(如 `chat_neighbours`);counts 只描述本次已加载快照,绝非全部历史。
 */
export async function admissionContext(context: TriggerContext, maxPages: number, signal?: AbortSignal): Promise<LoadedThreadContext> {
  const messages: ContextMessage[] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let next: string | undefined
  let status: string | undefined
  let more = true
  for (let page = 0; more && page < maxPages; page++) {
    signal?.throwIfAborted()
    const result: ThreadPage = await context.read('thread', next, signal)
    for (const message of result.messages) if (!seen.has(message.id)) {
      seen.add(message.id); messages.push(message)
    }
    status ??= result.status
    next = result.next
    more = next !== undefined
    if (next !== undefined && cursors.has(next)) throw new Error('Thread pagination repeated a cursor; context is incomplete')
    if (next !== undefined) cursors.add(next)
  }
  return { messages, window: threadWindow(messages, context.messageId), complete: !more, next: more ? next ?? null : null,
    ...status ? { status } : {} }
}
