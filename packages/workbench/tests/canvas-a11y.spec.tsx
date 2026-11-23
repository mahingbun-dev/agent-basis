/**
 * 信息流实时图 a11y 测试(38 号 T9/G2-D4①;30 号 §7-1③ 拍板:a11y 补偿 =
 * 旁挂可键盘导航等价列表视图)。断言面:
 * - 画布 = role="img" + 指向等价列表的可达名称(画布无 DOM 可读);
 * - 旁挂列表 = 原型 04 两视图(按工单浏览/按节点浏览)逐字;
 * - 键盘约定:原生可聚焦行内按钮/链接 + 方向键漫游(moveRovingIndex);
 * - 状态播报 aria-live polite 区存在(原型 04 键盘与读屏约定);
 * - 负向(38 号 F-11/30 号 §7-2):不出现「全局时间轴回放」UI 入口。
 * 另覆盖九节点封闭清单/卡点派生/单工单回放投影(38 号 F-1~F-4/F-10/F-13)。
 */
import { describe, expect, it } from 'vitest'
import { FlowView } from '../src/client/FlowCanvas.tsx'
import { zh } from '../src/client/locales.ts'
import { applyWorkbenchEvent } from '../src/project/state.ts'
import {
  FLOW_NODE_ORDER, compactDuration, flowGraphView, hitTestFlowNode, moveRovingIndex, stuckTickets,
} from '../src/project/flow-graph.ts'
import { replayNarration, replayTrack, sourceToNode } from '../src/project/replay.ts'
import { initialMockSnapshot, mockTimeline } from '../src/stream/mock-source.ts'
import type { WorkbenchStreamEvent } from '../src/types.ts'
import { all, byAttr, find1, rawText, render, textOf } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key
const snapshot = initialMockSnapshot()
const view = flowGraphView(snapshot)

const flowView = render(
  <FlowView
    view={view}
    tickets={snapshot.tickets}
    paused={false}
    replayTicketId="T-9c81"
    announce=""
    t={t}
    onTogglePause={() => {}}
    onReplayTicketChange={() => {}}
    onReplayStart={() => {}}
    onRowReplay={() => {}}
  />,
)

describe('视图二渲染:画布 + 三配套入口(原型 03 视图二)', () => {
  it('画布为 Canvas 元素,role="img",可达名称指向旁挂等价列表(画布不可读 → 走列表)', () => {
    const canvas = find1(flowView, 'data-eterna-workbench', 'flow-canvas')
    expect(canvas.tag).toBe('canvas')
    expect(canvas.attrs['role']).toBe('img')
    expect(canvas.attrs['aria-label']).toContain('信息流实时图')
    expect(canvas.attrs['aria-label']).toContain('等价清单')
    expect(canvas.attrs['aria-label']).toContain('按工单浏览')
    expect(canvas.attrs['aria-label']).toContain('按节点浏览')
  })

  it('工具条:暂停按钮(aria-pressed)+ 回放选择器两项 + 重放事件序列按钮', () => {
    const pause = find1(flowView, 'data-eterna-workbench-flow', 'pause')
    expect(pause.attrs['aria-pressed']).toBe('false')
    expect(textOf(pause)).toBe('暂停')
    const picker = find1(flowView, 'data-eterna-workbench', 'replay-picker')
    const trigger = find1(picker, 'data-eterna-workbench', 'replay-select')
    expect(trigger.tag).toBe('summary')
    expect(trigger.attrs['aria-haspopup']).toBe('menu')
    expect(textOf(trigger)).toBe('T-9c81 报价对比：口径确认')
    const options = byAttr(picker, 'role', 'menuitemradio').map(node => textOf(node))
    expect(options).toEqual(['T-9c81 报价对比：口径确认', 'T-a21f 付款申请：预付款审批'])
    expect(byAttr(picker, 'data-eterna-workbench-selected', 'true').map(node => textOf(node))).toEqual(['T-9c81 报价对比：口径确认'])
    const start = find1(flowView, 'data-eterna-workbench-flow', 'replay-start')
    expect(textOf(start)).toBe('重放事件序列')
  })

  it('回放选择器空态:无可回放工单 = 禁用占位(不可展开,不弹系统菜单)', () => {
    const emptyView = render(
      <FlowView
        view={{ ...view, replayOptions: [] }}
        tickets={snapshot.tickets}
        paused={false}
        replayTicketId=""
        announce=""
        t={t}
        onTogglePause={() => {}}
        onReplayTicketChange={() => {}}
        onReplayStart={() => {}}
        onRowReplay={() => {}}
      />,
    )
    const placeholder = find1(emptyView, 'data-eterna-workbench', 'replay-select')
    expect(placeholder.tag).toBe('span')
    expect(placeholder.attrs['data-eterna-workbench-disabled']).toBe('true')
    expect(textOf(placeholder)).toBe('暂无可回放工单')
    expect(byAttr(emptyView, 'data-eterna-workbench', 'replay-picker')).toHaveLength(0)
  })

  it('暂停态:按钮文案切「继续」+ aria-pressed(按下态由 CSS 强调底给出)', () => {
    const pausedView = render(
      <FlowView
        view={view}
        tickets={snapshot.tickets}
        paused
        replayTicketId="T-9c81"
        announce=""
        t={t}
        onTogglePause={() => {}}
        onReplayTicketChange={() => {}}
        onReplayStart={() => {}}
        onRowReplay={() => {}}
      />,
    )
    const pause = find1(pausedView, 'data-eterna-workbench-flow', 'pause')
    expect(pause.attrs['aria-pressed']).toBe('true')
    expect(textOf(pause)).toBe('继续')
  })

  it('图例七项逐字(38 号 F-12 图例要素)', () => {
    const legend = byAttr(flowView, 'data-eterna-workbench', 'legend-item').map(node => textOf(node))
    expect(legend).toEqual([
      '待命节点（默认边框）',
      '活跃节点（事件流动中）',
      '卡点节点（person/* 等人驻留）',
      '异常节点（fail-closed，本稿未触发）',
      '事件边（DomainEvents 流向）',
      '活跃边（200ms 合批推送）',
      '回放轨迹（单工单事件序列）',
    ])
  })

  it('aria-live 播报区存在(role=status, polite;原型 04 状态播报约定)', () => {
    const announce = find1(flowView, 'data-eterna-workbench', 'announce')
    expect(announce.attrs['role']).toBe('status')
    expect(announce.attrs['aria-live']).toBe('polite')
  })
})

describe('旁挂等价列表 视图 A · 按工单浏览(原型 04 逐字)', () => {
  it('表头七列 + caption;卡点置顶排序(等人优先)', () => {
    const headers = all(flowView, node => node.tag === 'th' && node.attrs['scope'] === 'col').map(node => textOf(node))
    expect(headers).toEqual(['工单', '当前节点', '阶段', '等待谁', '停留', '最近事件', '操作'])
    expect(textOf(all(flowView, node => node.tag === 'caption')[0]!)).toBe('活跃工单清单（与看板 / 画布同数据）')
    const rows = byAttr(flowView, 'data-eterna-workbench', 'ticket-row')
    expect(rows).toHaveLength(7)
    expect(rows.map(row => row.attrs['data-eterna-workbench-ticket'])).toEqual([
      'T-9c81', 'T-a21f', 'T-88b1', 'T-3f2a', 'T-77c0', 'T-1d07', 'T-55e9',
    ])
  })

  it('卡点行:stuck 标记 + 「卡点」徽标 + wait-person 心跳点;非卡点行无徽标', () => {
    const rows = byAttr(flowView, 'data-eterna-workbench', 'ticket-row')
    const stuck = rows.filter(row => row.attrs['data-eterna-workbench-stuck'] === 'true')
    expect(stuck.map(row => row.attrs['data-eterna-workbench-ticket'])).toEqual(['T-9c81', 'T-a21f', 'T-88b1'])
    expect(stuck.every(row => rawText(row).includes('卡点'))).toBe(true)
    const first = find1(flowView, 'data-eterna-workbench-ticket', 'T-9c81')
    expect(find1(first, 'data-eterna-workbench-dot', 'wait-person').attrs['data-eterna-workbench-pulse']).toBe('true')
    const working = find1(flowView, 'data-eterna-workbench-ticket', 'T-3f2a')
    expect(working.attrs['data-eterna-workbench-stuck']).toBeUndefined()
    expect(find1(working, 'data-eterna-workbench-dot', 'working')).toBeDefined()
  })

  it('行内容逐字段:当前节点/阶段/等待谁/停留/最近事件(原型 04 六行口径)', () => {
    const cellsOf = (ticketId: string): string[] =>
      all(find1(flowView, 'data-eterna-workbench-ticket', ticketId), node => node.tag === 'td').map(node => textOf(node))
    expect(cellsOf('T-9c81')).toEqual([
      'Assignment 委派', 'person/answer', '陈默（发起人）', '4 小时', '14:18 Attention #12 已发出', '回放 打开',
    ])
    expect(cellsOf('T-a21f')).toEqual([
      'Assignment 委派', 'person/approve', '王琳（审批人 · R3）', '1 小时 20 分', '14:02 卡片已投递飞书', '回放 打开',
    ])
    expect(cellsOf('T-88b1')).toEqual([
      'Outbox 出箱', 'person/accept', '陈默（发起人 · 验收）', '6 分钟', '14:31 结果已发回原对话', '打开',
    ])
    expect(cellsOf('T-3f2a')).toEqual([
      'Worker 执行', 'working', 'worker legal-02', '22 分钟', '14:20 工具 fs.read ×4', '打开',
    ])
    expect(cellsOf('T-1d07')).toEqual([
      'Ticket 工单', 'working/queued', '排队（2/4 槽）', '9 分钟', '14:12 建票完成', '打开',
    ])
    expect(cellsOf('T-55e9')).toEqual(['—', 'idle', '观察模式 · 无待办', '—', '昨日 18:00 上次跑批', '打开'])
  })

  it('回放入口只出现在可回放工单行(原型 03 select 两项同源);打开入口锚到检查器/看板', () => {
    const replayButtons = byAttr(flowView, 'data-eterna-workbench', 'btn')
      .filter(node => 'data-eterna-workbench-replay' in node.attrs)
    expect(replayButtons.map(node => node.attrs['data-eterna-workbench-replay'])).toEqual(['T-9c81', 'T-a21f'])
    expect(replayButtons.every(node => textOf(node) === '回放')).toBe(true)
    const openWorking = find1(find1(flowView, 'data-eterna-workbench-ticket', 'T-3f2a'), 'data-eterna-workbench', 'btn-ghost')
    expect(openWorking.attrs['href']).toBe('#wb-v5')
    const openPerson = find1(find1(flowView, 'data-eterna-workbench-ticket', 'T-9c81'), 'data-eterna-workbench', 'btn-ghost')
    expect(openPerson.attrs['href']).toBe('#wb-v1')
  })
})

describe('旁挂等价列表 视图 B · 按节点浏览(原型 04 逐字;38 号 F-13 封闭清单)', () => {
  it('九节点封闭清单按流转顺序排列,不增删', () => {
    const items = byAttr(flowView, 'data-eterna-workbench', 'node-item')
    expect(items.map(node => node.attrs['data-eterna-workbench-node'])).toEqual([...FLOW_NODE_ORDER])
    expect(FLOW_NODE_ORDER).toHaveLength(9)
    expect(items.map(node => textOf(find1(node, 'data-eterna-workbench', 'node-name')))).toEqual([
      'Trigger 触发', 'Thread 线程', 'Eval 评估', 'Decision 裁决', 'Ticket 工单',
      'Assignment 委派', 'Worker 执行', 'Report 报告', 'Outbox 出箱',
    ])
  })

  it('节点徽标/stat 逐字(待命/活跃/卡点·等人);Assignment 卡点项默认展开且 stuck 标记', () => {
    const statOf = (key: string): string => textOf(find1(find1(flowView, 'data-eterna-workbench-node', key), 'data-eterna-workbench', 'node-stat'))
    expect(statOf('trigger')).toBe('今日 23 次')
    expect(statOf('thread')).toBe('2 运行')
    expect(statOf('eval')).toBe('合批 200ms')
    expect(statOf('decision')).toBe('accept 21 · stop 2')
    expect(statOf('ticket')).toBe('7 活跃')
    expect(statOf('assignment')).toBe('3 单等人 · 最长 4 小时')
    expect(statOf('worker')).toBe('2/4 槽')
    expect(statOf('report')).toBe('1 待发')
    expect(statOf('outbox')).toBe('今日已发 5')
    expect(textOf(find1(find1(flowView, 'data-eterna-workbench-node', 'assignment'), 'data-eterna-workbench-tone', 'warn'))).toBe('卡点 · 等人')
    const assignment = find1(flowView, 'data-eterna-workbench-node', 'assignment')
    expect(assignment.attrs['data-eterna-workbench-stuck']).toBe('true')
    expect(all(assignment, node => node.tag === 'details')[0]!.attrs['open']).toBe('true')
  })

  it('Assignment 等待清单事件行 3 条(工单/阶段/等谁,自工单数据派生);Worker 在办 2 条', () => {
    const assignment = find1(flowView, 'data-eterna-workbench-node', 'assignment')
    expect(textOf(all(assignment, node => node.tag === 'summary')[0]!)).toBe('等待中的工单（3）')
    const lines = byAttr(assignment, 'data-eterna-workbench', 'event-list').flatMap(list => all(list, node => node.tag === 'li')).map(node => textOf(node))
    expect(lines).toEqual([
      '14:18 · T-9c81 person/answer · 等陈默回答',
      '14:02 · T-a21f person/approve · 等王琳批准 · R3',
      '14:31 · T-88b1 person/accept · 等陈默验收',
    ])
    const worker = find1(flowView, 'data-eterna-workbench-node', 'worker')
    expect(textOf(all(worker, node => node.tag === 'summary')[0]!)).toBe('在办 worker（2）')
    const workerLines = byAttr(worker, 'data-eterna-workbench', 'event-list').flatMap(list => all(list, node => node.tag === 'li')).map(node => textOf(node))
    expect(workerLines).toEqual([
      'event-planning-01 · T-9c81 · 运行 22 分钟',
      'legal-02 · T-3f2a · 运行 22 分钟',
    ])
  })
})

describe('手写交互几何与键盘漫游(38 号 F-6 配套①;原型 04 方向键约定)', () => {
  it('hitTestFlowNode:节点矩形内命中,间隙不命中', () => {
    expect(hitTestFlowNode(100, 70)).toBe('trigger')
    expect(hitTestFlowNode(650, 240)).toBe('assignment')
    expect(hitTestFlowNode(40 + 140, 70)).toBe('trigger') // 右缘闭区间归左节点
    expect(hitTestFlowNode(300, 70)).toBe('thread')
    expect(hitTestFlowNode(230, 70)).toBeUndefined()
    expect(hitTestFlowNode(100, 150)).toBeUndefined()
  })

  it('moveRovingIndex:上下移动,首尾钳制', () => {
    expect(moveRovingIndex(3, 1, 7)).toBe(4)
    expect(moveRovingIndex(3, -1, 7)).toBe(2)
    expect(moveRovingIndex(0, -1, 7)).toBe(0)
    expect(moveRovingIndex(6, 1, 7)).toBe(6)
    expect(moveRovingIndex(0, 1, 0)).toBe(0)
  })

  it('旁挂列表行/节点为原生可聚焦元素(button/a/summary;Tab 顺序即阅读顺序)', () => {
    const focusableTags = new Set(['button', 'a', 'summary'])
    const focusables = all(flowView, node => focusableTags.has(node.tag))
    expect(focusables.length).toBeGreaterThanOrEqual(9 + 7) // 9 summary + 行内按钮/链接
    expect(all(flowView, node => node.tag === 'button').length).toBeGreaterThanOrEqual(4) // 暂停/重放 + 2 回放
  })
})

describe('单工单回放投影(38 号 F-10;30 号 §7-2:数据源 audit trace)', () => {
  it('来源→节点映射:工具调用与 worker 会话归 Worker 执行;未知来源不进轨迹', () => {
    expect(sourceToNode('Trigger')).toBe('trigger')
    expect(sourceToNode('Decision')).toBe('decision')
    expect(sourceToNode('工具 fs.read')).toBe('worker')
    expect(sourceToNode('session')).toBe('worker')
    expect(sourceToNode('Outbox')).toBe('outbox')
    expect(sourceToNode('神秘来源')).toBeUndefined()
  })

  it('T-9c81 轨迹 = audit 事件按序去重(含 worker 会话行),折线取节点中心', () => {
    const track = replayTrack(snapshot, 'T-9c81')!
    expect(track).toBeDefined()
    expect(track.nodeKeys).toEqual(['trigger', 'eval', 'decision', 'assignment', 'worker', 'report', 'outbox'])
    expect(track.steps.length).toBe(10) // audit 8 + worker 会话 2
    expect(track.points[0]).toEqual({ x: 110, y: 70 }) // trigger 中心(原型 03 布局)
    expect(replayNarration(track)).toBe('T-9c81 回放轨迹：Trigger 触发→Eval 评估→Decision 裁决→Assignment 委派→Worker 执行→Report 报告→Outbox 出箱（共 10 个事件）')
  })

  it('T-a21f 无 audit 行 → 空轨迹(入口可用,播报「暂无回放事件」);未知工单 undefined', () => {
    const track = replayTrack(snapshot, 'T-a21f')!
    expect(track.steps).toEqual([])
    expect(track.nodeKeys).toEqual([])
    expect(replayNarration(track)).toBe('T-a21f 暂无回放事件')
    expect(replayTrack(snapshot, 'T-nope')).toBeUndefined()
  })
})

describe('卡点派生与事件驱动刷新(38 号 F-4/F-14;30 号 §2.1)', () => {
  it('初始卡点 = person 列 3 单,最长 4 小时(compactDuration 紧凑式)', () => {
    expect(stuckTickets(snapshot.tickets)).toHaveLength(3)
    expect(view.bubble).toEqual({
      text: 'person/* 卡点：3 单等人 · 最长 4 小时',
      sub: 'person/* 阶段工单在图上以警示色驻留，答复即消（30 §2-1）',
    })
    const assignment = view.nodes.find(node => node.key === 'assignment')!
    expect(assignment.state).toBe('stuck')
    expect(assignment.sub).toBe('3 单等人 · 最长 4h')
    expect(compactDuration(240)).toBe('4h')
    expect(compactDuration(80)).toBe('1h20m')
    expect(compactDuration(6)).toBe('6m')
  })

  it('ticket-moved(T-88b1 person→working)后:卡点 3→2、worker 槽位仍 2/4(真读数)、气泡计数同步(派生幂等)', () => {
    const increment = mockTimeline().find(item => item.event.kind === 'ticket-moved')?.event
    if (increment?.kind !== 'ticket-moved') throw new Error('mock 时间线缺 ticket-moved')
    const event: WorkbenchStreamEvent = { ...increment, seq: 99 }
    const next = applyWorkbenchEvent(snapshot, event)
    const nextView = flowGraphView(next)
    const assignment = nextView.nodes.find(node => node.key === 'assignment')!
    expect(assignment.events).toHaveLength(2)
    expect(assignment.sub).toBe('2 单等人 · 最长 4h')
    expect(assignment.eventsLabel).toBe('等待中的工单（2）')
    // 槽位分子取快照 flow 节的真实读数(`stats().executor.usedSlots`,2026-11-23 线上修复),
    // 不再按工单列/领域态推算:单卡换列不代表执行面的占槽变了,故此处仍是 2/4;
    // 真占槽变化经整节重投影(flow-updated)刷新。
    expect(nextView.nodes.find(node => node.key === 'worker')!.sub).toBe(`${next.flow.slotsUsed}/${next.flow.workerSlots} 槽`)
    expect(nextView.nodes.find(node => node.key === 'worker')!.sub).toBe('2/4 槽')
    expect(nextView.bubble?.text).toBe('person/* 卡点：2 单等人 · 最长 4 小时')
    const miss: WorkbenchStreamEvent = { kind: 'ticket-moved', ticketId: 'T-nope', column: 'working', metaLine: [], seq: 100 }
    expect(applyWorkbenchEvent(next, miss).tickets).toBe(next.tickets) // 未命中引用不变 → 跳过重绘
  })

  it('活跃边两条(原型 03 fedge-live:thread→eval、ticket→assignment)', () => {
    expect(view.edges.filter(edge => edge.live).map(edge => `${edge.from}→${edge.to}`)).toEqual(['thread→eval', 'ticket→assignment'])
    expect(view.edges).toHaveLength(8)
  })
})

describe('负向断言(38 号 F-11;30 号 §7-2:全局时间轴回放不做)', () => {
  it('视图二渲染面不出现「时间轴」入口文案', () => {
    expect(rawText(flowView)).not.toContain('时间轴')
    expect(rawText(flowView)).not.toContain('全局回放')
  })
})
