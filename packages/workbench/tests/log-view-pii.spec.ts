/**
 * 日志监控视图 PII 测试(38 号 T10/G2-D8:展开路径经 PII 过滤器断言 +
 * 原文不改断言;30 号 §7-4 拍板——展示层只过滤不删改,redact 不拦展示)。
 */
import { describe, expect, it } from 'vitest'
import { PiiFilter } from '@eterna/governance'
import { LOG_TICKET_CHIPS, WORKER_SESSION_HEADING, filterLogs, matchesQuery } from '../src/project/trace-view.ts'
import { piiFilter, redactParagraphs, redactSegment, redactedFull } from '../src/project/pii-view.ts'
import { initialMockSnapshot } from '../src/stream/mock-source.ts'

const snapshot = initialMockSnapshot()
const fsRead = snapshot.logs.find(entry => entry.id === 't9c81-fs-read')!

describe('摘要行与过滤(L-1/L-2/L-3:audit trace 聚合 + 可过滤检索)', () => {
  it('工单 chip 三枚(T-9c81/T-a21f/T-3f2a);worker 会话小节标题逐字', () => {
    expect(LOG_TICKET_CHIPS).toEqual(['T-9c81', 'T-a21f', 'T-3f2a'])
    expect(WORKER_SESSION_HEADING).toBe('worker 会话日志（event-planning-01）')
  })

  it('T-9c81:audit 8 条 + worker 会话 2 条,时序保持快照序', () => {
    const groups = filterLogs(snapshot.logs, { ticketId: 'T-9c81', query: '' })
    expect(groups.audit.map(entry => entry.id)).toEqual([
      't9c81-trigger', 't9c81-eval', 't9c81-decision', 't9c81-assignment',
      't9c81-fs-read', 't9c81-web-fetch', 't9c81-report', 't9c81-outbox',
    ])
    expect(groups.workerSession.map(entry => entry.id)).toEqual(['t9c81-session-6', 't9c81-session-fetch'])
  })

  it('检索匹配三字段:来源(web.fetch)/摘要(报价)/状态(blocked);空检索全过', () => {
    const bySource = filterLogs(snapshot.logs, { ticketId: 'T-9c81', query: 'web.fetch' })
    expect(bySource.audit.map(entry => entry.source)).toEqual(['工具 web.fetch'])
    const bySummary = filterLogs(snapshot.logs, { ticketId: 'T-9c81', query: '报价口径' })
    expect(bySummary.audit.map(entry => entry.id)).toEqual(['t9c81-report'])
    const byStatus = filterLogs(snapshot.logs, { ticketId: 'T-9c81', query: 'blocked' })
    expect(byStatus.audit.map(entry => entry.id)).toEqual(['t9c81-report'])
    expect(matchesQuery(fsRead, '')).toBe(true)
  })

  it('摘要行四字段口径(L-3):工具名/参数摘要/结果状态/耗时 全条目齐备', () => {
    for (const entry of snapshot.logs) {
      expect(entry.source, entry.id).toBeTruthy()
      expect(entry.summary.length, entry.id).toBeGreaterThan(0)
      expect(entry.status.label, entry.id).toBeTruthy()
      expect(entry.duration, entry.id).toBeTruthy()
    }
  })
})

describe('展开全文 PII 过滤(L-4/L-5:经 governance redact;原文不改)', () => {
  it('mock 原文含明文手机号/邮箱(audit 原文;展示前不得出现在渲染面)', () => {
    const paragraphs = fsRead.full!
    expect(JSON.stringify(paragraphs)).toContain('13812345678')
    expect(JSON.stringify(paragraphs)).toContain('jing.chen@corp.com')
  })

  it('redactSegment:手机号/邮箱命中 → [PII:cn-mobile]/[PII:email](governance redact 契约)', () => {
    const redacted = redactSegment({ text: '联系人 13812345678 / 邮箱 jing.chen@corp.com（展示层 PII 正则脱敏）。' })
    expect(redacted.segments[0]!.text).toBe('联系人 [PII:cn-mobile] / 邮箱 [PII:email]（展示层 PII 正则脱敏）。')
    expect(redacted.findings.map(finding => finding.patternId).sort()).toEqual(['cn-mobile', 'email'])
  })

  it('redactParagraphs:段落结构/段内 mono 标记保留,findings 汇总', () => {
    const source = [
      [{ text: '参数全文：' }, { text: 'fs.read paths=[quote_a.pdf]', mono: true }],
      [{ text: '结果摘要：… 联系人 13812345678。' }],
    ]
    const result = redactParagraphs(source)
    expect(result.paragraphs[0]).toEqual([
      { text: '参数全文：' },
      { text: 'fs.read paths=[quote_a.pdf]', mono: true },
    ])
    expect(result.paragraphs[1]![0]!.text).toContain('[PII:cn-mobile]')
    expect(result.findings).toHaveLength(1)
  })

  it('原文不改断言(G2-D8):redact 返回新串,入口文本/快照对象逐字未动', () => {
    const before = JSON.stringify(fsRead.full)
    redactedFull(fsRead)
    expect(JSON.stringify(fsRead.full)).toBe(before)
    expect(JSON.stringify(initialMockSnapshot().logs.find(entry => entry.id === 't9c81-fs-read')!.full)).toBe(before)
  })

  it('redactedFull:fs.read 展开态两段,PII 双命中;无 PII 条目原样', () => {
    const full = redactedFull(fsRead)!
    expect(full).toHaveLength(2)
    expect(full[0]![0]!.text).toBe('参数全文：')
    expect(full[0]![1]!.mono).toBe(true)
    expect(full[1]![0]!.text).not.toContain('13812345678')
    const decision = redactedFull(snapshot.logs.find(entry => entry.id === 't9c81-decision')!)!
    expect(decision[0]![0]!.text).toBe('理由：名单内 + 明确 @；范围 = 三家供应商报价对比；Mandate v3 · L2 委派；stop 候选 0。')
  })

  it('可插拔正则(行业模式注入)与空命中路径', () => {
    const industry = new PiiFilter([...piiFilter.patterns, { id: 'quote-code', pattern: /quote_[a-z]\.pdf/gu }])
    const result = redactParagraphs([[{ text: '附件 quote_a.pdf 与 quote_b.pdf' }]], industry)
    expect(result.paragraphs[0]![0]!.text).toBe('附件 [PII:quote-code] 与 [PII:quote-code]')
    const clean = redactParagraphs([[{ text: '无敏感内容' }]], industry)
    expect(clean.findings).toHaveLength(0)
    expect(clean.paragraphs[0]![0]!.text).toBe('无敏感内容')
  })
})

describe('增量日志(log-appended 事件面)', () => {
  it('mock 时间线增量:轮次 7 会话行进入 worker 组', async () => {
    const { applyWorkbenchEvent } = await import('../src/project/state.ts')
    const { mockTimeline } = await import('../src/stream/mock-source.ts')
    const increment = mockTimeline()[1]!
    if (increment.event.kind !== 'log-appended') throw new Error('timeline[1] 应为 log-appended')
    const next = applyWorkbenchEvent(snapshot, { ...increment.event, seq: 3 })
    const groups = filterLogs(next.logs, { ticketId: 'T-9c81', query: '' })
    expect(groups.workerSession.map(entry => entry.id)).toContain('t9c81-session-7')
    expect(groups.audit).toHaveLength(8)
  })
})
