/**
 * 思考强度自动模式——宿主路由器(2026-11-18):
 * 监听 `agent/inbox/inserted`(消息入箱,dsh-agent-loop lib/index.js:200 同步 emit,
 * 早于 wakeDriver → preStep 的 `model.current()` 捕获),对开启自动模式的会话在
 * 每轮用户消息入箱时同步调 `agent.model.select({provider, model, reasoningEffort})`
 * ——本轮第一步即生效;宿主 installModelSelection 对「仅 effort 变化」不插
 * model-switch 提示语,select 同档原子 no-op,不产生事件噪音。
 *
 * 为什么不是别的钩子:
 * - `agent/request` 改 reasoningEffort 直接 throw(dsh-agent runtime-types.d.ts:
 *   "use agent.model.select() before step preparation");
 * - `agent/pre-step` 时选择已捕获,只能影响下一步,首轮第一步够不着。
 *
 * 纪律:
 * - 监听体**全同步**(任何 await 之前完成 select)——emit 分发不回等 promise,
 *   异步决策会输掉与驱动唤醒的竞态;
 * - 档位表来自 `resolveModelInfo().reasoning.efforts`(内存缓存,TTL 兜底)。
 *   未命中**本轮不动**(fail-neutral:保持现值=adapter 默认行为),同时后台预热;
 * - 只对真人输入评分(source.kind === 'user');提问桥/model-selection notice 等
 *   系统源跳过;归属账本外的会话(subagent/系统任务)store 返回 false 天然不碰;
 * - 结构类型,不 import 发布类型(access seam 纪律,plugin.ts 头注同源)。
 */
import { scoreMessage, pickEffort } from './thinking-score.ts'
import type { AccessAuditEvent } from './audit.ts'

/** 自动模式消费的 store 读取面(实现见 store.ts thinkingAutoOf)。 */
export interface ThinkingAutoStore {
  /** 该会话是否开启自动模式(未知会话=false:系统/subagent 会话兜底不启用)。 */
  thinkingAutoOf(sessionId: string): boolean
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

/** 入箱事件载荷的结构子集(dsh-agent agent/inbox/inserted: {agent, message})。 */
export interface InboxInsertedPayload {
  readonly agent?: {
    readonly session?: { readonly id?: unknown }
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

/** 档位表缓存项;efforts 沿 adapter 排序(从小到大),只留 id 供取档。 */
interface CachedEfforts {
  readonly effortIds: readonly string[]
  readonly expiresAt: number
}

/** 缓存 TTL:profile patch 热改档位(configEditor→volatile-update)经此最终生效。 */
const EFFORTS_TTL_MS = 5 * 60_000

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 从消息 content 块数组抽 (text, hasAttachment);非数组/异形块防御式降级。 */
function extractMessageBody(content: unknown): { readonly text: string; readonly hasAttachment: boolean } {
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

export function installThinkingAuto(
  deps: ThinkingAutoDeps,
  /** 注册回调(plugin.ts 传入 ctx.on 的 cast 包装,与 approval/question 桥同构)。 */
  on: (event: string, listener: (payload: InboxInsertedPayload) => void) => () => void,
): () => void {
  const cache = new Map<string, CachedEfforts>()
  const warmController = new AbortController()

  const cacheKey = (provider: string, model: string): string => `${provider}\u0000${model}`

  /** 后台预热一个路由的档位表;失败静默(下轮消息重试,审计不追预热)。 */
  const warm = (provider: string, model: string): void => {
    void deps.llm.resolveModelInfo(provider, model, warmController.signal).then((info) => {
      const efforts = (info as { reasoning?: { efforts?: unknown } }).reasoning?.efforts
      if (!Array.isArray(efforts)) return
      const effortIds = efforts.map(entry => asString((entry as { id?: unknown }).id)).filter(
        (id): id is string => id !== undefined,
      )
      if (effortIds.length === 0) return
      cache.set(cacheKey(provider, model), { effortIds, expiresAt: Date.now() + EFFORTS_TTL_MS })
    }).catch(() => { /* 预热失败=下轮未命中再试;不追审计(与 llm-doctor 机会语义同源) */ })
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

  const listener = (payload: InboxInsertedPayload): void => {
    try {
      const sessionId = asString(payload.agent?.session?.id)
      if (sessionId === undefined) return
      if (!deps.store.thinkingAutoOf(sessionId)) return
      if (asString(payload.message?.source?.kind) !== 'user') return
      const select = payload.agent?.model?.select
      if (typeof select !== 'function') return
      const selection = payload.agent?.model?.current?.() as
        | { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
        | undefined
      const provider = asString(selection?.provider)
      const model = asString(selection?.model)
      if (provider === undefined || model === undefined) return

      const key = cacheKey(provider, model)
      const cached = cache.get(key)
      if (cached === undefined || cached.expiresAt <= Date.now()) {
        cache.delete(key)
        warm(provider, model)
        return // fail-neutral:本轮保持现值,预热后下一轮起自动
      }
      const body = extractMessageBody(payload.message?.content)
      const score = scoreMessage(body)
      const effort = pickEffort(score, cached.effortIds.map(id => ({ id })))
      if (effort === undefined) return
      if (selection?.reasoningEffort === effort.id) return // 同档 no-op,零事件噪音
      select({ provider, model, reasoningEffort: effort.id })
      deps.audit({
        kind: 'access.thinking.auto',
        detail: { sessionId, provider, model, score, effort: effort.id, efforts: cached.effortIds.length },
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

  const off = on('agent/inbox/inserted', listener)
  return () => {
    warmController.abort()
    off()
  }
}
