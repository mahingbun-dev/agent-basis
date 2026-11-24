/**
 * 工单概览工具(P4 收尾,2026-11-24)——**仅 super 形态**,base 优雅缺席。
 *
 * ## 为什么由宿主半边注册,而不是像守门那样挂在 preset 里
 * 实机定谳(2026-11-24,真实 eterna-super profile):**预设 scope 是 isolate 的**,
 * `ctx.reflect.get('tasks', false)` 在预设内恒为 `undefined`。上游
 * `agentPresetRegistry.serviceForMount` 只认「本 preset 子树自己提供的」服务,
 * 宿主根 ctx 的 `tasks` 不在其中。诊断实证:
 *
 * ```
 * [extras-DIAG] reflect=false get=false hasTools=true     ← 预设内读不到 tasks
 * 根 ctx reflect.get('tasks')=true / tasks.snapshot 是函数  ← 宿主层读得到
 * ```
 *
 * 因此工单工具必须在**宿主半边**(`host.ts` 的上下文,它能读 `tasks`)注册,并且
 * 注册到**参谋会话自己的 scope** 上——这样它才只出现在参谋的工具面里,不进主会话。
 *
 * ## 为什么是 Tier1-合规的反射读
 * `@eterna/tasks` 在 `docs/tiers.yml` 是 **Tier2**,adviser 属 Tier1:
 * **Tier1 永不 import Tier2**(31 号 §2.2 铁律 1,`packctl TIER001` CI 强制)。
 * 故只经 `ctx.reflect.get('tasks', false)` 消费 `ctx.tasks.snapshot()` 结构面
 * (access 的 `TasksSettingsFace` 同一手法:结构声明 + 不 import)。
 *
 * ## 为什么只用 snapshot()
 * `TasksWorld` 还有 `query(sql)`,但那是「给模型任意查询面」——即使有 SELECT 白名单
 * 也可能扫出别的 realm 的行。`snapshot()` 已按本栈 realm 归账(38 号 T15 SSE 快照
 * 同源),是唯一适合给参谋的读取面。
 */
import type { Context } from '@deepseek-ai/cordis'

/** `ctx.tasks` 的最小结构子集(不 import Tier2 包;字段按实际消费收窄)。 */
interface TasksFace {
  snapshot(): {
    readonly realm?: unknown
    readonly tickets?: readonly TicketFace[]
  }
}

/** 工单的最小字段集(参谋只需要「是什么、到哪一步、卡在谁那」)。 */
interface TicketFace {
  readonly id?: unknown
  readonly title?: unknown
  readonly ended?: { readonly at?: unknown; readonly outcome?: unknown } | undefined
  readonly attention?: { readonly question?: unknown } | undefined
  readonly delivery?: { readonly error?: unknown } | undefined
  readonly assignments?: readonly {
    readonly state?: unknown
    readonly report?: { readonly state?: unknown; readonly summary?: unknown } | undefined
  }[]
  readonly updatedAt?: unknown
}

/** 本工具在模型面的名字(与主会话的 `orchestrator_read` 区分,避免混淆)。 */
export const ADVISER_TICKETS_TOOL_NAME = 'adviser_tickets'

/** 返回条数上限(参谋是顾问,不需要全量工单库;翻页价值低于概览)。 */
const MAX_TICKETS = 50

/** 单条摘要长度上限(与 tasks 的 report 摘要口径一致:开头即可判断)。 */
const SUMMARY_CHARS = 400

/** 安全取串(未知值一律空串,避免把 undefined 泄进模型面)。 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 截断(保留开头;参谋靠开头判断性质,不需要全文)。 */
function clip(text: string): string {
  return text.length <= SUMMARY_CHARS ? text : `${text.slice(0, SUMMARY_CHARS)}…`
}

/**
 * 推导工单阶段(照 `packages/tasks/src/core/stage.ts` 的 `ticketStage` 语义,
 * 但不 import——Tier1 不能依赖 Tier2)。**这里只做参谋视角的近似**:把原始字段
 * 归纳成一个中文短语,让模型不必自己推理状态机。
 *
 * ⚠ 与上游 `ticketStage` 的偏离:上游是权威状态机(含 `waitsForPerson` 等细节),
 * 本函数是**给模型看的摘要**。若两处口径出现分歧,以 tasks 的实现为准(它是
 * 单一事实源),本函数只需保证「不把卡点误报成正常」。
 */
function stageOf(ticket: TicketFace): string {
  if (ticket.ended !== undefined) {
    const outcome = asText(ticket.ended.outcome)
    return outcome === '' ? '已结束' : `已结束(${outcome})`
  }
  if (ticket.delivery !== undefined) return '卡点:投递失败'
  if (ticket.attention !== undefined) return '卡点:等待回答'
  const assignments = ticket.assignments ?? []
  const latest = assignments.length === 0 ? undefined : assignments[assignments.length - 1]
  const report = asText(latest?.report?.state)
  if (report === 'ready') return '待审阅'
  if (report === 'blocked') return '卡点:blocked'
  if (report === 'failed') return '卡点:failed'
  if (latest === undefined || latest.state === 'pending') return '排队中'
  if (report === 'waiting' || latest.state === 'ended') return '空闲'
  return '工作中'
}

/** 投影一条工单给模型(纯 JSON,字段可控)。 */
function projectTicket(ticket: TicketFace): Record<string, unknown> {
  const assignments = ticket.assignments ?? []
  const latest = assignments.length === 0 ? undefined : assignments[assignments.length - 1]
  const summary = asText(latest?.report?.summary)
  return {
    id: asText(ticket.id),
    title: asText(ticket.title),
    stage: stageOf(ticket),
    ...summary === '' ? {} : { latest_report: clip(summary) },
    ...ticket.attention === undefined ? {} : { question: asText(ticket.attention.question) },
    ...ticket.delivery === undefined ? {} : { delivery_error: asText(ticket.delivery.error) },
    ...asText(ticket.updatedAt) === '' ? {} : { updated_at: asText(ticket.updatedAt) },
  }
}

/** 读工单快照;tasks 服务缺席或形状不对时返回 undefined(优雅缺席)。 */
export function readTasksSnapshot(ctx: Context): ReturnType<TasksFace['snapshot']> | undefined {
  try {
    const reflect = (ctx as unknown as { readonly reflect?: { get(name: string, strict?: boolean): unknown } }).reflect
    const raw = reflect?.get('tasks', false)
    if (typeof raw !== 'object' || raw === null) return undefined
    const snapshot = (raw as { snapshot?: unknown }).snapshot
    if (typeof snapshot !== 'function') return undefined
    return (snapshot as () => ReturnType<TasksFace['snapshot']>).call(raw)
  } catch {
    return undefined
  }
}

/** 构造工具定义(纯数据;注册由调用方按会话做)。 */
function ticketToolDefinition(getContext: () => Context | undefined): Record<string, unknown> {
  return {
    name: ADVISER_TICKETS_TOOL_NAME,
    description:
      '读取本租户的工单概览(只读):每条工单的标题、当前阶段、最近一次报告开头、待答问题。'
      + '参谋用来了解主会话正在推进哪些事项。工单系统的完整资源语法由主会话的 orchestrator_read 提供,本工具只给概览。',
    parameters: {
      type: 'object',
      properties: {
        include_ended: {
          type: 'boolean',
          description: '是否包含已结束的工单,默认 false(只看在办的)。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TICKETS,
          description: `最多返回几条,默认 20,至多 ${MAX_TICKETS}。`,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          realm: { type: 'string' },
          count: { type: 'integer' },
          total: { type: 'integer' },
          tickets: { type: 'array', items: { type: 'object' } },
        },
        required: ['ok', 'count', 'tickets'],
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args: unknown): Promise<unknown> => {
      const options = (typeof args === 'object' && args !== null ? args : {}) as {
        include_ended?: unknown
        limit?: unknown
      }
      const includeEnded = options.include_ended === true
      const rawLimit = typeof options.limit === 'number' && Number.isFinite(options.limit)
        ? Math.floor(options.limit)
        : 20
      const limit = Math.min(Math.max(rawLimit, 1), MAX_TICKETS)

      const ctx = getContext()
      const snapshot = ctx === undefined ? undefined : readTasksSnapshot(ctx)
      if (snapshot === undefined) {
        // 运行期服务消失(宿主关停 / tasks 卸载):如实回 unavailable,不抛。
        return Promise.resolve({ ok: false, count: 0, total: 0, tickets: [], reason: '工单服务当前不可用' })
      }
      const all = snapshot.tickets ?? []
      const visible = includeEnded ? all : all.filter(ticket => ticket.ended === undefined)
      // 在办的排前面、最近更新的排前面(参谋关心「现在」)。
      const ordered = [...visible].sort((left, right) =>
        asText(right.updatedAt).localeCompare(asText(left.updatedAt)))
      return Promise.resolve({
        ok: true,
        realm: asText(snapshot.realm),
        count: Math.min(ordered.length, limit),
        total: all.length,
        tickets: ordered.slice(0, limit).map(projectTicket),
      })
    },
  }
}

/**
 * 给一个参谋会话注册工单工具。
 *
 * **必须由宿主半边调用**:预设 scope 是 isolate 的,那里读不到宿主根 ctx 的 `tasks`
 * (见本文件头注的实机实证)。注册到**参谋 agent 的 ctx** 上,工具因此只出现在该
 * 参谋的工具面,不进主会话、也不进其它参谋。
 *
 * @param hostCtx - 宿主半边上下文(能 `reflect.get('tasks')`)。
 * @param agentCtx - 参谋 agent 的 scoped ctx(`ctx.tools.register` 落在该 scope)。
 * @param agent - 参谋 agent(生命周期终点;它销毁时工具随之消失)。
 * @returns disposer;tasks 缺席时返回空的(优雅缺席,不注册坏工具)。
 */
export function registerTicketTool(
  hostCtx: Context,
  agentCtx: Context,
  agent: { readonly id?: unknown; readonly ctx?: Context },
): () => void {
  // tasks 服务缺席(base 形态)→ 不注册。这比「注册了但每次调用必失败」好:
  // 模型不会反复重试一个坏工具。
  if (readTasksSnapshot(hostCtx) === undefined) return () => {}

  const tools = (agentCtx as unknown as {
    readonly tools?: { register(definition: unknown, options?: unknown): () => void }
  }).tools
  if (tools === undefined || typeof tools.register !== 'function') return () => {}

  // 工单只在**参谋**里可见:用 when 谓词按 agent id 钉住,连同一 preset 的其它
  // 会话也不会看到(预设可能被别处复用)。
  const targetId = (agent as { readonly id?: unknown }).id
  let dispose: (() => void) | undefined
  try {
    dispose = tools.register(ticketToolDefinition(() => (typeof targetId === 'string' ? hostCtx : undefined)), {
      ...typeof targetId === 'string'
        ? { when: (activation: { readonly agent: { readonly id: string } }) => activation.agent.id === targetId }
        : {},
    })
  } catch {
    // output 形状不被接受 / 同名已注册:跳过,不影响其余工具面。
    dispose = undefined
  }
  return () => {
    try { dispose?.() } catch { /* scope 已关停 */ }
  }
}
