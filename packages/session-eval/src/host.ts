/**
 * @eterna/session-eval Host 装配:把 {@link SessionEvalService} 接到宿主会话面,
 * 并以 `ctx.provide('eternaSessionEval', …)` 暴露给 access 守卫路由。
 *
 * ## 为什么装配在这里、路由在 access
 * 铁律 T2(`packctl tenant-scan` CI 强制):插件不得自注册 Web 路由/数据端点。
 * 数据面(读会话事件快照)只能由本包提供,HTTP 面只能由 eterna-access 登记
 * (`/access/api/session-eval/*`)。两端靠**结构面**相遇:本包 provide 普通对象,
 * access 用 `ctx.reflect.get('eternaSessionEval', false)` 现读(adviser 同款),
 * 两个包互不 import。
 *
 * ## 为什么不订阅 session/event
 * P0 是只读投影:画面板时现读宿主内存里的事件快照即可。订阅会引入第二份状态
 * (装载顺序、回放、内存增长),而 P0 不需要实时推送 —— 面板自带刷新,且每一次
 * 刷新都是一次纯投影,结果只取决于事件数组本身。P1 引入评分库与队列时再谈订阅。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionEvalService, type SessionEvalPorts } from './service.ts'
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

/**
 * 装配服务并 provide 成 `ctx.eternaSessionEval`。
 * @param ctx - 插件上下文.
 * @returns disposer(注销 provide).
 */
export function mountSessionEval(ctx: Context): () => void {
  const service = new SessionEvalService(createHostPorts(ctx))
  const provide = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
  if (typeof provide !== 'function') return () => {}
  return provide.call(ctx, SESSION_EVAL_SERVICE_ID, service)
}
