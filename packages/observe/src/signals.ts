/**
 * evolve_signal 信号存储(sqlite,node:sqlite 内置,零外部依赖)。
 *
 * 表形态对齐设计文档 10 §2:
 *   evolve_signal { id, ts, pack_id, session_id?, kind, ref, payload: { summary, tags[], trajectory_hash? } }
 * kind ∈ feedback_low | approval_modified | approval_rejected | eval_fail | drift | audit_scan;
 * ref 指向来源(feedback 事件 / approval/decided 事件 / aievo 任务行 / 指标快照)。
 *
 * 去重契约(reflector 的输入纪律,设计 10 §3「聚合去重」):
 * - (kind, ref) 唯一 —— 同一来源事件/任务行/快照重复入队幂等(INSERT ... ON CONFLICT DO NOTHING),
 *   重放(feedback 版本 churn、网关重试)不产生重复信号;
 * - trajectory_hash 单列 + 索引 —— reflector 按 trajectory_hash 聚类同一失败模式
 *   (clusterByTrajectory,minCount 即「同一错误 ≥N 次才立项」的重复度统计)。
 *
 * Cordis 纪律:
 * - effect 配逆闭包 —— 构造(开库)的逆是 close()(关库,幂等);信号本身是 append-only 审计数据,
 *   永不静默物理删(对齐 09 §6 账本与 10 §6 的可回滚证据链语义);
 * - coeffect 全声明 —— 只触碰构造时给定的 sqlite 文件(或 ':memory:'),无旁路全局;
 * - provide 可交换 —— 组合层以注册表 + OBSERVE_SERVICE_ID 唯一 ID provide(index.ts)。
 */
import { DatabaseSync } from 'node:sqlite'
import { isRecord } from './types.ts'
import type {
  EvolveSignal, SessionEventLike, SignalEnqueueResult, SignalInput, SignalKind, SignalPayload,
  SignalQuery, TrajectoryCluster,
} from './types.ts'

export type { SignalQuery, TrajectoryCluster } from './types.ts'

/** sqlite 文件路径或 ':memory:'。 */
export type SignalStorePath = string

/** 未知对象行 → EvolveSignal 的解码错误(库被外部写坏时上抛,不静默)。 */
export class SignalDecodeError extends Error {
  constructor(readonly rowId: number, cause: string) {
    super(`[observe] evolve_signal#${rowId} 解码失败:${cause}`)
    this.name = 'SignalDecodeError'
  }
}

const SIGNAL_KINDS_SQL: string = [
  'feedback_low',
  'approval_modified',
  'approval_rejected',
  'eval_fail',
  'drift',
  'audit_scan',
]
  .map(kind => `'${kind}'`)
  .join(',')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS evolve_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  pack_id TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (${SIGNAL_KINDS_SQL})),
  ref TEXT NOT NULL,
  payload TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  trajectory_hash TEXT,
  UNIQUE (kind, ref)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_evolve_signal_ts ON evolve_signal (ts);
CREATE INDEX IF NOT EXISTS idx_evolve_signal_trajectory ON evolve_signal (trajectory_hash);
CREATE INDEX IF NOT EXISTS idx_evolve_signal_pack_kind ON evolve_signal (pack_id, kind);
`

const CLUSTER_SQL = `
SELECT trajectory_hash AS hash,
       COUNT(*) AS n,
       GROUP_CONCAT(DISTINCT kind) AS kinds,
       GROUP_CONCAT(ref, char(10)) AS refs,
       MIN(ts) AS first_ts,
       MAX(ts) AS last_ts
FROM evolve_signal
WHERE trajectory_hash IS NOT NULL
`

/**
 * evolve_signal 存取门。
 * 预编译语句随实例缓存;所有方法同步(node:sqlite 同步 API,单进程写入模型,与 DSH storage 同族)。
 */
export class SignalStore {
  readonly #db: DatabaseSync
  readonly #insert: ReturnType<DatabaseSync['prepare']>
  readonly #getById: ReturnType<DatabaseSync['prepare']>
  readonly #getByKindRef: ReturnType<DatabaseSync['prepare']>
  readonly #now: () => number
  #closed = false

  constructor(path: SignalStorePath, options: { readonly now?: () => number } = {}) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(SCHEMA)
    this.#insert = this.#db.prepare(
      'INSERT INTO evolve_signal (ts, pack_id, session_id, kind, ref, payload, tags, trajectory_hash) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (kind, ref) DO NOTHING',
    )
    this.#getById = this.#db.prepare('SELECT * FROM evolve_signal WHERE id = ?')
    this.#getByKindRef = this.#db.prepare('SELECT * FROM evolve_signal WHERE kind = ? AND ref = ?')
    this.#now = options.now ?? (() => Date.now())
  }

  /** 是否已关库(close 的幂等性由 closed 暴露)。 */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * 入队一条信号(带 (kind, ref) 去重):
   * - 新增 → 写入,返回 reason 'enqueued';
   * - 重复 → 不写,返回既有信号与 reason 'duplicate'(幂等重放)。
   * payload.summary 必须非空(审计语义:每条信号必须人读可述),tags 必须全字符串。
   */
  enqueue(input: SignalInput): SignalEnqueueResult {
    if (typeof input.payload.summary !== 'string' || input.payload.summary.length === 0) {
      throw new TypeError('[observe] evolve_signal.payload.summary 必须是非空字符串')
    }
    if (input.payload.tags.some(tag => typeof tag !== 'string')) {
      throw new TypeError('[observe] evolve_signal.payload.tags 必须全是字符串')
    }
    this.#assertOpen()
    const ts = input.ts ?? this.#now()
    const result = this.#insert.run(
      ts,
      input.packId,
      input.sessionId ?? null,
      input.kind,
      input.ref,
      JSON.stringify(input.payload),
      JSON.stringify([...input.payload.tags]),
      input.payload.trajectoryHash ?? null,
    )
    if (result.changes === 0n || result.changes === 0) {
      const row = this.#getByKindRef.get(input.kind, input.ref)
      if (row === undefined) {
        throw new Error(`[observe] (kind=${input.kind}, ref=${input.ref}) 冲突但读不回既有行`)
      }
      return { signal: decodeRow(row), reason: 'duplicate' }
    }
    return {
      signal: {
        id: Number(result.lastInsertRowid),
        ts,
        packId: input.packId,
        ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
        kind: input.kind,
        ref: input.ref,
        payload: input.payload,
      },
      reason: 'enqueued',
    }
  }

  /** 读单条(按存储 id)。 */
  get(id: number): EvolveSignal | undefined {
    this.#assertOpen()
    const row = this.#getById.get(id)
    return row === undefined ? undefined : decodeRow(row)
  }

  /** 条件查询(ts 升序,limit 默认 1000)。 */
  list(query: SignalQuery = {}): readonly EvolveSignal[] {
    this.#assertOpen()
    const { where, params } = buildWhere(query)
    const rows = this.#db
      .prepare(`SELECT * FROM evolve_signal ${where} ORDER BY ts ASC, id ASC LIMIT ?`)
      .all(...params, query.limit ?? 1000)
    return rows.map(row => decodeRow(row))
  }

  /** 条件计数。 */
  count(query: SignalQuery = {}): number {
    this.#assertOpen()
    const { where, params } = buildWhere(query)
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM evolve_signal ${where}`).get(...params)
    return Number(row?.['n'] ?? 0)
  }

  /**
   * 按 trajectory_hash 聚类(reflector 入口,设计 10 §3):
   * 返回 count >= minCount 的簇(按 count 降序),供「同一 (模式, 根因) ≥ repeatThreshold 才立项」判断。
   */
  clusterByTrajectory(
    options: { readonly since?: number; readonly minCount?: number } = {},
  ): readonly TrajectoryCluster[] {
    this.#assertOpen()
    const minCount = options.minCount ?? 1
    const rows = options.since === undefined
      ? this.#db.prepare(`${CLUSTER_SQL} GROUP BY trajectory_hash`).all()
      : this.#db.prepare(`${CLUSTER_SQL} AND ts >= ? GROUP BY trajectory_hash`).all(options.since)
    return rows
      .map(row => decodeCluster(row))
      .filter(cluster => cluster.count >= minCount)
      .sort((a, b) => b.count - a.count)
  }

  /** 关库(构造的逆 effect;幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[observe] SignalStore 已 close,不可再操作')
  }
}

function buildWhere(query: SignalQuery): { where: string; params: (string | number)[] } {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (query.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(query.kind)
  }
  if (query.packId !== undefined) {
    clauses.push('pack_id = ?')
    params.push(query.packId)
  }
  if (query.sessionId !== undefined) {
    clauses.push('session_id = ?')
    params.push(query.sessionId)
  }
  if (query.tag !== undefined) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)')
    params.push(query.tag)
  }
  if (query.trajectoryHash !== undefined) {
    clauses.push('trajectory_hash = ?')
    params.push(query.trajectoryHash)
  }
  if (query.since !== undefined) {
    clauses.push('ts >= ?')
    params.push(query.since)
  }
  return { where: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params }
}

function decodeRow(row: Record<string, unknown>): EvolveSignal {
  const id = Number(row['id'])
  let payload: unknown
  try {
    payload = JSON.parse(asString(row['payload']))
  } catch {
    throw new SignalDecodeError(id, 'payload 不是合法 JSON')
  }
  if (!isRecord(payload)) throw new SignalDecodeError(id, 'payload 不是 JSON object')
  const summary = payload['summary']
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new SignalDecodeError(id, 'payload.summary 缺失')
  }
  const tags = payload['tags']
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new SignalDecodeError(id, 'payload.tags 不是字符串数组')
  }
  const sessionIdRaw = row['session_id']
  const trajectoryHash = payload['trajectoryHash']
  const normalized: SignalPayload = {
    summary,
    tags: [...(tags as string[])],
    ...(typeof trajectoryHash === 'string' && trajectoryHash.length > 0 && { trajectoryHash }),
    ...extrasOf(payload),
  }
  return {
    id,
    ts: Number(row['ts']),
    packId: asString(row['pack_id']),
    ...(typeof sessionIdRaw === 'string' && { sessionId: sessionIdRaw }),
    kind: asString(row['kind']) as SignalKind,
    ref: asString(row['ref']),
    payload: normalized,
  }
}

/** payload 自由扩展字段(rating/score/breach 明细等)原样透传(summary/tags/trajectoryHash 之外)。 */
function extrasOf(payload: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const key of Object.keys(payload)) {
    if (key === 'summary' || key === 'tags' || key === 'trajectoryHash') continue
    extras[key] = payload[key]
  }
  return extras
}

function decodeCluster(row: Record<string, unknown>): TrajectoryCluster {
  return {
    trajectoryHash: asString(row['hash']),
    count: Number(row['n']),
    kinds: asString(row['kinds']).split(',').filter(kind => kind.length > 0) as SignalKind[],
    refs: asString(row['refs']).split('\n').filter(ref => ref.length > 0),
    firstTs: Number(row['first_ts']),
    lastTs: Number(row['last_ts']),
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * approval 负信号桥(内核事件 → 信号)。
 * 事件形态(dsh-repo packages/interaction/user-approval/src/types.ts:46-61,经模块增强进 SessionEventMap):
 * - 'approval/asked'   { id, toolName, callId?, reason? }
 * - 'approval/decided' { id, outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' }
 * 内核只有显式拒绝;approval_modified(用户改产出=隐含差评)由 interact 插件比对 deliverables 后
 * 直接 store.enqueue(设计 09 §1 S2),不经内核事件。
 */
export function enqueueApprovalSignal(
  store: SignalStore,
  event: SessionEventLike,
  packId: string,
): SignalEnqueueResult {
  if (event.type !== 'approval/decided' || !isRecord(event.data)) {
    return { signal: null, reason: 'ignored' }
  }
  if (event.data['outcome'] !== 'rejected') {
    return { signal: null, reason: 'ignored' }
  }
  const ref = `approval:${asString(event.data['id'])}`
  return store.enqueue({
    packId,
    kind: 'approval_rejected',
    ref,
    payload: { summary: `审批被拒:${ref}`, tags: ['approval', 'decision:rejected'] },
  })
}
