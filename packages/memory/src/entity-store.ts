/**
 * M2 实体记忆:node:sqlite 表(subject / key / content / valid_at / invalid_at /
 * confidence + M-M1 T1 增列 kind/scope/domain_key/review_state/origin_session_id/
 * origin_turn_ref/source/last_used_at/use_count)。
 *
 * 设计依据(设计文档 08 §5.1 / 14 号 T2;M-M1 增量见 19 号 §3-T1、18 号 §2):结构化
 * 长期事实(用户偏好、域经验、历史案例结论)。本包用 node:sqlite(Node ≥22 内建,
 * 免原生编译)承载;与 dsh storage-domain 的对接见 README「与 DSH storage 的关系」。
 *
 * 数据模型(双时态 lite):
 * - 一个 (subject, key) 同时至多一行 live(invalid_at IS NULL)——M-M1 增列后
 *   live 唯一性约束不变(仍 (subject,key),19 号 §3-T1);
 * - write 同键顶替:旧行打 invalid_at(历史保留,天然可审计),新行插入;
 * - forget = 应用逆闭包**真删**:物理 DELETE 该 (subject, key) 的全部行
 *   (含历史),检索不可再得——非打标;
 * - review(id,'rejected') = 软失效(打 invalid_at,物理行留档;区别于 forget);
 * - supersede(id) = Gm1 软失效(打 invalid_at,不动 review_state——被更优提案顶替);
 * - listForReview(state) = 评审队列读取面(管理面专用,不经模型工具);
 * - write 返回 undo:精确恢复到写入前状态(删新行 + 被顶替行复活为 live),
 *   这是 Cordis 纪律 1(effect 配逆闭包)的逐字落实。
 *
 * M-M1 T1 开库迁移(幂等):PRAGMA table_info 检测缺列才 ADD;存量 subject 前缀
 * 迁移四分支一次性执行(user:*→scope=user;project:*→domain+改写 subject;
 * org:*→legacy-org 只留档;无前缀→domain:default),门闩=PRAGMA user_version。
 *
 * 检索纪律(18 §3.2/§9):search/listLive 默认只取 review_state='approved' 且
 * scope != 'legacy-org' 的 live 行——pending/rejected 物理留档、逻辑不可见。
 *
 * 事务纪律:write/undo/forget/review/touch/迁移全部包 BEGIN…COMMIT,异常 ROLLBACK
 * 后原样重抛。
 */
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue } from 'node:sqlite'

/** 认知类型(18 §0:episodic 会话记录 / semantic 事实 / procedural 怎么做)。 */
export type EntityKind = 'episodic' | 'semantic' | 'procedural'

/** 作用域(18 §1.2:两层记忆 user|domain;legacy-org=存量 org: 前缀行,只留档不检索,Q1 决议)。 */
export type EntityScope = 'user' | 'domain' | 'legacy-org'

/** 评审状态(pending 待审 / approved 生效 / rejected 软失效;检索与索引只取 approved)。 */
export type EntityReviewState = 'pending' | 'approved' | 'rejected'

/** review() 的落定动作(rejected = 打 invalid_at 软失效,不物理删)。 */
export type EntityReviewDecision = 'approved' | 'rejected'

/** 写入来源(18 §2:explicit 用户显式 / agent 会话自主 / consolidation 整固 / compaction 摘要)。 */
export type EntitySource = 'explicit' | 'agent' | 'consolidation' | 'compaction'

/**
 * 四操作决策(19 号 §3-T2.4,writeEntity 写入口判定):add 新增 /
 * update 顶替或合并进既有 key / noop 内容几乎一致拒绝写入。
 */
export type EntityWriteDecision = 'add' | 'update' | 'noop'

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
  /** 认知类型(M-M1 增列;存量/缺省 semantic)。 */
  readonly kind: EntityKind
  /** 作用域(M-M1 增列;存量按前缀迁移,缺省 domain)。 */
  readonly scope: EntityScope
  /** 域键(kebab-case ≤64;scope='domain' 时必填,其余为 NULL)。 */
  readonly domainKey: string | null
  /** 评审状态(M-M1 增列;缺省 approved)。 */
  readonly reviewState: EntityReviewState
  /** 出处会话(provenance;运行时盖章,不信任模型手写)。 */
  readonly originSessionId: string | null
  /** 出处轮次引用(callId 等;provenance 同上)。 */
  readonly originTurnRef: string | null
  /** 写入来源(M-M1 增列;缺省 agent)。 */
  readonly source: EntitySource
  /** 最近命中时刻(epoch ms;touch 命中强化)。 */
  readonly lastUsedAt: number | null
  /** 命中次数(touch 累计;MemoryBank 越用越牢)。 */
  readonly useCount: number
}

/** M2 写入入参。 */
export interface EntityWriteInput {
  /**
   * 主体。新编码(18 §1.2/19 号 §1.3-1):用户画像层 `user`;功能域 `domain:<域键>`。
   * 旧前缀编码(user:/org:/project:)的存量行由开库迁移收敛;工具层在 T2 起不再
   * 产出旧前缀。
   */
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
  /** 认知类型,默认 semantic。 */
  readonly kind?: EntityKind
  /** 作用域,默认 domain。 */
  readonly scope?: EntityScope
  /**
   * 域键(kebab-case ≤64)。仅 scope='domain' 可携带;缺省时从 subject 的
   * `domain:<键>` 编码推导,再缺省落 'default'(与存量无前缀迁移分支一致)。
   */
  readonly domainKey?: string
  /** 评审状态,默认 approved(写入口的分级卡控判定在 T2 工具层,本层只承载)。 */
  readonly reviewState?: EntityReviewState
  /** 出处会话 id(运行时盖章,T2 起由工具层注入)。 */
  readonly originSessionId?: string
  /** 出处轮次引用(T2 起注入)。 */
  readonly originTurnRef?: string
  /** 写入来源,默认 agent。 */
  readonly source?: EntitySource
  /**
   * 绕过跨 key 查重(M-M2 T8 内部调用面专用,默认 false):Gm1 一致性闸已对
   * 同 scope+kind 重叠行做过 LLM 对账(矛盾→独立入库+supersede / 无关→独立
   * 入库)时置 true——对账决策优先于写入口 0.6 强制合并启发式;同键顶替与
   * NOOP 拒写不受此标志豁免。模型工具面无此参数(tools.ts 不透传),不信任
   * 模型手写(reviewState/provenance 同款纪律)。
   */
  readonly skipCrossKeyDedup?: boolean
}

/** M2 写入结果:携带应用逆闭包(Cordis effect 配逆)。 */
export interface EntityWriteResult {
  /**
   * 四操作决策:本层(write 原语)只有 add(无同键 live 行)与 update(同键顶替);
   * noop 与跨 key 相似合并是 Memory 门面 writeEntity 的写入口判定
   * (19 号 §3-T2.4),经门面写入时三种决策齐备。
   */
  readonly decision: EntityWriteDecision
  /** 新写入的 live 行(noop 时=判定为几乎一致的既有 live 行,未写入新行)。 */
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
  /** 限定作用域:user=用户画像层 / domain=功能域(19 号 §3-T2.2,过滤先于排序)。 */
  readonly scope?: EntityScope
  /** 限定域键(kebab-case;与 scope='domain' 联用,过滤先于排序)。 */
  readonly domainKey?: string
  /** 最多返回条数(默认 20)。 */
  readonly limit?: number
}

const FIELD_LIMITS = {
  subject: 256,
  key: 128,
  /** 物理容量上限;业务上限(Gm0 单条 ≤2000 字)在 Memory 门面 writeEntity 收紧。 */
  content: 65_536,
  summary: 200,
  domainKey: 64,
  originSessionId: 256,
  originTurnRef: 256,
} as const

const ENTITY_KINDS: readonly EntityKind[] = ['episodic', 'semantic', 'procedural']
const ENTITY_SCOPES: readonly EntityScope[] = ['user', 'domain', 'legacy-org']
const ENTITY_REVIEW_STATES: readonly EntityReviewState[] = ['pending', 'approved', 'rejected']
const ENTITY_SOURCES: readonly EntitySource[] = ['explicit', 'agent', 'consolidation', 'compaction']

/** 域键编码:kebab-case(小写字母数字与连字符,首尾非连字符),≤64(与 domain_registry 对齐)。 */
const DOMAIN_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** 存量 subject 前缀迁移已完成的 user_version 门闩值(后续迁移顺延 2、3…)。 */
const SUBJECT_PREFIX_MIGRATION_VERSION = 1

/**
 * M-M1 T1 增列清单(19 号 §3 DDL 逐字;开库时 PRAGMA table_info 检测缺列才 ALTER,
 * 重复 ADD 会抛 duplicate column,故逐列探测)。
 */
const MIGRATION_COLUMNS: readonly { readonly name: string; readonly ddl: string }[] = [
  { name: 'kind', ddl: "ALTER TABLE memory_entity ADD COLUMN kind TEXT NOT NULL DEFAULT 'semantic'" },
  { name: 'scope', ddl: "ALTER TABLE memory_entity ADD COLUMN scope TEXT NOT NULL DEFAULT 'domain'" },
  { name: 'domain_key', ddl: 'ALTER TABLE memory_entity ADD COLUMN domain_key TEXT' },
  { name: 'review_state', ddl: "ALTER TABLE memory_entity ADD COLUMN review_state TEXT NOT NULL DEFAULT 'approved'" },
  { name: 'origin_session_id', ddl: 'ALTER TABLE memory_entity ADD COLUMN origin_session_id TEXT' },
  { name: 'origin_turn_ref', ddl: 'ALTER TABLE memory_entity ADD COLUMN origin_turn_ref TEXT' },
  { name: 'source', ddl: "ALTER TABLE memory_entity ADD COLUMN source TEXT NOT NULL DEFAULT 'agent'" },
  { name: 'last_used_at', ddl: 'ALTER TABLE memory_entity ADD COLUMN last_used_at INTEGER' },
  { name: 'use_count', ddl: 'ALTER TABLE memory_entity ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0' },
]

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
    // 新库直接建全列形态;存量库(旧十列)由 #migrate 补列,CREATE IF NOT EXISTS 不动它
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
        updated_at INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'semantic',
        scope TEXT NOT NULL DEFAULT 'domain',
        domain_key TEXT,
        review_state TEXT NOT NULL DEFAULT 'approved',
        origin_session_id TEXT,
        origin_turn_ref TEXT,
        source TEXT NOT NULL DEFAULT 'agent',
        last_used_at INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS memory_entity_subject_key
        ON memory_entity(subject, key, valid_at);
    `)
    this.#migrate()
  }

  /**
   * M-M1 T1 开库迁移(幂等,19 号 §3):
   * 1. 缺列补列——PRAGMA table_info(memory_entity) 检测,已存在才跳过;
   * 2. 检索面新索引(scope 域过滤 / review_state 评审过滤,CREATE IF NOT EXISTS);
   * 3. 存量 subject 前缀迁移四分支——user_version 门闩保证一次性(重开不重跑,
   *    否则已改写的 project:* 行会被无前缀分支的 default 域覆盖)。
   */
  #migrate(): void {
    const present = new Set(
      this.#db.prepare('PRAGMA table_info(memory_entity)').all().map(row => toStringValue(row['name'])),
    )
    for (const column of MIGRATION_COLUMNS) {
      if (!present.has(column.name)) this.#db.exec(column.ddl)
    }
    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS memory_entity_scope_live
        ON memory_entity(scope, domain_key, invalid_at);
      CREATE INDEX IF NOT EXISTS memory_entity_review
        ON memory_entity(review_state, invalid_at);
    `)
    const versionRow = this.#db.prepare('PRAGMA user_version').get()
    if (versionRow !== undefined && toNumber(versionRow['user_version']) >= SUBJECT_PREFIX_MIGRATION_VERSION) return
    this.#transaction(() => {
      const rows = this.#db.prepare('SELECT id, subject FROM memory_entity').all()
      const apply = this.#db.prepare('UPDATE memory_entity SET subject = ?, scope = ?, domain_key = ? WHERE id = ?')
      for (const row of rows) {
        const classified = classifyLegacySubject(toStringValue(row['subject']))
        apply.run(classified.subject, classified.scope, classified.domainKey, toNumber(row['id']))
      }
      // user_version 写入随事务提交/回滚(实测验证),迁移半途失败不会半生不熟
      this.#db.exec(`PRAGMA user_version = ${SUBJECT_PREFIX_MIGRATION_VERSION}`)
    })
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
    const kind = assertOneOf('kind', input.kind, 'semantic', ENTITY_KINDS)
    const scope = assertOneOf('scope', input.scope, 'domain', ENTITY_SCOPES)
    const reviewState = assertOneOf('reviewState', input.reviewState, 'approved', ENTITY_REVIEW_STATES)
    const source = assertOneOf('source', input.source, 'agent', ENTITY_SOURCES)
    const domainKey = resolveDomainKey(input.domainKey, scope, subject)
    const originSessionId = input.originSessionId === undefined
      ? null
      : validateText('originSessionId', input.originSessionId, FIELD_LIMITS.originSessionId)
    const originTurnRef = input.originTurnRef === undefined
      ? null
      : validateText('originTurnRef', input.originTurnRef, FIELD_LIMITS.originTurnRef)
    const now = this.#now()
    const validAt = input.validAt ?? now

    let record: EntityRecord | undefined
    let superseded: EntityRecord[] | undefined
    this.#transaction(() => {
      superseded = this.#liveRowsOf(subject, key)
      const stamp = this.#db.prepare('UPDATE memory_entity SET invalid_at = ?, updated_at = ? WHERE id = ?')
      for (const row of superseded) stamp.run(now, now, row.id)
      const result = this.#db.prepare(`
        INSERT INTO memory_entity (
          subject, key, content, summary, valid_at, invalid_at, confidence,
          kind, scope, domain_key, review_state, origin_session_id, origin_turn_ref, source,
          last_used_at, use_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
      `).run(
        subject, key, content, summary, validAt, confidence,
        kind, scope, domainKey, reviewState, originSessionId, originTurnRef, source,
        now, now,
      )
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
        kind,
        scope,
        domainKey,
        reviewState,
        originSessionId,
        originTurnRef,
        source,
        lastUsedAt: null,
        useCount: 0,
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
      decision: replaced.length > 0 ? 'update' : 'add',
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
   * 默认只取 approved 且非 legacy-org(18 §3.2:pending/rejected 留档不检索;
   * legacy-org 只留档,Q1 决议);readAll 面向审计不受此限。
   * scope/domainKey/subject 过滤全部落在 SQL WHERE(相似度排序之前——
   * Zep scoped retrieval 口径,19 号 §3-T2.2)。
   */
  search(query: string, options: EntitySearchOptions = {}): readonly EntitySearchHit[] {
    this.#assertOpen()
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(term => term.length > 0)
    if (terms.length === 0) return []
    const limit = options.limit ?? 20
    const conditions: string[] = []
    const params: string[] = []
    for (const [field, value] of [
      ['subject', options.subject],
      ['scope', options.scope],
      ['domain_key', options.domainKey],
    ] as const) {
      if (value !== undefined) {
        conditions.push(`${field} = ?`)
        params.push(value)
      }
    }
    const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : ''
    const rows = this.#db.prepare(
      `${LIVE_FILTER_SQL}${where} ORDER BY confidence DESC, updated_at DESC`,
    ).all(...params)
    const hits: EntitySearchHit[] = []
    for (const row of rows) {
      if (hits.length >= limit) break
      const record = toRecord(row)
      const matchedIn = matchFields(record, terms)
      if (matchedIn !== null) hits.push({ record, matchedIn })
    }
    return hits
  }

  /** 全部可注入 live 行(索引用);可按主体过滤;排序 confidence DESC → updated_at DESC。过滤口径同 search。 */
  listLive(subject?: string): readonly EntityRecord[] {
    this.#assertOpen()
    const rows = subject === undefined
      ? this.#db.prepare(`${LIVE_FILTER_SQL} ORDER BY confidence DESC, updated_at DESC`).all()
      : this.#db.prepare(
        `${LIVE_FILTER_SQL} AND subject = ? ORDER BY confidence DESC, updated_at DESC`,
      ).all(subject)
    return rows.map(toRecord)
  }

  /**
   * 查重扫描面(Memory 门面四操作决策用,19 号 §3-T2.4):给定一次 prospective
   * 写入,取**同 scope+kind** 的全部 live 行。不过滤 review_state——查重是内容层
   * 去重,pending 行同样构成「既有记忆」;domain scope 按 domain_key 限定(域之间
   * 独立,18 §1.3);user/legacy-org 不按 subject 分(存量 user:<名> 行与新 'user'
   * 行同属用户画像层)。排序 confidence → updated_at → id,调用方取首个最大重叠即稳定。
   */
  liveRowsForDedup(prospective: {
    readonly subject: string
    readonly scope?: EntityScope
    readonly kind?: EntityKind
    readonly domainKey?: string
  }): readonly EntityRecord[] {
    this.#assertOpen()
    const scope = assertOneOf('scope', prospective.scope, 'domain', ENTITY_SCOPES)
    const kind = assertOneOf('kind', prospective.kind, 'semantic', ENTITY_KINDS)
    const domainKey = resolveDomainKey(prospective.domainKey, scope, prospective.subject)
    const rows = scope === 'domain'
      ? this.#db.prepare(
        'SELECT * FROM memory_entity WHERE invalid_at IS NULL AND scope = ? AND kind = ? AND domain_key = ?'
        + ' ORDER BY confidence DESC, updated_at DESC, id DESC',
      ).all(scope, kind, domainKey)
      : this.#db.prepare(
        'SELECT * FROM memory_entity WHERE invalid_at IS NULL AND scope = ? AND kind = ?'
        + ' ORDER BY confidence DESC, updated_at DESC, id DESC',
      ).all(scope, kind)
    return rows.map(toRecord)
  }

  /**
   * 单域 live 行数(M-M2 T8 Gm0 容量闸用,19 号 §4-T8):scope='domain' + 解析后
   * domain_key 的 live 行计数(invalid_at IS NULL)。不过滤 review_state——容量
   * 口径与查重面(liveRowsForDedup)一致:pending 行同样占用单域上限。仅 domain
   * 作用域有意义,prospective 的 scope 固定按 'domain' 解析域键。
   */
  countLiveInDomain(prospective: { readonly subject: string; readonly domainKey?: string }): number {
    this.#assertOpen()
    const domainKey = resolveDomainKey(prospective.domainKey, 'domain', prospective.subject)
    const row = this.#db.prepare(
      "SELECT COUNT(*) AS n FROM memory_entity WHERE invalid_at IS NULL AND scope = 'domain' AND domain_key = ?",
    ).get(domainKey)
    return toNumber(row?.['n'])
  }

  /**
   * 评审队列读取(19 号 §3-T2.6:管理面专用,不经模型工具):按 review_state 取行
   * (pending 待审队列 / rejected 审计;含已软失效行——物理行留档可审计),
   * 排序 updated_at DESC → id DESC。默认上限 100。
   */
  listForReview(state: EntityReviewState, limit = 100): readonly EntityRecord[] {
    this.#assertOpen()
    return this.#db.prepare(
      'SELECT * FROM memory_entity WHERE review_state = ? ORDER BY updated_at DESC, id DESC LIMIT ?',
    ).all(state, limit).map(toRecord)
  }

  /**
   * Gm1 软失效入口(19 号 §3-T2.7):live 行打 invalid_at(被更优提案顶替),
   * 不动 review_state(区别于 review(id,'rejected') 的人审拒绝)与 updated_at
   * (时效锚点是内容变更)。行不存在或已非 live 返回 null。事务内执行。
   */
  supersede(id: number): EntityRecord | null {
    this.#assertOpen()
    let updated: EntityRecord | null = null
    this.#transaction(() => {
      const existing = this.#db.prepare('SELECT * FROM memory_entity WHERE id = ?').get(id)
      if (existing === undefined || toRecord(existing).invalidAt !== null) return
      this.#db.prepare('UPDATE memory_entity SET invalid_at = ? WHERE id = ?').run(this.#now(), id)
      const after = this.#db.prepare('SELECT * FROM memory_entity WHERE id = ?').get(id)
      if (after !== undefined) updated = toRecord(after)
    })
    return updated
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

  /**
   * 评审落定(M-M1 T1 数据层;Memory 门面与审批链路在 T2/T9 接):
   * - approved:review_state 置 approved(待审行转生效;不动 invalid_at——
   *   已软失效的行不因批准复活,复活走 write 顶替);
   * - rejected:打 invalid_at 软失效(物理行保留可审计,检索/索引不可再得;
   *   区别于 forget 的真删)。
   * 不动 updated_at(时效锚点是内容变更,评审/命中强化不是——T3 半衰期依赖)。
   * 行不存在返回 null。事务内执行。
   */
  review(id: number, decision: EntityReviewDecision): EntityRecord | null {
    this.#assertOpen()
    let updated: EntityRecord | null = null
    this.#transaction(() => {
      const existing = this.#db.prepare('SELECT * FROM memory_entity WHERE id = ?').get(id)
      if (existing === undefined) return
      if (decision === 'rejected') {
        this.#db.prepare("UPDATE memory_entity SET review_state = 'rejected', invalid_at = COALESCE(invalid_at, ?) WHERE id = ?")
          .run(this.#now(), id)
      } else {
        this.#db.prepare("UPDATE memory_entity SET review_state = 'approved' WHERE id = ?").run(id)
      }
      const after = this.#db.prepare('SELECT * FROM memory_entity WHERE id = ?').get(id)
      if (after !== undefined) updated = toRecord(after)
    })
    return updated
  }

  /**
   * 命中强化(MemoryBank S+=1,18 §4.2):live 行 use_count+1、last_used_at=now。
   * 只作用 live 行(软失效/历史行不强化);同批重复 id 去重(一次调用至多计一次);
   * 不动 updated_at(理由同 review)。返回实际强化的行数。事务内执行。
   */
  touch(ids: readonly number[]): number {
    this.#assertOpen()
    if (ids.length === 0) return 0
    const now = this.#now()
    let touched = 0
    this.#transaction(() => {
      const bump = this.#db.prepare(
        'UPDATE memory_entity SET use_count = use_count + 1, last_used_at = ? WHERE id = ? AND invalid_at IS NULL',
      )
      for (const id of new Set(ids)) touched += Number(bump.run(now, id).changes)
    })
    return touched
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

/** 检索/索引默认过滤口径(18 §3.2:live + approved + 非 legacy-org)。 */
const LIVE_FILTER_SQL = 'SELECT * FROM memory_entity WHERE invalid_at IS NULL AND review_state = \'approved\' AND scope != \'legacy-org\''

/**
 * 存量 subject 前缀推断(19 号 §3-T1 四分支):user:*→scope=user(subject 不动);
 * project:*→domain+改写 subject 为 domain:<原名>;org:*→legacy-org(只留档);
 * 无前缀(含空前缀残余,如 'user:')→domain:default(subject 不动)。
 * 仅在开库迁移调用一次,新写入走 EntityWriteInput 显式编码。
 */
function classifyLegacySubject(subject: string): { subject: string; scope: EntityScope; domainKey: string | null } {
  if (hasLegacyPrefix(subject, 'user:')) return { subject, scope: 'user', domainKey: null }
  if (hasLegacyPrefix(subject, 'project:')) {
    const name = subject.slice('project:'.length)
    return { subject: `domain:${name}`, scope: 'domain', domainKey: name }
  }
  if (hasLegacyPrefix(subject, 'org:')) return { subject, scope: 'legacy-org', domainKey: null }
  // 新编码防改写(defensive,2026-11-15 修复):user_version 被重置的库(备份恢复/
  // 手工建库后首开)重跑迁移时,已按新编码写入的行不得被下方 default 分支改写
  // domain_key——曾实测把 'domain:deploy'+domain_key='deploy' 的行改成 'default',
  // 导致面板域待审计数归零。域键保持原样不加 kebab 校验:迁移原则是不改写好行、
  // 不炸库;非 kebab 旧值的新写入仍被 resolveDomainKey 写入面校验拦住。
  if (subject === 'user') return { subject, scope: 'user', domainKey: null }
  if (subject.startsWith('domain:') && subject.length > 'domain:'.length) {
    return { subject, scope: 'domain', domainKey: subject.slice('domain:'.length) }
  }
  return { subject, scope: 'domain', domainKey: 'default' }
}

/** 前缀命中且残余名非空('user:' 空名视同无前缀,归 default 域)。 */
function hasLegacyPrefix(subject: string, prefix: string): boolean {
  return subject.startsWith(prefix) && subject.length > prefix.length
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
    kind: toEnum('kind', row['kind'], ENTITY_KINDS),
    scope: toEnum('scope', row['scope'], ENTITY_SCOPES),
    domainKey: row['domain_key'] === null ? null : toStringValue(row['domain_key']),
    reviewState: toEnum('review_state', row['review_state'], ENTITY_REVIEW_STATES),
    originSessionId: row['origin_session_id'] === null ? null : toStringValue(row['origin_session_id']),
    originTurnRef: row['origin_turn_ref'] === null ? null : toStringValue(row['origin_turn_ref']),
    source: toEnum('source', row['source'], ENTITY_SOURCES),
    lastUsedAt: row['last_used_at'] === null ? null : toNumber(row['last_used_at']),
    useCount: toNumber(row['use_count']),
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

/** 枚举列收窄(不合法值抛错暴露 schema 漂移/手改库)。 */
function toEnum<T extends string>(field: string, value: SQLOutputValue | undefined, allowed: readonly T[]): T {
  const text = toStringValue(value)
  if ((allowed as readonly string[]).includes(text)) return text as T
  throw new TypeError(`[memory] sqlite 列 ${field} 出现未知枚举值:${text}`)
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

/** 入参枚举校验:缺省取 fallback,非法值拒绝(写入面 fail-closed)。 */
function assertOneOf<T extends string>(field: string, value: T | undefined, fallback: T, allowed: readonly T[]): T {
  const chosen = value ?? fallback
  if (!(allowed as readonly string[]).includes(chosen)) {
    throw new RangeError(`[memory] ${field} 必须是 ${allowed.join('|')} 之一,得到:${chosen}`)
  }
  return chosen
}

/**
 * 域键确定性收敛 kebab-case(小写 + 非 [a-z0-9] 连串折 '-',去首尾 '-',≤64):
 * 模型/配置偶发大小写与空白不整条丢弃;收敛为空(如纯中文/纯符号)返回 undefined
 * 交调用方定夺(T10 打标解析视作无标签,workspace 显式域回落稳定哈希键)。
 * 单源口径:extraction.ts 提案域键、domain.ts 打标解析共用,禁止各写一份。
 */
export function coerceDomainKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const kebab = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
  return kebab.length > 0 ? kebab : undefined
}

/**
 * domainKey 解析:仅 scope='domain' 可携带(其余 scope 携带即拒绝);
 * 缺省时从 subject 的 `domain:<键>` 编码推导,再缺省落 'default'
 * (与存量无前缀迁移分支同语义)。导出供 Memory 门面(Gm0 容量闸)复用同口径。
 */
export function resolveDomainKey(domainKey: string | undefined, scope: EntityScope, subject: string): string | null {
  if (scope !== 'domain') {
    if (domainKey !== undefined) {
      throw new RangeError(`[memory] domainKey 仅 scope='domain' 可携带,当前 scope:${scope}`)
    }
    return null
  }
  if (domainKey !== undefined) return validateDomainKey(domainKey)
  if (subject.startsWith('domain:')) {
    const derived = subject.slice('domain:'.length)
    if (derived.length > 0) return validateDomainKey(derived)
  }
  return 'default'
}

function validateDomainKey(value: string): string {
  const trimmed = value.trim()
  if (!DOMAIN_KEY_PATTERN.test(trimmed)) {
    throw new RangeError(`[memory] domainKey 必须是 kebab-case(小写字母数字与连字符):${trimmed}`)
  }
  if (trimmed.length > FIELD_LIMITS.domainKey) {
    throw new RangeError(`[memory] domainKey 超长(${trimmed.length} > ${FIELD_LIMITS.domainKey})`)
  }
  return trimmed
}
