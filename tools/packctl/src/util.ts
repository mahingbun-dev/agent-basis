/**
 * 纯工具层:YAML 读取、SKILL.md frontmatter 拆分、TS 源码注释剥离、目录遍历。
 * 全部为无副作用纯函数(node:fs 只出现在调用方),便于单测与 @eterna/evals 复用。
 */
import { parseDocument } from 'yaml'

export type YamlValue = unknown

export interface YamlResult {
  readonly ok: boolean
  readonly value: YamlValue
  readonly error?: string
}

/** 解析 YAML 文本;错误信息带行号(parseDocument 的 range 转换)。 */
export function parseYaml(text: string): YamlResult {
  const doc = parseDocument(text, { strict: false })
  const first = doc.errors[0]
  if (first !== undefined) {
    const line = first.linePos?.[0].line
    const pos = line !== undefined ? `:${String(line)}` : ''
    return { ok: false, value: undefined, error: `${first.message}${pos}` }
  }
  return { ok: true, value: doc.toJS() }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every(v => typeof v === 'string') ? value : undefined
}

// ── SKILL.md frontmatter ────────────────────────────────────────────────────

export interface FrontmatterResult {
  readonly ok: boolean
  /** frontmatter 文本(不含 --- 围栏);无 frontmatter 时为 undefined。 */
  readonly frontmatter?: string
  /** 正文(frontmatter 之后的所有内容)。 */
  readonly body: string
  readonly error?: string
}

/**
 * 拆 `---` 围栏的 YAML frontmatter。首行必须是 `---`,匹配到下一个独占一行的 `---`。
 * 与 dsh-skill-filesystem 的目录/正文分离语义对齐(catalog 解析 frontmatter,body 每次加载重读)。
 */
export function splitFrontmatter(text: string): FrontmatterResult {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { ok: false, body: text, error: '首行不是 --- frontmatter 围栏' }
  }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) {
    return { ok: false, body: text, error: 'frontmatter 围栏未闭合(缺少结束 ---)' }
  }
  const frontmatter = normalized.slice(4, end)
  const body = normalized.slice(end + '\n---\n'.length)
  return { ok: true, frontmatter, body }
}

// ── SKILL.md 条目锚点(ACE 条目化,10 号文档 §4.1)───────────────────────────

export const ENTRY_OPEN_RE = /<!--\s*E:\s*([^\s>]+?)\s*-->/g
export const ENTRY_CLOSE = '<!-- /E -->'

export interface EntryAnchor {
  readonly id: string
  /** 在正文中的字符偏移,用于配对开/闭锚点。 */
  readonly index: number
  readonly closed: boolean
}

/** 提取正文中全部 `<!-- E: id -->` 锚点,并检查每个开锚点之后最近的 `<!-- /E -->`。 */
export function parseEntryAnchors(body: string): readonly EntryAnchor[] {
  const anchors: EntryAnchor[] = []
  for (const match of body.matchAll(ENTRY_OPEN_RE)) {
    const index = match.index
    const closeIndex = body.indexOf(ENTRY_CLOSE, index)
    const nextOpen = body.slice(index + match[0].length).search(ENTRY_OPEN_RE)
    const nextOpenAbs = nextOpen < 0 ? body.length : index + match[0].length + nextOpen
    anchors.push({
      id: match[1] ?? '',
      index,
      closed: closeIndex >= 0 && closeIndex < nextOpenAbs,
    })
  }
  return anchors
}

// ── TS 源码注释剥离(供 Cordis 纪律静态扫描,降低注释误报)─────────────────

/**
 * 逐行剥掉 TS 注释(保留行号),供 Cordis 纪律静态扫描:
 * - `/* … *\/` 块注释跨行由状态机衔接;
 * - `//` 行注释只在行内不在引号内时剥离(URL 字符串不误伤);
 * - 不做完整词法分析,模板字符串中的 `//` 仍可能被误剥 —— 对禁止清单
 *   (globalThis/process.env/裸定时器)足够:它们不出现在合法 URL/模板里。
 */
export interface StrippedLine {
  /** 1 起始行号。 */
  readonly line: number
  readonly text: string
}

export function stripCommentsLineByLine(source: string): readonly StrippedLine[] {
  const out: StrippedLine[] = []
  let inBlockComment = false
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    let text = ''
    let j = 0
    let quote: '"' | "'" | '`' | undefined
    while (j < raw.length) {
      const ch = raw[j] ?? ''
      const next = raw[j + 1] ?? ''
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          j += 2
        } else {
          j++
        }
        continue
      }
      if (quote !== undefined) {
        text += ch
        if (ch === '\\') {
          text += next
          j += 2
          continue
        }
        if (ch === quote) quote = undefined
        j++
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        text += ch
        j++
      } else if (ch === '/' && next === '/') {
        break
      } else if (ch === '/' && next === '*') {
        inBlockComment = true
        j += 2
      } else {
        text += ch
        j++
      }
    }
    out.push({ line: i + 1, text })
  }
  return out
}

// ── 杂项 ────────────────────────────────────────────────────────────────────

export function isKebabCase(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
}

/** ACE 条目 id 约定:`S-<kebab>`(如 S-contract-review-001,10 号文档 §4.1 示例)。 */
export function isEntryId(value: string): boolean {
  return /^S-[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
}
