/**
 * 五种 skill delta 纯函数(设计 10 §4.1 delta 操作集;提案即操作列表,非重写):
 *   add_entry / update_entry / bump_counter / deprecate_entry / merge_entries
 *
 * 全部 (doc, op) → { ok, doc?, error? }:纯函数、输入 doc 不被改写、失败 fail-closed
 * 返回错误字符串。落点:
 * - metadata.evo.entries:计数器/血缘/废弃标记(camelCase 内存态 ↔ snake_case YAML 键);
 * - 锚点正文:<!-- E: id -->…<!-- /E --> 区间的字符串手术,其余正文排版原样保留。
 *
 * 实现纪律:每次操作用 scanAnchorSpans 现扫定位(不信链式操作前的缓存偏移);
 * 改完统一过 pairEntries 重新配对校验 —— 产物必然是可被 packctl lint 的完整文档
 * (G0 门禁同一口径,tests/e2e 端到端钉住)。
 */
import { cloneDoc, pairEntries, scanAnchorSpans, ARCHIVE_HEADING } from './entry.ts'
import type { AnchorSpan, EvoEntryMeta, SkillDoc } from './entry.ts'

export interface AddEntryOp {
  readonly type: 'add_entry'
  /** 新条目 id;缺省自动生成 S-<skill>-<nnn>(同前缀最大序号 +1,不回收)。 */
  readonly id?: string
  /** 条目正文(锚点内文本;不含锚点注释)。 */
  readonly body: string
  /** 血缘:来源 case/信号 id(如 "case-042+case-047")。 */
  readonly origin?: string
  /** 插入到该条目(锚点闭合)之后;缺省追加到活跃区末尾(归档节之前)。 */
  readonly after?: string
  readonly date: string
}

export interface UpdateEntryOp {
  readonly type: 'update_entry'
  readonly id: string
  /** 改写后的条目正文。 */
  readonly body: string
  readonly date: string
}

export interface BumpCounterOp {
  readonly type: 'bump_counter'
  readonly id: string
  readonly counter: 'helpful' | 'harmful'
  /** 增量,默认 1(负数用于纠错,结果 clamp 到 ≥0)。 */
  readonly by?: number
  readonly date: string
}

export interface DeprecateEntryOp {
  readonly type: 'deprecate_entry'
  readonly id: string
  readonly date: string
  /** 替代者条目 id(可选;supersession 链)。 */
  readonly supersededBy?: string
  /** 废弃理由(prompt-audit finding 的复述,只进提案描述,不改正文)。 */
  readonly reason?: string
}

export interface MergeEntriesOp {
  readonly type: 'merge_entries'
  /** 并入目标条目(保留其 id)。 */
  readonly into: string
  /** 被并入条目(合并后从 entries 与正文移除)。 */
  readonly from: readonly string[]
  /** 合并后正文;缺省 = 目标正文 + 各来源正文空行连接(语义去重由提案方保证)。 */
  readonly body?: string
  readonly date: string
}

export type SkillDelta = AddEntryOp | UpdateEntryOp | BumpCounterOp | DeprecateEntryOp | MergeEntriesOp

export type DeltaResult = { readonly ok: true; readonly doc: SkillDoc } | { readonly ok: false; readonly error: string }

// ── apply 入口(可组合:提案即操作列表)────────────────────────────────────

/** 顺序应用一组 delta;首个失败即停(fail-closed,不产出半应用产物)。 */
export function applyDeltas(doc: SkillDoc, ops: readonly SkillDelta[]): DeltaResult {
  let current = cloneDoc(doc)
  for (const op of ops) {
    const applied = applyDelta(current, op)
    if (!applied.ok) return applied
    current = applied.doc
  }
  return { ok: true, doc: current }
}

export function applyDelta(doc: SkillDoc, op: SkillDelta): DeltaResult {
  switch (op.type) {
    case 'add_entry': return addEntry(doc, op)
    case 'update_entry': return updateEntry(doc, op)
    case 'bump_counter': return bumpCounter(doc, op)
    case 'deprecate_entry': return deprecateEntry(doc, op)
    case 'merge_entries': return mergeEntries(doc, op)
  }
}

// ── 五个纯函数 ─────────────────────────────────────────────────────────────

function addEntry(doc: SkillDoc, op: AddEntryOp): DeltaResult {
  if (op.body.trim().length === 0) return { ok: false, error: 'add_entry:条目正文不能为空' }
  const metas = metasOf(doc)
  const id = op.id ?? nextId(doc)
  if (metas.some(m => m.id === id)) {
    return { ok: false, error: `add_entry:条目 id "${id}" 已存在(ACE 条目 id 不可复用)` }
  }
  const spans = scanAnchorSpans(doc.body)
  let insertAt: number
  if (op.after !== undefined) {
    const after = spans.find(s => s.id === op.after)
    if (after === undefined) return { ok: false, error: `add_entry:after 条目 "${op.after}" 不存在` }
    if (isArchived(doc, op.after)) {
      return { ok: false, error: `add_entry:after 条目 "${op.after}" 已废弃,新条目不得插入归档节` }
    }
    insertAt = after.closeEnd
  } else {
    const archive = doc.body.indexOf(ARCHIVE_HEADING)
    insertAt = archive >= 0 ? archive : doc.body.length
  }
  const block = `<!-- E: ${id} -->\n${op.body.trimEnd()}\n<!-- /E -->\n`
  const sep = insertAt > 0 && doc.body[insertAt - 1] !== '\n' ? '\n' : ''
  const body = doc.body.slice(0, insertAt) + sep + block + doc.body.slice(insertAt)
  const nextMetas: EvoEntryMeta[] = [...metas, {
    id,
    helpful: 0,
    harmful: 0,
    updated: op.date,
    ...(op.origin !== undefined && op.origin.length > 0 ? { origin: op.origin } : {}),
  }]
  return finalize(doc, nextMetas, body)
}

function updateEntry(doc: SkillDoc, op: UpdateEntryOp): DeltaResult {
  if (op.body.trim().length === 0) return { ok: false, error: 'update_entry:条目正文不能为空' }
  const existing = doc.entries.find(e => e.meta.id === op.id)
  if (existing === undefined) return { ok: false, error: `update_entry:条目 "${op.id}" 不存在` }
  if (existing.deprecated) {
    return { ok: false, error: `update_entry:条目 "${op.id}" 已废弃,不再改写(先新增替代条目或走归档物理移除)` }
  }
  const span = spanOf(doc.body, op.id)
  if (span === undefined) return { ok: false, error: `update_entry:条目 "${op.id}" 锚点定位失败(内部错误)` }
  const body = replaceInner(doc.body, span, op.body.trimEnd())
  const metas = metasOf(doc).map(m => m.id === op.id ? { ...m, updated: op.date } : m)
  return finalize(doc, metas, body)
}

function bumpCounter(doc: SkillDoc, op: BumpCounterOp): DeltaResult {
  const existing = doc.entries.find(e => e.meta.id === op.id)
  if (existing === undefined) return { ok: false, error: `bump_counter:条目 "${op.id}" 不存在` }
  const by = op.by ?? 1
  const metas = metasOf(doc).map((m) => {
    if (m.id !== op.id) return m
    return { ...m, [op.counter]: Math.max(0, m[op.counter] + by), updated: op.date }
  })
  return finalize(doc, metas, doc.body)
}

function deprecateEntry(doc: SkillDoc, op: DeprecateEntryOp): DeltaResult {
  const existing = doc.entries.find(e => e.meta.id === op.id)
  if (existing === undefined) return { ok: false, error: `deprecate_entry:条目 "${op.id}" 不存在` }
  if (existing.deprecated) {
    return { ok: false, error: `deprecate_entry:条目 "${op.id}" 已是废弃状态(幂等拒绝,避免重复归档)` }
  }
  if (op.supersededBy !== undefined && !doc.entries.some(e => e.meta.id === op.supersededBy)) {
    return { ok: false, error: `deprecate_entry:superseded_by 条目 "${op.supersededBy}" 不存在` }
  }

  // 1) 从原位剪出锚点块(块前空行一并剪掉,不留孤儿空行)。
  const span = spanOf(doc.body, op.id)
  if (span === undefined) return { ok: false, error: `deprecate_entry:条目 "${op.id}" 锚点定位失败(内部错误)` }
  const cutFrom = lineStartOf(doc.body, span.openStart)
  const block = doc.body.slice(cutFrom, span.closeEnd).trimEnd()
  let body = doc.body.slice(0, cutFrom) + doc.body.slice(span.closeEnd)

  // 2) 归档节:已存在则块挂节尾,不存在则文末新建(保留 30 天后物理移除,归档≠删除)。
  if (body.includes(ARCHIVE_HEADING)) {
    body = `${body.endsWith('\n') || body.length === 0 ? body : `${body}\n`}${block}\n`
  } else {
    body = `${body.endsWith('\n') || body.length === 0 ? body : `${body}\n`}\n${ARCHIVE_HEADING}\n\n${block}\n`
  }

  const metas = metasOf(doc).map(m =>
    m.id === op.id
      ? {
        ...m,
        deprecatedAt: op.date,
        ...(op.supersededBy !== undefined ? { supersededBy: op.supersededBy } : {}),
      }
      : m)
  return finalize(doc, metas, body)
}

function mergeEntries(doc: SkillDoc, op: MergeEntriesOp): DeltaResult {
  if (op.from.length === 0) return { ok: false, error: 'merge_entries:from 不能为空' }
  if (op.from.includes(op.into)) return { ok: false, error: `merge_entries:from 不得包含目标自身("${op.into}")` }
  const target = doc.entries.find(e => e.meta.id === op.into)
  if (target === undefined) return { ok: false, error: `merge_entries:目标条目 "${op.into}" 不存在` }
  for (const id of op.from) {
    if (!doc.entries.some(e => e.meta.id === id)) {
      return { ok: false, error: `merge_entries:来源条目 "${id}" 不存在` }
    }
  }

  const mergedBody = (op.body
    ?? [target.body, ...op.from.map(id => doc.entries.find(e => e.meta.id === id)?.body ?? '')]
      .filter(b => b.trim().length > 0)
      .join('\n\n')).trimEnd()

  // 1) 按偏移降序剪除来源块(后往前剪,偏移不漂移;已废弃来源同样收敛)。
  const spans = op.from
    .map(id => spanOf(doc.body, id))
    .filter((s): s is AnchorSpan => s !== undefined)
    .sort((a, b) => b.openStart - a.openStart)
  let body = doc.body
  for (const span of spans) {
    const cutFrom = lineStartOf(body, span.openStart)
    body = body.slice(0, cutFrom) + body.slice(span.closeEnd)
  }

  // 2) 目标块正文替换为合并正文(剪除后现扫定位)。
  const targetSpan = spanOf(body, op.into)
  if (targetSpan === undefined) return { ok: false, error: `merge_entries:目标条目 "${op.into}" 锚点定位失败(内部错误)` }
  body = replaceInner(body, targetSpan, mergedBody)

  // 3) entries 收敛:目标计数器求和、血缘并入 merged_from、origin 取并集、来源移除。
  const removed = new Set(op.from)
  const sourceMetas = doc.entries.filter(e => removed.has(e.meta.id)).map(e => e.meta)
  const helpful = target.meta.helpful + sourceMetas.reduce((acc, m) => acc + m.helpful, 0)
  const harmful = target.meta.harmful + sourceMetas.reduce((acc, m) => acc + m.harmful, 0)
  const origins = [target.meta.origin, ...sourceMetas.map(m => m.origin)].filter((v): v is string => v !== undefined && v.length > 0)
  const metas = metasOf(doc)
    .filter(m => !removed.has(m.id))
    .map((m) => {
      if (m.id !== op.into) return m
      return {
        ...m,
        helpful,
        harmful,
        updated: op.date,
        ...(origins.length > 0 ? { origin: [...new Set(origins)].join('+') } : {}),
        mergedFrom: [...new Set([...(m.mergedFrom ?? []), ...op.from])],
      }
    })
  return finalize(doc, metas, body)
}

// ── 元数据读写(camelCase 内存态 ↔ frontmatter snake_case YAML 键)────────

type FmEntry = Record<string, unknown>

/** 条目元数据数组(camelCase 内存态;源自 parse 的 doc.entries,不重读 YAML 行)。 */
function metasOf(doc: SkillDoc): EvoEntryMeta[] {
  return doc.entries.map(e => e.meta)
}

/** 把元数据数组写回克隆的 frontmatter 并重新配对校验(deltas 统一收尾)。 */
function finalize(doc: SkillDoc, metas: readonly EvoEntryMeta[], body: string): DeltaResult {
  const frontmatter = structuredClone(doc.frontmatter)
  const metadataRaw = frontmatter['metadata']
  const metadata = typeof metadataRaw === 'object' && metadataRaw !== null && !Array.isArray(metadataRaw)
    ? metadataRaw as Record<string, unknown>
    : {}
  const evoRaw = metadata['evo']
  const evo = typeof evoRaw === 'object' && evoRaw !== null && !Array.isArray(evoRaw)
    ? evoRaw as Record<string, unknown>
    : {}
  evo['entries'] = metas.map(toRow)
  metadata['evo'] = evo
  frontmatter['metadata'] = metadata
  const paired = pairEntries(frontmatter, body)
  if (!paired.ok) return { ok: false, error: paired.error }
  return { ok: true, doc: paired.doc }
}

function toRow(meta: EvoEntryMeta): FmEntry {
  return {
    id: meta.id,
    helpful: meta.helpful,
    harmful: meta.harmful,
    updated: meta.updated,
    ...(meta.origin !== undefined && meta.origin.length > 0 ? { origin: meta.origin } : {}),
    ...(meta.mergedFrom !== undefined && meta.mergedFrom.length > 0 ? { merged_from: [...meta.mergedFrom] } : {}),
    ...(meta.deprecatedAt !== undefined ? { deprecated_at: meta.deprecatedAt } : {}),
    ...(meta.supersededBy !== undefined && meta.supersededBy.length > 0 ? { superseded_by: meta.supersededBy } : {}),
  }
}

// ── 字符串手术工具(每次操作现扫,不信缓存偏移)───────────────────────────

function spanOf(body: string, id: string): AnchorSpan | undefined {
  return scanAnchorSpans(body).find(s => s.id === id && s.closed)
}

function replaceInner(body: string, span: AnchorSpan, inner: string): string {
  return body.slice(0, span.innerStart) + `${inner.trimEnd()}\n` + body.slice(span.innerEnd)
}

/** 锚点行首(所在行行首偏移)。 */
function lineStartOf(body: string, offset: number): number {
  return offset === 0 ? 0 : body.lastIndexOf('\n', offset - 1) + 1
}

function isArchived(doc: SkillDoc, id: string): boolean {
  return doc.entries.find(e => e.meta.id === id)?.deprecated ?? false
}

function nextId(doc: SkillDoc): string {
  const prefix = `S-${doc.name}-`
  let max = 0
  for (const entry of doc.entries) {
    if (!entry.meta.id.startsWith(prefix)) continue
    const tail = entry.meta.id.slice(prefix.length)
    if (/^0*\d+$/.test(tail)) {
      const n = Number.parseInt(tail, 10)
      if (n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}
