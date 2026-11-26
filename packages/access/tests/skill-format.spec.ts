/** SKILL.md frontmatter 解析/生成的边界。 */
import { describe, expect, it } from 'vitest'
import { formatSkillMarkdown, newSkillTemplate, parseSkillMarkdown, skillNameIssue, SkillFormatError } from '../src/skill-format.ts'

function errorOf(markdown: string): string {
  try {
    parseSkillMarkdown(markdown)
  } catch (caught) {
    expect(caught).toBeInstanceOf(SkillFormatError)
    return (caught as Error).message
  }
  throw new Error('expected parse failure')
}

describe('parseSkillMarkdown', () => {
  it('解析 name/description/whenToUse 与正文', () => {
    const parsed = parseSkillMarkdown('---\nname: smoke-skill\ndescription: "冒烟: 验证"\nwhenToUse: 当需要冒烟时\n---\n\n# 标题\n\n正文\n')
    expect(parsed).toMatchObject({
      name: 'smoke-skill',
      description: '冒烟: 验证',
      whenToUse: '当需要冒烟时',
      content: '# 标题\n\n正文\n',
    })
  })

  it('支持 when-to-use 别名、单引号与 BOM', () => {
    const parsed = parseSkillMarkdown('\uFEFF---\nname: alias-skill\ndescription: \'it\'\'s ok\'\nwhen-to-use: 场景\n---\nbody')
    expect(parsed.description).toBe("it's ok")
    expect(parsed.whenToUse).toBe('场景')
    expect(parsed.content).toBe('body')
  })

  it('拒绝缺 frontmatter/缺 description/多行 YAML/非法名称/超长', () => {
    expect(errorOf('# no frontmatter')).toMatch(/必须以 `---`/)
    expect(errorOf('---\nname: x\n---\nbody')).toBeTruthy()
    expect(errorOf('---\nname: Bad_Name\ndescription: y\n---\n')).toMatch(/只能由小写字母/)
    expect(errorOf('---\nname: x\n---')).toMatch(/缺少 description/)
    expect(errorOf('---\nname: x\ndescription: >\n  folded\n---')).toMatch(/多行 YAML/)
    expect(errorOf(`---\nname: x\ndescription: ${'a'.repeat(2001)}\n---`)).toMatch(/不能超过/)
  })

  it('name 规则与长度', () => {
    expect(skillNameIssue('')).toBeTruthy()
    expect(skillNameIssue('a--b')).toBeTruthy()
    expect(skillNameIssue('good-name-2')).toBeUndefined()
    expect(skillNameIssue('a'.repeat(65))).toMatch(/64/)
  })
})

describe('formatSkillMarkdown', () => {
  it('生成可回读的 SKILL.md,特殊字符走双引号', () => {
    const markdown = formatSkillMarkdown({
      name: 'quote-skill',
      description: 'a: b # c',
      whenToUse: 'when "needed"',
      content: '# x\n',
    })
    expect(markdown).toContain('description: "a: b # c"')
    const parsed = parseSkillMarkdown(markdown)
    expect(parsed.description).toBe('a: b # c')
    expect(parsed.whenToUse).toBe('when "needed"')
  })

  it('新模板可直接解析', () => {
    expect(parseSkillMarkdown(newSkillTemplate('demo-skill')).name).toBe('demo-skill')
  })
})
