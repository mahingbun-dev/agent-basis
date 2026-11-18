/**
 * 任务侧栏验收(38 号 T6 门禁【预定名】:分组/状态点/分支切换投影断言;
 * 视觉对照 = 原型一 docs/prototypes/01-task-sidebar.html 逐字)。渲染测试仿
 * packages/panel 现有模式:受控纯组件直调 + 元素树断言(render-tree.tsx 同款,
 * 仓库无 react-dom)。投影断言走 project/task-sidebar.ts 纯函数(G-11)。
 */
import { describe, expect, it } from 'vitest'
import { TaskSidebar, TicketTimeline } from '../src/client/TaskSidebar.tsx'
import { activeBranchOf, branchChipLabel, branchStateTone, branchesFor, sidebarGroups, sidebarRowLine, timelineFor } from '../src/project/task-sidebar.ts'
import type { WorkbenchTicket } from '../src/types.ts'
import { initialMockSnapshot } from '../src/stream/mock-source.ts'
import { zh } from '../src/client/locales.ts'
import { all, byAttr, find1, rawText, render, textOf } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key
const snapshot = initialMockSnapshot()

const sidebar = render(
  <TaskSidebar
    sessions={snapshot.sessions}
    tickets={snapshot.tickets}
    activeSessionId="sess-1"
    onSessionSelect={() => {}}
    activeTicketId="T-9c81"
    onTicketSelect={() => {}}
    t={t}
  />,
)
const timelineBranch2 = render(
  <TicketTimeline
    ticket={snapshot.tickets.find(ticket => ticket.id === 'T-9c81')}
    branches={branchesFor(snapshot.assignments, 'T-9c81')}
    activeBranchId={2}
    onBranchChange={() => {}}
    blocks={timelineFor(snapshot.timelines, 'T-9c81', 2, snapshot.assignments)}
    answerDraft=""
    onAnswerChange={() => {}}
    onAnswerSubmit={() => {}}
    onAccept={() => {}}
    onReturn={() => {}}
    t={t}
  />,
)
const timelineBranch1 = render(
  <TicketTimeline
    ticket={snapshot.tickets.find(ticket => ticket.id === 'T-9c81')}
    branches={branchesFor(snapshot.assignments, 'T-9c81')}
    activeBranchId={1}
    onBranchChange={() => {}}
    blocks={timelineFor(snapshot.timelines, 'T-9c81', 1, snapshot.assignments)}
    answerDraft=""
    onAnswerChange={() => {}}
    onAnswerSubmit={() => {}}
    onAccept={() => {}}
    onReturn={() => {}}
    t={t}
  />,
)

describe('S-1 会话侧任务分组(24 号 §6 P2 行;34 号 §2.1 stage 口径)', () => {
  it('分组投影:四组按 stage 分列(person/working/queued/idle),计数 3/2/1/1(= 原型一)', () => {
    const groups = sidebarGroups(snapshot.tickets)
    expect(groups.map(group => [group.meta.key, group.tickets.length])).toEqual([
      ['person', 3], ['working', 2], ['queued', 1], ['idle', 1],
    ])
    expect(groups.map(group => group.meta.stageCode)).toEqual(['person/*', 'working', 'working/queued', 'idle'])
  })

  it('组头渲染:状态点 + 组名 + 阶段码(mono)+ 计数徽标(语义色配文字)', () => {
    const headers = byAttr(sidebar, 'data-eterna-workbench', 'task-group-h')
    expect(headers).toHaveLength(4)
    const expectHeader = (index: number, label: string, code: string, count: string, tone: string): void => {
      expect(textOf(headers[index]!)).toContain(label)
      expect(textOf(headers[index]!)).toContain(code)
      expect(textOf(find1(headers[index]!, 'data-eterna-workbench', 'count'))).toBe(count)
      expect(find1(headers[index]!, 'data-eterna-workbench', 'count').attrs['data-eterna-workbench-tone']).toBe(tone)
    }
    expectHeader(0, '等我处理', 'person/*', '3', 'warn')
    expectHeader(1, '进行中', 'working', '2', 'accent')
    expectHeader(2, '排队中', 'working/queued', '1', 'muted')
    expectHeader(3, '空闲', 'idle', '1', 'muted')
  })
})

describe('S-2 状态点(24 号 §7.2 关键设计「侧栏有状态点」;语义色配文字)', () => {
  it('组头状态点词汇表:等人=wait-person+pulse 心跳、进行中=working、排队=queued、空闲=idle', () => {
    const headers = byAttr(sidebar, 'data-eterna-workbench', 'task-group-h')
    const dotOf = (index: number): { dot: string; pulse: string | undefined } => {
      const dot = find1(headers[index]!, 'data-eterna-workbench', 'dot')
      return { dot: dot.attrs['data-eterna-workbench-dot'] ?? '', pulse: dot.attrs['data-eterna-workbench-pulse'] }
    }
    expect(dotOf(0)).toEqual({ dot: 'wait-person', pulse: 'true' })
    expect(dotOf(1).dot).toBe('working')
    expect(dotOf(2).dot).toBe('queued')
    expect(dotOf(3).dot).toBe('idle')
  })

  it('工单行状态点:person 行琥珀脉动,working/queued/idle 行不脉动', () => {
    const items = byAttr(sidebar, 'data-eterna-workbench', 'task-item')
    expect(items).toHaveLength(7)
    const dotOf = (ticketId: string): { dot: string; pulse: string | undefined } => {
      const dot = find1(find1(sidebar, 'data-eterna-workbench-ticket', ticketId), 'data-eterna-workbench', 'dot')
      return { dot: dot.attrs['data-eterna-workbench-dot'] ?? '', pulse: dot.attrs['data-eterna-workbench-pulse'] }
    }
    expect(dotOf('T-9c81')).toEqual({ dot: 'wait-person', pulse: 'true' })
    expect(dotOf('T-a21f').pulse).toBe('true')
    expect(dotOf('T-3f2a')).toEqual({ dot: 'working', pulse: undefined })
    expect(dotOf('T-1d07').dot).toBe('queued')
    expect(dotOf('T-55e9').dot).toBe('idle')
  })

  it('工单行结构:状态点 + 标题 + id(mono)+ 阶段 + 等谁 + 耗时(num)+ Attention 注记', () => {
    const first = find1(sidebar, 'data-eterna-workbench-ticket', 'T-9c81')
    expect(textOf(find1(first, 'data-eterna-workbench', 't-title'))).toBe('报价对比：口径确认')
    expect(textOf(find1(first, 'data-eterna-workbench', 't-meta'))).toBe('T-9c81 person/answer 等你回答（Attention #12） 已等 4 小时 （Attention #12）')
    const monoSpans = all(first, node => node.attrs['data-eterna-workbench-seg-mono'] === 'true')
    expect(monoSpans.map(node => node.text)).toContain('T-9c81')
    const numSpans = all(first, node => node.attrs['data-eterna-workbench-seg-num'] === 'true')
    expect(numSpans.map(node => node.text)).toContain('已等 4 小时')
  })
})

describe('会话分区(原型一「会话」;24 号 §7.2 做完结果回到原对话)', () => {
  it('会话四行逐字(标题 · 渠道)+ 当前会话 aria-current', () => {
    const rows = byAttr(sidebar, 'data-eterna-workbench', 'session-row')
    expect(rows.map(row => textOf(row))).toEqual([
      '采购报价对比 · 飞书群', '合同审查 · Web', '周报整理 · 飞书私聊', '活动排期 · Web',
    ])
    expect(rows[0]!.attrs['aria-current']).toBe('true')
    expect(rows[1]!.attrs['aria-current']).toBeUndefined()
  })

  it('侧栏行 meta 缺省回落看板 metaLine(sidebarLine 缺省票据)', () => {
    const ticket = snapshot.tickets.find(entry => entry.id === 'T-9c81')!
    expect(sidebarRowLine(ticket)).toBe(ticket.sidebarLine)
    const bare: WorkbenchTicket = { id: 'T-x', title: '最小工单', column: 'idle', metaLine: [{ text: 'T-x' }], owner: '陈默' }
    expect(sidebarRowLine(bare)).toBe(bare.metaLine)
  })
})

describe('S-4 多 Assignment 分支切换(退回 = 新 Assignment = 新分支,24 号 §7.2;failed 重试 = 新分支,27 号 §1.2)', () => {
  it('分支投影:T-9c81 两分支(1 failed 首轮 / 2 active 含税口径),升序 + 活跃分支判定', () => {
    const branches = branchesFor(snapshot.assignments, 'T-9c81')
    expect(branches.map(branch => [branch.seq, branch.state, branch.note, branch.active])).toEqual([
      [1, 'failed', '首轮 · web.fetch 拒绝', false],
      [2, 'ready', '含税口径统一', true],
    ])
    expect(activeBranchOf(snapshot.assignments, 'T-9c81')?.seq).toBe(2)
    expect(activeBranchOf(snapshot.assignments, 'T-55e9')?.seq).toBe(1)
    expect(branchesFor(snapshot.assignments, 'T-none')).toEqual([])
  })

  it('分支 chip 文案与态徽标语义色(failed=danger/working=accent/ready=success)', () => {
    expect(branchChipLabel({ ticketId: 'T-9c81', seq: 1, state: 'failed', note: '首轮 · web.fetch 拒绝', active: false })).toBe('分支 1 · 首轮 · web.fetch 拒绝')
    expect(branchStateTone('failed')).toBe('danger')
    expect(branchStateTone('working')).toBe('accent')
    expect(branchStateTone('ready')).toBe('success')
  })

  it('切换渲染:活跃分支(2)显示原型一会话面;切到分支 1 显示 failed 弧 + 重试 = 新分支注记', () => {
    // 分支 2(活跃;原型一逐字)
    const chips2 = byAttr(timelineBranch2, 'data-eterna-workbench', 'chip')
    expect(chips2).toHaveLength(2)
    expect(chips2[0]!.attrs['data-eterna-workbench-on']).toBeUndefined()
    expect(chips2[1]!.attrs['data-eterna-workbench-on']).toBe('true')
    expect(chips2[1]!.attrs['aria-pressed']).toBe('true')
    expect(textOf(chips2[1]!)).toContain('分支 2 · 含税口径统一')
    expect(textOf(find1(timelineBranch2, 'data-eterna-workbench', 'result-card'))).toContain('材料已就绪 · 统一按含税口径')
    // 分支 1(failed;27 号 §1.2 语义)
    const chips1 = byAttr(timelineBranch1, 'data-eterna-workbench', 'chip')
    expect(chips1[0]!.attrs['data-eterna-workbench-on']).toBe('true')
    const text1 = rawText(timelineBranch1)
    // rawText 无分隔拼接(空格剥离),负向/含断言以无空格形态比对
    expect(text1).toContain('web.fetch白名单外拒绝（supplier-b.com）')
    expect(text1).toContain('重试=新Assignment新分支（27号§1.2）')
    expect(byAttr(timelineBranch1, 'data-eterna-workbench', 'result-card')).toHaveLength(0)
  })

  it('分支时间线寻址与回落:timelineFor 按 ticketId+branchSeq 取;无记录分支回落活跃分支', () => {
    expect(timelineFor(snapshot.timelines, 'T-9c81', 2, snapshot.assignments)).toHaveLength(9)
    expect(timelineFor(snapshot.timelines, 'T-9c81', 1, snapshot.assignments)).toHaveLength(4)
    // 分支 3(不存在)→ 回落活跃分支(2)的 blocks
    expect(timelineFor(snapshot.timelines, 'T-9c81', 3, snapshot.assignments)).toEqual(
      timelineFor(snapshot.timelines, 'T-9c81', 2, snapshot.assignments),
    )
    // 单分支工单:T-3f2a 无时间线记录 → 空 blocks(渲染占位,组件处理)
    expect(timelineFor(snapshot.timelines, 'T-3f2a', 1, snapshot.assignments)).toEqual([])
  })
})

describe('报告时间线(assistant blocks 范式,24 号 §6 P2 行;原型一会话面逐字)', () => {
  it('阶段线(sysline):T+0 委派发起 / working / ready 三条,时间 num 段', () => {
    const syslines = byAttr(timelineBranch2, 'data-eterna-workbench', 'sysline')
    expect(syslines).toHaveLength(3)
    expect(textOf(syslines[0]!)).toBe('今天 14:02 · 委派发起（T+0）')
    expect(textOf(syslines[1]!)).toContain('阶段 working · 侧栏出现「进行中」（T+1min）')
    expect(textOf(syslines[2]!)).toContain('阶段 ready · 结果发回本对话（T+20min，本稿假定已答复「按含税」）')
  })

  it('消息块:发起人消息(user,3 附件 chips)+ agent 受理回执;mono 工单号', () => {
    const messages = byAttr(timelineBranch2, 'data-eterna-workbench', 'msg')
    // 4 条:发起人 / 受理回执 / Attention #12 署名行(挂 ask 卡) / Outbox 署名行(挂结果卡)
    expect(messages).toHaveLength(4)
    expect(messages[0]!.attrs['data-eterna-workbench-side']).toBe('user')
    expect(textOf(find1(messages[0]!, 'data-eterna-workbench', 'bubble'))).toContain('帮我把这三家供应商的报价做成对比，出一版给采购总监的材料。')
    const files = byAttr(messages[0]!, 'data-eterna-workbench', 'file-chip')
    expect(files.map(file => file.attrs['data-eterna-workbench-file'])).toEqual(['quote_a.pdf', 'quote_b.pdf', 'quote_c.pdf'])
    expect(textOf(messages[1]!)).toContain('已受理。范围：三家供应商报价对比')
    expect(textOf(messages[1]!)).toContain('工单 T-9c81 已建立')
  })

  it('会话内 Attention 单问卡:一次一问标题 + 单问 + 回复输入 + foot(进度不进 IM/升级提示)', () => {
    const ask = find1(timelineBranch2, 'data-eterna-workbench', 'ask-card')
    expect(textOf(find1(ask, 'data-eterna-workbench', 'ask-title'))).toBe('需要你回答一个问题（一次一问）')
    expect(textOf(find1(ask, 'data-eterna-workbench', 'ask-q'))).toBe('两份报价口径不一致（A 含税 / B 不含税），材料按哪个口径出？')
    const input = find1(ask, 'data-eterna-workbench', 'reply-input')
    expect(input.attrs['placeholder']).toBe('例：统一按含税口径，B 需换算')
    expect(textOf(find1(ask, 'data-eterna-workbench', 'ask-foot'))).toBe('回答仅此一问；其余进度不发到本群（进度不进 IM）。4 小时未答复将升级通知主管。')
    // 提交回答按钮(check 图标 + 文案)
    expect(textOf(find1(ask, 'data-eterna-workbench-action', 'answer'))).toBe('提交回答')
  })

  it('结果卡(Outbox):标题 + 2 附件 + 3 行摘要 + 验收/退回动作(退回 = 新 Assignment 新分支)', () => {
    const result = find1(timelineBranch2, 'data-eterna-workbench', 'result-card')
    expect(textOf(find1(result, 'data-eterna-workbench', 'result-head'))).toBe('材料已就绪 · 统一按含税口径')
    const files = byAttr(result, 'data-eterna-workbench', 'file-chip')
    expect(files.map(file => file.attrs['data-eterna-workbench-file'])).toEqual(['供应商报价对比_含税口径.xlsx', '给采购总监_要点摘要.md'])
    const summaryLines = all(find1(result, 'data-eterna-workbench', 'result-summary'), node => node.tag === 'li')
    expect(summaryLines.map(line => line.text)).toEqual([
      '三家报价统一换算为含税口径，B 供应商换算后总价最低；',
      '交期与账期对比见附件第 2 页；',
      '两处口径疑点已按你的答复处理，无遗留问题。',
    ])
    expect(textOf(result)).toContain('三家报价统一换算为含税口径，B 供应商换算后总价最低；')
    expect(textOf(result)).toContain('两处口径疑点已按你的答复处理，无遗留问题。')
    expect(textOf(find1(result, 'data-eterna-workbench-action', 'accept'))).toBe('验收通过')
    expect(textOf(find1(result, 'data-eterna-workbench-action', 'return'))).toBe('退回并说明')
  })

  it('时间线脚注(原型一 chat-foot 逐字):人的总动作与退回语义', () => {
    expect(textOf(find1(timelineBranch2, 'data-eterna-workbench', 'chat-foot'))).toBe(
      '人的总动作 = 发起、答一问、验收（、可能的退回说明）——同类工作现状需 2–4 小时人工（24 §7.3）。退回 = 同工单新 Assignment 新分支，无需重新 @agent。',
    )
  })

  it('头部:当前工单标题 + 工单号(mono)+ 分支号;分支 chip 组 aria-label', () => {
    expect(textOf(find1(timelineBranch2, 'data-eterna-workbench', 'chat-title'))).toBe('报价对比：口径确认')
    // 渲染树 textOf 先收字符串段后收子元素段(render-tree walk 顺序),文档序 = 工单 T-9c81 · 分支 2
    expect(textOf(find1(timelineBranch2, 'data-eterna-workbench', 'chat-sub'))).toBe('工单 · 分支 T-9c81 2')
    expect(find1(timelineBranch2, 'data-eterna-workbench', 'toolbar').attrs['aria-label']).toBe(
      '多 Assignment 分支切换（退回/重试 = 新 Assignment = 新分支）',
    )
  })

  it('空态:未选工单渲染占位标题;无 blocks 分支渲染占位行', () => {
    const empty = render(
      <TicketTimeline
        ticket={undefined}
        branches={[]}
        activeBranchId={1}
        onBranchChange={() => {}}
        blocks={[]}
        answerDraft=""
        onAnswerChange={() => {}}
        onAnswerSubmit={() => {}}
        onAccept={() => {}}
        onReturn={() => {}}
        t={t}
      />,
    )
    expect(textOf(find1(empty, 'data-eterna-workbench', 'chat-title'))).toBe('选择工单查看报告时间线')
    expect(textOf(find1(empty, 'data-eterna-workbench', 'placeholder'))).toBe('该分支暂无时间线记录')
  })

  it('单分支工单不渲染分支 chip 行(branches.length ≤ 1 无切换面)', () => {
    const single = render(
      <TicketTimeline
        ticket={snapshot.tickets.find(ticket => ticket.id === 'T-3f2a')}
        branches={branchesFor(snapshot.assignments, 'T-3f2a')}
        activeBranchId={1}
        onBranchChange={() => {}}
        blocks={[]}
        answerDraft=""
        onAnswerChange={() => {}}
        onAnswerSubmit={() => {}}
        onAccept={() => {}}
        onReturn={() => {}}
        t={t}
      />,
    )
    expect(byAttr(single, 'data-eterna-workbench', 'chip')).toHaveLength(0)
    expect(textOf(find1(single, 'data-eterna-workbench', 'placeholder'))).toBe('该分支暂无时间线记录')
  })
})
