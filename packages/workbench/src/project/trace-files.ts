/**
 * 落盘数据面读取(38 号 T9/T11 的 M4 实接半边;纯读取,零写入):
 * - audit NDJSON(packages/audit DailyFileAuditSink 形态 `<prefix>YYYYMMDD.jsonl`,
 *   记录字段 = governance sink.ts AuditRecord——O-4「以 packages/audit 实现为准」
 *   的 M4 固化):单工单回放的 worker 半边轨迹,按 R4「一工单一目录」归账
 *   (ticketExecution 目录 = `<realm 工作区>/.ticket/<id>/`,tasks/executor/dsh.ts:122;
 *   记录本身无工单字段,argsPreview/detail 中的 `.ticket/<id>/` 路径即归属证据);
 * - dsh-evals 结果目录(`dsh-evals-out/<时间戳>/report.md`,tools/evals 输出惯例,
 *   33 号 G2-A9 同源):金集通过率趋势与规模;
 * - observe 漂移信号(evolve_signal kind='drift',SignalStore 查询产物):漂移检测卡。
 */
import { readdir, readFile } from 'node:fs/promises'
import type { AuditRecord } from '@eterna/governance'
import type { EvalSnapshot } from '../types.ts'
import { beijingParts } from './time.ts'

/** audit NDJSON 的 kind 全集(packages/audit/src/query.ts KINDS 同源;坏行跳过)。 */
const AUDIT_KINDS: readonly AuditRecord['kind'][] = ['turn-end', 'tool-call', 'usage', 'governance']

/** 逐行 → 记录(行级合法性校验,坏行跳过;与 audit query.ts 同纪律)。 */
function asAuditRecord(value: unknown): AuditRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const kind = (value as Record<string, unknown>)['kind']
  if (typeof kind !== 'string' || !AUDIT_KINDS.includes(kind as AuditRecord['kind'])) return undefined
  return value as AuditRecord
}

/** 单条记录的归属证据文本:argsPreview + detail 序列化(归账匹配面)。 */
function evidenceOf(record: AuditRecord): string {
  const detail = record.detail === undefined ? '' : JSON.stringify(record.detail)
  return `${record.argsPreview ?? ''}${detail}`
}

export interface AuditDayFile {
  /** 文件名(`<prefix>YYYYMMDD.jsonl`)。 */
  readonly name: string
  readonly records: readonly AuditRecord[]
}

/**
 * 读审计落盘目录的全部按日文件(文件名日期序;目录缺失 = 无记录,不抛错——
 * 审计面为空是常态而非错误,回放/工具史如实为空)。
 */
export async function readAuditFiles(dir: string, filePrefix = 'audit-'): Promise<readonly AuditDayFile[]> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter(name => name.startsWith(filePrefix) && name.endsWith('.jsonl') && /^\d{8}$/.test(name.slice(filePrefix.length, -'.jsonl'.length)))
    .sort()
  const files: AuditDayFile[] = []
  for (const name of names) {
    const text = await readFile(`${dir}/${name}`, 'utf8').catch(() => '')
    const records = text.split('\n').flatMap((line) => {
      const trimmed = line.trim()
      if (trimmed === '') return []
      try {
        const record = asAuditRecord(JSON.parse(trimmed))
        return record === undefined ? [] : [record]
      } catch {
        return []
      }
    })
    files.push({ name, records })
  }
  return files
}

/** 单工单回放/工具史的轨迹条目(与视图三日志行同词汇;source 按记录 kind 给人读名)。 */
export interface TraceEntry {
  readonly id: string
  readonly time: string
  readonly source: string
  readonly summary: string
  readonly status: '成功' | '失败' | '治理'
  readonly tool?: string
  readonly isError?: boolean
}

const AUDIT_SOURCE_LABEL: Readonly<Record<AuditRecord['kind'], string>> = {
  'turn-end': 'Worker 回合',
  'tool-call': '工具调用',
  usage: '模型用量',
  governance: '治理事件',
}

/** 文件名中的 UTC 日期段(`audit-YYYYMMDD.jsonl` → `YYYYMMDD`;畸形名空串)。 */
function dayOfFileName(name: string): string {
  return /(\d{8})\.jsonl$/.exec(name)?.[1] ?? ''
}

/** ISO 时刻 → 北京时间「MM-DD HH:mm」展示值;兜底 = 文件日 + 无时刻(`--:--`)。 */
function traceTime(at: string | undefined, day: string): { time: string; sortKey: string } {
  const parts = beijingParts(at)
  if (at !== undefined && parts !== undefined) {
    return { time: `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`, sortKey: at }
  }
  const dayIso = day === '' ? '00000000' : day
  const sortKey = `${dayIso.slice(0, 4)}-${dayIso.slice(4, 6)}-${dayIso.slice(6, 8)}T00:00:00.000Z`
  return { time: `${dayIso.slice(4, 6)}-${dayIso.slice(6, 8)} --:--`, sortKey }
}

/**
 * audit 记录 → 单工单轨迹(R4 归账:证据文本含 `.ticket/<id>/` 的记录归属该工单;
 * 排序 = at(缺席按文件日 00:00)后落盘序)。无归属证据的记录不进任何工单轨迹
 * (不猜归属)。
 */
export function traceEntriesForTicket(files: readonly AuditDayFile[], ticketId: string): readonly TraceEntry[] {
  const marker = `.ticket/${ticketId}/`
  const entries: (TraceEntry & { readonly sortKey: string })[] = []
  for (const file of files) {
    const day = dayOfFileName(file.name)
    for (const [index, record] of file.records.entries()) {
      if (!evidenceOf(record).includes(marker)) continue
      const { time, sortKey } = traceTime(record.at, day)
      entries.push({
        id: `${file.name}#${index}`,
        time,
        // tool-call 用 replay.ts sourceToNode 的「工具 」前缀词汇(落 Worker 执行节点)
        source: record.kind === 'tool-call' ? `工具 ${record.tool ?? 'tool'}` : AUDIT_SOURCE_LABEL[record.kind],
        summary: record.kind === 'tool-call'
          ? `${record.tool ?? 'tool'} · ${record.argsPreview ?? ''}`
          : record.kind === 'usage'
            ? `tokens ${record.usage?.totalTokens ?? 0}`
            : record.kind === 'turn-end'
              ? `回合 ${record.turn ?? 0} 结束 · ${record.reason ?? 'completed'}`
              : (record.detail?.['message'] as string | undefined) ?? '治理事件',
        status: record.kind === 'governance' ? '治理' : record.isError === true ? '失败' : '成功',
        ...(record.tool !== undefined ? { tool: record.tool } : {}),
        ...(record.isError !== undefined ? { isError: record.isError } : {}),
        sortKey: `${sortKey}#${String(index).padStart(6, '0')}`,
      })
    }
  }
  return entries.sort((left, right) => left.sortKey.localeCompare(right.sortKey)).map(({ sortKey: _sortKey, ...entry }) => entry)
}

/** worker 工具史行(检查器视图五;R4 归账同 traceEntriesForTicket,取工具调用子集)。 */
export interface WorkerToolHistoryRow {
  readonly id: string
  readonly time: string
  readonly tool: string
  readonly params: string
  readonly status: { readonly label: string; readonly tone: 'success' | 'danger' }
  readonly duration: string
}

export function toolHistoryForTicket(files: readonly AuditDayFile[], ticketId: string): readonly WorkerToolHistoryRow[] {
  return traceEntriesForTicket(files, ticketId)
    .filter(entry => entry.tool !== undefined)
    .map((entry) => {
      const tool = entry.tool ?? ''
      // summary 形态 =「tool · argsPreview」;切片取参数段(前缀 = tool + 「 · 」)
      const params = entry.summary.slice(tool.length + 3)
      return {
        id: entry.id,
        time: entry.time,
        tool,
        params,
        status: { label: entry.status, tone: entry.status === '失败' ? ('danger' as const) : ('success' as const) },
        duration: '—', // AuditRecord 不带耗时字段(O-4 口径如实:不虚构)
      }
    })
}

// ── dsh-evals 结果(38 号 T11/E-1;数据源 = dsh-evals-out/<时间戳>/report.md)────

export interface EvalRunReport {
  /** 结果目录名(时间戳,字典序 = 时间序)。 */
  readonly dir: string
  readonly total: number
  readonly pass: number
  /** 通过率(百分数,1 位小数)。 */
  readonly passRate: number
  readonly startedAt?: string
}

/**
 * 解析一份 dsh-evals report.md 的总览表(tools/evals 渲染形态:
 * `| total | pass | fail | pass_rate |` 表头 + 一行数据)。无文件/无表格 = 该次
 * run 不进序列(不猜数字)。
 */
export function parseEvalReport(markdown: string): { total: number; pass: number; passRate: number; startedAt?: string } | undefined {
  const totalRow = markdown.match(/\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|/)
  if (totalRow === null) return undefined
  const startedAt = markdown.match(/started_at:\s*(\S+)/)?.[1]
  return {
    total: Number(totalRow[1]),
    pass: Number(totalRow[2]),
    passRate: Math.round(Number(totalRow[4]) * 10) / 10,
    ...(startedAt !== undefined ? { startedAt } : {}),
  }
}

/** 目录扫描 → 按时间序的 run 序列(目录名字典序;dsh-evals-out 输出惯例)。 */
export async function readEvalRuns(outDir: string): Promise<readonly EvalRunReport[]> {
  const names = (await readdir(outDir).catch(() => [] as string[])).sort()
  const runs: EvalRunReport[] = []
  for (const dir of names) {
    const markdown = await readFile(`${outDir}/${dir}/report.md`, 'utf8').catch(() => '')
    const parsed = parseEvalReport(markdown)
    if (parsed !== undefined) runs.push({ dir, ...parsed })
  }
  return runs
}

/**
 * 评测监控快照(38 号 T11;E-1 趋势 = run 序列通过率,E-4 金集即验收——口径对齐
 * dsh-evals 金集,不另建指标;E-2 衰减 = 路由金集两次 run(G2-A9)——数据源未
 * 产出(A26 在建)时如实为空序列 + unavailable 注记,不伪报;E-3 漂移 = observe
 * drift 信号计数。E-5:不按模型分叉,投影只认 run 级通过率)。
 */
export function evalSnapshotFromRuns(inputs: {
  readonly runs: readonly EvalRunReport[]
  /** observe drift 信号数(信号库 kind='drift' 查询产物)。 */
  readonly driftSignalCount: number
  /** 最近一次 drift 信号时刻(Unix ms);无信号 undefined。 */
  readonly latestDriftAt?: number
  readonly nowMs: number
}): EvalSnapshot {
  const trend = inputs.runs.map(run => run.passRate)
  const latest = inputs.runs.at(-1)
  const previous = inputs.runs.at(-2)
  const suiteSize = latest?.total ?? 0
  const weekAgo = inputs.nowMs - 7 * 24 * 60 * 60 * 1000
  const weeklyRuns = inputs.runs.filter((run) => {
    const at = run.startedAt !== undefined ? Date.parse(run.startedAt) : Number.NaN
    return Number.isFinite(at) ? at >= weekAgo : false
  }).length
  const driftLabel = inputs.driftSignalCount > 0 ? `警报 ${inputs.driftSignalCount} 条` : '无警报'
  const driftDays = inputs.latestDriftAt !== undefined ? Math.max(0, Math.floor((inputs.nowMs - inputs.latestDriftAt) / 86_400_000)) : 0
  return {
    trend,
    passDelta: latest === undefined || previous === undefined ? 0 : Math.round((latest.passRate - previous.passRate) * 10) / 10,
    suiteSize,
    // 路由金集衰减:G2-A9 两次 run 的 report 尚未产出(35-A26 在建)——空序列如实呈现。
    decaySeries: [],
    decayLatestPp: 0,
    decayThresholdPp: 2,
    drift: { label: driftLabel, days: driftDays },
    weeklyRuns,
  }
}
