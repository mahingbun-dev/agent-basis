/**
 * 进化账本(sqlite,node:sqlite;设计 10 §6)。
 *
 * 一切进化动作落一条 lineage 记录,可回答「为什么改、谁批的、验没验过、效果如何、怎么回滚」:
 *   proposal(提案 delta)→ verification(G0/G1/G2 报告)→ release(版本/tag/审批人)
 *   → effect(发布后 T+7d 效果回填);supersession/回滚是状态迁移,不是删除。
 *
 * status 流转(fail-closed,非法迁移直接抛错):
 *   proposed → verified → approved → released → superseded | rolled_back
 *   (verified/approved 也可直接 superseded —— 提案被更好提案取代;rolled_back 只能来自 released)
 *
 * Cordis 纪律:构造(开库)的逆是 close();append-only,记录永不物理删(审计证据链);
 * 只触碰构造时给定的 sqlite 路径;组合层以 EVOLVE_SERVICE_ID provide(index.ts)。
 */
import { DatabaseSync } from 'node:sqlite'

/** 账本对象种类(设计 10 §6 kind: skill|knowledge|rule|memory)。 */
export type LedgerKind = 'skill' | 'knowledge' | 'rule' | 'memory'

/** 账本状态(proposed→verified→approved→released→superseded|rolled_back)。 */
export type LedgerStatus = 'proposed' | 'verified' | 'approved' | 'released' | 'superseded' | 'rolled_back'

/** 验证报告(G0/G1/G2 + 安全探针;10 §6 verification)。 */
export interface VerificationReport {
  /** G0 packctl lint 报告引用(report.md 路径或 findings 摘要)。 */
  readonly g0: { readonly pass: boolean; readonly detail: string }
  /** G1 本地 replay 门禁。 */
  readonly g1: { readonly pass: boolean; readonly detail: string }
  /** G2 ai-evo 三层门禁(exit_code 语义:0 通过/1 不达标/2 平台错误;skipped=降级跳过)。 */
  readonly g2: { readonly pass: boolean; readonly detail: string; readonly skipped?: boolean }
  /** 安全回归探针(投毒/越权/注入;任一退化即红)。 */
  readonly probe: 'pass' | 'fail' | 'not-run'
}

/** 发布记录(10 §6 release)。 */
export interface ReleaseRecord {
  readonly fromVersion: string
  readonly toVersion: string
  readonly tag: string
  readonly approver: string
}

/** 效果回填(10 §6 effect;发布后 T+7d before/after 对比)。 */
export interface EffectRecord {
  readonly beforeMetrics: Readonly<Record<string, number>>
  readonly afterMetrics: Readonly<Record<string, number>>
  readonly reviewedAt: string
}

/** 一条账本记录(存储行解码后的完整形态)。 */
export interface LedgerRecord {
  readonly id: number
  readonly ts: number
  readonly pack: string
  readonly kind: LedgerKind
  /** 触发信号 id 列表(observe evolve_signal 的 id;血缘起点)。 */
  readonly signalIds: readonly string[]
  /** MAST 根因标签(F1-F14 / custom:*)。 */
  readonly mastLabel: string
  /** 提案引用(delta 操作列表的序列化描述或 PR/diff 路径)。 */
  readonly proposalRef: string
  readonly verification?: VerificationReport
  readonly release?: ReleaseRecord
  readonly effect?: EffectRecord
  readonly status: LedgerStatus
  /** supersession 链:本记录被哪条新记录取代。 */
  readonly supersededBy?: number
  readonly updatedAt: number
}

/** 提案落账输入(propose 用;其余字段由流转方法补)。 */
export interface LedgerProposalInput {
  readonly pack: string
  readonly kind: LedgerKind
  readonly signalIds: readonly string[]
  readonly mastLabel: string
  readonly proposalRef: string
  readonly ts?: number
}

/** 账本查询条件。 */
export interface LedgerQuery {
  readonly pack?: string
  readonly kind?: LedgerKind
  readonly status?: LedgerStatus
  readonly limit?: number
}

/** 状态迁移表(键 = 当前态,值 = 允许的目标态集合)。 */
const TRANSITIONS: Readonly<Record<LedgerStatus, readonly LedgerStatus[]>> = {
  proposed: ['verified', 'superseded'],
  verified: ['approved', 'superseded'],
  approved: ['released', 'superseded'],
  released: ['superseded', 'rolled_back'],
  superseded: [],
  rolled_back: [],
}

const KINDS: readonly LedgerKind[] = ['skill', 'knowledge', 'rule', 'memory']
const STATUSES: readonly LedgerStatus[] = ['proposed', 'verified', 'approved', 'released', 'superseded', 'rolled_back']

const SCHEMA = `
CREATE TABLE IF NOT EXISTS evolve_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  pack TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('skill','knowledge','rule','memory')),
  signal_ids TEXT NOT NULL DEFAULT '[]',
  mast_label TEXT NOT NULL,
  proposal_ref TEXT NOT NULL,
  verification TEXT,
  release TEXT,
  effect TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','verified','approved','released','superseded','rolled_back')),
  superseded_by INTEGER REFERENCES evolve_ledger(id),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_pack ON evolve_ledger (pack, status);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON evolve_ledger (status);
`

/** 非法状态迁移(账本是审计件,迁移错误直接上抛而不是静默吞)。 */
export class LedgerTransitionError extends Error {
  constructor(id: number, from: LedgerStatus, to: LedgerStatus) {
    super(`[evolve] 账本#${id} 不允许 ${from} → ${to}(合法目标:${TRANSITIONS[from].join('/') || '终态'})`)
    this.name = 'LedgerTransitionError'
  }
}

/** 进化账本存取门(同步 API,单进程写入模型,与 observe SignalStore 同族)。 */
export class LedgerStore {
  readonly #db: DatabaseSync
  readonly #now: () => number
  #closed = false

  constructor(path: string, options: { readonly now?: () => number } = {}) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(SCHEMA)
    this.#now = options.now ?? (() => Date.now())
  }

  get closed(): boolean {
    return this.#closed
  }

  /** 提案落账(status=proposed):血缘起点 = 信号 id 列表 + 提案引用。 */
  propose(input: LedgerProposalInput): LedgerRecord {
    this.#assertOpen()
    const ts = input.ts ?? this.#now()
    const result = this.#db.prepare(
      'INSERT INTO evolve_ledger (ts, pack, kind, signal_ids, mast_label, proposal_ref, status, updated_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, \'proposed\', ?)',
    ).run(ts, input.pack, input.kind, JSON.stringify([...input.signalIds]), input.mastLabel, input.proposalRef, ts)
    const id = Number(result.lastInsertRowid)
    const record = this.get(id)
    if (record === undefined) throw new Error(`[evolve] 账本#${id} 落账后读不回(内部错误)`)
    return record
  }

  /** proposed → verified:附 G0/G1/G2 + 探针验证报告。 */
  markVerified(id: number, verification: VerificationReport): LedgerRecord {
    return this.#transition(id, 'verified', { verification })
  }

  /** verified → approved:PR 式人审通过(审批人身份在 markReleased 的 ReleaseRecord.approver 落账)。 */
  markApproved(id: number): LedgerRecord {
    return this.#transition(id, 'approved', {})
  }

  /** approved → released:版本 + tag + 审批人。 */
  markReleased(id: number, release: ReleaseRecord): LedgerRecord {
    return this.#transition(id, 'released', { release })
  }

  /** → superseded:被更新提案取代(新旧链上 supersededBy 指向取代者)。 */
  markSuperseded(id: number, supersededBy: number): LedgerRecord {
    if (this.get(supersededBy) === undefined) {
      throw new Error(`[evolve] superseded_by 指向的账本#${supersededBy} 不存在`)
    }
    return this.#transition(id, 'superseded', { supersededBy })
  }

  /** released → rolled_back:回滚 = git revert + 账本记 rolled_back(skill 重读机制即时生效)。 */
  markRolledBack(id: number): LedgerRecord {
    return this.#transition(id, 'rolled_back', {})
  }

  /** 效果回填(released 记录的 T+7d before/after;不改状态,只补 effect)。 */
  recordEffect(id: number, effect: EffectRecord): LedgerRecord {
    this.#assertOpen()
    const current = this.get(id)
    if (current === undefined) throw new Error(`[evolve] 账本#${id} 不存在`)
    if (current.status !== 'released') {
      throw new Error(`[evolve] 效果回填只对 released 记录开放(当前 ${current.status})`)
    }
    this.#db.prepare('UPDATE evolve_ledger SET effect = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(effect), this.#now(), id)
    const updated = this.get(id)
    if (updated === undefined) throw new Error(`[evolve] 账本#${id} 回填后读不回(内部错误)`)
    return updated
  }

  get(id: number): LedgerRecord | undefined {
    this.#assertOpen()
    const row = this.#db.prepare('SELECT * FROM evolve_ledger WHERE id = ?').get(id)
    return row === undefined ? undefined : decodeRow(row)
  }

  list(query: LedgerQuery = {}): readonly LedgerRecord[] {
    this.#assertOpen()
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (query.pack !== undefined) {
      clauses.push('pack = ?')
      params.push(query.pack)
    }
    if (query.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(query.kind)
    }
    if (query.status !== undefined) {
      clauses.push('status = ?')
      params.push(query.status)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.#db
      .prepare(`SELECT * FROM evolve_ledger ${where} ORDER BY ts ASC, id ASC LIMIT ?`)
      .all(...params, query.limit ?? 1000)
    return rows.map(row => decodeRow(row))
  }

  /**
   * 血缘链(设计 10 §6 lineage):pack 的全部记录按时间序 + supersededBy 边,
   * 回答「这条行为变化后来被什么取代/回滚没有」。
   */
  lineage(pack: string): readonly LedgerRecord[] {
    return this.list({ pack, limit: 10_000 })
  }

  /** 关库(构造的逆 effect;幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #transition(
    id: number,
    to: LedgerStatus,
    extra: {
      readonly verification?: VerificationReport
      readonly release?: ReleaseRecord
      readonly supersededBy?: number
    },
  ): LedgerRecord {
    this.#assertOpen()
    const current = this.get(id)
    if (current === undefined) throw new Error(`[evolve] 账本#${id} 不存在`)
    if (!TRANSITIONS[current.status].includes(to)) {
      throw new LedgerTransitionError(id, current.status, to)
    }
    this.#db.prepare('UPDATE evolve_ledger SET status = ?, updated_at = ?, '
      + 'verification = COALESCE(?, verification), '
      + 'release = COALESCE(?, release), '
      + 'superseded_by = COALESCE(?, superseded_by) '
      + 'WHERE id = ?').run(
      to,
      this.#now(),
      extra.verification !== undefined ? JSON.stringify(extra.verification) : null,
      extra.release !== undefined ? JSON.stringify(extra.release) : null,
      extra.supersededBy ?? null,
      id,
    )
    const updated = this.get(id)
    if (updated === undefined) throw new Error(`[evolve] 账本#${id} 迁移后读不回(内部错误)`)
    return updated
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[evolve] LedgerStore 已 close,不可再操作')
  }
}

function decodeRow(row: Record<string, unknown>): LedgerRecord {
  const id = Number(row['id'])
  return {
    id,
    ts: Number(row['ts']),
    pack: String(row['pack']),
    kind: assertKind(row['kind'], id),
    signalIds: parseJsonArray(row['signal_ids'], id, 'signal_ids'),
    mastLabel: String(row['mast_label']),
    proposalRef: String(row['proposal_ref']),
    ...(row['verification'] === null ? {} : { verification: parseJson(row['verification'], id, 'verification') as VerificationReport }),
    ...(row['release'] === null ? {} : { release: parseJson(row['release'], id, 'release') as ReleaseRecord }),
    ...(row['effect'] === null ? {} : { effect: parseJson(row['effect'], id, 'effect') as EffectRecord }),
    status: assertStatus(row['status'], id),
    ...(row['superseded_by'] === null ? {} : { supersededBy: Number(row['superseded_by']) }),
    updatedAt: Number(row['updated_at']),
  }
}

function parseJson(value: unknown, id: number, field: string): unknown {
  try {
    return JSON.parse(String(value))
  } catch (cause) {
    throw new Error(`[evolve] 账本#${id}.${field} 不是合法 JSON:${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

function parseJsonArray(value: unknown, id: number, field: string): readonly string[] {
  const parsed = parseJson(value, id, field)
  if (!Array.isArray(parsed) || parsed.some(v => typeof v !== 'string')) {
    throw new Error(`[evolve] 账本#${id}.${field} 不是字符串数组`)
  }
  return [...(parsed as string[])]
}

function assertKind(value: unknown, id: number): LedgerKind {
  const kind = KINDS.find(k => k === value)
  if (kind === undefined) throw new Error(`[evolve] 账本#${id} kind 非法:${String(value)}`)
  return kind
}

function assertStatus(value: unknown, id: number): LedgerStatus {
  const status = STATUSES.find(s => s === value)
  if (status === undefined) throw new Error(`[evolve] 账本#${id} status 非法:${String(value)}`)
  return status
}
