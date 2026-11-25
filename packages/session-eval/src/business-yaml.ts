/**
 * metrics.yaml 解析(服务端;56 号 §9.3/§9.5)。序列化在 `business-metrics.ts`。
 *
 * 读文件走 **fail-closed**:解析或校验失败不臆测内容,把中文原因(带行号)交给
 * 设置分区;保存端在文件损坏时拒绝覆盖(否则一次保存就抹掉人工内容)。
 */
import { parseDocument } from 'yaml'
import {
  EMPTY_BUSINESS_FILE, validateBusinessMetric,
  type BusinessMetric, type BusinessMetricsFile,
} from './business-metrics.ts'

/** 解析结果(失败给中文原因;行号从 1 起). */
export type BusinessFileParse =
  | { readonly ok: true; readonly file: BusinessMetricsFile }
  | { readonly ok: false; readonly error: string }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 文件内条目(snake_case)→ 校验器输入(camelCase). */
function entryInput(raw: Record<string, unknown>): unknown {
  const judge = asRecord(raw.judge)
  const window = asRecord(judge?.window)
  const pass = asRecord(judge?.pass)
  const criteria = Array.isArray(judge?.criteria)
    ? judge.criteria.map((item) => {
      const criterion = asRecord(item)
      return { text: criterion?.text, weight: criterion?.weight, critical: criterion?.critical }
    })
    : undefined
  const trajectory = asRecord(raw.trajectory)
  const flow = asRecord(trajectory?.approval_flow)
  const answer = asRecord(raw.answer)
  const budget = asRecord(raw.budget)
  return {
    key: raw.key,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    scope: raw.scope,
    gating: raw.gating,
    enabled: raw.enabled,
    version: raw.version,
    ...judge === undefined ? {} : {
      judge: {
        ...judge.model === undefined ? {} : { model: judge.model },
        window: { max_steps: window?.max_steps },
        allow_skip: judge.allow_skip,
        pass: { min_score: pass?.min_score },
        criteria,
      },
    },
    ...trajectory === undefined ? {} : { trajectory: { approval_flow: flow } },
    ...answer === undefined ? {} : { answer },
    ...budget === undefined ? {} : { budget: { max_turns: budget.max_turns, max_tokens: budget.max_tokens } },
  }
}

/**
 * 解析 metrics.yaml 文本。
 * @param text - 文件内容.
 * @returns 文件模型或中文原因(含首条 YAML 语法错误的行号).
 */
export function parseBusinessMetrics(text: string): BusinessFileParse {
  const document = parseDocument(text, { strict: true, uniqueKeys: true })
  if (document.errors.length > 0) {
    const first = document.errors[0] as { message?: string; linePos?: { line?: number }[] } | undefined
    const line = first?.linePos?.[0]?.line
    const message = first?.message ?? '未知语法错误'
    return { ok: false, error: `YAML 解析失败${line === undefined ? '' : `（第 ${line} 行）`}：${message}` }
  }
  const root = asRecord(document.toJS())
  if (root === undefined) return { ok: false, error: '文件顶层必须是对象。' }
  const version = root.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, error: 'version 必须是非负整数。' }
  }
  const updatedAt = typeof root.updated_at === 'string' ? root.updated_at : ''
  const updatedBy = typeof root.updated_by === 'string' ? root.updated_by : ''
  const rawMetrics = root.metrics
  if (rawMetrics !== undefined && !Array.isArray(rawMetrics)) return { ok: false, error: 'metrics 必须是数组。' }
  const metrics: BusinessMetric[] = []
  const seen = new Set<string>()
  for (const [index, raw] of (rawMetrics ?? []).entries()) {
    const record = asRecord(raw)
    if (record === undefined) return { ok: false, error: `metrics 第 ${index + 1} 项必须是对象。` }
    const key = typeof record.key === 'string' ? record.key : `#${index + 1}`
    if (seen.has(key)) return { ok: false, error: `metrics 出现重复 key（${key}）。` }
    seen.add(key)
    const rawVersion = typeof record.version === 'number' && Number.isInteger(record.version) && record.version >= 1
      ? record.version
      : 1
    const parsed = validateBusinessMetric(entryInput(record), { version: rawVersion })
    if (!parsed.ok) return { ok: false, error: `指标「${key}」不合法：${parsed.error}` }
    metrics.push(parsed.metric)
  }
  return { ok: true, file: { version, updatedAt, updatedBy, metrics } }
}

/** 读文件内容 → 文件模型;缺失文件按空文件(version 0). */
export function parseBusinessMetricsOrEmpty(text: string | undefined): { readonly file: BusinessMetricsFile; readonly warning?: string } {
  if (text === undefined || text.trim() === '') return { file: EMPTY_BUSINESS_FILE }
  const parsed = parseBusinessMetrics(text)
  if (!parsed.ok) return { file: EMPTY_BUSINESS_FILE, warning: parsed.error }
  return { file: parsed.file }
}
