/** frontmatter 解析/序列化测试:字段校验、changelog/wikilink/snippet 提取、废弃必填、往返一致。 */
import { describe, expect, it } from 'vitest'
import { KnowledgeFormatError, formatCitation, parseWikiPage, serializeWikiPage } from '../src/index.ts'
import type { KnowledgeHit } from '../src/index.ts'

const FULL_PAGE = `---
title: 场地选址指南
tags: [场地, 指南]
status: active
trust: official
source: 《活动策划手册 v3.2》第4章
created: 2026-08-01
updated: 2026-10-12
last_verified: 2026-10-12
---
活动策划中的场地选址要素。目标场馆见 [[场馆名录]] 与 [[场地档期#2026Q4|明年档期]]。

## Changelog

- 2026-10-12: 年度核验通过
- 2026-08-01: 初版发布
`

describe('parseWikiPage', () => {
  it('解析全量 frontmatter 字段(status/trust/last_verified/superseded_by/source)', () => {
    const page = parseWikiPage(FULL_PAGE)
    expect(page.frontmatter.title).toBe('场地选址指南')
    expect(page.frontmatter.status).toBe('active')
    expect(page.frontmatter.trust).toBe('official')
    expect(page.frontmatter.source).toBe('《活动策划手册 v3.2》第4章')
    expect(page.frontmatter.last_verified).toBe('2026-10-12')
    expect(page.frontmatter.tags).toEqual(['场地', '指南'])
  })

  it('提取 changelog 条目(不改写历史)', () => {
    const page = parseWikiPage(FULL_PAGE)
    expect(page.changelog).toEqual([
      { date: '2026-10-12', note: '年度核验通过' },
      { date: '2026-08-01', note: '初版发布' },
    ])
  })

  it('提取 wikilink(忽略锚点与别名)', () => {
    const page = parseWikiPage(FULL_PAGE)
    expect(page.wikilinks).toEqual(['场馆名录', '场地档期'])
  })

  it('snippet 取首个非标题非空行', () => {
    const page = parseWikiPage(FULL_PAGE)
    expect(page.snippet).toBe('活动策划中的场地选址要素。目标场馆见 [[场馆名录]] 与 [[场地档期#2026Q4|明年档期]]。')
  })

  it('默认值:status=active、trust=official、agent_drafted 未标注 review 时默认 pending', () => {
    const page = parseWikiPage(`---
title: 草稿页
---
正文
`)
    expect(page.frontmatter.status).toBe('active')
    expect(page.frontmatter.trust).toBe('official')
    expect(page.frontmatter.review).toBe('reviewed')
    const draft = parseWikiPage(`---
title: 草稿页
trust: agent_drafted
---
正文
`)
    expect(draft.frontmatter.review).toBe('pending')
  })

  it('缺 frontmatter / 未闭合 / 非法枚举 / 非法日期均抛 KnowledgeFormatError', () => {
    expect(() => parseWikiPage('无定界符')).toThrow(KnowledgeFormatError)
    expect(() => parseWikiPage('---\ntitle: x\n')).toThrow(KnowledgeFormatError)
    expect(() => parseWikiPage('---\ntitle: x\nstatus: bogus\n---\n正文')).toThrow(KnowledgeFormatError)
    expect(() => parseWikiPage('---\ntitle: x\nupdated: 2026/10/12\n---\n正文')).toThrow(KnowledgeFormatError)
  })

  it('status=deprecated 必填 superseded_by(废弃必填)', () => {
    expect(() => parseWikiPage('---\ntitle: x\nstatus: deprecated\n---\n正文')).toThrow(/superseded_by/)
    const ok = parseWikiPage('---\ntitle: x\nstatus: deprecated\nsuperseded_by: doc-2\n---\n正文')
    expect(ok.frontmatter.superseded_by).toBe('doc-2')
  })

  it('title 缺省时回退正文一级标题', () => {
    const page = parseWikiPage('---\nstatus: active\n---\n\n# 从标题来\n\n正文')
    expect(page.frontmatter.title).toBe('从标题来')
  })
})

describe('serializeWikiPage 往返', () => {
  it('序列化 → 再解析,字段与正文语义一致', () => {
    const page = parseWikiPage(FULL_PAGE)
    const round = parseWikiPage(serializeWikiPage(page))
    expect(round.frontmatter).toEqual(page.frontmatter)
    expect(round.body).toBe(page.body)
  })
})

describe('formatCitation(统一引用输出,过期自带警示)', () => {
  const hit = (status: string, supersededBy?: string): KnowledgeHit => ({
    ref: { doc_id: 'd1', source_uri: 'file:///wiki/d1.md', backend: 'wiki-local' },
    title: '场地选址指南',
    snippet: '...',
    score: 0.9,
    provenance: {
      origin: '手册', updated: '2026-10-12', status: status as KnowledgeHit['provenance']['status'],
      ...(supersededBy !== undefined ? { superseded_by: supersededBy } : {}),
      trust: 'official', review: 'reviewed',
    },
  })

  it('active 页:更新日期 + 生效中', () => {
    expect(formatCitation(hit('active'))).toBe('[《场地选址指南》](file:///wiki/d1.md)(更新于 2026-10-12;生效中)')
  })

  it('deprecated 页:状态警示 + 取代者', () => {
    expect(formatCitation(hit('deprecated', 'doc-2'))).toContain('已废弃')
    expect(formatCitation(hit('deprecated', 'doc-2'))).toContain('已被 doc-2 取代')
  })
})
