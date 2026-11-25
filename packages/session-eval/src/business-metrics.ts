/**
 * 业务指标定义与 YAML 契约(56 号 §9.3–§9.6)。
 *
 * 本模块是**纯数据面**(浏览器半边也 import:编辑器要实时生成 YAML 预览),
 * 因此不得引入 node: 模块或服务端依赖。解析(`parseBusinessMetrics`)在
 * `business-yaml.ts`,那里才引 `yaml` 包。
 *
 * 三种指标形态二选一(校验强制恰好一种):
 * - `judge`:rubric 裁判(条件列表 + 权重 + 通过线),模型逐条判 hit;
 * - `trajectory` / `answer` / `budget`:确定性规则,离线金集与在线会话同语义。
 */
import type { JudgeCategory, JudgeScope } from './judge-types.ts'

/** rubric 单条判定条件(权重可为负:命中即扣分). */
export interface BusinessCriterion {
  readonly text: string
  readonly weight: number
  readonly critical: boolean
}

/** 裁判型定义(rubric). */
export interface BusinessJudgeSpec {
  /** 平台已配置的模型 id(保存时校验;执行沿用全局裁判路由,P2-1 注记). */
  readonly model?: string
  /** 轨迹窗口(按轮计;上限 50). */
  readonly window: { readonly maxSteps: number }
  /** 判不了时记 not_applicable(不记 0). */
  readonly allowSkip: boolean
  /** 通过线 0..1. */
  readonly minScore: number
  readonly criteria: readonly BusinessCriterion[]
}

/** 确定性规则:审批流(指定工具至少调用 N 次). */
export interface BusinessTrajectorySpec {
  readonly approvalFlow?: { readonly tool: string; readonly minCount: number }
}

/** 确定性规则:回复禁语. */
export interface BusinessAnswerSpec {
  readonly notContains: readonly string[]
}

/** 确定性规则:预算(轮数/token 上限). */
export interface BusinessBudgetSpec {
  readonly maxTurns: number
  readonly maxTokens: number
}

/** 一条业务指标(文件内条目). */
export interface BusinessMetric {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly category: JudgeCategory
  readonly scope: JudgeScope
  readonly gating: boolean
  /** 停用 = false(不物理删除;历史评分仍可追溯定义版本). */
  readonly enabled: boolean
  /** 条目级版本 = 该指标被保存的次数. */
  readonly version: number
  readonly judge?: BusinessJudgeSpec
  readonly trajectory?: BusinessTrajectorySpec
  readonly answer?: BusinessAnswerSpec
  readonly budget?: BusinessBudgetSpec
}

/** 一个账号的 metrics.yaml 内容. */
export interface BusinessMetricsFile {
  readonly version: number
  readonly updatedAt: string
  readonly updatedBy: string
  readonly metrics: readonly BusinessMetric[]
}

/** 空文件(首次读不到时的缺省;version 0 = 尚未保存). */
export const EMPTY_BUSINESS_FILE: BusinessMetricsFile = {
  version: 0,
  updatedAt: '',
  updatedBy: '',
  metrics: [],
}

/** 文件头三行固定注释(§9.4). */
export function businessYamlHeader(file: BusinessMetricsFile): string {
  return [
    '# 本文件由「设置 → 评测」生成；手改会在下次保存时被覆盖。',
    `# 版本：v${file.version}${file.updatedAt === '' ? '' : ` · 更新于 ${file.updatedAt}`}${file.updatedBy === '' ? '' : ` · 更新者 ${file.updatedBy}`}`,
    '# 条目版本随每次保存 +1；停用写 enabled: false，不删行。',
  ].join('\n')
}

/** key 规则(§9.5). */
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

/** YAML 需要引号的字符/形态(§9.4). */
const QUOTE_TRIGGER = /[:#{}\[\],&*'"|]|^\s|\s$|^[-?]|^(true|false|null|~)$|^[-+]?\d/u

/** 字符串标量(按 §9.4 规则决定是否加单引号). */
function scalar(value: string): string {
  if (value === '' || QUOTE_TRIGGER.test(value)) return `'${value.replace(/'/gu, "''")}'`
  return value
}

/** 数字字面量(不引号;非有限数按 0,由校验层先拦). */
function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

/** 布尔字面量. */
function boolText(value: boolean): string {
  return value ? 'true' : 'false'
}

/** 一条指标的 YAML(键序固定,§9.4). */
function metricLines(metric: BusinessMetric): string[] {
  const lines: string[] = [
    '  - key: ' + scalar(metric.key),
    '    name: ' + scalar(metric.name),
    '    description: ' + scalar(metric.description),
    '    category: ' + metric.category,
    '    scope: ' + metric.scope,
    '    gating: ' + boolText(metric.gating),
    '    enabled: ' + boolText(metric.enabled),
    '    version: ' + numberText(metric.version),
  ]
  if (metric.judge !== undefined) {
    const judge = metric.judge
    if (judge.model !== undefined) lines.push('    judge:', '      model: ' + scalar(judge.model))
    else lines.push('    judge:')
    lines.push(
      '      window:',
      '        max_steps: ' + numberText(judge.window.maxSteps),
      '      allow_skip: ' + boolText(judge.allowSkip),
      '      pass:',
      '        min_score: ' + numberText(judge.minScore),
      '      criteria:',
    )
    for (const criterion of judge.criteria) {
      lines.push(
        '        - text: ' + scalar(criterion.text),
        '          weight: ' + numberText(criterion.weight),
        '          critical: ' + boolText(criterion.critical),
      )
    }
  }
  if (metric.trajectory?.approvalFlow !== undefined) {
    lines.push(
      '    trajectory:',
      '      approval_flow:',
      '        tool: ' + scalar(metric.trajectory.approvalFlow.tool),
      '        min_count: ' + numberText(metric.trajectory.approvalFlow.minCount),
    )
  }
  if (metric.answer !== undefined) {
    lines.push('    answer:', '      not_contains:')
    for (const word of metric.answer.notContains) lines.push('        - ' + scalar(word))
  }
  if (metric.budget !== undefined) {
    lines.push(
      '    budget:',
      '      max_turns: ' + numberText(metric.budget.maxTurns),
      '      max_tokens: ' + numberText(metric.budget.maxTokens),
    )
  }
  return lines
}

/**
 * 序列化整个文件(保存即确定,§9.4)。
 * @param file - 文件内容(调用方已校验).
 * @returns 可直接落盘的 YAML 文本(末尾换行)。
 */
export function serializeBusinessMetrics(file: BusinessMetricsFile): string {
  const lines: string[] = [
    businessYamlHeader(file),
    'version: ' + numberText(file.version),
    'updated_at: ' + scalar(file.updatedAt),
    'updated_by: ' + scalar(file.updatedBy),
    'metrics:',
  ]
  if (file.metrics.length === 0) lines.push('  []')
  for (const metric of file.metrics) lines.push(...metricLines(metric))
  return `${lines.join('\n')}\n`
}

/** 校验结果(失败给中文原因,前端定位到字段). */
export type BusinessValidation =
  | { readonly ok: true; readonly metric: BusinessMetric }
  | { readonly ok: false; readonly error: string }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textField(
  record: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  required: boolean,
): string | { error: string } {
  const value = record[key]
  if (value === undefined) return required ? { error: `${label}不能为空。` } : ''
  if (typeof value !== 'string') return { error: `${label}必须是文本。` }
  const trimmed = value.trim()
  if (required && trimmed === '') return { error: `${label}不能为空。` }
  if (trimmed.length > max) return { error: `${label}不能超过 ${max} 字。` }
  return trimmed
}

function isError(value: string | { error: string }): value is { error: string } {
  return typeof value === 'object'
}

/** 校验 rubric 裁判定义. */
function validateJudge(raw: unknown): { ok: true; judge: BusinessJudgeSpec } | { ok: false; error: string } {
  const record = asRecord(raw)
  if (record === undefined) return { ok: false, error: 'judge 必须是对象。' }
  const modelRaw = record.model
  if (modelRaw !== undefined && (typeof modelRaw !== 'string' || modelRaw.trim() === '')) {
    return { ok: false, error: 'judge.model 必须是非空文本。' }
  }
  const window = asRecord(record.window)
  const maxSteps = window?.max_steps
  if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 50) {
    return { ok: false, error: 'judge.window.max_steps 必须是 1 到 50 的整数（轮）。' }
  }
  const allowSkip = record.allow_skip
  if (typeof allowSkip !== 'boolean') return { ok: false, error: 'judge.allow_skip 必须是布尔值。' }
  const pass = asRecord(record.pass)
  const minScore = pass?.min_score
  if (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    return { ok: false, error: 'judge.pass.min_score 必须在 0 到 1 之间。' }
  }
  const criteriaRaw = record.criteria
  if (!Array.isArray(criteriaRaw) || criteriaRaw.length === 0) {
    return { ok: false, error: 'judge.criteria 至少需要一条判定条件。' }
  }
  const criteria: BusinessCriterion[] = []
  let positiveWeight = 0
  for (const [index, rawCriterion] of criteriaRaw.entries()) {
    const criterion = asRecord(rawCriterion)
    const position = `第 ${index + 1} 条判定条件`
    if (criterion === undefined) return { ok: false, error: `${position}必须是对象。` }
    const text = criterion.text
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: `${position}的内容不能为空。` }
    if (text.trim().length > 200) return { ok: false, error: `${position}不能超过 200 字。` }
    const weight = criterion.weight
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight === 0 || weight < -5 || weight > 5) {
      return { ok: false, error: `${position}的权重必须是 -5 到 5 之间的非零数。` }
    }
    const critical = criterion.critical
    if (typeof critical !== 'boolean') return { ok: false, error: `${position}的 critical 必须是布尔值。` }
    if (weight > 0) positiveWeight += weight
    criteria.push({ text: text.trim(), weight, critical })
  }
  if (positiveWeight === 0) return { ok: false, error: '判定条件至少需要一条正权重（否则算不出得分）。' }
  return {
    ok: true,
    judge: {
      ...modelRaw === undefined ? {} : { model: modelRaw.trim() },
      window: { maxSteps },
      allowSkip,
      minScore,
      criteria,
    },
  }
}

export function validateBusinessMetric(
  input: unknown,
  options: { readonly existing?: BusinessMetric; readonly version?: number } = {},
): BusinessValidation {
  const record = asRecord(input)
  if (record === undefined) return { ok: false, error: '指标必须是对象。' }
  const keyRaw = record.key
  if (typeof keyRaw !== 'string' || !KEY_PATTERN.test(keyRaw)) {
    return { ok: false, error: '标识必须匹配 ^[a-z0-9][a-z0-9-]{1,39}$（小写字母/数字/连字符，2–40 位）。' }
  }
  if (options.existing !== undefined && options.existing.key !== keyRaw) {
    return { ok: false, error: '已保存指标的标识不可修改。' }
  }
  const name = textField(record, 'name', '名称', 20, true)
  if (isError(name)) return { ok: false, error: name.error }
  const description = textField(record, 'description', '说明', 120, false)
  if (isError(description)) return { ok: false, error: description.error }
  const category = record.category
  if (category !== 'outcome' && category !== 'process') return { ok: false, error: '类别只能是 outcome 或 process。' }
  const scope = record.scope
  if (scope !== 'session' && scope !== 'turn') return { ok: false, error: '范围只能是 session 或 turn。' }
  const gating = record.gating
  if (gating !== undefined && typeof gating !== 'boolean') return { ok: false, error: 'gating 必须是布尔值。' }
  const enabled = record.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔值。' }
  const hasJudge = record.judge !== undefined
  const ruleForms = ['trajectory', 'answer', 'budget'].filter(field => record[field] !== undefined)
  if (hasJudge && ruleForms.length > 0) return { ok: false, error: 'judge 与确定性规则不能同时出现。' }
  if (!hasJudge && ruleForms.length !== 1) {
    return { ok: false, error: '必须且只能选择一种判定方式（judge / trajectory / answer / budget）。' }
  }
  const judge = hasJudge ? validateJudge(record.judge) : undefined
  if (judge !== undefined && !judge.ok) return { ok: false, error: judge.error }
  let trajectory: BusinessTrajectorySpec | undefined
  if (record.trajectory !== undefined) {
    const flow = asRecord(asRecord(record.trajectory)?.approval_flow)
    const tool = flow?.tool
    const minCount = flow?.min_count
    if (typeof tool !== 'string' || tool.trim() === '') return { ok: false, error: 'trajectory.approval_flow.tool 不能为空。' }
    if (typeof minCount !== 'number' || !Number.isInteger(minCount) || minCount < 1) {
      return { ok: false, error: 'trajectory.approval_flow.min_count 必须是正整数。' }
    }
    trajectory = { approvalFlow: { tool: tool.trim(), minCount } }
  }
  let answer: BusinessAnswerSpec | undefined
  if (record.answer !== undefined) {
    const words = asRecord(record.answer)?.not_contains
    if (!Array.isArray(words) || words.length === 0 || words.some(word => typeof word !== 'string' || word.trim() === '')) {
      return { ok: false, error: 'answer.not_contains 至少需要一个非空词条。' }
    }
    answer = { notContains: words.map(word => String(word).trim()) }
  }
  let budget: BusinessBudgetSpec | undefined
  if (record.budget !== undefined) {
    if (scope !== 'session') return { ok: false, error: 'budget 只支持整条会话范围（scope 必须是 session）。' }
    const raw = asRecord(record.budget)
    const maxTurns = raw?.max_turns
    const maxTokens = raw?.max_tokens
    if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 1) {
      return { ok: false, error: 'budget.max_turns 必须是正整数。' }
    }
    if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1) {
      return { ok: false, error: 'budget.max_tokens 必须是正整数。' }
    }
    budget = { maxTurns, maxTokens }
  }
  const version = options.version ?? (options.existing === undefined ? 1 : options.existing.version + 1)
  return {
    ok: true,
    metric: {
      key: keyRaw,
      name,
      description,
      category,
      scope,
      gating: gating ?? false,
      enabled: enabled ?? true,
      version,
      ...judge === undefined ? {} : { judge: judge.judge },
      ...trajectory === undefined ? {} : { trajectory },
      ...answer === undefined ? {} : { answer },
      ...budget === undefined ? {} : { budget },
    },
  }
}

/** 指标形态(设置列表/面板徽标用). */
export function businessKindOf(metric: BusinessMetric): 'judge' | 'rule' {
  return metric.judge !== undefined ? 'judge' : 'rule'
}

/** 判定方式细分(设置列表徽标与编辑器模式用). */
export function businessFormOf(metric: BusinessMetric): 'judge' | 'approval' | 'answer' | 'budget' | 'unknown' {
  if (metric.judge !== undefined) return 'judge'
  if (metric.trajectory !== undefined) return 'approval'
  if (metric.answer !== undefined) return 'answer'
  if (metric.budget !== undefined) return 'budget'
  return 'unknown'
}

/**
 * 文件条目 → 校验器/保存端点输入。
 *
 * 规范:外层 camelCase(与 `BusinessMetric` 同名),嵌套沿用 YAML 的 snake_case
 * (`window.max_steps` / `allow_skip` / `pass.min_score` / `approval_flow` /
 * `not_contains` / `max_turns`)。编辑器的启用开关直接用它把现有条目原样回传。
 * @param metric - 已校验的文件条目.
 * @returns 可交给 `validateBusinessMetric` 的普通对象.
 */
export function metricInputOf(metric: BusinessMetric): Record<string, unknown> {
  const input: Record<string, unknown> = {
    key: metric.key,
    name: metric.name,
    description: metric.description,
    category: metric.category,
    scope: metric.scope,
    gating: metric.gating,
    enabled: metric.enabled,
  }
  if (metric.judge !== undefined) {
    input.judge = {
      ...metric.judge.model === undefined ? {} : { model: metric.judge.model },
      window: { max_steps: metric.judge.window.maxSteps },
      allow_skip: metric.judge.allowSkip,
      pass: { min_score: metric.judge.minScore },
      criteria: metric.judge.criteria.map(criterion => ({ ...criterion })),
    }
  }
  if (metric.trajectory?.approvalFlow !== undefined) {
    input.trajectory = {
      approval_flow: { tool: metric.trajectory.approvalFlow.tool, min_count: metric.trajectory.approvalFlow.minCount },
    }
  }
  if (metric.answer !== undefined) input.answer = { not_contains: [...metric.answer.notContains] }
  if (metric.budget !== undefined) input.budget = { max_turns: metric.budget.maxTurns, max_tokens: metric.budget.maxTokens }
  return input
}
