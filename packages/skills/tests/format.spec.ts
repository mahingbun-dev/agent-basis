/** SKILL.md 解析:格式收口、引号/别名、多行 YAML 与名称 grammar。 */
import { describe, expect, it } from 'vitest'
import {
  SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, SkillFormatError, parseSkillMarkdown, skillNameIssue,
} from '../src/format.ts'

describe('parseSkillMarkdown', () => {
  it('解析 name/description/whenToUse,正文去掉 frontmatter', () => {
    const parsed = parseSkillMarkdown('---\nname: smoke-skill\ndescription: 演示技能\nwhenToUse: 排查联调\n---\n\n# 标题\n正文\n')
    expect(parsed).toStrictEqual({
      name: 'smoke-skill',
      description: '演示技能',
      whenToUse: '排查联调',
      content: '# 标题\n正文\n',
    })
  })

  it('BOM、双引号转义、单引号、when-to-use 别名与行尾注释', () => {
    expect(parseSkillMarkdown('\uFEFF---\nname: a-skill\ndescription: "含: 冒号 # 井号"\nwhen-to-use: 场景\n---\n正文')).toStrictEqual({
      name: 'a-skill', description: '含: 冒号 # 井号', whenToUse: '场景', content: '正文',
    })
    expect(parseSkillMarkdown("---\nname: 'b-skill'\ndescription: 'it''s fine # 保留'\n---\n")).toStrictEqual({
      name: 'b-skill', description: "it's fine # 保留", content: '',
    })
    expect(parseSkillMarkdown('---\nname: c-skill\ndescription: 说明 # 注释\n---\n').description).toBe('说明')
    expect(parseSkillMarkdown('---\n# 注释行\nname: d-skill\ndescription: x\n---\n').name).toBe('d-skill')
  })

  it('缺 frontmatter/未闭合/缩进/多行 YAML/缺字段/非法名一律抛错', () => {
    const bad = [
      '# 只有正文',
      '---\nname: x-skill\n',
      '---\nname: x-skill\n  description: indented\n---\n',
      '---\nname: x-skill\ndescription: |\n  多行\n---\n',
      '---\nname: x-skill\n---\n',
      '---\ndescription: 无名称\n---\n',
      '---\nname: Bad_Name\ndescription: x\n---\n',
      '---\nname: x-skill\ndescription: x\n---\n', // 名称合法,但下面单独测长度
    ]
    for (const raw of bad.slice(0, 7)) expect(() => parseSkillMarkdown(raw), raw).toThrow(SkillFormatError)
    expect(parseSkillMarkdown(bad[7]!).name).toBe('x-skill')
  })

  it('边界:name 64 字符、description 2000 字符', () => {
    const name = 'a'.repeat(SKILL_NAME_MAX)
    expect(parseSkillMarkdown(`---\nname: ${name}\ndescription: x\n---\n`).name).toBe(name)
    expect(() => parseSkillMarkdown(`---\nname: ${name}a\ndescription: x\n---\n`)).toThrow(/64/)
    const long = '字'.repeat(SKILL_DESCRIPTION_MAX + 1)
    expect(() => parseSkillMarkdown(`---\nname: a\ndescription: ${long}\n---\n`)).toThrow(/2000/)
  })

  it('skillNameIssue:空/长度/grammar', () => {
    expect(skillNameIssue('ok-skill')).toBeUndefined()
    expect(skillNameIssue('')).toMatch(/不能为空/)
    expect(skillNameIssue('A')).toMatch(/小写/)
    expect(skillNameIssue('a'.repeat(SKILL_NAME_MAX + 1))).toMatch(/64/)
  })
})
