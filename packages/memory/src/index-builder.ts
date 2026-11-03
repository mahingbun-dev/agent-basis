/**
 * 记忆索引构建(systemPrompt 注入载荷,渐进披露)。
 *
 * 设计依据(设计文档 08 §5.3):
 * - 会话启动时 system-prompt section 只注入**记忆索引**——M2 live 记录的
 *   key + 一句话摘要,预算 ≤500 token(度量衡见 tokens.ts);
 * - 正文按需 memory_read(与 DSH skills「frontmatter 常驻、body 按需」同构);
 * - 排序:confidence DESC → updated_at DESC(高置信、新近者优先入索引)。
 *
 * 装配预算时 header/lines/footer 一并计入;装不下的条目计入 omitted,
 * footer 给出 memory_search 提示——索引是检索的入口,不是正文的容器。
 */
import type { EntityRecord } from './entity-store.ts'
import { MEMORY_INDEX_BUDGET_TOKENS, estimateTokens } from './tokens.ts'

/** 索引构建选项。 */
export interface MemoryIndexOptions {
  /** token 预算上限(默认 500,设计文档 08 §5.3)。 */
  readonly budgetTokens?: number
  /** 单条摘要最大字符数(派生摘要截断用;显式 summary 超长也会截断)。 */
  readonly maxSummaryChars?: number
}

/** 索引构建结果(测试与审计直接消费计数)。 */
export interface MemoryIndexResult {
  /** 注入文本(header + lines + footer)。 */
  readonly text: string
  readonly total: number
  readonly included: number
  readonly omitted: number
  /** 整段文本的 token 估算(≤ budgetTokens)。 */
  readonly estimatedTokens: number
}

const MAX_LINES = 64
const DEFAULT_MAX_SUMMARY_CHARS = 40

/** 构建记忆索引文本:装不下从低优先级端截断,footer 汇报 omitted。 */
export function buildEntityIndex(records: readonly EntityRecord[], options: MemoryIndexOptions = {}): MemoryIndexResult {
  const budget = options.budgetTokens ?? MEMORY_INDEX_BUDGET_TOKENS
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS
  const total = records.length
  if (total === 0) {
    const emptyText = '## 记忆索引\n(暂无长期记忆)'
    return { text: emptyText, total: 0, included: 0, omitted: 0, estimatedTokens: estimateTokens(emptyText) }
  }

  const ranked = [...records].sort(compareForIndex)
  const capped = ranked.slice(0, MAX_LINES)
  const lines = capped.map(record => indexLine(record, maxSummaryChars))
  const omittedBeyondCap = total - capped.length

  let included = lines.length
  let omitted = omittedBeyondCap
  let text = renderIndex(lines, omitted)
  while (estimateTokens(text) > budget && included > 0) {
    included -= 1
    omitted = total - included
    text = renderIndex(lines.slice(0, included), omitted)
  }
  return { text, total, included, omitted, estimatedTokens: estimateTokens(text) }
}

function renderIndex(lines: readonly string[], omitted: number): string {
  const header = '## 记忆索引(key + 一句话摘要;正文用 memory_read 按需读取)'
  const body = lines.length > 0 ? lines.join('\n') : '(预算内无可展示条目,用 memory_search 检索)'
  const footer = omitted > 0
    ? `(+${omitted} 条未列出:用 memory_search 检索、memory_read 读正文)`
    : '检索用 memory_search;撤销记忆用 memory_forget(真删)'
  return `${header}\n${body}\n${footer}`
}

function indexLine(record: EntityRecord, maxSummaryChars: number): string {
  const summary = summarize(record, maxSummaryChars)
  const confidence = record.confidence.toFixed(2)
  return `- [${record.subject}] ${record.key} — ${summary} (conf ${confidence})`
}

/** 一句话摘要:显式 summary 优先,缺省从 content 派生(首句,截断加省略号)。 */
function summarize(record: EntityRecord, maxSummaryChars: number): string {
  const source = record.summary ?? record.content
  const firstClause = source.split(/[。!?\uFF1B;\n]/u)[0]?.trim() ?? ''
  const chars = Array.from(firstClause)
  return chars.length <= maxSummaryChars ? firstClause : `${chars.slice(0, maxSummaryChars).join('')}…`
}

/** 索引排序:confidence DESC → updated_at DESC → id DESC(稳定)。 */
function compareForIndex(a: EntityRecord, b: EntityRecord): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return b.id - a.id
}
