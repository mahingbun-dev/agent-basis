/**
 * 候选卡窗口与决策局部化逐参数断言(35 号 A19 验收门禁;34 号 §4-B 承接表
 * 「admission-context.spec.ts → candidate-context.spec.ts:窗口截断(前5+前后各5;
 * 400/1200/50 字符)逐参数断言(28 号 §1.1 表)」)。
 *
 * 依据条款:34 号 §2.5 candidate 行;28 号 §1.1 决策局部化四行(触发原文 ≤4000;
 * 线程窗口前 5 条 + 触发点前后各 5 条、400/1200 字符、其余 50 字符存根;related_tickets ≤8
 * open 优先 + tickets_total——Engine 计算不靠模型记忆,含已结束工单,27 号 §3.3-B 情况 B 防线)。
 * 语义自 SA tests/admission-context.spec.ts 整承接重写(Commands/feishu 面换纯函数面)。
 */
import { describe, expect, it } from 'vitest'
import {
  admissionContext, cut, NEAR_CHARS, preview, relatedTickets, RELATED_TICKETS,
  STUB_CHARS, textPage, threadWindow, TICKET_STATES, ticketCard, TRIGGER_CHARS, WINDOW_CHARS, windowProjection,
} from '../src/session/candidate.ts'
import type { ContextMessage, ThreadPage, TriggerContext } from '../src/session/assessor.ts'
import type { Ticket } from '../src/core/index.ts'

const message = (index: number): ContextMessage => ({ id: `m${index}`, from: 'alice', at: String(index), text: `Message ${index}` })

describe('threadWindow(前 5 条 + 触发点前后各 5 条;28 号 §1.1)', () => {
  it('返回线程开头与触发点近邻,并给出精确的内部与尾部缺口', () => {
    const result = threadWindow(Array.from({ length: 40 }, (_, i) => message(i)), 'm25')
    expect(result.entries.map(item => item.position)).toEqual([1, 2, 3, 4, 5, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
    // 第 6 条入选(位置 21)与上一条入选(位置 5)之间省略了 15 条。
    expect(result.entries[5]?.omitted_before).toBe(15)
    expect(result.omitted_after).toBe(9)
    expect(result.source_found).toBe(true)
  })

  it('重叠窗口去重,缺席的触发点不发明近邻', () => {
    const messages = Array.from({ length: 12 }, (_, i) => message(i))
    // 前 5 条 + 触发点(位置 6)前后各 5 条重叠合并为 1..9。
    expect(threadWindow(messages, 'm3').entries.map(item => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(threadWindow(messages, 'm_absent')).toMatchObject({ source_found: false, loaded_messages: 12, omitted_after: 7 })
  })
})

describe('窗口字符截断(400/1200/50;28 号 §1.1)', () => {
  it('常量即设计值(触发原文 4000、近邻 1200、窗口 400、存根 50、相关工单 8)', () => {
    expect(TRIGGER_CHARS).toBe(4000)
    expect(NEAR_CHARS).toBe(1200)
    expect(WINDOW_CHARS).toBe(400)
    expect(STUB_CHARS).toBe(50)
    expect(RELATED_TICKETS).toBe(8)
  })

  it('cut:未超限原样无计数,超限给截断文本与完整长度', () => {
    expect(cut('short', 400)).toEqual({ text: 'short' })
    const long = 'a'.repeat(401)
    expect(cut(long, 400)).toEqual({ text: `${'a'.repeat(400)}…`, chars: 401 })
  })

  it('windowProjection:触发点近邻保留 1200、窗口 400、其余 50 字符存根;触发点只标不重文', () => {
    // 长度档位:i%4==0 → 88 字符(未超限)、==1 → 1408(近邻截 1200)、==2 → 68(未超限)、==3 → 508(窗口截 400)。
    const body = (index: number): string => `msg ${index}: ${'细节'.repeat([40, 700, 30, 250][index % 4] ?? 40)}`
    const messages: ContextMessage[] = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, from: 'alice', at: String(i), text: body(i) }))
    const loaded = {
      messages, window: threadWindow(messages, 'm15'), complete: true, next: null,
    }
    const projection = windowProjection(loaded, 'm15')
    const byId = new Map(projection.messages.map(entry => [(entry as { id: string }).id, entry]))
    // 触发点自身:全文已在卡片顶层给过一次,线程投影只标 trigger(不重复带文本)。
    const triggerEntry = byId.get('m15') as Record<string, unknown>
    expect(triggerEntry).toMatchObject({ trigger: true })
    expect(triggerEntry).not.toHaveProperty('text')
    expect(triggerEntry).not.toHaveProperty('preview')
    // 触发点两个近邻(±2)按 1200 截断,附完整长度计数。
    const near = byId.get('m17') as Record<string, unknown>
    expect(near).toMatchObject({ chars: body(17).length, text: `${body(17).slice(0, 1200)}…` })
    // 窗口内其余消息(非近邻)按 400 截断。
    const windowed = byId.get('m19') as Record<string, unknown>
    expect(windowed).toMatchObject({ chars: body(19).length, text: `${body(19).slice(0, 400)}…` })
    // 未超限的窗口消息原样给全文、无计数。
    const whole = byId.get('m14') as Record<string, unknown>
    expect(whole).toMatchObject({ text: body(14) })
    expect(whole).not.toHaveProperty('chars')
    // 窗口外的已加载消息是 50 字符存根(orchestrator_eval_read 按 id 读全文)。
    const stub = byId.get('m8') as Record<string, unknown>
    expect(stub).toEqual({ id: 'm8', from: 'alice', preview: body(8).replace(/\s+/g, ' ').slice(0, 50) })
    // 计数只描述已加载快照。
    expect(projection).toMatchObject({ complete: true, loaded_messages: 30, source_found: true })
    expect(JSON.stringify(projection).length).toBeLessThan(12000)
  })

  it('windowProjection:bot 消息带标记、已删除消息只留位次', () => {
    const messages: ContextMessage[] = [
      { id: 'a', from: 'ci-bot', at: '0', text: 'CI run', bot: true },
      { id: 'b', from: 'alice', at: '1', text: 'gone', deleted: true },
      { id: 'c', from: 'alice', at: '2', text: 'real' },
    ]
    const projection = windowProjection({ messages, window: threadWindow(messages, 'c'), complete: true, next: null }, 'c')
    const byId = new Map(projection.messages.map(entry => [(entry as { id: string }).id, entry]))
    // bot 消息在近邻窗内:带 bot 标记与全文(≤1200 不截);截断的长文才给 chars。
    expect(byId.get('a')).toMatchObject({ bot: true, at: '0', text: 'CI run' })
    expect(byId.get('b')).toEqual({ id: 'b', from: 'alice', deleted: true })
    expect(byId.get('c')).toMatchObject({ trigger: true, at: '2' })
  })
})

describe('relatedTickets(≤8 open 优先 + tickets_total;27 号 §3.3-B 防线)', () => {
  const ticket = (id: string, ended?: { at: string }): Ticket => ({
    id, title: `工单 ${id}`, decisionId: `d-${id}`, realm: 'alice',
    mandate: { strength: 'explicit', policyVersion: 'v1', realm: 'alice', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'test', id: 'alice' }, scope: 'scope' },
    channels: [], assignments: [], inputs: [], undelivered: [], origin: { triggerId: `t-${id}`, triggerIds: [`t-${id}`] },
    createdAt: id, updatedAt: id, ...(ended ? { ended: { ...ended, by: 'human' as const, outcome: 'stopped' as const } } : {}),
  })

  it('open 优先、同级按创建时间新在前,至多 8 张,tickets_total 为全数(含已结束)', () => {
    const open = ['t3', 't1', 't2'].map(id => ticket(id))
    const ended = ['e5', 'e4', 'e6', 'e7', 'e8', 'e9', 'e10'].map(id => ticket(id, { at: '2026-01-01T00:00:00Z' }))
    const all = [...ended, ...open]
    const result = relatedTickets(all)
    // 10 张工单全数进 tickets_total;related_tickets 只取 8 张。
    expect(result.tickets_total).toBe(10)
    expect(result.related_tickets).toHaveLength(8)
    // open 优先:3 张开放工单在最前(同级 createdAt 新在前:t3 > t2 > t1)。
    // 同级 createdAt 新在前:ended 组按字典序降序 e9 > e8 > e7 > e6 > e5 > e10。
    expect(result.related_tickets.map(card => card.ticket_id)).toEqual(['t3', 't2', 't1', 'e9', 'e8', 'e7', 'e6', 'e5'])
    // 已结束工单进入卡片(情况 B 防线:评估看到线程上已有的全部工单,含已结束)。
    expect(result.related_tickets.some(card => TICKET_STATES.includes(card.state))).toBe(true)
  })

  it('工单卡是有界投影:状态、标题、最新报告预览与读路径,无工单全文', () => {
    const card = ticketCard(ticket('t1'))
    // 无 assignment 的工单分类为 working/queued(docs/003 阶段表第一匹配行)。
    expect(card).toMatchObject({ ticket_id: 't1', title: '工单 t1', state: 'working/queued', strength: 'explicit', read: 'ticket/t1' })
    expect(JSON.stringify(card)).not.toContain('mandate')
    expect(JSON.stringify(card)).not.toContain('inputs')
    expect(TICKET_STATES).toContain('person/review')
  })
})

describe('admissionContext(线程初载;端口分页)', () => {
  it('按页读取去重、报 complete/next 与回退模式;重复游标显式报错', async () => {
    const pages: ContextMessage[][] = [[message(0), message(1)], [message(1), message(2)], [message(3)]]
    let reads = 0
    const context: TriggerContext = {
      messageId: 'm2',
      async read(part, cursor): Promise<ThreadPage> {
        expect(part).toBe('thread')
        if (cursor === 'cursor-1' && ++reads > 2) throw new Error('loop')
        const index = cursor === undefined ? 0 : cursor === 'next-1' ? 1 : 2
        return { messages: pages[index]!, ...(index < 2 ? { next: `next-${index + 1}` } : {}), ...(index === 1 ? { status: 'chat_neighbours' } : {}) }
      },
    }
    const loaded = await admissionContext(context, 10)
    expect(loaded.messages.map(item => item.id)).toEqual(['m0', 'm1', 'm2', 'm3'])
    expect(loaded.complete).toBe(true)
    expect(loaded.next).toBeNull()
    expect(loaded.status).toBe('chat_neighbours')
    expect(loaded.window).toMatchObject({ source_found: true, loaded_messages: 4 })
  })

  it('maxPages 截断:complete 为 false 并带续读游标;AbortSignal 中断即抛', async () => {
    const context: TriggerContext = {
      messageId: 'm0',
      async read(_part, cursor): Promise<ThreadPage> {
        const n = cursor === undefined ? 0 : Number(cursor)
        return { messages: [message(n)], next: String(n + 1) }
      },
    }
    const loaded = await admissionContext(context, 2)
    expect(loaded.complete).toBe(false)
    expect(loaded.next).toBe('2')
    await expect(admissionContext(context, 2, AbortSignal.abort())).rejects.toThrow()
  })
})

describe('有界投影辅助', () => {
  it('preview 折叠空白并截到 160;textPage 拼页复原原文', () => {
    expect(preview('a\n  b\t c')).toBe('a b c')
    const text = 'x'.repeat(5000)
    const page = textPage('ticket/t1/files', text, 4000, 4000)
    expect(page).toMatchObject({ resource: 'ticket/t1/files', offset: 4000, total_chars: 5000, next_offset: null })
    expect(page.text).toBe('x'.repeat(1000))
  })
})
