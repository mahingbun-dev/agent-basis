/**
 * Memory 服务组合层(M1 + M2 + PII 门 + 联合检索)。
 *
 * Cordis 纪律落实:
 * - **effect 配逆闭包**:writeEntity/writeNote 返回 undo(精确恢复写入前状态);
 *   forget = 应用逆**真删**(物理 DELETE,非打标);
 * - **coeffect 全声明**:不碰旁路全局——workspace 目录、sqlite 路径、PII 守卫、
 *   时钟全部构造注入;
 * - **provide 可交换**:以注册表 + 唯一 ID(MEMORY_SERVICE_ID = '@eterna/memory')
 *   形态对外;同 ID 重复注册先配逆旧的(由宿主的 effect 树负责,本层提供 dispose)。
 *
 * PII 纪律(设计文档 08 §5.2):一切写入先过 PII——writeEntity/writeNote/
 * appendNote 内部强制 assertClean(fail-closed:命中抛 PiiBlockedError,不落盘)。
 * 守卫首选注入 @eterna/governance 的 PiiFilter(结构满足 PiiGuard);未注入时
 * 降级 BuiltinPiiGuard(降级事实记入 blockers,见 README)。
 *
 * M-M1 T2 写入口判定(19 号 §3-T2.4/T2.5):writeEntity 统一执行四操作决策
 * (add / update / noop——多词重叠 0.6 合并、0.9 拒写)与 review_state 分级
 * 卡控(compaction 强制 pending;explicit→approved;domain+episodic→approved;
 * 其余 pending)。模型工具无 review_state/provenance 参数——判定与盖章均不
 * 信任模型手写。
 *
 * M-M2 T8 Gm0 结构闸补全(19 号 §4-T8 + 18 号 §3.2/Q5 决议):单条 content
 * ≤2000 字;单域 live ≤perDomainLimit(起步 200)超限拒绝新增并提示整固
 * (顶替/合并不新增 live 行不受限);合并正文不越限(裁剪新增段)。Gm1 判定
 * 区下限常量亦在此定义(上限即 NOOP 阈值:≥0.9 交 Gm0 拒写,判了也进不了库)。
 */
import { EntityMemoryStore, resolveDomainKey } from './entity-store.ts'
import { buildEntityIndex, stalenessSuffix } from './index-builder.ts'
import { MemoryAuditLedger, defaultMemoryAuditPath } from './audit.ts'
import { buildMemoryMetrics, computeIndexZoneTokens } from './metrics.ts'
import { NotesStore } from './notes.ts'
import { BuiltinPiiGuard } from './pii.ts'
import type { MemoryWritePolicy } from './config-bridge.ts'
import type { CorrectionAuditEntry, DomainResolveAuditEntry } from './audit.ts'
import type { MemoryMetricsReport } from './metrics.ts'
import type {
  EntityRecord, EntityReviewDecision, EntityReviewState,
  EntitySearchOptions, EntityScope, EntityWriteDecision, EntityWriteInput, EntityWriteResult,
} from './entity-store.ts'
import type { MemoryIndexOptions, MemoryIndexResult } from './index-builder.ts'
import type { NoteWriteResult } from './notes.ts'
import type { PiiGuard } from './pii.ts'

/** 注册 ctx.memory 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const MEMORY_SERVICE_ID = '@eterna/memory'

// ---------- 四操作决策与 review_state 写入口判定(19 号 §3-T2.4/T2.5) ----------
//
// 写入口统一判定落在本门面(而非 tools.ts):memory_write 工具、T7 整固提案
// (source='consolidation')、compaction 摘要提案(source='compaction')全部经
// writeEntity 入库,规则一处生效;模型传参无 review_state 字段,永不信任。

/** 跨 key 相似度阈值:多词重叠 ≥0.6 → 强制 UPDATE(合并写入既有 key),不引入嵌入(19 号 §3-T2.4 首版口径)。 */
export const MEMORY_DEDUP_MERGE_OVERLAP = 0.6

/** NOOP 阈值:内容与既有行重叠 ≥0.9 → 几乎一致,拒绝写入(19 号 §3-T2.4)。 */
export const MEMORY_DEDUP_NOOP_OVERLAP = 0.9

/**
 * Gm0 单条正文上限(19 号 §4-T8「单条 content ≤2000 字」;entity-store 的
 * 65536 是物理容量,业务上限在 writeEntry 写入口统一收紧——工具/整固/显式
 * 三通道同闸)。合并(mergeMemoryContents)与 Gm1 互补合并共用此上限。
 */
export const MEMORY_CONTENT_MAX_CHARS = 2_000

/**
 * Gm0 单域 live 上限(19 号 §4-T8;18 号 §13 Q5 决议起步值,对应配置键
 * episodic.perDomainLimit=200):超限拒绝新增并提示整固。仅作用于
 * scope='domain'(按 domain_key 分域计数,含 pending 行);user 层与顶替/
 * 合并(不新增 live 行)不受限。
 */
export const MEMORY_PER_DOMAIN_LIVE_LIMIT = 200

/**
 * Gm1 判定区下限(19 号 §4-T8「重叠 30–90%」):add 提案对同 scope+kind live
 * 行最大重叠 ≥0.3 且 <MEMORY_DEDUP_NOOP_OVERLAP(0.9)→ 一次 LLM 矛盾判定;
 * ≥0.9 交 Gm0 NOOP 拒写(判了也进不了库,不花调用),<0.3 视作无关照 ADD。
 * 供 extraction.ts 的 Gm1 一致性闸复用同口径。
 */
export const MEMORY_GM1_JUDGE_MIN_OVERLAP = 0.3

/**
 * review_state 写入口判定(19 号 §3-T2.5,分级卡控;T12-① 增部署级写入策略档位):
 * - policy='explicit-only'(仅显式)→ 非 explicit 来源一律 pending(最大审批面);
 * - policy='full-auto'(全自动)→ 除 compaction 外不再产生 pending(17 §7.1-L3
 *   摘要来源投毒防线不随档位放宽,仍强制 pending);
 * - policy='auto-review'/缺席(自动+审批,现行规则):
 *   - source='compaction' → 强制 pending(摘要来源不直接生效);
 *   - 显式 reviewState(内部调用面;模型工具无此参数)→ 照传;
 *   - source='explicit'(用户显式「记住」)→ approved;
 *   - 其余(agent/consolidation):domain+episodic → approved(08 §5.4 静默档),
 *     user 层或 semantic/procedural → pending(08 §5.4 审批档)。
 * 档位语义与档位全集见 config-bridge.ts(设置分区「记忆」的热改键)。
 */
export function resolveWriteReviewState(input: EntityWriteInput, policy?: MemoryWritePolicy): EntityReviewState {
  if (policy === 'explicit-only') return input.source === 'explicit' ? 'approved' : 'pending'
  if (policy === 'full-auto' && input.source !== 'compaction') return 'approved'
  if (input.source === 'compaction') return 'pending'
  if (input.reviewState !== undefined) return input.reviewState
  if (input.source === 'explicit') return 'approved'
  const scope = input.scope ?? 'domain'
  const kind = input.kind ?? 'semantic'
  return scope === 'domain' && kind === 'episodic' ? 'approved' : 'pending'
}

/**
 * 多词重叠率(Jaccard:|A∩B|/|A∪B|)。分词口径:CJK 逐字 + ASCII 字母数字串
 * (小写)——notes.tokenize 只按空白切,中文整句不成词,查重须自备分词。
 * 两侧皆无词项(纯标点)视作完全一致返回 1;单侧为空返回 0。
 */
export function tokenOverlapRatio(a: string, b: string): number {
  const left = dedupTokens(a)
  const right = dedupTokens(b)
  if (left.size === 0 && right.size === 0) return 1
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

/** 查重分词(导出供测试与 T8 Gm1 复用同口径)。 */
export function dedupTokens(content: string): Set<string> {
  return new Set(content.toLowerCase().match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [])
}

/**
 * 合并写入的正文(首版确定性口径;Gm0 裁剪版,M-M2 T8):新内容无任何新词项
 * (被既有完全涵盖)→ 保留既有正文;否则既有正文 + 换行 + 新正文。合并结果
 * 不越过 MEMORY_CONTENT_MAX_CHARS:按余量裁剪新增段(UTF-16 边界劈开代理对时
 * 丢半个,不碎字形),既有正文完整保留;余量 ≤0(既有已满)不再附加——新增
 * 信息仍在会话日志,下次提到仍可提取。导出供 Gm1 互补合并(extraction.ts)
 * 复用同口径;进一步精细化交由 Gm1 的 LLM 矛盾判定决定是否合并。
 */
export function mergeMemoryContents(existing: string, incoming: string, maxChars: number = MEMORY_CONTENT_MAX_CHARS): string {
  const existingTokens = dedupTokens(existing)
  let adds = false
  for (const token of dedupTokens(incoming)) {
    if (!existingTokens.has(token)) {
      adds = true
      break
    }
  }
  if (!adds) return existing
  const budget = maxChars - existing.length - 1 // -1 = 换行符
  if (budget <= 0) return existing
  return `${existing}\n${fitToChars(incoming, budget)}`
}

/** 按字符预算裁剪(UTF-16 单位,与长度闸同度量;尾字符是高代理项时丢弃,避免劈半个字形)。 */
function fitToChars(text: string, budget: number): string {
  if (text.length <= budget) return text
  let cut = text.slice(0, budget)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut
}

/** M1+M2 联合检索命中(带出处)。 */
export interface MemorySearchHit {
  /** 出处锚点:entity → `entity:user:alice/preference#3`;note → `notes/venue.md#L4`。 */
  readonly source: string
  readonly kind: 'entity' | 'note'
  /** entity → `subject/key`;note → `file#Lline`。 */
  readonly title: string
  /** 一句话摘要(entity 摘要字段 / note 命中行摘录)。 */
  readonly summary: string
}

/** 联合检索选项(subject 限定 M2;limit 作用于合并结果)。 */
export interface MemorySearchOptions extends EntitySearchOptions {
  /** 是否同时检索 M1 notes 文件(默认 true)。 */
  readonly includeNotes?: boolean
}

/** Memory 服务接口(M1 NotesStore + M2 EntityMemoryStore 的门面)。 */
export interface Memory {
  readonly id: typeof MEMORY_SERVICE_ID
  /** M1 项目记忆存储(workspace NOTES 文件读写+检索)。 */
  readonly notes: NotesStore
  /** M2 实体记忆存储(sqlite 六列表)。 */
  readonly entities: EntityMemoryStore
  /** 实际生效的 PII 守卫(注入的 governance 实例或降级内置实现)。 */
  readonly piiGuard: PiiGuard
  /**
   * M2 写入(PII 先行;写入口四操作决策 add/update/noop + review_state 分级
   * 卡控统一在此判定,19 号 §3-T2.4/T2.5;返回携带应用逆闭包的结果)。
   */
  writeEntity(input: EntityWriteInput): EntityWriteResult
  /** M1 覆盖写(PII 先行;undo 恢复原内容/删除新建文件)。 */
  writeNote(file: string, content: string): Promise<NoteWriteResult>
  /** M1 追加写(PII 先行;undo 恢复写入前全文/删除新建文件)。 */
  appendNote(file: string, content: string): Promise<NoteWriteResult>
  /** 读 M2 当前 live 行;不存在返回 null。 */
  readEntity(subject: string, key: string): EntityRecord | null
  /** M1+M2 联合检索(M2 排序在前,notes 随后;带出处)。 */
  search(query: string, options?: MemorySearchOptions): Promise<readonly MemorySearchHit[]>
  /** 遗忘 = 应用逆闭包真删:物理 DELETE 该 (subject, key) 全部行(live+历史)。 */
  forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] }
  /** 评审落定(T9 审批链路):rejected=软失效;行不存在返回 null(19 号 §3-T2.7)。 */
  review(id: number, decision: EntityReviewDecision): EntityRecord | null
  /** 评审队列读取(管理面专用,不经模型工具;19 号 §3-T2.6)。 */
  listForReview(state: EntityReviewState, limit?: number): readonly EntityRecord[]
  /** 命中强化:live 行 use_count+1、last_used_at=now(18 §4.2);返回实际强化行数。 */
  touch(ids: readonly number[]): number
  /** Gm1 软失效入口:live 行打 invalid_at(不动 review_state);非 live 返回 null。 */
  supersede(id: number): EntityRecord | null
  /** 构建记忆索引(≤500 token;只含 M2 live 行,同步取数)。 */
  buildIndex(options?: MemoryIndexOptions): MemoryIndexResult
  /**
   * 记一次会话域解析定格(T13 指标埋点;glue 域接线在解析定格后调用)。
   * 只写审计行,不动库——账本 fail-open,不因指标埋点炸域解析主流程。
   */
  recordDomainResolve(entry: DomainResolveAuditEntry): void
  /**
   * 记一次画像「纠正此项」动作(T13 纠正率分子;面板经 eternaPanel/trackCorrection
   * 转发)。只留痕——纠正正文经显式 memory_write 通道入库,自有 PII 闸。
   */
  recordCorrection(entry: CorrectionAuditEntry): void
  /**
   * T13 在线指标(panel 指标区数据源):审计事件流四项指标 + 现算注入项
   * (画像分母 = 当前 user 层 approved semantic live 行数;索引分区分布按
   * computeIndexZoneTokens 代表性口径——最近使用域 + 库同目录 portrait.md)。
   */
  metrics(): MemoryMetricsReport
  /** 释放资源(关 sqlite;插件配逆时调用;幂等)。 */
  dispose(): void
}

/** createMemory 选项(coeffect 全声明:目录/库路径/PII 守卫/时钟全部注入)。 */
export interface MemoryOptions {
  /** M1 工作区根目录(NOTES 文件树的根)。 */
  readonly workspaceDir: string
  /** M2 sqlite 库文件路径(跨会话持久;':memory:' 仅单进程)。 */
  readonly dbPath: string
  /**
   * PII 守卫:首选注入 @eterna/governance 的 PiiFilter(组合层取 ctx.governance?.pii);
   * 缺省降级 BuiltinPiiGuard(四类通用模式镜像,降级事实须记 blockers)。
   */
  readonly pii?: PiiGuard
  /** 时钟注入(测试用;默认 Date.now)。 */
  readonly now?: () => number
  /**
   * 写入策略档位读取面(T12-① 文件桥热应用;glue 每次 writeEntity 现读 overrides
   * 文件):返回 undefined = 现行规则('auto-review');读取失败由注入方兜底
   * (glue readMemoryOverrides fail-open),本门面不再 try/catch 二次防御。
   */
  readonly writePolicy?: () => MemoryWritePolicy | undefined
  /**
   * 审计账本注入(T13 指标埋点):glue 传入其单例账本(提案/门控/审批/Dream 同源);
   * 缺省自建同路径实例(append 单行原子,多实例同文件安全——audit.ts 头注口径)。
   */
  readonly audit?: MemoryAuditLedger
  /** Gm0 单条正文字数上限(缺省 2000=MEMORY_CONTENT_MAX_CHARS;19 §10-#1 配置键)。 */
  readonly contentMaxChars?: number
  /** Gm0 单域 live 上限(缺省 MEMORY_PER_DOMAIN_LIVE_LIMIT=200;19 §10-#1 配置键)。 */
  readonly perDomainLimit?: number
}

/** 组装 Memory 服务实例(纯对象门面,无隐藏全局)。 */
export function createMemory(options: MemoryOptions): Memory {
  const piiGuard = options.pii ?? new BuiltinPiiGuard()
  const now = options.now ?? ((): number => Date.now())
  const entities = new EntityMemoryStore(options.dbPath, { now })
  const notes = new NotesStore(options.workspaceDir, piiGuard)
  const writePolicyOf = options.writePolicy
  // Gm0 上限可配(19 §10-#1):部署侧经 glue MemoryPluginConfig 注入,缺省=既有常量。
  const limits = {
    contentMaxChars: options.contentMaxChars ?? MEMORY_CONTENT_MAX_CHARS,
    perDomainLimit: options.perDomainLimit ?? MEMORY_PER_DOMAIN_LIVE_LIMIT,
  }
  const audit = options.audit ?? new MemoryAuditLedger({ path: defaultMemoryAuditPath(options.dbPath) })
  let disposed = false
  return {
    id: MEMORY_SERVICE_ID,
    notes,
    entities,
    piiGuard,
    writeEntity(input: EntityWriteInput): EntityWriteResult {
      piiGuard.assertClean(
        { subject: input.subject, key: input.key, content: input.content, ...(input.summary !== undefined && { summary: input.summary }) },
        `entity:${input.subject}/${input.key}`,
      )
      // Gm0 结构闸(M-M2 T8,19 号 §4-T8):单条正文 ≤2000 字,超长拒绝
      //(entity-store 65536 是物理容量;业务上限在此收紧,三通道同闸)。
      const contentLength = input.content.trim().length
      if (contentLength > limits.contentMaxChars) {
        throw new RangeError(`[memory] 单条记忆正文超长(${contentLength} > ${limits.contentMaxChars} 字):请拆分为多条一个事实的记忆,或先整固既有条目`)
      }
      // 写入策略档位(T12-①):每次写入现取(glue 文件桥热应用;缺席=现行规则)。
      return decideAndWrite(entities, input, writePolicyOf?.(), limits)
    },
    async writeNote(file: string, content: string): Promise<NoteWriteResult> {
      return notes.write(file, content)
    },
    async appendNote(file: string, content: string): Promise<NoteWriteResult> {
      return notes.append(file, content)
    },
    readEntity(subject: string, key: string): EntityRecord | null {
      return entities.read(subject, key)
    },
    async search(query: string, searchOptions: MemorySearchOptions = {}): Promise<readonly MemorySearchHit[]> {
      const limit = searchOptions.limit ?? 20
      const entityHits = entities.search(query, {
        ...(searchOptions.subject !== undefined && { subject: searchOptions.subject }),
        ...(searchOptions.scope !== undefined && { scope: searchOptions.scope }),
        ...(searchOptions.domainKey !== undefined && { domainKey: searchOptions.domainKey }),
        limit,
      }).map(hit => ({
        source: `entity:${hit.record.subject}/${hit.record.key}#${hit.record.id}`,
        kind: 'entity' as const,
        title: `${hit.record.subject}/${hit.record.key}`,
        summary: withStalenessMark(hit.record.summary ?? excerpt(hit.record.content), hit.record.updatedAt, now()),
      }))
      if (entityHits.length >= limit) return entityHits.slice(0, limit)
      if (searchOptions.includeNotes === false) return entityHits
      const noteHits = (await notes.search(query, { limit: limit - entityHits.length })).map(hit => ({
        source: `notes:${hit.source}`,
        kind: 'note' as const,
        title: hit.source,
        summary: hit.excerpt,
      }))
      return [...entityHits, ...noteHits]
    },
    forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] } {
      return entities.forget(subject, key)
    },
    review(id: number, decision: EntityReviewDecision): EntityRecord | null {
      return entities.review(id, decision)
    },
    listForReview(state: EntityReviewState, limit?: number): readonly EntityRecord[] {
      return entities.listForReview(state, limit)
    },
    touch(ids: readonly number[]): number {
      return entities.touch(ids)
    },
    supersede(id: number): EntityRecord | null {
      return entities.supersede(id)
    },
    buildIndex(indexOptions: MemoryIndexOptions = {}): MemoryIndexResult {
      return buildEntityIndex(entities.listLive(), indexOptions)
    },
    recordDomainResolve(entry: DomainResolveAuditEntry): void {
      audit.recordDomainResolve(entry)
    },
    recordCorrection(entry: CorrectionAuditEntry): void {
      audit.recordCorrection(entry)
    },
    metrics(): MemoryMetricsReport {
      const portraitEntries = entities.listLive('user').filter(record => record.kind === 'semantic').length
      const indexZones = computeIndexZoneTokens(options.dbPath)
      return buildMemoryMetrics(audit.readAll(), { portraitEntries, ...(indexZones !== null ? { indexZones } : {}) })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      entities.close()
    },
  }
}

function excerpt(content: string): string {
  const chars = Array.from(content.trim())
  return chars.length <= 60 ? chars.join('') : `${chars.slice(0, 60).join('')}…`
}

/** 检索命中摘要追加时效尾标(M-M1 T3,19 §3-T3.3):>14 天附「(N 天未验证)」,与索引行同口径。 */
function withStalenessMark(text: string, updatedAt: number, nowMs: number): string {
  const suffix = stalenessSuffix(updatedAt, nowMs)
  return suffix === '' ? text : `${text} ${suffix}`
}

/**
 * 四操作决策 + 落库(19 号 §3-T2.4,写入口唯一路径;T8 增 Gm0 容量闸):
 * 1. 同 (subject,key) 已有 live 行:重叠 ≥NOOP 阈值 → noop(拒绝写入,返回既有行);
 *    否则 UPDATE(同键顶替,既有语义);
 * 2. 无同键行时扫描同 scope+kind(+域)live 行:最大重叠 ≥NOOP → noop;
 *    ≥MERGE 阈值 → 强制 UPDATE:内容合并写入**既有 key**(顶替该行),返回中
 *    的 key 即被更新的 key;扫描顺序稳定,取首个最大重叠;
 *    input.skipCrossKeyDedup(Gm1 判定后写入)跳过本步——对账决策(矛盾/无关
 *    → 独立入库)优先于合并启发式;
 * 3. 都不命中 → ADD;ADD 前过 Gm0 单域容量闸(超限拒绝并提示整固)。
 * review_state 由 resolveWriteReviewState 分级判定后统一带上(writePolicy 为
 * T12-① 部署级档位;缺席=现行规则)。
 */
function decideAndWrite(
  entities: EntityMemoryStore,
  input: EntityWriteInput,
  writePolicy: MemoryWritePolicy | undefined,
  limits: { readonly contentMaxChars: number; readonly perDomainLimit: number },
): EntityWriteResult {
  const reviewState = resolveWriteReviewState(input, writePolicy)
  const sameKey = entities.read(input.subject, input.key)
  if (sameKey !== null && tokenOverlapRatio(sameKey.content, input.content) >= MEMORY_DEDUP_NOOP_OVERLAP) {
    return noopResult(sameKey)
  }
  if (sameKey !== null) {
    return withDecision('update', entities.write({ ...input, reviewState }))
  }
  if (input.skipCrossKeyDedup !== true) {
    let best: { row: EntityRecord; ratio: number } | undefined
    for (const row of entities.liveRowsForDedup(input)) {
      const ratio = tokenOverlapRatio(row.content, input.content)
      if (ratio >= MEMORY_DEDUP_MERGE_OVERLAP && (best === undefined || ratio > best.ratio)) {
        best = { row, ratio }
      }
    }
    if (best !== undefined && best.ratio >= MEMORY_DEDUP_NOOP_OVERLAP) {
      return noopResult(best.row)
    }
    if (best !== undefined) {
      const { row } = best
      const summary = input.summary ?? row.summary
      const merged = entities.write({
        subject: row.subject,
        key: row.key,
        content: mergeMemoryContents(row.content, input.content, limits.contentMaxChars),
        ...(summary !== null && { summary }),
        confidence: Math.max(row.confidence, input.confidence ?? 0.8),
        ...(input.validAt !== undefined && { validAt: input.validAt }),
        kind: row.kind,
        scope: row.scope,
        ...(row.domainKey !== null && { domainKey: row.domainKey }),
        reviewState,
        ...(input.source !== undefined && { source: input.source }),
        ...(input.originSessionId !== undefined && { originSessionId: input.originSessionId }),
        ...(input.originTurnRef !== undefined && { originTurnRef: input.originTurnRef }),
      })
      return withDecision('update', merged)
    }
  }
  // Gm0 容量闸(M-M2 T8,19 号 §4-T8):仅新增 live 行时检查——顶替/合并路径
  // 在上方 return,不新增 live 行故不受限;user/legacy-org 无域语义不设限。
  assertDomainLiveCapacity(entities, input, limits.perDomainLimit)
  return withDecision("add", entities.write({ ...input, reviewState }))
}

/**
 * Gm0 单域 live 上限检查:scope='domain' 的写入在 ADD 前计数该域 live 行
 * (含 pending,与查重面同口径),≥perDomainLimit 即拒绝,错误信息提示整固
 * (19 号 §4-T8「超限拒绝并提示整固」)。非 domain 作用域直接放行。
 */
function assertDomainLiveCapacity(entities: EntityMemoryStore, input: EntityWriteInput, perDomainLimit: number): void {
  const scope: EntityScope = input.scope ?? 'domain'
  if (scope !== 'domain') return
  const domainKey = resolveDomainKey(input.domainKey, scope, input.subject)
  if (domainKey === null) return
  const live = entities.countLiveInDomain({ subject: input.subject, ...(input.domainKey !== undefined && { domainKey: input.domainKey }) })
  if (live >= perDomainLimit) {
    throw new RangeError(
      `[memory] 域 ${domainKey} 的 live 记忆已达上限 ${perDomainLimit}(perDomainLimit),拒绝新增:`
      + '请先整固(consolidation)或用 memory_forget 清理该域后再写入',
    )
  }
}

/** decision 覆写:store.write 原语只标注 add/update,门面路径统一经此收口(undo 包一层箭头保 this 绑定纪律)。 */
function withDecision(decision: EntityWriteDecision, result: EntityWriteResult): EntityWriteResult {
  return {
    decision,
    record: result.record,
    superseded: result.superseded,
    undo: (): void => {
      result.undo()
    },
  }
}

/** noop 结果:未写入任何行——record=判定依据的既有 live 行,superseded 空,undo 幂等无操作。 */
function noopResult(existing: EntityRecord): EntityWriteResult {
  return { decision: 'noop', record: existing, superseded: [], undo: (): void => undefined }
}
