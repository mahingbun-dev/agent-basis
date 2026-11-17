/**
 * 快照组装:从宿主侧活状态读只读投影。
 * - governance:优先 ctx.governance 服务(glue governance-plugin),缺席时解析同一规则文件;
 *   审计读 .eterna/audit-YYYYMMDD.jsonl 按日轮转文件 + 旧版单文件 .eterna/audit.jsonl
 *   (@eterna/audit 未装载且 glue 未接审计投影时文件不存在 = 0 条)。
 * - memory:@eterna/memory buildMemoryAccountView(T-D 合一后的唯一真相源,只读);
 *   knowledge:node:sqlite 只读打开 glue 约定库路径(@eterna/knowledge wiki 存储契约)。
 * - @event 工具:CTX tools 注册表活过滤 + hitl.yaml 风险档(packs/event-planning/hitl.yaml)。
 * - 可观测:~/.dsh/sessions 的 session.v4.jsonl.zstd usage 折叠(session-logs.ts)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RuleEngine } from '@eterna/governance'
import { buildMemoryAccountView } from '@eterna/memory'
import type { Context } from '@deepseek-ai/cordis'
import type {
  EternaPanelSnapshot, GovernanceSnapshot, KnowledgeSnapshot,
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

/**
 * 记忆区快照(T-D 合一,2026-11-16):唯一真相源在 @eterna/memory 的
 * buildMemoryAccountView(账号路由 viewForAccount 消费同一函数)——panel
 * 原自带一份同构实现,两者曾漂移(旧库 review_state 缺列回落 panel 有/
 * account-view 无),此为合并根因。本函数仅保留「缺省路径解析」语义。
 */
function readMemory(dbPath: string): MemorySnapshot {
  return buildMemoryAccountView(dbPath)
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

function readObservability(sessionsRoot?: string, scope: BuildSnapshotScope = {}): ObservabilitySnapshot {
  const home = process.env.DSH_HOME
  const root = sessionsRoot ?? join(home ?? join(homedir(), '.dsh'), 'sessions')
  // 归属过滤(多租户):先按扩大读窗取最近日志再过滤再截断——保证「本人最近 5 条」
  // 语义,而不是「全局最近 5 条 ∩ 本人」(后者在他账号活跃时会显示空)。
  const filter = scope.sessionFilter
  const sessions = filter === undefined
    ? readRecentSessionUsage(root)
    : readRecentSessionUsage(root, OWN_SESSION_SCAN_LIMIT)
      .filter(card => filter(card.id))
      .slice(0, RECENT_SESSION_LIMIT)
  if (sessions.length === 0) {
    return { sessions: [], note: `未读到可用会话用量(${root} 无 session.v4.jsonl.zstd 或均无 usage 事件)` }
  }
  return { sessions }
}

/** 本人会话展示条数(与 session-logs.ts RECENT_SESSION_LIMIT 同口径)。 */
const RECENT_SESSION_LIMIT = 5

/** 归属过滤时的扫描窗(过滤后取前 5,20+ 窗口避免多账号环境下自见为空)。 */
const OWN_SESSION_SCAN_LIMIT = 24

/** 多租户调用者作用域(由 host 网关按 principal 组装;缺省=全局视角,零行为变化)。 */
export interface BuildSnapshotScope {
  /** 记忆区覆盖:非 admin 调用者=本人账号库视图(缺省读全局库;账号不可解析时传空态)。 */
  readonly memory?: MemorySnapshot
  /** 知识库快照覆盖:非 admin 调用者传本人账号分库状态(缺省读全局库)。 */
  readonly knowledge?: KnowledgeSnapshot
  /** 会话用量归属过滤:非 admin 调用者传本人会话判定(缺省=全局)。 */
  readonly sessionFilter?: (sessionDirName: string) => boolean
}

/**
 * 账号记忆库不可解析时的 fail-closed 空态(多租户):available=false 的空视图,
 * 明示不可用——**绝不回落全局库**(全局库=跨账号泄露面)。
 */
export function unavailableMemorySnapshot(): MemorySnapshot {
  return buildMemoryAccountView(join('(账号记忆库不可用)', 'memory.sqlite3'))
}

/** 组装完整快照(Host 侧 eternaPanel/snapshot 的方法体)。 */
export function buildSnapshot(
  ctx: Context,
  cwd = process.cwd(),
  sessionsRoot?: string,
  memoryDbPath?: string,
  scope: BuildSnapshotScope = {},
): EternaPanelSnapshot {
  const rulesPath = join(cwd, '.eterna', 'governance.rules.yml')
  return {
    generatedAt: new Date().toISOString(),
    workspace: cwd,
    governance: readGovernance(ctx, cwd, rulesPath),
    memory: scope.memory ?? readMemory(memoryDbPath ?? join(cwd, '.eterna', 'memory.sqlite3')),
    knowledge: scope.knowledge ?? readKnowledge(join(cwd, '.eterna', 'knowledge.sqlite3')),
    tools: readEventTools(ctx),
    observability: readObservability(sessionsRoot, scope),
  }
}
