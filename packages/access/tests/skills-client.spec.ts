/**
 * 技能设置分区客户端契约:七端点 RPC 信封、页签/写权限、上传与编辑器前置校验、
 * frontmatter 预览、插件页卡片类名、无字面色值/原生 confirm、文案键集合。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { skillsApi } from '../src/client/skills-api.ts'
import type { SkillItemView } from '../src/client/skills-api.ts'
import { SKILL_LOCALES } from '../src/client/skills-locales.ts'
import {
  SKILL_MARKDOWN_CLIENT_MAX, SKILL_TABS, SKILL_ZIP_CLIENT_MAX,
  base64FromBytes, bytesLabel, countLabel, frontmatterPreview, itemsOfScope, markdownIssue,
  markdownIssueMessageKey, newSkillTemplate, originLabelKey, quotaLabel, scopeOfTab, tabOfScope,
  uploadIssue, uploadIssueMessageKey, writableFor,
} from '../src/client/skills-model.ts'

const CLIENT_DIR = join(import.meta.dirname, '..', 'src', 'client')
const readClient = (name: string): string => readFileSync(join(CLIENT_DIR, name), 'utf8')

interface Captured {
  readonly url: string
  readonly body: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: { args?: unknown } }
}

function stubFetch(value: unknown): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const text: string = typeof init.body === 'string' ? init.body : '{}'
    captured.push({ url, body: JSON.parse(text) as Captured['body'] })
    return Promise.resolve(new Response(JSON.stringify({ result: { ok: true, value } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  })
  return captured
}

afterEach(() => { vi.unstubAllGlobals() })

const MARKDOWN = '---\nname: smoke-skill\ndescription: 演示技能\n---\n\n正文\n'

describe('技能 API 信封', () => {
  it('list/read:POST 到 /api/skills-manage/*,method 去 /api/ 前缀', async () => {
    const captured = stubFetch({ items: [], personalLimit: 32, sharedLimit: 64 })
    await skillsApi.list()
    await skillsApi.read('personal', 'smoke-skill')
    expect(captured.map(row => row.url)).toStrictEqual([
      '/api/skills-manage/list', '/api/skills-manage/read',
    ])
    expect(captured[0]?.body.type).toBe('client-request')
    expect(captured[0]?.body.rpcId).toEqual(expect.any(String))
    expect(captured[0]?.body.method).toBe('skills-manage/list')
    expect(captured[1]?.body.method).toBe('skills-manage/read')
    expect(captured[0]?.body.payload?.args).toStrictEqual({})
    expect(captured[1]?.body.payload?.args).toStrictEqual({ scope: 'personal', name: 'smoke-skill' })
  })

  it('save/install-md/install-zip/toggle/delete:参数形状与服务端一致', async () => {
    const captured = stubFetch({ item: { name: 'smoke-skill' }, ok: true })
    await skillsApi.save('personal', MARKDOWN)
    await skillsApi.save('shared', MARKDOWN, 'smoke-skill')
    await skillsApi.installMd('personal', MARKDOWN)
    await skillsApi.installZip('shared', 'UEsDBA==')
    await skillsApi.toggle('personal', 'smoke-skill', false)
    await skillsApi.remove('shared', 'smoke-skill')
    expect(captured.map(row => row.url)).toStrictEqual([
      '/api/skills-manage/save', '/api/skills-manage/save', '/api/skills-manage/install-md',
      '/api/skills-manage/install-zip', '/api/skills-manage/toggle', '/api/skills-manage/delete',
    ])
    expect(captured[0]?.body.payload?.args).toStrictEqual({ scope: 'personal', markdown: MARKDOWN })
    expect(captured[1]?.body.payload?.args).toStrictEqual({ scope: 'shared', markdown: MARKDOWN, name: 'smoke-skill' })
    expect(captured[2]?.body.payload?.args).toStrictEqual({ scope: 'personal', content: MARKDOWN })
    expect(captured[3]?.body.payload?.args).toStrictEqual({ scope: 'shared', dataBase64: 'UEsDBA==' })
    expect(captured[4]?.body.payload?.args).toStrictEqual({ scope: 'personal', name: 'smoke-skill', enabled: false })
    expect(captured[5]?.body.payload?.args).toStrictEqual({ scope: 'shared', name: 'smoke-skill' })
  })
})

describe('技能页签与写权限', () => {
  it('三个页签常驻(我的/共享/市场);scope 映射与写权限按角色', () => {
    expect(SKILL_TABS.map(tab => `${tab.id}/${tab.labelKey}`)).toStrictEqual([
      'mine/skills.tab.mine', 'shared/skills.tab.shared', 'market/skills.tab.market',
    ])
    expect(scopeOfTab('mine')).toBe('personal')
    expect(scopeOfTab('shared')).toBe('shared')
    expect(tabOfScope('personal')).toBe('mine')
    expect(tabOfScope('shared')).toBe('shared')
    expect(writableFor('admin', 'personal')).toBe(true)
    expect(writableFor('admin', 'shared')).toBe(true)
    expect(writableFor('user', 'personal')).toBe(true)
    expect(writableFor('user', 'shared')).toBe(false)
  })

  it('列表按 scope 过滤,不混入对方技能', () => {
    const items: readonly SkillItemView[] = [
      { scope: 'personal', name: 'a', description: '', enabled: true, origin: 'form', files: 1, bytes: 10, updatedAt: 0 },
      { scope: 'shared', name: 'b', description: '', enabled: true, origin: 'form', files: 1, bytes: 10, updatedAt: 0 },
    ]
    expect(itemsOfScope(items, 'personal').map(item => item.name)).toStrictEqual(['a'])
    expect(itemsOfScope(items, 'shared').map(item => item.name)).toStrictEqual(['b'])
  })
})

describe('上传/编辑器前置校验与展示', () => {
  it('扩展名、空文件、大小上限;md 大小写不敏感', () => {
    expect(uploadIssue('md', { name: 'SKILL.MD', size: 10 })).toBeUndefined()
    expect(uploadIssue('md', { name: 'skill.txt', size: 10 })).toBe('kind')
    expect(uploadIssue('zip', { name: 'skill.md', size: 10 })).toBe('kind')
    expect(uploadIssue('zip', { name: 'skill.zip', size: 10 })).toBeUndefined()
    expect(uploadIssue('md', { name: 'skill.md', size: 0 })).toBe('empty')
    expect(uploadIssue('md', { name: 'skill.md', size: SKILL_MARKDOWN_CLIENT_MAX + 1 })).toBe('too-large')
    expect(uploadIssue('zip', { name: 'skill.zip', size: SKILL_ZIP_CLIENT_MAX + 1 })).toBe('too-large')
    expect(uploadIssueMessageKey('md', 'kind')).toBe('skills.onlyMd')
    expect(uploadIssueMessageKey('zip', 'kind')).toBe('skills.onlyZip')
    expect(uploadIssueMessageKey('md', 'too-large')).toBe('skills.mdTooLarge')
    expect(uploadIssueMessageKey('zip', 'too-large')).toBe('skills.zipTooLarge')
  })

  it('编辑器空内容/超字节上限被客户端先拦下', () => {
    expect(markdownIssue('   \n')).toBe('empty')
    expect(markdownIssue(MARKDOWN)).toBeUndefined()
    // 中文按 UTF-8 字节判:字符数未超、字节数已超
    const wide = '技'.repeat(Math.ceil(SKILL_MARKDOWN_CLIENT_MAX / 3) + 1)
    expect(markdownIssue(wide)).toBe('too-large')
    expect(markdownIssueMessageKey('empty')).toBe('skills.mdEmpty')
    expect(markdownIssueMessageKey('too-large')).toBe('skills.mdTooLarge')
  })

  it('字节/配额/文件数文案', () => {
    expect(bytesLabel(0)).toBe('0 B')
    expect(bytesLabel(512)).toBe('512 B')
    expect(bytesLabel(1024)).toBe('1 KB')
    expect(bytesLabel(1536)).toBe('1.5 KB')
    expect(bytesLabel(10 * 1024)).toBe('10 KB')
    expect(bytesLabel(2 * 1024 * 1024)).toBe('2 MB')
    expect(quotaLabel('已用 {used}/{limit}', 3, 32)).toBe('已用 3/32')
    expect(countLabel('{count} 个文件', 4)).toBe('4 个文件')
    expect(originLabelKey('form')).toBe('skills.originForm')
    expect(originLabelKey('upload-md')).toBe('skills.originUploadMd')
    expect(originLabelKey('upload-zip')).toBe('skills.originZip')
    expect(originLabelKey('whatever')).toBe('skills.originInstalled')
  })

  it('base64 分块编码与 Node Buffer 一致', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251)
    expect(base64FromBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    expect(base64FromBytes(Uint8Array.from([0, 1, 2, 255]))).toBe('AAEC/w==')
  })
})

describe('frontmatter 预览', () => {
  it('解析 name/description/whenToUse,支持引号/别名/BOM', () => {
    const markdown = '\uFEFF---\nname: smoke-skill\ndescription: "含: 冒号 # 井号"\nwhen-to-use: 排查联调问题\n---\n\n正文\n'
    expect(frontmatterPreview(markdown)).toStrictEqual({
      name: 'smoke-skill',
      description: '含: 冒号 # 井号',
      whenToUse: '排查联调问题',
    })
    expect(frontmatterPreview("---\nname: 'a-skill'\ndescription: 'it''s fine # comment'\n---\n")).toStrictEqual({
      name: 'a-skill', description: "it's fine # comment",
    })
  })

  it('无 frontmatter / 未闭合 / 缩进行不被误读', () => {
    expect(frontmatterPreview('# 只有正文\n')).toStrictEqual({})
    expect(frontmatterPreview('---\nname: x\n')).toStrictEqual({})
    expect(frontmatterPreview('---\nname: x\n  description: indented\n---\n')).toStrictEqual({ name: 'x' })
  })

  it('新建模板可被预览识别', () => {
    expect(frontmatterPreview(newSkillTemplate()).name).toBe('my-skill')
    expect(frontmatterPreview(newSkillTemplate()).description).toBeTruthy()
  })
})

describe('源码纪律与文案', () => {
  const files = ['skills-section.tsx', 'skills-model.ts', 'skills-api.ts', 'skills-locales.ts']

  it('index 注册左侧入口:main keyed 页 + sidebar.panellist 同 key、注入 role', () => {
    const source = readClient('index.tsx')
    expect(source).toContain('const SKILLS_PANEL_ID = `${NS}.skills`')
    expect(source).toMatch(/name: 'main',\s*\n\s*key: SKILLS_PANEL_ID,/u)
    expect(source).toMatch(/name: 'sidebar\.panellist',\s*\n\s*id: SKILLS_PANEL_ID,/u)
    expect(source).toContain("label: () => t('section.skills')")
    expect(source).toContain('inject: () => ({ t, role })')
    // 设置分区已移除(2026-11-26 用户裁定:配置只在左侧入口)
    expect(source).not.toContain('id: `${NS}.skills`,\n      order: 49,')
  })

  it('页面外壳带标题/描述与侧栏图标;不再是设置分区节点', () => {
    const page = readClient('skills-section.tsx')
    expect(page).toContain('ea-page')
    expect(page).toContain('ea-page-title')
    expect(page).toContain('data-eterna-skills-page')
    expect(page).toContain('export function SkillsNavIcon')
    expect(page).not.toContain('data-eterna-settings-section')
  })

  it('卡片复用插件页类名与通用页签;编辑器/删除走两击组件', () => {
    const section = readClient('skills-section.tsx')
    for (const token of ['ea-cards', 'ea-pcard', 'ea-phead', 'ea-pmain', 'ea-ptitle-row', 'ea-pill', 'ea-pend']) {
      expect(section, token).toContain(token)
    }
    expect(section).toContain('ea-tabs')
    expect(section).toContain('ea-tab')
    expect(section).toContain('data-eterna-skill-editor')
    expect(section).toContain('ArmedDelete')
    expect(section).toContain("t('skills.deleteConfirm')")
    expect(section).not.toMatch(/ea-mcp-/u)
    expect(section).toContain('Icon name="knowledge"')
  })

  it('源码引用的 skills.* 键 zh/en 全部存在且非空', () => {
    const sourceKeys = new Set<string>()
    for (const file of files) {
      for (const match of readClient(file).matchAll(/\bskills\.[a-z][a-zA-Z0-9.]*/gu)) sourceKeys.add(match[0])
    }
    expect(sourceKeys.size).toBeGreaterThan(40)
    for (const key of sourceKeys) {
      expect((SKILL_LOCALES.zh as Record<string, string>)[key], `zh:${key}`).toBeTruthy()
      expect((SKILL_LOCALES.en as Record<string, string>)[key], `en:${key}`).toBeTruthy()
    }
  })

  it('zh/en 键集合一致', () => {
    expect(Object.keys(SKILL_LOCALES.en).sort()).toStrictEqual(Object.keys(SKILL_LOCALES.zh).sort())
    expect(SKILL_LOCALES.zh['section.skills']).toBe('技能')
  })

  it('说明类文案 ≤40 字(42 号 §3 段落预算)', () => {
    for (const key of ['skills.adminHint', 'skills.userHint', 'skills.mineEmpty', 'skills.sharedEmpty', 'skills.readOnlyHint'] as const) {
      expect(SKILL_LOCALES.zh[key].length, key).toBeLessThanOrEqual(40)
    }
  })

  it('无原生 confirm()/alert()、无字面色值', () => {
    for (const file of files) {
      const source = readClient(file)
      expect(source, file).not.toMatch(/\bwindow\.confirm\s*\(|\bwindow\.alert\s*\(/u)
      expect(source, file).not.toMatch(/\balert\(/u)
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    }
  })
})
