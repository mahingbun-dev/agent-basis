/**
 * 读取面资源语法——orchestrator_read 的资源表、按角色收窄的语法串与读取分派
 * (35 号 A20;34 号 §2.5 tools 行四纪律之二「工具描述给出资源语法(模型知道边界)」、
 * 24 号 §5.5-R4「主 Session orchestrator_read 读文件不读消息」)。
 *
 * SA src/app/resources.ts 的机制按需重写(34 号 §2.6「不整体移植;机制并入」):领域资源
 * (tickets/triggers/threads/decisions/settings)投影自本仓 store 只读面;★R4 工单产物资源
 * (`ticket/<id>/files` 与 `ticket/<id>/file/<path>`)读取每工单 R4 目录 `.ticket/<id>/`
 * (24 号 §5.5-R4 目录名;35 号 A14 ticketExecution 同源派生)——主会话读文件不读消息的落点,
 * worker 只可读其自己工单的子树。worker 不可读的资源(主会话专属)一律显式报错,不静默降级
 * (34 号 §4-D tools 行「角色分面」;SA resources.ts `main` 守卫同构)。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { latestReport, reached, runningAssignment, type Decision, type Thread, type Ticket, type Trigger } from '../core/index.ts'
import { inputMessage, inputResource } from '../executor/dsh.ts'
import { decisionCard, textPage, threadCard, ticketCard, triggerCard, preview } from '../session/candidate.ts'
import { UserError } from '../core/errors.ts'
import type { Store } from '../store/store.ts'
import type { SettingsBlock } from '../policy/settings.ts'

/** R4 每工单目录在租户工作区下的相对布局(与 executor/dsh.ts ticketExecution 同一常量路径)。 */
const TICKET_DIR = '.ticket'
/** 列表页默认与至多条目数;文本页默认与至多字符数(SA resources.ts 同值)。 */
const LIST_SIZE = 20, LIST_MAX = 50, TEXT_CHARS = 4000, TEXT_MAX = 8000

/** 读取面暴露的资源描述:`executor: true` 的资源 worker(工单 Session)也可读其自己工单的。 */
export const RESOURCES: readonly { name: string; holds: string; executor?: true }[] = [
  { name: 'tickets', holds: '工单卡,最新在前;卡的状态是 person/review(ready 报告后)、person/blocked 或 person/failed(相应报告后)、person/answer(有问题)、person/delivery(Input 未达 worker)、working 或 working/queued(工作中)、idle(worker 结束回合而无报告)、或工单的结局' },
  { name: 'triggers', holds: 'trigger 卡与其去向,最新在前' },
  { name: 'threads', holds: '已订阅线程,最新活动在前,附其工单、进行中的评估与轮询错误' },
  { name: 'thread/<key>', holds: '一条线程:其订阅工单、最新 Decision 与其 trigger,最新在前', executor: true },
  { name: 'decisions', holds: 'Decision,最新在前' },
  { name: 'decision/<id>', holds: '一条 Decision 及其审计' },
  { name: 'ticket/<id>', holds: '工单卡、其开启 trigger/Decision/线程、最新 assignments 及各报告的开头、其 inputs,最新在前', executor: true },
  { name: 'ticket/<id>/assignment', holds: '其 assignment 文本', executor: true },
  { name: 'ticket/<id>/assignments', holds: '其 assignments,最新在前,附各报告的开头', executor: true },
  { name: 'ticket/<id>/inputs', holds: '其 inputs,最新在前', executor: true },
  { name: 'ticket/<id>/result', holds: '其最新报告', executor: true },
  { name: 'ticket/<id>/input/<id>', holds: '它被投递的一条 input', executor: true },
  { name: 'ticket/<id>/files', holds: `其 R4 工作区(${TICKET_DIR}/<id>/)下的产物文件列表(R4:进度/决策/证据落文件,读文件不读消息)`, executor: true },
  { name: 'ticket/<id>/file/<path>', holds: '其 R4 工作区下的一个文件全文(分页)', executor: true },
  { name: 'trigger/<id>', holds: '一条 trigger 的全文与去向', executor: true },
  { name: 'settings', holds: 'settings 按块,各附一次保存所名的修订:小块全文,Policy 与 Source 实例概要' },
  { name: 'settings/<block>', holds: '一个 settings 块全文,如 orchestrator_settings_save 所取:policy、eval、executor、pause 或 source:<id>' },
]
/** 资源语法串(拼进 readTool 的 resource 参数描述;worker 只列 `executor: true` 的资源)。 */
export const resourceGrammar = (executor: boolean): string => RESOURCES.filter(resource => !executor || resource.executor)
  .map(resource => `${resource.name}:${resource.holds}`).join('; ')

/** 读取面的宿主依赖:租户库只读面 + 当前设置(读取面零写入,34 号 §3)。 */
export interface ResourceHost {
  readonly store: Pick<Store, 'tickets' | 'triggers' | 'threads' | 'decisions' | 'settings' | 'blockRevision' | 'workspaceDir' | 'read'>
}

interface Read { host: ResourceHost; resource: string; offset: number; limit: number | undefined; ticketId: string | undefined }
/** 一次读取的分派形态。 */
type Route = readonly [match: (resource: string) => boolean, read: (read: Read, resource: string) => unknown]

/** 主会话专属资源的守卫:worker Session 一律拒(不静默降级,SA `main` 同构)。 */
const main = ({ ticketId }: Read): void => {
  if (ticketId) throw new Error('This resource belongs to the main Session')
}
/** 列表分页:每页至多 50 条,`next_offset` 为 null 即读完(SA list 同构)。 */
function list<T>({ offset, limit }: Read, fetch: (offset: number, count: number) => T[]) {
  const size = Math.min(limit ?? LIST_SIZE, LIST_MAX)
  const items = fetch(offset, size + 1)
  return { items: items.slice(0, size), next_offset: items.length > size ? offset + size : null }
}
/** 文本分页(默认 4000、至多 8000 字符)。 */
const text = ({ resource, offset, limit }: Read, body: string) => textPage(resource, body, offset, Math.min(limit ?? TEXT_CHARS, TEXT_MAX))
/** 工单卡的输入行(read 路径指向单条 input 资源)。 */
function inputLine(ticket: Ticket, input: Ticket['inputs'][number]) {
  const names = input.kind === 'trigger' || input.kind === 'resumed' ? { trigger_id: input.triggerId }
    : input.kind !== 'text' ? { read: inputResource(ticket.id, input.id) }
      : input.text.length <= 80 ? { text: input.text }
        : { preview: preview(input.text).slice(0, 80), chars: input.text.length, read: inputResource(ticket.id, input.id) }
  return { kind: input.kind, at: input.at, ...names, ...ticket.undelivered.includes(input.id) ? { undelivered: true } : {} }
}
/** 工单卡的 assignment 行(附最新报告的开头与读取路径)。 */
function assignmentLine(ticket: Ticket, item: Ticket['assignments'][number]) {
  return { id: item.id, state: item.state, at: item.createdAt,
    ...(item.report ? { report: { state: item.report.state, at: item.report.at, preview: preview(item.report.summary).slice(0, 100),
      chars: item.report.summary.length, read: `ticket/${ticket.id}/result` } } : {}) }
}
/** worker 对一条 trigger 的可读性:经投递/工单 origin/其工单跟随的线程到达(SA readable 同构)。 */
function readable(host: ResourceHost, ticket: Ticket, trigger: Trigger): boolean {
  return reached(ticket, trigger, key => host.store.threads.get(key)) || ticket.origin.triggerIds.includes(trigger.id)
    || trigger.threads.some(ref => ticket.follows?.some(follow => follow.thread === `${ref.source}:${ref.id}`))
}
/** 工单的 R4 目录绝对路径;越界或不存在由调用方处理。 */
const ticketDir = (host: ResourceHost, ticketId: string): string => join(host.store.workspaceDir, TICKET_DIR, ticketId)
/** 相对路径守卫:拒绝越出 R4 目录的路径(fail-closed,防 `..` 逃逸)。 */
function withinRoot(root: string, relative: string): string {
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) throw new Error('The path escapes the ticket workspace')
  return target
}
/** 资源路径的第 n 段;缺段给空串(ownTicket 的 unknownTicket 语义兜住)。 */
const segment = (resource: string, index: number): string => resource.split('/')[index] ?? ''
/** worker 读工单子树的守卫:只可读其绑定工单。 */
const ownTicket = ({ host, ticketId }: Read, id: string): Ticket => {
  const ticket = host.store.tickets.get(id)
  if (!ticket) throw new UserError('unknownTicket')
  if (ticketId !== undefined && ticketId !== id) throw new Error('A worker reads only its own ticket')
  return ticket
}

/** 读取分派表(按注册序第一匹配胜出)。 */
const ROUTES: readonly Route[] = [
  [name => name === 'tickets', (read) => {
    main(read)
    return list(read, (offset, count) => read.host.store.tickets.list().slice(offset, offset + count).map(ticketCard))
  }],
  [name => name === 'triggers', (read) => {
    main(read)
    return list(read, (offset, count) => read.host.store.read.recentTriggers(offset, count)
      .map(trigger => triggerCard(trigger, read.host.store.triggers.disposition(trigger.id))))
  }],
  [name => name === 'threads', (read) => {
    main(read)
    return list(read, (offset, count) => read.host.store.threads.list().slice(offset, offset + count).map(threadCard))
  }],
  [name => name === 'decisions', (read) => {
    main(read)
    return list(read, (offset, count) =>
      read.host.store.read.recentDecisions(offset, count).map(decisionCard))
  }],
  [name => name.startsWith('decision/'), (read, resource) => {
    main(read)
    const decision: Decision | undefined = read.host.store.decisions.get(resource.slice('decision/'.length))
    if (!decision) throw new Error('Unknown decision; read the decisions list for the ids')
    const { policyVersion: _version, ...mandate } = decision.mandate ?? {}
    return { ...decisionCard(decision), ...(decision.mandate ? { mandate } : {}), ...(decision.audit ? { audit: decision.audit } : {}),
      ...(decision.delegation ? { delegation: decision.delegation } : {}) }
  }],
  [name => name.startsWith('thread/'), (read, resource) => {
    const key = resource.slice('thread/'.length)
    const thread: Thread | undefined = read.host.store.threads.get(key)
    if (!thread) throw new Error('Unknown or inaccessible thread')
    const card = threadCard(thread)
    const triggers = list(read, (offset, count) => read.host.store.read.threadPage(key, offset, count)
      .map(trigger => triggerCard(trigger, read.host.store.triggers.disposition(trigger.id))))
    // worker 只见线程的 trigger 流;工单与 Decision 归属是主会话面(34 §4-D「无其不可读的 id」)。
    return read.ticketId === undefined
      ? { ...card, tickets: thread.subscriptions.map(id => read.host.store.tickets.get(id)).filter(t => t !== undefined).map(ticketCard),
        decisions: read.host.store.decisions.byThread(key).map(decisionCard).slice(-5), ...triggers }
      : { thread: card.thread, read: card.read, ...triggers }
  }],
  [name => /^ticket\/[^/]+\/files$/.test(name), (read, resource) => {
    const ticketId = segment(resource, 1)
    ownTicket(read, ticketId)
    return listFiles(read.host, ticketId, read.offset, Math.min(read.limit ?? LIST_SIZE, LIST_MAX))
  }],
  [name => /^ticket\/[^/]+\/file\//.test(name), async (read, resource) => {
    const ticketId = segment(resource, 1)
    // resource 形如 ticket/<id>/file/<path>:前 3 段是资源语法,其余为工作区相对路径。
    const path = resource.split('/').slice(3)
    ownTicket(read, ticketId)
    const root = ticketDir(read.host, ticketId)
    const target = withinRoot(root, path.join('/'))
    const info = await stat(target).catch(() => undefined)
    if (info === undefined || !info.isFile()) throw new Error('Unknown ticket workspace file; list ticket/<id>/files first')
    return text(read, await readFile(target, 'utf8'))
  }],
  [name => /^ticket\/[^/]+$/.test(name), (read, resource) => {
    const ticket = ownTicket(read, segment(resource, 1))
    const worker = read.ticketId !== undefined
    const { preview: _p, ...card } = ticketCard(ticket)
    const running = runningAssignment(ticket)
    // 首页给最新的若干条(SA newestPage 语义):后续页经 next_resource 指到分页资源。
    return { ...card, ...(worker ? {} : { decision_id: ticket.decisionId }), trigger_id: ticket.origin.triggerId,
      threads: ticket.follows?.map(follow => ({ thread: follow.thread,
        ...follow.own ? { bound: true } : {}, ...follow.closed ? { closed: follow.closed } : {} }))
        ?? [], directory: ticket.execution?.directory, scope: ticket.mandate.scope, requested_by: ticket.mandate.actor.id,
      ...(running ? { assignment_running: running.id } : {}),
      assignments: firstPage(ticket.assignments, 3, `ticket/${ticket.id}/assignments`, item => assignmentLine(ticket, item)),
      inputs: firstPage(ticket.inputs, 10, `ticket/${ticket.id}/inputs`, input => inputLine(ticket, input)) }
  }],
  [name => /^ticket\/[^/]+\/assignment$/.test(name), (read, resource) => {
    const ticket = ownTicket(read, segment(resource, 1))
    return Promise.resolve(text(read, ticket.execution?.assignment ?? ''))
  }],
  [name => /^ticket\/[^/]+\/assignments$/.test(name), (read, resource) => {
    const ticket = ownTicket(read, segment(resource, 1))
    return list(read, (offset, count) => ticket.assignments.slice().reverse()
      .slice(offset, offset + count).map(item => assignmentLine(ticket, item)))
  }],
  [name => /^ticket\/[^/]+\/inputs$/.test(name), (read, resource) => listInputs(read, ownTicket(read, segment(resource, 1)))],
  [name => /^ticket\/[^/]+\/input\//.test(name), (read, resource) => {
    const ticket = ownTicket(read, segment(resource, 1))
    const input = ticket.inputs.find(item => item.id === decodeURIComponent(segment(resource, 3)))
    if (!input) throw new Error('Unknown input; read ticket/<id>/inputs for the ids')
    const trigger = input.kind === 'trigger' ? read.host.store.triggers.get(input.triggerId) : undefined
    return Promise.resolve(text(read, inputMessage(input, trigger ? triggerCard(trigger, read.host.store.triggers.disposition(trigger.id)) : undefined) ?? ''))
  }],
  [name => /^ticket\/[^/]+\/result$/.test(name), (read, resource) => {
    const ticket = ownTicket(read, segment(resource, 1))
    const report = latestReport(ticket)
    return text(read, report ? `${report.state} @ ${report.at}\n${report.summary}` : 'No report yet')
  }],
  [name => /^trigger\/[^/]+$/.test(name), (read, resource) => {
    const id = resource.slice('trigger/'.length)
    const trigger = read.host.store.triggers.get(id)
    if (!trigger) throw new UserError('unknownTrigger')
    // worker 只可读其工单到达过的 trigger(SA readable 守卫同构,防越权读他人请求)。
    if (read.ticketId !== undefined) {
      const ticket = read.host.store.tickets.get(read.ticketId)
      if (!ticket || !readable(read.host, ticket, trigger)) throw new UserError('notReached')
    }
    const disposition = read.host.store.triggers.disposition(id)
    const acked = disposition?.acked?.length ? { acked_by: disposition.acked } : {}
    const handed = disposition?.handbacks?.length ? { handed_back: disposition.handbacks } : {}
    return { ...triggerCard(trigger, disposition), text: trigger.text, ...acked, ...handed }
  }],
  [name => name === 'settings', (read) => {
    main(read)
    const settings = read.host.store.settings()
    return { policy: { revision: read.host.store.blockRevision('policy'), rules: settings.policy.rules.length,
      sources: Object.fromEntries(Object.entries(settings.policy.sources).map(([source, part]) => [source, { allowed: part.allowed.length, read: `settings/source:${source}` }])),
      read: 'settings/policy' },
    eval: { revision: read.host.store.blockRevision('eval'), value: settings.eval, read: 'settings/eval' },
    executor: { revision: read.host.store.blockRevision('executor'), read: 'settings/executor' },
    pause: { value: { paused: settings.paused } },
    sources: Object.entries(settings.sources).map(([id, instance]) => ({ id, enabled: instance.enabled, read: `settings/source:${id}` })) }
  }],
  [name => name.startsWith('settings/'), (read, resource) => {
    main(read)
    const block = resource.slice('settings/'.length) as SettingsBlock | 'pause'
    const settings = read.host.store.settings()
    let value: unknown
    if (block === 'pause') value = { paused: settings.paused }
    else if (block === 'policy') value = settings.policy
    else if (block === 'eval') value = settings.eval
    else if (block === 'executor') value = settings.executor
    else if (block.startsWith('source:')) value = settings.sources[block.slice('source:'.length)]
    else throw new UserError('unknownBlock', { block })
    return text(read, JSON.stringify({ block, revision: read.host.store.blockRevision(block), value }))
  }],
]

/** inputs 的列表页(单条经 `ticket/<id>/input/<id>` 读全文)。 */
function listInputs(read: Read, ticket: Ticket) {
  return list(read, (offset, count) => ticket.inputs.slice().reverse().slice(offset, offset + count).map(input => inputLine(ticket, input)))
}
/** 最新在前列表的首页:`items` + 满页时的 `next_resource`(SA newestPage 同构;续页按 offset 读)。 */
function firstPage<T>(items: readonly T[], size: number, nextResource: string, line: (item: T) => unknown) {
  const newest = items.slice().reverse()
  const page = newest.slice(0, size)
  return { items: page.map(line), ...(newest.length > size ? { next_resource: nextResource, next_offset: size } : {}) }
}
/**
 * R4 工作区的文件列表页(`ticket/<id>/files`;递归平铺相对路径,读路径为
 * `ticket/<id>/file/<path>`)。目录不存在时给空列表(工单目录尚未 prepare 属常态)。
 */
async function listFiles(host: ResourceHost, ticketId: string, offset: number, count: number) {
  const root = ticketDir(host, ticketId)
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const files: string[] = []
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...await walk(child))
      else if (entry.isFile()) files.push(relative(root, child))
    }
    return files.sort()
  }
  const files = await walk(root)
  return { items: files.slice(offset, offset + count).map(path => ({ path, read: `ticket/${ticketId}/file/${path}` })),
    next_offset: files.length > offset + count ? offset + count : null }
}

/**
 * 按资源路径读取一页:分派到第一匹配的路由;未知资源显式报错(资源语法即边界,
 * orchestrator_read 的描述给出语法,readTool)。`ticketId` 是 worker Session 绑定的工单,
 * 缺省即主会话(全部资源可读)。R4 文件资源为异步读取,故返回 Promise。
 * @throws 未知资源、worker 读主会话专属资源、worker 读他人工单、或 R4 路径越界时。
 */
export function readResource(host: ResourceHost, resource: string, offset: number, limit: number | undefined,
  ticketId: string | undefined, _signal?: AbortSignal): Promise<unknown> {
  const read: Read = { host, resource, offset, limit, ticketId }
  const route = ROUTES.find(([match]) => match(resource))
  if (!route) return Promise.reject(new Error('Unknown context resource; the orchestrator_read description lists the resource grammar'))
  // 同步实现的抛错也落为 rejected promise(工具接缝契约:执行函数恒以 Promise 应答)。
  try { return Promise.resolve(route[1](read, resource)) }
  catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
}
