/**
 * T13 验收指标聚合(19 号 §5-T13/§9-6,18 §4.3):五项指标中的四项为在线指标,
 * 从审计账本事件流纯函数计算——
 * 1. 晋升/审批采纳率:review 行 approved/(approved+rejected);
 * 2. 审批响应时长:review 行与其待审行引入行(proposal/dream 的 pending 首见)
 *    的配对时间差分布(中位/最大);
 * 3. 画像纠正率:correction 行数 / 画像当前来源记忆条数(分母由调用方现算注入);
 * 4. 域解析分布:domain-resolve 行按 source/bound 计数(打标准确率需人工标注
 *    样本,由 scripts/memory-domain-accuracy.mjs 离线比对,不进本模块);
 * 5. 索引预算占用分布:不入事件流(每轮装配都发生,落账会刷屏),由
 *    computeIndexZoneTokens 按当前库现算(画像区/域区/兜底区 token 数)。
 *
 * 指标口径对齐 18 §13 的决策前置:Q3 抽样降档看采纳率与纠正率,Q2 归并质量看
 * 域解析分布与(离线的)打标准确率。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryAuditEvent } from './audit.ts'
import { MemoryAuditLedger } from './audit.ts'
import { buildEntityIndex } from './index-builder.ts'
import type { MemoryIndexOptions, MemoryIndexRecord } from './index-builder.ts'

/** 审批采纳率(19 号 §5-T13「晋升提案采纳率」;无裁决时 rate=null 未定义)。 */
export interface MemoryReviewMetrics {
  readonly approved: number
  readonly rejected: number
  /** approved/(approved+rejected);零裁决 = null(不是 0——没有分母)。 */
  readonly acceptanceRate: number | null
}

/** 审批响应时长分布(ms;count=可配对的裁决数,median/max 在 count=0 时为 null)。 */
export interface MemoryReviewLatencyMetrics {
  readonly count: number
  readonly medianMs: number | null
  readonly maxMs: number | null
}

/** 画像纠正率(分子=correction 行数;分母=画像当前来源记忆条数,调用方注入)。 */
export interface MemoryCorrectionMetrics {
  readonly count: number
  readonly portraitEntries: number
  /** count/portraitEntries;分母 0 时 null(纠错发生在画像为空的场景无意义)。 */
  readonly correctionRate: number | null
}

/** 域解析分布(domain-resolve 行计数;total 含 none/candidate)。 */
export interface MemoryDomainResolveMetrics {
  readonly total: number
  readonly bound: number
  readonly workspace: number
  readonly merged: number
  readonly promoted: number
  readonly candidate: number
  readonly none: number
}

/** 索引预算占用分布(三区 token 合计;不含行为头与 footer——那是固定开销)。 */
export interface MemoryIndexZoneTokens {
  readonly portrait: number
  readonly domain: number
  readonly fallback: number
  /** 三区合计(≤ 预算的行为头/ footer 之外的净占用)。 */
  readonly total: number
}

/** T13 在线指标报告(panel 指标区 / 面板快照消费;纯 JSON)。 */
export interface MemoryMetricsReport {
  readonly reviews: MemoryReviewMetrics
  readonly reviewLatencyMs: MemoryReviewLatencyMetrics
  readonly corrections: MemoryCorrectionMetrics
  readonly domainResolves: MemoryDomainResolveMetrics
  /** 索引预算占用分布(单区锚点形态/库缺席时缺席)。 */
  readonly indexZones?: MemoryIndexZoneTokens
}

/** buildMemoryMetrics 的现算注入面(账本之外的两项分母/分布)。 */
export interface MemoryMetricsExtras {
  /** 画像当前来源记忆条数(scope=user 且 approved 且 semantic 的 live 行数)。 */
  readonly portraitEntries: number
  /** 索引预算占用分布(computeIndexZoneTokens 现算;单区形态可缺席)。 */
  readonly indexZones?: MemoryIndexZoneTokens
}

/**
 * 从审计事件流计算四项在线指标(纯函数,事件按追加序即时间序)。
 * 配对口径:待审行 id 全局唯一(autoincrement),首次出现在 proposal/dream 的
 * pending 列表即「引入时刻」;review 行按 id 回配,时间差 <0(时钟回拨/人工
 * 改账本)丢弃不进分布。坏行由账本 readAll 过滤,此处不再防御。
 */
export function buildMemoryMetrics(events: readonly MemoryAuditEvent[], extras: MemoryMetricsExtras): MemoryMetricsReport {
  // 待审行 id → 引入时刻(首见;同 id 理论上只引入一次——顶替会产生新 id)
  const introducedAt = new Map<number, number>()
  for (const event of events) {
    if (event.kind !== 'proposal' && event.kind !== 'dream') continue
    const at = Date.parse(event.time)
    if (!Number.isFinite(at)) continue
    for (const item of event.pending) {
      if (!introducedAt.has(item.id)) introducedAt.set(item.id, at)
    }
  }

  let approved = 0
  let rejected = 0
  const latencies: number[] = []
  for (const event of events) {
    if (event.kind !== 'review') continue
    if (event.decision === 'approved') approved += 1
    else rejected += 1
    const introduced = introducedAt.get(event.id)
    const reviewedAt = Date.parse(event.time)
    if (introduced !== undefined && Number.isFinite(reviewedAt)) {
      const latency = reviewedAt - introduced
      if (latency >= 0) latencies.push(latency)
    }
  }
  latencies.sort((a, b) => a - b)

  let corrections = 0
  const domainResolves = { total: 0, bound: 0, workspace: 0, merged: 0, promoted: 0, candidate: 0, none: 0 }
  for (const event of events) {
    if (event.kind === 'correction') corrections += 1
    if (event.kind !== 'domain-resolve') continue
    domainResolves.total += 1
    if (event.bound) domainResolves.bound += 1
    if (event.source === 'workspace') domainResolves.workspace += 1
    else if (event.source === 'merged') domainResolves.merged += 1
    else if (event.source === 'promoted') domainResolves.promoted += 1
    else if (event.source === 'candidate') domainResolves.candidate += 1
    else domainResolves.none += 1
  }

  const decided = approved + rejected
  // 标准中位:偶数个取两中位平均(升序已排;latencies 非空时中位必在)
  const mid = Math.floor(latencies.length / 2)
  const medianMs = latencies.length === 0
    ? null
    : latencies.length % 2 === 1
      ? latencies[mid] ?? null
      : ((latencies[mid - 1] ?? 0) + (latencies[mid] ?? 0)) / 2
  const maxMs = latencies.length > 0 ? latencies[latencies.length - 1] ?? null : null
  return {
    reviews: {
      approved,
      rejected,
      acceptanceRate: decided > 0 ? approved / decided : null,
    },
    reviewLatencyMs: { count: latencies.length, medianMs, maxMs },
    corrections: {
      count: corrections,
      portraitEntries: extras.portraitEntries,
      correctionRate: extras.portraitEntries > 0 ? corrections / extras.portraitEntries : null,
    },
    domainResolves,
    ...(extras.indexZones !== undefined ? { indexZones: extras.indexZones } : {}),
  }
}

/**
 * 索引预算占用分布现算(T13 第五项):按当前库构建一次三区索引,取分区 token 数。
 * - 域键缺省取「最近使用的已转正域」(last_used_at 降序,其次 created_at)——
 *   无会话上下文时的代表性口径;显式传入则以传入为准;
 * - 画像缺省读库同目录 portrait.md(剥 frontmatter 取正文,与 glue 装配同源);
 * - 画像与域键皆缺席(单区锚点形态)或库不可读 → null(指标缺席,不是 0)。
 * **只读打开**(DatabaseSync readOnly):指标统计绝不触发开库迁移等任何写——
 * 曾实测经 EntityMemoryStore 打开会把新编码行的 domain_key 迁移改写成 default
 * (classify 防改写修复之外的第二道防线);WAL 下与活跃写并发安全。
 */
export function computeIndexZoneTokens(
  dbPath: string,
  options: { readonly domainKey?: string; readonly portraitPath?: string; readonly now?: () => number } = {},
): MemoryIndexZoneTokens | null {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return null
  }
  try {
    const domainKey = options.domainKey ?? latestRegisteredDomainKey(db)
    const portrait = readPortraitBody(options.portraitPath ?? join(dirname(dbPath), 'portrait.md'))
    if (portrait.length === 0 && domainKey === undefined) return null
    const indexOptions: MemoryIndexOptions = {
      ...(portrait.length > 0 ? { portrait } : {}),
      ...(domainKey !== undefined ? { domainKey } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    }
    return buildEntityIndex(readIndexRecords(db), indexOptions).zoneTokens ?? null
  } catch {
    // 旧 schema 缺列/注册表读失败:指标缺席(fail-open,面板显示「暂无数据」)
    return null
  } finally {
    db.close()
  }
}

/** 最近使用的已转正域键(只读 SQL;无已转正域/无表 = undefined)。 */
function latestRegisteredDomainKey(db: DatabaseSync): string | undefined {
  try {
    const row = db.prepare(
      'SELECT domain_key FROM domain_registry WHERE registered IS NOT NULL'
        + ' ORDER BY COALESCE(last_used_at, created_at) DESC, domain_key ASC LIMIT 1',
    ).get() as { domain_key?: unknown } | undefined
    return typeof row?.domain_key === 'string' ? row.domain_key : undefined
  } catch {
    return undefined
  }
}

/** 索引输入行(只读 SQL;口径与 listLive 一致:live + approved + 非 legacy-org)。 */
function readIndexRecords(db: DatabaseSync): readonly MemoryIndexRecord[] {
  const rows = db.prepare(
    'SELECT id, subject, key, content, summary, confidence, updated_at, use_count, scope, domain_key'
      + " FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved' AND scope != 'legacy-org'",
  ).all() as unknown[]
  const records: MemoryIndexRecord[] = []
  for (const row of rows) {
    const record = row as {
      id?: unknown
      subject?: unknown
      key?: unknown
      content?: unknown
      summary?: unknown
      confidence?: unknown
      updated_at?: unknown
      use_count?: unknown
      scope?: unknown
      domain_key?: unknown
    }
    if (typeof record.id === 'number' && typeof record.subject === 'string' && typeof record.key === 'string'
      && typeof record.content === 'string' && typeof record.confidence === 'number'
      && typeof record.updated_at === 'number' && typeof record.use_count === 'number'
      && typeof record.scope === 'string') {
      records.push({
        id: record.id,
        subject: record.subject,
        key: record.key,
        content: record.content,
        summary: typeof record.summary === 'string' ? record.summary : null,
        confidence: record.confidence,
        updatedAt: record.updated_at,
        useCount: record.use_count,
        scope: record.scope,
        domainKey: typeof record.domain_key === 'string' ? record.domain_key : null,
      })
    }
  }
  return records
}

/** 读画像正文(剥 frontmatter;文件缺席/读失败/空正文 = 空串,与 glue 装配口径一致)。 */
function readPortraitBody(path: string): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8').replace(/^---\n[\s\S]*?\n---\n?/u, '').trim()
  } catch {
    return ''
  }
}

/**
 * 便捷面:从账本文件路径直接读事件流(面板快照用;坏行忽略,文件缺席 = 空流)。
 * 与 MemoryAuditLedger.readAll 同口径,免于为只读用途起实例——面板已有 dbPath
 * 派生的账本路径,不需要构造 options。
 */
export function readMemoryAuditEvents(auditPath: string): readonly MemoryAuditEvent[] {
  return new MemoryAuditLedger({ path: auditPath }).readAll()
}
