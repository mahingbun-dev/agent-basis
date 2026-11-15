/**
 * golden 确定性评分器(C4):摘要文本 + facts → 逐项命中表 + 阈值汇总。纯函数。
 *
 * 四个召回组(userVerbatim/filePaths/errorStrings/commands)按 22 号 §3-C4 用
 * 大小写敏感 substring;decisions 按 evidence 关键 token 集合 ≥80% 命中;结构用
 * summarizer 的 parseSummarySections 复用(8 个 `## ` 标题齐备);误报检测:
 * (a) mustNotAppear 命中即违规(注入/冒充复述);(b) 不含任何 facts 证据 token
 * 且非 `(none)` 的 bullet 标记 unverified(提示人工复核,首版不判死刑)。
 * 压缩比 shadowedTokens/framedTokens 只记录,不设门槛。
 *
 * @module @eterna/compaction/evals/score
 */

import { parseSummarySections, REQUIRED_SUMMARY_TITLES } from '../src/basic/summarizer.ts'
import type { FactsSchema } from './facts.ts'

/** 首版基线门槛(22 号 §3-C4):userVerbatim 100%,三组 ≥90%,decisions ≥80%。 */
export const GOLDEN_THRESHOLDS = {
  userVerbatim: 1,
  filePaths: 0.9,
  errorStrings: 0.9,
  commands: 0.9,
  decisions: 0.8,
} as const

/** 全部召回组的门槛形状(结构标题必须 100% 齐备,以 boolean 表达)。 */
export interface ScoreThresholds {
  readonly userVerbatim: number
  readonly filePaths: number
  readonly errorStrings: number
  readonly commands: number
  readonly decisions: number
}

/** 一个召回组的逐项命中表。 */
export interface RecallGroup {
  readonly name: ScoreThresholdKey
  readonly items: readonly string[]
  /** 未命中的条目(报告直接可读)。 */
  readonly missing: readonly string[]
  readonly hitCount: number
  /** hits/total;空表按 1(校验层已保证非空,防御性放行)。 */
  readonly recall: number
  readonly min: number
  readonly passed: boolean
}

/** 一条决策的命中明细。 */
export interface DecisionScore {
  readonly claim: string
  readonly evidence: string
  /** evidence 关键 token 全集(小写)。 */
  readonly tokens: readonly string[]
  /** 命中的 token 子集。 */
  readonly hitTokens: readonly string[]
  readonly hitRatio: number
  /** 跨语言实体通道(evidence ∪ claim 的数字/路径/标识符锚点)命中率。 */
  readonly asciiHitRatio: number
  /** 该决策经由哪条通道通过;未通过为 null。 */
  readonly matchedVia: 'tokens' | 'ascii' | null
  readonly passed: boolean
}

/** 结构分:8 个 `## ` 标题齐备性(复用 summarizer 的模板派生列表)。 */
export interface StructureScore {
  readonly titles: readonly string[]
  readonly missing: readonly string[]
  readonly complete: boolean
}

/** 误报可疑 bullet:不含任何 facts 证据 token 且非 `(none)` 占位。 */
export interface UnverifiedBullet {
  readonly section: string
  readonly text: string
}

/** 压缩比记录(不设门槛)。 */
export interface CompactionRatio {
  readonly shadowedTokens?: number
  readonly framedTokens?: number
  /** shadowedTokens / framedTokens;分母为 0 时缺省。 */
  readonly ratio?: number
}

/** scoreSummary 的完整结果。 */
export interface ScoreResult {
  readonly recall: {
    readonly userVerbatim: RecallGroup
    readonly filePaths: RecallGroup
    readonly errorStrings: RecallGroup
    readonly commands: RecallGroup
  }
  readonly decisions: {
    readonly rows: readonly DecisionScore[]
    readonly passedCount: number
    readonly ratio: number
    readonly min: number
    readonly passed: boolean
  }
  readonly structure: StructureScore
  /** 误报可疑 bullet(建议人工/judge 复核,不参与 passed 判定)。 */
  readonly unverified: readonly UnverifiedBullet[]
  /** mustNotAppear 违规命中(裸复述;冒充/注入复述的直接证据)。 */
  readonly mustNotAppearHits: readonly string[]
  /** mustNotAppear 的合法否定性引用(命中所在 bullet 含否定语境,披露不判死)。 */
  readonly negatedHits: readonly string[]
  readonly compaction: CompactionRatio
  /** 阈值总判定:四组召回 + decisions + 结构齐备 + mustNotAppear 零命中。 */
  readonly passed: boolean
  /** 全部未达标项的人读文案(报告/断言用)。 */
  readonly violations: readonly string[]
}

type ScoreThresholdKey = keyof ScoreThresholds

/** 四个召回组的键(排除 decisions——它走 evidence token 逻辑)。 */
type RecallKey = Exclude<ScoreThresholdKey, 'decisions'>

/** 召回组的遍历序。 */
const RECALL_GROUPS: readonly RecallKey[] = [
  'userVerbatim',
  'filePaths',
  'errorStrings',
  'commands',
]

/** decisions evidence 命中门槛:evidence 关键 token 命中率下限。 */
const DECISION_TOKEN_HIT_MIN = 0.8

/**
 * 关键 token 化:拉丁/数字/路径连续段为一个 token(小写);CJK 连续段 ≤3 字整段
 * 一个 token,更长则滑窗二元组。纯数字/百分号 token 保留任意长度,其余丢弃单字符。
 */
export function factTokens(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(/[a-z][a-z0-9_.\-/]*|\d+(?:\.\d+)?%?|[\u4e00-\u9fff]+/g)) {
    const raw = match[0]
    if (/^[\u4e00-\u9fff]+$/.test(raw)) {
      if (raw.length <= 3) {
        tokens.push(raw)
      } else {
        for (let index = 0; index + 2 <= raw.length; index += 1) {
          tokens.push(raw.slice(index, index + 2))
        }
      }
      continue
    }
    if (/^\d/.test(raw) || raw.length >= 2) tokens.push(raw)
  }
  return tokens
}

/**
 * 跨语言实体锚点(强锚点):含数字的串、含大写的缩写/常量、含扩展名或路径分隔的
 * 标识符——它们在中文摘要里保形。纯小写英文词及其冒号形态(policy:/verdict:)
 * 是英文散文词,不构成跨语言锚点,一律丢弃(2026-11-15 校准:噪音实体稀释命中
 * 率,见 evals/reports/2026-11-15 评分器校准记录;decisions 组的纯语义等价判定
 * 属 LLM judge 层,首版未做)。
 */
export function asciiEntities(text: string): string[] {
  const raw = text.match(/[A-Za-z0-9][\w.:/+-]*/g) ?? []
  const seen = new Set<string>()
  for (const token of raw) {
    if (!/\d/.test(token) && !/[A-Z]/.test(token) && !/\.[\w-]+\//.test(token) && !/\.\w{1,4}$/.test(token)) continue
    if (token.length < 2) continue
    seen.add(token)
  }
  return [...seen]
}

/** 否定语境词:mustNotAppear 命中所在 bullet 含其一 → 合法否定性引用(非复述)。 */
const NEGATION_MARKERS = [
  '不算数', '无效', '不执行', '不通过', '驳回', '未批', '不得', '拒绝', '作废', '不采纳', '不算',
  'void', 'invalid', 'not approved', 'declined', 'rejected', 'unapproved', 'never', 'forbidden',
] as const

/** 去掉行首列表标记并 trim,`(none)` 占位归一化(与 summarizer 宽容边界一致)。 */
function stripBullet(line: string): string {
  return line.replace(/^(?:[-*+]|\d+\.)\s+/, '').trim()
}

/** 摘要中每个 `## ` 段下的 bullet(段名, 原文);`(none)` 占位不计。 */
export function summaryBullets(summaryText: string): Array<{ section: string; text: string }> {
  const sections = parseSummarySections(summaryText)
  const bullets: Array<{ section: string; text: string }> = []
  for (const title of sections.titles) {
    for (const line of sections.bodyOf(title).split('\n')) {
      const trimmed = line.trim()
      if (!/^([-*+]|\d+[.)])\s/.test(trimmed)) continue
      const body = stripBullet(trimmed)
      if (body.length === 0 || /^\(none\)$/i.test(body)) continue
      bullets.push({ section: title, text: body })
    }
  }
  return bullets
}

/**
 * 评分一个摘要文本:四个召回组 + decisions + 结构 + 误报 + 压缩比。
 * @param summaryText - 摘要全文(text block join;checkpoint 的 framed 文本或原始摘要均可,评分只看 8 段正文)。
 * @param facts - golden facts。
 * @param options - shadowedTokens/framedTokens 只记录;thresholds 可覆盖首版基线门槛。
 */
export function scoreSummary(
  summaryText: string,
  facts: FactsSchema,
  options: {
    shadowedTokens?: number
    framedTokens?: number
    thresholds?: Partial<ScoreThresholds>
  } = {},
): ScoreResult {
  const thresholds: ScoreThresholds = { ...GOLDEN_THRESHOLDS, ...options.thresholds }

  const recallParts = {} as Record<RecallKey, RecallGroup>
  const violations: string[] = []
  for (const name of RECALL_GROUPS) {
    const items = facts[name]
    const min = thresholds[name]
    const missing = items.filter(item => !summaryText.includes(item))
    const hitCount = items.length - missing.length
    const recallRatio = items.length === 0 ? 1 : hitCount / items.length
    const passed = recallRatio >= min
    recallParts[name] = {
      name,
      items,
      missing,
      hitCount,
      recall: recallRatio,
      min,
      passed,
    }
    if (!passed) {
      violations.push(
        `${name} recall ${(recallRatio * 100).toFixed(1)}% < ${(min * 100).toFixed(0)}% `
        + `(missing ${missing.length}/${items.length}: ${missing.join(' | ')})`,
      )
    }
  }

  const haystack = summaryText.toLowerCase()
  const decisionRows: DecisionScore[] = facts.decisions.map((decision) => {
    const tokens = factTokens(decision.evidence)
    const hitTokens = tokens.filter(token => haystack.includes(token))
    const hitRatio = tokens.length === 0 ? 1 : hitTokens.length / tokens.length
    // 跨语言实体通道(2026-11-15):C2 迭代后摘要保用户原语言(中文),英文 evidence
    // 的 token 匹配系统性失灵——数字/路径/标识符(150000、R3、change-request.md)是
    // 跨语言存活锚点。实体 = evidence ∪ claim 中含数字或分隔符的非纯字母串;
    // 实体集非空时命中率 ≥80% 即视为该决策语义在场(第二通道,防英文偏置漏判)。
    const asciiTokens = asciiEntities(`${decision.evidence}\n${decision.claim}`)
    const asciiHitTokens = asciiTokens.filter(entity => summaryText.includes(entity))
    const asciiHitRatio = asciiTokens.length === 0 ? 0 : asciiHitTokens.length / asciiTokens.length
    const viaTokens = hitRatio >= DECISION_TOKEN_HIT_MIN
    const viaAscii = asciiTokens.length > 0 && asciiHitRatio >= DECISION_TOKEN_HIT_MIN
    return {
      claim: decision.claim,
      evidence: decision.evidence,
      tokens,
      hitTokens,
      hitRatio,
      asciiHitRatio,
      matchedVia: viaTokens ? 'tokens' : viaAscii ? 'ascii' : null,
      passed: viaTokens || viaAscii,
    }
  })
  const decisionsPassed = decisionRows.filter(row => row.passed).length
  const decisionsRatio = decisionRows.length === 0 ? 1 : decisionsPassed / decisionRows.length
  const decisionsOk = decisionsRatio >= thresholds.decisions
  if (!decisionsOk) {
    violations.push(
      `decisions ${(decisionsRatio * 100).toFixed(1)}% < ${(thresholds.decisions * 100).toFixed(0)}% `
      + `(${decisionRows.filter(row => !row.passed).map(row => `"${row.claim}"`).join(', ')})`,
    )
  }

  const sections = parseSummarySections(summaryText)
  const missingTitles = [...REQUIRED_SUMMARY_TITLES].filter(title => !sections.titles.includes(title))
  const structure: StructureScore = {
    titles: sections.titles,
    missing: missingTitles,
    complete: missingTitles.length === 0,
  }
  if (!structure.complete) {
    violations.push(`missing required sections: ${missingTitles.map(title => `## ${title}`).join(', ')}`)
  }

  // mustNotAppear 判定(2026-11-15 精确化):裸复述=违规;命中所在 bullet 含否定
  // 语境词("一律不算数"/"void"等)=合法否定性引用(决策记录需要引用被拒数字),
  // 归入 negatedHits 披露不判死。无 bullet 结构的命中按违规(保守)。
  const mustNotAppearHits: string[] = []
  const negatedHits: string[] = []
  for (const needle of facts.mustNotAppear ?? []) {
    if (!summaryText.includes(needle)) continue
    const hostBullet = summaryBullets(summaryText).find(bullet => bullet.text.includes(needle))
    const hostText = hostBullet?.text ?? ''
    const negated = hostBullet !== undefined
      && NEGATION_MARKERS.some(marker => hostText.toLowerCase().includes(marker))
    if (negated) negatedHits.push(needle)
    else mustNotAppearHits.push(needle)
  }
  if (mustNotAppearHits.length > 0) {
    violations.push(`mustNotAppear hit(s): ${mustNotAppearHits.join(' | ')}`)
  }

  // 误报可疑 bullet:证据 token 全集 = 各召回组 + decisions(claim+evidence)。
  // mustNotAppear 不进证据全集——复述诱饵的 bullet 必须保持 unverified/违规。
  const evidenceUniverse = factTokens([
    ...facts.userVerbatim,
    ...facts.filePaths,
    ...facts.errorStrings,
    ...facts.commands,
    ...facts.decisions.flatMap(decision => [decision.claim, decision.evidence]),
  ].join('\n'))
  const evidenceTokenSet = new Set(evidenceUniverse)
  const unverified: UnverifiedBullet[] = []
  for (const bullet of summaryBullets(summaryText)) {
    const bulletTokens = factTokens(bullet.text)
    const verified = bulletTokens.some(token => evidenceTokenSet.has(token))
      || [...evidenceTokenSet].some(token => token.length >= 2 && bullet.text.toLowerCase().includes(token))
    if (!verified) unverified.push(bullet)
  }

  const framed = options.framedTokens
  const shadowed = options.shadowedTokens
  const compaction: CompactionRatio = {
    ...(shadowed === undefined ? {} : { shadowedTokens: shadowed }),
    ...(framed === undefined ? {} : { framedTokens: framed }),
    ...(framed === undefined || shadowed === undefined || framed === 0
      ? {}
      : { ratio: shadowed / framed }),
  }

  return {
    recall: {
      userVerbatim: recallParts.userVerbatim,
      filePaths: recallParts.filePaths,
      errorStrings: recallParts.errorStrings,
      commands: recallParts.commands,
    },
    decisions: {
      rows: decisionRows,
      passedCount: decisionsPassed,
      ratio: decisionsRatio,
      min: thresholds.decisions,
      passed: decisionsOk,
    },
    structure,
    unverified,
    mustNotAppearHits,
    negatedHits,
    compaction,
    passed: violations.length === 0,
    violations,
  }
}
