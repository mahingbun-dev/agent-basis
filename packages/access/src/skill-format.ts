/**
 * SKILL.md 格式收口:frontmatter 解析/生成(个人与共享技能同源)。
 *
 * 只认 we 自己安装的形态:文件必须以 `---` frontmatter 开头,至少含 name
 * (kebab-case)与 description;whenToUse(或 when-to-use)可选。正文原样保留,
 * 编辑保存时以原文回写,因此未知 frontmatter 键不会因 UI 编辑而丢失(本解析器
 * 只读需要的三个键,不回写整个 frontmatter)。多行 YAML(>`/`|`)明确拒绝,
 * 不静默截断——导入上游复杂技能时宁可报错让用户改成单行。
 *
 * 安全:name 同时是目录名,只允许 `[a-z0-9-]` kebab-case;长度上限防路径放大。
 */

/** 技能名 grammar(与上游 dsh-skill 一致)。 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 技能名长度上限(目录名同长)。 */
export const SKILL_NAME_MAX = 64
/** description 上限。 */
export const SKILL_DESCRIPTION_MAX = 2000
/** whenToUse 上限。 */
export const SKILL_WHEN_TO_USE_MAX = 2000

/** 解析出的技能元数据。 */
export interface SkillFrontmatter {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
}

/** 一条完整解析结果:元数据 + 去掉 frontmatter 的正文。 */
export interface ParsedSkillMarkdown extends SkillFrontmatter {
  readonly content: string
}

/** 格式错误(路由层映射为用户可见原因,不落正文)。 */
export class SkillFormatError extends Error {}

/** 名称校验(返回错误文案;undefined=通过)。 */
export function skillNameIssue(name: string): string | undefined {
  if (name === '') return '技能名不能为空'
  if (name.length > SKILL_NAME_MAX) return `技能名不能超过 ${SKILL_NAME_MAX} 个字符`
  if (!SKILL_NAME_PATTERN.test(name)) return '技能名只能由小写字母、数字与连字符组成（如 my-skill）'
  return undefined
}

/**
 * 解析 SKILL.md。必须带 frontmatter;正文可为空但通常应写指令。
 * @throws SkillFormatError 缺少 frontmatter/必填字段/多行 YAML/超长字段。
 */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const lines = text.split(/\r?\n/u)
  if (lines[0] !== '---') {
    throw new SkillFormatError('SKILL.md 必须以 `---` frontmatter 开头（需包含 name 与 description）')
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
    if (/^\s/u.test(line)) {
      throw new SkillFormatError('frontmatter 不支持缩进/多行 YAML，请把 name/description 写成单行')
    }
    const colon = line.indexOf(':')
    if (colon <= 0) throw new SkillFormatError(`frontmatter 行无法解析:${line.slice(0, 80)}`)
    const key = line.slice(0, colon).trim()
    const rawValue = line.slice(colon + 1).trim()
    if (rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      throw new SkillFormatError(`frontmatter 字段 ${key} 不支持多行 YAML，请改为单行`)
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

/** 生成 SKILL.md(新建模板用;已有文件编辑不回写)。 */
export function formatSkillMarkdown(input: SkillFrontmatter & { readonly content: string }): string {
  const lines = [
    '---',
    `name: ${yamlScalar(input.name)}`,
    `description: ${yamlScalar(input.description)}`,
    ...(input.whenToUse === undefined || input.whenToUse === '' ? [] : [`whenToUse: ${yamlScalar(input.whenToUse)}`]),
    '---',
    '',
    input.content,
  ]
  return lines.join('\n').replace(/\n+$/u, '\n')
}

/** 新建技能模板(用户点「新建技能」时预填,可直接保存)。 */
export function newSkillTemplate(name: string): string {
  return formatSkillMarkdown({
    name,
    description: '一句话说明何时使用这个技能',
    content: `# ${name}\n\n在这里写这个技能的完整指令。\n`,
  })
}

/** 去掉首尾成对引号并解转义;未加引号时按普通标量。 */
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
  // 普通标量:去掉行尾注释(` #...`)但不碰引号内的 #(引号已在上面处理)
  const comment = raw.indexOf(' #')
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim()
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/** 需要时加双引号,避免 `: `/`#`/首尾空白等把标量读坏。 */
function yamlScalar(value: string): string {
  if (value !== '' && !/[:#\n\r]/u.test(value) && !/^\s|\s$/u.test(value) && !/^[>|&*!%@`[\]{},?]/u.test(value)) {
    return value
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
}
