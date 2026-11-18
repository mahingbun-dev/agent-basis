/**
 * 思考强度自动模式——宿主路由器(2026-11-18,内核双形态兼容):
 * 在每轮用户消息入箱时为开启自动模式的会话自动选思考强度档(reasoningEffort),
 * 本轮第一步即生效;宿主 installModelSelection 对「仅 effort 变化」不插
 * model-switch 提示语,select 同档原子 no-op,不产生事件噪音。
 *
 * 信号面(生产内核 dsh 0.2.2-alpha.3 与 rc.1 载荷差异实测,详见 docs/dev/thinking-auto.md):
 * - alpha.3:`agent/inbox/inserted` 载荷只有 {message}(无 agent);`agent/created`
 *   带 {agent}(全局可达);`session/event` 以 (session, event) 分发,入箱落盘事件
 *   `agent/inbox/spliced` 携带 inserted 消息 ⇒ agent 引用经 agent/created 登记
 *   (WeakMap<session,agent>),入箱时机经 session/event 驱动;
 * - rc.1+:inbox/inserted 载荷带回 agent ⇒ 保留该路径,双路径以
 *   `sessionId:messageId` 去重(同一消息两信号同 tick 到达)。
 *
 * 时序纪律(宿主源码实读,dsh-agent-loop):
 * - 步选择在 preStep() 开头捕获(this.model.current()),早于 agent/pre-step 瀑布;
 * - session/event 在 session.append 的 commit 内同步分发,而 commit 期间嵌套
 *   append 被宿主禁止("session append cannot reenter",dsh-session lib:1580)
 *   ⇒ 选档落盘(agent.model.select / session.append('model/selection'))必须在
 *   **微任务**里执行;入箱先于 wakeDriver 入队,wakeDriver→kick→turn 在
 *   `await this.preStep()` 处挂起,本微任务(先入队)先于其恢复 ⇒ 仍早于捕获点;
 * - `agent/request` 改 reasoningEffort 直接 throw(官方明示走 model.select)。
 *
 * 纪律:
 * - 档位表来自 `resolveModelInfo().reasoning.efforts`(内存缓存,TTL 兜底+apply 期
 *   全目录预热);未命中本轮不动(fail-neutral,审计记 cold-skip 便于观测);
 * - 仅真人输入(source.kind === 'user')评分;归属账本外会话(subagent/系统任务)
 *   store 返回 false 天然不碰;
 * - 结构类型,不 import 发布类型(access seam 纪律)。
 */
import { scoreMessage, pickEffort, decayBias } from './thinking-score.ts'
import { deriveSessionSignals, type SessionEventLike } from './thinking-context.ts'
import type { AccessAuditEvent } from './audit.ts'

/** 自动模式消费的 store 读取面(实现见 store.ts thinkingAutoOf)。 */
export interface ThinkingAutoStore {
  /** 该会话是否开启自动模式(未知会话=false:系统/subagent 会话兜底不启用)。 */
  thinkingAutoOf(sessionId: string): boolean
  /** 该会话的原始反馈偏置与写入时刻(从未反馈=undefined)。 */
  thinkingBiasOf?(sessionId: string): { readonly bias: number; readonly updatedAt: number } | undefined
}

/** llm 服务结构面(dsh-llm Context llm 子集;防御式读,响应字段按 Llm*Info 契约)。 */
export interface ThinkingAutoLlm {
  readonly listProviders: () => unknown
  readonly listModels: (provider: string) => Promise<unknown>
  readonly resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<unknown>
}

export interface ThinkingAutoDeps {
  readonly store: ThinkingAutoStore
  readonly llm: ThinkingAutoLlm
  audit(event: AccessAuditEvent): void
}

/** 事件监听注册面(plugin.ts 传 ctx.on 的 cast 包装;监听器实参按事件形态防御式读)。 */
export type ThinkingAutoOn = (
  event: string,
  listener: (...args: unknown[]) => void,
) => () => void

/** rc.1+ inbox/inserted 载荷(alpha.3 只有 message 字段,本类型字段全部可选)。 */
export interface InboxInsertedPayload {
  readonly agent?: {
    readonly session?: {
      readonly id?: unknown
      /** 会话日志尾下标(SessionLogOffset=number);用于裁剪窗口。 */
      readonly seq?: unknown
      /** 同步取窗口事件(签名 (fromSeq, toSeqExclusive);只传 from 即到尾部)。 */
      readonly snapshotEvents?: (fromSeq: number, toSeqExclusive?: number) => readonly unknown[]
    }
    readonly model?: {
      readonly current?: () => unknown
      readonly select?: (selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }) => void
    }
  }
  readonly message?: {
    readonly content?: unknown
    readonly source?: { readonly kind?: unknown }
  }
}

/** 会话/代理的结构子集(alpha.3 Session/Agent 公共面的防御式读法)。 */
interface SessionRef {
  readonly id?: unknown
  readonly requestHeader?: () => unknown
  readonly append?: (type: string, data: unknown) => unknown
  /** 会话日志尾下标(SessionLogOffset=number);用于裁剪窗口。 */
  readonly seq?: unknown
  /** 同步取窗口事件(签名 (fromSeq, toSeqExclusive);只传 from 即到尾部)。 */
  readonly snapshotEvents?: (fromSeq: number, toSeqExclusive?: number) => readonly unknown[]
}
interface ModelRef {
  readonly current?: () => unknown
  readonly select?: (selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }) => void
}
interface AgentRef {
  readonly session?: SessionRef
  readonly model?: ModelRef
}

/** 档位表缓存项;efforts 沿 adapter 排序(从小到大),只留 id 供取档。 */
interface CachedEfforts {
  readonly effortIds: readonly string[]
  readonly expiresAt: number
}

/** 缓存 TTL:profile patch 热改档位(configEditor→volatile-update)经此最终生效。 */
const EFFORTS_TTL_MS = 5 * 60_000
/** 去重表上限与条目寿命(rc.1 双路径同 tick 去重;内存有界)。 */
const DEDUP_MAX = 256
const DEDUP_TTL_MS = 60_000
/** 会话窗口上限:近 200 事件(约 3–6 轮);超长会话不放大入箱延迟(实测见文档)。 */
const WINDOW_EVENTS = 200

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 同步裁剪会话尾部窗口。`snapshotEvents(from)` 取到尾部(签名 fromSeq,toSeq 缺省=seq),
 * 只读最近 WINDOW_EVENTS 条;会话/方法缺席或异形一律空窗口(fail-neutral:
 * 空窗口=无上下文信号,退化为 V1 判档,绝不阻断)。
 */
function readSessionWindow(agent: AgentRef | undefined): readonly SessionEventLike[] {
  const session = agent?.session
  if (session === undefined) return []
  const snapshot = session.snapshotEvents
  if (typeof snapshot !== 'function') return []
  const seq = typeof session.seq === 'number' ? session.seq : undefined
  const from = seq === undefined ? undefined : Math.max(0, seq - WINDOW_EVENTS)
  try {
    const window = from === undefined ? snapshot(0) : snapshot(from)
    if (!Array.isArray(window)) return []
    return (window as readonly SessionEventLike[]).slice(-WINDOW_EVENTS)
  } catch {
    // 日志面故障=空窗口(退化为 V1 判档),不连坐本轮选档
    return []
  }
}

/** 档位上轮排名归一 [0,1](0=最低档);不在当前档位表内=undefined(不变更先验)。 */
function effortRank(effort: string | undefined, ids: readonly string[]): number | undefined {
  if (effort === undefined || ids.length === 0) return undefined
  const index = ids.indexOf(effort)
  if (index < 0) return undefined
  return ids.length === 1 ? 0 : index / (ids.length - 1)
}

/** 从消息 content 块数组抽 (text, hasAttachment);非数组/异形块防御式降级。 */
function extractMessageBody(message: { readonly content?: unknown }): { readonly text: string; readonly hasAttachment: boolean } {
  const content = message.content
  if (!Array.isArray(content)) return { text: '', hasAttachment: false }
  const parts: string[] = []
  let hasAttachment = false
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const kind = asString((block as { type?: unknown }).type)
    if (kind === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    } else if (kind !== undefined) {
      hasAttachment = true
    }
  }
  return { text: parts.join('\n'), hasAttachment }
}

/** 回退读法:最近请求头的路由配置(无 agent 登记时的 provider/model 来源)。 */
function routeFromHeader(session: SessionRef): { provider: string; model: string; reasoningEffort?: string } | undefined {
  let header: unknown
  try {
    header = session.requestHeader?.()
  } catch {
    return undefined
  }
  const config = (header as { config?: unknown } | undefined)?.config as
    | { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
    | undefined
  const provider = asString(config?.provider)
  const model = asString(config?.model)
  if (provider === undefined || model === undefined) return undefined
  const effort = asString(config?.reasoningEffort)
  return { provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
}

export function installThinkingAuto(
  deps: ThinkingAutoDeps,
  on: ThinkingAutoOn,
): () => void {
  const cache = new Map<string, CachedEfforts>()
  const agentsBySession = new WeakMap<object, AgentRef>()
  const recentKeys = new Map<string, number>()
  const warmController = new AbortController()

  const cacheKey = (provider: string, model: string): string => `${provider}\u0000${model}`

  /** 后台预热一个路由的档位表;失败静默(下轮消息重试)。 */
  const warm = (provider: string, model: string): void => {
    void deps.llm.resolveModelInfo(provider, model, warmController.signal).then((info) => {
      const efforts = (info as { reasoning?: { efforts?: unknown } }).reasoning?.efforts
      if (!Array.isArray(efforts)) return
      const effortIds = efforts.map(entry => asString((entry as { id?: unknown }).id)).filter(
        (id): id is string => id !== undefined,
      )
      if (effortIds.length === 0) return
      cache.set(cacheKey(provider, model), { effortIds, expiresAt: Date.now() + EFFORTS_TTL_MS })
    }).catch(() => { /* 预热失败=下轮未命中再试;不追审计(机会语义) */ })
  }

  /** 启动期全目录预热(尽力而为):让每轮首消息就能自动选档,而非等一次未命中。 */
  const warmCatalog = (): void => {
    void Promise.resolve().then(async () => {
      const providers = deps.llm.listProviders()
      if (!Array.isArray(providers)) return
      for (const entry of providers) {
        const provider = asString((entry as { id?: unknown; provider?: unknown }).id)
          ?? asString((entry as { provider?: unknown }).provider)
        if (provider === undefined) continue
        const models = await deps.llm.listModels(provider)
        if (!Array.isArray(models)) continue
        for (const model of models) {
          const id = asString((model as { id?: unknown }).id)
          if (id !== undefined) warm(provider, id)
        }
      }
    }).catch(() => { /* 目录面未就绪:惰性预热兜底 */ })
  }
  warmCatalog()

  /** 去重:同消息的多信号面(session/event + inbox/inserted)只处理一次。 */
  const seen = (key: string): boolean => {
    const now = Date.now()
    if (recentKeys.size > DEDUP_MAX) {
      for (const [k, at] of recentKeys) if (now - at > DEDUP_TTL_MS) recentKeys.delete(k)
      if (recentKeys.size > DEDUP_MAX) { const first = recentKeys.keys().next(); if (!first.done) recentKeys.delete(first.value) }
    }
    if (recentKeys.has(key)) return true
    recentKeys.set(key, now)
    return false
  }

  const handle = (session: unknown, message: unknown, agentHint?: AgentRef): void => {
    try {
      const sessionRef: SessionRef | undefined = typeof session === 'object' && session !== null ? session : undefined
      const messageRef: { readonly content?: unknown; readonly source?: { readonly kind?: unknown }; readonly id?: unknown } | undefined =
        typeof message === 'object' && message !== null ? message : undefined
      if (sessionRef === undefined || messageRef === undefined) return
      const sessionId = asString(sessionRef.id)
      if (sessionId === undefined) return
      const dedupKey = `${sessionId}\u0000${asString(messageRef.id) ?? ''}`
      if (seen(dedupKey)) return
      if (!deps.store.thinkingAutoOf(sessionId)) return
      if (asString(messageRef.source?.kind) !== 'user') return
      const agent = agentHint ?? agentsBySession.get(sessionRef)
      const route = (agent?.model?.current?.() as
        | { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
        | undefined) ?? routeFromHeader(sessionRef)
      const provider = asString(route?.provider)
      const model = asString(route?.model)
      if (provider === undefined || model === undefined) return

      const key = cacheKey(provider, model)
      const cached = cache.get(key)
      if (cached === undefined || cached.expiresAt <= Date.now()) {
        cache.delete(key)
        warm(provider, model)
        // fail-neutral:本轮保持现值,预热后下一轮起自动;落一条观测便于发现冷缓存
        deps.audit({
          kind: 'access.thinking.auto',
          detail: { sessionId, provider, model, stage: 'cold-skip' },
        })
        return
      }
      const body = extractMessageBody(messageRef)
      const now = Date.now()
      // 反馈偏置:读取失败按无偏置继续(不因存储故障降级判档)
      let bias = 0
      try {
        const raw = deps.store.thinkingBiasOf?.(sessionId)
        if (raw !== undefined) bias = decayBias(raw.bias, raw.updatedAt, now)
      } catch { /* fail-neutral:偏置缺失不影响本轮选档 */ }
      const derived = deriveSessionSignals(readSessionWindow(agent), now, body.text)
      const previousEffortRank = effortRank(asString(route?.reasoningEffort), cached.effortIds)
      const signals = {
        ...derived,
        bias,
        ...(previousEffortRank === undefined ? {} : { previousEffortRank }),
      }
      const score = scoreMessage({ ...body, signals })
      const effort = pickEffort(score, cached.effortIds.map(id => ({ id })))
      if (effort === undefined) return
      if (route?.reasoningEffort === effort.id) return // 同档 no-op,零事件噪音

      // 落盘在微任务:当前 tick 处于 session.append 派发中,嵌套 append 被宿主禁止;
      // 入箱先于 wakeDriver 入队,微任务仍早于 preStep 的 current() 捕获(见头注时序)。
      // 注意经 receiver 调用(model.select(...)),不得抽出方法裸调——this 会丢
      // (0.1.18 生产实证:裸调炸 recordedSelection of undefined)。
      const selection = { provider, model, reasoningEffort: effort.id }
      queueMicrotask(() => {
        try {
          const modelRef = agent?.model
          if (modelRef !== undefined && typeof modelRef.select === 'function') modelRef.select(selection)
          else if (typeof sessionRef.append === 'function') sessionRef.append('model/selection', selection)
          else return
          deps.audit({
            kind: 'access.thinking.auto',
            detail: {
              sessionId, provider, model, score, effort: effort.id, efforts: cached.effortIds.length,
              signals: {
                toolFailures: derived.toolFailureStreak,
                sameToolFailures: derived.sameToolFailureStreak,
                followUpOverlap: Number(derived.followUpOverlap.toFixed(2)),
                windowEvents: derived.windowEvents,
                recentChars: derived.recentChars,
                bias: Number(bias.toFixed(2)),
                ...(previousEffortRank === undefined ? {} : { previousEffortRank: Number(previousEffortRank.toFixed(2)) }),
              },
            },
          })
        } catch (error) {
          deps.audit({
            kind: 'access.thinking.auto',
            ok: false,
            detail: { sessionId, error: error instanceof Error ? error.message : String(error) },
          })
        }
      })
    } catch (error) {
      // 自动选档永不阻断消息入箱/步进;故障留痕(fail-neutral + 可观测)
      deps.audit({
        kind: 'access.thinking.auto',
        ok: false,
        detail: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  // 信号面 1(alpha.3 主路径):入箱落盘事件 agent/inbox/spliced,session 一手可得
  const offSessionEvent = on('session/event', (...args: unknown[]) => {
    const session = args[0]
    const event = args[1] as { type?: unknown; data?: unknown } | undefined
    if ((typeof event?.type === 'string' ? event.type : '') !== 'agent/inbox/spliced') return
    const inserted = (event?.data as { inserted?: unknown } | undefined)?.inserted
    if (!Array.isArray(inserted)) return
    for (const message of inserted) handle(session, message)
  })

  // 信号面 2(rc.1+ 兼容):inbox/inserted 载荷带 agent;alpha.3 无 agent 字段自然短路
  const offInboxInserted = on('agent/inbox/inserted', (...args: unknown[]) => {
    const payload = args[0] as InboxInsertedPayload | undefined
    const agent = payload?.agent
    if (agent === undefined || agent.session === undefined) return
    handle(agent.session, payload?.message, agent)
  })

  // agent 登记表:agent/created 全局载荷带 {agent}(alpha.3 实测),登记 session→agent
  const offAgentCreated = on('agent/created', (...args: unknown[]) => {
    const agent = (args[0] as { agent?: AgentRef } | undefined)?.agent
    const session = agent?.session
    if (agent === undefined || session === undefined) return
    agentsBySession.set(session, agent)
  })

  return () => {
    warmController.abort()
    offSessionEvent()
    offInboxInserted()
    offAgentCreated()
  }
}
