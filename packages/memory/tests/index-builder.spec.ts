import { describe, expect, it } from 'vitest'
import { buildEntityIndex, estimateTokens, MEMORY_BEHAVIOR_HEADER } from '../src/index.ts'
import type { EntityRecord } from '../src/index.ts'

function record(overrides: Partial<EntityRecord> & { key: string }): EntityRecord {
  return {
    id: 1,
    subject: 'user:alice',
    content: '正文内容',
    summary: null,
    validAt: 1_000,
    invalidAt: null,
    confidence: 0.8,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

describe('buildEntityIndex(systemPrompt 注入载荷)', () => {
  it('无记录:占位文本(行为指令头常驻 + 占位索引,整体有上界)', () => {
    const result = buildEntityIndex([])
    expect(result.text).toContain('## 长期记忆') // 行为指令头常驻(后台自主语义,c7428ee 起 6 行 ≈ 240 token)
    expect(result.text).toContain('暂无长期记忆') // 占位索引
    expect(result.included).toBe(0)
    expect(result.estimatedTokens).toBeLessThan(300)
  })

  it('少量记录:全量收录,含 key 与一句话摘要', () => {
    const result = buildEntityIndex([
      record({ key: 'prefers-email-summary', summary: '偏好邮件摘要', confidence: 0.9 }),
      record({ key: 'timezone', summary: '常驻上海时区' }),
    ])
    expect(result.included).toBe(2)
    expect(result.omitted).toBe(0)
    expect(result.text).toContain('- [user:alice] prefers-email-summary — 偏好邮件摘要 (conf 0.90)')
    expect(result.text).toContain('memory_read')
  })

  it('summary 缺省时从 content 派生首句并截断', () => {
    const result = buildEntityIndex([
      record({ key: 'k', content: '这是一段很长的正文,包含多个分句。第二句不该出现。' }),
    ], { maxSummaryChars: 8 })
    expect(result.text).toContain('这是一段很长的正…')
  })

  it('预算硬顶:海量记录下整段 token ≤ 500,低优先级截断且计数守恒', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 120; index += 1) {
      records.push(record({
        id: index + 1,
        key: `memory-key-${index}`,
        summary: `第${index}条业务约定与执行口径的摘要说明`,
        confidence: (index % 10) / 10,
        updatedAt: index,
      }))
    }
    const result = buildEntityIndex(records)
    expect(result.total).toBe(120)
    expect(result.included + result.omitted).toBe(120)
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.text).toMatch(/\+\d+ 条未列出/)
    expect(result.estimatedTokens).toBeLessThanOrEqual(500)
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(500)
  })

  it('截断从低优先级端开始:confidence 高者必在索引内', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 80; index += 1) {
      records.push(record({ id: index + 1, key: `k-${index}`, summary: `摘要编号${index}`, confidence: 0.1, updatedAt: index }))
    }
    records.push(record({ id: 999, key: 'top-priority', summary: '最重要的一条', confidence: 1, updatedAt: 999 }))
    const result = buildEntityIndex(records)
    expect(result.text).toContain('top-priority')
    // 最低优先级(k-0,updatedAt 最旧)被截断;k-0 的摘要「摘要编号0」随之缺席
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.text).not.toContain('摘要编号0')
    expect(result.text).toContain('摘要编号79')
  })

  it('自定义更小预算同样守恒且不超(预算约束索引段;行为指令头常驻不计入预算)', () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record({ id: index + 1, key: `k-${index}`, summary: `摘要${index}`, confidence: 0.5 }))
    const result = buildEntityIndex(records, { budgetTokens: 400 }) // 小于默认 500,大于常驻头部 ≈240
    expect(result.estimatedTokens).toBeLessThanOrEqual(400)
    expect(result.included + result.omitted).toBe(30)
  })
})

describe('behaviorHeader 选项(T2.6 登记制:注册表条目覆写行为指令头)', () => {
  it('缺省=内置 MEMORY_BEHAVIOR_HEADER(注册表缺席时的原内联兜底,非空)', () => {
    const fallback = buildEntityIndex([]).text
    expect(fallback).toContain(MEMORY_BEHAVIOR_HEADER)
    expect(MEMORY_BEHAVIOR_HEADER.trim().length).toBeGreaterThan(0)
  })

  it('显式覆写:头部换成给定文本,索引半边(key+摘要)不受影响', () => {
    const header = '## 长期记忆(注册表版行为指令,T2.6)'
    const withRecords = buildEntityIndex(
      [record({ key: 'prefers-email-summary', summary: '偏好邮件摘要' })],
      { behaviorHeader: header },
    )
    expect(withRecords.text).toContain(header)
    expect(withRecords.text).not.toContain('后台机制——由你自主管理')
    expect(withRecords.text).toContain('- [user:alice] prefers-email-summary — 偏好邮件摘要 (conf 0.80)')
    // 空记录分支同样走覆写头(占位索引形态)。
    const empty = buildEntityIndex([], { behaviorHeader: header })
    expect(empty.text).toContain(header)
    expect(empty.text).toContain('暂无长期记忆')
  })
})
