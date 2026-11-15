/**
 * golden facts 清单的 schema 与加载校验(C4)。
 *
 * facts.json 描述一个 golden 会话里压缩后必须存活的关键事实:逐字用户原话、
 * 文件路径、错误串、命令、决策(claim+evidence)与误报注入检测串(mustNotAppear)。
 * 纯校验,无 IO;`loadFacts` 在 runner/script 侧负责读文件后的入口。
 *
 * 最低条数按 22 号 §3-C4: userVerbatim ≥5 / filePaths ≥8 / errorStrings ≥3 /
 * commands ≥3 / decisions ≥3;mustNotAppear 可选。
 *
 * @module @eterna/compaction/evals/facts
 */

/** 一条决策:claim 是结论短句,evidence 是会话里支撑它的原句(评分取其关键 token)。 */
export interface DecisionFact {
  readonly claim: string
  readonly evidence: string
}

/** golden/<case>/facts.json 的通过校验后的形状。 */
export interface FactsSchema {
  /** ≥5 条,逐字(大小写敏感 substring)出现在摘要中的用户原话片段。 */
  readonly userVerbatim: readonly string[]
  /** ≥8 条,逐字保留的文件路径。 */
  readonly filePaths: readonly string[]
  /** ≥3 条,逐字保留的错误串/错误码。 */
  readonly errorStrings: readonly string[]
  /** ≥3 条,逐字保留的命令或工具调用签名。 */
  readonly commands: readonly string[]
  /** ≥3 条,决策清单;按 evidence 关键 token ≥80% 命中判活。 */
  readonly decisions: readonly DecisionFact[]
  /** 可选:误报注入检测——这些串若出现在摘要中即违规(不许复述的断言/诱饵)。 */
  readonly mustNotAppear?: readonly string[]
}

/** 各清单的最低条数(22 号 §3-C4 facts.json schema)。 */
export const FACTS_MINIMUMS = {
  userVerbatim: 5,
  filePaths: 8,
  errorStrings: 3,
  commands: 3,
  decisions: 3,
} as const

/** facts.json 校验失败:全部违规聚合进一条错误,前缀 `invalid-facts:` 便于日志检索。 */
export class FactsValidationError extends Error {
  override name = 'FactsValidationError'
  constructor(readonly violations: string[]) {
    super(`invalid-facts: ${violations.join('; ')}`)
  }
}

/** 非空字符串数组断言;返回违规文案(空数组=合法)。 */
function checkStringList(value: unknown, name: string, min: number): string[] {
  if (!Array.isArray(value)) return [`${name} must be an array`]
  const violations: string[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      violations.push(`${name}[${index}] must be a non-empty string`)
    }
  }
  if (value.length < min) {
    violations.push(`${name} has ${value.length} item(s), minimum is ${min}`)
  }
  return violations
}

/**
 * 校验并收窄一个未信任的 facts.json 反序列化值。违规聚合进一条
 * {@link FactsValidationError};通过则返回只读的 {@link FactsSchema}。
 * @param value - JSON.parse 后的未信任值。
 * @returns 通过校验的 facts。
 * @throws {FactsValidationError} 结构或最低条数不满足时。
 */
export function validateFacts(value: unknown): FactsSchema {
  const violations: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FactsValidationError(['facts must be a JSON object'])
  }
  const record = value as Record<string, unknown>
  const known = new Set([
    'userVerbatim',
    'filePaths',
    'errorStrings',
    'commands',
    'decisions',
    'mustNotAppear',
  ])
  for (const key of Object.keys(record)) {
    if (!known.has(key)) violations.push(`unknown key "${key}"`)
  }
  violations.push(...checkStringList(record.userVerbatim, 'userVerbatim', FACTS_MINIMUMS.userVerbatim))
  violations.push(...checkStringList(record.filePaths, 'filePaths', FACTS_MINIMUMS.filePaths))
  violations.push(...checkStringList(record.errorStrings, 'errorStrings', FACTS_MINIMUMS.errorStrings))
  violations.push(...checkStringList(record.commands, 'commands', FACTS_MINIMUMS.commands))

  const decisions = record.decisions
  if (!Array.isArray(decisions)) {
    violations.push('decisions must be an array')
  } else {
    if (decisions.length < FACTS_MINIMUMS.decisions) {
      violations.push(`decisions has ${decisions.length} item(s), minimum is ${FACTS_MINIMUMS.decisions}`)
    }
    for (const [index, item] of decisions.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        violations.push(`decisions[${index}] must be an object with claim and evidence`)
        continue
      }
      const decision = item as Record<string, unknown>
      for (const field of ['claim', 'evidence'] as const) {
        if (typeof decision[field] !== 'string' || decision[field].trim().length === 0) {
          violations.push(`decisions[${index}].${field} must be a non-empty string`)
        }
      }
      for (const key of Object.keys(decision)) {
        if (key !== 'claim' && key !== 'evidence') violations.push(`decisions[${index}]: unknown key "${key}"`)
      }
    }
  }

  if (record.mustNotAppear !== undefined) {
    violations.push(...checkStringList(record.mustNotAppear, 'mustNotAppear', 0))
  }

  if (violations.length > 0) throw new FactsValidationError(violations)
  return {
    userVerbatim: [...(record.userVerbatim as string[])],
    filePaths: [...(record.filePaths as string[])],
    errorStrings: [...(record.errorStrings as string[])],
    commands: [...(record.commands as string[])],
    decisions: (decisions as Array<Record<string, string>>).map(decision => ({
      claim: decision.claim!,
      evidence: decision.evidence!,
    })),
    ...(record.mustNotAppear === undefined ? {} : { mustNotAppear: [...(record.mustNotAppear as string[])] }),
  }
}
