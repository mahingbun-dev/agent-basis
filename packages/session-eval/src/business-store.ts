/**
 * 业务指标覆盖层存取(56 号 §9.2):`$DSH_HOME/workspaces/<账号>/.eterna/eval/metrics.yaml`。
 *
 * 多租户纪律:
 * - 路径只由**已登录账号**派生(access 守卫路由解析身份后传入),账号不合法即拒绝,
 *   不拼进路径(逐段实算前缀校验,防 `..` 穿越);
 * - 每个账号只读写自己的文件;一个账号的指标不影响他人;
 * - 自动抽样在宿主侧无账号上下文(2026-11-25 与用户确认):自动裁判只跑内置六项,
 *   业务指标由「立即评测」按账号覆盖层执行。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { EMPTY_BUSINESS_FILE, serializeBusinessMetrics, validateBusinessMetric, type BusinessMetric, type BusinessMetricsFile } from './business-metrics.ts'
import { parseBusinessMetrics } from './business-yaml.ts'

/** 账号规则(与 access 账号口令规则同源:[A-Za-z0-9_.-]{2,32}). */
const ACCOUNT_PATTERN = /^[A-Za-z0-9_.-]{2,32}$/

/** 保存结果(冲突/校验失败都是业务失败,不抛). */
export type BusinessSaveReply =
  | {
    readonly ok: true
    readonly version: number
    readonly file: BusinessMetricsFile
    readonly metric: BusinessMetric
    readonly yaml: string
  }
  | { readonly ok: false; readonly code: 'conflict' | 'invalid' | 'io'; readonly error: string }

/** 校验并返回安全的账号段(不合法直接抛,调用方应已在入口拒绝). */
function safeAccount(account: string): string {
  if (!ACCOUNT_PATTERN.test(account) || account === '..' || account === '.') {
    throw new Error('账号不合法')
  }
  return account
}

/**
 * 账号覆盖层文件路径。
 * @param dshHome - DSH_HOME(缺省取环境变量/进程目录).
 * @param account - 已登录账号.
 */
export function businessMetricsPath(dshHome: string | undefined, account: string): string {
  const home = dshHome ?? process.env.DSH_HOME ?? process.cwd()
  const root = resolve(home, 'workspaces')
  const path = resolve(root, safeAccount(account), '.eterna', 'eval', 'metrics.yaml')
  if (!path.startsWith(`${root}${sep}`)) throw new Error('账号路径越界')
  return path
}

/** 读文件(缺失/不可读 → 空文件 + 说明). */
export function readBusinessFile(path: string): { readonly file: BusinessMetricsFile; readonly raw?: string; readonly warning?: string } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { file: EMPTY_BUSINESS_FILE }
  }
  const parsed = parseBusinessMetrics(raw)
  if (!parsed.ok) return { file: EMPTY_BUSINESS_FILE, raw, warning: parsed.error }
  return { file: parsed.file, raw }
}

/** 原子写(临时文件 + rename). */
function writeFileAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

/**
 * 保存一条业务指标(upsert;version 冲突拒绝覆盖)。
 * @param path - 账号覆盖层文件.
 * @param input - 前端提交的指标对象.
 * @param options.baseVersion - 前端读到的文件版本(乐观锁).
 * @param options.updatedBy - 账号(写入 updated_by).
 * @param options.now - 时刻(测试注入).
 * @returns 保存后的文件/条目/YAML,或中文原因。
 */
export function saveBusinessMetric(
  path: string,
  input: unknown,
  options: { readonly baseVersion: number; readonly updatedBy: string; readonly now?: number },
): BusinessSaveReply {
  const current = readBusinessFile(path)
  if (current.warning !== undefined) {
    return { ok: false, code: 'invalid', error: `现有 metrics.yaml 无法解析，已拒绝覆盖：${current.warning}` }
  }
  if (!Number.isInteger(options.baseVersion) || options.baseVersion < 0) {
    return { ok: false, code: 'invalid', error: 'baseVersion 必须是非负整数。' }
  }
  if (current.file.version !== options.baseVersion) {
    return {
      ok: false,
      code: 'conflict',
      error: `文件已被他人修改（当前 v${current.file.version}，提交基于 v${options.baseVersion}），请刷新后重试。`,
    }
  }
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  const key = typeof record.key === 'string' ? record.key : ''
  const existing = current.file.metrics.find(metric => metric.key === key)
  const validated = validateBusinessMetric(input, existing === undefined ? {} : { existing })
  if (!validated.ok) return { ok: false, code: 'invalid', error: validated.error }
  const metrics = existing === undefined
    ? [...current.file.metrics, validated.metric]
    : current.file.metrics.map(metric => metric.key === existing.key ? validated.metric : metric)
  const file: BusinessMetricsFile = {
    version: current.file.version + 1,
    updatedAt: new Date(options.now ?? Date.now()).toISOString(),
    updatedBy: options.updatedBy,
    metrics,
  }
  const yaml = serializeBusinessMetrics(file)
  try {
    writeFileAtomically(path, yaml)
  } catch {
    return { ok: false, code: 'io', error: '写入失败：评测数据目录不可写。' }
  }
  return { ok: true, version: file.version, file, metric: validated.metric, yaml }
}
