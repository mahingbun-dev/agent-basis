/**
 * 前缀稳定性检查器核心(纯函数,零副作用):连续多轮 prompt 组装序列 → 告警列表 + 稳定性评分。
 *
 * 评分口径(score ∈ [0,1]):
 * - 逐转移(commonPrefixLength / previousLength)的**加权聚合**:
 *   score = Σ共同前缀字符 / Σ上轮字符(上轮为空的转移不计入分母);
 * - 单调性(单测钉住,tests/stability.spec.ts「评分单调」):
 *   ① 完全稳定序列 score = 1;② 固定其余转移,任一转移的共同前缀变小 → 分子严格减小、
 *   分母不变 → score 严格下降;③ 失稳转移增多(每个失稳转移 retention<1)→ 同理严格下降;
 *   ④ 全部转移在偏移 0 断开 → score = 0。无转移(空/单轮序列)= 1(无可失稳)。
 *
 * 告警口径:仅当 commonPrefixLength < previousLength(前缀确实受损)才产出告警;
 * 段内末尾追加、纯追加新段(append-only 会话的常态)绝不告警——
 * 「稳定序列不告警」由 tests/stability.spec.ts 钉住。
 */
import { analyzeTransition, joinedText } from './prefix.ts'
import type { TransitionAlignment } from './prefix.ts'
import type { PromptAssembly, StabilityReport, StabilityWarning, TransitionRetention } from './types.ts'

/** 告警证据截窗长度(字符)。 */
const EVIDENCE_WINDOW = 80

/**
 * 分析连续多轮 prompt 组装序列(数组序即时间序,与 observe 聚合器同约定)。
 * 纯函数:不修改输入,不依赖外部状态。
 */
export function analyzeStability(assemblies: readonly PromptAssembly[]): StabilityReport {
  const retentions: TransitionRetention[] = []
  const warnings: StabilityWarning[] = []
  let numerator = 0
  let denominator = 0

  for (let i = 1; i < assemblies.length; i += 1) {
    const previous = assemblies[i - 1]
    const current = assemblies[i]
    if (previous === undefined || current === undefined) continue
    const alignment: TransitionAlignment = analyzeTransition(previous, current)
    const retention: TransitionRetention = {
      fromTurn: previous.turn,
      toTurn: current.turn,
      commonPrefixLength: alignment.commonPrefixLength,
      previousLength: alignment.previousLength,
      retention: alignment.previousLength === 0 ? 1 : alignment.commonPrefixLength / alignment.previousLength,
    }
    retentions.push(retention)
    if (alignment.previousLength > 0) {
      numerator += alignment.commonPrefixLength
      denominator += alignment.previousLength
      if (alignment.commonPrefixLength < alignment.previousLength) {
        warnings.push(buildWarning(previous, current, alignment, retention))
      }
    }
  }

  return {
    assemblies: assemblies.length,
    transitions: Math.max(assemblies.length - 1, 0),
    score: denominator === 0 ? 1 : numerator / denominator,
    warnings,
    retentions,
  }
}

function buildWarning(
  previous: PromptAssembly,
  current: PromptAssembly,
  alignment: TransitionAlignment,
  retention: TransitionRetention,
): StabilityWarning {
  const divergence = alignment.divergence
  if (divergence === null) {
    // 理论不可达(告警仅在 common<previous 时产出,该情形 divergence 必非 null);防御性兜底。
    return {
      kind: 'prefix-mutation',
      fromTurn: retention.fromTurn,
      toTurn: retention.toTurn,
      commonPrefixLength: retention.commonPrefixLength,
      previousLength: retention.previousLength,
      retention: retention.retention,
      message: `轮 ${retention.fromTurn}→${retention.toTurn}:前缀受损(${retention.commonPrefixLength}/${retention.previousLength})`,
    }
  }
  const classification = divergence.classification
  const offset = retention.commonPrefixLength
  const base = `轮 ${retention.fromTurn}→${retention.toTurn}:KV-cache 前缀在偏移 ${offset} 处断开`
    + `(上轮 ${retention.previousLength} 字符,仅 ${retention.commonPrefixLength} 可复用)`
  if (classification !== undefined) {
    return {
      kind: classification.kind,
      fromTurn: retention.fromTurn,
      toTurn: retention.toTurn,
      commonPrefixLength: retention.commonPrefixLength,
      previousLength: retention.previousLength,
      retention: retention.retention,
      source: divergence.source,
      patterns: classification.patterns,
      before: classification.before,
      after: classification.after,
      message: `${base};段「${divergence.source}」检测到易变${classification.kind === 'volatile-timestamp' ? '时间戳' : '随机 ID'}`
        + `(${classification.patterns.join('/')}):「${classification.before}」→「${classification.after}」`,
    }
  }
  const before = joinedText(previous.segments).slice(offset, offset + EVIDENCE_WINDOW)
  const after = joinedText(current.segments).slice(offset, offset + EVIDENCE_WINDOW)
  const cause = divergence.kind === 'structure-change'
    ? `段序变动(${divergence.detail},边界段「${divergence.source}」)`
    : `前缀变动(${divergence.detail},段「${divergence.source}」)`
  return {
    kind: divergence.kind,
    fromTurn: retention.fromTurn,
    toTurn: retention.toTurn,
    commonPrefixLength: retention.commonPrefixLength,
    previousLength: retention.previousLength,
    retention: retention.retention,
    source: divergence.source,
    before,
    after,
    message: `${base};${cause}`,
  }
}
