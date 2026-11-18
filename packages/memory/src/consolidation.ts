/**
 * M-M2 T6 整固 job 骨架(19 号 §4-T6):事件触发 / 三门控 / 单 running+latest-pending
 * 调度 / 会话粒度游标 / 快照冻结 / session close 先 abort 后有界 drain。
 *
 * 设计依据(19 号 §4-T6 + 17 号 §2.4 Zcode extraction 先例 + 19a 号 S1 勘察结论):
 * - 触发:dsh 无 session/end 事件(S1-B),主触发用 session/event 里的
 *   `turn/end`(data.reason.kind === 'completed')推进会话粒度游标;
 *   `session/disposed` 只作 teardown 兜底(→ abandonSession,abort 语义)。
 *   本文件是纯库:事件订阅在 glue 层(monitor 形态见 attachConsolidation 的
 *   调用方 packages/glue/src/plugins/memory-plugin.ts),库内只承载可测的状态机。
 * - 三门控(顺序固定,任一 skip 即推进游标——skip 是已决策,不是待重试):
 *   1. direct-write:会话段内存在 memory_write 调用 → skip(防双写,19 §1.3-3);
 *   2. no-user-prose:无 ≥3 词独立用户文本 → skip(纯工具轮/注入轮没有可提取的
 *      用户表达;词数口径与查重分词同源:CJK 逐字 + ASCII 字母数字串,「以后周报
 *      用中文」= 7 词——E2E 前提,M-M2 验收样例);
 *   3. 凭据红线:会话触发过审批卡(approval/asked,含凭据护栏/红线审批)→ skip
 *      (Zcode 单轮跳过逃生口同款;governance ask 决策经宿主审批面落
 *      approval/asked 会话事件)。
 * - 游标:新表 consolidation_cursor(session_id 主键, done_at),云端按会话粒度,
 *   不做消息级 cursor(19 号原文:会话即租户工作单元,本产品无 rewind 功能面)。
 *   done_at 单调不回拨;success/no-op/skip 推进,error/abort 不推进(17 号 §2.4
 *   cursor 语义);done_at ≥ 本次会话尾标记(endedAt)→ already-done 不重跑,
 *   更晚的新标记不被旧游标挡住。
 * - 调度:单 running + 单 latest-pending(覆盖合并,无 FIFO,Zcode extraction
 *   scheduler 同款);被顶掉的 pending 视为调度级 skip(推进其游标);running
 *   完成(error 也算)后 pending 立即接续。
 * - 快照冻结:调度时冻结 session log 路径 + 会话元数据 + 门控事实,消费时不重查
 *   (Object.freeze 深冻结;活面事实后续累积不影响已冻结任务)。
 * - session close:先 abort 在跑整固再释放,drain 上界默认 60s(drainTimeoutMs
 *   可注小值测试);abort/丢弃的 pending 均不推进游标,留待下次会话尾重试。
 * - 提取执行体(T7)经 ConsolidationTask seam 注入;T6 骨架默认任务 =
 *   SKELETON_CONSOLIDATION_TASK(恒 nothing-to-save,不落库不推卡片)。
 *
 * M-M3 T11(19 号 §5-T11 + 19a 号 S4 结论 B)增量——重量 Dream 触发面:
 * - schedule seam 判定不可用(S4-B:dsh-schedule 语义是「把指令 prompt 投递进
 *   会话」,与库内冻结 prompt 直调正面冲突;dsh-jobs 无 cron 且随进程消亡),
 *   周期触发采退路「会话尾触发 + 时间阈值合并」:轻量链落定后由 glue 调
 *   maybeEnqueueDream,`now - lastDreamAt ≥ intervalMs`(默认 24h;19 §6
 *   `dream.cron` 键降级解释为间隔小时数)才入调度;
 * - lastDreamAt 落 consolidation_cursor 的 'dream' 伪会话行(S4-B「consolidation
 *   元数据行,与 consolidation_cursor 同库同租户边界」的落点):调度器在任务
 *   完成时按既有 markDone 语义推进(MAX 原子 upsert = 原子更新 lastDreamAt),
 *   error/abort 不推进待下次会话尾补跑——T6 游标纪律逐字复用;
 * - Dream 与会话整固共用同一调度器(单 running + latest-pending 覆盖合并):
 *   被顶掉的 dream pending **不推进游标**(否则 lastDreamAt 被虚假推进,Dream
 *   白白延后一个周期);dream 无会话事实,不过三门控;
 * - 快照带 jobKind('session'|'dream')供任务路由;windowStart 供 Gather 窄读
 *   (自 lastDreamAt 起,首跑回落 now-interval)。
 *
 * 纪律对齐 entity-store/domain:coeffect 全声明(库路径/时钟/超时构造注入);
 * 事务包 BEGIN…COMMIT;close 幂等。事件解析全部防御式(isRecord 弱收窄,
 * governance/audit.ts 同款)——库不信任宿主事件形状。
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MEMORY_TOOL_NAMES } from './tools.ts'
import { dedupTokens } from './memory.ts'

/** 会话粒度游标表名(与 memory_entity 同库,tenant-scan 随 dbPath 覆盖)。 */
const CURSOR_TABLE = 'consolidation_cursor'

/** no-user-prose 门的独立用户文本词数下限(19 号 §4-T6:「无 ≥3 词 → skip」)。 */
export const MIN_USER_PROSE_WORDS = 3

/** session close 后等待在跑整固收尾的上界(19 号 §4-T6:60s drain)。 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 60_000

// ---------- M-M3 T11:重量 Dream 触发面(S4-B 退路) ----------

/**
 * Dream 伪会话 id:consolidation_cursor 里以它为主键的行即 lastDreamAt 元数据行
 * (S4-B 退路)。dsh 会话 id 形态为 uuid / `session-<n>`(S1-D),'dream' 不会与
 * 真实会话冲突;任务路由另由快照 jobKind='dream' 判定,不依赖键名巧合。
 */
export const DREAM_CURSOR_SESSION_ID = 'dream'

/**
 * 全局蒸馏伪会话 id(M-M4 Phase A,18 §8):consolidation_cursor 里以它为主键
 * 的行即 lastDistillAt 元数据行。与 'dream' 同款语义——'distill' 不会与真实
 * 会话冲突;任务路由由快照 jobKind='distill' 判定,不依赖键名巧合。
 */
export const DISTILL_CURSOR_SESSION_ID = 'distill'

/** Dream 默认间隔小时数(19 §6 `dream.cron` 键降级解释,18 §6「如每日」)。 */
export const DEFAULT_DREAM_INTERVAL_HOURS = 24

/** 全局蒸馏默认间隔小时数(M-M4 Phase A,与 Dream 同款缺省 24h)。 */
export const DEFAULT_DISTILL_INTERVAL_HOURS = 24

const MS_PER_HOUR = 3_600_000

/**
 * Dream 间隔毫秒数(`dream.cron` 键降级语义:数值 = 间隔小时数,键名保留待上游
 * 出现真 cron 面再启用)。非法值(≤0 / 非有限数)回落默认 24h——配置面宽松,
 * 坏值不炸宿主。
 */
export function dreamIntervalMs(hours?: number): number {
  if (hours === undefined || !Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_DREAM_INTERVAL_HOURS * MS_PER_HOUR
  }
  return hours * MS_PER_HOUR
}

// ---------- 三门控事实(活面累积面,S1 结论 C) ----------

/** 三门控判定所需的最小会话事实(glue 层从 session/event 流累积)。 */
export interface SessionGateFacts {
  /** 会话段内 memory_write 工具调用次数(>0 → direct-write skip,防双写)。 */
  readonly memoryWriteCalls: number
  /** 会话内单条独立用户文本的最大词数(<3 → no-user-prose skip)。 */
  readonly maxUserProseWords: number
  /** approval/asked 事件数(>0 → 凭据红线 skip)。 */
  readonly approvalAsks: number
}

/** 门控 skip 原因(顺序即判定顺序:direct-write → no-user-prose → credential-redline)。 */
export type ConsolidationSkipReason = 'direct-write' | 'no-user-prose' | 'credential-redline'

/** 事件信封的弱类型视图(运行期数据,防御解析;真实类型由 dsh-session 增广在 glue 侧)。 */
export interface SessionEventLike {
  readonly type?: unknown
  readonly seq?: unknown
  readonly time?: unknown
  readonly data?: unknown
}

/** 独立用户文本词数(与 memory.ts 查重分词同口径:CJK 逐字 + ASCII 字母数字串)。 */
export function countUserProseWords(text: string): number {
  return dedupTokens(text).size
}

/**
 * 三门控判定(纯函数,顺序固定):命中即返回 skip 原因,全过返回 null。
 * 顺序:direct-write(防双写)→ no-user-prose(无可提取表达)→ 凭据红线。
 */
export function evaluateSessionGates(facts: SessionGateFacts): ConsolidationSkipReason | null {
  if (facts.memoryWriteCalls > 0) return 'direct-write'
  if (facts.maxUserProseWords < MIN_USER_PROSE_WORDS) return 'no-user-prose'
  if (facts.approvalAsks > 0) return 'credential-redline'
  return null
}

/** 会话事件流 → 三门控事实的累积器(按 sessionId 分桶;防御解析,坏事件忽略不炸)。 */
export class SessionGateFactsRegistry {
  readonly #buckets = new Map<string, SessionGateFacts>()

  /** 折叠一条会话事件(facts 单调只增:计数累加、词数取最大)。 */
  observe(sessionId: string, event: SessionEventLike): void {
    if (!isRecord(event)) return
    const current = this.factsOf(sessionId)
    let { memoryWriteCalls, maxUserProseWords, approvalAsks } = current
    switch (event['type']) {
      case 'tool/call': {
        const data = event['data']
        if (isRecord(data) && data['name'] === MEMORY_TOOL_NAMES[0]) memoryWriteCalls += 1
        break
      }
      case 'user/message': {
        const data = event['data']
        // 只认真人类消息(source.kind === 'user');合成注入(file-change/skill/cron
        // 等)不是用户表达,不计入 prose 门(dsh-llm MessageSourceMap:用户消息
        // 可携带任意 producer kind,consumers fall through unknown kinds)。
        if (isRecord(data) && isRecord(data['source']) && data['source']['kind'] === 'user') {
          maxUserProseWords = Math.max(maxUserProseWords, countUserProseWords(userTextOf(data)))
        }
        break
      }
      case 'approval/asked': {
        approvalAsks += 1
        break
      }
      default:
        break
    }
    const next: SessionGateFacts = { memoryWriteCalls, maxUserProseWords, approvalAsks }
    if (next.memoryWriteCalls === current.memoryWriteCalls
      && next.maxUserProseWords === current.maxUserProseWords
      && next.approvalAsks === current.approvalAsks) return
    this.#buckets.set(sessionId, next)
  }

  /** 该会话的当前事实(无记录返回零事实;返回冻结副本,防外部篡改累积态)。 */
  factsOf(sessionId: string): SessionGateFacts {
    const stored = this.#buckets.get(sessionId)
    return stored === undefined
      ? Object.freeze({ memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 })
      : Object.freeze({ ...stored })
  }

  /** 摘除单会话(session/disposed 兜底:会话已走,事实不再需要)。 */
  clear(sessionId: string): void {
    this.#buckets.delete(sessionId)
  }
}

/** UserMessage 的 text 块拼接(content 为 ContentBlock[];非 text 块不贡献 prose)。 */
function userTextOf(message: Record<string, unknown>): string {
  const blocks = message['content']
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts.join(' ')
}

/**
 * user/message 事件 → 真人类文本(导出面,M-M3 T10 域解析复用同口径):只认
 * source.kind === 'user'(合成注入 file-change/skill/cron 不是用户表达);
 * 其余事件/无文本返回空串。打标材料(首条用户消息)与 prose 门共用本口径,
 * 避免两处解析漂移。
 */
export function userMessageTextOf(event: SessionEventLike): string {
  if (!isRecord(event) || event['type'] !== 'user/message') return ''
  const data = event['data']
  if (!isRecord(data) || !isRecord(data['source']) || data['source']['kind'] !== 'user') return ''
  return userTextOf(data)
}

// ---------- 游标表 ----------

/**
 * consolidation_cursor 存储(session_id 主键,done_at):一个 sqlite 库一个实例,
 * 与 EntityMemoryStore 同库不同连接(WAL 支持同进程多连接;写入是单行 upsert,
 * 量级可忽略)。done_at 单调推进,不回拨。
 */
export class ConsolidationCursorStore {
  readonly #db: DatabaseSync
  #closed = false

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath)
    if (dbPath !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${CURSOR_TABLE} (
        session_id TEXT PRIMARY KEY,
        done_at INTEGER NOT NULL
      );
    `)
  }

  /**
   * 推进游标(单调:仅当 doneAt 更晚才覆写;乱序触发不回拨)。
   * 事务内执行,异常 ROLLBACK 后原样重抛。
   */
  markDone(sessionId: string, doneAt: number): void {
    this.#assertOpen()
    if (!Number.isSafeInteger(doneAt) || doneAt < 0) {
      throw new RangeError(`[memory] done_at 必须是非负安全整数,得到:${String(doneAt)}`)
    }
    this.#db.exec('BEGIN')
    try {
      this.#db.prepare(`
        INSERT INTO ${CURSOR_TABLE} (session_id, done_at) VALUES (?, ?)
        ON CONFLICT(session_id) DO UPDATE SET done_at = MAX(done_at, excluded.done_at)
      `).run(sessionId, doneAt)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  /** 该会话最近一次整固完成时刻;未整固过返回 null。 */
  doneAt(sessionId: string): number | null {
    this.#assertOpen()
    const row = this.#db.prepare(`SELECT done_at FROM ${CURSOR_TABLE} WHERE session_id = ?`).get(sessionId)
    if (row === undefined) return null
    const value = row['done_at']
    if (typeof value === 'number') return value
    if (typeof value === 'bigint') return Number(value)
    throw new TypeError(`[memory] done_at 列出现非数值:${String(value)}`)
  }

  /** 关库(插件卸载时调用;幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[memory] ConsolidationCursorStore 已关闭')
  }
}

/** consolidation_meta 表名(Dream/画像的 consolidation 元数据;与 cursor 同库同租户边界)。 */
const META_TABLE = 'consolidation_meta'

/**
 * consolidation 元数据存储(M-M3 T11,键值行):lastDreamAt 走 cursor 的 'dream'
 * 行(复用游标纪律),本表承载无单调语义的元数据——画像再生成条件的时间戳与
 * user 层计数(19 号 §5-T11「user 层 approved 记忆数变化 ≥1 或距上次 ≥24h」)。
 * 与 ConsolidationCursorStore 同库不同连接(WAL 多连接先例);set 为事务内
 * upsert(原子);close 幂等。
 */
export class ConsolidationMetaStore {
  readonly #db: DatabaseSync
  readonly #now: () => number
  #closed = false

  constructor(dbPath: string, options: { readonly now?: () => number } = {}) {
    this.#db = new DatabaseSync(dbPath)
    this.#now = options.now ?? ((): number => Date.now())
    if (dbPath !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }

  /** 读一个元数据键;不存在返回 null。 */
  get(key: string): string | null {
    this.#assertOpen()
    const row = this.#db.prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`).get(key)
    if (row === undefined) return null
    const value = row['value']
    if (typeof value !== 'string') throw new TypeError(`[memory] consolidation_meta.value 列出现非文本:${String(value)}`)
    return value
  }

  /** 读数值键;缺值或不可解析返回 null(防御式,坏值不炸 Prune/画像条件判定)。 */
  getNumber(key: string): number | null {
    const raw = this.get(key)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  /** 写一个元数据键(事务内 upsert:覆盖旧值并刷新 updated_at)。 */
  set(key: string, value: string): void {
    this.#assertOpen()
    this.#db.exec('BEGIN')
    try {
      this.#db.prepare(`
        INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, this.#now())
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  /** 关库(幂等)。 */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('[memory] ConsolidationMetaStore 已关闭')
  }
}

// ---------- 整固 job:触发 / 调度 / 快照冻结 ----------

/** 会话尾触发入参(glue 层在 turn/end(completed) 时组装)。 */
export interface SessionEndRef {
  readonly sessionId: string
  /** 盘面会话日志路径(冻结快照字段;缺席为 null——T7 提取体经它读 session log)。 */
  readonly logPath: string | null
  /** 触发回合号(turn/end data.turn)。 */
  readonly lastTurn: number
  /** 会话尾标记时刻(turn/end 信封 time;游标挡重复的比较基准)。 */
  readonly endedAt: number
  /** 触发时刻已累积的三门控事实(活面快照入参,调度时冻结)。 */
  readonly facts: SessionGateFacts
}

/** 快照任务类别(session=会话尾轻量整固;dream=重量 Dream,S4-B 退路)。 */
export type ConsolidationJobKind = 'session' | 'dream' | 'distill'

/** 冻结快照(调度时快照 session log 路径+会话元数据+门控事实,消费时不重查)。 */
export interface ConsolidationSnapshot {
  readonly sessionId: string
  readonly logPath: string | null
  readonly lastTurn: number
  readonly endedAt: number
  readonly facts: SessionGateFacts
  /** 任务类别(调度器与任务路由消费;freezeSnapshot 恒 'session')。 */
  readonly jobKind?: ConsolidationJobKind
  /**
   * Gather 窄读窗口起点(epoch ms;仅 dream 快照携带:自 lastDreamAt 起,首跑
   * 回落 now-interval)。session 快照缺省。
   */
  readonly windowStart?: number
}

/** 提取执行结果(T7 落地真实提取;两种 kind 都推进游标——已处理而非待重试)。 */
export interface ConsolidationTaskResult {
  /** ran=产生提案/写入;nothing-to-save=Nothing 门(不落库不推卡片)。 */
  readonly kind: 'ran' | 'nothing-to-save'
  readonly detail?: string
}

/**
 * 提取执行体 seam(T7):消费冻结快照执行 LLM 提取与提案落库;须响应 signal
 * (session close 先 abort);抛错/中止 = 不推进游标,待下次会话尾重试。
 */
export type ConsolidationTask = (
  snapshot: ConsolidationSnapshot,
  signal: AbortSignal,
) => Promise<ConsolidationTaskResult>

/**
 * T6 骨架默认任务:无提取执行体接入(T7 落地 LLM 直调 + 冻结 prompt),恒
 * nothing-to-save——骨架期整固链路(触发→门控→调度→游标)全量生效但不产生
 * 提案,T7 替换本 seam 后无需改骨架。
 */
export const SKELETON_CONSOLIDATION_TASK: ConsolidationTask = () => Promise.resolve({
  kind: 'nothing-to-save',
  detail: 'T6 骨架:提取执行体未接入(T7 落地 LLM 提取)',
})

/** consolidateOnSessionEnd 的返回:已处理(already-done)/ 门控跳过 / 已入调度。 */
export type ConsolidationTriggerOutcome =
  | { readonly kind: 'already-done' }
  | { readonly kind: 'skipped'; readonly reason: ConsolidationSkipReason }
  | { readonly kind: 'scheduled' }

/** 最小日志面(缺省静默;glue 注 ctx.logger)。 */
export interface ConsolidationLogger {
  info?(message: string): void
  warn?(message: string): void
}

/** SessionEndConsolidator 构造选项。 */
export interface SessionEndConsolidatorOptions {
  readonly cursor: ConsolidationCursorStore
  /** 提取执行体(T7);缺省 SKELETON_CONSOLIDATION_TASK。 */
  readonly task?: ConsolidationTask
  /**
   * 重量 Dream 执行体(M-M3 T11,dream.ts 的 createDreamTask):提供后
   * maybeEnqueueDream 才可入调度;与会话整固共用同一队列纪律。
   */
  readonly dreamTask?: ConsolidationTask
  /**
   * 全局蒸馏执行体(M-M4 Phase A,distill.ts 的 createDistillTask / distill-curate
   * 的组合任务):提供后 maybeEnqueueDistill 才可入调度;'distill' 伪会话游标
   * 语义与 Dream 同款(error/abort 不推进;被顶掉不虚假推进)。
   */
  readonly distillTask?: ConsolidationTask
  readonly now?: () => number
  readonly logger?: ConsolidationLogger
  /** dispose 的 drain 上界(默认 60s;测试注小值)。 */
  readonly drainTimeoutMs?: number
}

interface RunningJob {
  readonly snapshot: ConsolidationSnapshot
  readonly controller: AbortController
  readonly done: Promise<void>
}

/**
 * 会话尾整固调度器(单实例管全部会话):三门控 × 会话粒度游标 × 单 running +
 * 单 latest-pending 覆盖合并 × 快照冻结。纯 TS 状态机(约 80 行口径,17 号
 * §2.4 语义),不持有宿主句柄——事件订阅/卸载时机由 glue 层接线。
 */
export class SessionEndConsolidator {
  readonly #cursor: ConsolidationCursorStore
  readonly #task: ConsolidationTask
  readonly #dreamTask: ConsolidationTask | undefined
  readonly #distillTask: ConsolidationTask | undefined
  readonly #now: () => number
  readonly #logger: ConsolidationLogger
  readonly #drainTimeoutMs: number
  #running: RunningJob | undefined
  #pending: ConsolidationSnapshot | undefined
  #disposed = false
  #drain: Promise<void> | undefined

  constructor(options: SessionEndConsolidatorOptions) {
    this.#cursor = options.cursor
    this.#task = options.task ?? SKELETON_CONSOLIDATION_TASK
    this.#dreamTask = options.dreamTask
    this.#distillTask = options.distillTask
    this.#now = options.now ?? ((): number => Date.now())
    this.#logger = options.logger ?? {}
    this.#drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  }

  /**
   * 会话尾触发入口(顺序固定):
   * 1. 游标已覆盖本次会话尾标记(done_at ≥ endedAt)→ already-done;
   * 2. 三门控任一命中 → 推进游标,返回 skipped(已决策,不入调度);
   * 3. 全过 → 冻结快照入调度(单 running,后来者进 latest-pending 覆盖合并)。
   */
  consolidateOnSessionEnd(ref: SessionEndRef): ConsolidationTriggerOutcome {
    if (this.#disposed) return { kind: 'already-done' }
    const doneAt = this.#cursor.doneAt(ref.sessionId)
    if (doneAt !== null && doneAt >= ref.endedAt) return { kind: 'already-done' }
    const skip = evaluateSessionGates(ref.facts)
    if (skip !== null) {
      this.#cursor.markDone(ref.sessionId, this.#now())
      return { kind: 'skipped', reason: skip }
    }
    this.#schedule(freezeSnapshot(ref))
    return { kind: 'scheduled' }
  }

  /** 调度态观察面(测试/巡检;不进生产决策路径)。 */
  schedulerState(): { readonly running: string | null; readonly pending: string | null } {
    return {
      running: this.#running?.snapshot.sessionId ?? null,
      pending: this.#pending?.sessionId ?? null,
    }
  }

  /**
   * 重量 Dream 触发入口(M-M3 T11,19a 号 S4-B 退路:会话尾触发+时间阈值合并):
   * 轻量链落定后由 glue 在 turn/end(completed) 时调用。判定顺序:
   * 1. 未提供 dreamTask 或已 dispose → 'disabled'(不调度);
   * 2. dream 已在跑/已排队 → 'already-queued'(单 dream 语义,防背靠背重跑);
   * 3. `now - lastDreamAt < intervalMs`(lastDreamAt=游标 'dream' 行)→ 'not-due';
   * 4. 到期 → dream 快照入调度(与会话整固共用单 running+latest-pending),
   *    完成时由调度器 markDone 推进 'dream' 行 = 原子更新 lastDreamAt;
   *    error/abort 不推进,待下次会话尾补跑(T6 游标纪律逐字复用)。
   * Dream 无会话事实,不过三门控;Gather 窗口起点 = lastDreamAt ?? now-interval。
   */
  maybeEnqueueDream(nowMs: number, intervalMs: number): 'scheduled' | 'not-due' | 'already-queued' | 'disabled' {
    if (this.#dreamTask === undefined || this.#disposed) return 'disabled'
    if (this.#running?.snapshot.jobKind === 'dream' || this.#pending?.jobKind === 'dream') {
      return 'already-queued'
    }
    const last = this.#cursor.doneAt(DREAM_CURSOR_SESSION_ID)
    if (last !== null && nowMs - last < intervalMs) return 'not-due'
    this.#schedule(dreamSnapshot(nowMs, last ?? nowMs - intervalMs))
    return 'scheduled'
  }

  /**
   * 全局蒸馏触发入口(M-M4 Phase A,18 §8;与 maybeEnqueueDream 同构的时间阈值
   * 合并):轻量链/Dream 判定后由 glue 在 turn/end(completed) 时调用。判定顺序:
   * 1. 未提供 distillTask 或已 dispose → 'disabled'(不调度);
   * 2. distill 已在跑/已排队 → 'already-queued'(单 distill 语义,防背靠背重跑;
   *    与 Dream 互不阻挡——互为不同 jobKind,共用单 running 队列自然串行);
   * 3. `now - lastDistillAt < intervalMs`(lastDistillAt=游标 'distill' 行)→ 'not-due';
   * 4. 到期 → distill 快照入调度,完成时 markDone 推进 'distill' 行 = 原子更新
   *    lastDistillAt;error/abort 不推进,待下次会话尾补跑(T6 游标纪律逐字复用)。
   * 蒸馏无会话事实,不过三门控;窗口起点 = lastDistillAt ?? now-interval。
   */
  maybeEnqueueDistill(nowMs: number, intervalMs: number): 'scheduled' | 'not-due' | 'already-queued' | 'disabled' {
    if (this.#distillTask === undefined || this.#disposed) return 'disabled'
    if (this.#running?.snapshot.jobKind === 'distill' || this.#pending?.jobKind === 'distill') {
      return 'already-queued'
    }
    const last = this.#cursor.doneAt(DISTILL_CURSOR_SESSION_ID)
    if (last !== null && nowMs - last < intervalMs) return 'not-due'
    this.#schedule(distillSnapshot(nowMs, last ?? nowMs - intervalMs))
    return 'scheduled'
  }

  /**
   * 单会话 teardown(session/disposed 兜底):abort 匹配的 running、丢弃匹配的
   * pending,游标均不推进(abort 语义,留待该会话下次会话尾标记重试);
   * 不匹配的会话不受影响。同步返回,abort 后的收尾在内部 done 链上完成
   * (fire-and-forget,勿 await——S1 结论 B)。
   */
  abandonSession(sessionId: string): void {
    if (this.#running?.snapshot.sessionId === sessionId) this.#running.controller.abort()
    if (this.#pending?.sessionId === sessionId) this.#pending = undefined
  }

  /**
   * 全量 teardown(glue disposer):先 abort 在跑整固再释放,drain 上界
   * 默认 60s(挂死任务不再等);pending 丢弃且不推进游标;随后关游标库。
   * 幂等:重复调用共用同一条 drain。
   */
  dispose(): Promise<void> {
    if (this.#drain !== undefined) return this.#drain
    this.#disposed = true
    this.#pending = undefined
    this.#running?.controller.abort()
    this.#drain = (async (): Promise<void> => {
      const running = this.#running
      if (running !== undefined) {
        await Promise.race([
          running.done,
          new Promise<void>((resolve) => {
            // 任务先收尾时 timer 悬挂到期:unref 使其不拖进程退出(≤60s)
            const timer = setTimeout(resolve, this.#drainTimeoutMs)
            timer.unref()
          }),
        ])
      }
      this.#cursor.close()
    })()
    return this.#drain
  }

  /** 入调度:单 running;在跑时后来者进 latest-pending(覆盖合并,无 FIFO)。 */
  #schedule(snapshot: ConsolidationSnapshot): void {
    if (this.#running !== undefined) {
      const superseded = this.#pending
      const incomingKind = snapshot.jobKind ?? 'session'
      const pendingKind = superseded?.jobKind ?? 'session'
      const pendingPeriodic = pendingKind !== 'session'
      if (pendingPeriodic && incomingKind !== pendingKind) {
        // 周期任务(Dream/蒸馏)占 pending 时粘滞:同 kind 重入才覆盖(去重语义),
        // session 快照或另一周期任务不顶掉——否则同一会话尾上后入队的蒸馏会
        // **系统性**挤掉先入队的 Dream(M-M4 引入的顺序回归),二者按先到先跑,
        // 后来者游标未推进、下个会话尾由时间阈值自然重触发(不丢信息)。
        return
      }
      this.#pending = snapshot
      // 被顶掉 = 该次会话尾标记已由调度器处理(调度级 skip),推进其游标;
      // dream/distill 例外:被顶掉时对应元数据行尚未到点,不得虚假推进(否则
      // 周期被白白延后一段)——留待下次会话尾由时间阈值自然重新触发
      if (superseded !== undefined && superseded.jobKind !== 'dream' && superseded.jobKind !== 'distill') {
        this.#cursor.markDone(superseded.sessionId, this.#now())
      }
      return
    }
    this.#start(snapshot)
  }

  #start(snapshot: ConsolidationSnapshot): void {
    const controller = new AbortController()
    const done = this.#execute(snapshot, controller)
    this.#running = { snapshot, controller, done }
  }

  /**
   * 执行一次整固:success/nothing-to-save 推进游标;error/abort 不推进
   * (待下次会话尾标记重试)。abort 后任务自行收尾(不抛)同样不推进——
   * 中止语义优先于任务结果(17 号 §2.4:error/abort 不推进)。
   */
  async #execute(snapshot: ConsolidationSnapshot, controller: AbortController): Promise<void> {
    // 任务路由(T11+M-M4):dream 快照走 dreamTask、distill 快照走 distillTask
    // (缺席不可能——maybeEnqueue* 已挡),session 快照走轻量提取体;markDone 的
    // 键=快照 sessionId,'dream'/'distill' 伪会话行的推进即原子更新对应元数据行
    // (T6 语义逐字复用)
    const task = snapshot.jobKind === 'dream' && this.#dreamTask !== undefined
      ? this.#dreamTask
      : snapshot.jobKind === 'distill' && this.#distillTask !== undefined
        ? this.#distillTask
        : this.#task
    try {
      const result = await task(snapshot, controller.signal)
      if (controller.signal.aborted) {
        this.#logger.info?.(`[memory] 会话尾整固已中止,游标不推进(${snapshot.sessionId})`)
      } else {
        this.#cursor.markDone(snapshot.sessionId, this.#now())
        this.#logger.info?.(
          `[memory] 会话尾整固完成(${snapshot.sessionId},turn ${snapshot.lastTurn}):${result.kind}`
          + (result.detail === undefined ? '' : `——${result.detail}`),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted) {
        this.#logger.info?.(`[memory] 会话尾整固已中止,游标不推进(${snapshot.sessionId}):${message}`)
      } else {
        this.#logger.warn?.(`[memory] 会话尾整固失败,游标不推进待重试(${snapshot.sessionId}):${message}`)
      }
    } finally {
      this.#running = undefined
      const next = this.#pending
      this.#pending = undefined
      if (next !== undefined && !this.#disposed) this.#start(next)
    }
  }
}

/** 快照冻结(调度时一次性拷贝并深冻结;活面后续变更不影响已冻结任务)。 */
function freezeSnapshot(ref: SessionEndRef): ConsolidationSnapshot {
  return Object.freeze({
    jobKind: 'session' as const,
    sessionId: ref.sessionId,
    logPath: ref.logPath,
    lastTurn: ref.lastTurn,
    endedAt: ref.endedAt,
    facts: Object.freeze({ ...ref.facts }),
  })
}

/**
 * Dream 快照(M-M3 T11,调度器内同构):伪会话 'dream',logPath 缺席(dream
 * 不读会话日志),facts 恒零(不过三门控);windowStart 供 Gather 窄读。
 */
export function dreamSnapshot(nowMs: number, windowStart: number): ConsolidationSnapshot {
  return Object.freeze({
    jobKind: 'dream' as const,
    sessionId: DREAM_CURSOR_SESSION_ID,
    logPath: null,
    lastTurn: 0,
    endedAt: nowMs,
    windowStart,
    facts: Object.freeze({ memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 }),
  })
}

/**
 * 蒸馏快照(M-M4 Phase A,调度器内与 Dream 同构):伪会话 'distill',logPath
 * 缺席(蒸馏读各账号库,不读会话日志),facts 恒零(不过三门控);windowStart
 * 供报告窗口标注(自 lastDistillAt 起,首跑回落 now-interval)。
 */
export function distillSnapshot(nowMs: number, windowStart: number): ConsolidationSnapshot {
  return Object.freeze({
    jobKind: 'distill' as const,
    sessionId: DISTILL_CURSOR_SESSION_ID,
    logPath: null,
    lastTurn: 0,
    endedAt: nowMs,
    windowStart,
    facts: Object.freeze({ memoryWriteCalls: 0, maxUserProseWords: 0, approvalAsks: 0 }),
  })
}

// ---------- 盘面会话日志定位(S1 结论 D) ----------

/**
 * DSH 会话日志根目录:`$DSH_HOME/sessions`(DSH_HOME 缺省 ~/.dsh)。
 * panel snapshot.ts 同款推导(panel/src/snapshot.ts:207-210 先例)。
 */
export function resolveDshSessionsRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

/**
 * 按会话 id 定位盘面日志 session.v4.jsonl.zstd:扫 `<root>/<area>/` 一层目录,
 * 匹配同名会话目录(目录名 = encodeSegment(sessionId),常规 uuid/`session-<n>`
 * id 为恒等映射;S1-D 实测样例 `session-<uuid>`)。定位不到返回 null
 * (会话尚未落盘/无日志——turn 边界不保证已 flush,T7 读盘前自行等 flush)。
 */
export function findSessionLogPath(sessionsRoot: string, sessionId: string): string | null {
  let areas: string[]
  try {
    areas = readdirSync(sessionsRoot)
  } catch {
    return null
  }
  for (const area of areas) {
    const logPath = join(sessionsRoot, area, sessionId, 'session.v4.jsonl.zstd')
    try {
      if (statSync(logPath).isFile()) return logPath
    } catch {
      // 该 area 下无此会话目录:继续扫
    }
  }
  return null
}

/** 弱类型收窄(governance/audit.ts isRecord 同款)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
