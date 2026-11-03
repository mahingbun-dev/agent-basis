/**
 * SKILL.md 条目解析器 + 五种 delta 纯函数单测。
 * 断言口径:解析产物结构 / delta 语义 / fail-closed 错误路径 / round-trip 稳定性。
 */
import { describe, expect, it } from 'vitest'
import {
  activeEntries, applyDeltas, archivedEntries, nextEntryId, pairEntries, parseSkillDoc, renderSkillDoc,
} from '../src/index.ts'
import type { SkillDelta, SkillDoc } from '../src/index.ts'
import { DEMO_SKILL_MD } from './helpers.ts'

describe('parseSkillDoc', () => {
  it('双条目解析:meta 计数器 + 正文切片', () => {
    const parsed = parseSkillDoc(DEMO_SKILL_MD)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.name).toBe('core-workflow')
    expect(activeEntries(parsed.doc).map(e => e.meta.id)).toEqual(['S-core-workflow-001', 'S-core-workflow-002'])
    const first = parsed.doc.entries[0]
    expect(first?.meta.helpful).toBe(4)
    expect(first?.body).toContain('hitl.yaml')
    expect(first?.body).not.toContain('<!--')
    expect(parsed.doc.entries[1]?.body).toContain('草稿文件')
  })

  it('fail-closed:锚点缺闭合 / 条目缺锚点 / 重复 id', () => {
    const noClose = DEMO_SKILL_MD.replace('<!-- /E -->\n\n## 注意', 'text\n\n## 注意')
    expect(parseSkillDoc(noClose)).toMatchObject({ ok: false })
    const noAnchor = DEMO_SKILL_MD.replace('<!-- E: S-core-workflow-002 -->', '<!-- E: S-core-workflow-003 -->')
    expect(parseSkillDoc(noAnchor)).toMatchObject({ ok: false })
    const dup = `${DEMO_SKILL_MD}<!-- E: S-core-workflow-001 -->\nx\n<!-- /E -->\n`
    expect(parseSkillDoc(dup)).toMatchObject({ ok: false })
    expect(parseSkillDoc('no frontmatter')).toMatchObject({ ok: false })
  })

  it('round-trip:render(parse(x)) 再 parse 等值', () => {
    const parsed = parseSkillDoc(DEMO_SKILL_MD)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = renderSkillDoc(parsed.doc)
    const reparsed = parseSkillDoc(rendered)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(activeEntries(reparsed.doc).map(e => [e.meta.id, e.meta.helpful, e.body]))
      .toEqual(activeEntries(parsed.doc).map(e => [e.meta.id, e.meta.helpful, e.body]))
    // frontmatter 未知字段保留
    expect(reparsed.doc.frontmatter['description']).toBe(parsed.doc.frontmatter['description'])
  })
})

describe('add_entry', () => {
  it('追加条目:frontmatter 计数器 0 起 + 锚点块落活跃区末尾 + origin 血缘', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const op: SkillDelta = {
      type: 'add_entry',
      body: '遇到预算变更先走 R3 审批再调整方案。',
      origin: 'sig-1+sig-2',
      date: '2026-11-03',
    }
    const result = applyDeltas(doc, [op])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.doc.entries.map(e => e.meta.id)
    expect(ids).toContain('S-core-workflow-003')
    const added = result.doc.entries.find(e => e.meta.id === 'S-core-workflow-003')
    expect(added?.meta.helpful).toBe(0)
    expect(added?.meta.origin).toBe('sig-1+sig-2')
    expect(added?.meta.updated).toBe('2026-11-03')
    // 生成文本可重解析(packctl 口径配对成立)
    const reparsed = parseSkillDoc(renderSkillDoc(result.doc))
    expect(reparsed.ok).toBe(true)
    // 既有条目不受影响
    expect(result.doc.entries[0]?.meta.id).toBe('S-core-workflow-001')
  })

  it('指定 after:插到目标条目之后', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [{ type: 'add_entry', body: '新步骤', after: 'S-core-workflow-001', date: '2026-11-03' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const idx = result.doc.entries.map(e => e.meta.id)
    expect(idx).toEqual(['S-core-workflow-001', 'S-core-workflow-003', 'S-core-workflow-002'])
  })

  it('fail-closed:重复 id / 空 body / after 不存在', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    expect(applyDeltas(doc, [{ type: 'add_entry', id: 'S-core-workflow-001', body: 'x', date: '2026-11-03' }])).toMatchObject({ ok: false })
    expect(applyDeltas(doc, [{ type: 'add_entry', body: '  ', date: '2026-11-03' }])).toMatchObject({ ok: false })
    expect(applyDeltas(doc, [{ type: 'add_entry', body: 'x', after: 'S-nope', date: '2026-11-03' }])).toMatchObject({ ok: false })
  })
})

describe('update_entry / bump_counter', () => {
  it('update:改写正文 + updated 刷新,锚点 id 不变', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [{ type: 'update_entry', id: 'S-core-workflow-002', body: '对外发射一律 withhold-或-补偿。', date: '2026-11-03' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entry = result.doc.entries.find(e => e.meta.id === 'S-core-workflow-002')
    expect(entry?.body).toBe('对外发射一律 withhold-或-补偿。')
    expect(entry?.meta.updated).toBe('2026-11-03')
    // 原文未被改写(纯函数)
    expect(mustParse(DEMO_SKILL_MD).entries[1]?.body).toContain('草稿文件')
  })

  it('bump:helpful/harmful 自增、负纠错 clamp 到 0、updated 刷新', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const bumped = applyDeltas(doc, [{ type: 'bump_counter', id: 'S-core-workflow-001', counter: 'helpful', date: '2026-11-03' }])
    expect(bumped.ok && bumped.doc.entries[0]?.meta.helpful).toBe(5)
    const floored = applyDeltas(doc, [{ type: 'bump_counter', id: 'S-core-workflow-001', counter: 'harmful', by: -10, date: '2026-11-03' }])
    expect(floored.ok && floored.doc.entries[0]?.meta.harmful).toBe(0)
    expect(applyDeltas(doc, [{ type: 'bump_counter', id: 'S-nope', counter: 'helpful', date: '2026-11-03' }])).toMatchObject({ ok: false })
  })
})

describe('deprecate_entry', () => {
  it('移入归档节:正文保留、activeEntries 不再输出、meta 带 deprecated_at', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [{ type: 'deprecate_entry', id: 'S-core-workflow-002', date: '2026-11-03', reason: 'audit' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(activeEntries(result.doc).map(e => e.meta.id)).toEqual(['S-core-workflow-001'])
    const archived = archivedEntries(result.doc)
    expect(archived.map(e => e.meta.id)).toEqual(['S-core-workflow-002'])
    expect(archived[0]?.meta.deprecatedAt).toBe('2026-11-03')
    const text = renderSkillDoc(result.doc)
    expect(text).toContain('## 已废弃(Evo Archive)')
    expect(text).toContain('草稿文件') // 归档≠删除:正文物理保留供溯源
    // 序列化后再解析,归档语义保持(packctl 配对也成立)
    const reparsed = parseSkillDoc(text)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(activeEntries(reparsed.doc).map(e => e.meta.id)).toEqual(['S-core-workflow-001'])
  })

  it('幂等拒绝:重复 deprecate / superseded_by 不存在 → fail-closed', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const once = applyDeltas(doc, [{ type: 'deprecate_entry', id: 'S-core-workflow-002', date: '2026-11-03' }])
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(applyDeltas(once.doc, [{ type: 'deprecate_entry', id: 'S-core-workflow-002', date: '2026-11-04' }])).toMatchObject({ ok: false })
    expect(applyDeltas(doc, [{ type: 'deprecate_entry', id: 'S-core-workflow-002', date: '2026-11-03', supersededBy: 'S-nope' }])).toMatchObject({ ok: false })
  })

  it('deprecate 后 add 默认落在归档节之前', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [
      { type: 'deprecate_entry', id: 'S-core-workflow-002', date: '2026-11-03' },
      { type: 'add_entry', body: '后续条目', date: '2026-11-03' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = renderSkillDoc(result.doc)
    expect(text.indexOf('<!-- E: S-core-workflow-003')).toBeLessThan(text.indexOf('## 已废弃(Evo Archive)'))
    expect(text.indexOf('<!-- E: S-core-workflow-002')).toBeGreaterThan(text.indexOf('## 已废弃(Evo Archive)'))
    expect(applyDeltas(result.doc, [{ type: 'add_entry', body: 'x', after: 'S-core-workflow-002', date: '2026-11-03' }])).toMatchObject({ ok: false })
  })
})

describe('merge_entries', () => {
  it('合并:计数器求和、来源移除、merged_from 血缘、默认正文拼接', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [
      { type: 'bump_counter', id: 'S-core-workflow-002', counter: 'helpful', by: 2, date: '2026-11-03' },
      { type: 'merge_entries', into: 'S-core-workflow-001', from: ['S-core-workflow-002'], date: '2026-11-03' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.entries.map(e => e.meta.id)).toEqual(['S-core-workflow-001'])
    const merged = result.doc.entries[0]
    expect(merged?.meta.helpful).toBe(7) // 001(4) + 002(1 先 bump+2)
    expect(merged?.meta.mergedFrom).toEqual(['S-core-workflow-002'])
    expect(merged?.body).toContain('草稿文件') // 拼接保留来源正文
    const reparsed = parseSkillDoc(renderSkillDoc(result.doc))
    expect(reparsed.ok).toBe(true)
  })

  it('自定义合并正文 + fail-closed:from 含自身 / 来源不存在', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const custom = applyDeltas(doc, [{
      type: 'merge_entries',
      into: 'S-core-workflow-001',
      from: ['S-core-workflow-002'],
      body: '统一后的处置条目。',
      date: '2026-11-03',
    }])
    expect(custom.ok && custom.doc.entries[0]?.body).toBe('统一后的处置条目。')
    expect(applyDeltas(doc, [{ type: 'merge_entries', into: 'S-core-workflow-001', from: ['S-core-workflow-001'], date: '2026-11-03' }])).toMatchObject({ ok: false })
    expect(applyDeltas(doc, [{ type: 'merge_entries', into: 'S-core-workflow-001', from: [], date: '2026-11-03' }])).toMatchObject({ ok: false })
    expect(applyDeltas(doc, [{ type: 'merge_entries', into: 'S-core-workflow-001', from: ['S-nope'], date: '2026-11-03' }])).toMatchObject({ ok: false })
  })
})

describe('applyDeltas 组合', () => {
  it('提案即操作列表:bump+add+update 链式全过', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [
      { type: 'bump_counter', id: 'S-core-workflow-001', counter: 'helpful', date: '2026-11-03' },
      { type: 'add_entry', body: '新条目 A。', date: '2026-11-03' },
      { type: 'update_entry', id: 'S-core-workflow-003', body: '改写后的新条目 A。', date: '2026-11-04' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.entries).toHaveLength(3)
    expect(nextEntryId(result.doc)).toBe('S-core-workflow-004')
    // 生成全文重新过 pairEntries 校验(packctl G0 同口径)
    expect(pairEntries(result.doc.frontmatter, result.doc.body).ok).toBe(true)
  })

  it('链中失败即停:不产出半应用产物', () => {
    const doc = mustParse(DEMO_SKILL_MD)
    const result = applyDeltas(doc, [
      { type: 'bump_counter', id: 'S-core-workflow-001', counter: 'helpful', date: '2026-11-03' },
      { type: 'update_entry', id: 'S-nope', body: 'x', date: '2026-11-03' },
    ])
    expect(result).toMatchObject({ ok: false })
  })
})

function mustParse(text: string): SkillDoc {
  const parsed = parseSkillDoc(text)
  if (!parsed.ok) throw new Error(`fixture 解析失败:${parsed.error}`)
  return parsed.doc
}
