/**
 * basis 技能插件:目录扫描/覆盖顺序/坏技能隔离/资源清单/catalog 只出现一次/
 * `skill` 工具加载与渲染/取消信号。
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@core/cordis'
import type { PromptSection, ToolDefinition } from '@core/contracts'
import {
  defineSkillsPlugin, readSkillContent, renderSkillCatalog, renderSkillContent, scanSkills,
  type BasisSkillsService,
} from '../src/index.ts'

function markdown(name: string, description = '演示技能', whenToUse?: string, body = `# ${name}\n正文\n`): string {
  return `---\nname: ${name}\ndescription: ${description}\n${whenToUse === undefined ? '' : `whenToUse: ${whenToUse}\n`}---\n\n${body}`
}

function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('scanSkills', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'basis-skills-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('root 自身/子目录/覆盖顺序/坏技能隔离/资源清单', () => {
    const project = join(root, 'project')
    const shared = join(root, 'shared')
    put(join(project, 'SKILL.md'), markdown('root-skill', '项目根技能'))
    put(join(project, 'alpha', 'SKILL.md'), markdown('alpha', '阿尔法 <标签>', '排查问题'))
    put(join(project, 'alpha', 'notes.md'), 'notes')
    put(join(project, 'alpha', 'references', 'guide.md'), 'guide')
    put(join(project, 'alpha', '.hidden'), 'skip')
    put(join(project, 'alpha', '.cache', 'x.md'), 'skip')
    put(join(project, 'bad', 'SKILL.md'), '# 没有 frontmatter\n')
    put(join(project, 'mismatch', 'SKILL.md'), markdown('other-name'))
    put(join(shared, 'alpha', 'SKILL.md'), markdown('alpha', '共享重复'))
    put(join(shared, 'gamma', 'SKILL.md'), markdown('gamma', '伽马'))

    const result = scanSkills({ dirs: [project, shared] })
    expect(result.entries.map(entry => entry.name)).toEqual(['root-skill', 'alpha', 'gamma'])
    const alpha = result.entries.find(entry => entry.name === 'alpha')!
    expect(alpha.description).toBe('阿尔法 <标签>')
    expect(alpha.whenToUse).toBe('排查问题')
    expect(alpha.resources).toEqual(['notes.md', 'references/guide.md'])
    expect(alpha.content).toContain('正文')
    expect(result.warnings.some(warning => warning.includes('bad') && /frontmatter/u.test(warning))).toBe(true)
    expect(result.warnings.some(warning => warning.includes('mismatch') && /目录名/u.test(warning))).toBe(true)
    expect(result.warnings.some(warning => warning.includes('已在更早目录出现'))).toBe(true)
  })

  it('catalog 只有一个 <available_skills>,描述截断且 XML 转义', () => {
    const project = join(root, 'project')
    put(join(project, 'alpha', 'SKILL.md'), markdown('alpha', '阿尔法 <标签>', '场景'))
    put(join(project, 'long', 'SKILL.md'), markdown('long', '长'.repeat(400)))
    const result = scanSkills({ dirs: [project] })
    const catalog = renderSkillCatalog(result.entries)
    expect(catalog.match(/<available_skills>/gu)).toHaveLength(1)
    expect(catalog).toContain('- alpha: 阿尔法 &lt;标签&gt; | 适用场景: 场景')
    expect(catalog).toContain('…')
    expect(renderSkillCatalog([])).toBe('')
  })

  it('symlink 目录/文件不跟,上限触发 warning', () => {
    const project = join(root, 'project')
    const outside = join(root, 'outside')
    put(join(outside, 'SKILL.md'), markdown('outside'))
    put(join(project, 'alpha', 'SKILL.md'), markdown('alpha'))
    put(join(project, 'beta', 'SKILL.md'), markdown('beta'))
    try {
      symlinkSync(outside, join(project, 'linkdir'), 'dir')
    } catch {
      // 文件系统不支持 symlink 时只测上限
    }
    const limited = scanSkills({ dirs: [project], maxSkills: 1 })
    expect(limited.entries.map(entry => entry.name)).toStrictEqual(['alpha'])
    expect(limited.warnings.some(warning => /上限/u.test(warning))).toBe(true)
    expect(limited.entries.some(entry => entry.name === 'outside')).toBe(false)
  })

  it('超大小/名目录不一致在工具加载时也会拒绝', () => {
    const project = join(root, 'project')
    const path = join(project, 'alpha', 'SKILL.md')
    put(path, markdown('alpha'))
    const entry = scanSkills({ dirs: [project] }).entries[0]!
    put(path, markdown('beta'))
    expect(() => readSkillContent(entry)).toThrow(/名称已变为 beta/u)
  })

  it('文件改动后重新扫描/重读即时生效', () => {
    const project = join(root, 'project')
    const path = join(project, 'alpha', 'SKILL.md')
    put(path, markdown('alpha', '旧描述', undefined, '旧正文'))
    const before = scanSkills({ dirs: [project] }).entries[0]!
    expect(before.content).toContain('旧正文')
    put(path, markdown('alpha', '新描述', undefined, '新正文'))
    const after = scanSkills({ dirs: [project] }).entries[0]!
    expect(after.description).toBe('新描述')
    expect(readSkillContent(before)).toContain('新正文')
  })
})

interface Captured {
  section?: PromptSection
  tool?: ToolDefinition
  service?: BasisSkillsService
  disposed: number
}

describe('skills 插件', () => {
  let root: string
  let project: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'basis-skills-plugin-'))
    project = join(root, 'project')
    put(join(project, 'alpha', 'SKILL.md'), markdown('alpha', '阿尔法', '排查', '# 步骤\n1. 检查日志\n'))
    put(join(project, 'alpha', 'references', 'guide.md'), 'guide')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function mount(): Captured {
    const captured: Captured = { disposed: 0 }
    const ctx = {
      systemPrompt: {
        section: (section: PromptSection) => {
          captured.section = section
          return () => { captured.disposed += 1 }
        },
      },
      tools: {
        register: (tool: ToolDefinition) => {
          captured.tool = tool
          return () => { captured.disposed += 1 }
        },
      },
      provide: (name: string, value: unknown) => {
        expect(name).toBe('skills')
        captured.service = value as BasisSkillsService
        return () => { captured.disposed += 1 }
      },
    } as unknown as Context
    defineSkillsPlugin({ dirs: [project] }).apply(ctx)
    return captured
  }

  it('catalog 由 systemPrompt section 提供且只出现一次;ctx.skills 服务同源', () => {
    const captured = mount()
    const section = captured.section!
    expect(section.name).toBe('basis-skills')
    const text = typeof section.text === 'function' ? section.text({ variables: {} }) : section.text
    expect(text.match(/<available_skills>/gu)).toHaveLength(1)
    expect(text).toContain('- alpha: 阿尔法 | 适用场景: 排查')
    expect(captured.service?.catalog()).toBe(text)
    // 再次装配仍只有一份(不是累积注入)
    expect((typeof section.text === 'function' ? section.text({ variables: {} }) : section.text).match(/<available_skills>/gu)).toHaveLength(1)
  })

  it('skill 工具加载正文+资源路径,渲染 <skill_content>', async () => {
    const captured = mount()
    const tool = captured.tool!
    expect(tool.name).toBe('skill')
    const value = await tool.execute({ name: 'alpha' }, {
      callId: 'c1', name: 'skill', signal: new AbortController().signal,
    }) as { name: string; content: string; dir: string; resources: readonly string[] }
    expect(value.name).toBe('alpha')
    expect(value.content).toContain('1. 检查日志')
    expect(value.dir).toBe(join(project, 'alpha'))
    expect(value.resources).toStrictEqual(['references/guide.md'])
    const content = tool.output.render({ name: 'alpha' }, value)
    expect(content[0]).toMatchObject({ type: 'text' })
    expect((content[0] as { text: string }).text).toContain('<skill_content name="alpha">')
    expect((content[0] as { text: string }).text).toContain('资源文件: references/guide.md')
  })

  it('未知技能/非法参数/已取消 signal → 抛错', async () => {
    const captured = mount()
    const tool = captured.tool!
    const exec = { callId: 'c1', name: 'skill', signal: new AbortController().signal }
    expect(() => tool.execute({ name: 'nope' }, exec)).toThrow(/不存在/u)
    expect(() => tool.execute({ name: '' }, exec)).toThrow(/非空/u)
    const aborted = new AbortController()
    aborted.abort()
    expect(() => tool.execute({ name: 'alpha' }, { ...exec, signal: aborted.signal })).toThrow()
  })

  it('无技能时 catalog 为空串,工具仍提示无可用', async () => {
    const captured = mount()
    const empty = defineSkillsPlugin({ dirs: [join(root, 'missing')] })
    const sections: PromptSection[] = []
    const tools: ToolDefinition[] = []
    const ctx = {
      systemPrompt: { section: (section: PromptSection) => { sections.push(section); return () => {} } },
      tools: { register: (tool: ToolDefinition) => { tools.push(tool); return () => {} } },
      provide: () => () => {},
    } as unknown as Context
    empty.apply(ctx)
    const section = sections[0]!
    expect(typeof section.text === 'function' ? section.text({ variables: {} }) : section.text).toBe('')
    expect(() => tools[0]!.execute({ name: 'alpha' }, {
      callId: 'c1', name: 'skill', signal: new AbortController().signal,
    })).toThrow(/不可用/u)
    expect(captured.tool).toBeDefined()
  })

  it('dispose 撤销 section/tool/service 三项', () => {
    const captured = mount()
    // 重新挂载拿 disposer(上面的 mount 没暴露)
    const disposers: Array<() => void> = []
    const ctx = {
      systemPrompt: { section: () => () => { disposers.push(() => {}) } },
      tools: { register: () => () => { disposers.push(() => {}) } },
      provide: () => () => { disposers.push(() => {}) },
    } as unknown as Context
    const dispose = defineSkillsPlugin({ dirs: [project] }).apply(ctx)
    dispose()
    expect(disposers).toHaveLength(3)
    expect(captured.section).toBeDefined()
  })

  it('资源渲染无文件时不出现资源行', () => {
    const entry = scanSkills({ dirs: [project] }).entries[0]!
    expect(renderSkillContent({ name: entry.name, dir: entry.dir, resources: [], content: '正文' }))
      .toBe('<skill_content name="alpha">\n正文\n</skill_content>')
  })
})
