/**
 * @eterna/compaction Host 半边:压缩策略设置端点(设置弹窗分区「上下文压缩」的数据面)。
 *
 * - 状态可读:扫描 $DSH_HOME/sessions/**\/session.v4.jsonl.zstd 里的
 *   compaction/summary|prune 事件(与 packages/usage-stats/src/aggregate.ts 同一套
 *   多帧 zstd 逐帧魔数解码算法;此处只挑压缩事件行,不做全量事件解析),
 *   60s 进程内缓存,低频轮询足够。
 * - 阈值可调:engine.updateConfig 热更新(同 realm 内 inject ['compaction']),
 *   覆盖键持久化到 $DSH_HOME/.eterna/compaction.config.json,重启后于 apply 时
 *   重新套用——持久化在 DSH_HOME 语义下(多租户铁律 §1.1,tenant-scan 合规)。
 * - 鉴权:principal kind 'eterna-user' 且 access store 判定 admin 才可读写;
 *   全局统计跨租户,不对普通用户开放(比 usage-stats 的 self 裁剪更收紧)。
 *
 * strip-only 纪律:全文件禁用参数属性(见 basic/config.ts TargetPressureConfigError 注)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { BasicCompactionEngine } from './basic/index.ts'

export const ETERNA_COMPACTION_SERVICE_ID = 'eternaCompaction'

/** 引擎侧可热更新的键(与设置分区表单一一对应;其余键仍由 profile patch 拥有)。 */
export interface CompactionOverrides {
  auto?: boolean
  thresholdRatio?: number
  retainRatio?: number
}

export interface CompactionStats {
  summaryCount: number
  pruneCount: number
  shadowedTokenCount: number
  lastCompactedAt: string | null
}

export interface CompactionStateView {
  ok: true
  viewer: 'admin'
  config: {
    auto: boolean
    thresholdRatio: number
    retainRatio: number
    headroomTokens: number
    maxTokens: number
    compactionRetries: number
    maxOverflowRetries: number
  }
  stats: CompactionStats
}

export interface CompactionStateError {
  ok: false
  code: 'forbidden' | 'unauthorized' | 'invalid'
  message: string
}

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

// ── 会话日志压缩事件扫描(多帧 zstd;算法与 usage-stats/aggregate.ts 同源) ──

const ZSTD_MAGIC = 4247762216

function decodeSessionLog(buffer: Buffer): string {
  let out = ''
  for (let offset = 0; offset < buffer.length - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) continue
    try {
      out += zstdDecompressSync(buffer.subarray(offset)).toString('utf8')
    } catch { /* 非帧起点或截断帧:跳过 */ }
  }
  return out
}

function collectSessionFiles(root: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectSessionFiles(path, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(path)
  }
  return out
}

interface StatsCache {
  builtAt: number
  stats: CompactionStats
}

/** 60s 进程内缓存;低频设置页轮询无需增量索引。 */
let statsCache: StatsCache | null = null

function scanCompactionStats(sessionsRoot: string): CompactionStats {
  if (statsCache !== null && Date.now() - statsCache.builtAt < 60_000) return statsCache.stats
  const stats: CompactionStats = {
    summaryCount: 0, pruneCount: 0, shadowedTokenCount: 0, lastCompactedAt: null,
  }
  let lastTime = 0
  for (const file of collectSessionFiles(sessionsRoot)) {
    let text: string
    try {
      text = decodeSessionLog(readFileSync(file))
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.includes('compaction/')) continue
      let event: { type?: string; time?: number; data?: { shadowedTokenCount?: number } }
      try {
        event = JSON.parse(line) as typeof event
      } catch {
        continue
      }
      const shadowed = event.data?.shadowedTokenCount
      if (event.type === 'compaction/summary') {
        stats.summaryCount += 1
        stats.shadowedTokenCount += typeof shadowed === 'number' ? shadowed : 0
        if (typeof event.time === 'number' && event.time > lastTime) lastTime = event.time
      } else if (event.type === 'compaction/prune') {
        stats.pruneCount += 1
        stats.shadowedTokenCount += typeof shadowed === 'number' ? shadowed : 0
        if (typeof event.time === 'number' && event.time > lastTime) lastTime = event.time
      }
    }
  }
  stats.lastCompactedAt = lastTime > 0 ? new Date(lastTime).toISOString() : null
  statsCache = { builtAt: Date.now(), stats }
  return stats
}

function resetStatsCache(): void {
  statsCache = null
}

// ── 覆盖键持久化(DSH_HOME 语义) ──

function overridesPath(): string {
  return join(process.env.DSH_HOME ?? process.cwd(), '.eterna', 'compaction.config.json')
}

function loadOverrides(): CompactionOverrides {
  const path = overridesPath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CompactionOverrides
    const out: CompactionOverrides = {}
    if (typeof parsed.auto === 'boolean') out.auto = parsed.auto
    if (typeof parsed.thresholdRatio === 'number' && Number.isFinite(parsed.thresholdRatio)) out.thresholdRatio = parsed.thresholdRatio
    if (typeof parsed.retainRatio === 'number' && Number.isFinite(parsed.retainRatio)) out.retainRatio = parsed.retainRatio
    return out
  } catch {
    return {}
  }
}

function persistOverrides(overrides: CompactionOverrides): void {
  try {
    mkdirSync(join(process.env.DSH_HOME ?? process.cwd(), '.eterna'), { recursive: true })
    writeFileSync(overridesPath(), JSON.stringify(overrides))
  } catch { /* 持久化失败不阻断热更新;下次启动回退 patch 配置 */ }
}

// ── SRC 网关(usage-stats 同款配方) ──

interface AccessStoreView {
  getUserById(id: number): { role?: string } | undefined
}

interface CompactionGatewayDeps {
  readonly engine: BasicCompactionEngine
  readonly sessionsRoot: string
}

export class EternaCompactionGateway extends TypertRemoteService {
  private readonly deps: CompactionGatewayDeps

  constructor(ctx: Context, deps: CompactionGatewayDeps) {
    super(ctx, ETERNA_COMPACTION_SERVICE_ID)
    this.deps = deps
  }

  /** 当前登录者是否 admin(principal → access store role)。 */
  private adminRole(): 'admin' | undefined {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal?.kind !== 'eterna-user' || typeof principal.userId !== 'number') return undefined
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as AccessStoreView | undefined
    return store?.getUserById(principal.userId)?.role === 'admin' ? 'admin' : undefined
  }

  state(): CompactionStateView | CompactionStateError {
    if (this.adminRole() !== 'admin') {
      const invocation = (this.ctx as { invocation?: { principal?: { kind?: string } } } | undefined)?.invocation
      const code: CompactionStateError['code'] = invocation?.principal?.kind === 'eterna-user' ? 'forbidden' : 'unauthorized'
      return { ok: false, code, message: code === 'forbidden' ? '需要管理员权限' : '请先登录' }
    }
    const c = this.deps.engine.config
    return {
      ok: true,
      viewer: 'admin',
      config: {
        auto: c.auto,
        thresholdRatio: c.thresholdRatio,
        // ResolvedRetention 二选一(retainTokens 显式配置时 retainRatio 为空);
        // 本产品 patch 只走 ratio,此处 0.16 仅为类型占位,不参与热更新解析。
        retainRatio: c.retainRatio ?? 0.16,
        headroomTokens: c.headroomTokens,
        maxTokens: c.maxTokens,
        compactionRetries: c.compactionRetries,
        maxOverflowRetries: c.maxOverflowRetries,
      },
      stats: scanCompactionStats(this.deps.sessionsRoot),
    }
  }

  updateConfig(payload: unknown): CompactionStateView | CompactionStateError {
    if (this.adminRole() !== 'admin') {
      const invocation = (this.ctx as { invocation?: { principal?: { kind?: string } } } | undefined)?.invocation
      const code: CompactionStateError['code'] = invocation?.principal?.kind === 'eterna-user' ? 'forbidden' : 'unauthorized'
      return { ok: false, code, message: code === 'forbidden' ? '需要管理员权限' : '请先登录' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const input = payload as Record<string, unknown>
    const overrides: CompactionOverrides = { ...loadOverrides() }
    if (input.auto !== undefined) {
      if (typeof input.auto !== 'boolean') return { ok: false, code: 'invalid', message: 'auto 必须是布尔值' }
      overrides.auto = input.auto
    }
    for (const key of ['thresholdRatio', 'retainRatio'] as const) {
      const value = input[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
        return { ok: false, code: 'invalid', message: `${key} 必须是 (0, 1] 内的数值` }
      }
      if (key === 'thresholdRatio') overrides.thresholdRatio = value
      else overrides.retainRatio = value
    }
    let config
    try {
      config = this.deps.engine.updateConfig(overrides)
    } catch (error: unknown) {
      return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
    }
    persistOverrides(overrides)
    resetStatsCache()
    void config
    return this.state()
  }
}

applyRemoteMarker(EternaCompactionGateway.prototype, 'state', 'state')
applyRemoteMarker(EternaCompactionGateway.prototype, 'updateConfig', 'updateConfig')

/** 插件体(usage-stats 同款配方:default export {name, apply};consume 同 realm 的 compaction)。 */
export const name = 'eterna-compaction-admin'
export const inject = ['compaction']

/** 插件体:组内行与 command-compact 同构(纯命名导出 name/inject/apply,不带 default)。 */
export function apply(ctx: Context): () => void {
  // 类型面上 cordis 声明合并把 compaction 视为必有;运行时仍可能因装载顺序缺席
  // (上游同 key 缺 provider 时),故走可选视图守卫,缺席时降级为不挂载端点。
  const engine = (ctx as unknown as { compaction?: BasicCompactionEngine }).compaction
  if (engine === undefined) {
    ctx.logger.warn('eterna-compaction-admin: compaction 服务缺席,设置端点不挂载')
    return () => {}
  }
  // 重启后套用持久化覆盖键(失败仅告警,不阻断 boot)。
  const overrides = loadOverrides()
  if (Object.keys(overrides).length > 0) {
    try {
      engine.updateConfig(overrides)
    } catch (error: unknown) {
      ctx.logger.warn(`eterna-compaction-admin: 持久化配置套用失败,沿用 patch 配置: ${
        error instanceof Error ? error.message : String(error)}`)
    }
  }
  const sessionsRoot = join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
  const gateway = new EternaCompactionGateway(ctx, { engine, sessionsRoot })
  return () => {
    void gateway
  }
}
