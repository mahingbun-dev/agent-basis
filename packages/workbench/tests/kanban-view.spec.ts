/**
 * 工作监控看板投影测试(38 号 T8/G2-D9:数据源投影测试——分组/视角钳制/
 * 阶段过滤/冲突三指标/增量应用;30 号 §2 视图 1)。M3 段钉原型静态稿投影;
 * M4 实接段(tasks 引擎真值源:ticketCardsOf/conflictSection,38 号 T8 实接
 * 半边)以真实装配的 tasks 运行时驱动。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { TasksRuntime } from '@eterna/tasks'
import {
  KANBAN_COLUMN_META, ROLE_CHIPS, clampTicketsByRole, conflictCards, kanbanBoard, stageCounts,
} from '../src/project/kanban.ts'
import { conflictSection } from '../src/project/live-sections.ts'
import { ticketCardsOf } from '../src/project/engine-view.ts'
import {
  allowMember, bootTasks, dropTenantRoot, humanTrigger, makeTenantRoot, openTicket, sectionsTasksOf,
} from './fixtures/live-sections.ts'
import { applyWorkbenchEvent } from '../src/project/state.ts'
import { initialMockSnapshot, MOCK_PRINCIPAL } from '../src/stream/mock-source.ts'

const snapshot = initialMockSnapshot()

describe('分列投影(K-1:阶段分列;原型 03 四列)', () => {
  it('列词汇表:等人 person 族 / 进行中 working / 排队中 working-queued / 空闲 idle(状态点 + 计数徽标色)', () => {
    expect(KANBAN_COLUMN_META.map(meta => [meta.key, meta.label, meta.stageCode, meta.dot, meta.pulse, meta.countTone])).toEqual([
      ['person', '等人', 'person/*', 'wait-person', true, 'warn'],
      ['working', '进行中', 'working', 'working', false, 'accent'],
      ['queued', '排队中', 'working/queued', 'queued', false, 'muted'],
      ['idle', '空闲', 'idle', 'idle', false, 'muted'],
    ])
  })

  it('管理员全集:四列 3/2/1/1,总数 7(= 原型计数)', () => {
    const board = kanbanBoard(snapshot.tickets, 'admin', MOCK_PRINCIPAL, 'all')
    expect(board.columns.map(column => column.tickets.length)).toEqual([3, 2, 1, 1])
    expect(board.counts).toEqual({ all: 7, person: 3, working: 2, queued: 1, idle: 1 })
  })

  it('视角 chip 文案(30 号 §4-5/§7-3 三态)', () => {
    expect(ROLE_CHIPS.map(chip => chip.label)).toEqual(['普通用户（仅自己的）', '审批人（全租户待人）', '管理员（全量）'])
  })
})

describe('视角 realm 钳制(T13 消费面)', () => {
  it('普通用户(陈默)仅自己的工单:3 张', () => {
    const own = clampTicketsByRole(snapshot.tickets, 'user', MOCK_PRINCIPAL)
    expect(own.map(ticket => ticket.id)).toEqual(['T-9c81', 'T-88b1', 'T-1d07'])
  })

  it('审批人见全租户待人项:仅 person 列 3 张;管理员全量 7 张', () => {
    expect(clampTicketsByRole(snapshot.tickets, 'approver', MOCK_PRINCIPAL).map(ticket => ticket.id))
      .toEqual(['T-9c81', 'T-a21f', 'T-88b1'])
    expect(clampTicketsByRole(snapshot.tickets, 'admin', MOCK_PRINCIPAL)).toHaveLength(7)
  })

  it('阶段计数基于钳制集合(普通用户:全部 3/等人 2/进行中 0/排队 1/空闲 0)', () => {
    const own = clampTicketsByRole(snapshot.tickets, 'user', MOCK_PRINCIPAL)
    expect(stageCounts(own)).toEqual({ all: 3, person: 2, working: 0, queued: 1, idle: 0 })
  })

  it('阶段过滤:进行中 → 仅 working 列承载卡片,空列保留(四列常显)', () => {
    const board = kanbanBoard(snapshot.tickets, 'admin', MOCK_PRINCIPAL, 'working')
    expect(board.columns.map(column => column.tickets.map(ticket => ticket.id))).toEqual([
      [], ['T-3f2a', 'T-77c0'], [], [],
    ])
  })
})

describe('冲突三指标(K-2/K-3:27 号 D2,先记录不告警)', () => {
  it('三卡投影逐字:attach 6 / duplicate 3.2% 达标 / 插队 1', () => {
    expect(conflictCards(snapshot.conflict)).toEqual([
      { label: 'attach 次数 · 本周', value: '6', sub: '同线程候选挂接 · 环比 -2' },
      { label: 'duplicate 比例', value: '3.2%', sub: '幂等 trigger id 查重 · 阈值 < 5%', badge: '达标' },
      { label: '插队次数 · 本周', value: '1', sub: '人插队 +1 槽（WorkerSlots），唤醒优先于新 launch' },
    ])
  })

  it('duplicate 超阈值不带达标徽标(数据驱动;无告警字段——不发明告警)', () => {
    const over = conflictCards({ ...snapshot.conflict, duplicate: { percent: 5.1, thresholdPercent: 5, note: 'x' } })
    expect(over[1]!.badge).toBeUndefined()
  })
})

describe('增量应用(G-11:事件归并、纯函数投影、无命中引用不变)', () => {
  it('ticket-moved:T-88b1 person→working,计数翻转为 2/2/1/1,原快照不被改写', () => {
    const event = {
      kind: 'ticket-moved' as const, seq: 4, ticketId: 'T-88b1', column: 'working' as const,
      metaLine: [{ text: 'T-88b1', mono: true }, { text: 'worker event-planning-02' }, { text: '8 分钟', num: true }],
    }
    const next = applyWorkbenchEvent(snapshot, event)
    expect(next).not.toBe(snapshot)
    expect(snapshot.tickets.find(ticket => ticket.id === 'T-88b1')!.column).toBe('person') // 原文不改
    expect(stageCounts(clampTicketsByRole(next.tickets, 'admin', MOCK_PRINCIPAL)))
      .toEqual({ all: 7, person: 2, working: 3, queued: 1, idle: 1 })
    expect(kanbanBoard(next.tickets, 'user', MOCK_PRINCIPAL, 'all').counts).toEqual({ all: 3, person: 1, working: 1, queued: 1, idle: 0 })
  })

  it('未命中工单引用不变;snapshot 事件返回其载荷(跳过重绘面)', () => {
    const miss = applyWorkbenchEvent(snapshot, { kind: 'ticket-moved', seq: 5, ticketId: 'T-none', column: 'idle', metaLine: [] })
    expect(miss).toBe(snapshot)
    const other = initialMockSnapshot()
    const replaced = applyWorkbenchEvent(snapshot, { kind: 'snapshot', seq: 6, snapshot: other })
    expect(replaced).toBe(other)
  })

  it('投影纯度:同一输入两次调用产出等值快照(kanbanBoard 无副作用)', () => {
    const a = kanbanBoard(snapshot.tickets, 'admin', MOCK_PRINCIPAL, 'all')
    const b = kanbanBoard(snapshot.tickets, 'admin', MOCK_PRINCIPAL, 'all')
    expect(a.counts).toEqual(b.counts)
    expect(a.columns.map(column => column.tickets.map(ticket => ticket.id)))
      .toEqual(b.columns.map(column => column.tickets.map(ticket => ticket.id)))
    expect(snapshot.tickets).toHaveLength(7)
  })
})

// ── M4 实接段(38 号 T8 实接半边;G2-D9 数据源投影测试的真值源半边)──────────

describe('M4 实接:tasks 引擎真值源 → 看板卡(ticketCardsOf;30 号 §2 视图 1 数据源列)', () => {
  let root: string
  let runtime: TasksRuntime
  beforeEach(() => {
    root = makeTenantRoot()
    runtime = bootTasks(root)
  })
  afterEach(() => {
    runtime.dispose()
    dropTenantRoot(root)
  })

  it('真实工单建票(stub executor 停 pending)→ working/queued 列,卡面四段 meta', () => {
    const ticketId = openTicket(runtime, '1')
    const cards = ticketCardsOf(runtime.store.tickets.list(), Date.now())
    expect(cards).toHaveLength(1)
    const card = cards[0]!
    expect(card.id).toBe(ticketId)
    expect(card.column).toBe('queued')
    expect(card.metaLine.map(segment => segment.text)).toEqual([ticketId, 'working/queued', '等待 worker 槽位'])
    expect(card.owner).toBe('u-alice')
    // 看板分列消费同一投影(K-1 阶段分列;真实工单落「排队中」)
    const board = kanbanBoard(cards, 'admin', MOCK_PRINCIPAL, 'all')
    expect(board.columns.find(column => column.meta.key === 'queued')!.tickets.map(ticket => ticket.id)).toEqual([ticketId])
    expect(board.counts).toEqual({ all: 1, person: 0, working: 0, queued: 1, idle: 0 })
  })

  it('blocked 报告(ticketStage 表行)→ person 列卡点卡,带等待时长与 Attention 徽标', () => {
    const ticketId = openTicket(runtime, '1')
    runtime.engine.report(ticketId, { state: 'blocked', summary: '报价口径不一致,等人拍板' })
    const card = ticketCardsOf(runtime.store.tickets.list(), Date.now())[0]!
    expect(card.column).toBe('person')
    expect(card.metaLine[1]?.text).toBe('person/blocked')
    expect(card.attention).toBeUndefined() // blocked 非Attention:等人注记来自 waitsForPerson 路径
    expect(card.a11yRow?.node).toBe('Assignment 委派')
    const board = kanbanBoard(ticketCardsOf(runtime.store.tickets.list(), Date.now()), 'admin', MOCK_PRINCIPAL, 'all')
    expect(board.counts.person).toBe(1)
  })

  it('工单结束(ticket.ended)→ 移出看板(四列为开放工单阶段)', () => {
    const ticketId = openTicket(runtime, '1')
    runtime.engine.stopTicket(ticketId, '不用做了')
    expect(ticketCardsOf(runtime.store.tickets.list(), Date.now())).toHaveLength(0)
  })
})

describe('M4 实接:冲突三指标计数(conflictSection;27 号 D2 计数暴露位)', () => {
  let root: string
  let runtime: TasksRuntime
  beforeEach(() => {
    root = makeTenantRoot()
    runtime = bootTasks(root)
  })
  afterEach(() => {
    runtime.dispose()
    dropTenantRoot(root)
  })

  it('attach 次数 = routed 决策计数(Engine.attach 挂到已有工单;27 号 §5-2「请求重叠的频率」)', () => {
    const ticketId = openTicket(runtime, '1')
    // 第二条人消息经 attach 挂到已有工单(routed)——重叠请求的实况
    allowMember(runtime)
    const trigger = humanTrigger('2', '@bot 补充一点')
    expect(runtime.engine.receive(trigger)).toBe('stored')
    runtime.pass() // eval.started:attach 的 routed 决策写在持有该 trigger 的 Eval 上
    runtime.engine.attach(ticketId, trigger.id)
    const conflict = conflictSection({ tasks: sectionsTasksOf(runtime) })
    expect(conflict.attach.count).toBe(1)
    expect(conflict.attach.unavailable).toBeUndefined()
    expect(conflictCards(conflict)[0]).toEqual({
      label: 'attach 次数 · 本周',
      value: '1',
      sub: conflict.attach.note,
    })
  })

  it('duplicate/插队计数点未接线 → unavailable 如实标注,不伪报数值(先记录不告警)', () => {
    const conflict = conflictSection({ tasks: sectionsTasksOf(runtime) })
    expect(conflict.duplicate.unavailable).toBe(true)
    expect(conflict.jump.unavailable).toBe(true)
    const cards = conflictCards(conflict)
    expect(cards[1]!.value).toBe('暂不可采')
    expect(cards[2]!.value).toBe('暂不可采')
    expect(cards.every(card => card.badge === undefined)).toBe(true) // K-3:无告警字段
  })

  it('store 面缺席 → attach 亦不可采(数据端点未经 tasks 实例装配的诚实空态)', () => {
    const conflict = conflictSection({})
    expect(conflict.attach.unavailable).toBe(true)
    expect(conflictCards(conflict)[0]!.value).toBe('暂不可采')
  })
})
