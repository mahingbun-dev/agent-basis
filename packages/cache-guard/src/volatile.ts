/**
 * 易变内容模式库 + 变动归因分类器(纯函数,零副作用)。
 *
 * 职责:当连续两轮 prompt 的同一段文本发生差异时,判断差异是否**完全**由
 * 「动态时间戳 / 随机 ID」这类易变 token 造成——是则归因为 volatile-timestamp /
 * volatile-random-id(告诉开发者前缀为什么每次都断);否则返回 null(由上层报
 * 通用 prefix-mutation)。
 *
 * 归因方法(精确、可解释、宁漏勿误):把两边文本中命中的模式值全部替换为
 * `<kind:id>` 占位符后比较——归一化相等即「差异完全落在易变 token 上」。
 * 纯文本改写(如 version 1→2)不会被误归因,仍走 prefix-mutation 告警。
 *
 * 模式设计说明:
 * - 时间戳按最长优先排列(epoch 毫秒在秒前、iso 在纯日期前),避免长模式被短模式截胡;
 * - epoch 限定 1[6-9] 起头(2020-2033 秒级 / 毫秒级),避免匹配任意大数;
 * - 随机 ID:uuid → ≥12 位 hex token → ≥16 位且混合字母数字的 base62 token
 *   (必须同时含字母与数字,防止误吃 internationalization 这类纯字母长词);
 * - 归因只作用于「已发生差异的段」,正常追加内容里的时间戳不触发(见 prefix.ts)。
 */

/** 一条易变内容模式(注册表条目:id 全局唯一)。 */
export interface VolatilePattern {
  readonly id: string
  readonly kind: 'timestamp' | 'random-id'
  readonly regex: RegExp
  readonly description: string
}

/**
 * 易变模式注册表(唯一 ID → 模式)。同类内最长优先;跨类无交互
 * (时间戳先归一化,占位符不含 [0-9a-f] 不会二次命中 ID 模式)。
 */
export const VOLATILE_PATTERNS: readonly VolatilePattern[] = [
  { id: 'epoch-millis', kind: 'timestamp', regex: /\b1[6-9]\d{11}\b/g, description: 'Unix 毫秒时间戳(13 位,2020-2033)' },
  { id: 'epoch-seconds', kind: 'timestamp', regex: /\b1[6-9]\d{8}\b/g, description: 'Unix 秒时间戳(10 位,2020-2033)' },
  {
    id: 'iso-datetime',
    kind: 'timestamp',
    regex: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    description: 'ISO 8601 日期时间',
  },
  { id: 'date-only', kind: 'timestamp', regex: /\b\d{4}-\d{2}-\d{2}\b/g, description: 'ISO 日期(YYYY-MM-DD)' },
  { id: 'zh-datetime', kind: 'timestamp', regex: /\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/g, description: '中文日期时间' },
  { id: 'time-only', kind: 'timestamp', regex: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g, description: '时分(秒)时间' },
  {
    id: 'uuid',
    kind: 'random-id',
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
    description: 'UUID v1-v5(小写 hex)',
  },
  { id: 'hex-token', kind: 'random-id', regex: /\b[0-9a-f]{12,}\b/g, description: '≥12 位 hex token(会话/请求随机 ID 常见形态)' },
  {
    id: 'alnum-id',
    kind: 'random-id',
    regex: /\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*[g-z])[a-z0-9]{16,}\b/gi,
    description: '≥16 位混合字母数字且含非 hex 字母的 token(nanoid/base62 随机 ID 常见形态)',
  },
]

/** 单个易变 token 命中(值 + 来源模式)。 */
export interface VolatileMatch {
  readonly pattern: string
  readonly kind: 'timestamp' | 'random-id'
  readonly value: string
}

/**
 * 按出现序提取文本中全部易变 token 命中。
 * 跨模式重叠命中(uuid 内的 hex 尾段、hex 串上的 base62)按「长跨优先,同长注册表序」
 * 去重——一个 span 只归一个模式,保证归因证据不重复计数。
 */
export function extractVolatileMatches(text: string): VolatileMatch[] {
  interface Span {
    readonly match: VolatileMatch
    readonly start: number
    readonly end: number
    readonly order: number
  }
  const spans: Span[] = []
  let order = 0
  for (const pattern of VOLATILE_PATTERNS) {
    for (const hit of text.matchAll(pattern.regex)) {
      const value = hit[0]
      const start = hit.index
      spans.push({ match: { pattern: pattern.id, kind: pattern.kind, value }, start, end: start + value.length, order })
      order += 1
    }
  }
  // 长跨优先占位;同长按注册表序(先 uuid 后 hex 等)。
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.order - b.order)
  const kept: Span[] = []
  for (const span of spans) {
    if (kept.some(k => span.start < k.end && k.start < span.end)) continue
    kept.push(span)
  }
  kept.sort((a, b) => a.start - b.start)
  return kept.map(span => span.match)
}

/** 把一类(kind)易变 token 全部替换为占位符后的文本(归一化视图)。 */
function normalize(text: string, kind: 'timestamp' | 'random-id'): string {
  let normalized = text
  for (const pattern of VOLATILE_PATTERNS) {
    if (pattern.kind !== kind) continue
    normalized = normalized.replace(pattern.regex, () => `<${kind}:${pattern.id}>`)
  }
  return normalized
}

/** 变动归因结果。 */
export interface VolatilityClassification {
  readonly kind: 'volatile-timestamp' | 'volatile-random-id'
  /** 值发生变动的模式 id 列表(按首次出现序去重)。 */
  readonly patterns: readonly string[]
  /** 变动前的易变 token 值(截窗)。 */
  readonly before: string
  /** 变动后的易变 token 值(截窗)。 */
  readonly after: string
}

/**
 * 归一化等价判定(容忍纯尾部追加/截尾):「整段替换后相等」或
 * 「短侧归一化是长侧归一化的前缀」都算等价——后者覆盖单段整 prompt 场景
 * (段头注入时间戳 + 段尾 append-only 追加,差异既有易变 token 又有新增尾部;
 * 新增尾部不动前缀,不应把归因顶掉)。
 */
function normalizedEqual(before: string, after: string, kind: 'timestamp' | 'random-id'): boolean {
  const a = normalize(before, kind)
  const b = normalize(after, kind)
  if (a === b) return true
  if (a.length <= b.length) return a === b.slice(0, a.length)
  return b === a.slice(0, b.length)
}

/**
 * 归因两段同源文本的差异:差异完全落在时间戳 token 上(±纯尾部增删)→ volatile-timestamp;
 * 完全落在随机 ID token 上(±纯尾部增删)→ volatile-random-id;两类都涉及 → 归时间戳为主类
 * (时间戳是最常见且最易修的失稳源),patterns 同时列出两类;无法归因 → null。
 * before === after 时返回 null。
 */
export function classifyVolatility(before: string, after: string): VolatilityClassification | null {
  if (before === after) return null
  const tsTouched = extractVolatileMatches(before).some(m => m.kind === 'timestamp')
    || extractVolatileMatches(after).some(m => m.kind === 'timestamp')
  const idTouched = extractVolatileMatches(before).some(m => m.kind === 'random-id')
    || extractVolatileMatches(after).some(m => m.kind === 'random-id')

  let kind: 'volatile-timestamp' | 'volatile-random-id' | null = null
  if (tsTouched && normalizedEqual(before, after, 'timestamp')) {
    kind = 'volatile-timestamp'
  } else if (idTouched && normalizedEqual(before, after, 'random-id')) {
    kind = 'volatile-random-id'
  } else if (
    (tsTouched || idTouched)
    && normalizedEqual(normalize(before, 'timestamp'), normalize(after, 'timestamp'), 'random-id')
  ) {
    kind = 'volatile-timestamp'
  }
  if (kind === null) return null

  const beforeMatches = extractVolatileMatches(before)
  const afterMatches = extractVolatileMatches(after)
  const patterns: string[] = []
  const changedBefore: string[] = []
  const changedAfter: string[] = []
  const width = Math.max(beforeMatches.length, afterMatches.length)
  for (let i = 0; i < width; i += 1) {
    const b = beforeMatches[i]
    const a = afterMatches[i]
    if (b?.value === a?.value) continue
    for (const m of [b, a]) {
      if (m !== undefined && !patterns.includes(m.pattern)) patterns.push(m.pattern)
    }
    if (b !== undefined) changedBefore.push(b.value)
    if (a !== undefined) changedAfter.push(a.value)
  }
  if (patterns.length === 0) return null
  return {
    kind,
    patterns,
    before: changedBefore.join(', ').slice(0, 80),
    after: changedAfter.join(', ').slice(0, 80),
  }
}
