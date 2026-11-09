/**
 * SKILL.md 条目解析器(ACE 条目化,设计 10 §4.1 / D2 决议)。
 *
 * 条目化约定(与 @eterna/packctl 的 SKILL0xx lint 同一套口径,双向配对):
 * - frontmatter `metadata.evo.entries[]`:每条 { id, helpful, harmful, updated, origin?, … };
 * - 正文条目锚点:`<!-- E: S-xxx-001 -->` … `<!-- /E -->`(HTML 注释对人无扰,对工具可解析);
 * - deprecate 后的条目移入文末「已废弃」归档节,frontmatter 中保留
 *   `deprecated: true + deprecated_at`(packctl 配对仍成立,溯源不丢)。
 *
 * 本模块是纯函数层:parse(文本) → SkillDoc;render(SkillDoc) → 文本;
 * deltas.ts 的五种 delta 作用在 SkillDoc 上。生成物必须原样通过 packctl lint
 * (G0 门禁消费的是同一套解析口径,见 tests/e2e)。
 */
import { parse as parseYamlLib, stringify } from 'yaml'

/** frontmatter `metadata.evo.entries[]` 单条计数器元数据(ACE 口径 + 废弃扩展)。 */
export interface EvoEntryMeta {
  readonly id: string
  readonly helpful: number
  readonly harmful: number
  /** YYYY-MM-DD;计数器/正文最近一次变动。 */
  readonly updated: string
  /** 血缘:来源 case/信号(如 "case-042+case-047")。 */
  readonly origin?: string
  /** merge_entries 落点:被并入本条的来源 id。 */
  readonly mergedFrom?: readonly string[]
  /** deprecate_entry 落点:废弃时间(归档节保留 30 天后物理移除)。 */
  readonly deprecatedAt?: string
  /** deprecate/merge 的替代者(可选;supersession 链的 skill 侧投影)。 */
  readonly supersededBy?: string
}

/** 解析出的单个条目(frontmatter 元数据 + 正文切片 + 锚点区间)。 */
export interface SkillEntry {
  readonly meta: EvoEntryMeta
  /** 锚点内的正文(不含锚点注释行本身)。 */
  readonly body: string
  readonly deprecated: boolean
  /** 锚点开标记在 body 中的起始偏移(render 时做字符串手术用)。 */
  readonly start: number
  /** 闭合锚点行尾(含换行)在 body 中的结束偏移(不含)。 */
  readonly end: number
}

/** 解析产物:frontmatter 原样对象(deltas 只改 metadata.evo.entries)+ 正文 + 条目表。 */
export interface SkillDoc {
  readonly name: string
  readonly description: string
  /** frontmatter 全量(未知字段原样保留;键序稳定,render 时不丢字段)。 */
  readonly frontmatter: Record<string, unknown>
  /** 正文(frontmatter 之后;含锚点与全部原始排版)。 */
  readonly body: string
  /** 正文锚点与 frontmatter 双向配对后的条目(含已废弃)。 */
  readonly entries: readonly SkillEntry[]
}

export type ParseResult = { readonly ok: true; readonly doc: SkillDoc } | { readonly ok: false; readonly error: string }

/** 归档节标题(deprecate_entry 移入;add_entry 永不落入其后)。 */
export const ARCHIVE_HEADING = '## 已废弃(Evo Archive)'

const OPEN_RE = /<!--\s*E:\s*([^\s>]+?)\s*-->/
const CLOSE_MARKER = '<!-- /E -->'

/** 单个锚点块在正文中的完整区间(deltas 做字符串手术的定位基准;每次操作现扫,不信缓存)。 */
export interface AnchorSpan {
  readonly id: string
  readonly closed: boolean
  readonly openStart: number
  /** 闭合锚点行尾(含换行)的结束偏移。 */
  readonly closeEnd: number
  /** 锚点内正文区间(开标记行尾之后 → 闭合标记行首之前)。 */
  readonly innerStart: number
  readonly innerEnd: number
}

/** 扫描正文中全部锚点块(id 唯一性由 parseSkillDoc 保证;这里只做定位)。 */
export function scanAnchorSpans(body: string): readonly AnchorSpan[] {
  const spans: AnchorSpan[] = []
  const openRe = new RegExp(OPEN_RE.source, 'g')
  for (const match of body.matchAll(openRe)) {
    const openStart = match.index
    const openLineEnd = body.indexOf('\n', openStart)
    if (openLineEnd < 0) {
      spans.push({ id: match[1] ?? '', closed: false, openStart, closeEnd: body.length, innerStart: body.length, innerEnd: body.length })
      continue
    }
    const closeIndex = body.indexOf(CLOSE_MARKER, openLineEnd)
    const nextOpen = body.slice(openLineEnd).search(new RegExp(OPEN_RE.source))
    const nextOpenAbs = nextOpen < 0 ? body.length : openLineEnd + nextOpen
    if (closeIndex < 0 || closeIndex >= nextOpenAbs) {
      spans.push({ id: match[1] ?? '', closed: false, openStart, closeEnd: body.length, innerStart: body.length, innerEnd: body.length })
      continue
    }
    let closeEnd = closeIndex + CLOSE_MARKER.length
    if (body[closeEnd] === '\n') closeEnd += 1
    spans.push({ id: match[1] ?? '', closed: true, openStart, closeEnd, innerStart: openLineEnd + 1, innerEnd: closeIndex })
  }
  return spans
}

/** 解析 SKILL.md 文本;锚点未闭合/配对失败/计数字段非法 → ok:false(fail-closed,不给半成品 doc)。 */
export function parseSkillDoc(text: string): ParseResult {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { ok: false, error: '首行不是 --- frontmatter 围栏' }
  const fenceEnd = normalized.indexOf('\n---\n', 4)
  if (fenceEnd < 0) return { ok: false, error: 'frontmatter 围栏未闭合(缺少结束 ---)' }
  const fmText = normalized.slice(4, fenceEnd)
  const body = normalized.slice(fenceEnd + '\n---\n'.length)

  let fm: unknown
  try {
    fm = parseYamlLib(fmText)
  } catch (cause) {
    return { ok: false, error: `frontmatter YAML 解析失败: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) {
    return { ok: false, error: 'frontmatter 顶层不是映射' }
  }
  return pairEntries(fm as Record<string, unknown>, body)
}

/**
 * frontmatter 对象 + 正文 → SkillDoc(deltas 的统一收尾:每个 delta 改完
 * entries 数组与正文后必须过这里重新配对校验,保证产物始终是可 lint 的完整文档)。
 */
export function pairEntries(frontmatter: Record<string, unknown>, body: string): ParseResult {
  const name = frontmatter['name']
  if (typeof name !== 'string' || name.length === 0) return { ok: false, error: 'frontmatter.name 缺失' }
  const description = frontmatter['description']
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { ok: false, error: 'frontmatter.description 缺失或为空(触发词维护重点)' }
  }

  const metas = readEntryMetas(frontmatter)
  for (const issue of metas.issues) return { ok: false, error: issue }

  const anchors = scanAnchorSpans(body)
  const seen = new Set<string>()
  for (const id of anchors.map(a => a.id)) {
    if (seen.has(id)) return { ok: false, error: `锚点 id "${id}" 在正文中出现多次` }
    seen.add(id)
  }
  for (const anchor of anchors) {
    if (!anchor.closed) return { ok: false, error: `锚点 <!-- E: ${anchor.id} --> 缺少闭合 ${CLOSE_MARKER}` }
    if (!metas.entries.some(m => m.id === anchor.id)) {
      return { ok: false, error: `正文锚点 "${anchor.id}" 在 metadata.evo.entries 中没有对应条目` }
    }
  }
  for (const meta of metas.entries) {
    if (!anchors.some(a => a.id === meta.id)) {
      return { ok: false, error: `metadata.evo.entries 条目 "${meta.id}" 在正文中没有 <!-- E: … --> 锚点` }
    }
  }

  const archiveStart = body.indexOf(ARCHIVE_HEADING)
  const entries: SkillEntry[] = anchors.map((anchor) => {
    const meta = metas.entries.find(m => m.id === anchor.id)
    // 上方配对检查已保证存在;这里只做类型收窄。
    return toEntry(meta as EvoEntryMeta, anchor, body, archiveStart)
  })
  return {
    ok: true,
    doc: { name, description, frontmatter, body, entries },
  }
}

/** 当前有效条目(检索/注入面只看它 —— bi-temporal「逻辑不可见」的 skill 侧投影)。 */
export function activeEntries(doc: SkillDoc): readonly SkillEntry[] {
  return doc.entries.filter(e => !e.deprecated)
}

/** 归档条目(deprecated;物理还在,审计/溯源用)。 */
export function archivedEntries(doc: SkillDoc): readonly SkillEntry[] {
  return doc.entries.filter(e => e.deprecated)
}

/** render:frontmatter(YAML 序列化,键序保持)+ 正文原样拼接。 */
export function renderSkillDoc(doc: SkillDoc): string {
  const fmYaml = stringify(doc.frontmatter, { lineWidth: 0 })
  return `---\n${fmYaml}---\n${doc.body}`
}

/** 重新生成条目 id:`S-<skill-kebab>-<nnn>`,序号 = 同前缀现存最大 +1(不回收)。 */
export function nextEntryId(doc: SkillDoc): string {
  const prefix = `S-${doc.name}`
  let max = 0
  for (const entry of doc.entries) {
    if (!entry.meta.id.startsWith(`${prefix}-`)) continue
    const tail = entry.meta.id.slice(prefix.length + 1)
    const n = /^0*\d+$/.test(tail) ? Number.parseInt(tail, 10) : Number.NaN
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

/** 深拷贝 doc(deltas 的输入不变性:纯函数返回新对象,原 doc 不被改写)。 */
export function cloneDoc(doc: SkillDoc): SkillDoc {
  const frontmatter = structuredClone(doc.frontmatter)
  return { ...doc, frontmatter, entries: doc.entries.map(e => ({ ...e, meta: { ...e.meta } })) }
}

// ── 内部 ────────────────────────────────────────────────────────────────────

function toEntry(meta: EvoEntryMeta, anchor: AnchorSpan, source: string, archiveStart: number): SkillEntry {
  const deprecated = meta.deprecatedAt !== undefined
    || (archiveStart >= 0 && anchor.openStart > archiveStart)
  return {
    meta,
    // 条目正文 = 锚点内文本,去尾换行(写入时 replaceInner 会补回闭合标记前的换行)。
    body: anchor.closed ? source.slice(anchor.innerStart, anchor.innerEnd).trimEnd() : '',
    deprecated,
    start: anchor.openStart,
    end: anchor.closeEnd,
  }
}

function readEntryMetas(frontmatter: Record<string, unknown>): { entries: readonly EvoEntryMeta[]; issues: readonly string[] } {
  const metadata = frontmatter['metadata']
  if (metadata === undefined) return { entries: [], issues: [] }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return { entries: [], issues: ['metadata 必须是映射(DSH 原生自由字段)'] }
  }
  const evo = (metadata as Record<string, unknown>)['evo']
  if (evo === undefined) return { entries: [], issues: [] }
  if (typeof evo !== 'object' || evo === null || Array.isArray(evo)) {
    return { entries: [], issues: ['metadata.evo 必须是映射'] }
  }
  const rawEntries = (evo as Record<string, unknown>)['entries']
  if (rawEntries === undefined) return { entries: [], issues: [] }
  if (!Array.isArray(rawEntries)) return { entries: [], issues: ['metadata.evo.entries 必须是数组'] }
  const entries: EvoEntryMeta[] = []
  for (const item of rawEntries) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { entries: [], issues: ['metadata.evo.entries 每条必须是映射'] }
    }
    const row = item as Record<string, unknown>
    const id = row['id']
    if (typeof id !== 'string' || id.length === 0) return { entries: [], issues: ['metadata.evo.entries 每条必须有非空字符串 id'] }
    const helpful = row['helpful'] ?? 0
    const harmful = row['harmful'] ?? 0
    if (typeof helpful !== 'number' || helpful < 0 || typeof harmful !== 'number' || harmful < 0) {
      return { entries: [], issues: [`条目 "${id}" 的 helpful/harmful 计数器必须是非负数`] }
    }
    const updated = row['updated']
    if (updated !== undefined && typeof updated !== 'string') {
      return { entries: [], issues: [`条目 "${id}" 的 updated 必须是字符串(YYYY-MM-DD)`] }
    }
    const mergedFrom = row['merged_from']
    if (mergedFrom !== undefined && (!Array.isArray(mergedFrom) || mergedFrom.some(v => typeof v !== 'string'))) {
      return { entries: [], issues: [`条目 "${id}" 的 merged_from 必须是字符串数组`] }
    }
    entries.push({
      id,
      helpful,
      harmful,
      updated: typeof updated === 'string' ? updated : '1970-01-01',
      ...(typeof row['origin'] === 'string' ? { origin: row['origin'] } : {}),
      ...(Array.isArray(mergedFrom) ? { mergedFrom: [...(mergedFrom as string[])] } : {}),
      ...(typeof row['deprecated_at'] === 'string' ? { deprecatedAt: row['deprecated_at'] } : {}),
      ...(typeof row['superseded_by'] === 'string' ? { supersededBy: row['superseded_by'] } : {}),
    })
  }
  return { entries, issues: [] }
}

