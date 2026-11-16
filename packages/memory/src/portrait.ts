/**
 * 用户画像 v0(M-M1 T4,19 号 §3-T4 / 18 号 §5)。
 *
 * 画像 = **派生视图,不是第二事实源**:user 层单条 semantic 记忆才是权威(18 §5);
 * 本模块聚合 scope='user' 且 approved 的 live semantic 记录 → Markdown(portrait.md),
 * 两个消费面:glue memory-plugin 每次索引装配现读该缓存注入画像区(≤150 token,
 * index-builder 三区形态)与 M-M3 面板画像卡展示;纠正回路必须落到事实源(改视图
 * 会在下次再生时回弹),不在本模块职责内。
 *
 * 形态:
 * - frontmatter:version(再生成由调用方读旧值 bump)/ generated_at / source_memory_ids[]
 *   (只含实际入选条目——截断丢弃的行不是画像来源,可追溯以「每行必有 id」为准);
 * - 四分节(18 §5 顺序):工作习惯 / 风格偏好 / 协作要求 / 工作区索引
 *   (domain_registry 已转正域投影;候选域不进画像);
 * - 分节归属 v0 用关键词启发式(要求类指令词 → 协作要求;偏好类词 → 风格偏好;
 *   其余 → 工作习惯兜底),M-M3 整固 job 可升级 LLM 归类——纯函数保持确定性,
 *   同输入同输出(单测钉住);
 * - 单节上限 PORTRAIT_MAX_PER_SECTION=10 条(19 号 §3-T4),超出按检索分排序
 *   (与索引同公式:confidence × 2^(−ageDays/halfLifeDays) + 命中强化,18 §4.2)
 *   截断并在节尾注明;
 * - 空 user 层输出「空画像」:四节全占位但正文非空——glue 缓存读取以「剥离
 *   frontmatter 后正文非空」为注入判据(memory-plugin.ts readPortraitCache),
 *   全空文档会被误判省略画像区。
 *
 * 纯函数纪律:不读库不落盘(读库与写文件在 scripts/gen-portrait.mjs 与 M-M3 整固
 * job Prune 阶段);时钟与域投影经 options 注入,不碰全局。
 */
import type { DomainRecord } from './domain.ts'
import type { EntityRecord } from './entity-store.ts'
import { MEMORY_HALF_LIFE_DAYS, memoryRecallScore } from './index-builder.ts'

/** 画像构建选项。 */
export interface PortraitOptions {
  /** domain_registry 投影(工作区索引节;缺省=节内占位;候选域一律忽略)。 */
  readonly domains?: readonly DomainRecord[]
  /** 画像版本(frontmatter version;缺省 1;再生成时由调用方读旧值 bump)。 */
  readonly version?: number
  /** 时钟注入(generated_at 与检索分排序用;默认 Date.now)。 */
  readonly now?: () => number
  /** 半衰期天数(检索分排序,与索引排序同源;默认 90,18 §4.2)。 */
  readonly halfLifeDays?: number
  /**
   * 分节归属提示(T-C LLM 归类):id → 节键;缺席/无该 id/值非法的条目回落
   * 关键词启发式 classifySection(纯函数兜底,同输入同输出)。由 M-M3 整固
   * job 的 Dream 阶段经 curator 批量归类后注入(scripts/gen-portrait.mjs
   * 等离线入口不带 hints,维持纯启发式)。
   */
  readonly sectionHints?: ReadonlyMap<number, PortraitSectionKey>
}

/** 单节条目上限(19 号 §3-T4:单节 ≤10 条,超出按排序截断并在节尾注明)。 */
export const PORTRAIT_MAX_PER_SECTION = 10

/** 三个人记忆节的内部分节键(标题与顺序见 SECTION_TITLES,18 §5)。 */
export type PortraitSectionKey = 'habits' | 'preferences' | 'requirements'

const SECTION_KEYS: readonly PortraitSectionKey[] = ['habits', 'preferences', 'requirements']

/** 节标题固定顺序:工作习惯 → 风格偏好 → 协作要求(工作区索引恒居末)。 */
const SECTION_TITLES: readonly (readonly [PortraitSectionKey, string])[] = [
  ['habits', '工作习惯'],
  ['preferences', '风格偏好'],
  ['requirements', '协作要求'],
]

/** 协作要求类关键词(指令性表述;先于偏好类判定——「必须用 X 风格」归要求)。 */
const REQUIREMENT_KEYWORDS = ['要求', '必须', '务必', '禁止', '不要', '不应', '避免', '遵守', 'must', 'always', 'never', 'require', 'shall'] as const

/** 风格偏好类关键词(品味/表达倾向)。 */
const PREFERENCE_KEYWORDS = ['风格', '偏好', '喜欢', '喜好', '倾向', '语气', '格式', '语言', 'prefer', 'favorite', 'style'] as const

const EMPTY_PLACEHOLDER = '(暂无)'
const SUMMARY_CHAR_CAP = 60
const WORKSPACE_SECTION_TITLE = '工作区索引'

/**
 * 构建用户画像 Markdown(user 层画像的派生视图)。
 * 过滤口径:scope='user' 且 kind='semantic' 且 reviewState='approved' 且 live
 * (invalid_at IS NULL)——与检索/索引默认口径同源(18 §3.2,19 号 §3-T4)。
 */
export function buildPortrait(records: readonly EntityRecord[], options: PortraitOptions = {}): string {
  const version = options.version ?? 1
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(`[memory] version 必须是 ≥1 的整数,得到:${String(options.version)}`)
  }
  const nowMs = options.now?.() ?? Date.now()
  const halfLifeDays = options.halfLifeDays ?? MEMORY_HALF_LIFE_DAYS

  const grouped: Record<PortraitSectionKey, EntityRecord[]> = { habits: [], preferences: [], requirements: [] }
  for (const record of records) {
    if (record.scope !== 'user' || record.kind !== 'semantic' || record.reviewState !== 'approved' || record.invalidAt !== null) {
      continue
    }
    grouped[resolveSection(record, options.sectionHints)].push(record)
  }

  const includedIds: number[] = []
  const blocks: string[] = []
  for (const [key, title] of SECTION_TITLES) {
    const section = grouped[key].sort((a, b) => compareByRecall(a, b, nowMs, halfLifeDays))
    const included = section.slice(0, PORTRAIT_MAX_PER_SECTION)
    includedIds.push(...included.map(record => record.id))
    blocks.push(renderSection(title, included.map(memoryLine), section.length - included.length, '条'))
  }
  blocks.push(renderWorkspaceSection(options.domains ?? []))

  const frontmatter = [
    '---',
    `version: ${version}`,
    `generated_at: ${new Date(nowMs).toISOString()}`,
    `source_memory_ids: [${includedIds.sort((a, b) => a - b).join(', ')}]`,
    '---',
  ].join('\n')
  return `${[frontmatter, ...blocks].join('\n\n')}\n`
}

/** 关键词分节启发式(v0):要求类 → 协作要求;偏好类 → 风格偏好;其余 → 工作习惯。 */
function classifySection(record: EntityRecord): PortraitSectionKey {
  const haystack = `${record.key}\n${record.summary ?? ''}\n${record.content}`.toLowerCase()
  if (REQUIREMENT_KEYWORDS.some(word => haystack.includes(word))) return 'requirements'
  if (PREFERENCE_KEYWORDS.some(word => haystack.includes(word))) return 'preferences'
  return 'habits'
}

/**
 * 分节归属(T-C):hints 命中且值合法 → LLM 归类;否则关键词启发式兜底
 * (同一 record 恒同节,hints 值仅限三节键——解析器已过滤,此处再守一道)。
 */
function resolveSection(record: EntityRecord, hints: ReadonlyMap<number, PortraitSectionKey> | undefined): PortraitSectionKey {
  const hint = hints?.get(record.id)
  return hint !== undefined && (SECTION_KEYS as readonly string[]).includes(hint) ? hint : classifySection(record)
}

/** 与索引排序同口径(18 §4.2):检索分 DESC,同分回落 updated_at DESC → id DESC。 */
function compareByRecall(a: EntityRecord, b: EntityRecord, nowMs: number, halfLifeDays: number): number {
  const left = memoryRecallScore(a, nowMs, halfLifeDays)
  const right = memoryRecallScore(b, nowMs, halfLifeDays)
  if (left !== right) return right - left
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return b.id - a.id
}

/** 一条画像行:key — 摘要(显式 summary 优先,缺省从 content 派生首句并截断)。 */
function memoryLine(record: EntityRecord): string {
  const source = record.summary ?? record.content
  const firstClause = source.split(/[。!?\uFF1B;\n]/u)[0]?.trim() ?? ''
  const chars = Array.from(firstClause)
  const summary = chars.length <= SUMMARY_CHAR_CAP ? firstClause : `${chars.slice(0, SUMMARY_CHAR_CAP).join('')}…`
  return `- ${record.key} — ${summary}`
}

function renderSection(title: string, lines: readonly string[], omitted: number, unit: string): string {
  const body = lines.length > 0 ? lines.join('\n') : EMPTY_PLACEHOLDER
  const note = omitted > 0 ? `\n(另有 ${omitted} ${unit}按排序截断,未列出)` : ''
  return `## ${title}\n${body}${note}`
}

/**
 * 工作区索引节:domain_registry 已转正域投影(候选域 registered IS NULL 不进画像)。
 * 排序与 DomainRegistryStore.list 同口径:COALESCE(last_used_at, created_at) DESC
 * → domain_key ASC;同样受单节上限约束。
 */
function renderWorkspaceSection(domains: readonly DomainRecord[]): string {
  const registered = domains
    .filter(item => item.registered !== null)
    .sort((a, b) => {
      const left = a.lastUsedAt ?? a.createdAt
      const right = b.lastUsedAt ?? b.createdAt
      if (left !== right) return right - left
      return a.domainKey < b.domainKey ? -1 : a.domainKey > b.domainKey ? 1 : 0
    })
  const included = registered.slice(0, PORTRAIT_MAX_PER_SECTION)
  const lines = included.map(item => `- ${item.label}(${item.domainKey}):记忆 ${item.memoryCount} 条`)
  return renderSection(WORKSPACE_SECTION_TITLE, lines, registered.length - included.length, '个域')
}

// ---------- 画像文档解析(M-M3 T12-② 面板画像卡数据面) ----------

/** 解析后的画像分节视图(面板画像卡逐节展示;lines 为纯文本行,不含 Markdown 记号)。 */
export interface PortraitSectionView {
  /** 分节标题(「工作习惯」/「风格偏好」/「协作要求」/「工作区索引」)。 */
  readonly title: string
  /** 节内条目行(渲染口径:已被 memoryLine 截断的 key — 摘要)。 */
  readonly lines: readonly string[]
}

/** portrait.md 的面板视图(剥离 frontmatter 后的分节清单;元数据供展示)。 */
export interface PortraitDocument {
  /** frontmatter version(无 frontmatter/坏值 = null)。 */
  readonly version: number | null
  /** frontmatter generated_at(ISO 串;无 = null)。 */
  readonly generatedAt: string | null
  readonly sections: readonly PortraitSectionView[]
}

/**
 * 解析 buildPortrait 产出的 Markdown(面板画像卡消费;与生成器同文件的唯一真值):
 * - frontmatter `---` 块内取 version/generated_at(防御解析,坏值给 null);
 * - 正文按 `## <标题>` 切节,节内逐行收 `- ` 条目(其余行——占位/截断注——并入
 *   lines 原样展示,面板不重排);
 * - 无 `##` 节的文档(空画像占位)→ sections=[](面板显示「画像尚未生成」语义)。
 * 纯函数不落盘不读库;解析失败只在防御分支降级,不抛(展示位不值得赌)。
 */
export function parsePortraitDocument(raw: string): PortraitDocument {
  let frontmatter = ''
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/u, (block: string): string => {
    frontmatter = block
    return ''
  })
  const versionMatch = frontmatter.match(/^version:\s*(\d+)\s*$/mu)
  const generatedMatch = frontmatter.match(/^generated_at:\s*(\S+)\s*$/mu)
  const sections: PortraitSectionView[] = []
  let current: { title: string; lines: string[] } | null = null
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/u)
    if (heading !== null) {
      current = { title: heading[1] ?? '', lines: [] }
      sections.push(current)
      continue
    }
    if (current !== null && line.trim().length > 0) {
      current.lines.push(line.replace(/^- /u, '').trim())
    }
  }
  return {
    version: versionMatch === null ? null : Number(versionMatch[1]),
    generatedAt: generatedMatch === null ? null : generatedMatch[1] ?? null,
    sections,
  }
}

// ---------- T-C LLM 归类(冻结提示词 + 纯函数解析;Dream 阶段经 curator 直调) ----------

/** 画像归类单条正文的截断上限(与画像行摘要同量级,防提示词膨胀)。 */
const PORTRAIT_CLASSIFY_ITEM_MAX_CHARS = 200
/** 画像归类 curator 调用的 max tokens(JSON 小对象,512 足够)。 */
export const PORTRAIT_CLASSIFY_MAX_TOKENS = 512

/**
 * 画像归类冻结提示词(T-C,2026-11-16):user 层语义记忆 → 三节键。纪律与
 * classifySection 启发式同序(指令词先于偏好词),失败由调用方回落启发式。
 */
export const PORTRAIT_CLASSIFY_PROMPT = [
  '# 用户记忆画像归类(curator)',
  '',
  '你会看到若干条用户记忆(编号/键/正文)。把每条归入恰好一个画像分节:',
  '- habits:工作习惯(怎么做事——节奏、流程、工具使用习惯的稳定事实)',
  '- preferences:风格偏好(品味与表达倾向——语言、格式、语气)',
  '- requirements:协作要求(指令性约束——必须/禁止/遵守类要求)',
  '',
  '纪律:',
  '- 指令性表述先归 requirements(「必须用 X 风格」是要求,不是偏好);',
  '- 只依据记忆文本本身,不臆测;拿不准归 habits(兜底节);',
  '- 每条都必须给出归属,不得遗漏、不得多节;',
  '- 只输出 JSON,不输出任何其它文字,形态:',
  '  {"sections":{"<编号>":"habits|preferences|requirements"}}',
].join('\n')

/** 画像归类 user 文本(逐条:编号/键/正文截断;纯文本,无 markdown 标题)。 */
export function buildPortraitClassifyUserText(records: readonly EntityRecord[]): string {
  const lines = records.map((record) => {
    const content = Array.from(record.content).slice(0, PORTRAIT_CLASSIFY_ITEM_MAX_CHARS).join('')
    return `${record.id}. [${record.key}] ${content}`
  })
  return `待归类记忆 ${records.length} 条:\n${lines.join('\n')}`
}

/**
 * 画像归类输出解析(防御):取首个 `{` 到末个 `}` 之间的 JSON;id 不在
 * validIds 内/节键非法的条目丢弃(调用方对缺席条目回落启发式)。解析失败
 * 返回空 Map(全部回落启发式,行为与 T-C 之前一致)。
 */
export function parsePortraitClassifyOutput(text: string, validIds: readonly number[]): Map<number, PortraitSectionKey> {
  const hints = new Map<number, PortraitSectionKey>()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return hints
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return hints
  }
  const sections = (parsed as { sections?: unknown }).sections
  if (typeof sections !== 'object' || sections === null) return hints
  const allowed = new Set(validIds)
  for (const [rawId, rawKey] of Object.entries(sections as Record<string, unknown>)) {
    const id = Number(rawId)
    if (!Number.isInteger(id) || !allowed.has(id)) continue
    if (typeof rawKey === 'string' && (SECTION_KEYS as readonly string[]).includes(rawKey)) {
      hints.set(id, rawKey as PortraitSectionKey)
    }
  }
  return hints
}
