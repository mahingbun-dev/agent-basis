/**
 * M-M3 T11 重量 Dream(19 号 §5-T11 + 18 号 §6 周期行 + 19a 号 S4 结论 B):
 * 四阶段 Orient / Gather / Consolidate / Prune 的库内实现,经 ConsolidationTask
 * seam 并入 T6 同一调度器(单 running + latest-pending 覆盖合并,触发与游标
 * 语义在 consolidation.ts)。
 *
 * 设计依据与落地口径:
 * - **触发(S4-B 退路)**:schedule seam 判定不可用(dsh-schedule 语义是「把
 *   指令 prompt 投递进会话」,与库内冻结 prompt 直调正面冲突),采「会话尾触发
 *   + 时间阈值合并」——lastDreamAt=consolidation_cursor('dream') 行,由 glue 在
 *   轻量链落定后调 maybeEnqueueDream;宿主不运行不触发,重启后首个会话尾由
 *   时间阈值自然补跑一次(与 schedule「投递时宿主必须运行」同限)。
 * - **Orient**:盘点 user 层 + 各域 live 记忆与索引规模(纯读,进周报)。
 * - **Gather(窄读不全量)**:只读窗口期(自 lastDreamAt 起)的 live episodic
 *   行,条数上限 maxTurns(19 §6 `dream.maxTurns`,缺省 50),新近优先截断;
 *   `evolve_signal` 在 evolve 包挂载前缺席,按 19 号原文「未挂载则只读 episodic」
 *   执行,挂载后此处在信号面并入(结构预留:聚类输入即 SignalLike 形态)。
 * - **Consolidate**:① 域内晋升——episodic 行按域映射为 evolve reflector 的
 *   SignalLike,复用 `clusterSignals` 聚类(同模式 ≥ DREAM_MIN_CLUSTER_COUNT=2,
 *   「一次性意外不沉淀」),curator(冻结提示词直调,S4-A 同管道)起草
 *   semantic/procedural 提案,落库后按写入口既有规则转 pending → 审批卡片
 *   (L2 半自动,18 §3.2 Gm2-域内);② 稳定偏好 → user 层提案,Q3 决议
 *   (18 §13)初始全审:userPromotionSampleRate=1.0 时逐条 pending 审批卡片,
 *   画像稳定后降采样率(确定性哈希抽样,选中才审,未选中自动生效);③ 矛盾
 *   对账扩展到 NOTES/AGENTS.md——curator 判定冲突 → CONFLICT-FLAG(复用
 *   summary 前缀标注,不改指令文件),列入周报;④ 相对日期转绝对——冻结提示词
 *   纪律 + `absolutizeRelativeDates` 确定性兜底(天粒度封闭词集);⑤ 删除被
 *   证伪事实为提案——curator 产出回收项,落地为 supersede 软失效(18 §6
 *   「软失效优先;物理删除仅用户显式 forget」),可审计可追溯。
 * - **Prune**:episodic TTL 30 天淘汰(Q5 决议)、perDomainLimit 挤出(超出部分
 *   按 18 §4.2 检索分升序软失效——半衰期降权即排序口径,「索引裁剪」由 live 集
 *   收缩传导至派生索引)、画像再生成(条件:user 层 approved 记忆数变化 ≥1 或
 *   距上次 ≥24h;T4 buildPortrait 复用,写 portrait.md 并 bump version)。
 * - **周报**:每次运行写一行 `dream` 审计事件(晋升/淘汰/CONFLICT-FLAG/画像
 *   变更摘要),panel 展示在 T12 消费。
 *
 * 幂等性:LLM 阶段失败 → 任务抛错 → lastDreamAt 不推进,下次会话尾整段重跑;
 * 重跑安全建立在写入口 noop 去重 / supersede 幂等(非 live 行返回 null)/
 * 画像版本单调 bump 之上。纪律对齐 consolidation/extraction:coeffect 全声明
 * (ctx/memory/meta/路由/参数构造注入);模型输出防御式解析(坏条目丢弃计数)。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { clusterSignals } from '@eterna/evolve'
import type { SignalLike } from '@eterna/evolve'
import type { DreamAuditEntry, MemoryAuditLedger, MemoryAuditPendingItem } from './audit.ts'
import type {
  ConsolidationLogger, ConsolidationMetaStore, ConsolidationSnapshot, ConsolidationTask,
} from './consolidation.ts'
import { DEFAULT_DREAM_INTERVAL_HOURS, DREAM_CURSOR_SESSION_ID } from './consolidation.ts'
import type { DomainRegistryStore } from './domain.ts'
import { coerceDomainKey } from './entity-store.ts'
import type { EntityRecord } from './entity-store.ts'
import type { ExtractionRoute } from './extraction.ts'
import { buildMemoryManifest, resolveCuratorRoute, runCuratorOneShot } from './extraction.ts'
import { MEMORY_HALF_LIFE_DAYS, buildEntityIndex, memoryRecallScore } from './index-builder.ts'
import type { Memory } from './memory.ts'
import { MEMORY_PER_DOMAIN_LIVE_LIMIT } from './memory.ts'
import { buildPortrait } from './portrait.ts'

const MS_PER_DAY = 86_400_000
const MS_PER_HOUR = 3_600_000

// ---------- 冻结提示词(与 tests/fixtures/dream-*-prompt.md 逐字一致) ----------

/**
 * Consolidate 阶段提示词(冻结,system 位;与 tests/fixtures/dream-consolidation-prompt.md
 * 逐字一致,单测钉住)。三类动作:域内晋升 / 稳定偏好 / 回收;晋升只能出自
 * 聚类簇(≥2),回收只针对清单中被证伪条目。改动必须同步 fixture,不得只改一处。
 */
export const DREAM_CONSOLIDATION_PROMPT = [
  '# 记忆整固(curator,重量 Dream Consolidate 阶段)',
  '',
  '你是周期性记忆整固器。依据下方的「当前盘点」「窗口期 episodic 记录」「重复模式簇」与「现有记忆清单」,产出三类整固动作。你没有工具、没有文件系统访问权,也不需要任何验证:只用给出的材料判断,不得引用或臆造材料之外的信息,不得假装已查证。',
  '',
  '## 整固纪律',
  '',
  '- 域内晋升(promotions)只能出自「重复模式簇」:同一模式在同域重复出现才值得沉淀为 semantic(事实)或 procedural(怎么做)记忆;一次性意外不沉淀。',
  '- 稳定偏好(preferences)只收在窗口期材料中反复出现、可跨会话成立的用户偏好,写入用户画像层;拿不准就不收。',
  '- 删除被证伪事实(retractions)只针对「现有记忆清单」中被窗口期材料证明已不成立或已过期的条目,必须引用其 subject 与 key;拿不准就不提。',
  '- 相对日期(「昨天」「3 天前」)换算为绝对日期;负向措辞转为正向;一条记忆一个事实,正文自包含。',
  '- 晋升与偏好提案先对照「现有记忆清单」查重:内容已被既有条目覆盖的不重复提案。',
  '',
  '## 输出格式(严格)',
  '',
  '输出有且仅有一个 JSON 对象,不附带任何其他文字、注释或代码块围栏:',
  '{"promotions":[{"domain_key":"deploy","kind":"procedural","key":"deploy-blue-green","content":"部署采用蓝绿策略:先起新实例,健康检查通过后切流量。","summary":"部署用蓝绿","confidence":0.8}],"preferences":[{"key":"weekly-report-language","content":"周报用中文。","summary":"周报用中文","confidence":0.9}],"retractions":[{"subject":"domain:deploy","key":"stale-fact","reason":"窗口期材料已确认该做法废止"}]}',
  '- 字段口径:promotions 的 kind 只能是 semantic 或 procedural,domain_key 为 kebab-case;preferences 无 scope 字段(固定用户画像层);retractions 的 subject 形态为 user 或 domain:<域键>(与清单行首一致)。',
  '- 无动作的数组留空 []。',
].join('\n')

/**
 * 矛盾对账提示词(冻结,system 位;与 tests/fixtures/dream-conflict-prompt.md
 * 逐字一致,单测钉住)。CONFLICT-FLAG 口径:只标「与指令文件明文规则直接矛盾」
 * 的记忆条目,不改写指令文件。改动必须同步 fixture,不得只改一处。
 */
export const DREAM_CONFLICT_PROMPT = [
  '# 记忆对账(curator,重量 Dream 矛盾对账)',
  '',
  '你是记忆与指令文件的对账器。判断下方「记忆清单」中的条目是否与「指令文件」(AGENTS.md/NOTES)的明文规则直接矛盾。你没有工具、没有文件系统访问权,也不需要任何验证:只用给出的材料判断,不得引用或臆造材料之外的信息,不得假装已查证。',
  '',
  '## 对账纪律',
  '',
  '- 只标「直接矛盾」:记忆的说法与指令文件的明文规则不能同时成立;近似、补充细化或无关都不算矛盾。',
  '- 不确定不标;输出不改写指令文件,只标注记忆条目待核对(冲突由系统记 CONFLICT-FLAG 并列入周报)。',
  '- subject 的取值形态为 user 或 domain:<域键>,与记忆清单行首方括号内的标注一致。',
  '',
  '## 输出格式(严格)',
  '',
  '输出有且仅有一个 JSON 对象,不附带任何其他文字、注释或代码块围栏:',
  '{"conflicts":[{"subject":"user","key":"weekly-report-language","file":"AGENTS.md","reason":"记忆称周报用英文,与 AGENTS.md「周报一律中文」矛盾"}]}',
  '- 无冲突输出 {"conflicts":[]}。',
].join('\n')

// ---------- 常量(19 号 §6 配置键的库内缺省值) ----------

/** Gather 窄读条数上限(19 §6 `dream.maxTurns` 的库内缺省)。 */
export const DEFAULT_DREAM_MAX_TURNS = 50

/** episodic TTL 天数(18 §13 Q5 决议:30 天起步)。 */
export const DEFAULT_EPISODIC_TTL_DAYS = 30

/** 单域 live 上限(与 Gm0 容量闸同值,19 §6 episodic.perDomainLimit)。 */
export const DEFAULT_EPISODIC_PER_DOMAIN_LIMIT = MEMORY_PER_DOMAIN_LIVE_LIMIT

/** user 晋升抽样审比例(18 §13 Q3 决议:初始全审 1.0)。 */
export const DEFAULT_USER_PROMOTION_SAMPLE_RATE = 1.0

/** Consolidate 直调的输出 token 上限(三类动作 JSON 的量级)。 */
export const DEFAULT_DREAM_CONSOLIDATION_MAX_TOKENS = 2_048

/** 对账直调的输出 token 上限(冲突清单 JSON 的量级)。 */
export const DEFAULT_DREAM_CONFLICT_MAX_TOKENS = 512

/** 域内晋升的最小簇计数(19 号 §5-T11「聚类 ≥2」;与 evolve repeatThreshold 同值)。 */
export const DREAM_MIN_CLUSTER_COUNT = 2

/** CONFLICT-FLAG 的 summary 前缀(19 号 §5-T11 ③「记 conflict_flag 列/复用 summary 前缀」取后者,免 schema 变更)。 */
export const CONFLICT_FLAG_PREFIX = '[CONFLICT-FLAG]'

/** 画像再生成的间隔条件(19 号 §5-T11「距上次 ≥24h」)。 */
export const PORTRAIT_REGEN_INTERVAL_HOURS = 24

/** consolidation_meta 键:画像最近一次生成时刻(epoch ms)。 */
export const PORTRAIT_META_GENERATED_AT = 'portrait.generated_at'

/** consolidation_meta 键:画像最近一次生成时的 user 层 approved live 记忆数。 */
export const PORTRAIT_META_USER_COUNT = 'portrait.user_count'

// ---------- Orient(阶段①:盘点) ----------

/** Orient 盘点报告(周报与 Consolidate 材料的输入)。 */
export interface DreamOrientReport {
  /** user 层 approved live 记忆数(画像再生成条件的计数口径)。 */
  readonly userLiveCount: number
  /** 各域 approved live 记忆数(域键升序,周报可读)。 */
  readonly domainCounts: readonly { readonly domainKey: string; readonly liveCount: number }[]
  /** 待审(pending)行数。 */
  readonly pendingCount: number
  /** 注入索引的实际 token 规模(≤ 预算,索引裁剪效果对照)。 */
  readonly indexTokens: number
}

/** Orient 可选项(时钟与半衰期注入,测试确定性用)。 */
export interface DreamOrientOptions {
  readonly now?: () => number
  readonly halfLifeDays?: number
}

/** 阶段① Orient:盘点 user 层+各域 live 记忆与索引规模(纯读,不写)。 */
export function orientMemory(memory: Memory, options: DreamOrientOptions = {}): DreamOrientReport {
  const live = memory.entities.listLive()
  const domainCounts = new Map<string, number>()
  let userLiveCount = 0
  for (const row of live) {
    if (row.scope === 'user') userLiveCount += 1
    if (row.scope === 'domain' && row.domainKey !== null) {
      domainCounts.set(row.domainKey, (domainCounts.get(row.domainKey) ?? 0) + 1)
    }
  }
  const index = buildEntityIndex(live, {
    ...(options.halfLifeDays !== undefined && { halfLifeDays: options.halfLifeDays }),
    ...(options.now !== undefined && { now: options.now }),
  })
  return {
    userLiveCount,
    domainCounts: [...domainCounts.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([domainKey, liveCount]) => ({ domainKey, liveCount })),
    pendingCount: memory.listForReview('pending', 100_000).length,
    indexTokens: index.estimatedTokens,
  }
}

// ---------- Gather(阶段②:窄读) ----------

/** Gather 报告(窗口期 episodic 窄读结果;truncated=超 maxRows 截断)。 */
export interface DreamGatherReport {
  readonly rows: readonly EntityRecord[]
  readonly windowStart: number
  readonly maxRows: number
  readonly truncated: boolean
}

/** Gather 可选项。 */
export interface DreamGatherOptions {
  /** 窗口起点(epoch ms;dream 快照携带,首跑回落 now-interval)。 */
  readonly windowStart: number
  /** 条数上限(19 §6 dream.maxTurns,缺省 50;新近优先截断——窄读不全量)。 */
  readonly maxRows?: number
}

/** 阶段② Gather:只读窗口期内的 live episodic 行(evolve_signal 未挂载,19 号原文「未挂载则只读 episodic」)。 */
export function gatherEpisodicWindow(memory: Memory, options: DreamGatherOptions): DreamGatherReport {
  const maxRows = options.maxRows ?? DEFAULT_DREAM_MAX_TURNS
  const rows = memory.entities.listLive()
    .filter(row => row.kind === 'episodic' && row.updatedAt >= options.windowStart)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
  return {
    rows: rows.slice(0, maxRows),
    windowStart: options.windowStart,
    maxRows,
    truncated: rows.length > maxRows,
  }
}

// ---------- 聚类(evolve reflector clusterSignals 复用,19 号 §5-T11 ①) ----------

/** 一个晋升候选簇(同域同模式 ≥ DREAM_MIN_CLUSTER_COUNT 的 episodic 聚合视图)。 */
export interface DreamClusterView {
  readonly domainKey: string
  /** 聚类键(clusterKeyOf:trajectory_hash 或 kind+归一化摘要签名)。 */
  readonly key: string
  readonly count: number
  readonly members: readonly { readonly key: string; readonly summary: string }[]
}

/**
 * 窗口期 episodic 行 → 按域聚类(复用 @eterna/evolve reflector 的纯函数
 * clusterSignals——「同 (模式,根因) 聚类 ≥2」的既定口径):每行映射为
 * SignalLike(summary 取显式摘要,缺省正文摘题;trajectoryHash 未挂载前缺席),
 * 只计 ≥2 的簇(count 降序)。簇命中率取决于上游摘要质量——会话史行的摘要
 * 为确定性摘题,LLM episodic 提案携带真实摘要;evolve_signal 挂载后此输入面
 * 直接并入信号(trajectoryHash 使聚类按轨迹命中)。
 */
export function clusterEpisodicRows(rows: readonly EntityRecord[]): readonly DreamClusterView[] {
  const byDomain = new Map<string, readonly EntityRecord[]>()
  for (const row of rows) {
    if (row.scope !== 'domain') continue
    const domainKey = row.domainKey ?? 'default'
    byDomain.set(domainKey, [...(byDomain.get(domainKey) ?? []), row])
  }
  const views: DreamClusterView[] = []
  for (const [domainKey, domainRows] of byDomain) {
    const rowOfId = new Map(domainRows.map(row => [row.id, row] as const))
    for (const cluster of clusterSignals(domainRows.map(row => toSignalLike(row, domainKey)))) {
      if (cluster.count < DREAM_MIN_CLUSTER_COUNT) continue
      views.push({
        domainKey,
        key: cluster.key,
        count: cluster.count,
        members: cluster.signals.map((signal) => {
          const row = rowOfId.get(Number(signal.id))
          return {
            key: row?.key ?? signal.ref,
            summary: row === undefined ? signal.payload.summary : (row.summary ?? excerptForCluster(row.content)),
          }
        }),
      })
    }
  }
  return views
}

/** episodic 行 → evolve reflector 消费形态(19 号 §5-T11「复用 clusterSignals」的映射面)。 */
function toSignalLike(row: EntityRecord, domainKey: string): SignalLike {
  return {
    id: row.id,
    ts: row.updatedAt,
    packId: domainKey,
    kind: row.kind,
    ref: `memory:${row.id}`,
    payload: { summary: row.summary ?? excerptForCluster(row.content), tags: [] },
  }
}

/** 聚类摘要摘题(80 字符,码点切片;normalizeSummary 侧再截,口径一致)。 */
function excerptForCluster(content: string): string {
  const chars = Array.from(content.trim())
  return chars.length <= 80 ? chars.join('') : `${chars.slice(0, 80).join('')}…`
}

// ---------- 相对日期转绝对(19 号 §5-T11 ④,确定性兜底) ----------

/** 天粒度封闭词集(周/月粒度语义含糊,不属确定性可转面,交提示词纪律)。 */
const RELATIVE_DAY_TOKENS: readonly (readonly [string, number])[] = [
  ['前天', -2], ['昨天', -1], ['今天', 0], ['明天', 1], ['后天', 2],
]

/**
 * 相对日期转绝对(确定性兜底,对 Consolidate 产出的正文与摘要执行):
 * 封闭词集(前天/昨天/今天/明天/后天 + 「N 天前/后」)以注解形态追加绝对日期
 * ——`昨天(2026-11-13)`——保原语义且幂等(已带 ISO 注解的不再追加)。周/月
 * 粒度(「下周」「下月」)语义含糊(锚点是周界还是当日?),不属确定性可转面,
 * 由冻结提示词纪律约束起草。日期按本地时区取整。
 */
export function absolutizeRelativeDates(text: string, nowMs: number): string {
  let result = text
  for (const [token, deltaDays] of RELATIVE_DAY_TOKENS) {
    const pattern = new RegExp(`${token}(?!\\(\\d{4}-\\d{2}-\\d{2}\\))`, 'gu')
    result = result.replace(pattern, match => `${match}(${isoDateOf(nowMs, deltaDays)})`)
  }
  result = result.replace(/(\d+)\s*天前(?!\(\d{4}-\d{2}-\d{2}\))/gu, (match, digits: string) => `${match}(${isoDateOf(nowMs, -Number(digits))})`)
  result = result.replace(/(\d+)\s*天后(?!\(\d{4}-\d{2}-\d{2}\))/gu, (match, digits: string) => `${match}(${isoDateOf(nowMs, Number(digits))})`)
  return result
}

/** 本地时区 YYYY-MM-DD(epoch ms + 天偏移)。 */
function isoDateOf(nowMs: number, deltaDays: number): string {
  const date = new Date(nowMs + deltaDays * MS_PER_DAY)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// ---------- Consolidate 输出解析(防御式) ----------

/** 域内晋升提案(curator 起草;kind 限 semantic/procedural)。 */
export interface DreamPromotionProposal {
  readonly domainKey: string
  readonly kind: 'semantic' | 'procedural'
  readonly key: string
  readonly content: string
  readonly summary?: string
  readonly confidence?: number
}

/** 稳定偏好提案(固定落 user 层 semantic)。 */
export interface DreamPreferenceProposal {
  readonly key: string
  readonly content: string
  readonly summary?: string
  readonly confidence?: number
}

/** 被证伪事实回收提案(引用既有条目;落地为 supersede 软失效,18 §6 软失效纪律)。 */
export interface DreamRetractionProposal {
  readonly subject: string
  readonly key: string
  readonly reason?: string
}

/** 对账冲突项(冲突 → CONFLICT-FLAG,不改指令文件)。 */
export interface DreamConflictItem {
  readonly subject: string
  readonly key: string
  readonly file?: string
  readonly reason?: string
}

/** Consolidate 直调输出(三类动作;dropped=被丢弃坏条目数)。 */
export interface DreamConsolidationOutput {
  readonly promotions: readonly DreamPromotionProposal[]
  readonly preferences: readonly DreamPreferenceProposal[]
  readonly retractions: readonly DreamRetractionProposal[]
  readonly dropped: number
}

/** 对账直调输出。 */
export interface DreamConflictOutput {
  readonly conflicts: readonly DreamConflictItem[]
  readonly dropped: number
}

/** Dream 直调输出整体不可解析(无任何 JSON 对象可抢救):上抛交调度器按任务失败处理。 */
export class DreamParseError extends Error {
  override name = 'DreamParseError'
  constructor(detail: string) {
    super(`[memory] Dream 输出不可解析:${detail}`)
  }
}

/** 解析 Consolidate 输出(抢救首个 JSON 对象;缺数组给空、坏条目丢弃计数)。 */
export function parseDreamConsolidationOutput(text: string): DreamConsolidationOutput {
  const record = parseDreamObject(text)
  const promotions: DreamPromotionProposal[] = []
  const preferences: DreamPreferenceProposal[] = []
  const retractions: DreamRetractionProposal[] = []
  let dropped = 0
  for (const item of asArray(record['promotions'])) {
    const proposal = coercePromotion(item)
    if (proposal === null) dropped += 1
    else promotions.push(proposal)
  }
  for (const item of asArray(record['preferences'])) {
    const proposal = coercePreference(item)
    if (proposal === null) dropped += 1
    else preferences.push(proposal)
  }
  for (const item of asArray(record['retractions'])) {
    const proposal = coerceRetraction(item)
    if (proposal === null) dropped += 1
    else retractions.push(proposal)
  }
  return { promotions, preferences, retractions, dropped }
}

/** 解析对账输出(同防御式口径)。 */
export function parseDreamConflictOutput(text: string): DreamConflictOutput {
  const record = parseDreamObject(text)
  const conflicts: DreamConflictItem[] = []
  let dropped = 0
  for (const item of asArray(record['conflicts'])) {
    const conflict = coerceConflict(item)
    if (conflict === null) dropped += 1
    else conflicts.push(conflict)
  }
  return { conflicts, dropped }
}

/** 抢救 JSON 对象(域/提取同款口径:原文 → 代码块围栏 → 首尾大括号切片);结构坏抛 DreamParseError。 */
function parseDreamObject(text: string): Record<string, unknown> {
  const candidates: string[] = [text]
  const fence = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim())
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>
      }
    } catch {
      // 尝试下一个候选形态
    }
  }
  throw new DreamParseError(previewOf(text))
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

const PROPOSAL_KEY_MAX = 128

/** 晋升提案防御校验:域键 kebab 收敛失败/kind 非法/key 空白/正文空 → 丢弃。 */
function coercePromotion(item: unknown): DreamPromotionProposal | null {
  if (!isRecord(item)) return null
  const domainKey = coerceDomainKey(item['domain_key'])
  if (domainKey === undefined) return null
  const kind = item['kind']
  if (kind !== 'semantic' && kind !== 'procedural') return null
  return withTextFields(item, (key, content, summary, confidence) => ({
    domainKey, kind, key, content,
    ...(summary !== undefined && { summary }),
    ...(confidence !== undefined && { confidence }),
  }))
}

/** 偏好提案防御校验(固定 user/semantic;字段口径同上)。 */
function coercePreference(item: unknown): DreamPreferenceProposal | null {
  if (!isRecord(item)) return null
  return withTextFields(item, (key, content, summary, confidence) => ({
    key, content,
    ...(summary !== undefined && { summary }),
    ...(confidence !== undefined && { confidence }),
  }))
}

/** 回收提案防御校验:subject 限 'user' 或 'domain:<kebab>'(与清单行首一致)。 */
function coerceRetraction(item: unknown): DreamRetractionProposal | null {
  if (!isRecord(item)) return null
  const subject = item['subject']
  if (typeof subject !== 'string' || !isValidDreamSubject(subject)) return null
  const key = item['key']
  if (typeof key !== 'string' || key.length === 0 || key.length > PROPOSAL_KEY_MAX || /\s/u.test(key)) return null
  const reason = optionalText(item['reason'])
  return { subject, key, ...(reason !== undefined && { reason }) }
}

/** 对账冲突项防御校验(subject 口径同回收;file/reason 可选)。 */
function coerceConflict(item: unknown): DreamConflictItem | null {
  if (!isRecord(item)) return null
  const subject = item['subject']
  if (typeof subject !== 'string' || !isValidDreamSubject(subject)) return null
  const key = item['key']
  if (typeof key !== 'string' || key.length === 0 || key.length > PROPOSAL_KEY_MAX || /\s/u.test(key)) return null
  const file = optionalText(item['file'])
  const reason = optionalText(item['reason'])
  return { subject, key, ...(file !== undefined && { file }), ...(reason !== undefined && { reason }) }
}

/** 晋升/偏好共有的文本字段校验(key/content/summary/confidence),合法才回调组装。 */
function withTextFields<T>(
  item: Record<string, unknown>,
  build: (key: string, content: string, summary: string | undefined, confidence: number | undefined) => T,
): T | null {
  const key = item['key']
  if (typeof key !== 'string' || key.length === 0 || key.length > PROPOSAL_KEY_MAX || /\s/u.test(key)) return null
  const rawContent = item['content']
  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) return null
  const summary = optionalText(item['summary'])
  let confidence: number | undefined
  const rawConfidence = item['confidence']
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    confidence = Math.min(1, Math.max(0, rawConfidence))
  } else if (rawConfidence !== undefined) {
    return null
  }
  return build(key, rawContent.trim(), summary, confidence)
}

/** dream 提案可引用的 subject 形态:'user' 或 'domain:<kebab 域键>'。 */
function isValidDreamSubject(subject: string): boolean {
  if (subject === 'user') return true
  if (!subject.startsWith('domain:')) return false
  return coerceDomainKey(subject.slice('domain:'.length)) !== undefined
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function previewOf(text: string): string {
  const chars = Array.from(text)
  return chars.length <= 80 ? chars.join('') : `${chars.slice(0, 80).join('')}…`
}

// ---------- Consolidate 落库(①晋升 ②偏好 ⑤回收) ----------

/** Consolidate 落库报告(计数 + 跳过原因 + 本次产生的待审行)。 */
export interface DreamApplyReport {
  readonly promotions: number
  readonly preferences: number
  readonly retractions: number
  readonly skipped: number
  readonly skipReasons: readonly string[]
  /** 本次落库产生的待审行(审批卡片/队列数据源,口径同提案报告)。 */
  readonly pending: readonly EntityRecord[]
  /** 被证伪回收的条目明细(T13 留痕:subject/key 逐条可溯)。 */
  readonly prunedEntries: readonly { readonly subject: string; readonly key: string; readonly reason: string }[]
}

/** applyDreamConsolidation 可选项。 */
export interface DreamApplyOptions {
  /** user 晋升抽样审比例(Q3;缺省 1.0 全审)。 */
  readonly userPromotionSampleRate?: number
  /** 运行时刻(epoch ms;相对日期转绝对与 provenance 锚点)。 */
  readonly runAt: number
  readonly logger?: ConsolidationLogger
}

/**
 * Q3 抽样判定(18 §13:初始全审,画像稳定后降采样率;配置化):rate ≥1 恒审;
 * rate ≤0 恒免;其间按 key 的 FNV-1a 稳定哈希确定性抽样——同 key 跨次运行
 * 判定一致(重跑不翻烧饼)。坏 rate 视作 1(fail-closed 到全审)。
 */
export function sampleForReview(key: string, rate: number): boolean {
  const normalized = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1
  if (normalized >= 1) return true
  if (normalized <= 0) return false
  return fnv1aUnit(key) < normalized
}

/** FNV-1a 32 位 → [0,1) 稳定值(抽样判定用;稳定性优先于抗碰撞)。 */
function fnv1aUnit(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) / 0x1_0000_0000
}

/**
 * Consolidate 落库(①晋升 ②偏好 ⑤回收;③对账在 applyConflictFlags):
 * - 晋升:domain semantic/procedural,source=consolidation → 写入口既有规则
 *   判 pending(L2 审批卡片);正文/摘要先过相对日期转绝对兜底;
 * - 偏好:user semantic,source=consolidation → 默认 pending;Q3 采样未选中
 *   的条目显式 approved 自动生效(sampleForReview 确定性);
 * - 回收:引用既有 (subject,key) 的 live 行 → supersede 软失效(18 §6
 *   「软失效优先;物理删除仅用户显式 forget」),目标不存在/已失效 → 跳过。
 * 单条失败(PII/校验/容量)跳过不炸整批,事实进 skipReasons 与 warn。
 */
export function applyDreamConsolidation(
  memory: Memory,
  output: DreamConsolidationOutput,
  options: DreamApplyOptions,
): DreamApplyReport {
  const promotions = { count: 0 }
  const preferences = { count: 0 }
  const retractions = { count: 0 }
  const skipped: string[] = []
  const pending: EntityRecord[] = []
  // T13 留痕:被证伪回收/TTL 淘汰/超限挤出的条目明细(审计 DreamAuditEntry.pruned 数据源)。
  const prunedEntries: { subject: string; key: string; reason: string }[] = []
  const write = (input: Parameters<Memory['writeEntity']>[0]): void => {
    const result = memory.writeEntity(input)
    if (result.record.reviewState === 'pending') pending.push(result.record)
  }
  for (const proposal of output.promotions) {
    try {
      write({
        subject: `domain:${proposal.domainKey}`,
        key: proposal.key,
        content: absolutizeRelativeDates(proposal.content, options.runAt),
        ...(proposal.summary !== undefined && { summary: absolutizeRelativeDates(proposal.summary, options.runAt) }),
        ...(proposal.confidence !== undefined && { confidence: proposal.confidence }),
        kind: proposal.kind,
        scope: 'domain',
        domainKey: proposal.domainKey,
        source: 'consolidation',
        originSessionId: DREAM_CURSOR_SESSION_ID,
        originTurnRef: `dream:${options.runAt}`,
      })
      promotions.count += 1
    } catch (error) {
      recordSkip(skipped, proposal.key, error, options.logger, '晋升提案落库被跳过')
    }
  }
  for (const proposal of output.preferences) {
    try {
      // Q3:userPromotionSampleRate=1.0 → 恒审(缺省 pending);降档后未选中
      // 的条目显式 approved 自动生效(内部调用面显式 reviewState,模型工具无此参数)
      const reviewState = sampleForReview(proposal.key, options.userPromotionSampleRate ?? DEFAULT_USER_PROMOTION_SAMPLE_RATE)
        ? undefined
        : 'approved' as const
      write({
        subject: 'user',
        key: proposal.key,
        content: absolutizeRelativeDates(proposal.content, options.runAt),
        ...(proposal.summary !== undefined && { summary: absolutizeRelativeDates(proposal.summary, options.runAt) }),
        ...(proposal.confidence !== undefined && { confidence: proposal.confidence }),
        kind: 'semantic',
        scope: 'user',
        source: 'consolidation',
        originSessionId: DREAM_CURSOR_SESSION_ID,
        originTurnRef: `dream:${options.runAt}`,
        ...(reviewState !== undefined && { reviewState }),
      })
      preferences.count += 1
    } catch (error) {
      recordSkip(skipped, proposal.key, error, options.logger, '偏好提案落库被跳过')
    }
  }
  for (const proposal of output.retractions) {
    try {
      const row = memory.readEntity(proposal.subject, proposal.key)
      if (row === null || row.invalidAt !== null) {
        skipped.push(`${proposal.subject}/${proposal.key}:回收目标不存在或已失效`)
        continue
      }
      if (memory.supersede(row.id) !== null) {
        retractions.count += 1
        prunedEntries.push({ subject: proposal.subject, key: proposal.key, reason: 'retracted' })
      }
    } catch (error) {
      recordSkip(skipped, proposal.key, error, options.logger, '回收提案落地被跳过')
    }
  }
  return {
    promotions: promotions.count,
    preferences: preferences.count,
    retractions: retractions.count,
    skipped: skipped.length,
    skipReasons: skipped,
    pending,
    prunedEntries,
  }
}

// ---------- 矛盾对账(③ NOTES/AGENTS → CONFLICT-FLAG) ----------

/** 对账材料缺省上限:文件数与单文件字符(指令文件进提示词的预算面)。 */
const CONFLICT_MATERIAL_MAX_FILES = 10
const CONFLICT_MATERIAL_FILE_CHARS = 2_000

/** 一份对账材料(文件名 + 有界文本)。 */
export interface DreamConflictMaterial {
  readonly file: string
  readonly text: string
}

/**
 * 收集对账材料(AGENTS.md + NOTES 树一层 *.md;缺席/不可读 fail-open 忽略,
 * 数量与单文件字符有界)。全部缺席返回 null——无对账基准则跳过对账直调
 * (不花无材料的调用)。
 */
export function collectConflictMaterials(options: {
  readonly agentsPath?: string
  readonly notesDir?: string
}): readonly DreamConflictMaterial[] | null {
  const files: DreamConflictMaterial[] = []
  if (options.agentsPath !== undefined) {
    const text = readTextBounded(options.agentsPath)
    if (text !== null) files.push({ file: 'AGENTS.md', text })
  }
  if (options.notesDir !== undefined) files.push(...readNotesMaterials(options.notesDir))
  return files.length > 0 ? files.slice(0, CONFLICT_MATERIAL_MAX_FILES) : null
}

/** 有界读一个文本文件(缺席/空/不可读 → null)。 */
function readTextBounded(path: string, maxChars: number = CONFLICT_MATERIAL_FILE_CHARS): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const chars = Array.from(trimmed)
  return chars.length <= maxChars ? chars.join('') : `${chars.slice(0, maxChars).join('')}…(已截断)`
}

/** NOTES 树一层材料(NOTES.md 与 notes/*.md 同型;目录名/文件名排序保稳定)。 */
function readNotesMaterials(root: string): readonly DreamConflictMaterial[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  } catch {
    return []
  }
  const files: DreamConflictMaterial[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      pushMaterial(files, entry.name, readTextBounded(join(root, entry.name)))
      continue
    }
    if (entry.isDirectory()) {
      let sub: import('node:fs').Dirent[]
      try {
        sub = readdirSync(join(root, entry.name), { withFileTypes: true })
          .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      } catch {
        continue
      }
      for (const item of sub) {
        if (item.isFile() && item.name.endsWith('.md')) {
          pushMaterial(files, `${entry.name}/${item.name}`, readTextBounded(join(root, entry.name, item.name)))
        }
      }
    }
  }
  return files
}

function pushMaterial(files: DreamConflictMaterial[], file: string, text: string | null): void {
  if (text !== null && files.length < CONFLICT_MATERIAL_MAX_FILES) files.push({ file, text })
}

/** 对账落库报告。 */
export interface DreamConflictReport {
  readonly conflictFlags: number
  readonly skipped: number
  readonly skipReasons: readonly string[]
}

/** applyConflictFlags 可选项。 */
export interface DreamConflictApplyOptions {
  readonly runAt: number
  readonly logger?: ConsolidationLogger
}

/**
 * ③ 矛盾对账落地(19 号 §5-T11 ③):冲突 → CONFLICT-FLAG(复用 summary 前缀,
 * 免 conflict_flag 列的 schema 变更)——被标注行经存储原语顶替为「带前缀 summary
 * 的 approved 行」:标注立即生效于检索/索引面(若按 consolidation 默认规则落
 * pending,标注行不可见而原行仍无标注地活着,语义相反);content 逐字节不变
 * (PII 已在原行写入时过闸,不重复断言),**不改指令文件**(19 号原文硬边界)。
 * 已带前缀的行跳过(幂等);目标不存在/已失效 → 跳过计数。结果列入周报。
 */
export function applyConflictFlags(
  memory: Memory,
  conflicts: readonly DreamConflictItem[],
  options: DreamConflictApplyOptions,
): DreamConflictReport {
  let conflictFlags = 0
  const skipped: string[] = []
  for (const item of conflicts) {
    try {
      const row = memory.readEntity(item.subject, item.key)
      if (row === null || row.invalidAt !== null) {
        skipped.push(`${item.subject}/${item.key}:对账目标不存在或已失效`)
        continue
      }
      if (row.summary !== null && row.summary.startsWith(CONFLICT_FLAG_PREFIX)) continue
      const base = row.summary ?? excerptForCluster(row.content)
      memory.entities.write({
        subject: row.subject,
        key: row.key,
        content: row.content,
        summary: fitSummaryChars(`${CONFLICT_FLAG_PREFIX}(${item.file ?? '指令文件'}) ${base}`),
        validAt: row.validAt,
        confidence: row.confidence,
        kind: row.kind,
        scope: row.scope,
        ...(row.domainKey !== null && { domainKey: row.domainKey }),
        // provenance 保留原行出处(顶替后的标注行仍可追溯原始观察)
        ...(row.originSessionId !== null && { originSessionId: row.originSessionId }),
        ...(row.originTurnRef !== null && { originTurnRef: row.originTurnRef }),
        reviewState: 'approved',
        source: 'consolidation',
      })
      conflictFlags += 1
    } catch (error) {
      recordSkip(skipped, item.key, error, options.logger, 'CONFLICT-FLAG 落库被跳过')
    }
  }
  return { conflictFlags, skipped: skipped.length, skipReasons: skipped }
}

/** summary 列上限(entity-store FIELD_LIMITS.summary 同值 200;超长截断保前缀)。 */
function fitSummaryChars(text: string, max: number = 200): string {
  const chars = Array.from(text)
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max).join('')}…`
}

// ---------- Prune(阶段④:TTL 淘汰 / 挤出 / 画像) ----------

/** Prune 报告。 */
export interface DreamPruneReport {
  /** episodic TTL 到期软失效数(淘汰是 effect:软失效可审计,物理删除仅显式 forget)。 */
  readonly expired: number
  /** 超限挤出软失效数(半衰期降权排序,低分先出)。 */
  readonly evicted: number
  readonly evictedByDomain: readonly { readonly domainKey: string; readonly count: number }[]
  /** T13 留痕:被淘汰条目明细(subject/key 逐条可溯,reason=expired|evicted)。 */
  readonly pruned: readonly { readonly subject: string; readonly key: string; readonly reason: string }[]
}

/** pruneMemory 可选项(缺省值=19 §6/Q5 决议)。 */
export interface DreamPruneOptions {
  readonly ttlDays?: number
  readonly perDomainLimit?: number
  readonly halfLifeDays?: number
  readonly nowMs: number
}

/**
 * 阶段④ Prune:
 * - **episodic TTL 30 天淘汰**(Q5):live approved episodic 行 updatedAt 越限
 *   → supersede 软失效(淘汰也是 effect,可逆可审计;pending 行不在此列——
 *   由审批闭环处置);
 * - **perDomainLimit 挤出**:域 approved live 行超限的部分按检索分升序软失效
 *   (18 §4.2 半衰期降权即排序口径——「半衰期降权复核」落地为 Prune 时按当前
 *   时钟重算检索分;同分旧者先出);user/legacy 无域语义不设限(与 Gm0 同口径);
 * - **索引裁剪**:索引是 live 集的派生物,挤出即收缩索引来源(Orient 的
 *   indexTokens 供周报对照裁剪效果),无独立持久索引可裁。
 */
export function pruneMemory(memory: Memory, options: DreamPruneOptions): DreamPruneReport {
  const ttlDays = options.ttlDays ?? DEFAULT_EPISODIC_TTL_DAYS
  const perDomainLimit = options.perDomainLimit ?? DEFAULT_EPISODIC_PER_DOMAIN_LIMIT
  const halfLifeDays = options.halfLifeDays ?? MEMORY_HALF_LIFE_DAYS
  const cutoff = options.nowMs - ttlDays * MS_PER_DAY
  // T13 留痕:被淘汰条目明细(审计 DreamAuditEntry.pruned 数据源)。
  const pruned: { subject: string; key: string; reason: string }[] = []
  let expired = 0
  for (const row of memory.entities.listLive()) {
    if (row.kind === 'episodic' && row.updatedAt < cutoff) {
      if (memory.supersede(row.id) !== null) {
        expired += 1
        pruned.push({ subject: row.subject, key: row.key, reason: 'expired' })
      }
    }
  }
  const groups = new Map<string, EntityRecord[]>()
  for (const row of memory.entities.listLive()) {
    if (row.scope !== 'domain' || row.domainKey === null) continue
    const bucket = groups.get(row.domainKey)
    if (bucket === undefined) groups.set(row.domainKey, [row])
    else bucket.push(row)
  }
  let evicted = 0
  const evictedByDomain: { domainKey: string; count: number }[] = []
  for (const [domainKey, rows] of groups) {
    if (rows.length <= perDomainLimit) continue
    const ranked = [...rows].sort((a, b) => {
      const left = memoryRecallScore(a, options.nowMs, halfLifeDays)
      const right = memoryRecallScore(b, options.nowMs, halfLifeDays)
      if (left !== right) return left - right
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt
      return a.id - b.id
    })
    let countInDomain = 0
    for (const row of ranked.slice(0, rows.length - perDomainLimit)) {
      if (memory.supersede(row.id) !== null) {
        evicted += 1
        countInDomain += 1
        pruned.push({ subject: row.subject, key: row.key, reason: 'evicted' })
      }
    }
    evictedByDomain.push({ domainKey, count: countInDomain })
  }
  return { expired, evicted, evictedByDomain, pruned }
}

// ---------- 画像再生成(19 号 §5-T11 条件;T4 buildPortrait 复用) ----------

/** 画像再生成报告。 */
export interface PortraitRegenReport {
  readonly regenerated: boolean
  /** 本次生效/将生效的画像版本(未再生时=当前文件版本)。 */
  readonly version: number
  readonly reason: string
}

/** maybeRegeneratePortrait 可选项。 */
export interface PortraitRegenOptions {
  readonly meta: ConsolidationMetaStore
  /** portrait.md 写入路径(缺席=不落盘,跳过再生成)。 */
  readonly portraitPath?: string
  /** 域注册表投影(工作区索引节;缺席=节内占位)。 */
  readonly registry?: DomainRegistryStore
  readonly enabled?: boolean
  readonly halfLifeDays?: number
  readonly nowMs: number
  readonly logger?: ConsolidationLogger
}

/**
 * 画像再生成(条件,19 号 §5-T11:user 层 approved 记忆数变化 ≥1 **或** 距上次
 * ≥24h;首次必生成)。T4 buildPortrait 纯函数复用,version 从现有文件 frontmatter
 * 单调 bump;生成计数与时刻落 consolidation_meta(条件判定的持久锚点)。写盘
 * 失败 fail-open(warn 不抛——画像是指派生缓存,失败留待下次 Dream 重试;
 * meta 不更新即条件保持未满足)。
 */
export function maybeRegeneratePortrait(memory: Memory, options: PortraitRegenOptions): PortraitRegenReport {
  const enabled = options.enabled ?? true
  const currentVersion = options.portraitPath === undefined ? 0 : readPortraitVersion(options.portraitPath)
  if (!enabled || options.portraitPath === undefined) {
    return { regenerated: false, version: currentVersion, reason: '画像再生成关闭或缺写入路径' }
  }
  const userCount = memory.entities.listLive().filter(row => row.scope === 'user').length
  const lastCount = options.meta.getNumber(PORTRAIT_META_USER_COUNT)
  const lastGenAt = options.meta.getNumber(PORTRAIT_META_GENERATED_AT)
  const dueByAge = lastGenAt === null || options.nowMs - lastGenAt >= PORTRAIT_REGEN_INTERVAL_HOURS * MS_PER_HOUR
  const dueByCount = lastCount !== null && Math.abs(userCount - lastCount) >= 1
  if (!dueByAge && !dueByCount) {
    return { regenerated: false, version: currentVersion, reason: '未到再生成条件(计数与间隔均未触发)' }
  }
  const version = currentVersion + 1
  const markdown = buildPortrait(memory.entities.listLive(), {
    ...(options.registry !== undefined && { domains: options.registry.list() }),
    version,
    now: (): number => options.nowMs,
    ...(options.halfLifeDays !== undefined && { halfLifeDays: options.halfLifeDays }),
  })
  try {
    writeFileSync(options.portraitPath, markdown, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.logger?.warn?.(`[memory] 画像写入失败(留待下次 Dream 重试,${options.portraitPath}):${message}`)
    return { regenerated: false, version, reason: `画像写入失败:${message}` }
  }
  options.meta.set(PORTRAIT_META_GENERATED_AT, String(options.nowMs))
  options.meta.set(PORTRAIT_META_USER_COUNT, String(userCount))
  const reason = dueByCount
    ? `user 层 approved 记忆数变化(${lastCount}→${userCount})`
    : lastGenAt === null ? '首次生成' : '距上次再生成已到 24h'
  return { regenerated: true, version, reason }
}

/** 现有 portrait.md 的 frontmatter version(缺席/坏值=0;新文件下一版=1)。 */
function readPortraitVersion(portraitPath: string): number {
  let raw: string
  try {
    raw = readFileSync(portraitPath, 'utf8')
  } catch {
    return 0
  }
  const match = /^version: (\d+)$/mu.exec(raw)
  if (match === null) return 0
  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 0
}

// ---------- 直调 user 消息装配 ----------

/** Consolidate 直调 user 正文(四段材料:盘点/窗口期记录/聚类簇/现有清单+日期锚)。 */
export function buildDreamConsolidationUserText(input: {
  readonly orient: DreamOrientReport
  readonly gathered: DreamGatherReport
  readonly clusters: readonly DreamClusterView[]
  readonly manifest: string
  readonly nowMs: number
}): string {
  const domainLines = input.orient.domainCounts.map(d => `- ${d.domainKey}:live ${d.liveCount} 条`)
  const episodicLines = input.gathered.rows.map((row) => {
    const scope = `domain:${row.domainKey ?? 'default'}`
    return `- [${scope}] ${row.key} — ${row.summary ?? excerptForCluster(row.content)}`
  })
  const clusterLines = input.clusters.flatMap(cluster => [
    `- 域 ${cluster.domainKey},模式 ${cluster.key},出现 ${cluster.count} 次:`,
    ...cluster.members.map(member => `  - ${member.key} — ${member.summary}`),
  ])
  const truncationNote = input.gathered.truncated ? `(已按新近截断至 ${input.gathered.maxRows} 条)` : ''
  return [
    '## 当前盘点(Orient)',
    `- user 层 live 记忆:${input.orient.userLiveCount} 条;待审(pending):${input.orient.pendingCount} 条`,
    `- 索引规模:约 ${input.orient.indexTokens} token`,
    '- 各域 live 记忆:',
    domainLines.length > 0 ? domainLines.join('\n') : '- (无)',
    '',
    `## 窗口期 episodic 记录(自 ${new Date(input.gathered.windowStart).toISOString()} 起,新近优先${truncationNote})`,
    episodicLines.length > 0 ? episodicLines.join('\n') : '(无)',
    '',
    '## 重复模式簇(域内晋升提案只能出自这里;出现次数 ≥2 才列出)',
    clusterLines.length > 0 ? clusterLines.join('\n') : '(无)',
    '',
    '## 现有记忆清单(查重;retractions 的 subject/key 须出自这里)',
    input.manifest,
    '',
    `## 当前日期:${isoDateOf(input.nowMs, 0)}(相对日期必须换算为绝对日期)`,
  ].join('\n')
}

/** 对账直调 user 正文(指令文件段 + 记忆清单段)。 */
export function buildDreamConflictUserText(input: {
  readonly materials: readonly DreamConflictMaterial[]
  readonly manifest: string
}): string {
  return [
    '## 指令文件(对账基准)',
    ...input.materials.map(material => `### ${material.file}\n${material.text}`),
    '',
    '## 记忆清单(逐条核对;subject 形态=user 或 domain:<域键>)',
    input.manifest,
  ].join('\n')
}

// ---------- Dream 任务组装(ConsolidationTask seam 实现) ----------

/** createDreamTask 构造选项(coeffect 注入;缺省值=19 §6/Q3/Q5 决议)。 */
export interface DreamTaskOptions {
  readonly ctx: Context
  readonly memory: Memory
  /** consolidation 元数据存储(画像再生成条件的持久锚点)。 */
  readonly meta: ConsolidationMetaStore
  /** 域注册表(Orient 投影与画像工作区索引节;域接线关闭时缺席)。 */
  readonly registry?: DomainRegistryStore
  /** 记忆审计账本(周报 dream 行;缺席不落账)。 */
  readonly audit?: MemoryAuditLedger
  /** curator 模型名(19 §6 consolidation.model 同面;缺省 Flash)。 */
  readonly model?: string
  /** 显式整路由覆写(优先于 model)。 */
  readonly route?: ExtractionRoute
  readonly maxTokens?: number
  readonly maxTurns?: number
  /** Dream 间隔毫秒数(快照 windowStart 缺席时 Gather 窗口回落的兜底;真值由快照携带)。 */
  readonly intervalMs?: number
  readonly ttlDays?: number
  readonly perDomainLimit?: number
  readonly halfLifeDays?: number
  readonly userPromotionSampleRate?: number
  readonly portraitEnabled?: boolean
  /** portrait.md 写入路径(缺席=画像再生成不落盘)。 */
  readonly portraitPath?: string
  /** AGENTS.md 路径(对账材料;缺席跳过该文件)。 */
  readonly agentsPath?: string
  /** NOTES 根目录(对账材料;缺席跳过)。 */
  readonly notesDir?: string
  /** 时钟注入(缺省=快照触发时刻 endedAt,保证一次运行内口径一致)。 */
  readonly now?: () => number
  readonly logger?: ConsolidationLogger
}

/**
 * Dream 任务(ConsolidationTask seam 实现,dream 快照路由消费):四阶段顺序
 * 执行,任一 LLM 阶段失败/中止即抛错(调度器语义:lastDreamAt 不推进,下次
 * 会话尾补跑;重跑幂等——写入口 noop 去重、supersede 非 live 行无操作、画像
 * version 单调)。对账材料缺席时跳过对账直调(无基准不成对账)。
 */
export function createDreamTask(options: DreamTaskOptions): ConsolidationTask {
  return async (snapshot: ConsolidationSnapshot, signal: AbortSignal) => {
    const nowMs = options.now?.() ?? snapshot.endedAt
    // ① Orient:盘点(纯读)
    const orient = orientMemory(options.memory, {
      now: (): number => nowMs,
      ...(options.halfLifeDays !== undefined && { halfLifeDays: options.halfLifeDays }),
    })
    // ② Gather:窗口期 episodic 窄读(不全量)
    const gathered = gatherEpisodicWindow(options.memory, {
      windowStart: snapshot.windowStart ?? nowMs - (options.intervalMs ?? DEFAULT_DREAM_INTERVAL_HOURS * MS_PER_HOUR),
      ...(options.maxTurns !== undefined && { maxRows: options.maxTurns }),
    })
    // ③ Consolidate:聚类 → curator 直调(晋升/偏好/回收)→ 落库 → 对账
    const route = options.route ?? await resolveCuratorRoute(options.ctx, options.model)
    let llmCalls = 0
    const clusters = clusterEpisodicRows(gathered.rows)
    const manifest = buildMemoryManifest(options.memory.entities.listLive())
    const { text: consolidationText } = await runCuratorOneShot(
      options.ctx,
      route,
      DREAM_CONSOLIDATION_PROMPT,
      buildDreamConsolidationUserText({ orient, gathered, clusters, manifest, nowMs }),
      options.maxTokens ?? DEFAULT_DREAM_CONSOLIDATION_MAX_TOKENS,
      '整固',
      { signal },
    )
    llmCalls += 1
    const consolidation = parseDreamConsolidationOutput(consolidationText)
    const applied = applyDreamConsolidation(options.memory, consolidation, {
      runAt: nowMs,
      ...(options.userPromotionSampleRate !== undefined && { userPromotionSampleRate: options.userPromotionSampleRate }),
      ...(options.logger !== undefined && { logger: options.logger }),
    })
    let conflictFlags = 0
    let conflictSkipped = 0
    const skipReasons = [...applied.skipReasons]
    const materials = collectConflictMaterials(options)
    if (materials !== null) {
      const { text: conflictText } = await runCuratorOneShot(
        options.ctx,
        route,
        DREAM_CONFLICT_PROMPT,
        buildDreamConflictUserText({ materials, manifest }),
        DEFAULT_DREAM_CONFLICT_MAX_TOKENS,
        '对账',
        { signal },
      )
      llmCalls += 1
      const conflicts = parseDreamConflictOutput(conflictText)
      const flags = applyConflictFlags(options.memory, conflicts.conflicts, {
        runAt: nowMs,
        ...(options.logger !== undefined && { logger: options.logger }),
      })
      conflictFlags = flags.conflictFlags
      conflictSkipped = flags.skipped
      skipReasons.push(...flags.skipReasons)
    }
    signal.throwIfAborted()
    // ④ Prune:TTL 淘汰 / 超限挤出(半衰期降权排序)/ 画像再生成
    const prune = pruneMemory(options.memory, {
      nowMs,
      ...(options.ttlDays !== undefined && { ttlDays: options.ttlDays }),
      ...(options.perDomainLimit !== undefined && { perDomainLimit: options.perDomainLimit }),
      ...(options.halfLifeDays !== undefined && { halfLifeDays: options.halfLifeDays }),
    })
    const portrait = maybeRegeneratePortrait(options.memory, {
      meta: options.meta,
      ...(options.portraitPath !== undefined && { portraitPath: options.portraitPath }),
      ...(options.registry !== undefined && { registry: options.registry }),
      ...(options.portraitEnabled !== undefined && { enabled: options.portraitEnabled }),
      ...(options.halfLifeDays !== undefined && { halfLifeDays: options.halfLifeDays }),
      nowMs,
      ...(options.logger !== undefined && { logger: options.logger }),
    })
    // 周报行(审计账本;fail-open 在账本内部)
    const pendingItems: MemoryAuditPendingItem[] = applied.pending.map(record => ({
      id: record.id,
      subject: record.subject,
      key: record.key,
      summary: record.summary ?? '',
    }))
    const dreamEntry: DreamAuditEntry = {
      runAt: nowMs,
      promotions: applied.promotions,
      preferences: applied.preferences,
      retractions: applied.retractions,
      conflictFlags,
      expired: prune.expired,
      evicted: prune.evicted,
      portraitRegenerated: portrait.regenerated,
      llmCalls,
      skipped: applied.skipped + conflictSkipped,
      skipReasons,
      pending: pendingItems,
      pruned: [...applied.prunedEntries, ...prune.pruned],
    }
    options.audit?.recordDream(dreamEntry)
    return {
      kind: 'ran' as const,
      detail: `Dream 四阶段完成:Orient(user ${orient.userLiveCount},索引 ${orient.indexTokens}t)`
        + ` Gather(${gathered.rows.length} 条${gathered.truncated ? ',已截断' : ''})`
        + ` Consolidate(晋升 ${applied.promotions}/偏好 ${applied.preferences}/回收 ${applied.retractions}`
        + `/FLAG ${conflictFlags}/跳 ${applied.skipped + conflictSkipped})`
        + ` Prune(TTL ${prune.expired}/挤出 ${prune.evicted})`
        + ` 画像${portrait.regenerated ? ` v${portrait.version}` : ' 未变'}`
        + `(${route.provider}/${route.model})`,
    }
  }
}

/** 跳过记录(原因入报告 + warn 日志)。 */
function recordSkip(
  skipped: string[],
  key: string,
  error: unknown,
  logger: ConsolidationLogger | undefined,
  label: string,
): void {
  const message = error instanceof Error ? error.message : String(error)
  skipped.push(`${key}:${message}`)
  logger?.warn?.(`[memory] ${label}(${key}):${message}`)
}

/** 弱类型收窄(governance/audit.ts isRecord 同款)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
