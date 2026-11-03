/**
 * 段级前缀对齐器(纯函数,零副作用):两个连续轮次 prompt 组装的共同前缀 + 失稳定位。
 *
 * 对齐口径(与 KV-cache 前缀复用语义一致):
 * - prompt 视为段序拼接(段间按单个 '\n' 计长)——上一轮 prompt 应是本轮 prompt 的
 *   严格前缀(append-only 会话);共同前缀 = 两轮全文逐字符匹配的长度;
 * - 段内追加(上一段是下一段的前缀,如最后一条消息仍在生成)= 前缀完整保留,不失稳;
 * - 同 source 段文本分叉 → 段内字符级定位 + classifyVolatility 归因;
 * - 段序变动(插入/删除/换序)→ structure-change,共同前缀停在分叉段边界;
 * - 上一轮尾部被截断(compaction 类)→ prefix-mutation,共同前缀 = 本轮全文长。
 */
import type { PromptAssembly, PromptSegment, StabilityWarningKind } from './types.ts'
import { classifyVolatility } from './volatile.ts'
import type { VolatilityClassification } from './volatile.ts'

/** 段间拼接符(共同前缀长度按此计;单字符,保证「字符偏移」语义简单)。 */
export const SEGMENT_SEPARATOR = '\n'

/** 失稳明细(告警的原始素材;stability.ts 组装成人读告警)。 */
export interface TransitionDivergence {
  readonly kind: StabilityWarningKind
  /** 失稳段下标(结构变动为分叉边界段)。 */
  readonly segmentIndex: number
  /** 失稳段 source(结构变动给出两侧首个段的 source 描述)。 */
  readonly source: string
  /** 变动细类:segment-rewrite 段内改写 / segment-truncated 段内截短 / structure-insert|remove|reorder|swap 段序变动 / tail-truncated 尾部截断。 */
  readonly detail: string
  /** 易变内容归因(volatile-* 才有)。 */
  readonly classification?: VolatilityClassification
}

/** 单个转移的对齐结果。 */
export interface TransitionAlignment {
  /** 共同前缀字符数(含段内字符级定位)。 */
  readonly commonPrefixLength: number
  /** 上一轮 prompt 总字符数。 */
  readonly previousLength: number
  /** 失稳素材;null = 该转移前缀完整保留(或上轮为空,无可失稳)。 */
  readonly divergence: TransitionDivergence | null
}

/**
 * 段序列到第 i 段(不含)为止的拼接长度:i < 段数时 = Σ前 i 段文本 + i 个分隔符
 * (即第 i 段在拼接视图中的起始偏移);i = 段数时 = 全文长度(末段后无分隔符,
 * 与 joinedText().length 严格一致)。
 */
function prefixLength(segments: readonly PromptSegment[], index: number): number {
  let total = 0
  const stop = Math.min(index, segments.length)
  for (let j = 0; j < stop; j += 1) {
    const segment = segments[j]
    if (segment === undefined) break
    total += segment.text.length
  }
  const separators = segments.length === 0 ? 0 : Math.min(index, segments.length - 1)
  return total + separators
}

/** 两字符串逐字符共同前缀长度。 */
export function commonChars(a: string, b: string): number {
  const width = Math.min(a.length, b.length)
  let i = 0
  while (i < width && a[i] === b[i]) i += 1
  return i
}

/** 全文拼接(仅告警证据截窗用;长度口径与 prefixLength 一致)。 */
export function joinedText(segments: readonly PromptSegment[]): string {
  return segments.map(segment => segment.text).join(SEGMENT_SEPARATOR)
}

/**
 * 对齐连续两轮(数组序即时间序,与 observe 聚合器同约定)。
 * 纯函数:不修改输入,不依赖外部状态。
 */
export function analyzeTransition(previous: PromptAssembly, next: PromptAssembly): TransitionAlignment {
  const previousLength = prefixLength(previous.segments, previous.segments.length)
  const min = Math.min(previous.segments.length, next.segments.length)

  let i = 0
  while (i < min) {
    const a = previous.segments[i]
    const b = next.segments[i]
    // noUncheckedIndexedAccess:索引访问可能 undefined;i < min 时必非空,防御性兜底。
    if (a === undefined || b === undefined) break
    if (a.source !== b.source) break
    if (a.text === b.text) {
      i += 1
      continue
    }
    // 同 source 段文本分叉:段内字符级定位。
    const p = commonChars(a.text, b.text)
    if (p === a.text.length && i === previous.segments.length - 1) {
      // 上一轮**末段**尾部追加(最后一条消息仍在生成):前缀完整保留,不失稳。
      return { commonPrefixLength: previousLength, previousLength, divergence: null }
    }
    const commonPrefixLength = prefixLength(previous.segments, i) + p
    // 非末段的段内追加会把后续段整体平移,前缀照样断在追加点——归因跳过(是追加不是改值)。
    const classification = p === a.text.length ? null : classifyVolatility(a.text, b.text)
    const detail = p === b.text.length
      ? 'segment-truncated'
      : p === a.text.length
        ? 'segment-grew-mid-sequence'
        : 'segment-rewrite'
    return {
      commonPrefixLength,
      previousLength,
      divergence: {
        kind: classification?.kind ?? 'prefix-mutation',
        segmentIndex: i,
        source: a.source,
        detail,
        ...(classification !== null && { classification }),
      },
    }
  }

  if (i < min) {
    // source 分叉:段序变动(insert/remove/reorder/swap),共同前缀停在边界。
    const prev = previous.segments[i]
    const curr = next.segments[i]
    if (prev === undefined || curr === undefined) {
      return { commonPrefixLength: prefixLength(previous.segments, i), previousLength, divergence: null }
    }
    const previousTail = new Set(previous.segments.slice(i).map(segment => segment.source))
    const nextTail = new Set(next.segments.slice(i).map(segment => segment.source))
    const inPrevTail = previousTail.has(curr.source)
    const inNextTail = nextTail.has(prev.source)
    const detail = inPrevTail && inNextTail
      ? 'structure-reorder'
      : !inPrevTail && !inNextTail
        ? 'structure-swap'
        : inNextTail
          ? 'structure-insert'
          : 'structure-remove'
    return {
      commonPrefixLength: prefixLength(previous.segments, i),
      previousLength,
      divergence: {
        kind: 'structure-change',
        segmentIndex: i,
        source: `${prev.source} | ${curr.source}`,
        detail,
      },
    }
  }

  // 前缀段全部相等:看谁更长。
  if (next.segments.length >= previous.segments.length) {
    // 纯追加:上一轮全文即共同前缀。
    return { commonPrefixLength: previousLength, previousLength, divergence: null }
  }
  // 尾部截断(compaction 类):共同前缀 = 本轮全文长。
  return {
    commonPrefixLength: prefixLength(next.segments, next.segments.length),
    previousLength,
    divergence: {
      kind: 'prefix-mutation',
      segmentIndex: next.segments.length,
      source: previous.segments[next.segments.length]?.source ?? '',
      detail: 'tail-truncated',
    },
  }
}
