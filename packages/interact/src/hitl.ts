/**
 * hitl.yaml 加载与校验(设计文档 08 §6.1/§6.3、13 号 §4、14 号 T3)。
 *
 * 领域包用 hitl.yaml 声明动作风险分档:R0 只读 / R1 可逆写 / R2 需确认 / R3 高危;
 * R3 条目可配升级对象(escalate_to)、冷静期(cooling_period_sec)、二次确认(double_confirm);
 * 全局或逐条可配 on_no_answer 挂起策略(ask 不可达时:挂起非失败 / 升级 channels / 失败)。
 *
 * fail-closed 纪律(对齐 @eterna/governance 规则引擎的"解析期拒绝 default: allow"):
 * - default_grade 只允许 R2|R3——未命中任何规则的动作必须走人,静默缺省即是放行漏洞;
 * - 未知键、非法枚举、R0-R2 条目携带 R3 专属字段,均在校验期拒绝;
 * - 分档裁决取命中规则的**最高档**(风险优先,对应 governance 的 deny 优先),未命中回落 default_grade。
 *
 * YAML 键统一 snake_case(default_grade / on_no_answer / args_contains / escalate_to /
 * cooling_period_sec / double_confirm)。
 */
import { parse } from 'yaml'
import { InteractConfigError, isRecord } from './errors.ts'
import { matchAnyGlob, stableStringify } from './types.ts'
import type { NoAnswerStrategy, RiskGrade, ToolCallLike } from './types.ts'

/** hitl.yaml 单条规则(解析后的规范形态,可选字段均已归一)。 */
export interface HitlRule {
  /** 规则唯一 id(命中后进审批卡片「命中规则」字段)。 */
  readonly id: string
  /** 风险档。 */
  readonly grade: RiskGrade
  /** 工具名 glob 列表(`*` 任意长度、`?` 单字符),非空。 */
  readonly tools: readonly string[]
  /** 参数子串列表(稳定串化后 includes,OR 语义);缺省 = 只按工具名匹配。 */
  readonly argsContains?: readonly string[]
  /** 人可读依据(进审批卡片)。 */
  readonly reason: string
  /** ask 不可达时的挂起策略(逐条覆盖全局)。 */
  readonly onNoAnswer: NoAnswerStrategy
  /** R3 专属:升级给指定人(channels 消费);R0-R2 恒为空数组。 */
  readonly escalateTo: readonly string[]
  /** R3 专属:冷静期秒数,0 = 无;R0-R2 恒为 0。 */
  readonly coolingPeriodSec: number
  /** R3 专属:是否强制二次确认;R0-R2 恒为 false。 */
  readonly doubleConfirm: boolean
}

/** hitl.yaml 解析后的完整文档。 */
export interface HitlDocument {
  /** 所属领域包名(可选,溯源用)。 */
  readonly pack?: string
  /** 未命中任何规则时的回落档;只允许 R2|R3(fail-closed)。 */
  readonly defaultGrade: RiskGrade
  /** 全局挂起策略缺省;缺省 'suspend'。 */
  readonly onNoAnswer: NoAnswerStrategy
  /** 规则列表(保序;同档多规则命中时取最前)。 */
  readonly rules: readonly HitlRule[]
}

/** 分档裁决结果:命中最高档规则或回落 default_grade。 */
export interface GradeDecision {
  /** 裁决出的风险档。 */
  readonly grade: RiskGrade
  /** 命中的规则;回落 default_grade 时为 undefined。 */
  readonly rule?: HitlRule
  /** 裁决依据(人可读,进卡片与日志)。 */
  readonly reason: string
}

const NO_ANSWER_STRATEGIES: readonly NoAnswerStrategy[] = ['suspend', 'escalate', 'fail']
const TOP_LEVEL_KEYS = new Set(['pack', 'default_grade', 'on_no_answer', 'rules'])
const RULE_KEYS = new Set([
  'id', 'grade', 'tools', 'args_contains', 'reason', 'on_no_answer',
  'escalate_to', 'cooling_period_sec', 'double_confirm',
])
const R3_ONLY_KEYS = ['escalate_to', 'cooling_period_sec', 'double_confirm'] as const

/** hitl.yaml 的加载、校验与分档裁决。 */
export class HitlPolicy {
  private readonly doc: HitlDocument

  private constructor(doc: HitlDocument) {
    this.doc = doc
  }

  /** 解析 YAML 文本并校验;失败抛 InteractConfigError(fail-closed,宿主不得降级放行)。 */
  static parse(yamlText: string): HitlPolicy {
    let raw: unknown
    try {
      raw = parse(yamlText)
    } catch (error) {
      throw new InteractConfigError(`hitl.yaml 不是合法 YAML:${error instanceof Error ? error.message : String(error)}`)
    }
    return HitlPolicy.load(raw)
  }

  /** 校验已解析的对象(供宿主从别的来源——如 Obsidian 前置 matter——喂入)。 */
  static load(raw: unknown): HitlPolicy {
    const issues: string[] = []
    if (!isRecord(raw)) {
      throw new InteractConfigError('hitl.yaml 根节点必须是映射(mapping)')
    }
    for (const key of Object.keys(raw)) {
      if (!TOP_LEVEL_KEYS.has(key)) issues.push(`顶层未知键 "${key}"`)
    }
    if (typeof raw.pack !== 'undefined' && typeof raw.pack !== 'string') {
      issues.push('pack 必须是字符串')
    }
    if (typeof raw.default_grade !== 'string' || (raw.default_grade !== 'R2' && raw.default_grade !== 'R3')) {
      issues.push('default_grade 必填且只允许 R2|R3(fail-closed:未命中规则的动作必须走人)')
    }
    const globalNoAnswer = readNoAnswer(raw.on_no_answer, issues, '顶层 on_no_answer')
    const rawRules = raw.rules
    if (typeof rawRules !== 'undefined' && !Array.isArray(rawRules)) {
      issues.push('rules 必须是列表')
    }
    const rules = parseRules(rawRules, issues, globalNoAnswer)
    if (issues.length > 0) {
      throw new InteractConfigError('hitl.yaml 校验失败', issues)
    }
    const defaultGrade = raw.default_grade as 'R2' | 'R3'
    return new HitlPolicy({
      ...(typeof raw.pack === 'string' && { pack: raw.pack }),
      defaultGrade,
      onNoAnswer: globalNoAnswer ?? 'suspend',
      rules,
    })
  }

  /** 解析后的文档(只读投影)。 */
  get document(): HitlDocument {
    return this.doc
  }

  /** 按 id 取规则(审批卡片「命中规则」溯源)。 */
  ruleById(id: string): HitlRule | undefined {
    return this.doc.rules.find(rule => rule.id === id)
  }

  /**
   * 分档裁决:命中规则的取**最高档**(风险优先),同档取最前;未命中回落 default_grade。
   * args_contains 存在时要求稳定串化参数命中任一子串(与 governance 规则引擎的 argsContains 同语义)。
   */
  gradeFor(call: ToolCallLike): GradeDecision {
    let winner: HitlRule | undefined
    for (const rule of this.doc.rules) {
      if (!matchAnyGlob(call.name, rule.tools)) continue
      if (rule.argsContains !== undefined && rule.argsContains.length > 0) {
        const serialized = stableStringify(call.arguments ?? {})
        if (!rule.argsContains.some(needle => serialized.includes(needle))) continue
      }
      if (winner === undefined || gradeRank(rule.grade) > gradeRank(winner.grade)) winner = rule
    }
    if (winner !== undefined) {
      return {
        grade: winner.grade,
        rule: winner,
        reason: winner.reason !== '' ? winner.reason : `命中规则 ${winner.id}`,
      }
    }
    return {
      grade: this.doc.defaultGrade,
      reason: '未命中任何 hitl.yaml 规则,回落 default_grade(fail-closed)',
    }
  }
}

function parseRules(rawRules: unknown, issues: string[], globalNoAnswer: NoAnswerStrategy | undefined): HitlRule[] {
  const rules: HitlRule[] = []
  const seenIds = new Set<string>()
  if (!Array.isArray(rawRules)) return rules
  rawRules.forEach((rawRule, index) => {
    const where = `rules[${index}]`
    if (!isRecord(rawRule)) {
      issues.push(`${where} 必须是映射`)
      return
    }
    for (const key of Object.keys(rawRule)) {
      if (!RULE_KEYS.has(key)) issues.push(`${where} 未知键 "${key}"`)
    }
    const id = rawRule.id
    if (typeof id !== 'string' || id === '') {
      issues.push(`${where}.id 必须是非空字符串`)
    } else if (seenIds.has(id)) {
      issues.push(`${where}.id 重复:"${id}"`)
    } else {
      seenIds.add(id)
    }
    const grade = rawRule.grade
    if (typeof grade !== 'string' || !['R0', 'R1', 'R2', 'R3'].includes(grade)) {
      issues.push(`${where}.grade 必须是 R0|R1|R2|R3`)
    }
    const tools = readStringArray(rawRule.tools, issues, `${where}.tools`)
    if (tools.length === 0) issues.push(`${where}.tools 必须是非空字符串列表`)
    const argsContains = readStringArray(rawRule.args_contains, issues, `${where}.args_contains`)
    if (typeof rawRule.args_contains !== 'undefined' && argsContains.length === 0) {
      issues.push(`${where}.args_contains 必须是非空字符串列表`)
    }
    if (typeof rawRule.reason !== 'undefined' && typeof rawRule.reason !== 'string') {
      issues.push(`${where}.reason 必须是字符串`)
    }
    const ruleNoAnswer = readNoAnswer(rawRule.on_no_answer, issues, `${where}.on_no_answer`)
    if (grade !== 'R3') {
      for (const key of R3_ONLY_KEYS) {
        if (typeof rawRule[key] !== 'undefined') issues.push(`${where}.${key} 只允许出现在 R3 条目`)
      }
    }
    let escalateTo: readonly string[] = []
    let coolingPeriodSec = 0
    let doubleConfirm = false
    if (grade === 'R3') {
      escalateTo = readStringArray(rawRule.escalate_to, issues, `${where}.escalate_to`)
      if (typeof rawRule.escalate_to !== 'undefined' && escalateTo.length === 0) {
        issues.push(`${where}.escalate_to 必须是非空字符串列表`)
      }
      const cooling = rawRule.cooling_period_sec
      if (typeof cooling !== 'undefined') {
        if (typeof cooling !== 'number' || !Number.isInteger(cooling) || cooling <= 0) {
          issues.push(`${where}.cooling_period_sec 必须是正整数(秒)`)
        } else {
          coolingPeriodSec = cooling
        }
      }
      if (typeof rawRule.double_confirm !== 'undefined') {
        if (typeof rawRule.double_confirm !== 'boolean') {
          issues.push(`${where}.double_confirm 必须是布尔值`)
        } else {
          doubleConfirm = rawRule.double_confirm
        }
      }
    }
    if (typeof id !== 'string' || id === '' || typeof grade !== 'string' || !isRiskGrade(grade)) return
    rules.push({
      id,
      grade,
      tools,
      ...(argsContains.length > 0 && { argsContains }),
      reason: typeof rawRule.reason === 'string' ? rawRule.reason : '',
      onNoAnswer: ruleNoAnswer ?? globalNoAnswer ?? 'suspend',
      escalateTo,
      coolingPeriodSec,
      doubleConfirm,
    })
  })
  return rules
}

function isRiskGrade(value: string): value is RiskGrade {
  return value === 'R0' || value === 'R1' || value === 'R2' || value === 'R3'
}

function readNoAnswer(value: unknown, issues: string[], where: string): NoAnswerStrategy | undefined {
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'string' || !NO_ANSWER_STRATEGIES.includes(value as NoAnswerStrategy)) {
    issues.push(`${where} 只允许 ${NO_ANSWER_STRATEGIES.join('|')}`)
    return undefined
  }
  return value as NoAnswerStrategy
}

function readStringArray(value: unknown, issues: string[], where: string): string[] {
  if (typeof value === 'undefined') return []
  if (!Array.isArray(value)) {
    issues.push(`${where} 必须是字符串列表`)
    return []
  }
  const items: string[] = []
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item === '') {
      issues.push(`${where}[${index}] 必须是非空字符串`)
    } else {
      items.push(item)
    }
  })
  return items
}

function gradeRank(grade: RiskGrade): number {
  return ['R0', 'R1', 'R2', 'R3'].indexOf(grade)
}
