/**
 * markdown wiki 页面解析与序列化(设计文档 11 §3.1:一页一文件,frontmatter 元数据,[[wikilink]] 建图,changelog 段)。
 *
 * frontmatter 字段:title/tags/status/trust/review/source/created/updated/valid_at/last_verified/superseded_by/id。
 * 解析失败(缺 frontmatter、非法枚举、非法日期、deprecated 无 superseded_by)直接抛 KnowledgeFormatError——
 * 索引器把坏页挡在建库之外,不静默吞。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { KnowledgeFormatError, isRecord } from './errors.ts'
import type { ChangelogEntry, DocStatus, KnowledgeHit, ReviewState, TrustLevel } from './types.ts'

/** 解析后的 frontmatter(全部字段已规范化,枚举/日期校验通过)。 */
export interface WikiFrontmatter {
  readonly title: string
  readonly tags: readonly string[]
  readonly status: DocStatus
  readonly trust: TrustLevel
  readonly review: ReviewState
  /** 权威来源(映射为 provenance.origin)。 */
  readonly source?: string | undefined
  readonly created?: string | undefined
  readonly updated?: string | undefined
  readonly valid_at?: string | undefined
  readonly last_verified?: string | undefined
  /** 废弃必填(deprecated 时)。 */
  readonly superseded_by?: string | undefined
  /** 页面稳定 ID(缺省由文件路径生成)。 */
  readonly id?: string | undefined
}

/** 解析后的完整 wiki 页面。 */
export interface WikiPage {
  readonly frontmatter: WikiFrontmatter
  /** frontmatter 之后的正文(不含定界符)。 */
  readonly body: string
  readonly wikilinks: readonly string[]
  readonly changelog: readonly ChangelogEntry[]
  /** 首个非标题非空行,截 160 字符(检索摘要用)。 */
  readonly snippet: string
}

const STATUSES: readonly DocStatus[] = ['active', 'stale', 'deprecated']
const TRUSTS: readonly TrustLevel[] = ['official', 'verified', 'agent_drafted']
const REVIEWS: readonly ReviewState[] = ['reviewed', 'pending']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
const CHANGELOG_NOTE_RE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2}):\s+(.+)$/
const SNIPPET_MAX = 160

function expectString(field: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new KnowledgeFormatError(`frontmatter.${field} 必须是字符串,实际 ${typeof value}`)
  return value
}

function expectDate(field: string, value: unknown): string | undefined {
  const raw = expectString(field, value)
  if (raw === undefined) return undefined
  if (!DATE_RE.test(raw)) throw new KnowledgeFormatError(`frontmatter.${field} 必须是 YYYY-MM-DD 日期,实际 "${raw}"`)
  return raw
}

function expectEnum<T extends string>(field: string, value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new KnowledgeFormatError(`frontmatter.${field} 必须是 ${allowed.join('|')} 之一,实际 ${JSON.stringify(value)}`)
  }
  return value as T
}

/** 从正文提取 changelog 段条目(`## Changelog` 或 `## 更新记录` 之后、下一个 `## ` 之前)。 */
export function extractChangelog(body: string): readonly ChangelogEntry[] {
  const lines = body.split('\n')
  const entries: ChangelogEntry[] = []
  let inSection = false
  for (const line of lines) {
    if (/^##\s+Changelog\s*$/.test(line) || /^##\s+更新记录\s*$/.test(line)) {
      inSection = true
      continue
    }
    if (inSection && /^##\s+/.test(line)) break
    if (!inSection) continue
    const match = CHANGELOG_NOTE_RE.exec(line)
    if (match) entries.push({ date: match[1] ?? '', note: (match[2] ?? '').trim() })
  }
  return entries
}

/** 提取 [[wikilink]] 目标(建图用;忽略锚点与别名)。 */
export function extractWikilinks(body: string): readonly string[] {
  const out: string[] = []
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim()
    if (target) out.push(target)
  }
  return [...new Set(out)]
}

/** 首个非标题非空行作为摘要。 */
export function extractSnippet(body: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    return trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX)}…` : trimmed
  }
  return ''
}

/** 解析一页 markdown(原文含 frontmatter 定界符)。 */
export function parseWikiPage(raw: string): WikiPage {
  if (!raw.startsWith('---\n')) {
    throw new KnowledgeFormatError('页面缺少 frontmatter 块(必须以 --- 开头)')
  }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) throw new KnowledgeFormatError('frontmatter 块未闭合(缺少结束 ---)')
  const fmRaw = raw.slice(4, end)
  // 归一:剥离定界符后的前导空行(序列化会补一个空行,往返需语义一致)
  const body = raw.slice(end + 5).replace(/^\n+/, '')
  let parsed: unknown
  try {
    parsed = parseYaml(fmRaw)
  } catch (cause) {
    throw new KnowledgeFormatError(`frontmatter YAML 解析失败:${String(cause)}`, { cause })
  }
  if (parsed === undefined || parsed === null) throw new KnowledgeFormatError('frontmatter 不能为空')
  if (!isRecord(parsed)) throw new KnowledgeFormatError('frontmatter 必须是 YAML 映射')

  const title = expectString('title', parsed.title)
  const h1 = /^#\s+(.+)$/.exec(body.split('\n').find(l => l.trim().length > 0) ?? '')
  const resolvedTitle = title ?? (h1 ? (h1[1] ?? '').trim() : undefined)
  if (!resolvedTitle) throw new KnowledgeFormatError('缺少 title(frontmatter.title 或正文一级标题至少一个)')

  const tagsRaw = parsed.tags
  const tags: string[] = []
  if (tagsRaw !== undefined && tagsRaw !== null) {
    if (!Array.isArray(tagsRaw)) throw new KnowledgeFormatError('frontmatter.tags 必须是字符串数组')
    for (const tag of tagsRaw as readonly unknown[]) {
      if (typeof tag !== 'string') throw new KnowledgeFormatError('frontmatter.tags 必须是字符串数组')
      tags.push(tag)
    }
  }

  const status = expectEnum('status', parsed.status, STATUSES) ?? 'active'
  const trust = expectEnum('trust', parsed.trust, TRUSTS) ?? 'official'
  // 评审默认:agent 草稿未标注即 pending(投毒防线:宁可多拦);人写页默认 reviewed。
  const review = expectEnum('review', parsed.review, REVIEWS) ?? (trust === 'agent_drafted' ? 'pending' : 'reviewed')
  const supersededBy = expectString('superseded_by', parsed.superseded_by)
  if (status === 'deprecated' && !supersededBy) {
    throw new KnowledgeFormatError('status=deprecated 的页面必须填 superseded_by(废弃必填)')
  }

  const frontmatter: WikiFrontmatter = {
    title: resolvedTitle,
    tags,
    status,
    trust,
    review,
    source: expectString('source', parsed.source),
    created: expectDate('created', parsed.created),
    updated: expectDate('updated', parsed.updated),
    valid_at: expectDate('valid_at', parsed.valid_at),
    last_verified: expectDate('last_verified', parsed.last_verified),
    superseded_by: supersededBy,
    id: expectString('id', parsed.id),
  }
  return { frontmatter, body, wikilinks: extractWikilinks(body), changelog: extractChangelog(body), snippet: extractSnippet(body) }
}

const FM_KEY_ORDER = [
  'id', 'title', 'tags', 'status', 'trust', 'review', 'source',
  'created', 'updated', 'valid_at', 'last_verified', 'superseded_by',
] as const

/** 序列化回一页 markdown(字段序固定,便于人 diff 与 git 版本化)。 */
export function serializeWikiPage(page: WikiPage): string {
  const fm: Record<string, unknown> = {}
  const values: Record<string, unknown> = {
    id: page.frontmatter.id,
    title: page.frontmatter.title,
    tags: page.frontmatter.tags.length > 0 ? [...page.frontmatter.tags] : undefined,
    status: page.frontmatter.status,
    trust: page.frontmatter.trust,
    review: page.frontmatter.review,
    source: page.frontmatter.source,
    created: page.frontmatter.created,
    updated: page.frontmatter.updated,
    valid_at: page.frontmatter.valid_at,
    last_verified: page.frontmatter.last_verified,
    superseded_by: page.frontmatter.superseded_by,
  }
  for (const key of FM_KEY_ORDER) {
    const value = values[key]
    if (value !== undefined) fm[key] = value
  }
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${page.body.trimEnd()}\n`
}

/** 统一引用输出规范:过期信息在出口处自带警示(设计文档 11 §2.1 双保险之二)。 */
export function formatCitation(hit: KnowledgeHit): string {
  const updated = hit.provenance.updated ?? hit.provenance.valid_at ?? '未知日期'
  const status = hit.provenance.status === 'deprecated' ? '已废弃' : hit.provenance.status === 'stale' ? '待核验' : '生效中'
  const supersede = hit.provenance.superseded_by ? `,已被 ${hit.provenance.superseded_by} 取代` : ''
  return `[《${hit.title}》](${hit.ref.source_uri})(更新于 ${updated};${status}${supersede})`
}
