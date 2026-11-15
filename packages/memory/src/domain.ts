/**
 * 域注册表(domain_registry 表):两层记忆的功能域登记面(M-M1 T1,19 号 §3)。
 *
 * 设计依据(设计文档 18 §1.3 / §13-Q2):domain_key 两个来源——
 * - **显式 workspace**:用户选定的 workspace/项目,登记即域(信任级高),
 *   `ensureWorkspaceDomain` 直接注册,跳过打标;
 * - **语义自由域**:不预置 taxonomy(Q2 决议),LLM 打标产生候选键,
 *   `recordHit` 按「每会话至多一次」的纪律计数,**≥minSessionsForNewDomain
 *   (默认 3)个独立会话命中才转正**(防域爆炸);转正前 registered 为
 *   NULL=候选中,转正后进入 T10 打标归并的候选集(list(true))。
 *
 * org 作用域已禁用(Q1 决议,跨用户共享一律走 RSI 上升管道),本表全部挂在
 * 单用户租户内——与 memory_entity 同库同租户边界,不跨库。
 *
 * 纪律对齐 entity-store:coeffect 全声明(库路径/时钟/阈值构造注入,不碰全局);
 * 事务包 BEGIN…COMMIT,异常 ROLLBACK 后原样重抛;close 幂等。
 *
 * M-M3 T10(19 号 §5-T10)增量:会话域解析编排面——
 * - `recordSessionHit`:每会话每域至多一次的持久命中去重(`domain_hit_sessions`
 *   表,进程重启不重复计数),已注册域走 touchUsed 口径、候选/未登记键走
 *   recordHit 口径;「≥3 独立会话才转正」(Q2)的独立会话纪律由此钉死;
 * - `DOMAIN_TAGGING_PROMPT`(冻结提示词,与 tests/fixtures/domain-tagging-prompt.md
 *   逐字一致)+ `parseDomainTagOutput`(防御式三态解析)+ `resolveDomain`
 *   (workspace 显式域直注 → 打标先归并 → 候选计数/转正绑定);打标 LLM 经
 *   `DomainTagger` seam 注入(工厂 createDomainTagger 在 extraction.ts,与
 *   createGm1Judge 同层——domain 保持无 LLM 依赖的纯数据+编排层)。
 */
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue } from 'node:sqlite'
import { coerceDomainKey } from './entity-store.ts'

/** 域键来源:workspace=显式工作区;taxonomy=预置分类(Q2 决议不预置,枚举保留);free=自由域打标。 */
export type DomainSource = 'workspace' | 'taxonomy' | 'free'

/** domain_registry 一行(kebab-case 域键 + 展示名 + 计数与转正状态)。 */
export interface DomainRecord {
  /** 域键(kebab-case,≤64;subject 编码 `domain:<domain_key>` 的键位)。 */
  readonly domainKey: string
  /** 展示名(中文)。 */
  readonly label: string
  readonly source: DomainSource
  /** 注册前命中计数(候选期累计;转正后封存留档,不再递增)。 */
  readonly hitSessions: number
  /** 转正时间(epoch ms);NULL = 候选中。 */
  readonly registered: number | null
  /** 该域被会话绑定使用的次数(touchUsed 累计)。 */
  readonly sessionCount: number
  /** 该域 live 记忆条数投影(T2 写入路径维护;T1 仅建列)。 */
  readonly memoryCount: number
  /** 最近使用时刻(epoch ms)。 */
  readonly lastUsedAt: number | null
  readonly createdAt: number
}

/** 构造选项。 */
export interface DomainRegistryStoreOptions {
  /** 时钟注入(测试用;默认 Date.now)。 */
  readonly now?: () => number
  /** 候选转正阈值覆写(config domain.minSessionsForNewDomain;默认 3,Q2 决议)。 */
  readonly minSessionsForNewDomain?: number
}

/** 新域转正阈值:≥3 个独立会话命中(18 §13 Q2 决议)。 */
export const DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN = 3

const FIELD_LIMITS = { domainKey: 64, label: 128 } as const

/** 域键编码:kebab-case(小写字母数字与连字符,首尾非连字符),≤64。 */
const DOMAIN_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const DOMAIN_SOURCES: readonly DomainSource[] = ['workspace', 'taxonomy', 'free']

/**
 * 域注册表存储:一个 sqlite 库一个实例;同步 API(与 EntityMemoryStore 同款,
 * 打标/装配路径可同步取数)。建表 CREATE IF NOT EXISTS 幂等,重复开库安全。
 */
export class DomainRegistryStore {
  readonly #db: DatabaseSync
  readonly #now: () => number
  readonly #minSessions: number
  #closed = false

  constructor(dbPath: string, options: DomainRegistryStoreOptions = {}) {
    this.#db = new DatabaseSync(dbPath)
    this.#now = options.now ?? ((): number => Date.now())
    this.#minSessions = options.minSessionsForNewDomain ?? DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN
    if (!Number.isInteger(this.#minSessions) || this.#minSessions < 1) {
      this.#db.close()
      throw new RangeError(`[memory] minSessionsForNewDomain 必须是 ≥1 的整数,得到:${String(options.minSessionsForNewDomain)}`)
    }
    if (dbPath !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS domain_registry (
        domain_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        hit_sessions INTEGER NOT NULL DEFAULT 0,
        registered INTEGER,
        session_count INTEGER NOT NULL DEFAULT 0,
        memory_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS domain_hit_sessions (
        domain_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hit_at INTEGER NOT NULL,
        PRIMARY KEY (domain_key, session_id)
      );
    `)
  }

  /**
   * workspace 即显式域:登记即注册(跳过打标,18 §1.3)。
   * 重复调用 = upsert:更新 label、刷新最近使用,保留首次注册时间与既有计数;
   * 已有自由域候选经此调用升格为 workspace(hit_sessions 留档)。
   */
  ensureWorkspaceDomain(domainKey: string, label: string): DomainRecord {
    this.#assertOpen()
    const key = validateDomainKey(domainKey)
    const name = validateLabel(label)
    const now = this.#now()
    this.#db.prepare(`
      INSERT INTO domain_registry (domain_key, label, source, registered, last_used_at, created_at)
      VALUES (?, ?, 'workspace', ?, ?, ?)
      ON CONFLICT(domain_key) DO UPDATE SET
        label = excluded.label,
        source = 'workspace',
        registered = COALESCE(registered, excluded.registered),
        last_used_at = excluded.last_used_at
    `).run(key, name, now, now, now)
    return this.#mustResolve(key)
  }

  /**
   * 自由域候选命中计数(Q2:≥minSessions 个**独立会话**命中才转正;调用方
   * 按「每会话至多一次」纪律触发,store 只管计数与转正)。
   * - 未登记键:首轮即建候选行(source='free',label 缺省=域键本身);
   * - 候选中:hit_sessions+1,达到阈值置 registered 转正;
   * - 已注册:候选通道关闭(hit_sessions 封存、registered 不动),只刷新
   *   last_used_at。
   * 返回计数/转正后的最新行。事务内执行。
   */
  recordHit(candidateKey: string, label?: string): DomainRecord {
    this.#assertOpen()
    const key = validateDomainKey(candidateKey)
    return this.#transaction(() => this.#recordHitLocked(key, label))
  }

  /** recordHit 的事务内执行体(recordSessionHit 在自身事务内复用,禁止嵌套 BEGIN)。 */
  #recordHitLocked(key: string, label: string | undefined): DomainRecord {
    const now = this.#now()
    const existing = this.#select(key)
    if (existing === null) {
      this.#db.prepare(`
        INSERT INTO domain_registry (domain_key, label, source, hit_sessions, last_used_at, created_at)
        VALUES (?, ?, 'free', 1, ?, ?)
      `).run(key, label === undefined ? key : validateLabel(label), now, now)
    } else if (existing.registered === null) {
      const hitSessions = existing.hitSessions + 1
      const registered = hitSessions >= this.#minSessions ? now : null
      this.#db.prepare('UPDATE domain_registry SET hit_sessions = ?, registered = ?, last_used_at = ? WHERE domain_key = ?')
        .run(hitSessions, registered, now, key)
    } else {
      this.#db.prepare('UPDATE domain_registry SET last_used_at = ? WHERE domain_key = ?').run(now, key)
    }
    return this.#mustResolve(key)
  }

  /**
   * 会话域命中(T10,「每会话每域至多一次」的持久去重):domain_hit_sessions
   * 落 marker 行(主键 (domain_key, session_id)),进程重启后同会话重复解析
   * 不会二次计数——「≥3 **独立**会话才转正」(Q2)的纪律由持久 marker 钉死,
   * 不依赖调用方内存态。
   * - 首次:marker 落行后,已注册域按 touchUsed 口径 session_count+1;
   *   候选/未登记键走 recordHit 计数(达标即转正);
   * - 重复(该会话已对该域计过):不计数不刷新,仅回读当前行。
   * 事务内执行;label 仅未登记键首建时生效(既有行不改 label)。
   */
  recordSessionHit(domainKey: string, sessionId: string, label?: string): { readonly counted: boolean; readonly record: DomainRecord } {
    this.#assertOpen()
    const key = validateDomainKey(domainKey)
    const session = validateSessionId(sessionId)
    return this.#transaction(() => {
      const marker = this.#db
        .prepare('SELECT hit_at FROM domain_hit_sessions WHERE domain_key = ? AND session_id = ?')
        .get(key, session)
      if (marker !== undefined) {
        return { counted: false as const, record: this.#mustResolve(key) }
      }
      this.#db.prepare('INSERT INTO domain_hit_sessions (domain_key, session_id, hit_at) VALUES (?, ?, ?)')
        .run(key, session, this.#now())
      const existing = this.#select(key)
      if (existing !== null && existing.registered !== null) {
        // 已注册域:会话绑定计数(touchUsed 同口径;不进候选通道)
        this.#db.prepare('UPDATE domain_registry SET session_count = session_count + 1, last_used_at = ? WHERE domain_key = ?')
          .run(this.#now(), key)
        return { counted: true as const, record: this.#mustResolve(key) }
      }
      return { counted: true as const, record: this.#recordHitLocked(key, label) }
    })
  }

  /** 该会话对某域的最近一次命中时刻;未命中过返回 null(T13 观察面/测试用)。 */
  sessionHitAt(domainKey: string, sessionId: string): number | null {
    this.#assertOpen()
    const row = this.#db
      .prepare('SELECT hit_at FROM domain_hit_sessions WHERE domain_key = ? AND session_id = ?')
      .get(validateDomainKey(domainKey), validateSessionId(sessionId))
    if (row === undefined) return null
    const value = row['hit_at']
    if (typeof value === 'number') return value
    if (typeof value === 'bigint') return Number(value)
    throw new TypeError(`[memory] domain_hit_sessions.hit_at 列出现非数值:${String(value)}`)
  }

  /** 按域键取一行;不存在返回 null。 */
  resolve(domainKey: string): DomainRecord | null {
    this.#assertOpen()
    return this.#select(domainKey)
  }

  /**
   * 全量列表;onlyRegistered=true 只取已转正域(T10 打标「先归并」的候选集)。
   * 排序:已注册在前,组内按最近使用降序(缺省回落创建时间),键名稳定兜底。
   */
  list(onlyRegistered = false): readonly DomainRecord[] {
    this.#assertOpen()
    const order = 'ORDER BY (registered IS NULL), COALESCE(last_used_at, created_at) DESC, domain_key ASC'
    const rows = onlyRegistered
      ? this.#db.prepare(`SELECT * FROM domain_registry WHERE registered IS NOT NULL ${order}`).all()
      : this.#db.prepare(`SELECT * FROM domain_registry ${order}`).all()
    return rows.map(toDomainRecord)
  }

  /**
   * 域被会话使用:session_count+1、last_used_at=now。
   * 未登记键返回 null(不隐式建行——建行只走 ensure/recordHit 两条显式通道)。
   */
  touchUsed(domainKey: string): DomainRecord | null {
    this.#assertOpen()
    const key = validateDomainKey(domainKey)
    this.#db.prepare(
      'UPDATE domain_registry SET session_count = session_count + 1, last_used_at = ? WHERE domain_key = ?',
    ).run(this.#now(), key)
    return this.#select(key)
  }

  /** 关库(插件卸载时调用;幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[memory] DomainRegistryStore 已关闭')
  }

  #select(domainKey: string): DomainRecord | null {
    const row = this.#db.prepare('SELECT * FROM domain_registry WHERE domain_key = ?').get(domainKey)
    return row === undefined ? null : toDomainRecord(row)
  }

  /** 写入路径回读(行必在;守卫仅为类型收窄,不掩盖逻辑缺口)。 */
  #mustResolve(domainKey: string): DomainRecord {
    const row = this.#db.prepare('SELECT * FROM domain_registry WHERE domain_key = ?').get(domainKey)
    if (row === undefined) throw new Error('[memory] 内部错误:域行写入后不可读')
    return toDomainRecord(row)
  }

  /** 事务包装:异常 ROLLBACK 后原样重抛(与 entity-store 同款,带回传值)。 */
  #transaction<T>(body: () => T): T {
    this.#db.exec('BEGIN')
    try {
      const result = body()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}

/** sqlite 行 → DomainRecord(运行期类型收窄;不合法形态抛错暴露 schema 漂移)。 */
function toDomainRecord(row: Record<string, SQLOutputValue>): DomainRecord {
  return {
    domainKey: toStringValue(row['domain_key']),
    label: toStringValue(row['label']),
    source: toEnum('source', row['source'], DOMAIN_SOURCES),
    hitSessions: toNumber(row['hit_sessions']),
    registered: row['registered'] === null ? null : toNumber(row['registered']),
    sessionCount: toNumber(row['session_count']),
    memoryCount: toNumber(row['memory_count']),
    lastUsedAt: row['last_used_at'] === null ? null : toNumber(row['last_used_at']),
    createdAt: toNumber(row['created_at']),
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

function toEnum<T extends string>(field: string, value: SQLOutputValue | undefined, allowed: readonly T[]): T {
  const text = toStringValue(value)
  if ((allowed as readonly string[]).includes(text)) return text as T
  throw new TypeError(`[memory] sqlite 列 ${field} 出现未知枚举值:${text}`)
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

function validateLabel(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new RangeError('[memory] label 不能为空')
  if (trimmed.length > FIELD_LIMITS.label) throw new RangeError(`[memory] label 超长(${trimmed.length} > ${FIELD_LIMITS.label})`)
  return trimmed
}

function validateSessionId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new RangeError('[memory] sessionId 不能为空')
  if (trimmed.length > SESSION_ID_MAX_CHARS) {
    throw new RangeError(`[memory] sessionId 超长(${trimmed.length} > ${SESSION_ID_MAX_CHARS})`)
  }
  return trimmed
}

/** sessionId 上限(dsh SessionId 为 uuid 形态;余量容忍测试自拟 id)。 */
const SESSION_ID_MAX_CHARS = 128

// ---------- M-M3 T10:会话域解析(19 号 §5-T10 + 18 §1.3/§13-Q2) ----------
//
// resolveDomain({ workspaceName?, firstUserMessage?, registry, sessionId }) 的
// 优先级与纪律(19 号原文):
// 1. workspace 显式域(18 §1.2「workspace 即显式域,登记即域」)→ 跳过打标直接
//    注册(ensureWorkspaceDomain),会话即绑定;键 ASCII kebab 收敛,纯非 ASCII
//    名回落 `ws-<FNV-1a 8hex>` 稳定键(label 保留原名,面板可读);
// 2. 打标先归并:LLM(DomainTagger seam,工厂 createDomainTagger 在 extraction.ts)
//    从 domain_registry **已注册域**候选集中选(可空,即 list(true));
// 3. 无匹配 → 候选键(kebab-case)recordHit 计数,**≥3 独立会话才转正**(Q2)——
//    「独立会话」由 recordSessionHit 的持久 marker 钉死;候选期**不绑定**(无索引
//    域区、episodic 不落该域),转正当次起绑定;
// 4. 归并命中已注册域 → 绑定并 session_count+1。
//
// 绑定结果(bound=true)供 glue 两处消费:索引上下文 domainKey(T3 参数)与
// episodic 记录的域归属盖章(18 §1.3「域归属同时写入会话元数据」)。

/** 打标直调的输出 token 上限(单行 JSON 对象,余量容忍前后杂文)。 */
export const DEFAULT_DOMAIN_TAG_MAX_TOKENS = 128

/** 打标候选清单上限(list(true) 按最近使用排序截头,防提示词随域数膨胀)。 */
export const DOMAIN_TAG_CANDIDATE_LIMIT = 50

/** 打标消息字符上限(首条用户消息只取开头——域归属主要由消息主题决定)。 */
export const DOMAIN_TAG_MESSAGE_MAX_CHARS = 4_000

/**
 * 会话域打标提示词(冻结,system 位;与 tests/fixtures/domain-tagging-prompt.md
 * 逐字一致,单测钉住)。输出三态:归并已注册域 {"match":…} / 提议新域
 * {"new":{key,label}} / 不打标 {}。改动必须同步 fixture,不得只改一处。
 */
export const DOMAIN_TAGGING_PROMPT = [
  '# 会话域打标(curator,域检测与注册)',
  '',
  '你是会话域打标器。判断下方的「首条用户消息」属于哪个功能域(如部署、合同审查、内容发布这类可跨会话复用的主题域)。你没有工具、没有文件系统访问权,也不需要任何验证:只用给出的材料判断,不得引用或臆造材料之外的信息,不得假装已查证。',
  '',
  '## 打标纪律',
  '',
  '- 先归并:若消息主题落在「已注册域清单」中的某个域,必须选它,不得另起新名或近似变体。',
  '- 只有消息围绕一个明确、可跨会话复用的主题域,且不在清单中时,才提议新域;域要概括主题,不要复述消息细节。',
  '- 闲聊、单次小任务、上下文不足无法判断主题的消息,不要打标。',
  '',
  '## 输出格式(严格)',
  '',
  '输出有且仅有一个 JSON 对象,不附带任何其他文字、注释或代码块围栏:',
  '- 归并到已注册域:{"match":"deploy"}',
  '- 提议新域:{"new":{"key":"contract-review","label":"合同审查"}}(key 为 kebab-case 小写字母数字与连字符,≤64;label 为简短中文展示名)',
  '- 不打标:{}',
].join('\n')

/** 打标 LLM seam(注入,免库内依赖 ctx.llm):一次直调返回模型原文。 */
export type DomainTagger = (input: DomainTaggerInput) => Promise<string>

/** 打标直调入参(首条用户消息 + 已注册域候选集)。 */
export interface DomainTaggerInput {
  readonly firstUserMessage: string
  readonly registeredDomains: readonly DomainRecord[]
}

/** 打标输出解析三态(match=归并已注册域 / new=提议新域 / none=不打标)。 */
export type DomainTagParse =
  | { readonly kind: 'match'; readonly domainKey: string }
  | { readonly kind: 'new'; readonly domainKey: string; readonly label?: string }
  | { readonly kind: 'none' }

/** 打标输出整体不可解析(无任何 JSON 对象可抢救):上抛交调用方按失败处理。 */
export class DomainTagParseError extends Error {
  override name = 'DomainTagParseError'
  constructor(detail: string) {
    super(`[memory] 会话域打标输出不可解析:${detail}`)
  }
}

/**
 * 解析打标输出(extraction.parseExtractionOutput 同款防御式口径):抢救首个
 * JSON 对象(原文 → 代码块围栏 → 首尾大括号切片),match/new 域键经
 * coerceDomainKey 收敛(收敛失败视作 none——模型给了不可用键等同没给);
 * new.label 空白丢弃(回落域键)。结构坏(无 JSON 对象)→ DomainTagParseError。
 */
export function parseDomainTagOutput(text: string): DomainTagParse {
  const value = parseLooseJsonObject(text.trim())
  if (value === undefined) throw new DomainTagParseError(previewOf(text))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainTagParseError(`顶层不是 JSON 对象:${previewOf(text)}`)
  }
  const record = value as Record<string, unknown>
  const match = record['match']
  if (typeof match === 'string') {
    const key = coerceDomainKey(match)
    return key === undefined ? { kind: 'none' } : { kind: 'match', domainKey: key }
  }
  const proposed = record['new']
  if (typeof proposed === 'object' && proposed !== null && !Array.isArray(proposed)) {
    const key = coerceDomainKey((proposed as Record<string, unknown>)['key'])
    if (key === undefined) return { kind: 'none' }
    const rawLabel = (proposed as Record<string, unknown>)['label']
    const label = typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : undefined
    return { kind: 'new', domainKey: key, ...(label !== undefined && { label }) }
  }
  return { kind: 'none' }
}

/** 抢救式 JSON 对象解析:原文 → 代码块围栏内 → 首尾大括号切片,逐候选尝试。 */
function parseLooseJsonObject(trimmed: string): unknown {
  const candidates: string[] = [trimmed]
  const fence = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 尝试下一个候选形态
    }
  }
  return undefined
}

/** 错误信息用的输出预览(截长,避免异常文本淹没日志)。 */
function previewOf(text: string): string {
  const chars = Array.from(text)
  return chars.length <= 80 ? chars.join('') : `${chars.slice(0, 80).join('')}…`
}

/**
 * 打标直调 user 消息正文:首条用户消息(超长截头并注明)+ 已注册域清单
 * (`- key:label`,按 list(true) 排序=最近使用优先;空清单给 `(无)` 占位,
 * 提示词引用不悬空)。
 */
export function buildDomainTaggingUserText(input: DomainTaggerInput): string {
  const domains = input.registeredDomains.slice(0, DOMAIN_TAG_CANDIDATE_LIMIT)
  const lines = domains.map(row => `- ${row.domainKey}:${row.label}`)
  if (input.registeredDomains.length > domains.length) {
    lines.push(`- ……(另有 ${input.registeredDomains.length - domains.length} 个已注册域省略)`)
  }
  const message = fitTagMessage(input.firstUserMessage)
  return [
    '## 首条用户消息(只依据以下材料判断)',
    message.length === 0 ? '(空消息)' : message,
    '',
    '## 已注册域清单(先归并:命中其一输出 match)',
    lines.length === 0 ? '(无)' : lines.join('\n'),
  ].join('\n')
}

/** 首条消息截头(码点切片防劈代理对;超限尾部注明,保留开头主题)。 */
function fitTagMessage(text: string): string {
  const chars = Array.from(text.trim())
  if (chars.length <= DOMAIN_TAG_MESSAGE_MAX_CHARS) return chars.join('')
  return `${chars.slice(0, DOMAIN_TAG_MESSAGE_MAX_CHARS).join('')}\n(消息过长,已截断)`
}

/**
 * workspace 显式域键(18 §1.2「workspace id 直接作为 domain_key」):ASCII kebab
 * 收敛;纯非 ASCII 名(中文工作区名常见)收敛为空时回落 `ws-<FNV-1a 8hex>`——
 * 确定性稳定(重启/重挂载不变),label 保留原名(中文展示名走 label 位)。
 */
export function workspaceDomainKey(name: string): string {
  const kebab = coerceDomainKey(name.trim())
  if (kebab !== undefined) return kebab
  return `ws-${fnv1aHex(name.trim())}`
}

/** FNV-1a 32 位(稳定性优先于抗碰撞;用途是工作区名的稳定键后缀)。 */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ---------- resolveDomain(编排) ----------

/** resolveDomain 入参(19 号 §5-T10 原形:{ workspaceName?, firstUserMessage?, registry } + sessionId)。 */
export interface DomainResolutionInput {
  readonly registry: DomainRegistryStore
  /** 会话 id(每会话至多一次计数的持久去重键,recordSessionHit 消费)。 */
  readonly sessionId: string
  /** 显式 workspace 域名(存在且非空白 → 跳过打标直接注册,18 §1.2)。 */
  readonly workspaceName?: string
  /** 首条用户消息(打标材料;空白 → 无域上下文)。 */
  readonly firstUserMessage?: string
}

/** 解析来源:workspace=显式域 / merged=归并已注册域 / promoted=本次计数触发转正 / candidate=候选计数(未绑定)/ none=无域。 */
export type DomainResolutionSource = 'workspace' | 'merged' | 'promoted' | 'candidate' | 'none'

/** 会话域解析结果(bound 才可注入索引上下文与 episodic 域归属;domainKey 候选期也返回,供观测/测试)。 */
export interface DomainResolution {
  readonly domainKey: string | null
  readonly label: string | null
  readonly source: DomainResolutionSource
  /** 绑定与否:绑定 = 索引 domainKey 注入 + episodic 记录域归属盖章。 */
  readonly bound: boolean
  /** 本次是否实际计数(每会话去重后;重复解析 counted=false)。 */
  readonly counted: boolean
}

const NONE_RESOLUTION: DomainResolution = {
  domainKey: null,
  label: null,
  source: 'none',
  bound: false,
  counted: false,
}

/** resolveDomain 可选项(候选清单上限可注入,测试用;缺省 DOMAIN_TAG_CANDIDATE_LIMIT)。 */
export interface DomainResolveOptions {
  readonly maxCandidates?: number
}

/**
 * 会话域解析(T10 主入口):workspace 显式域直注 → 首条用户消息打标(先归并
 * 已注册域,无匹配计数候选)→ 绑定/候选判定。tagger 缺席或消息空白 → 无域
 * 上下文(索引退回单区锚点形态,行为与 T10 之前一致)。打标调用/解析失败原样
 * 上抛(glue 按「本条消息解析失败,下一条重试」处理;计数由持久 marker 挡重复,
 * 重试不会多计)。
 */
export async function resolveDomain(
  input: DomainResolutionInput,
  tagger?: DomainTagger,
  options: DomainResolveOptions = {},
): Promise<DomainResolution> {
  const { registry, sessionId } = input
  validateSessionId(sessionId)
  const workspaceName = input.workspaceName?.trim()
  if (workspaceName !== undefined && workspaceName.length > 0) {
    // 显式域:登记即注册(重复 ensure 幂等),每会话一次绑定计数
    const key = workspaceDomainKey(workspaceName)
    const record = registry.ensureWorkspaceDomain(key, workspaceName)
    const hit = registry.recordSessionHit(key, sessionId)
    return { domainKey: key, label: record.label, source: 'workspace', bound: true, counted: hit.counted }
  }
  const message = input.firstUserMessage?.trim() ?? ''
  if (message.length === 0 || tagger === undefined) return NONE_RESOLUTION
  const candidates = registry.list(true).slice(0, options.maxCandidates ?? DOMAIN_TAG_CANDIDATE_LIMIT)
  const output = await tagger({ firstUserMessage: message, registeredDomains: candidates })
  const parsed = parseDomainTagOutput(output)
  if (parsed.kind === 'none') return NONE_RESOLUTION
  const key = parsed.domainKey
  // 先归并:仅已注册行可归并绑定;候选/未知键(含模型给清单外的键)一律走
  // 计数通道——不信任模型对未注册键的「归并」宣称
  const row = registry.resolve(key)
  const wasRegistered = row !== null && row.registered !== null
  const fallbackLabel = row?.label ?? key
  const label = parsed.kind === 'new' && parsed.label !== undefined ? parsed.label : fallbackLabel
  const hit = registry.recordSessionHit(key, sessionId, wasRegistered ? undefined : label)
  const after = hit.record
  if (after.registered !== null) {
    return {
      domainKey: key,
      label: after.label,
      source: wasRegistered ? 'merged' : 'promoted',
      bound: true,
      counted: hit.counted,
    }
  }
  // 候选期:计数留档但不绑定(无索引域区、episodic 不落该域,防未转正域膨胀)
  return { domainKey: key, label, source: 'candidate', bound: false, counted: hit.counted }
}
