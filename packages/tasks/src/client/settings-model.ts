/**
 * 任务设置表单纯逻辑(2026-11-19 任务设置分区):设置结构、分块脏检查、增量合并与
 * 客户端校验。全部纯函数(node 单测直测,无 DOM),组件层(settings.tsx)只做状态与渲染。
 *
 * 分块语义与服务端同源(tasks/policy/settings.ts + save.ts):
 * - 块域 = pause / policy(rules+sources) / eval / executor / budget / gates / source:<name>;
 * - 保存时按块增量合并(withBlock):每块只提交该块的表单值,服务端 CAS 按块递增修订;
 *   逐块提交而非"全量重复提交",避免后续块被 saveSettingsBlock 判为无变化(不记修订)。
 */

export type EvalMode = 'off' | 'observe' | 'auto'
export type AdmissionValue = 'explicit' | 'inferred' | 'ignore'
export type WeakAdmissionValue = 'inferred' | 'ignore'

export const EVAL_MODES: readonly EvalMode[] = ['off', 'observe', 'auto']
export const ADMISSION_WEAK: readonly WeakAdmissionValue[] = ['inferred', 'ignore']
export const ADMISSION_STRONG: readonly AdmissionValue[] = ['explicit', 'inferred', 'ignore']
export const WORKER_COMMANDS: readonly string[] = ['gh', 'git', 'lark-cli']

export const RULE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/u
export const SOURCE_NAME_RE = /^[a-z][a-z0-9-]*$/u
export const COMMAND_RE = /^[A-Za-z0-9._-]+$/u
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
} as const

export interface RoleModelView {
  provider: string
  model: string
  reasoningEffort?: string
}
export interface RuleView {
  id: string
  name: string
  enabled: boolean
  instruction: string
}
export interface AdmissionRowView {
  listedUnaddressed?: WeakAdmissionValue
  unlistedAddressed?: AdmissionValue
  unlistedUnaddressed?: WeakAdmissionValue
}
export interface AllowedView {
  id: string
  name?: string
}
export interface SourcePolicyView {
  allowed: AllowedView[]
  admission: Record<string, AdmissionRowView>
  /** Source 自身扩展键(如 bots)——表单不改写,原样透传。 */
  [key: string]: unknown
}
export interface SourceInstanceView {
  enabled: boolean
  config: Record<string, unknown>
}
export interface BudgetCapsView {
  maxTurns?: number
  maxTokens?: number
  maxCost?: number
}
export interface BudgetView {
  caps: { simple: BudgetCapsView; compare: BudgetCapsView; complex: BudgetCapsView }
  pricing?: { inputPerMTokens: number; outputPerMTokens: number }
  creditsPerMTokens?: number
}
export interface EvalView {
  mode: EvalMode
  timeoutSeconds: number
  model: RoleModelView | null
}
export interface ExecutorView {
  model: RoleModelView | null
  maxWorkers: number
  directory: string
  prepare: string
  blockedCommands: string[]
}
export interface PolicyView {
  rules: RuleView[]
  sources: Record<string, SourcePolicyView>
}
export interface TasksSettings {
  paused: boolean
  sources: Record<string, SourceInstanceView>
  policy: PolicyView
  eval: EvalView
  executor: ExecutorView
  budget: BudgetView
  gates: { highRiskRules: string[] }
}

/** 固定块 + 来源实例块;与服务端 settingsBlockList 同序(pause → policy → … → source:*)。 */
export function formBlocks(settings: TasksSettings): readonly string[] {
  return ['pause', 'policy', 'eval', 'executor', 'budget', 'gates',
    ...Object.keys(settings.sources).sort().map(name => `source:${name}`)]
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

/**
 * 脏块清单(加载快照 vs 表单;顺序与保存顺序一致)。
 * 来源实例逐键展开(多实例同时改动 = 多次分块保存,各自递增修订)。
 */
export function dirtyBlocks(before: TasksSettings, after: TasksSettings): string[] {
  const blocks: string[] = []
  if (before.paused !== after.paused) blocks.push('pause')
  if (!same(before.policy, after.policy)) blocks.push('policy')
  if (!same(before.eval, after.eval)) blocks.push('eval')
  if (!same(before.executor, after.executor)) blocks.push('executor')
  if (!same(before.budget, after.budget)) blocks.push('budget')
  if (!same(before.gates, after.gates)) blocks.push('gates')
  const names = [...new Set([...Object.keys(before.sources), ...Object.keys(after.sources)])].sort()
  for (const name of names) {
    if (!same(before.sources[name], after.sources[name])) blocks.push(`source:${name}`)
  }
  return blocks
}

/**
 * 增量合并:把表单中**该块**的值并进服务端当前快照,其余块保持服务端现值。
 * (逐块保存的关键:全量重复提交会让后续块被判"无变化",修订不递增、版本史缺块。)
 */
export function withBlock(current: TasksSettings, form: TasksSettings, block: string): TasksSettings {
  if (block === 'pause') return { ...current, paused: form.paused }
  if (block === 'policy') return { ...current, policy: form.policy }
  if (block === 'eval') return { ...current, eval: form.eval }
  if (block === 'executor') return { ...current, executor: form.executor }
  if (block === 'budget') return { ...current, budget: form.budget }
  if (block === 'gates') return { ...current, gates: form.gates }
  if (block.startsWith('source:')) {
    const name = block.slice('source:'.length)
    const instance = form.sources[name]
    if (instance === undefined) {
      const kept = Object.entries(current.sources).filter(([key]) => key !== name)
      return { ...current, sources: Object.fromEntries(kept) }
    }
    return { ...current, sources: { ...current.sources, [name]: instance } }
  }
  return current
}

/** 深拷贝(表单编辑不污染加载快照;设置是纯 JSON 结构)。 */
export function cloneSettings(settings: TasksSettings): TasksSettings {
  return structuredClone(settings)
}

/** 来源实例 config 文本 → 对象(JSON 对象才接受;数组/标量/null 拒绝)。 */
export function parseSourceConfig(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: '配置必须是 JSON 对象' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/** 可选数字输入解析(空串 = 未设限;非数字/越界由 validateSettings 再校)。 */
export function optionalNumber(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

export interface ValidationIssue {
  readonly block: string
  readonly message: string
}

function validateRule(rule: RuleView, index: number, seen: Set<string>, issues: ValidationIssue[]): void {
  const label = `规则 #${index + 1}`
  if (!RULE_ID_RE.test(rule.id)) issues.push({ block: 'policy', message: `${label}：id 只允许字母/数字/_/-，1–80 位` })
  else if (seen.has(rule.id)) issues.push({ block: 'policy', message: `${label}：id「${rule.id}」重复` })
  else seen.add(rule.id)
  if (rule.name.trim() === '' || rule.name.length > LIMITS.ruleName) issues.push({ block: 'policy', message: `${label}：名称需 1–${LIMITS.ruleName} 字` })
  if (rule.instruction.trim() === '' || rule.instruction.length > LIMITS.ruleInstruction) {
    issues.push({ block: 'policy', message: `${label}：指示文本需 1–${LIMITS.ruleInstruction} 字` })
  }
}

function validateRoleModel(model: RoleModelView | null, block: string, label: string, issues: ValidationIssue[]): void {
  if (model === null) return
  if (model.provider.trim() === '') issues.push({ block, message: `${label}：供应商不能为空` })
  if (model.model.trim() === '') issues.push({ block, message: `${label}：模型不能为空` })
}

function validateSources(policy: PolicyView, issues: ValidationIssue[]): void {
  for (const [name, part] of Object.entries(policy.sources)) {
    if (!SOURCE_NAME_RE.test(name)) issues.push({ block: 'policy', message: `来源「${name}」：名只允许小写字母开头 + 小写字母/数字/-` })
    part.allowed.forEach((entry, index) => {
      if (entry.id.trim() === '' || entry.id.length > 200) issues.push({ block: 'policy', message: `来源「${name}」名单 #${index + 1}：身份 id 需 1–200 字` })
      if (entry.name !== undefined && entry.name.length > 100) issues.push({ block: 'policy', message: `来源「${name}」名单 #${index + 1}：显示名 ≤100 字` })
    })
    for (const rowKey of Object.keys(part.admission)) {
      if (rowKey.trim() === '') issues.push({ block: 'policy', message: `来源「${name}」准入行：scope 键不能为空` })
      // 三格档位由 select 限定值域(Weak 两格只允许 推断/忽略,对准格三档);schema 层再兜底。
    }
  }
}

/** 表单全量校验(与服务端 schema 同界;返回按块标注的首批问题)。 */
export function validateSettings(settings: TasksSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  settings.policy.rules.forEach((rule, index) => { validateRule(rule, index, seen, issues) })
  validateSources(settings.policy, issues)
  const timeout = settings.eval.timeoutSeconds
  if (!Number.isInteger(timeout) || timeout < LIMITS.evalTimeoutSeconds.min || timeout > LIMITS.evalTimeoutSeconds.max) {
    issues.push({ block: 'eval', message: `评估超时需 ${LIMITS.evalTimeoutSeconds.min}–${LIMITS.evalTimeoutSeconds.max} 秒整数` })
  }
  validateRoleModel(settings.eval.model, 'eval', '评估模型', issues)
  const maxWorkers = settings.executor.maxWorkers
  if (!Number.isInteger(maxWorkers) || maxWorkers < LIMITS.maxWorkers.min || maxWorkers > LIMITS.maxWorkers.max) {
    issues.push({ block: 'executor', message: `并发上限需 ${LIMITS.maxWorkers.min}–${LIMITS.maxWorkers.max} 整数` })
  }
  if (settings.executor.directory !== '' && !settings.executor.directory.startsWith('/')) {
    issues.push({ block: 'executor', message: '工单目录根需绝对路径，或留空用默认' })
  }
  if (settings.executor.prepare.length > LIMITS.prepareCommand) issues.push({ block: 'executor', message: `准备命令 ≤${LIMITS.prepareCommand} 字` })
  for (const command of settings.executor.blockedCommands) {
    if (!COMMAND_RE.test(command) || command === '.' || command === '..') {
      issues.push({ block: 'executor', message: `被禁命令「${command}」不合法` })
    } else if (WORKER_COMMANDS.includes(command)) {
      issues.push({ block: 'executor', message: `被禁命令不能包含 worker 必需命令「${command}」` })
    }
  }
  validateRoleModel(settings.executor.model, 'executor', '执行模型', issues)
  for (const tier of ['simple', 'compare', 'complex'] as const) {
    const caps = settings.budget.caps[tier]
    if (caps.maxTurns !== undefined && (!Number.isInteger(caps.maxTurns) || caps.maxTurns < 1)) {
      issues.push({ block: 'budget', message: `${tier} 档最大轮次需正整数` })
    }
    if (caps.maxTokens !== undefined && (!Number.isInteger(caps.maxTokens) || caps.maxTokens < 1)) {
      issues.push({ block: 'budget', message: `${tier} 档最大 token 需正整数` })
    }
    if (caps.maxCost !== undefined && (!Number.isFinite(caps.maxCost) || caps.maxCost < 0)) {
      issues.push({ block: 'budget', message: `${tier} 档最大成本需非负数` })
    }
  }
  if (settings.budget.pricing !== undefined) {
    if (!Number.isFinite(settings.budget.pricing.inputPerMTokens) || settings.budget.pricing.inputPerMTokens < 0
      || !Number.isFinite(settings.budget.pricing.outputPerMTokens) || settings.budget.pricing.outputPerMTokens < 0) {
      issues.push({ block: 'budget', message: '计价单价需非负数' })
    }
  }
  if (settings.budget.creditsPerMTokens !== undefined
    && (!Number.isFinite(settings.budget.creditsPerMTokens) || settings.budget.creditsPerMTokens < 0)) {
    issues.push({ block: 'budget', message: '积分换算率需非负数' })
  }
  for (const ruleId of settings.gates.highRiskRules) {
    if (!RULE_ID_RE.test(ruleId)) issues.push({ block: 'gates', message: `门禁规则 id「${ruleId}」不合法` })
  }
  for (const name of Object.keys(settings.sources)) {
    if (!SOURCE_NAME_RE.test(name)) issues.push({ block: `source:${name}`, message: `实例名「${name}」不合法` })
  }
  return issues
}
