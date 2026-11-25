/**
 * 裁判配置读写(56 号 §5.5-C 设置分区的数据面)。
 *
 * 位置:`$DSH_HOME/.eterna/session-eval/config.json`(DSH_HOME 语义下的部署级
 * 隔离目录;评分库同目录)。**按需现读**——设置保存后下一次快照/评测立即生效,
 * 不做进程内缓存(避免多实例/多会话看到旧配置)。
 *
 * 保存纪律(fail-closed):
 * - 严格字段校验(未知字段拒绝,避免把用户手改的错键吞进配置);
 * - 原子写(临时文件 + rename),半截写入不会留下坏配置;
 * - 文件损坏 = 回默认值 + `note`(不炸面板;下一次保存自然修复)。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_JUDGE_METRICS } from './judge-metrics.ts'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig, type JudgeRoute } from './judge-types.ts'

/** 评测数据根(DSH_HOME 语义;与 access/、sessions/ 同级). */
export const JUDGE_STATE_DIRNAME = '.eterna/session-eval'

/** 配置文件名. */
export const JUDGE_CONFIG_FILENAME = 'config.json'

/** 评分库文件名. */
export const JUDGE_STORE_FILENAME = 'scores.db'

/** 评测数据根绝对路径. */
export function judgeStateRoot(dshHome?: string): string {
  return join(dshHome ?? process.env.DSH_HOME ?? process.cwd(), JUDGE_STATE_DIRNAME)
}

/** 配置路径. */
export function judgeConfigPath(dshHome?: string): string {
  return join(judgeStateRoot(dshHome), JUDGE_CONFIG_FILENAME)
}

/** 评分库路径. */
export function judgeStorePath(dshHome?: string): string {
  return join(judgeStateRoot(dshHome), JUDGE_STORE_FILENAME)
}

/** 配置校验结果. */
export type JudgeConfigParse =
  | { readonly ok: true; readonly config: JudgeConfig }
  | { readonly ok: false; readonly error: string }

/** 采样率上限/日预算区间/空闲延迟区间(设置分区的输入约束). */
const SAMPLING_MAX = 1
const BUDGET_MIN = 1_000
const BUDGET_MAX = 10_000_000
const IDLE_MIN = 30_000
const IDLE_MAX = 1_800_000

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseRoute(value: unknown): JudgeRoute | null | undefined {
  if (value === null) return null
  const record = asRecord(value)
  if (record === undefined) return undefined
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * 严格解析配置对象(未知字段/越界值一律拒绝)。
 * @param input - 待解析的 JSON 值(来自文件或设置分区保存).
 * @returns 合法配置或带中文原因的失败。
 */
export function parseJudgeConfig(input: unknown): JudgeConfigParse {
  const record = asRecord(input)
  if (record === undefined) return { ok: false, error: '配置必须是 JSON 对象' }
  const allowed = new Set(['enabled', 'route', 'sampling', 'budgetTokensPerDay', 'idleTimeoutMs', 'metrics'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return { ok: false, error: `未知字段：${key}` }
  }
  if (typeof record.enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔值' }
  const route = parseRoute(record.route === undefined ? null : record.route)
  if (route === undefined) return { ok: false, error: 'route 必须是 {provider, model} 或 null' }
  const sampling = record.sampling
  if (typeof sampling !== 'number' || !Number.isFinite(sampling) || sampling < 0 || sampling > SAMPLING_MAX) {
    return { ok: false, error: `sampling 必须在 0..${SAMPLING_MAX} 之间` }
  }
  const budget = record.budgetTokensPerDay
  if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX) {
    return { ok: false, error: `budgetTokensPerDay 必须是 ${BUDGET_MIN}..${BUDGET_MAX} 的整数` }
  }
  const idle = record.idleTimeoutMs === undefined ? DEFAULT_JUDGE_CONFIG.idleTimeoutMs : record.idleTimeoutMs
  if (typeof idle !== 'number' || !Number.isInteger(idle) || idle < IDLE_MIN || idle > IDLE_MAX) {
    return { ok: false, error: `idleTimeoutMs 必须是 ${IDLE_MIN}..${IDLE_MAX} 的整数` }
  }
  const metricsInput = record.metrics === undefined ? {} : record.metrics
  const metricRecord = asRecord(metricsInput)
  if (metricRecord === undefined) return { ok: false, error: 'metrics 必须是 {指标键: 布尔值}' }
  const known = new Set(BUILTIN_JUDGE_METRICS.map(metric => metric.key))
  const metrics: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(metricRecord)) {
    if (!known.has(key)) return { ok: false, error: `未知裁判指标：${key}` }
    if (typeof value !== 'boolean') return { ok: false, error: `metrics.${key} 必须是布尔值` }
    metrics[key] = value
  }
  return {
    ok: true,
    config: { enabled: record.enabled, route, sampling, budgetTokensPerDay: budget, idleTimeoutMs: idle, metrics },
  }
}

/** 文件读取结果:配置 + 是否来自坏文件(坏文件回默认值并说明). */
export interface JudgeConfigRead {
  readonly config: JudgeConfig
  /** 文件损坏时的说明(写进面板 note);文件缺席不算错误. */
  readonly warning?: string
}

/**
 * 现读配置(缺席/损坏都回默认值,不抛).
 * @param path - config.json 绝对路径.
 * @returns 配置与可选的损坏说明。
 */
export function readJudgeConfig(path: string): JudgeConfigRead {
  if (!existsSync(path)) return { config: DEFAULT_JUDGE_CONFIG }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { config: DEFAULT_JUDGE_CONFIG, warning: '裁判配置无法解析，已回默认值（保存一次即可修复）。' }
  }
  const result = parseJudgeConfig(parsed)
  return result.ok
    ? { config: result.config }
    : { config: DEFAULT_JUDGE_CONFIG, warning: `裁判配置不合法（${result.error}），已回默认值。` }
}

/**
 * 原子写配置(临时文件 + rename);父目录懒建。
 * @param path - config.json 绝对路径.
 * @param config - 已校验的配置.
 */
export function writeJudgeConfig(path: string, config: JudgeConfig): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}
