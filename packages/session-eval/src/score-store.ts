/**
 * 评分库(56 号 §5.4「存储」):`node:sqlite` 单文件,落 `$DSH_HOME/.eterna/session-eval/`。
 *
 * 纪律:
 * - **不写会话日志、不新增事件类型**;评分记录按 `(session, metric, target)` 幂等
 *   覆盖(重评 = 覆盖,不堆历史;版本随 metric 键走);
 * - 评分是派生数据:库损坏/写失败不应炸会话(上层 try/catch,面板显示 error 状态);
 * - 裁判用量单列(`judge_usage` 按天),不混入被测会话的 token/成本。
 *
 * 与 observe/signals.ts 同族:同步 API、预编译语句随实例缓存、STRICT 表。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { JudgeCategory, JudgeScope, JudgeStatus } from './judge-types.ts'

/** 一条落库评分(结构面;面板视图由 engine 组装). */
export interface StoredJudgeScore {
  readonly sessionId: string
  readonly metricKey: string
  readonly metricName: string
  readonly category: JudgeCategory
  readonly scope: JudgeScope
  readonly targetTurn: number | null
  readonly status: JudgeStatus
  readonly value: boolean | null
  readonly rationale: string | null
  readonly provider: string | null
  readonly model: string | null
  readonly latencyMs: number | null
  readonly tokens: number | null
  /** 该指标是否关键项(业务指标门控用;内置项恒有定义,列可空). */
  readonly gating: boolean | null
  /** 指标定义版本(业务指标 §9.6;内置项为 null). */
  readonly metricVersion: number | null
  readonly createdAt: number
}

/** 一条人工复核(56 号 P2-3 校准;judge_value 是标注当时的裁判判定快照). */
export interface StoredJudgeLabel {
  readonly sessionId: string
  readonly metricKey: string
  readonly metricName: string
  readonly category: JudgeCategory
  readonly scope: JudgeScope
  readonly targetTurn: number | null
  readonly judgeValue: boolean
  readonly agrees: boolean
  readonly labeledBy: string
  readonly labeledAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS judge_score (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('outcome','process')),
  scope TEXT NOT NULL CHECK (scope IN ('session','turn')),
  target_turn INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error','skipped','not_applicable','sampled_out','pending')),
  value INTEGER,
  rationale TEXT,
  provider TEXT,
  model TEXT,
  latency_ms INTEGER,
  tokens INTEGER,
  gating INTEGER,
  metric_version INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_judge_score_session ON judge_score (session_id, metric_key);
CREATE TABLE IF NOT EXISTS judge_usage (
  day TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS judge_label (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('outcome','process')),
  scope TEXT NOT NULL CHECK (scope IN ('session','turn')),
  target_turn INTEGER,
  judge_value INTEGER NOT NULL CHECK (judge_value IN (0,1)),
  agrees INTEGER NOT NULL CHECK (agrees IN (0,1)),
  labeled_by TEXT NOT NULL,
  labeled_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_judge_label_metric ON judge_label (metric_key);
`

/** 幂等键:`session + metric + target`(重评覆盖). */
function scoreId(sessionId: string, metricKey: string, scope: JudgeScope, turn: number | null): string {
  return JSON.stringify([sessionId, metricKey, scope, scope === 'turn' ? turn : null])
}

/** 建库(父目录不存在时懒建——node:sqlite 不建父目录的实测教训). */
export function openJudgeStore(path: string): JudgeScoreStore {
  mkdirSync(dirname(path), { recursive: true })
  return new JudgeScoreStore(path)
}

/** 可选文本列(unknown → string|null;不依赖默认 toString). */
function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 评分行 → 对象(列名同上;list / listMany 共用). */
function rowToScore(row: Record<string, unknown>): StoredJudgeScore {
  return {
    sessionId: String(row.session_id),
    metricKey: String(row.metric_key),
    metricName: String(row.metric_name),
    category: row.category === 'outcome' ? 'outcome' : 'process',
    scope: row.scope === 'turn' ? 'turn' : 'session',
    targetTurn: numberOf(row.target_turn),
    status: String(row.status) as JudgeStatus,
    value: numberOf(row.value) === null ? null : numberOf(row.value) === 1,
    rationale: textOf(row.rationale),
    provider: textOf(row.provider),
    model: textOf(row.model),
    latencyMs: numberOf(row.latency_ms),
    tokens: numberOf(row.tokens),
    gating: numberOf(row.gating) === null ? null : numberOf(row.gating) === 1,
    metricVersion: numberOf(row.metric_version),
    createdAt: Number(row.created_at),
  }
}

/** 人工复核行 → 结构面. */
function labelOfRow(row: Record<string, unknown>): StoredJudgeLabel {
  return {
    sessionId: String(row.session_id),
    metricKey: String(row.metric_key),
    metricName: String(row.metric_name),
    category: row.category === 'outcome' ? 'outcome' : 'process',
    scope: row.scope === 'turn' ? 'turn' : 'session',
    targetTurn: numberOf(row.target_turn),
    judgeValue: numberOf(row.judge_value) === 1,
    agrees: numberOf(row.agrees) === 1,
    labeledBy: String(row.labeled_by),
    labeledAt: Number(row.labeled_at),
  }
}

/** 可选数字列(unknown → number|null). */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 评分库存取门。
 */
export class JudgeScoreStore {
  readonly #db: DatabaseSync
  readonly #upsert: ReturnType<DatabaseSync['prepare']>
  readonly #list: ReturnType<DatabaseSync['prepare']>
  readonly #usage: ReturnType<DatabaseSync['prepare']>
  readonly #addUsage: ReturnType<DatabaseSync['prepare']>
  readonly #saveLabel: ReturnType<DatabaseSync['prepare']>
  readonly #labelsForSession: ReturnType<DatabaseSync['prepare']>
  readonly #allLabels: ReturnType<DatabaseSync['prepare']>

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(SCHEMA)
    // 旧库(P1)迁移:两列后加,缺列时补(列名固定,不读用户输入)。
    for (const column of ['gating', 'metric_version']) {
      try {
        this.#db.exec(`ALTER TABLE judge_score ADD COLUMN ${column} INTEGER`)
      } catch {
        // 已存在(新库或已迁移)。
      }
    }
    this.#upsert = this.#db.prepare(`
      INSERT INTO judge_score
        (id, session_id, metric_key, metric_name, category, scope, target_turn, status, value,
         rationale, provider, model, latency_ms, tokens, gating, metric_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        metric_name = excluded.metric_name,
        category = excluded.category,
        status = excluded.status,
        value = excluded.value,
        rationale = excluded.rationale,
        provider = excluded.provider,
        model = excluded.model,
        latency_ms = excluded.latency_ms,
        tokens = excluded.tokens,
        gating = excluded.gating,
        metric_version = excluded.metric_version,
        created_at = excluded.created_at
    `)
    this.#list = this.#db.prepare(`
      SELECT session_id, metric_key, metric_name, category, scope, target_turn, status, value,
             rationale, provider, model, latency_ms, tokens, gating, metric_version, created_at
      FROM judge_score WHERE session_id = ? ORDER BY metric_key, target_turn
    `)
    this.#usage = this.#db.prepare('SELECT tokens FROM judge_usage WHERE day = ?')
    this.#addUsage = this.#db.prepare(`
      INSERT INTO judge_usage (day, tokens) VALUES (?, ?)
      ON CONFLICT (day) DO UPDATE SET tokens = tokens + excluded.tokens
    `)
    this.#saveLabel = this.#db.prepare(`
      INSERT INTO judge_label
        (id, session_id, metric_key, metric_name, category, scope, target_turn,
         judge_value, agrees, labeled_by, labeled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        metric_name = excluded.metric_name,
        category = excluded.category,
        judge_value = excluded.judge_value,
        agrees = excluded.agrees,
        labeled_by = excluded.labeled_by,
        labeled_at = excluded.labeled_at
    `)
    this.#labelsForSession = this.#db.prepare(`
      SELECT session_id, metric_key, metric_name, category, scope, target_turn,
             judge_value, agrees, labeled_by, labeled_at
      FROM judge_label WHERE session_id = ? ORDER BY metric_key, target_turn
    `)
    this.#allLabels = this.#db.prepare(`
      SELECT session_id, metric_key, metric_name, category, scope, target_turn,
             judge_value, agrees, labeled_by, labeled_at
      FROM judge_label ORDER BY metric_key, target_turn
    `)
  }

  /** 写入/覆盖一条评分. */
  upsert(score: StoredJudgeScore): void {
    this.#upsert.run(
      scoreId(score.sessionId, score.metricKey, score.scope, score.targetTurn),
      score.sessionId, score.metricKey, score.metricName, score.category, score.scope,
      score.targetTurn, score.status, score.value === null ? null : score.value ? 1 : 0,
      score.rationale, score.provider, score.model, score.latencyMs, score.tokens,
      score.gating === null ? null : score.gating ? 1 : 0, score.metricVersion, score.createdAt,
    )
  }

  /** 列出某会话的全部评分(按指标键与轮次排序). */
  list(sessionId: string): StoredJudgeScore[] {
    const rows = this.#list.all(sessionId) as Record<string, unknown>[]
    return rows.map(rowToScore)
  }

  /** 列出给定会话的全部评分(总览聚合;分块 IN 查询,上限由调用方控). */
  listMany(sessionIds: readonly string[]): StoredJudgeScore[] {
    if (sessionIds.length === 0) return []
    const rows: Record<string, unknown>[] = []
    const chunk = 400
    for (let offset = 0; offset < sessionIds.length; offset += chunk) {
      const slice = sessionIds.slice(offset, offset + chunk)
      const placeholders = slice.map(() => '?').join(',')
      const statement = this.#db.prepare(
        `SELECT session_id, metric_key, metric_name, category, scope, target_turn, status, value,
                rationale, provider, model, latency_ms, tokens, gating, metric_version, created_at
           FROM judge_score WHERE session_id IN (${placeholders})`,
      )
      rows.push(...statement.all(...slice) as Record<string, unknown>[])
    }
    return rows.map(rowToScore)
  }

  /** 某天已用裁判 token. */
  usage(day: string): number {
    const row = this.#usage.get(day) as { tokens?: unknown } | undefined
    return row?.tokens === undefined ? 0 : Number(row.tokens)
  }

  /** 累加某天裁判 token. */
  addUsage(day: string, tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return
    this.#addUsage.run(day, Math.round(tokens))
  }

  /** 写入/覆盖一条人工复核(同会话同指标同目标只保留最新一次). */
  saveLabel(label: StoredJudgeLabel): void {
    this.#saveLabel.run(
      scoreId(label.sessionId, label.metricKey, label.scope, label.targetTurn),
      label.sessionId, label.metricKey, label.metricName, label.category, label.scope,
      label.targetTurn, label.judgeValue ? 1 : 0, label.agrees ? 1 : 0,
      label.labeledBy, label.labeledAt,
    )
  }

  /** 某会话的人工复核(面板回显用). */
  labels(sessionId: string): StoredJudgeLabel[] {
    return (this.#labelsForSession.all(sessionId) as Record<string, unknown>[]).map(labelOfRow)
  }

  /** 全部人工复核(校准聚合用). */
  allLabels(): StoredJudgeLabel[] {
    return (this.#allLabels.all() as Record<string, unknown>[]).map(labelOfRow)
  }

  /** 关闭库(插件卸载/测试清场). */
  close(): void {
    this.#db.close()
  }
}
