/**
 * @eterna/compaction Host 半边:压缩策略设置端点(设置弹窗分区「上下文压缩」的数据面)。
 *
 * 挂载位置(2026-11-12 生产走查修正):**宿主层 insert 行**。原因有二,均实证:
 * 1. api-gateway 的 SRC 发现只解析宿主可达的 reflect——组内(隔离 realm)发布的
 *    端点在网关侧 404(usage-stats/panel/prompt-studio 端点全在宿主层,同因);
 * 2. 预设服务不达宿主树——宿主注入 'compaction' 恒 pending(boot 日志
 *    `waiting for service: compaction` 实证),引擎实例跨不过 realm。
 * 因此本端点不持有引擎,改走**文件桥**(DSH_HOME 语义,多租户铁律合规):
 * - 引擎侧(basic,组内):压力评估前按 mtime 热应用 overrides 文件,并把生效
 *   配置落 state 文件——见 basic/index.ts `_applyOverridesFromFile/_persistStateFile`;
 * - 本端点:state() 读 state 文件(生效真值)+ overrides 文件;updateConfig 用
 *   包内纯函数 resolveConfig 对「基线+存量覆盖+本次输入」整体校验,通过才落
 *   overrides 文件,引擎下一次压力评估即热生效。
 * - 统计:扫描 $DSH_HOME/sessions/**\/session.v4.jsonl.zstd 的 compaction/summary|prune
 *   事件(与 packages/usage-stats/src/aggregate.ts 同套多帧 zstd 解码算法),60s 缓存。
 *   2026-11-13 C9(22 号 §4)扩展:invalidSummaryCount(compaction/end.error 带
 *   `invalid-summary:` 前缀,C3 约定)、stalePruneCount/staleSavedTokens(L2 占位符
 *   与相邻 shadow-price 事件配对)、rapidRefillCount/lastRapidRefillAt(C7,state
 *   文件合并)、summarization 目标(C8b 落值后由引擎写入 state 文件,缺省=跟随会话模型)。
 * - 鉴权(对齐产品现行口径,tenant.ts:483-487 同款):SRC 端点走 unary 持 owner
 *   Peer——mux 换血的 eterna-user principal 只存在于流通道(mux.ts:8-12),unary
 *   能达本端点必已过 access 守卫,视为可信管理面放行;eterna-user principal
 *   (流通道)则查 access store 必须是 admin。压缩配置与聚合统计不构成租户敏感面。
 *
 * strip-only 纪律:全文件禁用参数属性。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { resolveConfig } from './basic/config.ts'
import { STALE_PRUNE_MARKER } from './stale/config.ts'

export const ETERNA_COMPACTION_SERVICE_ID = 'eternaCompaction'

/** 引擎侧可热更新的键(与设置分区表单一一对应;其余键仍由 profile patch 拥有)。 */
export interface CompactionOverrides {
  auto?: boolean
  thresholdRatio?: number
  retainRatio?: number
}

/**
 * 事件扫描面统计(同一遍 zstd 扫描得出;不含 state 文件的熔断计数)。
 */
export interface CompactionEventStats {
  summaryCount: number
  pruneCount: number
  shadowedTokenCount: number
  lastCompactedAt: string | null
  /** C3 结构校验拒绝的摘要尝试数(compaction/end.error 带 `invalid-summary:` 前缀)。 */
  invalidSummaryCount: number
  /** L2 陈旧清理替换数(占位符标记 + 相邻 shadow-price 事件配对判定)。 */
  stalePruneCount: number
  /** L2 陈旧清理回收的原文估价合计(配对 prune 事件 shadowedTokenCount 求和)。 */
  staleSavedTokens: number
}

/** C7 rapid-refill 熔断计数(state 文件写时快照;进程重启从 0 起算)。 */
export interface RapidRefillStats {
  rapidRefillCount: number
  lastRapidRefillAt: string | null
}

export interface CompactionStats extends CompactionEventStats, RapidRefillStats {}

/** 专属摘要模型视图;provider/model 之一缺席即视为未配置(跟随会话模型)。 */
export interface SummarizationTargetView {
  provider: string | null
  model: string | null
}

/** 最近压缩 checkpoint(M-C4 视图数据行;compaction/summary 事件投影)。 */
export interface RecentCheckpoint {
  /** 事件时间(ms epoch;缺席 null)。 */
  at: number | null
  /** 归属会话(session 文件父目录名)。 */
  session: string
  shadowedTokenCount: number
  provider: string
  model: string
  /** 摘要纯文本(8 段全文,text block join,截 400 字)。 */
  summary: string
}

export interface CompactionCheckpointsView {
  ok: true
  checkpoints: RecentCheckpoint[]
}

export type CompactionCheckpointsError = { ok: false; code: 'forbidden' | 'unauthorized'; message: string }

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
    /** 专属摘要模型(state 文件就绪后非空;C8b 落值前恒为 null 对)。 */
    summarization: SummarizationTargetView
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
  stats: CompactionEventStats
}

/** 60s 进程内缓存;低频设置页轮询无需增量索引。 */
let statsCache: StatsCache | null = null

/** 最近一条 compaction/prune 的配对面(shadow-price 事件,与替换事件同步相邻落盘)。 */
interface PendingShadowPrune {
  shadowedTokenCount: number
  shadowedSeqs: readonly number[]
}

/** 扫描面关注的事件载荷与表面操作字段(行级 JSON 的结构面)。 */
interface ScannedEvent {
  type?: string
  time?: number
  data?: {
    shadowedTokenCount?: number
    shadowedSeqs?: unknown
    error?: unknown
    message?: { content?: unknown }
    /** compaction/summary 专属(M-C4 视图):摘要块与路由模型。 */
    summary?: unknown
    provider?: unknown
    model?: unknown
  }
  surfaceOp?: { op?: unknown; startSeq?: unknown }
}

/** stale 占位符判定:消息内容恰为单个 STALE_PRUNE_MARKER 文本块。 */
function isStalePlaceholder(event: ScannedEvent): boolean {
  const content = event.data?.message?.content
  if (!Array.isArray(content) || content.length !== 1) return false
  const block = content[0] as { type?: unknown; text?: unknown } | undefined
  return block?.type === 'text' && block.text === STALE_PRUNE_MARKER
}

/**
 * 同一遍 zstd 扫描统计全部压缩观测面。stale 配对规则:stale 落盘时
 * shadow-price 事件与占位符替换同步相邻(dsh append 串行),且替换的
 * surfaceOp.startSeq 必须落在该 prune 的 shadowedSeqs 内——两条件同时成立才
 * 计入,防止工具原文恰好回显占位符文案的误配;日志无 surfaceOp 字段时退化为
 * 仅相邻性判定。
 */
export function scanCompactionStats(sessionsRoot: string): CompactionEventStats {
  if (statsCache !== null && Date.now() - statsCache.builtAt < 60_000) return statsCache.stats
  const stats: CompactionEventStats = {
    summaryCount: 0, pruneCount: 0, shadowedTokenCount: 0, lastCompactedAt: null,
    invalidSummaryCount: 0, stalePruneCount: 0, staleSavedTokens: 0,
  }
  let lastTime = 0
  for (const file of collectSessionFiles(sessionsRoot)) {
    let text: string
    try {
      text = decodeSessionLog(readFileSync(file))
    } catch {
      continue
    }
    let lastPrune: PendingShadowPrune | null = null
    let lastLineWasPrune = false
    for (const line of text.split('\n')) {
      // 快路径:只解析 compaction/* 与可能携带 stale 占位符的行(占位符文案
      // 无 JSON 转义字符,逐字出现在行内)。
      const isCompactionLine = line.includes('compaction/')
      if (!isCompactionLine && !line.includes(STALE_PRUNE_MARKER)) {
        lastLineWasPrune = false
        continue
      }
      let event: ScannedEvent
      try {
        event = JSON.parse(line) as ScannedEvent
      } catch {
        continue
      }
      if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
        const shadowed = event.data?.shadowedTokenCount
        if (event.type === 'compaction/summary') {
          stats.summaryCount += 1
          lastLineWasPrune = false
        } else {
          stats.pruneCount += 1
          lastPrune = {
            shadowedTokenCount: typeof shadowed === 'number' ? shadowed : 0,
            shadowedSeqs: Array.isArray(event.data?.shadowedSeqs) ? event.data.shadowedSeqs as number[] : [],
          }
          lastLineWasPrune = true
        }
        stats.shadowedTokenCount += typeof shadowed === 'number' ? shadowed : 0
        if (typeof event.time === 'number' && event.time > lastTime) lastTime = event.time
        continue
      }
      if (event.type === 'compaction/end') {
        if (typeof event.data?.error === 'string' && event.data.error.includes('invalid-summary:')) {
          stats.invalidSummaryCount += 1
        }
        lastLineWasPrune = false
        continue
      }
      if (event.type === 'tool/result' && isStalePlaceholder(event) && lastPrune !== null && lastLineWasPrune) {
        const startSeq = event.surfaceOp?.startSeq
        if (typeof startSeq !== 'number' || lastPrune.shadowedSeqs.includes(startSeq)) {
          stats.stalePruneCount += 1
          stats.staleSavedTokens += lastPrune.shadowedTokenCount
        }
      }
      lastLineWasPrune = false
    }
  }
  stats.lastCompactedAt = lastTime > 0 ? new Date(lastTime).toISOString() : null
  statsCache = { builtAt: Date.now(), stats }
  return stats
}

/**
 * 最近压缩 checkpoint 列表(M-C4 视图数据面;独立扫描不走 stats 缓存——列表要
 * 新鲜,且解码成本与 stats 共享同量级)。跨会话收集 compaction/summary 事件,
 * 按时间降序取前 limit 条;无时间的排尾部。
 */
export function scanRecentCheckpoints(sessionsRoot: string, limit = 8): RecentCheckpoint[] {
  const rows: RecentCheckpoint[] = []
  for (const file of collectSessionFiles(sessionsRoot)) {
    let text: string
    try {
      text = decodeSessionLog(readFileSync(file))
    } catch {
      continue
    }
    const session = basename(dirname(file))
    for (const line of text.split('\n')) {
      if (!line.includes('compaction/summary')) continue
      let event: ScannedEvent
      try {
        event = JSON.parse(line) as ScannedEvent
      } catch {
        continue
      }
      if (event.type !== 'compaction/summary') continue
      const shadowed = event.data?.shadowedTokenCount
      const blocks = Array.isArray(event.data?.summary) ? event.data.summary as Array<{ type?: string; text?: string }> : []
      const summaryText = blocks
        .map(block => typeof block.text === 'string' ? block.text : '')
        .join('\n')
        .slice(0, 400)
      const provider = event.data?.provider
      const model = event.data?.model
      rows.push({
        at: typeof event.time === 'number' ? event.time : null,
        session,
        shadowedTokenCount: typeof shadowed === 'number' ? shadowed : 0,
        provider: typeof provider === 'string' ? provider : '',
        model: typeof model === 'string' ? model : '',
        summary: summaryText,
      })
    }
  }
  return rows
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit)
}

/** 缓存失效(测试与写入路径共用;updateConfig 后统计随之重扫)。 */
export function resetStatsCache(): void {
  statsCache = null
}

// ── 文件桥(state=引擎落的生效真值;overrides=设置分区覆盖键) ──

function statePath(): string {
  return join(process.env.DSH_HOME ?? process.cwd(), '.eterna', 'compaction.state.json')
}

function overridesPath(): string {
  return join(process.env.DSH_HOME ?? process.cwd(), '.eterna', 'compaction.config.json')
}

interface ConfigBaseline {
  auto: boolean
  thresholdRatio: number
  retainRatio: number
  headroomTokens: number
  maxTokens: number
  compactionRetries: number
  maxOverflowRetries: number
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function readOverrides(): CompactionOverrides {
  const parsed = readJson(overridesPath())
  const out: CompactionOverrides = {}
  if (parsed === undefined) return out
  if (typeof parsed.auto === 'boolean') out.auto = parsed.auto
  if (typeof parsed.thresholdRatio === 'number' && Number.isFinite(parsed.thresholdRatio)) out.thresholdRatio = parsed.thresholdRatio
  if (typeof parsed.retainRatio === 'number' && Number.isFinite(parsed.retainRatio)) out.retainRatio = parsed.retainRatio
  return out
}

/**
 * C7 熔断计数(state 文件的写时快照)。state 文件缺席或字段类型异常时回退
 * 0 与 null——观测面绝不因读失败而不可用。
 */
export function readRapidRefillStats(): RapidRefillStats {
  const state = readJson(statePath())
  if (state === undefined) return { rapidRefillCount: 0, lastRapidRefillAt: null }
  const count = state.rapidRefillCount
  const at = state.lastRapidRefillAt
  return {
    rapidRefillCount: typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : 0,
    lastRapidRefillAt: typeof at === 'string' && at.length > 0 ? at : null,
  }
}

/**
 * 专属摘要模型(state 文件就绪后由引擎写入;C8b 落值前文件无该键 → null 对,
 * 客户端按"跟随会话模型"兜底展示)。
 */
export function readSummarizationTarget(): SummarizationTargetView {
  const state = readJson(statePath())
  const pick = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null
  return { provider: pick(state?.summarizationProvider), model: pick(state?.summarizationModel) }
}

/** 生效配置视图:state 文件(引擎落的真值)为基线,再叠加存量覆盖键。 */
function readEffectiveConfig(): ConfigBaseline {
  const state = readJson(statePath())
  const defaults: ConfigBaseline = {
    auto: true, thresholdRatio: 0.8, retainRatio: 0.16,
    headroomTokens: 65_536, maxTokens: 65_536, compactionRetries: 1, maxOverflowRetries: 1,
  }
  const baseline: ConfigBaseline = state === undefined ? defaults : {
    auto: typeof state.auto === 'boolean' ? state.auto : defaults.auto,
    thresholdRatio: typeof state.thresholdRatio === 'number' ? state.thresholdRatio : defaults.thresholdRatio,
    retainRatio: typeof state.retainRatio === 'number' ? state.retainRatio : defaults.retainRatio,
    headroomTokens: typeof state.headroomTokens === 'number' ? state.headroomTokens : defaults.headroomTokens,
    maxTokens: typeof state.maxTokens === 'number' ? state.maxTokens : defaults.maxTokens,
    compactionRetries: typeof state.compactionRetries === 'number' ? state.compactionRetries : defaults.compactionRetries,
    maxOverflowRetries: typeof state.maxOverflowRetries === 'number' ? state.maxOverflowRetries : defaults.maxOverflowRetries,
  }
  const overrides = readOverrides()
  return {
    ...baseline,
    ...(overrides.auto !== undefined ? { auto: overrides.auto } : {}),
    ...(overrides.thresholdRatio !== undefined ? { thresholdRatio: overrides.thresholdRatio } : {}),
    ...(overrides.retainRatio !== undefined ? { retainRatio: overrides.retainRatio } : {}),
  }
}

// ── SRC 网关(usage-stats 同款配方) ──

interface AccessStoreView {
  getUserById(id: number): { role?: string } | undefined
}

interface CompactionGatewayDeps {
  readonly sessionsRoot: string
}

export class EternaCompactionGateway extends TypertRemoteService {
  private readonly deps: CompactionGatewayDeps

  constructor(ctx: Context, deps: CompactionGatewayDeps) {
    super(ctx, ETERNA_COMPACTION_SERVICE_ID)
    this.deps = deps
  }

  /**
   * 管理面放行判定(对齐 tenant.ts:483-487 现行口径):
   * - principal 缺失或非 eterna-user = owner Peer(unary/本地流)——能达本端点必已过
   *   access 守卫,放行;
   * - eterna-user principal(流通道)→ 查 access store 必须是 admin。
   */
  private adminAllowed(): boolean {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') return true
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as AccessStoreView | undefined
    return store?.getUserById(principal.userId)?.role === 'admin'
  }

  state(): CompactionStateView | CompactionStateError {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    const config = readEffectiveConfig()
    return {
      ok: true,
      viewer: 'admin',
      config: {
        auto: config.auto,
        thresholdRatio: config.thresholdRatio,
        retainRatio: config.retainRatio,
        headroomTokens: config.headroomTokens,
        maxTokens: config.maxTokens,
        compactionRetries: config.compactionRetries,
        maxOverflowRetries: config.maxOverflowRetries,
        summarization: readSummarizationTarget(),
      },
      // C9:事件扫描统计与 state 文件熔断计数合并汇出。
      stats: { ...scanCompactionStats(this.deps.sessionsRoot), ...readRapidRefillStats() },
    }
  }

  /** 最近压缩 checkpoint 列表(M-C4 视图;管理员可见,压缩可审计的产品面)。 */
  recentCheckpoints(payload: unknown): CompactionCheckpointsView | CompactionCheckpointsError {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    const input = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
    const rawLimit = input.limit
    const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 50
      ? rawLimit
      : 8
    return { ok: true, checkpoints: scanRecentCheckpoints(this.deps.sessionsRoot, limit) }
  }

  updateConfig(payload: unknown): CompactionStateView | CompactionStateError {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const input = payload as Record<string, unknown>
    const inputOverrides: CompactionOverrides = {}
    if (input.auto !== undefined) {
      if (typeof input.auto !== 'boolean') return { ok: false, code: 'invalid', message: 'auto 必须是布尔值' }
      inputOverrides.auto = input.auto
    }
    for (const key of ['thresholdRatio', 'retainRatio'] as const) {
      const value = input[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
        return { ok: false, code: 'invalid', message: `${key} 必须是 (0, 1] 内的数值` }
      }
      if (key === 'thresholdRatio') inputOverrides.thresholdRatio = value
      else inputOverrides.retainRatio = value
    }
    // 整体校验:基线(引擎生效真值)+ 存量覆盖 + 本次输入,过 resolveConfig 全量
    // 重解析——非法组合(如 retainRatio ≥ thresholdRatio)在这里被拒;引擎侧
    // 兜底回退基线(见 basic/_applyOverridesFromFile),绝不落半生效状态。
    const baseline = readEffectiveConfig()
    try {
      resolveConfig({ ...baseline, ...readOverrides(), ...inputOverrides })
    } catch (error: unknown) {
      return { ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }
    }
    const merged: CompactionOverrides = { ...readOverrides(), ...inputOverrides }
    try {
      mkdirSync(join(process.env.DSH_HOME ?? process.cwd(), '.eterna'), { recursive: true })
      writeFileSync(overridesPath(), JSON.stringify(merged))
    } catch { /* 持久化失败则本次不生效,state 仍如实反映现状 */ }
    resetStatsCache()
    return this.state()
  }
}

applyRemoteMarker(EternaCompactionGateway.prototype, 'state', 'state')
applyRemoteMarker(EternaCompactionGateway.prototype, 'updateConfig', 'updateConfig')
applyRemoteMarker(EternaCompactionGateway.prototype, 'recentCheckpoints', 'recentCheckpoints')

/**
 * 插件体:宿主层挂载(2026-11-12 生产走查修正)。
 * SRC 端点必须在宿主层发布——api-gateway 的 SRC 发现只解析宿主可达的 reflect,
 * 组内(隔离 realm)发布的端点在网关侧 404。本端点不持有引擎(预设服务不达宿主
 * 树,注入 'compaction' 恒 pending),与引擎的耦合只有 overrides/state 两个文件。
 */
export const name = 'eterna-compaction-admin'

export function apply(ctx: Context): () => void {
  const sessionsRoot = join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
  const gateway = new EternaCompactionGateway(ctx, { sessionsRoot })
  return () => {
    void gateway
  }
}
