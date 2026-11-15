/**
 * 快照组装:从宿主侧活状态读只读投影。
 * - governance:优先 ctx.governance 服务(glue governance-plugin),缺席时解析同一规则文件;
 *   审计读 .eterna/audit-YYYYMMDD.jsonl 按日轮转文件 + 旧版单文件 .eterna/audit.jsonl
 *   (@eterna/audit 未装载且 glue 未接审计投影时文件不存在 = 0 条)。
 * - memory / knowledge:node:sqlite 只读打开 glue 约定库路径(表结构是 @eterna/memory
 *   entity-store 与 @eterna/knowledge wiki 的存储契约)。
 * - @event 工具:CTX tools 注册表活过滤 + hitl.yaml 风险档(packs/event-planning/hitl.yaml)。
 * - 可观测:~/.dsh/sessions 的 session.v4.jsonl.zstd usage 折叠(session-logs.ts)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RuleEngine } from '@eterna/governance'
import { buildMemoryMetrics, computeIndexZoneTokens, parsePortraitDocument, readMemoryAuditEvents } from '@eterna/memory'
import type { Context } from '@deepseek-ai/cordis'
import type {
  EternaPanelSnapshot, GovernanceSnapshot, KnowledgeSnapshot, MemoryDomainBrowseView,
  MemoryEntityView, MemoryMetricsView, MemoryPendingView, MemoryPortraitSnapshot, MemoryRecentKey,
  MemorySnapshot, ObservabilitySnapshot, ToolCard,
} from './types.ts'
import { readRecentSessionUsage } from './session-logs.ts'

/** @event/pack 模型面工具全集(packs/event-planning/plugin.ts ctx.tools.register 名单)。 */
const EVENT_TOOLS: readonly string[] = [
  'budget_calc',
  'schedule_conflict_check',
  'template_search',
  'venue_search',
  'budget_change',
  'pay_deposit',
  'send_email',
  'transfer_money',
  'sign_contract',
  'vendor_award',
]

/** hitl.yaml 风险档(packs/event-planning/hitl.yaml 的 tools 通配;R3=资金/法务/定标/预算变更)。 */
export function riskOfTool(name: string): 'R0' | 'R1' | 'R2' | 'R3' {
  if (/^(pay_|sign_|transfer_)/.test(name) || name === 'vendor_award' || name === 'budget_change') return 'R3'
  if (/^(send_|submit_|publish_)/.test(name)) return 'R2'
  if (/^(write_|draft_)/.test(name)) return 'R1'
  return 'R0'
}

/** glue governance-plugin 在 ctx 上的服务形状(最小结构子集)。 */
interface GovernanceWorldLike {
  readonly rules?: { readonly policy?: { readonly rules?: readonly unknown[] }; readonly toString?: () => string }
}

function readGovernance(ctx: Context, cwd: string, rulesPath: string): GovernanceSnapshot {
  const world = ctx.get('governance') as GovernanceWorldLike | undefined
  let ruleCount = 0
  let ruleSource = '未配置(.eterna/governance.rules.yml 不存在且 governance 服务未挂载)'
  if (world?.rules?.policy?.rules !== undefined) {
    ruleCount = world.rules.policy.rules.length
    ruleSource = 'ctx.governance 服务(glue governance-plugin 活实例)'
  } else if (existsSync(rulesPath)) {
    try {
      ruleCount = RuleEngine.parse(readFileSync(rulesPath, 'utf8'), rulesPath).policy.rules.length
      ruleSource = rulesPath
    } catch {
      ruleSource = `${rulesPath}(解析失败,按 0 计)`
    }
  }
  // 审计读数:@eterna/audit 按日轮转 .eterna/audit-YYYYMMDD.jsonl(DailyFileAuditSink 约定)
  // + 旧版单文件 .eterna/audit.jsonl(FileAuditSink/glue 旧约定),全部非空行合计。
  // audit 插件未装载且 glue 未接审计投影时这些文件不存在 = 0 条(panel 既有口径)。
  const auditDir = join(cwd, '.eterna')
  let auditEntries = 0
  let auditSource: string | null = null
  const auditFiles = existsSync(auditDir)
    ? readdirSync(auditDir).filter(name => /^audit-\d{8}\.jsonl$/.test(name) || name === 'audit.jsonl').sort()
    : []
  for (const name of auditFiles) {
    try {
      auditEntries += readFileSync(join(auditDir, name), 'utf8').split('\n').filter(line => line.trim().length > 0).length
    } catch {
      // 单文件读不了(权限/并发重写)按 0 计,不影响其余文件
    }
  }
  if (auditFiles.length === 1) {
    auditSource = join(auditDir, auditFiles[0] ?? '')
  } else if (auditFiles.length > 1) {
    auditSource = auditDir
  }
  return { mounted: world?.rules !== undefined, ruleCount, ruleSource, auditEntries, auditSource }
}

function queryCount(db: DatabaseSync, sql: string): number | undefined {
  try {
    const row = db.prepare(sql).get() as { c?: unknown } | undefined
    return typeof row?.c === 'number' ? row.c : undefined
  } catch {
    return undefined
  }
}

/** 空库/打不开时的完整回落视图(字段齐备;portrait/domains 同步缺席)。 */
/** 无数据指标视图(库缺席/旧 schema:各计数 0、率与时长 null、分区缺席)。 */
function emptyMetrics(): MemoryMetricsView {
  return {
    reviews: { approved: 0, rejected: 0, acceptanceRate: null },
    reviewLatencyMs: { count: 0, medianMs: null, maxMs: null },
    corrections: { count: 0, portraitEntries: 0, correctionRate: null },
    domainResolves: { total: 0, bound: 0, workspace: 0, merged: 0, promoted: 0, candidate: 0, none: 0 },
    indexZones: null,
  }
}

function emptyMemory(available: boolean, dbPath: string): MemorySnapshot {
  return {
    available, dbPath, entityCount: 0, totalRows: 0, recentKeys: [], entities: [],
    pendingCount: 0, pending: [],
    portrait: { available: false, version: null, generatedAt: null, sections: [] },
    domains: [],
    metrics: emptyMetrics(),
  }
}

function readMemory(dbPath: string): MemorySnapshot {
  const available = existsSync(dbPath)
  if (!available) return emptyMemory(available, dbPath)
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return emptyMemory(available, dbPath)
  }
  try {
    // 有效实体数:review_state 列在场时只计已批准(与 entities 清单同口径——
    // 待审不算已生效);旧库无列回落 invalid_at IS NULL。
    const entityCount = queryCount(
      db,
      "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'",
    ) ?? queryCount(db, 'SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL') ?? 0
    const totalRows = queryCount(db, 'SELECT COUNT(*) AS c FROM memory_entity') ?? 0
    const recentKeys: MemoryRecentKey[] = []
    const entities: MemoryEntityView[] = []
    const pending: MemoryPendingView[] = []
    try {
      const rows = db.prepare(
        'SELECT subject, key, updated_at FROM memory_entity ORDER BY updated_at DESC LIMIT 5',
      ).all() as unknown[]
      for (const row of rows) {
        const record = row as { subject?: unknown; key?: unknown; updated_at?: unknown }
        if (typeof record.subject === 'string' && typeof record.key === 'string' && typeof record.updated_at === 'number') {
          recentKeys.push({ subject: record.subject, key: record.key, updatedAt: record.updated_at })
        }
      }
    } catch {
      // 表缺失(旧库结构):recentKeys 留空
    }
    // 「记忆」区块全量(有效实体;content 全文渲染用)。review_state 列在场时
    // 只取已批准行——待审(pending)不算已生效记忆,由审批队列单独呈现
    // (19 号 §4-T9;与检索纪律一致:pending 不入索引);旧库无此列回落全量。
    const ENTITY_SQL = 'SELECT subject, key, content, summary, updated_at FROM memory_entity' +
      " WHERE invalid_at IS NULL AND review_state = 'approved' ORDER BY updated_at DESC"
    const ENTITY_SQL_LEGACY = 'SELECT subject, key, content, summary, updated_at' +
      ' FROM memory_entity WHERE invalid_at IS NULL ORDER BY updated_at DESC'
    try {
      const rows = db.prepare(ENTITY_SQL).all() as unknown[]
      for (const row of rows) {
        const record = row as { subject?: unknown; key?: unknown; content?: unknown; summary?: unknown; updated_at?: unknown }
        if (typeof record.subject === 'string' && typeof record.key === 'string' && typeof record.content === 'string' && typeof record.updated_at === 'number') {
          entities.push({
            subject: record.subject, key: record.key, content: record.content,
            summary: typeof record.summary === 'string' ? record.summary : '',
            updatedAt: record.updated_at,
          })
        }
      }
    } catch {
      // review_state 列缺失(旧 schema):回落无评审过滤的全量
      try {
        const rows = db.prepare(ENTITY_SQL_LEGACY).all() as unknown[]
        for (const row of rows) {
          const record = row as { subject?: unknown; key?: unknown; content?: unknown; summary?: unknown; updated_at?: unknown }
          if (typeof record.subject === 'string' && typeof record.key === 'string' && typeof record.content === 'string' && typeof record.updated_at === 'number') {
            entities.push({
              subject: record.subject, key: record.key, content: record.content,
              summary: typeof record.summary === 'string' ? record.summary : '',
              updatedAt: record.updated_at,
            })
          }
        }
      } catch {
        // 列缺失(更旧 schema):entities 留空
      }
    }
    // 审批队列(T9):review_state='pending' 且未失效的行,updated_at 降序,
    // ≤50 条(队列上限面板分页交 M-M3;旧库无列 → 0/[])。裁决走
    // eternaPanel/review(Memory.review 软失效语义,不经本只读连接)。
    let pendingCount = 0
    try {
      pendingCount = queryCount(
        db,
        "SELECT COUNT(*) AS c FROM memory_entity WHERE review_state = 'pending' AND invalid_at IS NULL",
      ) ?? 0
      const rows = db.prepare(
        'SELECT id, subject, key, content, summary, source, origin_session_id, updated_at'
        + " FROM memory_entity WHERE review_state = 'pending' AND invalid_at IS NULL"
        + ' ORDER BY updated_at DESC, id DESC LIMIT 50',
      ).all() as unknown[]
      for (const row of rows) {
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
      // review_state 列缺失(旧 schema):审批队列留空(pendingCount=0)
    }
    // 画像卡数据面(M-M3 T12-②):portrait.md 与 sqlite 同目录(glue 索引注入
    // 同判据——剥离 frontmatter 后正文非空才算可用);解析失败降级为不可用。
    const portrait = readPortraitSnapshot(join(dirname(dbPath), 'portrait.md'))
    // 域浏览(T12-②):domain_registry 全量投影(候选域列出,registered=null)+
    // 每域待审数(memory_entity 按 domain_key 分组)。旧库无表 → 空清单。
    const domains = readDomainBrowse(db)
    const metrics = readMetrics(dbPath, db)
    return { available, dbPath, entityCount, totalRows, recentKeys, entities, pendingCount, pending, portrait, domains, metrics }
  } finally {
    db.close()
  }
}

/**
 * T13 在线指标(19 号 §5-T13/§9-6):审计账本四项 + 现算注入项——
 * - 分母 portraitEntries:user 层 approved semantic live 行数(画像事实源口径,
 *   与 portrait.ts buildPortrait 过滤同源;旧库缺列逐级回落到 0);
 * - indexZones:computeIndexZoneTokens 按当前库现算(最近使用域 + 库同目录画像;
 *   单区锚点形态/库不可读 = null)。独立打开只读连接,与上方只读连接并发安全
 *   (node:sqlite WAL 多读者);账本路径与库同目录(audit.ts 约定)。
 */
function readMetrics(dbPath: string, db: DatabaseSync): MemoryMetricsView {
  const portraitEntries = queryCount(
    db,
    "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'"
      + " AND scope = 'user' AND kind = 'semantic'",
  ) ?? queryCount(
    db,
    "SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL AND review_state = 'approved'",
  ) ?? 0
  const indexZones = computeIndexZoneTokens(dbPath)
  const report = buildMemoryMetrics(readMemoryAuditEvents(join(dirname(dbPath), 'memory-audit.jsonl')), {
    portraitEntries,
    ...(indexZones !== null ? { indexZones } : {}),
  })
  return { ...report, indexZones: report.indexZones ?? null }
}

/**
 * 画像快照(T12-②):读 portrait.md → parsePortraitDocument(@eterna/memory,
 * 与生成器同文件的唯一真值)。文件缺席/解析空节 → available:false(面板显示
 * 「画像尚未生成」);缺库目录时同样缺席。
 */
function readPortraitSnapshot(portraitPath: string): MemoryPortraitSnapshot {
  if (!existsSync(portraitPath)) return { available: false, version: null, generatedAt: null, sections: [] }
  try {
    const parsed = parsePortraitDocument(readFileSync(portraitPath, 'utf8'))
    const available = parsed.sections.length > 0
    return { available, version: parsed.version, generatedAt: parsed.generatedAt, sections: parsed.sections }
  } catch {
    return { available: false, version: null, generatedAt: null, sections: [] }
  }
}

/** 域浏览投影(T12-②):registry 全量 + 每域待审数;防御旧库缺表/缺列。 */
function readDomainBrowse(db: DatabaseSync): readonly MemoryDomainBrowseView[] {
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
    const pendingRows = db.prepare(
      'SELECT domain_key, COUNT(*) AS c FROM memory_entity'
      + " WHERE review_state = 'pending' AND invalid_at IS NULL AND domain_key IS NOT NULL"
      + ' GROUP BY domain_key',
    ).all() as unknown[]
    for (const row of pendingRows) {
      const record = row as { domain_key?: unknown; c?: unknown }
      if (typeof record.domain_key === 'string' && typeof record.c === 'number') {
        pendingByDomain.set(record.domain_key, record.c)
      }
    }
  } catch {
    // 旧库无 review_state 列:待审数留 0
  }
  const views: MemoryDomainBrowseView[] = []
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

function readKnowledge(dbPath: string): KnowledgeSnapshot {
  const available = existsSync(dbPath)
  if (!available) {
    return {
      available, dbPath, wikiDocCount: 0, proposalCount: 0,
      weknora: { status: 'not-mounted', detail: 'glue knowledge-plugin 仅装配 wiki-local 后端' },
    }
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return {
      available, dbPath, wikiDocCount: 0, proposalCount: 0,
      weknora: { status: 'not-mounted', detail: 'glue knowledge-plugin 仅装配 wiki-local 后端' },
    }
  }
  try {
    const wikiDocCount = queryCount(db, 'SELECT COUNT(*) AS c FROM pages') ?? 0
    const proposalCount = queryCount(db, 'SELECT COUNT(*) AS c FROM proposals') ?? 0
    return {
      available, dbPath, wikiDocCount, proposalCount,
      weknora: { status: 'not-mounted', detail: 'glue knowledge-plugin 仅装配 wiki-local 后端(WeKnora 需 enabled+baseUrl+token,见 @eterna/knowledge weknora.ts)' },
    }
  } finally {
    db.close()
  }
}

interface ToolDefinitionLike {
  readonly name?: unknown
  readonly description?: unknown
}

function readEventTools(ctx: Context): readonly ToolCard[] {
  const tools = ctx.get('tools') as { definitions?: () => readonly ToolDefinitionLike[] } | undefined
  if (tools?.definitions === undefined) return []
  let definitions: readonly ToolDefinitionLike[]
  try {
    definitions = tools.definitions()
  } catch {
    return []
  }
  const byName = new Map<string, ToolDefinitionLike>()
  for (const definition of definitions) {
    if (typeof definition.name === 'string') byName.set(definition.name, definition)
  }
  const cards: ToolCard[] = []
  for (const name of EVENT_TOOLS) {
    const definition = byName.get(name)
    if (definition === undefined) continue
    const risk = riskOfTool(name)
    const description = typeof definition.description === 'string' ? definition.description : ''
    cards.push({ name, risk, r3: risk === 'R3', summary: description.split('\n')[0] ?? '' })
  }
  return cards
}

function readObservability(sessionsRoot?: string): ObservabilitySnapshot {
  const home = process.env.DSH_HOME
  const root = sessionsRoot ?? join(home ?? join(homedir(), '.dsh'), 'sessions')
  const sessions = readRecentSessionUsage(root)
  if (sessions.length === 0) {
    return { sessions: [], note: `未读到可用会话用量(${root} 无 session.v4.jsonl.zstd 或均无 usage 事件)` }
  }
  return { sessions }
}

/** 组装完整快照(Host 侧 eternaPanel/snapshot 的方法体)。 */
export function buildSnapshot(ctx: Context, cwd = process.cwd(), sessionsRoot?: string): EternaPanelSnapshot {
  const rulesPath = join(cwd, '.eterna', 'governance.rules.yml')
  return {
    generatedAt: new Date().toISOString(),
    workspace: cwd,
    governance: readGovernance(ctx, cwd, rulesPath),
    memory: readMemory(join(cwd, '.eterna', 'memory.sqlite3')),
    knowledge: readKnowledge(join(cwd, '.eterna', 'knowledge.sqlite3')),
    tools: readEventTools(ctx),
    observability: readObservability(sessionsRoot),
  }
}
