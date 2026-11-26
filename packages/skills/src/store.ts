/**
 * basis 技能目录扫描:文件系统即事实源,无 DB。
 *
 * 目录约定(每个 root 下):
 *   <root>/SKILL.md              root 自身即一个技能(名称取 frontmatter)
 *   <root>/<name>/SKILL.md       常规技能包;名称必须与目录名一致
 *   <root>/<name>/references/... 资源文件(只列路径,不读内容)
 *
 * 纪律:
 * - 只读一层子目录,不跟 symlink,跳过隐藏文件;单技能 ≤512KB,目录最多 50 个;
 * - frontmatter 坏/重名/名目录不一致 = 跳过并记 warning(一个坏技能不拖垮全目录);
 * - 先配置的 root 优先(同名后出现者跳过),保证项目级覆盖内置/品牌技能。
 * - catalog 与工具调用都现扫(文件改动下一次装配/调用即生效),不建常驻索引。
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parseSkillMarkdown, SkillFormatError } from './format.ts'

/** 缺省扫描目录(相对 cwd;后两个是仓内约定目录)。 */
export const DEFAULT_SKILL_DIRS = ['.basis/skills', 'skills', 'packages/brand/skills'] as const
export const DEFAULT_MAX_SKILLS = 50
export const DEFAULT_MAX_SKILL_BYTES = 512 * 1024
const MAX_RESOURCE_FILES = 100
const MAX_RESOURCE_DEPTH = 3
const CATALOG_DESCRIPTION_MAX = 240
const CATALOG_WHEN_TO_USE_MAX = 160

/** 一个可用技能(扫描产物;正文为去掉 frontmatter 的内容)。 */
export interface SkillEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** 技能目录绝对路径(资源基准)。 */
  readonly dir: string
  /** SKILL.md 绝对路径(工具调用时重读)。 */
  readonly path: string
  readonly content: string
  /** 相对技能目录的资源文件(不含 SKILL.md 与隐藏文件)。 */
  readonly resources: readonly string[]
}

export interface SkillScanOptions {
  readonly dirs?: readonly string[] | undefined
  /** 相对目录的基准(缺省 process.cwd())。 */
  readonly cwd?: string | undefined
  readonly maxSkills?: number | undefined
  readonly maxSkillBytes?: number | undefined
}

export interface SkillScanResult {
  readonly entries: readonly SkillEntry[]
  /** 被跳过的原因(坏 frontmatter/重名/名目录不一致/超限),不含文件正文。 */
  readonly warnings: readonly string[]
}

/** 扫描全部配置目录;不存在/非目录静默跳过(缺省目录本就可能不存在)。 */
export function scanSkills(options: SkillScanOptions = {}): SkillScanResult {
  const cwd = options.cwd ?? process.cwd()
  const dirs = options.dirs ?? DEFAULT_SKILL_DIRS
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS
  const maxSkillBytes = options.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES
  const entries: SkillEntry[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const add = (dir: string, path: string, expectDirName: boolean): void => {
    if (entries.length >= maxSkills) {
      warnings.push(`技能数量超过上限 ${maxSkills},其余目录已跳过`)
      return
    }
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isFile()) return
      if (stat.size > maxSkillBytes) {
        warnings.push(`${path}: SKILL.md 超过 ${maxSkillBytes} 字节,已跳过`)
        return
      }
      const parsed = parseSkillMarkdown(readFileSync(path, 'utf8'))
      if (expectDirName && parsed.name !== basename(dir)) {
        warnings.push(`${path}: name(${parsed.name})与目录名(${basename(dir)})不一致,已跳过`)
        return
      }
      if (seen.has(parsed.name)) {
        warnings.push(`${path}: 技能 ${parsed.name} 已在更早目录出现,已跳过`)
        return
      }
      seen.add(parsed.name)
      entries.push({
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        dir,
        path,
        content: parsed.content,
        resources: listResources(dir),
      })
    } catch (error) {
      if (error instanceof SkillFormatError) warnings.push(`${path}: ${error.message}`)
      else warnings.push(`${path}: 读取失败(${error instanceof Error ? error.message : String(error)})`)
    }
  }

  for (const declared of dirs) {
    const root = isAbsolute(declared) ? declared : resolve(cwd, declared)
    let rootStat
    try {
      rootStat = lstatSync(root)
    } catch {
      continue
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) continue
    const rootSkill = join(root, 'SKILL.md')
    if (isRealFile(rootSkill)) add(root, rootSkill, false)
    let children
    try {
      children = readdirSync(root, { withFileTypes: true })
    } catch (error) {
      warnings.push(`${root}: 读取目录失败(${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const sorted = [...children].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const child of sorted) {
      if (child.name.startsWith('.') || child.isSymbolicLink() || !child.isDirectory()) continue
      const dir = join(root, child.name)
      const path = join(dir, 'SKILL.md')
      if (isRealFile(path)) add(dir, path, true)
    }
  }
  return { entries, warnings }
}

/** 生成 system prompt 的技能目录;无技能返回空串(避免空 section 多出空行)。 */
export function renderSkillCatalog(entries: readonly SkillEntry[]): string {
  if (entries.length === 0) return ''
  const lines = [
    '<available_skills>',
    '以下技能是按需加载的指令包。只有在任务与描述匹配时才调用 `skill` 工具,name 必须取下列名称。',
  ]
  for (const entry of entries) {
    const when = entry.whenToUse === undefined
      ? ''
      : ` | 适用场景: ${escapeXml(truncate(entry.whenToUse, CATALOG_WHEN_TO_USE_MAX))}`
    lines.push(`- ${entry.name}: ${escapeXml(truncate(entry.description, CATALOG_DESCRIPTION_MAX))}${when}`)
  }
  lines.push('</available_skills>')
  return lines.join('\n')
}

/** 工具结果正文所需的最小视图。 */
export interface SkillContentView {
  readonly name: string
  readonly dir: string
  readonly resources: readonly string[]
  readonly content: string
}

/** 工具结果正文:`<skill_content>` + 资源基准(模型可据此读 references)。 */
export function renderSkillContent(entry: SkillContentView): string {
  const lines = [`<skill_content name="${entry.name}">`]
  if (entry.resources.length > 0) {
    lines.push(`资源目录: ${entry.dir}`)
    lines.push(`资源文件: ${entry.resources.join(', ')}`)
    lines.push('')
  }
  lines.push(entry.content.trimEnd(), '</skill_content>')
  return lines.join('\n')
}

/** 工具调用时重读 SKILL.md(文件改动即时生效;坏格式抛错给执行器转 tool error)。 */
export function readSkillContent(entry: SkillEntry, maxSkillBytes = DEFAULT_MAX_SKILL_BYTES): string {
  const stat = lstatSync(entry.path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`技能 ${entry.name} 的 SKILL.md 不是普通文件`)
  if (stat.size > maxSkillBytes) throw new Error(`技能 ${entry.name} 的 SKILL.md 超过 ${maxSkillBytes} 字节`)
  const parsed = parseSkillMarkdown(readFileSync(entry.path, 'utf8'))
  if (parsed.name !== entry.name) throw new Error(`技能 ${entry.name} 的 SKILL.md 名称已变为 ${parsed.name}`)
  return parsed.content
}

function isRealFile(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function listResources(dir: string): readonly string[] {
  const out: string[] = []
  const walk = (relativeDir: string, depth: number): void => {
    if (out.length >= MAX_RESOURCE_FILES || depth > MAX_RESOURCE_DEPTH) return
    let children
    try {
      children = readdirSync(join(dir, relativeDir), { withFileTypes: true })
    } catch {
      return
    }
    const sorted = [...children].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const child of sorted) {
      if (out.length >= MAX_RESOURCE_FILES) return
      if (child.name.startsWith('.') || child.isSymbolicLink()) continue
      const relative = relativeDir === '' ? child.name : `${relativeDir}/${child.name}`
      if (child.isDirectory()) walk(relative, depth + 1)
      else if (child.isFile() && child.name !== 'SKILL.md') out.push(relative)
    }
  }
  walk('', 0)
  return out
}

function truncate(text: string, max: number): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
