/**
 * worker 检查器测试(38 号 T12/G2-D10;30 号 §2 视图 5):单 worker 深视图
 * 四要素——子代理树(27 号三层结构实况,W-2 不增层)、运行中 jobs、工具调用
 * 历史、上下文占用 % 与成本累计(R1 预算数据,W-3);渲染 = 原型 03 视图五
 * (#v5)逐字;数据经 mock SSE worker-updated 增量驱动(W-4)。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TasksRuntime } from '@eterna/tasks'
import { WorkerInspector } from '../src/client/WorkerInspector.tsx'
import { workerInspectorView, workerTreeDepth } from '../src/project/worker-view.ts'
import { workerSection } from '../src/project/live-sections.ts'
import { readAuditFiles } from '../src/project/trace-files.ts'
import { applyWorkbenchEvent } from '../src/project/state.ts'
import { initialMockSnapshot, mockTimeline } from '../src/stream/mock-source.ts'
import type { WorkbenchStreamEvent } from '../src/types.ts'
import { bootTasks, dropTenantRoot, makeTenantRoot, openTicket } from './fixtures/live-sections.ts'
import { all, byAttr, find1, rawText, render, textOf } from './render-tree.tsx'

const snapshot = initialMockSnapshot()
const inspector = render(<WorkerInspector snapshot={snapshot.worker} />)

describe('投影:四要素(W-1/G2-D10 口径)', () => {
  it('头卡五元信息:worker/工单/运行/preset/槽位/域包(原型 03 inspector-meta 逐字)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(view.head).toEqual({
      id: 'event-planning-01',
      ticketId: 'T-9c81',
      runMinutes: '22 分钟',
      presetNote: 'preset standard（前台 60 秒转后台）',
      slots: '2/4',
      domainPack: 'event-planning',
    })
  })

  it('子代理树 = 27 号三层结构实况:深度恰为 3,不增层(W-2)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(workerTreeDepth(snapshot.worker.tree)).toBe(3)
    expect(view.tree.map(node => [node.depth, node.name, node.current])).toEqual([
      [0, 'Orchestrator', false],
      [1, 'worker event-planning-01', true],
      [2, 'subagent 调查-报价A', false],
      [2, 'subagent 调查-报价B', false],
      [2, 'subagent reviewer', false],
    ])
    expect(view.tree.map(node => node.role)).toEqual([
      '主 Session · 组织层',
      'T-9c81 · 战术层',
      '完成 · 3 分钟',
      '运行中 · 2 分钟 · 执行层',
      '排队 · 只读 preset',
    ])
  })

  it('jobs:运行中 2 + 已结束 4(原型 03 两段逐字)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(view.jobsRunning.map(job => [job.name, job.meta])).toEqual([
      ['解析 quote_b.pdf', '后台 job #31 · 运行 2 分钟'],
      ['汇总表格生成', '前台 · 运行 1 分钟'],
    ])
    expect(view.jobsDone.map(job => [job.name, job.meta])).toEqual([
      ['解析 quote_a.pdf', '3 分钟 · 成功'],
      ['解析 quote_c.pdf', '2 分钟 · 成功'],
      ['口径比对', '1 分钟 · 成功'],
      ['索引构建', '40 秒 · 成功'],
    ])
  })

  it('工具调用历史五行(时间/工具/参数摘要/状态/耗时;原型 03 表逐字)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(view.toolRows.map(row => [row.time, row.tool, row.params, row.status.label, row.status.tone, row.duration])).toEqual([
      ['14:09:47', 'fs.read', 'quote_a.pdf 等 3 个文件', '成功', 'success', '1.2s'],
      ['14:10:02', 'web.fetch', 'supplier-b.com · 白名单外', '拒绝', 'danger', '96ms'],
      ['14:12:18', 'web.search', '报价 含税 口径', '成功', 'success', '2.1s'],
      ['14:15:40', 'shell.python', 'calc_tax.py 换算脚本', '成功', 'success', '1.8s'],
      ['14:18:30', 'report.write', '.ticket/T-9c81/report.md', '成功', 'success', '40ms'],
    ])
  })

  it('上下文条:68% + 压缩阈值 80% 标线 + role=img 可达名称(原型 03 逐字口径)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(view.contextMeter).toEqual({
      label: '上下文占用 68%',
      percent: 68,
      thresholdPercent: 80,
      note: '阈值 80% 触发分层压缩（28 号） · 系统 12% / 会话 41% / 工单档案 15%',
      aria: '上下文占用 68%，压缩阈值 80%',
    })
  })

  it('成本条:¥3.42/¥8.00 → 43%(取整),tokens/maxTurns/R1 注记(原型 03 逐字)', () => {
    const view = workerInspectorView(snapshot.worker)
    expect(view.costMeter).toEqual({
      label: '成本累计 ¥3.42 / 预算 ¥8.00',
      percent: 43,
      thresholdPercent: undefined,
      note: 'tokens 184k（输入 160k / 输出 24k） · maxTurns 32/60 · 预算守卫 R1',
      aria: '成本 3.42 元，占预算 8 元的 43%',
    })
  })

  it('树纪律注记逐字(27 §2.1 纪律 3)', () => {
    expect(workerInspectorView(snapshot.worker).treeNote).toBe('子代理借用执行者权限，仅向执行者回报；产出统一保存在任务档案目录。')
  })
})

describe('渲染:视图五结构(原型 03 #v5)', () => {
  it('视图头/描述 + 头卡:标题、五元信息列表(工单号等宽/数字表格体)', () => {
    expect(textOf(find1(inspector, 'data-eterna-workbench', 'view-title'))).toBe('worker 检查器 · 单 worker 深视图')
    const desc = textOf(find1(inspector, 'data-eterna-workbench', 'view-desc'))
    expect(desc).toContain('任务分工、进行中的后台作业、工具调用历史')
    expect(desc).toContain('上下文与成本占用')
    const title = find1(inspector, 'data-eterna-workbench', 'inspector-title')
    expect(textOf(title)).toContain('worker')
    expect(textOf(title)).toContain('event-planning-01')
    const meta = byAttr(inspector, 'data-eterna-workbench', 'inspector-meta').flatMap(node => all(node, item => item.tag === 'li')).map(node => textOf(node))
    expect(meta).toEqual([
      '工单 T-9c81', '运行 22 分钟', 'preset standard（前台 60 秒转后台）', '槽位 2/4', '域包 event-planning',
    ])
  })

  it('子代理树:三层嵌套 ul(depth 0/1/2),worker 节点 is-current,状态点配文字注记', () => {
    const nodes = byAttr(inspector, 'data-eterna-workbench', 'tree-node')
    expect(nodes.map(node => node.attrs['data-eterna-workbench-depth'])).toEqual(['0', '1', '2', '2', '2'])
    const current = nodes.filter(node => node.attrs['data-eterna-workbench-current'] === 'true')
    expect(current).toHaveLength(1)
    expect(textOf(current[0]!)).toContain('worker event-planning-01')
    expect(textOf(current[0]!)).toContain('T-9c81 · 战术层')
    // 状态点词汇:root=idle、worker=working、subagent=ready/working/queued
    const dots = nodes.map(node => find1(node, 'data-eterna-workbench', 'dot').attrs['data-eterna-workbench-dot'])
    expect(dots).toEqual(['idle', 'working', 'ready', 'working', 'queued'])
    // 渲染树的 ul 嵌套由 depth 锚点断言(0/1/2);纪律注记逐字
    expect(textOf(find1(inspector, 'data-eterna-workbench', 'tree-note'))).toBe('子代理借用执行者权限，仅向执行者回报；产出统一保存在任务档案目录。')
  })

  it('jobs 两段:运行中列表 2 项(working 点)+ 已结束 details 收起 4 项(ready 点)', () => {
    const running = byAttr(inspector, 'data-eterna-workbench-jobs', 'running')
    expect(byAttr(running[0]!, 'data-eterna-workbench', 'job-item')).toHaveLength(2)
    expect(byAttr(running[0]!, 'data-eterna-workbench-dot', 'working')).toHaveLength(2)
    const runningNames = byAttr(running[0]!, 'data-eterna-workbench', 'job-name').map(node => textOf(node))
    expect(runningNames).toEqual(['解析 quote_b.pdf', '汇总表格生成'])
    const done = find1(inspector, 'data-eterna-workbench', 'jobs-done')
    expect(all(done, node => node.tag === 'summary')[0]!.text).toBe('已结束 jobs（4）')
    expect(done.attrs['open']).toBeUndefined()
    expect(byAttr(done, 'data-eterna-workbench', 'job-item')).toHaveLength(4)
    expect(byAttr(done, 'data-eterna-workbench-dot', 'ready')).toHaveLength(4)
  })

  it('工具调用历史表:五行五列,状态徽标语色配对;caption 带工单归属', () => {
    expect(textOf(all(inspector, node => node.tag === 'caption')[0]!)).toBe('worker event-planning-01 · 本工单')
    const headers = all(inspector, node => node.tag === 'th' && node.attrs['scope'] === 'col').map(node => textOf(node))
    expect(headers).toEqual(['时间', '工具', '参数摘要', '状态', '耗时'])
    const rows = byAttr(inspector, 'data-eterna-workbench', 'tool-row')
    expect(rows.map(row => row.attrs['data-eterna-workbench-tool'])).toEqual(['fs.read', 'web.fetch', 'web.search', 'shell.python', 'report.write'])
    expect(textOf(find1(find1(inspector, 'data-eterna-workbench-tool', 'web.fetch'), 'data-eterna-workbench-tone', 'danger'))).toBe('拒绝')
    expect(textOf(find1(find1(inspector, 'data-eterna-workbench-tool', 'fs.read'), 'data-eterna-workbench-tone', 'success'))).toBe('成功')
    // 摘要行四字段同源纪律:时间/耗时为表格数字
    const first = rows[0]!
    expect(all(first, node => node.attrs['data-eterna-workbench-num'] === 'true').map(node => node.text)).toEqual(['14:09:47', '1.2s'])
  })

  it('上下文/成本条:meter role=img + aria-label 逐字;填充与阈值标线百分比', () => {
    const meters = byAttr(inspector, 'data-eterna-workbench', 'meter')
    expect(meters).toHaveLength(2)
    expect(meters[0]!.attrs['aria-label']).toBe('上下文占用 68%，压缩阈值 80%')
    expect(meters[1]!.attrs['aria-label']).toBe('成本 3.42 元，占预算 8 元的 43%')
    const fills = byAttr(inspector, 'data-eterna-workbench', 'meter-fill').map(node => node.attrs['data-eterna-workbench-fill'])
    expect(fills).toEqual(['68%', '43%'])
    const threshold = find1(inspector, 'data-eterna-workbench', 'meter-threshold')
    expect(threshold.attrs['data-eterna-workbench-at']).toBe('80%')
    const labels = byAttr(inspector, 'data-eterna-workbench', 'metric-label').map(node => textOf(node))
    expect(labels).toContain('上下文占用 68%')
    expect(labels).toContain('成本累计 ¥3.42 / 预算 ¥8.00')
    const subs = byAttr(inspector, 'data-eterna-workbench', 'metric-sub').map(node => textOf(node))
    expect(subs).toContain('阈值 80% 触发分层压缩（28 号） · 系统 12% / 会话 41% / 工单档案 15%')
    expect(subs).toContain('tokens 184k（输入 160k / 输出 24k） · maxTurns 32/60 · 预算守卫 R1')
  })
})

describe('mock SSE 驱动(W-4:worker-updated 增量;38 号 T5 流面)', () => {
  it('worker-updated 事件:上下文 68→71%、成本 ¥3.42→¥3.55、tokens/maxTurns 推进;原快照不改写', () => {
    const increment = mockTimeline().find(item => item.event.kind === 'worker-updated')?.event
    if (increment?.kind !== 'worker-updated') throw new Error('mock 时间线缺 worker-updated')
    const event: WorkbenchStreamEvent = { ...increment, seq: 98 }
    const next = applyWorkbenchEvent(snapshot, event)
    expect(next.worker).not.toBe(snapshot.worker)
    expect(snapshot.worker.context.percent).toBe(68)
    const nextView = workerInspectorView(next.worker)
    expect(nextView.contextMeter.percent).toBe(71)
    expect(nextView.contextMeter.aria).toBe('上下文占用 71%，压缩阈值 80%')
    expect(nextView.costMeter.percent).toBe(44) // 3.55/8 → 44.375 → 44
    expect(nextView.costMeter.note).toBe('tokens 191k（输入 166k / 输出 25k） · maxTurns 33/60 · 预算守卫 R1')
    expect(nextView.head.runMinutes).toBe('23 分钟')
  })

  it('重放同事件幂等(worker-updated 整节替换;引用不变调用方可跳过重绘)', () => {
    const increment = mockTimeline().find(item => item.event.kind === 'worker-updated')?.event
    if (increment?.kind !== 'worker-updated') throw new Error('mock 时间线缺 worker-updated')
    const event: WorkbenchStreamEvent = { ...increment, seq: 98 }
    const once = applyWorkbenchEvent(snapshot, event)
    expect(applyWorkbenchEvent(once, event).worker).toBe(once.worker)
  })

  it('渲染跟随增量:worker-updated 后 71%/¥3.55 面板可见(快照 → 视图全链)', () => {
    const increment = mockTimeline().find(item => item.event.kind === 'worker-updated')?.event
    if (increment?.kind !== 'worker-updated') throw new Error('mock 时间线缺 worker-updated')
    const next = applyWorkbenchEvent(snapshot, { ...increment, seq: 98 })
    const updated = render(<WorkerInspector snapshot={next.worker} />)
    expect(rawText(updated)).toContain('71%')
    expect(rawText(updated)).toContain('¥3.55')
    const fills = byAttr(updated, 'data-eterna-workbench', 'meter-fill').map(node => node.attrs['data-eterna-workbench-fill'])
    expect(fills).toEqual(['71%', '44%'])
  })
})

// ── M4 实接段(38 号 T12 实接半边;引擎 Assignment 面 + audit 归账工具史 + R1 预算)──

describe('M4 实接:引擎真值源(workerSection;30 号 §2 视图 5 数据源列)', () => {
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

  it('pending 工单 → jobs 列「排队 · 待 worker 槽位」,树为组织层单节点(A22 前不虚构执行层)', () => {
    openTicket(runtime, '1')
    const worker = workerSection({ tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } } }, runtime.store.tickets.list(), 3, Date.now())
    expect(worker.jobs).toHaveLength(1)
    expect(worker.jobs[0]!.running).toBe(false)
    expect(worker.jobs[0]!.meta).toContain('排队')
    expect(workerTreeDepth(worker.tree)).toBe(1) // W-2 不增层:执行层需 A22 session 事件
    expect(worker.slotsUsed).toBe(0)
    expect(worker.slotsTotal).toBe(3)
    expect(worker.context.note).toContain('预算接入后将展示用量 · 超过 80% 会提示压缩')
    expect(worker.cost.note).toContain('预算守卫')
  })

  it('R1 预算读数注入 → 上下文占用 %(token 口径)与成本累计计算(W-3)', () => {
    openTicket(runtime, '1')
    const worker = workerSection(
      { tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } }, budgetUsage: { turns: 20, totalTokens: 80_000, maxTokens: 100_000, maxTurns: 60, cost: 1.2, maxCost: 4 } },
      runtime.store.tickets.list(), 3, Date.now(),
    )
    expect(worker.context.percent).toBe(80)
    expect(worker.context.note).toContain('按 token 口径 · 80% 为压缩提示线')
    expect(worker.cost.spentYuan).toBe(1.2)
    expect(worker.cost.budgetYuan).toBe(4)
    expect(worker.cost.maxTurns).toBe('20/60')
    const view = workerInspectorView(worker)
    expect(view.contextMeter.percent).toBe(80)
    expect(view.costMeter.label).toContain('¥1.20 / 预算 ¥4.00')
  })

  it('audit NDJSON 归账(.ticket/<id>/ R4 目录)→ 工具调用史真值;他单归账行不串;无落盘 = 空', async () => {
    const ticketId = openTicket(runtime, '1')
    const assignmentId = runtime.store.tickets.get(ticketId)!.assignments[0]!.id
    runtime.engine.assignmentStarted(ticketId, assignmentId) // worker 在办 = 检查器聚焦面
    const dir = join(root, 'audit')
    mkdirSync(dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    const own = { kind: 'tool-call', seq: 7, at: new Date().toISOString(), turn: 2, step: 1, tool: 'fs.read', callId: 'call-7', argsPreview: `.ticket/${ticketId}/report.md 64k`, isError: false }
    const foreign = { kind: 'tool-call', seq: 8, at: new Date().toISOString(), turn: 1, step: 1, tool: 'web.fetch', callId: 'call-8', argsPreview: '.ticket/T-other/page 64k', isError: false }
    writeFileSync(join(dir, `audit-${day}.jsonl`), `${JSON.stringify(own)}\n${JSON.stringify(foreign)}\n`, 'utf8')
    const files = await readAuditFiles(dir)
    const worker = workerSection(
      { tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } }, auditFiles: files },
      runtime.store.tickets.list(), 3, Date.now(),
    )
    expect(worker.toolHistory).toHaveLength(1) // 他单归账行不进本工单轨迹(R4 一工单一目录)
    expect(worker.toolHistory[0]!.tool).toBe('fs.read')
    expect(worker.toolHistory[0]!.params).toContain(`.ticket/${ticketId}/`)
    // 无在办 worker(工单已结束)→ 聚焦面为空,工具史如实为空(不虚构)
    runtime.engine.stopTicket(ticketId, '收尾')
    const empty = workerSection({ tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } } }, runtime.store.tickets.list(), 3, Date.now())
    expect(empty.toolHistory).toHaveLength(0)
    expect(empty.workerId).toBe('—')
  })

  /**
   * 2026-11-23 线上缺陷门禁:worker 报 `waiting` 后其回合已结束,但 Assignment 领域态仍是
   * `running`(pending→running→ended 只由 endAssignment/工单 end 迁移)。工作台此前按领域态
   * 投影,于是「运行中 jobs」与「槽位 n/m」把停泊工单算成在跑(生产实证:一张单显示
   * 「运行 2843 分钟」)。本用例钉死运行时口径:`waiting` 不得计入运行中与槽位占用。
   */
  it('waiting 报告的工单不算运行中、不占槽(运行时口径,非领域态口径)', () => {
    const ticketId = openTicket(runtime, '1')
    const assignmentId = runtime.store.tickets.get(ticketId)!.assignments[0]!.id
    runtime.engine.assignmentStarted(ticketId, assignmentId)
    runtime.engine.report(ticketId, { state: 'waiting', summary: '本轮结束,等后续消息' })
    runtime.engine.turnEnded(ticketId, assignmentId)
    // 前置事实:领域态仍为 running(正是缺陷的触发条件,断言它没被别处改掉)
    const stored = runtime.store.tickets.get(ticketId)!
    expect(stored.assignments.at(-1)!.state).toBe('running')
    expect(stored.assignments.at(-1)!.report!.state).toBe('waiting')
    const worker = workerSection({ tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } } },
      runtime.store.tickets.list(), 3, Date.parse(stored.assignments.at(-1)!.idleAt!))
    // 运行时口径:不占槽、不进运行中树、jobs 标空闲
    expect(worker.slotsUsed).toBe(0)
    expect(worker.tree.children).toEqual([])
    const job = worker.jobs.find(item => item.id === assignmentId)!
    expect(job.running).toBe(false)
    expect(job.meta).toContain('空闲')
    expect(job.meta).not.toContain('运行 0')
  })

  /**
   * 2026-11-23 线上修复(槽位真读数):`stats().executor.usedSlots` 在场时槽位分子以它为唯一
   * 权威,不再按工单领域态推算——派生近似只在离线快照/mock 面兜底。两者不一致时显示执行面
   * 自己记的账(它知道回合真的在跑没有,投影层看不到)。
   */
  it('slotsUsed 取执行面真读数(usedSlots 在场即权威),缺席才回退 ticketStage 派生', () => {
    const ticketId = openTicket(runtime, '1')
    const assignmentId = runtime.store.tickets.get(ticketId)!.assignments[0]!.id
    runtime.engine.assignmentStarted(ticketId, assignmentId)
    const input = { tasks: { db: { prepare: (sql: string) => runtime.store.db.prepare(sql) as never } } }
    // 在线面:执行面读数 1、派生也 1(工单在 working 且非排队)。
    const online = workerSection({ ...input, tasks: { ...input.tasks, usedSlots: 1 } }, runtime.store.tickets.list(), 3, Date.now())
    expect(online.slotsUsed).toBe(1)
    // worker 报 waiting 后回合已结束;执行面读数 0 才是权威(领域态仍 running 不影响显示)。
    runtime.engine.report(ticketId, { state: 'waiting', summary: '本轮结束' })
    runtime.engine.turnEnded(ticketId, assignmentId)
    const settled = workerSection({ tasks: { ...input.tasks, usedSlots: 0 } }, runtime.store.tickets.list(), 3, Date.now())
    expect(settled.slotsUsed).toBe(0)
    expect(runtime.store.tickets.get(ticketId)!.assignments.at(-1)!.state).toBe('running')
    // 离线面(无 usedSlots 读数):回退 ticketStage 派生,同样得 0——两条口径在这条面上一致。
    const offline = workerSection(input, runtime.store.tickets.list(), 3, Date.now())
    expect(offline.slotsUsed).toBe(0)
  })
})
