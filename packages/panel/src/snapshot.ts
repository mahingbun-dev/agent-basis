/**
 * 快照组装:从宿主侧活状态读只读投影。
 * - governance:优先 ctx.governance 服务(glue governance-plugin),缺席时解析同一规则文件;
 *   审计读 .basis/audit-YYYYMMDD.jsonl 按日轮转文件 + 旧版单文件 .basis/audit.jsonl
 *   (@basis/audit 未装载且 glue 未接审计投影时文件不存在 = 0 条)。
 * - memory / knowledge:node:sqlite 只读打开 glue 约定库路径(表结构是 @basis/memory
 *   entity-store 与 @basis/knowledge wiki 的存储契约)。
 * - @event 工具:CTX tools 注册表活过滤 + hitl.yaml 风险档(packs/event-planning/hitl.yaml)。
 * - 可观测:~/.dsh/sessions 的 session.v4.jsonl.zstd usage 折叠(session-logs.ts)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RuleEngine } from '@basis/governance'
import type { Context } from '@deepseek-ai/cordis'
import type {
  BasisPanelSnapshot, GovernanceSnapshot, KnowledgeSnapshot, MemoryEntityView,
  MemoryRecentKey, MemorySnapshot, ObservabilitySnapshot, ToolCard,
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
  let ruleSource = '未配置(.basis/governance.rules.yml 不存在且 governance 服务未挂载)'
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
  // 审计读数:@basis/audit 按日轮转 .basis/audit-YYYYMMDD.jsonl(DailyFileAuditSink 约定)
  // + 旧版单文件 .basis/audit.jsonl(FileAuditSink/glue 旧约定),全部非空行合计。
  // audit 插件未装载且 glue 未接审计投影时这些文件不存在 = 0 条(panel 既有口径)。
  const auditDir = join(cwd, '.basis')
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

function readMemory(dbPath: string): MemorySnapshot {
  const available = existsSync(dbPath)
  if (!available) return { available, dbPath, entityCount: 0, totalRows: 0, recentKeys: [], entities: [] }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return { available, dbPath, entityCount: 0, totalRows: 0, recentKeys: [], entities: [] }
  }
  try {
    const entityCount = queryCount(db, 'SELECT COUNT(*) AS c FROM memory_entity WHERE invalid_at IS NULL') ?? 0
    const totalRows = queryCount(db, 'SELECT COUNT(*) AS c FROM memory_entity') ?? 0
    const recentKeys: MemoryRecentKey[] = []
    const entities: MemoryEntityView[] = []
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
    // 「记忆」区块全量(有效实体;content 全文渲染用)
    const ENTITY_SQL = 'SELECT subject, key, content, summary, updated_at' +
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
      // 列缺失(旧 schema):entities 留空
    }
    return { available, dbPath, entityCount, totalRows, recentKeys, entities }
  } finally {
    db.close()
  }
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
      weknora: { status: 'not-mounted', detail: 'glue knowledge-plugin 仅装配 wiki-local 后端(WeKnora 需 enabled+baseUrl+token,见 @basis/knowledge weknora.ts)' },
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

/** 组装完整快照(Host 侧 basisPanel/snapshot 的方法体)。 */
export function buildSnapshot(ctx: Context, cwd = process.cwd(), sessionsRoot?: string): BasisPanelSnapshot {
  const rulesPath = join(cwd, '.basis', 'governance.rules.yml')
  return {
    generatedAt: new Date().toISOString(),
    workspace: cwd,
    governance: readGovernance(ctx, cwd, rulesPath),
    memory: readMemory(join(cwd, '.basis', 'memory.sqlite3')),
    knowledge: readKnowledge(join(cwd, '.basis', 'knowledge.sqlite3')),
    tools: readEventTools(ctx),
    observability: readObservability(sessionsRoot),
  }
}
