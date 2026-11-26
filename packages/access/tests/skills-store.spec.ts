/**
 * Skill 文件库:个人/共享生命周期、frontmatter 校验、配额、zip 安装、
 * 共享资源按用户缓存、账户路径越界。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillStore, SkillStoreError, SKILL_PERSONAL_MAX } from '../src/skills-store.ts'
import { zipOf } from './zip-fixture.ts'

function skillMd(name: string, description = '演示技能'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n按步骤执行。\n`
}

describe('SkillStore', () => {
  let root: string
  let store: SkillStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eterna-skills-'))
    store = new SkillStore({ tenantRoot: join(root, 'tenant'), accessDir: join(root, 'access') })
    mkdirSync(join(root, 'tenant', 'alice'), { recursive: true })
    mkdirSync(join(root, 'tenant', 'bob'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('新建/列表/读取/编辑/删除个人技能', () => {
    const created = store.save('personal', 'alice', skillMd('smoke-skill', '冒烟验证'))
    expect(created).toMatchObject({ scope: 'personal', name: 'smoke-skill', description: '冒烟验证', enabled: true, origin: 'form' })
    expect(created.files).toBe(1)

    const listed = store.listPersonal('alice')
    expect(listed.map(row => row.name)).toEqual(['smoke-skill'])

    const read = store.read('personal', 'alice', 'smoke-skill')
    expect(read.markdown).toContain('按步骤执行')

    const edited = store.save('personal', 'alice', skillMd('smoke-skill', '改过的描述'), 'smoke-skill')
    expect(edited.description).toBe('改过的描述')
    expect(store.listPersonal('alice')).toHaveLength(1)

    store.delete('personal', 'alice', 'smoke-skill')
    expect(store.listPersonal('alice')).toEqual([])
    expect(() => store.read('personal', 'alice', 'smoke-skill')).toThrow(SkillStoreError)
  })

  it('名字不可改、重复创建、非法 name 与非法目录名', () => {
    store.save('personal', 'alice', skillMd('smoke-skill'))
    expect(() => store.save('personal', 'alice', skillMd('smoke-skill'))).toThrow(/已存在/)
    expect(() => store.save('personal', 'alice', skillMd('other-name'), 'smoke-skill')).toThrow(/不可修改/)
    expect(() => store.save('personal', 'alice', skillMd('Bad_Name'))).toThrow(/只能由小写字母/)
    expect(() => store.read('personal', 'alice', '../etc')).toThrow(/只能由小写字母/)
  })

  it('启停保留状态,保存不清掉停用', () => {
    store.save('personal', 'alice', skillMd('smoke-skill'))
    expect(store.toggle('personal', 'alice', 'smoke-skill', false).enabled).toBe(false)
    expect(store.listPersonal('alice', false)).toEqual([])
    expect(store.listPersonal('alice', true)).toHaveLength(1)
    const saved = store.save('personal', 'alice', skillMd('smoke-skill', '新描述'), 'smoke-skill')
    expect(saved.enabled).toBe(false)
  })

  it('个人技能按账号隔离,共享技能全员可见', () => {
    store.save('personal', 'alice', skillMd('alice-only'))
    expect(store.listPersonal('bob')).toEqual([])
    store.save('shared', 'alice', skillMd('team-skill'))
    expect(store.listShared().map(row => row.name)).toEqual(['team-skill'])
    expect(store.listPersonal('bob')).toEqual([])
  })

  it('共享资源按用户懒拷贝,签名未变复用', () => {
    const zip = zipOf([
      { path: 'team-skill/SKILL.md', data: skillMd('team-skill') },
      { path: 'team-skill/references/a.md', data: '参考内容' },
    ])
    const entry = store.installZip('shared', 'alice', zip)
    expect(entry.files).toBe(2)
    const cache = store.resourceDir(entry, 'bob')
    expect(cache).toBeDefined()
    expect(cache).not.toBe(entry.dir)
    expect(cache).toContain(join('bob', '.eterna', 'skill-cache', 'team-skill'))
    expect(store.resourceDir(entry, 'bob')).toBe(cache)
  })

  it('上传 md 与 zip:根目录文件夹/资源文件均可用', () => {
    const md = store.installMarkdown('personal', 'alice', skillMd('md-skill'))
    expect(md.origin).toBe('upload-md')
    const zipEntry = store.installZip('personal', 'alice', zipOf([
      { path: 'zip-skill/SKILL.md', data: skillMd('zip-skill') },
      { path: 'zip-skill/resources/note.txt', data: 'note' },
    ]))
    expect(zipEntry.name).toBe('zip-skill')
    expect(zipEntry.files).toBe(2)
    expect(zipEntry.origin).toBe('upload-zip')
  })

  it('zip 缺 SKILL.md / 非法名称 / 超限均拒绝', () => {
    expect(() => store.installZip('personal', 'alice', zipOf([
      { path: 'readme.txt', data: 'x' },
    ]))).toThrow(/SKILL.md/)
    expect(() => store.installZip('personal', 'alice', zipOf([
      { path: 'Bad/SKILL.md', data: skillMd('Bad') },
    ]))).toThrow(/只能由小写字母/)
  })

  it('个人配额与服务端错误码', () => {
    for (let index = 0; index < SKILL_PERSONAL_MAX; index += 1) {
      store.save('personal', 'alice', skillMd(`skill-${index}`))
    }
    let error: unknown
    try {
      store.save('personal', 'alice', skillMd('one-more'))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(SkillStoreError)
    expect((error as SkillStoreError).code).toBe('limit')
    // 编辑已存在项不受配额影响
    expect(store.save('personal', 'alice', skillMd('skill-0', '新描述'), 'skill-0').description).toBe('新描述')
  })

  it('拒绝符号链接技能目录与非法账号', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'SKILL.md'), skillMd('linked'))
    const skillsRoot = store.personalRoot('alice')
    mkdirSync(skillsRoot, { recursive: true })
    symlinkSync(outside, join(skillsRoot, 'linked'))
    expect(store.listPersonal('alice')).toEqual([])
    expect(() => store.read('personal', 'alice', 'linked')).toThrow(SkillStoreError)
    expect(() => store.personalRoot('..')).toThrow(SkillStoreError)
    expect(() => store.personalRoot('.')).toThrow(SkillStoreError)
  })

  it('坏 frontmatter 不阻断其它技能', () => {
    const skillsRoot = store.personalRoot('alice')
    mkdirSync(join(skillsRoot, 'broken'), { recursive: true })
    writeFileSync(join(skillsRoot, 'broken', 'SKILL.md'), 'no frontmatter\n')
    store.save('personal', 'alice', skillMd('good-skill'))
    expect(store.listPersonal('alice').map(row => row.name)).toEqual(['good-skill'])
  })

  it('删除用户时清理个人技能与共享缓存', () => {
    store.save('personal', 'alice', skillMd('smoke-skill'))
    const shared = store.installZip('shared', 'alice', zipOf([
      { path: 'team-skill/SKILL.md', data: skillMd('team-skill') },
    ]))
    expect(store.resourceDir(shared, 'alice')).toBeDefined()
    const skillsRoot = store.personalRoot('alice')
    expect(existsSync(skillsRoot)).toBe(true)
    store.removeUserRoots('alice')
    expect(existsSync(skillsRoot)).toBe(false)
    expect(store.listPersonal('alice')).toEqual([])
  })
})
