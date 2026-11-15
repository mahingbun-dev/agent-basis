/**
 * @eterna/memory Host 半边:设置分区「记忆」与域识别 chip 的 SRC 端点。
 * (M-M3 T12-①/②/③,19 号 §5-T12;形态照抄 packages/compaction/src/admin-plugin.ts。)
 *
 * 挂载位置(2026-11-12 生产走查结论,compaction admin 同款):**宿主层 insert 行**
 * ——api-gateway 的 SRC 发现只解析宿主可达的 reflect;profile 模板里挂
 * `- id: eterna-memory-admin, name: '@eterna/memory/admin-plugin'`。
 *
 * 数据面(与引擎的耦合只有 overrides 文件 + sqlite 只读连接 + glue 会话域面):
 * - state():生效配置(overrides 文件热改键叠加基线)+ 观测统计(sqlite 只读数);
 *   写入策略档位/画像/域开关的真实生效在 glue memory-plugin(每次写入/装配现读
 *   同一 overrides 文件,热生效,compaction 文件桥同款);
 * - updateConfig():防御校验后合并写 overrides 文件(.eterna/memory.config.json);
 * - domains():domain_registry 只读清单(域浏览/域 chip 数据面);
 * - sessionDomain()/selectDomain():会话域读取与切换(写 domain_registry
 *   last_used + 会话域 override,19 号 §5-T12.3「切换=写 last_used + 当前索引域
 *   更新」)——转发 glue memory-plugin 提供的 'eternaMemorySession' 会话域面,
 *   域键合法性(必须已转正注册)由该面校验。
 *
 * 鉴权(对齐 compaction/panel 现行口径):state/updateConfig 是租户配置面,
 * admin 专属(eterna-user 流通道查 access store 必须 admin;owner Peer 放行);
 * domains/sessionDomain/selectDomain 是会话 UI 数据面(能经网关到达必已过
 * access 守卫),不另设 admin 闸——切换域只影响当前会话的索引上下文,非敏感面。
 *
 * strip-only 纪律:全文件禁用参数属性。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  memoryOverridesDirForDb, memoryOverridesPathForDb, parseMemoryOverrides, readMemoryOverridesFile, resolveEffectiveFlags,
} from './config-bridge.ts'
import type { MemoryOverrides } from './config-bridge.ts'

export const ETERNA_MEMORY_SERVICE_ID = 'eternaMemory'

/** 端点字符串(客户端 connection.rpc.call('/api', …) 的 endpoint 段)。 */
export const MEMORY_STATE_ENDPOINT = `${ETERNA_MEMORY_SERVICE_ID}/state`
export const MEMORY_UPDATE_ENDPOINT = `${ETERNA_MEMORY_SERVICE_ID}/updateConfig`
export const MEMORY_DOMAINS_ENDPOINT = `${ETERNA_MEMORY_SERVICE_ID}/domains`
export const MEMORY_SESSION_DOMAIN_ENDPOINT = `${ETERNA_MEMORY_SERVICE_ID}/sessionDomain`
export const MEMORY_SELECT_DOMAIN_ENDPOINT = `${ETERNA_MEMORY_SERVICE_ID}/selectDomain`

/** glue memory-plugin 提供的会话域面服务名(记忆包与 glue 的字面量互为真值)。 */
export const ETERNA_MEMORY_SESSION_SERVICE_ID = 'eternaMemorySession'

/** 会话域面的结构消费面(glue wireDomainContext 增广;结构子集,鸭子一致)。 */
export interface MemorySessionDomainFace {
  /** 会话当前绑定域(bound 才返回;候选期/未解析/无域=undefined)。 */
  readonly domainOf: (sessionId: string) => string | undefined
  /** 当前域视图(供 chip 展示:自动解析/人工切换/无域)。 */
  readonly sessionDomainView: (sessionId: string) => { domainKey: string | null; overridden: boolean }
  /** 切换会话域(已注册域键;null=清除 override 回自动)。非法域键抛 RangeError。 */
  readonly overrideDomain: (sessionId: string, domainKey: string | null) => { domainKey: string | null }
  /** 已转正注册域清单(域 chip 列表;与 domain_registry 同源)。 */
  readonly listRegisteredDomains: () => readonly { domainKey: string; label: string }[]
}

/** 域清单条目(domains 端点与面板域浏览共用)。 */
export interface MemoryDomainView {
  readonly domainKey: string
  readonly label: string
  readonly source: string
  /** 转正时刻(epoch ms);null=候选中(未转正域不进域 chip 列表)。 */
  readonly registered: number | null
  readonly sessionCount: number
  readonly memoryCount: number
  readonly lastUsedAt: number | null
  /** 该域待审记忆条数(域浏览「待审」列;pending 且未失效)。 */
  readonly pendingCount: number
}

export interface MemoryStateView {
  ok: true
  viewer: 'admin'
  config: {
    portraitEnabled: boolean
    domainEnabled: boolean
    writePolicy: string
  }
  stats: {
    entityCount: number
    pendingCount: number
    domainCount: number
  }
}

export interface MemoryStateError {
  ok: false
  code: 'forbidden' | 'unauthorized' | 'invalid' | 'unavailable'
  message: string
}

export interface MemoryDomainsView {
  ok: true
  domains: readonly MemoryDomainView[]
}

/** 会话域视图(sessionDomain 端点;domainKey=null=该会话无绑定域)。 */
export interface MemorySessionDomainView {
  ok: true
  domainKey: string | null
  /** 是否人工切换中(override 生效;false=自动解析)。 */
  overridden: boolean
}

export interface MemorySelectDomainView {
  ok: true
  domainKey: string | null
  overridden: boolean
}

/** sqlite 只读数(state 统计与域清单共用;库缺席/表缺失一律 0,不炸面板)。 */
function countQuery(db: DatabaseSync, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { c?: unknown } | undefined
    return typeof row?.c === 'number' ? row.c : 0
  } catch {
    return 0
  }
}

/** 统计面:有效实体/待审/注册域三数(与 panel snapshot 同口径;pending 不算生效)。 */
export function memoryStatsOf(dbPath: string): { entityCount: number; pendingCount: number; domainCount: number } {
  if (!existsSync(dbPath)) return { entityCount: 0, pendingCount: 0, domainCount: 0 }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return { entityCount: 0, pendingCount: 0, domainCount: 0 }
  }
  try {
    const entityCount = countQuery(
      db,
      "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'",
    )
    const pendingCount = countQuery(
      db,
      "SELECT COUNT(*) AS c FROM memory_entity WHERE review_state = 'pending' AND invalid_at IS NULL",
    )
    const domainCount = countQuery(db, 'SELECT COUNT(*) AS c FROM domain_registry WHERE registered IS NOT NULL')
    return { entityCount, pendingCount, domainCount }
  } finally {
    db.close()
  }
}

/** 域清单只读投影(转正+候选全列;待审数逐域计数)。 */
export function listDomainViews(dbPath: string): readonly MemoryDomainView[] {
  if (!existsSync(dbPath)) return []
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return []
  }
  try {
    let rows: unknown[] = []
    try {
      rows = db.prepare(
        'SELECT domain_key, label, source, registered, session_count, memory_count, last_used_at'
        + ' FROM domain_registry ORDER BY COALESCE(last_used_at, created_at) DESC, domain_key ASC',
      ).all()
    } catch {
      return [] // domain_registry 表缺失(旧库):无域
    }
    const pendingByDomain = new Map<string, number>()
    try {
      const pendingRows = db.prepare(
        'SELECT domain_key, COUNT(*) AS c FROM memory_entity'
        + " WHERE review_state = 'pending' AND invalid_at IS NULL AND domain_key IS NOT NULL"
        + ' GROUP BY domain_key',
      ).all() as unknown[]
      for (const row of pendingRows) {
        const record = row as { domain_key?: unknown; c?: unknown }
        if (typeof record.domain_key === 'string' && typeof record.c === 'number') {
          pendingByDomain.set(record.domain_key, record.c)
        }
      }
    } catch {
      // memory_entity 无 review_state 列(旧库):待审数留 0
    }
    const views: MemoryDomainView[] = []
    for (const row of rows) {
      const record = row as {
        domain_key?: unknown
        label?: unknown
        source?: unknown
        registered?: unknown
        session_count?: unknown
        memory_count?: unknown
        last_used_at?: unknown
      }
      if (typeof record.domain_key !== 'string' || typeof record.label !== 'string') continue
      views.push({
        domainKey: record.domain_key,
        label: record.label,
        source: typeof record.source === 'string' ? record.source : 'free',
        registered: typeof record.registered === 'number' ? record.registered : null,
        sessionCount: typeof record.session_count === 'number' ? record.session_count : 0,
        memoryCount: typeof record.memory_count === 'number' ? record.memory_count : 0,
        lastUsedAt: typeof record.last_used_at === 'number' ? record.last_used_at : null,
        pendingCount: pendingByDomain.get(record.domain_key) ?? 0,
      })
    }
    return views
  } finally {
    db.close()
  }
}

/** 手工施加 @Remote 装饰器(panel/compaction 同款;Node 24 type-stripping 不解析装饰器糖)。 */
function applyRemoteMarker(prototype: object, method: string, name: string): void {
  const initializers: Array<() => void> = []
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: { has: () => true, get: (target: object) => Reflect.get(target, method) as unknown },
    addInitializer: (fn: () => void) => { initializers.push(fn) },
  }
  const decorator = Remote(name) as (method: unknown, context: unknown) => void
  decorator(Reflect.get(prototype, method) as unknown, context)
  const receiver = Object.create(prototype) as object
  for (const initialize of initializers) initialize.call(receiver)
}

/** 网关依赖(sqlite 路径 + 会话域面读取器;测试可注入假面)。 */
export interface MemoryGatewayDeps {
  /** memory.sqlite3 路径(统计面只读数 + overrides 文件桥同源派生,config-bridge 唯一真值)。 */
  readonly dbPath: string
  /** 会话域面(glue memory-plugin provide 'eternaMemorySession';缺席=域 UI 降级)。 */
  readonly sessionDomainFace?: () => MemorySessionDomainFace | undefined
}

function defaultSessionDomainFace(ctx: Context): () => MemorySessionDomainFace | undefined {
  return () => {
    try {
      return ctx.get(ETERNA_MEMORY_SESSION_SERVICE_ID) as MemorySessionDomainFace | undefined
    } catch {
      return undefined
    }
  }
}

/** 设置分区「记忆」+ 域识别 chip 的 SRC 网关(Typert Remote 端点 eternaMemory/*)。 */
export class EternaMemoryGateway extends TypertRemoteService {
  private readonly deps: MemoryGatewayDeps

  constructor(ctx: Context, deps: MemoryGatewayDeps) {
    super(ctx, ETERNA_MEMORY_SERVICE_ID)
    this.deps = { ...deps, sessionDomainFace: deps.sessionDomainFace ?? defaultSessionDomainFace(ctx) }
  }

  /**
   * overrides 文件根目录(config-bridge 唯一真值,dbPath 派生:与 deps.dbPath 的
   * memory.sqlite3 **同目录**,glue memory-plugin 热读同款函数——缺省布局两端落
   * workspace 的 .eterna/)。
   */
  private overridesRoot(): string {
    return memoryOverridesDirForDb(this.deps.dbPath)
  }

  /** overrides 文件全路径(state 读与 updateConfig 写共用)。 */
  private overridesPath(): string {
    return memoryOverridesPathForDb(this.deps.dbPath)
  }

  /** 读存量 overrides(文件缺席/损坏 fail-open 为空表——热改键回落基线,不炸端点)。 */
  private readMemoryOverrides(): MemoryOverrides {
    return readMemoryOverridesFile(this.overridesPath())
  }

  /** 管理面放行判定(compaction admin-plugin adminAllowed 同款;eterna-user 流通道须 admin)。 */
  private adminAllowed(): boolean {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') return true
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as { getUserById(id: number): { role?: string } | undefined } | undefined
    return store?.getUserById(principal.userId)?.role === 'admin'
  }

  /** 会话域面(defensive get;缺席/未就绪/形状不符 → undefined,端点回 unavailable)。 */
  private sessionFace(): MemorySessionDomainFace | undefined {
    const resolve = this.deps.sessionDomainFace
    if (resolve === undefined) return undefined
    try {
      return resolve()
    } catch {
      return undefined
    }
  }

  state(): MemoryStateView | MemoryStateError {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    const flags = resolveEffectiveFlags(this.readMemoryOverrides())
    return {
      ok: true,
      viewer: 'admin',
      config: {
        portraitEnabled: flags.portraitEnabled,
        domainEnabled: flags.domainEnabled,
        writePolicy: flags.writePolicy,
      },
      stats: memoryStatsOf(this.deps.dbPath),
    }
  }

  updateConfig(payload: unknown): MemoryStateView | MemoryStateError {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const parsed = parseMemoryOverrides(payload)
    if ('error' in parsed) {
      return { ok: false, code: 'invalid', message: parsed.error }
    }
    const merged: MemoryOverrides = { ...this.readMemoryOverrides(), ...parsed }
    try {
      mkdirSync(this.overridesRoot(), { recursive: true })
      writeFileSync(this.overridesPath(), JSON.stringify(merged))
    } catch {
      // 持久化失败则本次不生效(state 如实反映存量;compaction 同款不隐瞒)
      return { ok: false, code: 'unavailable', message: '配置写入失败(.eterna 目录不可写)' }
    }
    return this.state()
  }

  domains(): MemoryDomainsView | MemoryStateError {
    return { ok: true, domains: listDomainViews(this.deps.dbPath) }
  }

  sessionDomain(payload: unknown): MemorySessionDomainView | MemoryStateError {
    const sessionId = sessionArgOf(payload)
    if (sessionId === null) {
      return { ok: false, code: 'invalid', message: 'sessionId 必须是非空字符串' }
    }
    const face = this.sessionFace()
    if (face === undefined) {
      return { ok: false, code: 'unavailable', message: '会话域服务未挂载(eterna-memory 域识别未启用)' }
    }
    try {
      const view = face.sessionDomainView(sessionId)
      return { ok: true, domainKey: view.domainKey, overridden: view.overridden }
    } catch (error) {
      return { ok: false, code: 'unavailable', message: `会话域读取失败:${error instanceof Error ? error.message : String(error)}` }
    }
  }

  selectDomain(payload: unknown): MemorySelectDomainView | MemoryStateError {
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const input = payload as Record<string, unknown>
    const sessionId = typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
    if (sessionId === null) {
      return { ok: false, code: 'invalid', message: 'sessionId 必须是非空字符串' }
    }
    if (input.domainKey !== null && (typeof input.domainKey !== 'string' || input.domainKey.length === 0)) {
      return { ok: false, code: 'invalid', message: 'domainKey 必须是非空字符串或 null(清除切换)' }
    }
    const face = this.sessionFace()
    if (face === undefined) {
      return { ok: false, code: 'unavailable', message: '会话域服务未挂载(eterna-memory 域识别未启用)' }
    }
    try {
      // 域键合法性(必须已注册)由面校验:非法抛 RangeError → invalid。
      face.overrideDomain(sessionId, input.domainKey)
      const view = face.sessionDomainView(sessionId)
      return { ok: true, domainKey: view.domainKey, overridden: view.overridden }
    } catch (error) {
      return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

/** sessionDomain 载荷防御收窄({ args: { sessionId } } 的命名参数形态)。 */
function sessionArgOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const input = payload as Record<string, unknown>
  return typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
}

applyRemoteMarker(EternaMemoryGateway.prototype, 'state', 'state')
applyRemoteMarker(EternaMemoryGateway.prototype, 'updateConfig', 'updateConfig')
applyRemoteMarker(EternaMemoryGateway.prototype, 'domains', 'domains')
applyRemoteMarker(EternaMemoryGateway.prototype, 'sessionDomain', 'sessionDomain')
applyRemoteMarker(EternaMemoryGateway.prototype, 'selectDomain', 'selectDomain')

/**
 * 插件体:宿主层挂载(compaction admin 同款)。dbPath 与 glue memory-plugin 的
 * 缺省约定一致(cwd/.eterna/memory.sqlite3),overrides 文件桥与统计面同源派生
 * (config-bridge 唯一真值)——profile patch 自定义 dbPath 时需同步部署配置;
 * 现阶段部署两者都用缺省。
 */
export const name = 'eterna-memory-admin'

export function apply(ctx: Context): () => void {
  const dbPath = join(process.cwd(), '.eterna', 'memory.sqlite3')
  const gateway = new EternaMemoryGateway(ctx, { dbPath })
  return () => {
    void gateway
  }
}
