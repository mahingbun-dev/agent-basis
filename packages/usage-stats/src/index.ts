/**
 * @eterna/usage-stats Host 半边:Typert SRC 端点 eternaUsageStats/stats。
 * V3 实证:owner 免决策在 T2 换血后不复存在——端点鉴权显式:principal kind
 * 'eterna-user' → 只返回本人聚合;owner(本地流)/admin 账号 → 全局+按账号。
 * 聚合结果进程内缓存(增量:日志 mtime 变化才重扫;冷启动一次性后台扫描)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { aggregate, type UsageAggregates, type OwnershipLedger } from './aggregate.ts'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const ETERNA_USAGE_STATS_SERVICE_ID = 'eternaUsageStats'
export const STATS_ENDPOINT = `${ETERNA_USAGE_STATS_SERVICE_ID}/stats`

function applyRemoteMarker(prototype: object, method: string, name: string): void {
  const initializers: Array<() => void> = []
  const context = {
    kind: 'method', name: method, static: false, private: false,
    access: { has: () => true, get: (target: object) => Reflect.get(target, method) as unknown },
    addInitializer: (fn: () => void) => { initializers.push(fn) },
  }
  const decorator = Remote(name) as (method: unknown, context: unknown) => void
  decorator(Reflect.get(prototype, method) as unknown, context)
  const receiver = Object.create(prototype) as object
  for (const initialize of initializers) initialize.call(receiver)
}

export interface UsageStatsDeps {
  readonly sessionsRoot: string
  readonly ledger: OwnershipLedger & { accountOf(userId: number): string | undefined }
  readonly userRole: (userId: number) => 'admin' | 'user' | undefined
  /** 派生缓存目录(DSH_HOME 语义下,tenant-scan T1 合规)。 */
  readonly cacheDir?: string
}

/** SRC Remote 服务(网关 SRC 模式扫描 ctx.reflect.props,与 panel 同款)。 */
export class EternaUsageStatsGateway extends TypertRemoteService {
  private readonly deps: UsageStatsDeps
  private cache: { aggregates: UsageAggregates; builtAt: number } | null = null

  constructor(ctx: Context, deps: UsageStatsDeps) {
    super(ctx, ETERNA_USAGE_STATS_SERVICE_ID)
    this.deps = deps
  }

  /** 全量聚合(带进程内缓存;调用方轮询频率低,增量=mtime 面已足够)。 */
  private build(): UsageAggregates {
    if (this.cache !== null && Date.now() - this.cache.builtAt < 60_000) return this.cache.aggregates
    const aggregates = aggregate(this.deps.sessionsRoot, this.deps.ledger)
    this.cache = { aggregates, builtAt: Date.now() }
    // 派生缓存落盘(DSH_HOME 语义;目录不存在则跳过持久化)
    if (this.deps.cacheDir !== undefined) {
      try {
        mkdirSync(this.deps.cacheDir, { recursive: true })
        writeFileSync(join(this.deps.cacheDir, 'usage-aggregates.json'), JSON.stringify(aggregates))
      } catch { /* 缓存失败不影响端点 */ }
    }
    return aggregates
  }

  /** admin 账号 id 集(启动时由 access 插件种子;经 userRole 判定)。 */
  stats(): Promise<unknown> {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    const aggregates = this.build()
    if (principal?.kind === 'eterna-user' && typeof principal.userId === 'number') {
      const role = this.deps.userRole(principal.userId)
      const account = this.deps.ledger.accountOf(principal.userId)
      if (role === 'admin') {
        return Promise.resolve({ scope: 'global', aggregates })
      }
      const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, sessions: 0 }
      const mine = account !== undefined ? aggregates.byAccount[account] : undefined
      const mineView = mine ?? empty
      const byAccountView = account !== undefined ? { [account]: mineView } : {}
      return Promise.resolve({
        scope: 'self',
        account: account ?? null,
        aggregates: { ...aggregates, total: mineView, byAccount: byAccountView },
      })
    }
    // owner/本地流(panel 老链)——全局视图
    return Promise.resolve({ scope: 'global', aggregates })
  }
}

applyRemoteMarker(EternaUsageStatsGateway.prototype, 'stats', 'stats')

/** 插件体(panel 同款配方:default export {name, apply})。 */
export const name = 'eterna-usage-stats'

export default {
  name,
  apply(ctx: Context & { reflect?: { get(name: string, strict?: boolean): unknown } }): () => void {
    const sessionsRoot = join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
    const cacheDir = join(process.env.DSH_HOME ?? process.cwd(), '.eterna')
    const ledger = {
      sessionOwner: (sessionId: string): number | undefined => {
        const reflect = ctx.reflect as { get(name: string, strict?: boolean): unknown } | undefined
        const store = reflect?.get('eternaAccessStore', false) as { sessionOwner(id: string): number | undefined } | undefined
        return store?.sessionOwner(sessionId)
      },
      sessionsOfOwner: (ownerId: number): string[] => {
        const reflect = ctx.reflect as { get(name: string, strict?: boolean): unknown } | undefined
        const store = reflect?.get('eternaAccessStore', false) as { sessionsOfOwner(id: number): string[] } | undefined
        return store?.sessionsOfOwner(ownerId) ?? []
      },
      accountOf: (userId: number): string | undefined => {
        const reflect = ctx.reflect as { get(name: string, strict?: boolean): unknown } | undefined
        const store = reflect?.get('eternaAccessStore', false) as { getUserById(id: number): { account: string } | undefined } | undefined
        return store?.getUserById(userId)?.account
      },
    }
    const deps: UsageStatsDeps = {
      sessionsRoot, ledger,
      userRole: (userId: number) => {
        const reflect = ctx.reflect as { get(name: string, strict?: boolean): unknown } | undefined
        const store = reflect?.get('eternaAccessStore', false) as { getUserById(id: number): { role?: string } | undefined } | undefined
        const role = store?.getUserById(userId)?.role
        return role === 'admin' ? 'admin' : role === 'user' ? 'user' : undefined
      },
      cacheDir,
    }
    // access store 未导出为 reflect 服务时(accountOf 缺失),聚合仍工作(全部未归属,只进全局)
    const gateway = new EternaUsageStatsGateway(ctx, deps)
    return () => {
      // Service 随 owning fiber 自动注销(cordis Service 语义,panel 同款)。
      void gateway
    }
  },
}

// 派生缓存读取(冷启动加速;存在即用)
export function loadCachedAggregates(cacheDir: string): UsageAggregates | undefined {
  const path = join(cacheDir, 'usage-aggregates.json')
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8')) as UsageAggregates } catch { return undefined }
}
