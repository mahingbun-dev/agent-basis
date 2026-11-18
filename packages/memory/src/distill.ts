/**
 * 全局蒸馏 Phase A(18 号 §8「探索 1」三阶段之一;M-M4,Q4 决议授权链):
 * admin 只读的**跨用户计数报告**——不建全局记忆库(18 §8:任何全体可读的运行时
 * 可写存储都是污染放大器),只做「同一模式 ≥K 个独立账号命中」的聚合统计。
 *
 * 数据流(全部只读面):
 * - 逐账号快照:workspaces/<账号>/.eterna/memory.sqlite3 以 readOnly 连接取
 *   approved 且未失效条目(与 state 统计同口径;单账号失败不中断,进 errors);
 * - 参与 opt-out:各账号 overrides(memory.config.json)的 distillParticipate,
 *   缺省 true=默认参与可退出(18 §10 用户级 opt-out,Q4);
 * - 聚类:tokenOverlapRatio 同源分词(CJK 逐字 + ASCII 串)的贪心单遍聚类,
 *   阈值常量 0.6;纯确定性,**Phase A 不调 LLM**(计数报告零幻觉零成本);
 * - PII 掩码:BuiltinPiiGuard.scan 命中区间替换(掩码而非 assertClean 拒绝
 *   ——报告要展示共性样例,不是写库);governance 未挂载也有内置兜底;
 * - 阈值 K:跨用户交叉验证 ≥minUsers(缺省 5,18 §8/Gm2-global;部署可调);
 *   参与账号数 < K → sampleSufficient=false 如实标注(冷启动行为);
 * - 产物落点(隔离目录铁律,18 §8:中间产物不经任何 agent 上下文):
 *   $DSH_HOME/memory-distill/(与 access/、sessions/ 同级,不在任何租户根下)——
 *   report-<UTC 日期>.json + latest.json(tmp+rename 原子写)+ runs.jsonl(一行一次运行)。
 *
 * 调度:glue 层经 SessionEndConsolidator 的 'distill' 伪会话游标时间阈值合并
 * (与 Dream 同款退路);本文件不订阅事件。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dedupTokens } from './memory.ts'
import { memoryOverridesPathForDb, readMemoryOverridesFile } from './config-bridge.ts'
import type { MemoryOverrides } from './config-bridge.ts'
import { BuiltinPiiGuard } from './pii.ts'
import type { PiiFinding } from './pii.ts'
import type { ConsolidationLogger, ConsolidationSnapshot, ConsolidationTask, ConsolidationTaskResult } from './consolidation.ts'

/** 蒸馏产物根目录名(DSH_HOME 语义下的隔离目录,与 access/、sessions/ 同级)。 */
export const DISTILL_ROOT_DIRNAME = 'memory-distill'

/** 蒸馏产物根:$DSH_HOME/memory-distill(DSH_HOME 缺省 cwd——本地 TUI 形态)。 */
export function distillRootOf(dshHome?: string): string {
  return join(dshHome ?? process.env.DSH_HOME ?? process.cwd(), DISTILL_ROOT_DIRNAME)
}

/** 跨用户交叉验证阈值 K 缺省(18 §8/Gm2-global 建议:5 个独立用户)。 */
export const DEFAULT_DISTILL_MIN_USERS = 5

/** 聚类判定阈值(Jaccard,tokenOverlapRatio 同口径;0.6=六成词项重合)。 */
export const DISTILL_CLUSTER_OVERLAP = 0.6

/** 单账号单次快照的条目上限(按 last_used_at 降序截断;防御超大库拖垮聚合)。 */
export const DISTILL_MAX_ENTRIES_PER_ACCOUNT = 500

/** 单簇样例上限(每参与账号至多 1 条掩码样例,总数截断——报告不是原文导出)。 */
const MAX_CLUSTER_EXAMPLES = 5

/** 蒸馏报告 schema 版本(Phase B curator 与 admin 报告页的消费契约)。 */
export const DISTILL_REPORT_SCHEMA = 'eterna.memory.distill-report/1'

/** 蒸馏任务遍历的账号引用(目录 = 租户根下的账号 workspace 根)。 */
export interface DistillAccountRef {
  readonly account: string
  readonly dir: string
}

/** 快照取出的单条 approved 记忆(掩码前的原始形态,只在进程内存)。 */
export interface DistillEntry {
  readonly account: string
  readonly content: string
  readonly kind: string | null
  readonly domainKey: string | null
}

/** 一个跨用户共享模式簇(报告展示面;全部文本字段已经过 PII 掩码)。 */
export interface DistillCluster {
  /** 展示标签:锚点样例掩码后截断(admin/SME 的人读入口)。 */
  readonly label: string
  /** 簇内高频共享词(频次 ≥2 降序,上限 8;同掩码口径)。 */
  readonly sharedTokens: readonly string[]
  /** 命中的独立账号数(≥minUsers 才会出现在报告里)。 */
  readonly userCount: number
  /** 参与账号名清单(admin 只读报告可见;原文不可见)。 */
  readonly accounts: readonly string[]
  /** 簇内条目总数。 */
  readonly entriesCount: number
  /** kind 分布(memory_entity.kind 计数)。 */
  readonly kindCounts: Readonly<Record<string, number>>
  /** 域分布(domain_key 计数;null 记 '(未分域)')。 */
  readonly domainCounts: Readonly<Record<string, number>>
  /** 掩码代表样例(每账号至多 1 条;Phase B curator 的消费口)。 */
  readonly examples: readonly string[]
}

/** Phase A 报告(落盘 = latest.json / report-<UTC 日期>.json 的形态)。 */
export interface DistillReport {
  readonly schema: typeof DISTILL_REPORT_SCHEMA
  readonly generatedAt: number
  /** 聚合窗口起点(epoch ms;= 上次运行时刻,首跑回落 now-interval)。 */
  readonly windowStart: number
  readonly totals: {
    /** 发现的账号总数(有记忆库的账号)。 */
    readonly accounts: number
    /** 实际参与聚合的账号数(未 opt-out)。 */
    readonly participating: number
    /** opt-out 跳过的账号数。 */
    readonly optedOut: number
    /** 参与账号纳入聚类的条目总数。 */
    readonly entities: number
  }
  readonly minUsers: number
  /** 参与账号数 ≥K(冷启动不足时 false,报告如实标注——不产候选)。 */
  readonly sampleSufficient: boolean
  readonly clusters: readonly DistillCluster[]
  readonly errors: readonly { readonly account: string; readonly message: string }[]
}

/** PII 掩码扫描面(BuiltinPiiGuard 满足;governance PiiFilter 的 scan 若在场也可注入)。 */
export interface DistillPiiScanner {
  scan(text: string): readonly PiiFinding[]
}

/**
 * 全局蒸馏部署门(18 §13 Q4 授权链):热改键(根 overrides distillEnabled)
 * 覆写 profile patch 基线(config.distill.enabled),双缺省 = false(默认关)。
 */
export function resolveDistillGate(configEnabled: boolean | undefined, overrides: Pick<MemoryOverrides, 'distillEnabled'>): boolean {
  return overrides.distillEnabled ?? configEnabled ?? false
}

/**
 * PII 掩码(掩码而非拒绝):扫描文本,命中区间替换为 `[脱敏:<patternId>]`。
 * 区间取并集(多模式命中同段只掩一次);scanner 缺省内置四类通用模式。
 */
export function distillMaskText(text: string, scanner?: DistillPiiScanner): string {
  const guard = scanner ?? new BuiltinPiiGuard()
  let findings: readonly PiiFinding[]
  try {
    findings = guard.scan(text)
  } catch {
    return text
  }
  if (findings.length === 0) return text
  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: { start: number; end: number; id: string }[] = []
  for (const finding of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && finding.start < last.end) {
      if (finding.end > last.end) last.end = finding.end
      continue
    }
    merged.push({ start: finding.start, end: finding.end, id: finding.patternId })
  }
  let out = ''
  let cursor = 0
  for (const span of merged) {
    out += text.slice(cursor, span.start) + `[脱敏:${span.id}]`
    cursor = span.end
  }
  return out + text.slice(cursor)
}

/**
 * 账号是否参与蒸馏(overrides distillParticipate,缺省 true=默认参与可退出)。
 * overrides 文件缺席/损坏 fail-open 为空表(config-bridge 既有口径)→ 参与。
 */
export function accountParticipatesInDistill(accountDir: string): boolean {
  const dbPath = join(accountDir, '.eterna', 'memory.sqlite3')
  const overrides = readMemoryOverridesFile(memoryOverridesPathForDb(dbPath))
  return overrides.distillParticipate !== false
}

/** 单账号快照的单条 approved 记忆(掩码前原始形态,只在进程内存)。 */
export interface DistillRawEntity {
  readonly content: string
  readonly kind: string | null
  readonly domainKey: string | null
}

/**
 * 单账号只读快照:approved 且未失效条目(与 memoryStatsOf 同口径)。库缺席/
 * 打不开/表缺失一律空表(旧库/未开通账号不炸聚合)。按 last_used_at 降序截断
 * DISTILL_MAX_ENTRIES_PER_ACCOUNT(稳定口径:新近记忆优先进入聚类)。
 */
export function readApprovedEntitiesForDistill(accountDir: string): readonly DistillRawEntity[] {
  const dbPath = join(accountDir, '.eterna', 'memory.sqlite3')
  if (!existsSync(dbPath)) return []
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return []
  }
  try {
    const rows = db.prepare(
      'SELECT content, kind, domain_key FROM memory_entity'
      + " WHERE invalid_at IS NULL AND review_state = 'approved'"
      + ' ORDER BY COALESCE(last_used_at, 0) DESC LIMIT ?',
    ).all(DISTILL_MAX_ENTRIES_PER_ACCOUNT) as unknown[]
    const out: { content: string; kind: string | null; domainKey: string | null }[] = []
    for (const row of rows) {
      const record = row as { content?: unknown; kind?: unknown; domain_key?: unknown }
      if (typeof record.content !== 'string' || record.content.trim().length === 0) continue
      out.push({
        content: record.content,
        kind: typeof record.kind === 'string' ? record.kind : null,
        domainKey: typeof record.domain_key === 'string' ? record.domain_key : null,
      })
    }
    return out
  } catch {
    return [] // memory_entity 表缺失(旧库):该账号按零条目参与
  } finally {
    db.close()
  }
}

// ---------- 聚类(确定性,单遍贪心) ----------

interface DistillClusterAccum {
  readonly anchorTokens: Set<string>
  readonly entries: DistillEntry[]
}

/** 词项集 Jaccard(tokenOverlapRatio 同公式;接收预分词集合避免重复分词)。 */
function tokenSetOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) {
    if (b.has(token)) shared += 1
  }
  return shared / (a.size + b.size - shared)
}

function tallyOf(entries: readonly DistillEntry[], pick: (entry: DistillEntry) => string | null): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    const key = pick(entry) ?? '(未分域)'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/** 簇共享词:频次 ≥2 的词项按频次降序(并列按首现序),上限 8。 */
function sharedTokensOf(entries: readonly DistillEntry[]): string[] {
  const freq = new Map<string, number>()
  for (const entry of entries) {
    for (const token of dedupTokens(entry.content)) {
      freq.set(token, (freq.get(token) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token)
}

/** 聚合核心:遍历账号快照 → 聚类 → ≥K 簇报告(全部展示字段过 PII 掩码)。 */
export function aggregateDistillReport(options: {
  readonly accounts: readonly DistillAccountRef[]
  readonly minUsers?: number
  readonly windowStart: number
  readonly now: number
  readonly pii?: DistillPiiScanner
}): DistillReport {
  const minUsers = options.minUsers ?? DEFAULT_DISTILL_MIN_USERS
  const mask = (text: string): string => distillMaskText(text, options.pii)
  const errors: { account: string; message: string }[] = []
  const entries: DistillEntry[] = []
  let optedOut = 0
  let participating = 0
  for (const ref of options.accounts) {
    let participates: boolean
    try {
      participates = accountParticipatesInDistill(ref.dir)
    } catch (error) {
      errors.push({ account: ref.account, message: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (!participates) {
      optedOut += 1
      continue
    }
    participating += 1
    try {
      for (const row of readApprovedEntitiesForDistill(ref.dir)) {
        entries.push({ account: ref.account, content: row.content, kind: row.kind, domainKey: row.domainKey })
      }
    } catch (error) {
      errors.push({ account: ref.account, message: error instanceof Error ? error.message : String(error) })
    }
  }
  // 贪心单遍聚类:与既有簇锚点词项重合 ≥阈值 即归簇,否则自立新簇。
  const clusters: DistillClusterAccum[] = []
  for (const entry of entries) {
    const tokens = dedupTokens(entry.content)
    if (tokens.size === 0) continue
    let target: DistillClusterAccum | undefined
    for (const cluster of clusters) {
      if (tokenSetOverlap(cluster.anchorTokens, tokens) >= DISTILL_CLUSTER_OVERLAP) {
        target = cluster
        break
      }
    }
    if (target !== undefined) {
      target.entries.push(entry)
    } else {
      clusters.push({ anchorTokens: tokens, entries: [entry] })
    }
  }
  const views: DistillCluster[] = []
  for (const cluster of clusters) {
    const accounts = [...new Set(cluster.entries.map(entry => entry.account))]
    if (accounts.length < minUsers) continue
    const firstEntry = cluster.entries[0]
    if (firstEntry === undefined) continue
    const anchor = mask(firstEntry.content)
    const examplePairs = cluster.entries.map((entry): [string, string] => [entry.account, mask(entry.content)])
    views.push({
      label: anchor.length > 60 ? anchor.slice(0, 60) + '…' : anchor,
      sharedTokens: sharedTokensOf(cluster.entries).map(mask),
      userCount: accounts.length,
      accounts,
      entriesCount: cluster.entries.length,
      kindCounts: tallyOf(cluster.entries, entry => entry.kind),
      domainCounts: tallyOf(cluster.entries, entry => entry.domainKey),
      examples: [...new Map(examplePairs).values()].slice(0, MAX_CLUSTER_EXAMPLES),
    })
  }
  views.sort((a, b) => b.userCount - a.userCount || b.entriesCount - a.entriesCount)
  return {
    schema: DISTILL_REPORT_SCHEMA,
    generatedAt: options.now,
    windowStart: options.windowStart,
    totals: {
      accounts: options.accounts.length,
      participating,
      optedOut,
      entities: entries.length,
    },
    minUsers,
    sampleSufficient: participating >= minUsers,
    clusters: views,
    errors,
  }
}

// ---------- 产物落盘(隔离目录;latest.json 原子写) ----------

/** 原子写 JSON(tmp + rename;同目录保证 rename 原子性)。 */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(value))
  renameSync(tmp, path)
}

/** 报告文件名时间戳(UTC 日期,同日覆盖)。 */
function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 写蒸馏报告三件(report-<UTC 日期>.json / latest.json / runs.jsonl 追加一行)。
 * 目录不存在即建(DSH_HOME 语义下的隔离目录,packctl tenant-scan 随根覆盖)。
 */
export function writeDistillReport(outputDir: string, report: DistillReport): void {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, `report-${utcDateOf(report.generatedAt)}.json`), JSON.stringify(report, null, 2))
  writeJsonAtomic(join(outputDir, 'latest.json'), report)
  const runLine = {
    ts: report.generatedAt,
    kind: 'phase-a' as const,
    totals: report.totals,
    clusters: report.clusters.length,
    sampleSufficient: report.sampleSufficient,
    errors: report.errors.length,
  }
  appendFileSync(join(outputDir, 'runs.jsonl'), JSON.stringify(runLine) + '\n')
}

/** 读最近一次报告(admin 报告页数据面;文件缺席/损坏/_schema 不符一律 null)。 */
export function readLatestDistillReport(outputDir: string): DistillReport | null {
  const path = join(outputDir, 'latest.json')
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { schema?: unknown; generatedAt?: unknown; clusters?: unknown }
    if (record.schema !== DISTILL_REPORT_SCHEMA) return null
    if (typeof record.generatedAt !== 'number' || !Array.isArray(record.clusters)) return null
    return parsed as DistillReport
  } catch {
    return null
  }
}

// ---------- 调度执行体(SessionEndConsolidator 的 distillTask seam) ----------

/** createDistillTask 入参(accounts/glue 注入;测试可注临时目录)。 */
export interface DistillTaskOptions {
  /** 全量账号遍历面(蒸馏轻只读,不走 Dream 的 >20 日分片——分片会造成计数偏差)。 */
  readonly accounts: () => readonly DistillAccountRef[]
  /** 部署门(每次执行现读;关 → nothing-to-save,游标照常推进)。 */
  readonly enabled: () => boolean
  readonly minUsers?: number
  /** 产物目录(缺省 distillRootOf())。 */
  readonly outputDir?: string
  readonly pii?: DistillPiiScanner
  readonly logger?: ConsolidationLogger
  readonly now?: () => number
}

/**
 * Phase A 调度执行体:门开 → 聚合报告 → 落盘三件。有 ≥K 簇 = 'ran'
 * (Phase B 起草由 distill-curate.ts 的组合任务续接);无簇/门关 =
 * 'nothing-to-save'(已处理,游标推进)。abort 中途退出不写产物——调度器
 * 对 aborted 任务本就不推进游标(#execute 既有语义),这里只负责尽快让路。
 */
export function createDistillTask(options: DistillTaskOptions): ConsolidationTask {
  const outputDir = options.outputDir ?? distillRootOf()
  const now = options.now ?? ((): number => Date.now())
  // 全程无 await(聚合是同步只读 IO):Promise 形态仅为对齐 ConsolidationTask
  // seam;同步异常经调度器 #execute 的 try/catch 捕获(游标不推进待重试)。
  return (snapshot: ConsolidationSnapshot, signal: AbortSignal): Promise<ConsolidationTaskResult> => {
    if (!options.enabled()) {
      return Promise.resolve({ kind: 'nothing-to-save', detail: '全局蒸馏部署门未开,跳过聚合(游标照常推进)' })
    }
    const report = aggregateDistillReport({
      accounts: options.accounts(),
      ...(options.minUsers !== undefined && { minUsers: options.minUsers }),
      windowStart: snapshot.windowStart ?? snapshot.endedAt,
      now: now(),
      ...(options.pii !== undefined && { pii: options.pii }),
    })
    if (signal.aborted) {
      return Promise.resolve({ kind: 'nothing-to-save', detail: '蒸馏聚合已中止,不写产物' })
    }
    try {
      writeDistillReport(outputDir, report)
    } catch (error) {
      return Promise.reject(new Error(`蒸馏报告写入失败(${outputDir}):${error instanceof Error ? error.message : String(error)}`))
    }
    const detail = `蒸馏报告:${report.totals.participating} 账号参与(${report.totals.optedOut} 退出)`
      + `,${report.totals.entities} 条,≥${report.minUsers} 簇 ${report.clusters.length} 个`
      + (report.sampleSufficient ? '' : '(样本不足)')
      + (report.errors.length > 0 ? `,errors ${report.errors.length}` : '')
    options.logger?.info?.(`[memory] ${detail}`)
    return Promise.resolve(report.clusters.length > 0
      ? { kind: 'ran', detail }
      : { kind: 'nothing-to-save', detail })
  }
}
