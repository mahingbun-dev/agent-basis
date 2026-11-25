/**
 * @eterna/session-eval Host 装配:把 {@link SessionEvalService}(规则层)与
 * {@link JudgeEngine}(裁判层)接到宿主会话面,并以 `ctx.provide('eternaSessionEval', …)`
 * 暴露给 access 守卫路由。
 *
 * ## 为什么装配在这里、路由在 access
 * 铁律 T2(`packctl tenant-scan` CI 强制):插件不得自注册 Web 路由/数据端点。
 * 数据面(读会话事件快照 + 裁判评分库)只能由本包提供,HTTP 面只能由 eterna-access
 * 登记(`/access/api/session-eval/*`)。两端靠**结构面**相遇:本包 provide 普通对象,
 * access 用 `ctx.reflect.get('eternaSessionEval', false)` 现读(adviser 同款),
 * 两个包互不 import。
 *
 * ## 订阅范围
 * P0 是纯投影、不订阅事件;P1 裁判层需要 `turn/end`(抽样 + 空闲终评计时)与
 * `turn/start`/`user/message`(撤销计时),故只订阅这三类事件、只做入队/计时,
 * **不读会话内容**(内容在任务真正执行时现读快照)——观察面永不阻塞回合。
 *
 * ## 模型直调
 * 与 memory `runCuratorOneShot` 同管道形状(prepareCall → 冻结 system + 单条 user
 * 消息 → BlockAssembler → finish 映射),但本包自持实现:Tier1 之间不互 import,
 * 且裁判的提示词/上限/错误文案都是评测场景自己的。
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { SessionEvalService, type SessionEvalPorts } from './service.ts'
import { JudgeEngine, type JudgeEnginePorts, type JudgeProviderCatalog } from './engine.ts'
import { judgeConfigPath, judgeStorePath } from './judge-config.ts'
import { businessMetricsPath } from './business-store.ts'
import type { JudgeLlmPort } from './judge-call.ts'
import type { SessionEventLike } from './types.ts'

/** 服务 id:`ctx.eternaSessionEval` 与 access 的 reflect 键(唯一事实源). */
export const SESSION_EVAL_SERVICE_ID = 'eternaSessionEval'

/** 宿主 Session 的最小读面(上游 `snapshotEvents(from, to?)`). */
interface SessionFace {
  snapshotEvents(from?: number, toExclusive?: number): readonly unknown[]
}

/** 宿主注册表的最小面(`ctx.agents` / `ctx.sessions` 都有 `get`). */
interface RegistryFace {
  get(id: string): unknown
}

/** 宿主 llm 服务的最小面(`ctx.llm`;上游 LlmRuntime 的结构子集). */
interface LlmFace {
  prepareCall(
    input: { readonly provider: string; readonly model: string; readonly maxTokens: number },
    signal?: AbortSignal,
  ): Promise<{
    readonly config: Record<string, unknown>
    stream(options: unknown): AsyncIterable<unknown>
  }>
  listProviders(): readonly unknown[]
  listModels(provider: string): Promise<readonly unknown[]>
}

/** 宿主事件面(ctx.on 的结构子集;不引入 dsh-session 类型增广依赖). */
interface EventsFace {
  on(name: string, handler: (...args: unknown[]) => void): () => void
}

/** 宿主侧读服务的统一入口(cordis 过滤上下文对未声明服务直读会抛). */
function readService(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(id: string): unknown }).get(name)
  } catch {
    return undefined
  }
}

function asRegistry(value: unknown): RegistryFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Record<string, unknown>).get === 'function'
    ? value as RegistryFace
    : undefined
}

function asSession(value: unknown): SessionFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Record<string, unknown>).snapshotEvents === 'function'
    ? value as SessionFace
    : undefined
}

function asAgentSession(value: unknown): SessionFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return asSession((value as { readonly session?: unknown }).session)
}

function asLlm(value: unknown): LlmFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return typeof record.prepareCall === 'function'
    && typeof record.listProviders === 'function'
    && typeof record.listModels === 'function'
    ? value as LlmFace
    : undefined
}

function asEvents(value: unknown): EventsFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Record<string, unknown>).on === 'function'
    ? value as EventsFace
    : undefined
}

/**
 * 从事件快照里读数组(防御:上游返回非数组/抛错一律视为不可读).
 * 只取 `snapshotEvents(0)` 的全量 —— 评测要评整条会话,不做尾部窗口。
 */
function readEventsOf(session: SessionFace | undefined): readonly SessionEventLike[] | undefined {
  if (session === undefined) return undefined
  try {
    const events = session.snapshotEvents(0)
    return Array.isArray(events) ? events as readonly SessionEventLike[] : undefined
  } catch {
    return undefined
  }
}

/**
 * 构造连到真实主机的端口。
 *
 * 服务**每次现读**(adviser 头注同款教训):插件装载顺序由服务可用性驱动,
 * apply 时点 `agents`/`sessions` 可能尚未注册;缓存成闭包常量会永久 undefined。
 *
 * 读序:① `agents.get(id).session`(会话已被 agent 持有,最常见);
 * ② `sessions.get(id)`(会话已进入 store 但 agent 未装配,如历史加载中)。
 * 两处都无 → undefined,由服务面映射为 `not_loaded`。
 *
 * @param ctx - 插件上下文(每次操作重新解析服务).
 * @returns 端口实现;依赖缺席时返回 undefined,不抛。
 */
export function createHostPorts(ctx: Context): SessionEvalPorts {
  const registry = (name: string): RegistryFace | undefined => asRegistry(readService(ctx, name))
  return {
    readEvents(sessionId) {
      const fromAgent = asAgentSession(registry('agents')?.get(sessionId))
      const direct = readEventsOf(fromAgent)
      if (direct !== undefined) return direct
      return readEventsOf(asSession(registry('sessions')?.get(sessionId)))
    },
  }
}

/** 文本块投影(非 text 块跳过;裁判输出按纯文本契约消费,与 memory blocksToText 同口径). */
function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * 终止原因 → fail-closed 错误(compaction summarizer / memory finishError 同款映射)。
 * 截断的输出不可信:裁判宁可不给分(error),不用半截 JSON 猜。
 */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return LlmError.fromFailure(finish.failure)
    case 'max-tokens': {
      const truncated = new Error('[session-eval] 裁判输出在 token 上限处截断（输出不完整）') as Error & { code?: string }
      truncated.code = 'MAX_TOKENS'
      return truncated
    }
    default:
      return undefined
  }
}

/** 计费口径 token(预算闸用;totalTokens 优先,缺失时四桶求和). */
export function billedTokens(usage: TokenUsage): number {
  if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
    return Math.max(0, Math.round(usage.totalTokens))
  }
  return Math.max(0, Math.round(
    usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
  ))
}

/**
 * 构造裁判直调端口(ctx.llm 现读;未就绪时抛错,由编排层收敛成 error 评分).
 * @param ctx - 插件上下文.
 * @returns 直调端口实现。
 */
export function createLlmJudgePort(ctx: Context): JudgeLlmPort {
  return {
    async call(input) {
      const llm = asLlm(readService(ctx, 'llm'))
      if (llm === undefined) throw new Error('[session-eval] 模型服务未就绪（ctx.llm 缺席）')
      const signal = input.signal
      const call = await llm.prepareCall(
        { provider: input.route.provider, model: input.route.model, maxTokens: input.maxTokens },
        signal,
      )
      const messages: RequestMessage[] = [{ role: 'user', content: [{ type: 'text', text: input.user }] }]
      const streamOptions = deepFreeze({
        ...call.config,
        system: input.system,
        messages,
        maxTokens: input.maxTokens,
        ...signal !== undefined ? { signal } : {},
      })
      const assembler = new BlockAssembler()
      for await (const chunk of call.stream(streamOptions)) {
        signal?.throwIfAborted()
        assembler.push(chunk as never)
      }
      signal?.throwIfAborted()
      const error = finishError(assembler.finish)
      if (error !== undefined) throw error
      const usage = assembler.usage
      return {
        text: blocksToText(assembler.blocks()),
        ...usage === undefined ? {} : { tokens: billedTokens(usage) },
      }
    },
  }
}

/**
 * provider/model 目录(设置分区的模型选择面)。
 * 逐家查询,单家失败只丢该家模型列表(不丢 provider 本身);整体异常 → 空列表。
 * @param ctx - 插件上下文.
 */
export async function listProviderCatalog(ctx: Context): Promise<readonly JudgeProviderCatalog[]> {
  const llm = asLlm(readService(ctx, 'llm'))
  if (llm === undefined) return []
  let providers: readonly unknown[]
  try {
    const listed = llm.listProviders()
    providers = Array.isArray(listed) ? listed : []
  } catch {
    return []
  }
  const catalog: JudgeProviderCatalog[] = []
  for (const entry of providers) {
    const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined
    const id = typeof record?.id === 'string' && record.id !== '' ? record.id : undefined
    if (id === undefined) continue
    let models: string[] = []
    try {
      const listed = await llm.listModels(id)
      if (Array.isArray(listed)) {
        models = listed
          .map((model) => {
            const item = typeof model === 'object' && model !== null ? model as Record<string, unknown> : undefined
            return typeof item?.id === 'string' && item.id !== '' ? item.id : undefined
          })
          .filter((model): model is string => model !== undefined)
      }
    } catch {
      // 单家目录枚举失败:模型列表留空(保存自检据此视为不可枚举,不拦保存)。
    }
    catalog.push({ id, models })
  }
  return catalog
}

/**
 * 构造裁判引擎(配置/评分库落在 `$DSH_HOME/.eterna/session-eval/`)。
 * @param ctx - 插件上下文.
 * @returns 引擎实例(未装载也能构造;模型目录/服务缺席时降级)。
 */
export function createJudgeEngine(ctx: Context): JudgeEngine {
  const host = createHostPorts(ctx)
  const ports: JudgeEnginePorts = {
    // 闭包包住方法引用:对象字面量直接取方法会丢 this(oxlint unbound-method)。
    readEvents: sessionId => host.readEvents(sessionId),
    llm: createLlmJudgePort(ctx),
    listProviders: () => listProviderCatalog(ctx),
    businessPath: account => businessMetricsPath(undefined, account),
  }
  return new JudgeEngine({
    configPath: judgeConfigPath(),
    storePath: judgeStorePath(),
    ports,
  })
}

/**
 * 装配服务并 provide 成 `ctx.eternaSessionEval`;同时订阅裁判观察事件。
 * @param ctx - 插件上下文.
 * @returns disposer(摘监听 → 撤引擎 → 注销 provide).
 */
export function mountSessionEval(ctx: Context): () => void {
  const engine = createJudgeEngine(ctx)
  const host = createHostPorts(ctx)
  const service = new SessionEvalService({ readEvents: sessionId => host.readEvents(sessionId), judge: engine })
  const provide = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
  const disposeProvide = typeof provide === 'function'
    ? provide.call(ctx, SESSION_EVAL_SERVICE_ID, service)
    : () => {}
  // 观察面订阅(ctx.on 缺席 = 宿主未提供事件面;裁判仍可手动触发)。
  let offEvent = (): void => {}
  const events = asEvents(ctx)
  if (events !== undefined) {
    try {
      offEvent = events.on('session/event', (session: unknown, event: unknown) => {
        engine.handleEvent(session, event)
      })
    } catch {
      offEvent = () => {}
    }
  }
  return () => {
    offEvent()
    engine.dispose()
    disposeProvide()
  }
}
