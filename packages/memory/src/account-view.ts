/**
 * 账号记忆视图组装(23 号 M-T2,S-6 修复):给定账号库路径,只读组装面板
 * memory 区全量视图(实体/待审/画像/域浏览/指标)——access 守卫路由消费
 * (unary 通道 principal 不带 userId,身份面在守卫;glue 的 accounts face
 * viewForAccount 调本函数)。T-D 合一(2026-11-16):本函数是记忆视图唯一
 * 真相源,panel 包 readMemory 已改为本函数的薄适配(双实现曾经漂移:
 * 旧库 review_state 缺列回落 panel 有/本函数无)——结构由
 * glue tests/memory-routing.spec 与 panel snapshot 测试双侧钉住。
 *
 * 只读纪律:DatabaseSync readOnly 打开(绝不触发迁移写);库缺席/旧 schema
 * 逐级回落(available:false / 计数 0 / 率 null),不炸面板。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parsePortraitDocument } from './portrait.ts'
import { buildMemoryMetrics, computeIndexZoneTokens, readMemoryAuditEvents } from './metrics.ts'
import type { MemoryIndexZoneTokens, MemoryMetricsReport } from './metrics.ts'

/** 组装结果(panel EternaPanelSnapshot.memory 区的同构视图;纯 JSON)。 */
export interface MemoryAccountView {
  readonly available: boolean
  readonly dbPath: string
  readonly entityCount: number
  readonly totalRows: number
  readonly recentKeys: { readonly subject: string; readonly key: string; readonly updatedAt: number }[]
  readonly entities: {
    readonly subject: string
    readonly key: string
    readonly content: string
    readonly summary: string
    readonly updatedAt: number
  }[]
  readonly pendingCount: number
  readonly pending: {
    readonly id: number
    readonly subject: string
    readonly key: string
    readonly content: string
    readonly summary: string
    readonly source: string
    readonly originSessionId: string | null
    readonly updatedAt: number
  }[]
  readonly portrait: {
    readonly available: boolean
    readonly version: number | null
    readonly generatedAt: string | null
    readonly sections: { readonly title: string; readonly lines: readonly string[] }[]
  }
  readonly domains: {
    readonly domainKey: string
    readonly label: string
    readonly source: string
    readonly registered: number | null
    readonly sessionCount: number
    readonly memoryCount: number
    readonly lastUsedAt: number | null
    readonly pendingCount: number
  }[]
  /** T13 指标(indexZones 收敛为恒在场 `| null`,与 panel MemoryMetricsView 同构)。 */
  readonly metrics: MemoryAccountMetrics
}

/**
 * 账号视图指标(Omit 而非交叉:MemoryMetricsReport.indexZones 可选不可空,
 * 与「恒在场 | null」直接交叉会得到不可空交集,赋 null 不合法)。
 */
export type MemoryAccountMetrics = Omit<MemoryMetricsReport, 'indexZones'> & {
  readonly indexZones: MemoryIndexZoneTokens | null
}

function emptyMetrics(): MemoryAccountMetrics {
  return {
    reviews: { approved: 0, rejected: 0, acceptanceRate: null },
    reviewLatencyMs: { count: 0, medianMs: null, maxMs: null },
    corrections: { count: 0, portraitEntries: 0, correctionRate: null },
    domainResolves: { total: 0, bound: 0, workspace: 0, merged: 0, promoted: 0, candidate: 0, none: 0 },
    indexZones: null,
  }
}

/**
 * 组装账号记忆视图(只读):库缺席/打不开 → available:false 空视图(面板显示
 * 「尚未生成」),指标区空语义(率 null ≠ 0)。
 */
export function buildMemoryAccountView(dbPath: string): MemoryAccountView {
  const available = existsSync(dbPath)
  if (!available) {
    return {
      available, dbPath, entityCount: 0, totalRows: 0, recentKeys: [], entities: [],
      pendingCount: 0, pending: [],
      portrait: { available: false, version: null, generatedAt: null, sections: [] },
      domains: [],
      metrics: emptyMetrics(),
    }
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return {
      available, dbPath, entityCount: 0, totalRows: 0, recentKeys: [], entities: [],
      pendingCount: 0, pending: [],
      portrait: { available: false, version: null, generatedAt: null, sections: [] },
      domains: [],
      metrics: emptyMetrics(),
    }
  }
  try {
    const totalRows = countOr(db, 'SELECT COUNT(*) AS c FROM memory_entity') ?? 0
    const entityCount = countOr(db, "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'")
      ?? countOr(db, 'SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL') ?? 0
    const recentKeys: { subject: string; key: string; updatedAt: number }[] = []
    const entities: MemoryAccountView['entities'] = []
    const pending: MemoryAccountView['pending'] = []
    let pendingCount = 0
    try {
      for (const row of db.prepare(
        'SELECT subject, key, updated_at FROM memory_entity WHERE invalid_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 5',
      ).all() as unknown[]) {
        const record = row as { subject?: unknown; key?: unknown; updated_at?: unknown }
        if (typeof record.subject === 'string' && typeof record.key === 'string' && typeof record.updated_at === 'number') {
          recentKeys.push({ subject: record.subject, key: record.key, updatedAt: record.updated_at })
        }
      }
      // 有效实体全量(approved;旧库无 review_state 列回落 invalid_at IS NULL 全量)
      let entityRows: unknown[]
      try {
        entityRows = db.prepare(
          'SELECT subject, key, content, summary, updated_at FROM memory_entity'
          + " WHERE invalid_at IS NULL AND review_state = 'approved'"
          + ' ORDER BY updated_at DESC, id DESC',
        ).all()
      } catch {
        // 旧 schema 缺 review_state 列:回落无评审过滤全量
        entityRows = db.prepare(
          'SELECT subject, key, content, summary, updated_at FROM memory_entity'
          + ' WHERE invalid_at IS NULL ORDER BY updated_at DESC, id DESC',
        ).all()
      }
      for (const row of entityRows) {
        const record = row as { subject?: unknown; key?: unknown; content?: unknown; summary?: unknown; updated_at?: unknown }
        if (typeof record.subject === 'string' && typeof record.key === 'string' && typeof record.content === 'string' && typeof record.updated_at === 'number') {
          entities.push({
            subject: record.subject,
            key: record.key,
            content: record.content,
            summary: typeof record.summary === 'string' ? record.summary : '',
            updatedAt: record.updated_at,
          })
        }
      }
      // 待审队列(T9;updated_at 降序 ≤50)
      pendingCount = countOr(db, "SELECT COUNT(*) AS c FROM memory_entity WHERE review_state = 'pending' AND invalid_at IS NULL") ?? 0
      for (const row of db.prepare(
        'SELECT id, subject, key, content, summary, source, origin_session_id, updated_at'
        + " FROM memory_entity WHERE review_state = 'pending' AND invalid_at IS NULL"
        + ' ORDER BY updated_at DESC, id DESC LIMIT 50',
      ).all() as unknown[]) {
        const record = row as {
          id?: unknown
          subject?: unknown
          key?: unknown
          content?: unknown
          summary?: unknown
          source?: unknown
          origin_session_id?: unknown
          updated_at?: unknown
        }
        if (typeof record.id === 'number' && typeof record.subject === 'string' && typeof record.key === 'string'
          && typeof record.content === 'string' && typeof record.updated_at === 'number') {
          pending.push({
            id: record.id,
            subject: record.subject,
            key: record.key,
            content: record.content,
            summary: typeof record.summary === 'string' ? record.summary : '',
            source: typeof record.source === 'string' ? record.source : 'agent',
            originSessionId: typeof record.origin_session_id === 'string' ? record.origin_session_id : null,
            updatedAt: record.updated_at,
          })
        }
      }
    } catch {
      // 旧库缺列:pending/recent 留空
    }
    const portrait = readPortraitView(join(dirname(dbPath), 'portrait.md'))
    const domains = readDomainBrowse(db)
    return {
      available,
      dbPath,
      entityCount,
      totalRows,
      recentKeys,
      entities,
      pendingCount,
      pending,
      portrait,
      domains,
      metrics: readAccountMetrics(dbPath, db),
    }
  } finally {
    db.close()
  }
}

function countOr(db: DatabaseSync, sql: string): number | undefined {
  try {
    const row = db.prepare(sql).get() as { c?: unknown } | undefined
    return typeof row?.c === 'number' ? row.c : undefined
  } catch {
    return undefined
  }
}

/** 画像视图(与生成器 parsePortraitDocument 同真值;文件缺席 = available:false)。 */
function readPortraitView(portraitPath: string): MemoryAccountView['portrait'] {
  if (!existsSync(portraitPath)) return { available: false, version: null, generatedAt: null, sections: [] }
  try {
    const parsed = parsePortraitDocument(readFileSync(portraitPath, 'utf8'))
    return {
      available: parsed.sections.length > 0,
      version: parsed.version,
      generatedAt: parsed.generatedAt,
      sections: [...parsed.sections],
    }
  } catch {
    return { available: false, version: null, generatedAt: null, sections: [] }
  }
}

/** 域浏览投影(registry 全量 + 每域待审数;防御旧库缺表/缺列)。 */
function readDomainBrowse(db: DatabaseSync): MemoryAccountView['domains'] {
  let rows: unknown[] = []
  try {
    rows = db.prepare(
      'SELECT domain_key, label, source, registered, session_count, memory_count, last_used_at'
      + ' FROM domain_registry ORDER BY (registered IS NULL), COALESCE(last_used_at, created_at) DESC, domain_key ASC',
    ).all()
  } catch {
    return []
  }
  const pendingByDomain = new Map<string, number>()
  try {
    for (const row of db.prepare(
      'SELECT domain_key, COUNT(*) AS c FROM memory_entity'
      + " WHERE review_state = 'pending' AND invalid_at IS NULL AND domain_key IS NOT NULL"
      + ' GROUP BY domain_key',
    ).all() as unknown[]) {
      const record = row as { domain_key?: unknown; c?: unknown }
      if (typeof record.domain_key === 'string' && typeof record.c === 'number') {
        pendingByDomain.set(record.domain_key, record.c)
      }
    }
  } catch {
    // 旧库无 review_state 列:待审数留 0
  }
  const views: MemoryAccountView['domains'] = []
  for (const row of rows) {
    const record = row as {
      domain_key?: unknown
      label?: unknown
      source?: unknown
      registered?: unknown
      session_count?: unknown
      memory_count?: unknown
      last_used_at?: unknown
    }
    if (typeof record.domain_key !== 'string' || typeof record.label !== 'string') continue
    views.push({
      domainKey: record.domain_key,
      label: record.label,
      source: typeof record.source === 'string' ? record.source : 'free',
      registered: typeof record.registered === 'number' ? record.registered : null,
      sessionCount: typeof record.session_count === 'number' ? record.session_count : 0,
      memoryCount: typeof record.memory_count === 'number' ? record.memory_count : 0,
      lastUsedAt: typeof record.last_used_at === 'number' ? record.last_used_at : null,
      pendingCount: pendingByDomain.get(record.domain_key) ?? 0,
    })
  }
  return views
}

/**
 * T13 在线指标(审计账本四项 + 现算注入):分母 portraitEntries = user 层
 * approved semantic live 行数(画像事实源口径);indexZones 按当前库只读现算
 * (最近使用域 + 库同目录 portrait.md)。账本路径与库同目录(audit.ts 约定)。
 */
function readAccountMetrics(dbPath: string, db: DatabaseSync): MemoryAccountMetrics {
  const portraitEntries = countOr(
    db,
    "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'"
      + " AND scope = 'user' AND kind = 'semantic'",
  ) ?? countOr(
    db,
    "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'",
  ) ?? 0
  const indexZones = computeIndexZoneTokens(dbPath)
  const report = buildMemoryMetrics(readMemoryAuditEvents(join(dirname(dbPath), 'memory-audit.jsonl')), {
    portraitEntries,
    ...(indexZones !== null ? { indexZones } : {}),
  })
  return {
    reviews: report.reviews,
    reviewLatencyMs: report.reviewLatencyMs,
    corrections: report.corrections,
    domainResolves: report.domainResolves,
    indexZones: report.indexZones ?? null,
  }
}
