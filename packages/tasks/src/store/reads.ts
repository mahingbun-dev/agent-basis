/**
 * Store 只读视图查询——管理视图、orchestrator 工具与 Source 轮询的读取面(35 号 A11)。
 *
 * 设计依据:34 号 §2.3 reads 行(SA src/app/store-read.ts 原样);35 号 A11 验收门禁
 * tests/timeline.spec.ts 的被测面。一库一 realm:查询天然按租户过滤,无需 SQL 改造
 * (34 号 §2.3 reads 行引 24 §9-3——realm 内嵌而非外层过滤的理由)。
 * 写者唯一、读者旁路:本文件零写入(34 号 §3「read 面只读投影走 store/reads.ts,不经 Engine」)。
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Decision, Thread, Trigger } from '../core/index.ts'
import type { Dropped, Receipt, TimelinePlace } from './store.ts'

/** 只读查询集:由 Store 以 `store.read` 暴露。 */
export function storeReads(db: DatabaseSync) {
  const values = <T>(sql: string, ...parameters: SQLInputValue[]): T[] =>
    db.prepare(sql).all(...parameters).map(row => JSON.parse(String(row.value)) as T)
  return {
    /** 最新在前,按到达序(rowid)而非 trigger 时间戳。 */
    recentTriggers: (offset = 0, limit = 50): Trigger[] =>
      db.prepare('SELECT value FROM trigger ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, offset).map(row => JSON.parse(String(row.value)) as Trigger),
    /** 自 `since` 起按 Source 的 trigger 计数(收到的/被过滤的),附全期最新到达时刻。 */
    triggerStats: (since: string): Record<string, { received: number; filtered: number; lastAt: string }> => {
      const result: Record<string, { received: number; filtered: number; lastAt: string }> = {}
      const rows = db.prepare("SELECT json_extract(t.value, '$.source') AS source, MAX(t.at) AS last, SUM(t.at >= ?) AS received, SUM(t.at >= ? AND json_extract(d.value, '$.filtered') IS NOT NULL) AS filtered FROM trigger t LEFT JOIN disposition d ON d.id = t.id GROUP BY source").all(since, since)
      for (const row of rows) {
        result[String(row.source)] = { received: Number(row.received ?? 0), filtered: Number(row.filtered ?? 0), lastAt: String(row.last ?? '') }
      }
      return result
    },
    /**
     * 自 `since` 起到达、通过 Source 过滤并到达某个 Decision 的 trigger 计数,
     * 以及其中产生 accept/reopen Decision 的计数(与 flow 窗口对齐)。
     */
    flow: (since: string): { judged: number; accepted: number } => {
      const passed = "t.at >= ? AND NOT EXISTS (SELECT 1 FROM disposition s WHERE s.id = t.id AND json_extract(s.value, '$.filtered') IS NOT NULL)"
      const judged = db.prepare(`SELECT COUNT(DISTINCT t.id) AS n FROM decision d, json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value WHERE ${passed}`).get(since)
      const accepted = db.prepare(`SELECT COUNT(DISTINCT d.id) AS n FROM decision d, json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value
        WHERE json_extract(d.value, '$.kind') IN (?, ?) AND t.at >= ?`).get('accept', 'reopen', since)
      return { judged: Number(judged?.n ?? 0), accepted: Number(accepted?.n ?? 0) }
    },
    triggers: (options: { source?: string; filtered?: boolean }, offset = 0, limit = 50): { items: Trigger[]; more: boolean } => {
      const where = [...(options.source !== undefined ? ["json_extract(t.value, '$.source') = ?"] : []), ...(options.filtered ? ["json_extract(d.value, '$.filtered') IS NOT NULL"] : [])]
      const rows = db.prepare(`SELECT t.value FROM trigger t LEFT JOIN disposition d ON d.id = t.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.at DESC LIMIT ? OFFSET ?`)
        .all(...(options.source !== undefined ? [options.source] : []), limit + 1, offset)
      return { items: rows.slice(0, limit).map(row => JSON.parse(String(row.value)) as Trigger), more: rows.length > limit }
    },
    /** 线程上最新 `limit` 条 trigger,最旧在前;可选限定在 `before`(或含它,`through`)之前。 */
    threadTriggers: (threadKey: string, limit = 50, before?: TimelinePlace, through = false): Trigger[] => {
      const place = before !== undefined ? `AND (x.at, x.id) ${through ? '<=' : '<'} (?, ?)` : ''
      return values<Trigger>(`SELECT t.value FROM trigger_thread x JOIN trigger t ON t.id = x.id WHERE x.thread = ? ${place}
      ORDER BY x.at DESC, x.id DESC LIMIT ?`, threadKey, ...(before !== undefined ? [before.at, before.id] : []), limit).reverse()
    },
    threadPage: (threadKey: string, offset: number, limit: number): Trigger[] => values(`SELECT t.value FROM trigger_thread x
      JOIN trigger t ON t.id = x.id WHERE x.thread = ? ORDER BY x.at DESC, t.rowid DESC LIMIT ? OFFSET ?`, threadKey, limit, offset),
    /** 线程上紧邻 `(at, id)` 之前与之后的非 CI trigger。 */
    neighbours: (threadKey: string, at: string, id: string): { before?: Trigger; after?: Trigger } => {
      const nearest = (side: '<' | '>'): Trigger | undefined => values<Trigger>(`SELECT t.value FROM trigger_thread x JOIN trigger t ON t.id = x.id
      WHERE x.thread = ? AND (x.at, x.id) ${side} (?, ?) AND json_extract(t.value, '$.meta.ci') IS NULL
      ORDER BY x.at ${side === '<' ? 'DESC' : 'ASC'}, x.id ${side === '<' ? 'DESC' : 'ASC'} LIMIT 1`, threadKey, at, id)[0]
      const before = nearest('<'), after = nearest('>')
      return { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }
    },
    /** 线程上最老的 trigger,用于给线程起标题;`humanOnly` 时只看人的消息。 */
    firstTrigger: (threadKey: string, humanOnly = false): Trigger | undefined => {
      const row = db.prepare(`SELECT t.value FROM trigger_thread x JOIN trigger t ON t.id = x.id WHERE x.thread = ? ${humanOnly ? 'AND x.human = 1' : ''} ORDER BY x.at ASC, t.rowid ASC LIMIT 1`).get(threadKey)
      return row === undefined ? undefined : JSON.parse(String(row.value)) as Trigger
    },
    search: (query: string, limit = 20): Trigger[] => {
      const pattern = `%${query.replace(/[\\%_]/g, match => `\\${match}`)}%`
      const rows = db.prepare("SELECT value FROM trigger WHERE id = ? OR json_extract(value, '$.url') LIKE ? ESCAPE '\\' OR json_extract(value, '$.meta.messageId') = ? OR json_extract(value, '$.text') LIKE ? ESCAPE '\\' ORDER BY at DESC LIMIT ?").all(query, `${query.replace(/[\\%_]/g, match => `\\${match}`)}%`, query, pattern, limit)
      return rows.map(row => JSON.parse(String(row.value)) as Trigger)
    },
    recentDecisions: (offset = 0, limit = 50): Decision[] =>
      db.prepare('SELECT value FROM decision ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, offset).map(row => JSON.parse(String(row.value)) as Decision),
    /** 匹配 `kinds` 且其 trigger 自 `since` 起到达的 Decision,与 flow 窗口计数对齐。 */
    decisions: (options: { kinds: string[]; since: string }, offset: number, limit: number): { items: Decision[]; more: boolean } => {
      const where = [...(options.kinds.length ? [`json_extract(d.value, '$.kind') IN (${options.kinds.map(() => '?').join(',')})`] : []),
        ...(options.since !== '' ? ["EXISTS (SELECT 1 FROM json_each(json_extract(d.value, '$.triggerIds')) j JOIN trigger t ON t.id = j.value WHERE t.at >= ?)"] : [])]
      const rows = db.prepare(`SELECT d.value FROM decision d ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.rowid DESC LIMIT ? OFFSET ?`)
        .all(...options.kinds, ...(options.since !== '' ? [options.since] : []), limit + 1, offset)
      return { items: rows.slice(0, limit).map(row => JSON.parse(String(row.value)) as Decision), more: rows.length > limit }
    },
    /** 给定种类的最新 Decision,供须在大量 ignore 中露出稀有结果的面使用。 */
    decisionsOfKinds: (kinds: string[], limit = 30): Decision[] => {
      const rows = db.prepare(`SELECT value FROM decision WHERE json_extract(value, '$.kind') IN (${kinds.map(() => '?').join(',')}) ORDER BY rowid DESC LIMIT ?`).all(...kinds, limit)
      return rows.map(row => JSON.parse(String(row.value)) as Decision)
    },
    /** `reply` effect 失败过的消息,带连续失败计数与最后一次错误,最旧在前。 */
    failingReplies: (): Array<Receipt & { attempts: number; error: string }> => {
      const rows = db.prepare(`SELECT o.value, e.attempts, e.error FROM effect e
        JOIN outbox o ON o.id = e.key WHERE e.kind = 'reply' AND e.attempts > 0 ORDER BY e.seq`).all()
      return rows.map(row => ({ ...JSON.parse(String(row.value)) as Receipt, attempts: Number(row.attempts), error: String(row.error) }))
    },
    droppedReplies: (limit = 20): Dropped[] =>
      values('SELECT value FROM outbox WHERE dropped IS NOT NULL ORDER BY dropped DESC LIMIT ?', limit),
    droppedSince: (since: string): number => Number(db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE dropped >= ?').get(since)?.n ?? 0),
    subscribedThreads: (source?: string): Thread[] => source !== undefined
      ? values('SELECT value FROM thread WHERE subscribed = ? ORDER BY rowid', source)
      // 强制走部分索引,免 SQLite 以 rowid 序全表扫。
      : values('SELECT value FROM thread INDEXED BY thread_subscribed WHERE subscribed IS NOT NULL ORDER BY rowid'),
  }
}
