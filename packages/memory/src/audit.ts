/**
 * 记忆审计账本(M-M2 T9,19 号 §4-T9.4):每次整固的**提案 / 门控 / 审批**结果
 * 各写一行 JSONL(`workspace 的 .eterna/memory-audit.jsonl`,与 memory.sqlite3
 * 同目录,tenant-scan 随 dbPath 覆盖;evolve ledger 挂载后切换,键位对齐 19 号原文)。
 *
 * 三类事件(一行一事):
 * - `proposal`:一次提取落库(add/update/noop/forget/superseded/skipped 计数 +
 *   本次产生的待审行 + 审批卡片摘要)——pending 卡片的事实留痕;
 * - `gate`:一次门控 skip(direct-write / no-user-prose / credential-redline,
 *   19 号 §4-T6 顺序即判定顺序)——skip 是已决策,必须留痕;
 * - `review`:一次审批落定(approved 生效 / rejected 软失效,19 号 §3-T2.7)。
 * M-M3 T11 增 `dream`:一次重量 Dream 四阶段(Orient/Gather/Consolidate/Prune)
 * 的周报行(19 号 §5-T11「晋升/淘汰/CONFLICT-FLAG/画像变更摘要——M-M3 只落
 * panel 展示」的账本落点;晋升的待审行随行携带)。
 * T13 增 `domain-resolve`(会话域解析定格,打标准确率样本)与 `correction`
 * (画像「纠正此项」动作,纠正率分子)——五项验收指标的四项在线数据源
 * (第五项索引预算分布不入账本:每轮装配都发生,落账会刷屏,由调用方现算)。
 *
 * 纪律对齐 consolidation/extraction:coeffect 全声明(路径/时钟/日志构造注入,
 * 不碰旁路全局);写入失败 fail-open(warn 日志,不抛——账本缺行不能反过来
 * 中断整固任务或用户的审批动作:整固抛错会导致游标不推进而整段重跑提取,
 * 审批抛错会把一次正常的裁决变成宿主 5xx;两种后果都比缺一行审计更重)。
 * 行内容全部来自已过 PII 写入闸的记忆字段(key/summary)+ 计数,不携带会话
 * 原文(出处会话摘要进卡片前另经 PiiGuard 回退,见 approval.ts buildSessionDigest)。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ConsolidationLogger, ConsolidationSkipReason } from './consolidation.ts'
import type { DomainResolutionSource } from './domain.ts'
import type { EntityReviewDecision } from './entity-store.ts'

/** 账本文件名(与 memory.sqlite3 同目录,即 DSH_HOME 语义 workspace 的 .eterna/ 下)。 */
export const MEMORY_AUDIT_FILENAME = 'memory-audit.jsonl'

/** 缺省账本路径:由 memory.sqlite3 的库路径推导(同目录)。 */
export function defaultMemoryAuditPath(dbPath: string): string {
  return join(dirname(dbPath), MEMORY_AUDIT_FILENAME)
}

/** 提案行携带的待审条目(审批队列来源;字段均过 PII 写入闸)。 */
export interface MemoryAuditPendingItem {
  readonly id: number
  readonly subject: string
  readonly key: string
  /** 一句话摘要(空摘要给空串,不携带全文正文——账本只做索引性留痕)。 */
  readonly summary: string
}

/** 审批卡片在账本里的投影(结构化字段 + 渲染好的 detail;全文卡片不落账)。 */
export interface MemoryAuditCard {
  /** 卡片主题名(标题)。 */
  readonly title: string
  readonly ruleId: string
  readonly grade: 'R2'
  /** 渲染好的 markdown 正文(buildApprovalCard 的 renderedDetail)。 */
  readonly detail: string
}

/** 提案行载荷(整固一次落库的事实;字段与 ProposalApplyReport 对齐)。 */
export interface ProposalAuditEntry {
  readonly sessionId: string
  /** 会话尾轮次(turn/end data.turn)。 */
  readonly turn: number
  /** 落库来源(整固提取 / compaction 摘要提案)。 */
  readonly source: 'consolidation' | 'compaction'
  readonly add: number
  readonly update: number
  readonly noop: number
  readonly forgotten: number
  readonly superseded: number
  readonly skipped: number
  readonly skipReasons: readonly string[]
  /** 本次落库产生的待审行(空数组 = 全部直生效或全 noop)。 */
  readonly pending: readonly MemoryAuditPendingItem[]
  /** 审批卡片(有待审行时携带)。 */
  readonly card?: MemoryAuditCard
}

/** 门控行载荷(一次门控 skip 的事实;skip 即已决策,19 号 §4-T6)。 */
export interface GateAuditEntry {
  readonly sessionId: string
  readonly reason: ConsolidationSkipReason
}

/** 审批行载荷(一次裁决的事实;行不存在时不记——没有发生裁决)。 */
export interface ReviewAuditEntry {
  readonly id: number
  readonly decision: EntityReviewDecision
  readonly subject: string
  readonly key: string
}

/**
 * Dream 行载荷(M-M3 T11,一次重量 Dream 的周报摘要):晋升/偏好/回收/对账/
 * 淘汰计数 + 画像是否再生成 + LLM 调用次数 + 被跳过条目原因 + 本次产生的待审行
 * (审批队列数据源;字段口径与 ProposalAuditEntry.pending 一致)。runAt 为注入
 * 时钟的 epoch ms(dream 无会话,不携带 sessionId)。
 */
export interface DreamAuditEntry {
  readonly runAt: number
  readonly promotions: number
  readonly preferences: number
  readonly retractions: number
  readonly conflictFlags: number
  readonly expired: number
  readonly evicted: number
  readonly portraitRegenerated: boolean
  readonly llmCalls: number
  readonly skipped: number
  readonly skipReasons: readonly string[]
  readonly pending: readonly MemoryAuditPendingItem[]
  /** T13 留痕:被淘汰/回收条目明细(subject/key/reason 逐条;M-T2 补,low#17)。 */
  readonly pruned: readonly { readonly subject: string; readonly key: string; readonly reason: string }[]
}

/**
 * 域解析行载荷(T13 指标埋点,19 号 §5-T13):一次会话域解析的定格结果——
 * 域打标准确率的样本与分母(scripts/memory-domain-accuracy.mjs 离线比对人工标注),
 * 域解析分布(panel 指标区)的数据源。每会话至多一行(解析定格即记,含 none/candidate;
 * 失败重试不记——没发生解析决策)。人工切换域(overrideDomain)不是打标,不记。
 */
export interface DomainResolveAuditEntry {
  readonly sessionId: string
  /** 解析出的域键(none = null)。 */
  readonly domainKey: string | null
  /** 解析来源:workspace 显式 / merged 归并 / promoted 本次转正 / candidate 候选 / none。 */
  readonly source: DomainResolutionSource
  /** 绑定与否(绑定才注入索引与 episodic 域归属)。 */
  readonly bound: boolean
  /** 本次是否实际计数(每会话去重后)。 */
  readonly counted: boolean
}

/**
 * 画像纠正行载荷(T13 指标埋点):面板画像卡「纠正此项」动作的留痕——纠正率的
 * 分子(分母 = 画像当前来源记忆条数,metrics 现算)。只记节名与键位提示,不携带
 * 纠正正文(正文经显式 memory_write 通道入库,自有 PII 闸与 provenance)。
 */
export interface CorrectionAuditEntry {
  /** 画像分节名(工作习惯/风格偏好/协作要求/工作区索引)。 */
  readonly section: string
  /** 纠正目标的键位提示(预填文本引用的记忆键;无明确键位时为空串)。 */
  readonly keyHint: string
}

/** 账本一行(六类事件之一;time 为 ISO 时刻,由注入时钟生成)。 */
export type MemoryAuditEvent =
  | ({ readonly kind: 'proposal'; readonly time: string } & ProposalAuditEntry)
  | ({ readonly kind: 'gate'; readonly time: string } & GateAuditEntry)
  | ({ readonly kind: 'review'; readonly time: string } & ReviewAuditEntry)
  | ({ readonly kind: 'dream'; readonly time: string } & DreamAuditEntry)
  | ({ readonly kind: 'domain-resolve'; readonly time: string } & DomainResolveAuditEntry)
  | ({ readonly kind: 'correction'; readonly time: string } & CorrectionAuditEntry)

/** MemoryAuditLedger 构造选项(coeffect 全声明)。 */
export interface MemoryAuditLedgerOptions {
  /** 账本文件绝对路径(缺省推导见 defaultMemoryAuditPath)。 */
  readonly path: string
  /** 时钟注入(测试用;默认 Date.now)。 */
  readonly now?: () => number
  /** 写入失败告警面(缺省静默;glue 注 ctx.logger)。 */
  readonly logger?: ConsolidationLogger
}

/**
 * 记忆审计账本(追加写 JSONL,一行一事):三类 record* 方法把对应事实落一行;
 * readAll 供测试与巡检回读(坏行忽略)。实例可跨整固/审批两路共享(glue 层
 * 单实例穿线:提取执行体记 proposal 行,review 包装器记 review 行,门控接线记
 * gate 行)——同进程内 append 单行原子,无需加锁。
 */
export class MemoryAuditLedger {
  readonly #path: string
  readonly #now: () => number
  readonly #logger: ConsolidationLogger
  #dirEnsured = false

  constructor(options: MemoryAuditLedgerOptions) {
    this.#path = options.path
    this.#now = options.now ?? ((): number => Date.now())
    this.#logger = options.logger ?? {}
  }

  /** 账本文件路径(巡检面)。 */
  get path(): string {
    return this.#path
  }

  /** 记一次整固落库(提案行)。 */
  recordProposal(entry: ProposalAuditEntry): void {
    this.#write({ kind: 'proposal', time: this.#iso(), ...entry })
  }

  /** 记一次门控 skip(门控行)。 */
  recordGate(entry: GateAuditEntry): void {
    this.#write({ kind: 'gate', time: this.#iso(), ...entry })
  }

  /** 记一次审批落定(审批行)。 */
  recordReview(entry: ReviewAuditEntry): void {
    this.#write({ kind: 'review', time: this.#iso(), ...entry })
  }

  /** 记一次重量 Dream 四阶段的周报行(M-M3 T11)。 */
  recordDream(entry: DreamAuditEntry): void {
    this.#write({ kind: 'dream', time: this.#iso(), ...entry })
  }

  /** 记一次会话域解析定格(T13 域打标准确率/分布的数据源)。 */
  recordDomainResolve(entry: DomainResolveAuditEntry): void {
    this.#write({ kind: 'domain-resolve', time: this.#iso(), ...entry })
  }

  /** 记一次画像纠正动作(T13 纠正率的分子)。 */
  recordCorrection(entry: CorrectionAuditEntry): void {
    this.#write({ kind: 'correction', time: this.#iso(), ...entry })
  }

  /** 回读全部事件(坏行忽略;文件不存在返回空数组)——测试与巡检面。 */
  readAll(): readonly MemoryAuditEvent[] {
    if (!existsSync(this.#path)) return []
    let text: string
    try {
      text = readFileSync(this.#path, 'utf8')
    } catch {
      return []
    }
    const events: MemoryAuditEvent[] = []
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        events.push(JSON.parse(line) as MemoryAuditEvent)
      } catch {
        // 坏行(半写/篡改)忽略不炸:账本是追加日志,不因单行损坏拒绝回读
      }
    }
    return events
  }

  #iso(): string {
    return new Date(this.#now()).toISOString()
  }

  /**
   * 追加一行(fail-open):目录惰性创建;写入失败 warn 不抛——理由见文件头
   * 「账本缺行不能中断整固/审批主流程」。重复失败逐条 warn,不静默吞掉。
   */
  #write(event: MemoryAuditEvent): void {
    try {
      if (!this.#dirEnsured) {
        mkdirSync(dirname(this.#path), { recursive: true })
        this.#dirEnsured = true
      }
      appendFileSync(this.#path, `${JSON.stringify(event)}\n`, 'utf8')
    } catch (error) {
      this.#logger.warn?.(`[memory] 审计账本写入失败(${this.#path}):${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
