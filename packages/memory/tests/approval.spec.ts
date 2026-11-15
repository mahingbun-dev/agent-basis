/**
 * M-M2 T9 审批闭环(19 号 §4-T9 + 勘察 S2 结论):
 * - buildMemoryApprovalCard:pending 产生时组 interact ApprovalCardInput
 *   (标题「从本次会话学到…」/Why=出处会话摘要/影响面=记忆库文件/
 *   回滚=评审拒绝),经 buildApprovalCard fail-closed 校验并渲染 detail;
 *   送达 = 面板审批队列(类型复用,不投官方通道,S2 结论);
 * - memoryApprovalAskRequest:官方 user-questions 载荷预留切换面(Action=
 *   记住/跳过,选项恰覆盖 approve/reject);
 * - buildSessionDigest:出处会话摘要(首行剥前缀截断;PII fail-closed 回退);
 * - MemoryAuditLedger:提案/门控/审批各一行 JSONL(.eterna/memory-audit.jsonl),
 *   写入 fail-open(warn 不抛),readAll 坏行忽略。
 */
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMemoryApprovalCard, buildSessionDigest, BuiltinPiiGuard,
  defaultMemoryAuditPath, MemoryAuditLedger, memoryApprovalAskRequest,
  MEMORY_APPROVE_LABEL, MEMORY_CARD_DIGEST_MAX_CHARS, MEMORY_DIGEST_ABSENT,
  MEMORY_DIGEST_PII_FALLBACK, MEMORY_REJECT_LABEL, MEMORY_REVIEW_CARD_TITLE,
  MEMORY_REVIEW_GRADE, MEMORY_REVIEW_RULE_ID, truncateDigest,
} from '../src/index.ts'
import type { ConsolidationLogger } from '../src/index.ts'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eterna-memory-approval-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 组卡事实(单条待审;可覆写)。 */
function cardSpec(overrides: Partial<Parameters<typeof buildMemoryApprovalCard>[0]> = {}): Parameters<typeof buildMemoryApprovalCard>[0] {
  return {
    sessionId: 'session-a',
    turnRef: 'turn:7',
    sessionDigest: '以后周报用中文',
    items: [{ id: 11, subject: 'user', key: 'weekly-report-language', summary: '周报用中文' }],
    ...overrides,
  }
}

describe('buildMemoryApprovalCard(T9 组卡,19 号 §4-T9.2 + S2 结论)', () => {
  it('标题/Why=出处会话摘要/影响面=记忆库文件/回滚=评审拒绝,renderedDetail 齐备', () => {
    const card = buildMemoryApprovalCard(cardSpec())
    expect(card.why.name).toBe(MEMORY_REVIEW_CARD_TITLE)
    expect(card.why.source).toBe('user')
    expect(card.why.entry).toContain('出处会话摘要:以后周报用中文')
    expect(card.matchedRule.ruleId).toBe(MEMORY_REVIEW_RULE_ID)
    expect(card.matchedRule.grade).toBe('R2')
    expect(card.rollback.reversible).toBe(true)
    expect(card.rollback.inverseOf).toContain('评审拒绝')
    expect(card.impact.files[0]?.path).toBe('.eterna/memory.sqlite3')
    expect(card.impact.files[0]?.diffSummary).toContain('待审记忆 1 条')
    expect(card.impact.files[0]?.diffSummary).toContain('weekly-report-language')
    // detail 渲染:标题、摘要、影响面、命中规则都在
    expect(card.renderedDetail).toContain(MEMORY_REVIEW_CARD_TITLE)
    expect(card.renderedDetail).toContain('以后周报用中文')
    expect(card.renderedDetail).toContain('## 影响面')
    expect(card.renderedDetail).toContain(MEMORY_REVIEW_RULE_ID)
  })

  it('多条待审:参数与影响面带全部 id/key;storeLabel 覆写展示路径', () => {
    const card = buildMemoryApprovalCard(cardSpec({
      items: [
        { id: 11, subject: 'user', key: 'weekly-report-language', summary: '周报用中文' },
        { id: 12, subject: 'domain:deploy', key: 'deploy-blue-green', summary: '部署用蓝绿' },
      ],
      storeLabel: join(dir, 'memory.sqlite3'),
    }))
    expect(card.whatWillHappen.paramsPreview).toContain('"ids":[11,12]')
    expect(card.whatWillHappen.paramsPreview).toContain('"turnRef":"turn:7"')
    expect(card.impact.files[0]?.path).toBe(join(dir, 'memory.sqlite3'))
    expect(card.impact.files[0]?.diffSummary).toContain('待审记忆 2 条')
  })

  it('fail-closed:空待审集前置拒绝(无待审行不组卡,不空转校验器)', () => {
    expect(() => buildMemoryApprovalCard(cardSpec({ items: [] }))).toThrow(RangeError)
    expect(() => buildMemoryApprovalCard(cardSpec({ items: [] }))).toThrow('至少要有一条待审记忆')
  })
})

describe('memoryApprovalAskRequest(官方通道预留切换面,S2 结论 3)', () => {
  it('1 问 + Action=记住/跳过:选项恰覆盖 approve/reject,intent 为 approval 分支', () => {
    const card = buildMemoryApprovalCard(cardSpec())
    const request = memoryApprovalAskRequest(card, 'memory-review:session-a:7')
    expect(request.questions).toHaveLength(1)
    const question = request.questions[0]!
    expect(question.id).toBe('memory-review:session-a:7')
    expect(question.intent?.kind).toBe('approval')
    if (question.intent?.kind === 'approval') {
      expect(question.intent.approve).toBe(MEMORY_APPROVE_LABEL)
      expect(question.intent.reject).toBe(MEMORY_REJECT_LABEL)
      expect(question.intent.subject?.name).toBe(MEMORY_REVIEW_CARD_TITLE)
    }
    expect(question.options?.map(option => option.label)).toEqual([MEMORY_APPROVE_LABEL, MEMORY_REJECT_LABEL])
    expect(question.detail).toContain(MEMORY_REVIEW_CARD_TITLE)
  })
})

describe('摘要面(truncateDigest / buildSessionDigest)', () => {
  it('truncateDigest:超长截断加省略号;高位代理项丢弃不碎字形', () => {
    expect(truncateDigest('以后周报用中文')).toBe('以后周报用中文')
    const long = 'a'.repeat(MEMORY_CARD_DIGEST_MAX_CHARS + 10)
    expect(truncateDigest(long)).toHaveLength(MEMORY_CARD_DIGEST_MAX_CHARS + 1)
    // 代理对(😀 = 两个 UTF-16 码元)恰好压线时不劈半个
    const surrogateEdge = `${'x'.repeat(MEMORY_CARD_DIGEST_MAX_CHARS - 1)}😀`
    expect(truncateDigest(surrogateEdge)).not.toContain('\ud83d')
  })

  it('buildSessionDigest:首行剥 [用户]/[助手] 前缀后截断;空快照给占位', () => {
    const pii = new BuiltinPiiGuard()
    expect(buildSessionDigest('[用户] 以后周报用中文\n[助手] 好的', pii)).toBe('以后周报用中文')
    expect(buildSessionDigest('[助手] 好的,之后周报都用中文。', pii)).toBe('好的,之后周报都用中文。')
    expect(buildSessionDigest('', pii)).toBe(MEMORY_DIGEST_ABSENT)
    expect(buildSessionDigest('\n  \n', pii)).toBe(MEMORY_DIGEST_ABSENT)
  })

  it('buildSessionDigest:PII 命中 fail-closed 回退占位(原文字节不外带)', () => {
    const pii = new BuiltinPiiGuard()
    const digest = buildSessionDigest('[用户] 我的手机号是 13800138000,周报发这个号', pii)
    expect(digest).toBe(MEMORY_DIGEST_PII_FALLBACK)
    expect(digest).not.toContain('13800138000')
  })
})

describe('MemoryAuditLedger(提案/门控/审批各一行 JSONL,19 号 §4-T9.4)', () => {
  /** 静默日志假体(记录 warn,不打印)。 */
  function fakeLogger(): { readonly logger: ConsolidationLogger; readonly warns: string[] } {
    const warns: string[] = []
    return { warns, logger: { warn: (message: string): void => { warns.push(message) } } }
  }

  it('defaultMemoryAuditPath:与 sqlite 同目录推导', () => {
    expect(defaultMemoryAuditPath(join(dir, 'memory.sqlite3'))).toBe(join(dir, 'memory-audit.jsonl'))
  })

  it('三类事件各一行,readAll 按写入序回读(time 由注入时钟生成)', () => {
    let tick = 0
    const ledger = new MemoryAuditLedger({
      path: join(dir, 'memory-audit.jsonl'),
      now: (): number => { tick += 1; return Date.UTC(2026, 10, 13, 0, 0, tick) },
    })
    ledger.recordProposal({
      sessionId: 'session-a', turn: 7, source: 'consolidation',
      add: 1, update: 0, noop: 0, forgotten: 0, superseded: 0, skipped: 1,
      skipReasons: ['k1:PII 拦截'],
      pending: [{ id: 11, subject: 'user', key: 'weekly-report-language', summary: '周报用中文' }],
      card: { title: MEMORY_REVIEW_CARD_TITLE, ruleId: MEMORY_REVIEW_RULE_ID, grade: MEMORY_REVIEW_GRADE, detail: '## 将发生什么' },
    })
    ledger.recordGate({ sessionId: 'session-b', reason: 'direct-write' })
    ledger.recordReview({ id: 11, decision: 'approved', subject: 'user', key: 'weekly-report-language' })
    const events = ledger.readAll()
    expect(events.map(event => event.kind)).toEqual(['proposal', 'gate', 'review'])
    expect(events[0]).toMatchObject({
      kind: 'proposal', sessionId: 'session-a', turn: 7, source: 'consolidation',
      add: 1, skipped: 1, pending: [{ id: 11, key: 'weekly-report-language' }],
      card: { title: MEMORY_REVIEW_CARD_TITLE, grade: 'R2' },
    })
    expect(events[0]?.time).toBe('2026-11-13T00:00:01.000Z')
    expect(events[1]).toMatchObject({ kind: 'gate', sessionId: 'session-b', reason: 'direct-write' })
    expect(events[2]).toMatchObject({ kind: 'review', id: 11, decision: 'approved' })
    // 物理形态:三行 JSONL
    expect(events.length).toBe(3)
  })

  it('文件不存在 readAll 空;坏行忽略不炸;目录惰性创建', () => {
    const ledger = new MemoryAuditLedger({ path: join(dir, 'nested', 'memory-audit.jsonl') })
    expect(ledger.readAll()).toEqual([])
    ledger.recordGate({ sessionId: 's', reason: 'no-user-prose' })
    expect(ledger.readAll()).toHaveLength(1) // 目录自动创建后落行
  })

  it('写入失败 fail-open:warn 告警不抛(主流程不反噬)', () => {
    const { logger, warns } = fakeLogger()
    // 先建同名目录再写:appendFileSync 抛 EISDIR → warn
    mkdirSync(join(dir, 'i-am-a-directory'))
    const ledger = new MemoryAuditLedger({ path: join(dir, 'i-am-a-directory'), logger })
    expect(() => { ledger.recordReview({ id: 1, decision: 'rejected', subject: 'user', key: 'k' }) }).not.toThrow()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('审计账本写入失败')
  })
})
