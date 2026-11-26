/**
 * SKILL.md frontmatter 解析(basis 侧精简同构)。
 *
 * 与 access 的 `skill-format.ts` 同一格式口径:必须以 `---` 开头、name 为
 * kebab-case、description 必填、whenToUse/when-to-use 可选;多行 YAML 明确拒绝。
 * basis 不依赖 access(CLI 与 Web host 两个半边),故保留一份约百行的同构实现;
 * 两侧行为由各自测试钉住,格式升级需同时改两处。
 */

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 2000
export const SKILL_WHEN_TO_USE_MAX = 2000

export interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** 去掉 frontmatter 的正文。 */
  readonly content: string
}

export class SkillFormatError extends Error {}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const lines = text.split(/\r?\n/u)
  if (lines[0] !== '---') {
    throw new SkillFormatError('SKILL.md 必须以 `---` frontmatter 开头(需包含 name 与 description)')
  }
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') { closing = index; break }
  }
  if (closing < 0) throw new SkillFormatError('frontmatter 缺少结束的 `---`')

  const values = new Map<string, string>()
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/u.test(line)) throw new SkillFormatError('frontmatter 不支持缩进/多行 YAML,请写成单行')
    const colon = line.indexOf(':')
    if (colon <= 0) throw new SkillFormatError(`frontmatter 行无法解析:${line.slice(0, 80)}`)
    const key = line.slice(0, colon).trim()
    const rawValue = line.slice(colon + 1).trim()
    if (rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      throw new SkillFormatError(`frontmatter 字段 ${key} 不支持多行 YAML,请改为单行`)
    }
    values.set(key, parseScalar(rawValue))
  }

  const name = values.get('name') ?? ''
  const nameIssue = skillNameIssue(name)
  if (nameIssue !== undefined) throw new SkillFormatError(nameIssue)
  const description = values.get('description') ?? ''
  if (description === '') throw new SkillFormatError('frontmatter 缺少 description')
  if (description.length > SKILL_DESCRIPTION_MAX) {
    throw new SkillFormatError(`description 不能超过 ${SKILL_DESCRIPTION_MAX} 个字符`)
  }
  const whenToUse = firstNonEmpty(values.get('whenToUse'), values.get('when-to-use'))
  if (whenToUse !== undefined && whenToUse.length > SKILL_WHEN_TO_USE_MAX) {
    throw new SkillFormatError(`whenToUse 不能超过 ${SKILL_WHEN_TO_USE_MAX} 个字符`)
  }
  const body = lines.slice(closing + 1).join('\n')
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    content: body.startsWith('\n') ? body.slice(1) : body,
  }
}

export function skillNameIssue(name: string): string | undefined {
  if (name === '') return '技能名不能为空'
  if (name.length > SKILL_NAME_MAX) return `技能名不能超过 ${SKILL_NAME_MAX} 个字符`
  if (!SKILL_NAME_PATTERN.test(name)) return '技能名只能由小写字母、数字与连字符组成(如 my-skill)'
  return undefined
}

function parseScalar(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll('\\n', '\n')
      .replaceAll('\\\\', '\\')
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replaceAll("''", "'")
  }
  const comment = raw.indexOf(' #')
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim()
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value
  }
  return undefined
}
