/**
 * M2 实体记忆:node:sqlite 表(subject / key / content / valid_at / invalid_at /
 * confidence)。
 *
 * 设计依据(设计文档 08 §5.1 / 14 号 T2):结构化长期事实(用户偏好、组织约定、
 * 历史案例结论)。本包用 node:sqlite(Node ≥22 内建,免原生编译)承载 T2 指定的
 * 六列形态;与 dsh storage-domain 的对接见 README「与 DSH storage 的关系」。
 *
 * 数据模型(双时态 lite):
 * - 一个 (subject, key) 同时至多一行 live(invalid_at IS NULL);
 * - write 同键顶替:旧行打 invalid_at(历史保留,天然可审计),新行插入;
 * - forget = 应用逆闭包**真删**:物理 DELETE 该 (subject, key) 的全部行
 *   (含历史),检索不可再得——非打标;
 * - write 返回 undo:精确恢复到写入前状态(删新行 + 被顶替行复活为 live),
 *   这是 Cordis 纪律 1(effect 配逆闭包)的逐字落实。
 *
 * 事务纪律:write/undo/forget 全部包 BEGIN…COMMIT,异常 ROLLBACK 后原样重抛。
 */
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue } from 'node:sqlite'

/** 一条 M2 实体记忆(sqlite 行的强类型投影)。 */
export interface EntityRecord {
  readonly id: number
  readonly subject: string
  readonly key: string
  readonly content: string
  readonly summary: string | null
  /** 生效时刻(epoch ms)。 */
  readonly validAt: number
  /** 失效时刻(epoch ms);NULL = 当前有效(live)。 */
  readonly invalidAt: number | null
  /** 置信度 0..1。 */
  readonly confidence: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** M2 写入入参。 */
export interface EntityWriteInput {
  /** 主体,约定前缀 user:/org:/project:(不强制,仅约定)。 */
  readonly subject: string
  /** 记忆键(同 subject 内唯一;不含空白)。 */
  readonly key: string
  /** 记忆正文。 */
  readonly content: string
  /** 一句话摘要(进注入索引;缺省从 content 派生)。 */
  readonly summary?: string
  /** 置信度 0..1,默认 0.8。 */
  readonly confidence?: number
  /** 生效时刻(epoch ms),默认当前时间。 */
  readonly validAt?: number
}

/** M2 写入结果:携带应用逆闭包(Cordis effect 配逆)。 */
export interface EntityWriteResult {
  /** 新写入的 live 行。 */
  readonly record: EntityRecord
  /** 本次被顶替为历史行的先前 live 行(undo 会复活它们)。 */
  readonly superseded: readonly EntityRecord[]
  /**
   * 应用逆闭包:精确恢复到写入前状态——删除新行、被顶替行恢复 live
   * (invalid_at 置回 NULL)。幂等:重复调用无副作用。事务内执行。
   */
  undo(): void
}

/** 一条 M2 检索命中。 */
export interface EntitySearchHit {
  readonly record: EntityRecord
  /** 命中字段(key/content/summary/subject 中包含词项者)。 */
  readonly matchedIn: readonly string[]
}

/** M2 检索选项。 */
export interface EntitySearchOptions {
  /** 限定主体(精确匹配);缺省全主体。 */
  readonly subject?: string
  /** 最多返回条数(默认 20)。 */
  readonly limit?: number
}

const FIELD_LIMITS = {
  subject: 256,
  key: 128,
  content: 65_536,
  summary: 200,
} as const

/**
 * M2 实体记忆存储:一个 sqlite 库一个实例;同步 API(node:sqlite DatabaseSync),
 * systemPrompt 注入的索引构建因此可以同步取数。
 */
export class EntityMemoryStore {
  readonly #db: DatabaseSync
  readonly #now: () => number
  #closed = false

  constructor(dbPath: string, options: { readonly now?: () => number } = {}) {
    this.#db = new DatabaseSync(dbPath)
    this.#now = options.now ?? ((): number => Date.now())
    if (dbPath !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        valid_at INTEGER NOT NULL,
        invalid_at INTEGER,
        confidence REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_entity_subject_key
        ON memory_entity(subject, key, valid_at);
    `)
  }

  /** 写入一条实体记忆(同键顶替;事务;返回携带 undo 的结果)。 */
  write(input: EntityWriteInput): EntityWriteResult {
    this.#assertOpen()
    const subject = validateText('subject', input.subject, FIELD_LIMITS.subject)
    const key = validateKey(input.key)
    const content = validateText('content', input.content, FIELD_LIMITS.content)
    const summary = input.summary === undefined ? null : validateText('summary', input.summary, FIELD_LIMITS.summary)
    const confidence = input.confidence ?? 0.8
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError(`[memory] confidence 必须在 [0,1],得到:${confidence}`)
    }
    const now = this.#now()
    const validAt = input.validAt ?? now

    let record: EntityRecord | undefined
    let superseded: EntityRecord[] | undefined
    this.#transaction(() => {
      superseded = this.#liveRowsOf(subject, key)
      const stamp = this.#db.prepare('UPDATE memory_entity SET invalid_at = ?, updated_at = ? WHERE id = ?')
      for (const row of superseded) stamp.run(now, now, row.id)
      const result = this.#db.prepare(`
        INSERT INTO memory_entity (subject, key, content, summary, valid_at, invalid_at, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(subject, key, content, summary, validAt, confidence, now, now)
      record = {
        id: Number(result.lastInsertRowid),
        subject,
        key,
        content,
        summary,
        validAt,
        invalidAt: null,
        confidence,
        createdAt: now,
        updatedAt: now,
      }
    })
    // 事务体必已赋值(否则上方抛错短路);守卫仅为类型收窄,不掩盖逻辑缺口
    if (record === undefined || superseded === undefined) {
      throw new Error('[memory] 内部错误:事务体未产出结果')
    }
    const written = record
    const replaced = superseded
    let undone = false
    return {
      record: written,
      superseded: replaced,
      undo: (): void => {
        if (undone || this.#closed) return
        undone = true
        this.#transaction(() => {
          this.#db.prepare('DELETE FROM memory_entity WHERE id = ?').run(written.id)
          const revive = this.#db.prepare('UPDATE memory_entity SET invalid_at = NULL, updated_at = ? WHERE id = ?')
          for (const row of replaced) revive.run(row.updatedAt, row.id)
        })
      },
    }
  }

  /** 读当前 live 行;不存在返回 null。 */
  read(subject: string, key: string): EntityRecord | null {
    this.#assertOpen()
    const row = this.#db.prepare(
      'SELECT * FROM memory_entity WHERE subject = ? AND key = ? AND invalid_at IS NULL ORDER BY valid_at DESC, id DESC LIMIT 1',
    ).get(subject, key)
    return row === undefined ? null : toRecord(row)
  }

  /** 全历史(live + 已顶替),按 valid_at 升序(审计/审批卡片用)。 */
  readAll(subject: string, key: string): readonly EntityRecord[] {
    this.#assertOpen()
    return this.#db.prepare(
      'SELECT * FROM memory_entity WHERE subject = ? AND key = ? ORDER BY valid_at ASC, id ASC',
    ).all(subject, key).map(toRecord)
  }

  /**
   * 检索 live 行:多词 AND(大小写不敏感,匹配 key/content/summary/subject 拼接),
   * 排序 confidence DESC → updated_at DESC,limit 截断(默认 20)。词项为空返回 []。
   */
  search(query: string, options: EntitySearchOptions = {}): readonly EntitySearchHit[] {
    this.#assertOpen()
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(term => term.length > 0)
    if (terms.length === 0) return []
    const limit = options.limit ?? 20
    const rows = options.subject === undefined
      ? this.#db.prepare('SELECT * FROM memory_entity WHERE invalid_at IS NULL ORDER BY confidence DESC, updated_at DESC').all()
      : this.#db.prepare(
        'SELECT * FROM memory_entity WHERE invalid_at IS NULL AND subject = ? ORDER BY confidence DESC, updated_at DESC',
      ).all(options.subject)
    const hits: EntitySearchHit[] = []
    for (const row of rows) {
      if (hits.length >= limit) break
      const record = toRecord(row)
      const matchedIn = matchFields(record, terms)
      if (matchedIn !== null) hits.push({ record, matchedIn })
    }
    return hits
  }

  /** 全部 live 行(注入索引用);可按主体过滤;排序 confidence DESC → updated_at DESC。 */
  listLive(subject?: string): readonly EntityRecord[] {
    this.#assertOpen()
    const rows = subject === undefined
      ? this.#db.prepare('SELECT * FROM memory_entity WHERE invalid_at IS NULL ORDER BY confidence DESC, updated_at DESC').all()
      : this.#db.prepare(
        'SELECT * FROM memory_entity WHERE invalid_at IS NULL AND subject = ? ORDER BY confidence DESC, updated_at DESC',
      ).all(subject)
    return rows.map(toRecord)
  }

  /**
   * 遗忘 = 应用逆闭包**真删**:物理 DELETE 该 (subject, key) 的全部行(live+历史),
   * 非打标;返回被删行快照(供审计/审批卡片展示「删掉了什么」)。事务内执行。
   */
  forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] } {
    this.#assertOpen()
    let records: readonly EntityRecord[] = []
    let changes = 0
    this.#transaction(() => {
      records = this.readAll(subject, key)
      const result = this.#db.prepare('DELETE FROM memory_entity WHERE subject = ? AND key = ?').run(subject, key)
      changes = Number(result.changes)
    })
    return { forgotten: changes, records }
  }

  /** 全表行数(测试/巡检用;含历史行)。 */
  count(): number {
    this.#assertOpen()
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM memory_entity').get()
    return toNumber(row?.['n'])
  }

  /** 关库(会话结束/插件卸载时调用;幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  /** 事务包装:异常 ROLLBACK 后原样重抛。 */
  #transaction(body: () => void): void {
    this.#db.exec('BEGIN')
    try {
      body()
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[memory] EntityMemoryStore 已关闭')
  }

  /** live 行直查(write 顶替路径用,按 valid_at 升序稳定遍历)。 */
  #liveRowsOf(subject: string, key: string): EntityRecord[] {
    return this.#db.prepare(
      'SELECT * FROM memory_entity WHERE subject = ? AND key = ? AND invalid_at IS NULL ORDER BY valid_at ASC, id ASC',
    ).all(subject, key).map(toRecord)
  }
}

/**
 * 多词 AND 匹配:每个词项必须至少出现在一个字段;返回命中字段并集,
 * 任一词项无命中则返回 null(整条不命中)。
 */
function matchFields(record: EntityRecord, terms: readonly string[]): readonly string[] | null {
  const fields: readonly (readonly [string, string])[] = [
    ['key', record.key],
    ['content', record.content],
    ['summary', record.summary ?? ''],
    ['subject', record.subject],
  ]
  const lowers = fields.map(([, value]) => value.toLowerCase())
  for (const term of terms) {
    if (!lowers.some(lower => lower.includes(term))) return null
  }
  const pairs: Array<[string, string]> = fields.map(([name], index) => [name, lowers[index] ?? ''])
  const matched: string[] = []
  for (const [name, lower] of pairs) {
    if (terms.some(term => lower.includes(term))) matched.push(name)
  }
  return matched
}

/** sqlite 行 → EntityRecord(运行期类型收窄;不合法形态抛错暴露 schema 漂移)。 */
function toRecord(row: Record<string, SQLOutputValue>): EntityRecord {
  return {
    id: toNumber(row['id']),
    subject: toStringValue(row['subject']),
    key: toStringValue(row['key']),
    content: toStringValue(row['content']),
    summary: row['summary'] === null ? null : toStringValue(row['summary']),
    validAt: toNumber(row['valid_at']),
    invalidAt: row['invalid_at'] === null ? null : toNumber(row['invalid_at']),
    confidence: toNumber(row['confidence']),
    createdAt: toNumber(row['created_at']),
    updatedAt: toNumber(row['updated_at']),
  }
}

function toNumber(value: SQLOutputValue | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new TypeError(`[memory] sqlite 数值列出现非数值:${String(value)}`)
}

function toStringValue(value: SQLOutputValue | undefined): string {
  if (typeof value === 'string') return value
  throw new TypeError(`[memory] sqlite 文本列出现非文本:${String(value)}`)
}

function validateText(field: string, value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new RangeError(`[memory] ${field} 不能为空`)
  if (trimmed.length > max) throw new RangeError(`[memory] ${field} 超长(${trimmed.length} > ${max})`)
  return trimmed
}

function validateKey(value: string): string {
  const key = validateText('key', value, FIELD_LIMITS.key)
  if (/\s/u.test(key)) throw new RangeError(`[memory] key 不能包含空白:${key}`)
  return key
}
