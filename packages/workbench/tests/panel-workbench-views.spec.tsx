/**
 * 工作台三视图渲染测试(panel-workbench 渲染面;任务口径「渲染测试仿
 * packages/panel 现有模式」——panel 现无 panel-*.spec.tsx 文件,仓库亦无
 * react-dom(依赖图不可达,memory/panel 客户端测试头注同款事实),故以
 * 受控纯组件直调 + 元素树断言落地渲染级验收:布局结构/状态/文案对原型
 * docs/prototypes/03-workbench-views.html 逐字钉死)。
 */
import { describe, expect, it } from 'vitest'
import { KanbanView } from '../src/client/KanbanView.tsx'
import { LogsView } from '../src/client/LogsView.tsx'
import { EvalView } from '../src/client/EvalView.tsx'
import { initialMockSnapshot, MOCK_PRINCIPAL } from '../src/stream/mock-source.ts'
import { zh } from '../src/client/locales.ts'
import { byAttr, find1, rawText, render, textOf, all } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key
const snapshot = initialMockSnapshot()

const kanbanAdmin = render(
  <KanbanView snapshot={snapshot} role="admin" principal={MOCK_PRINCIPAL} stage="all" onRoleChange={() => {}} onStageChange={() => {}} t={t} />,
)
const logs = render(
  <LogsView
    snapshot={snapshot}
    filter={{ ticketId: 'T-9c81', query: '' }}
    onTicketChange={() => {}}
    onQueryChange={() => {}}
    expandedIds={new Set(['t9c81-decision'])}
    onToggleExpand={() => {}}
    t={t}
  />,
)
const evalView = render(<EvalView snapshot={snapshot} />)

describe('视图一 工作监控 · 看板渲染(原型 03 视图一逐字)', () => {
  it('视图头:kicker 视图一 + 标题「工作监控 · 工单看板」+ 视图描述含阶段分列与 realm 钳制文案', () => {
    expect(textOf(find1(kanbanAdmin, 'data-eterna-workbench', 'kicker'))).toBe('视图一')
    expect(textOf(find1(kanbanAdmin, 'data-eterna-workbench', 'view-title'))).toBe('工作监控 · 工单看板')
    const desc = textOf(find1(kanbanAdmin, 'data-eterna-workbench', 'view-desc'))
    expect(desc).toContain('工单按阶段分列：')
    expect(desc).toContain('（等人）')
    expect(desc).toContain('（进行中）')
    expect(desc).toContain('（排队）')
    expect(desc).toContain('（空闲）')
    expect(desc).toContain('数据按 access realm 钳制：普通用户仅自己的工单，审批人见全租户待人项，管理员全量（30 §4-5、§7-3 拍板）。')
  })

  it('四列常显:等人 person/*/进行中 working/排队中 working/queued/空闲 idle,计数 3/2/1/1(= 原型)', () => {
    const columns = byAttr(kanbanAdmin, 'data-eterna-workbench', 'kanban-col')
    expect(columns).toHaveLength(4)
    const expectColumn = (index: number, key: string, label: string, code: string, count: string): void => {
      const column = columns[index]!
      expect(column.attrs['data-eterna-workbench-col']).toBe(key)
      const header = textOf(find1(column, 'data-eterna-workbench', 'kanban-col-h'))
      expect(header).toContain(label)
      expect(header).toContain(code)
      expect(textOf(find1(column, 'data-eterna-workbench', 'count'))).toBe(count)
    }
    expectColumn(0, 'person', '等人', 'person/*', '3')
    expectColumn(1, 'working', '进行中', 'working', '2')
    expectColumn(2, 'queued', '排队中', 'working/queued', '1')
    expectColumn(3, 'idle', '空闲', 'idle', '1')
  })

  it('列头状态点词汇表:等人=wait-person+pulse 心跳、进行中=working、排队中=queued、空闲=idle', () => {
    const dotOf = (colIndex: number): { dot: string; pulse: string | undefined } => {
      const column = byAttr(kanbanAdmin, 'data-eterna-workbench', 'kanban-col')[colIndex]!
      const dot = find1(column, 'data-eterna-workbench', 'dot')
      return { dot: dot.attrs['data-eterna-workbench-dot'] ?? '', pulse: dot.attrs['data-eterna-workbench-pulse'] }
    }
    expect(dotOf(0)).toEqual({ dot: 'wait-person', pulse: 'true' })
    expect(dotOf(1).dot).toBe('working')
    expect(dotOf(2).dot).toBe('queued')
    expect(dotOf(3).dot).toBe('idle')
  })

  it('工单卡 7 张:标题/meta 行/等宽与表格数字段/person 卡 stuck 态与 Attention 徽标', () => {
    const cards = byAttr(kanbanAdmin, 'data-eterna-workbench', 'kan-card')
    expect(cards).toHaveLength(7)
    const first = find1(kanbanAdmin, 'data-eterna-workbench-card', 'T-9c81')
    expect(textOf(find1(first, 'data-eterna-workbench', 'kan-title'))).toBe('报价对比：口径确认')
    expect(first.attrs['data-eterna-workbench-stuck']).toBe('true')
    const meta = textOf(find1(first, 'data-eterna-workbench', 'kan-meta'))
    expect(meta).toBe('T-9c81 person/answer 等陈默回答 4 小时')
    // mono/num 段标记(工单号等宽、时长表格数字)
    const monoSpans = all(first, node => node.attrs['data-eterna-workbench-seg-mono'] === 'true')
    expect(monoSpans.map(node => node.text)).toEqual(['T-9c81'])
    const numSpans = all(first, node => node.attrs['data-eterna-workbench-seg-num'] === 'true')
    expect(numSpans.map(node => node.text)).toEqual(['4 小时'])
    // Attention 徽标行(warn 徽标 + 卡点驻留)
    const badge = find1(first, 'data-eterna-workbench-tone', 'warn')
    expect(textOf(badge)).toContain('Attention #12')
    expect(textOf(first)).toContain('卡点驻留')
    // working 卡无 stuck 态
    const workingCard = find1(kanbanAdmin, 'data-eterna-workbench-card', 'T-3f2a')
    expect(workingCard.attrs['data-eterna-workbench-stuck']).toBeUndefined()
    expect(textOf(find1(workingCard, 'data-eterna-workbench', 'kan-meta'))).toBe('T-3f2a worker legal-02 22 分钟')
  })

  it('过滤工具条:视角三 chip(管理员态 is-on)+ 阶段五 chip 带计数(全部 7/等人 3/进行中 2/排队 1/空闲 1)', () => {
    const chips = byAttr(kanbanAdmin, 'data-eterna-workbench', 'chip')
    const labels = chips.map(chip => textOf(chip))
    expect(labels).toEqual([
      '普通用户（仅自己的）', '审批人（全租户待人）', '管理员（全量）',
      '全部 7', '等人 3', '进行中 2', '排队 1', '空闲 1',
    ])
    const on = chips.filter(chip => chip.attrs['data-eterna-workbench-on'] === 'true').map(chip => textOf(chip))
    expect(on).toEqual(['管理员（全量）', '全部 7'])
    expect(chips.every(chip => chip.attrs['aria-pressed'] === 'true' || chip.attrs['aria-pressed'] === 'false')).toBe(true)
  })

  it('冲突三指标(27 号 D2):三卡标签/值/副行逐字,duplicate 卡带「达标」徽标,无告警 UI', () => {
    expect(textOf(find1(kanbanAdmin, 'data-eterna-workbench', 'sub-h'))).toBe('冲突三指标（27 号 D2）')
    const cards = byAttr(kanbanAdmin, 'data-eterna-workbench', 'metric-card')
    expect(cards).toHaveLength(3)
    const rows = cards.map(card => [
      textOf(find1(card, 'data-eterna-workbench', 'metric-label')),
      textOf(find1(card, 'data-eterna-workbench', 'metric-value')),
      textOf(find1(card, 'data-eterna-workbench', 'metric-sub')),
    ])
    expect(rows).toEqual([
      ['attach 次数 · 本周', '6', '同线程候选挂接 · 环比 -2'],
      ['duplicate 比例', '3.2%', '幂等 trigger id 查重 · 阈值 < 5% 达标'],
      ['插队次数 · 本周', '1', '人插队 +1 槽（WorkerSlots），唤醒优先于新 launch'],
    ])
    // 先记录不告警(K-3):不出现「告警」字样
    expect(rawText(kanbanAdmin)).not.toContain('告警')
  })

  it('视角钳制渲染:普通用户(陈默)仅 3 卡;审批人仅 person 列 3 卡', () => {
    const userView = render(
      <KanbanView snapshot={snapshot} role="user" principal={MOCK_PRINCIPAL} stage="all" onRoleChange={() => {}} onStageChange={() => {}} t={t} />,
    )
    const userCards = byAttr(userView, 'data-eterna-workbench', 'kan-card')
    expect(userCards.map(card => card.attrs['data-eterna-workbench-card'])).toEqual(['T-9c81', 'T-88b1', 'T-1d07'])
    expect(textOf(byAttr(userView, 'data-eterna-workbench', 'chip')[3]!)).toBe('全部 3')
    const approverView = render(
      <KanbanView snapshot={snapshot} role="approver" principal={MOCK_PRINCIPAL} stage="all" onRoleChange={() => {}} onStageChange={() => {}} t={t} />,
    )
    const approverCards = byAttr(approverView, 'data-eterna-workbench', 'kan-card')
    expect(approverCards.map(card => card.attrs['data-eterna-workbench-card'])).toEqual(['T-9c81', 'T-a21f', 'T-88b1'])
  })

  it('阶段过滤渲染:进行中 → 仅 working 列出卡,其余列空', () => {
    const workingOnly = render(
      <KanbanView snapshot={snapshot} role="admin" principal={MOCK_PRINCIPAL} stage="working" onRoleChange={() => {}} onStageChange={() => {}} t={t} />,
    )
    const columns = byAttr(workingOnly, 'data-eterna-workbench', 'kanban-col')
    const perColumn = columns.map(column => byAttr(column, 'data-eterna-workbench', 'kan-card').length)
    expect(perColumn).toEqual([0, 2, 0, 0])
    // 阶段 chip 计数仍按视角全集(全部 7)
    expect(textOf(byAttr(workingOnly, 'data-eterna-workbench', 'chip')[3]!)).toBe('全部 7')
  })
})

describe('视图三 日志监控 · 摘要行 + 展开态渲染(原型 03 视图三逐字)', () => {
  it('视图头与工具条:标题/描述/工单三 chip(T-9c81 on)/检索框 placeholder', () => {
    expect(textOf(find1(logs, 'data-eterna-workbench', 'kicker'))).toBe('视图三')
    expect(textOf(find1(logs, 'data-eterna-workbench', 'view-title'))).toBe('日志监控 · 摘要行 + 展开态')
    const desc = textOf(find1(logs, 'data-eterna-workbench', 'view-desc'))
    expect(desc).toContain('默认摘要行 = 工具名 / 参数摘要 / 结果状态 / 耗时')
    expect(desc).toContain('可插拔正则')
    expect(desc).toContain('只过滤不删改')
    expect(desc).toContain('（§7-4 拍板）')
    const ticketChips = byAttr(logs, 'data-eterna-workbench-ticket')
    expect(ticketChips.map(chip => textOf(chip))).toEqual(['T-9c81', 'T-a21f', 'T-3f2a'])
    expect(ticketChips[0]!.attrs['data-eterna-workbench-on']).toBe('true')
    expect(ticketChips[1]!.attrs['data-eterna-workbench-on']).toBeUndefined()
    const search = find1(logs, 'data-eterna-workbench', 'log-search')
    expect(search.attrs['placeholder']).toBe('检索工具 / 参数 / 状态')
    expect(search.attrs['type']).toBe('search')
  })

  it('摘要行四字段:audit 8 条 + worker 会话 2 条;首条 Trigger 摘要行逐字段', () => {
    const auditEntries = byAttr(byAttr(logs, 'data-eterna-workbench', 'log-list')[0]!, 'data-eterna-workbench', 'log-entry')
    expect(auditEntries).toHaveLength(8)
    const workerList = byAttr(logs, 'data-eterna-workbench-logs', 'worker-session')
    const workerEntries = byAttr(workerList[0]!, 'data-eterna-workbench', 'log-entry')
    expect(workerEntries).toHaveLength(2)
    expect(textOf(find1(logs, 'data-eterna-workbench', 'sub-h'))).toBe('worker 会话日志（event-planning-01）')
    const trigger = auditEntries[0]!
    expect(trigger.attrs['data-eterna-workbench-entry']).toBe('t9c81-trigger')
    const summary = textOf(trigger)
    expect(summary).toContain('14:02:11')
    expect(summary).toContain('Trigger')
    expect(summary).toContain('飞书群 @agent · 幂等 id tri_9f21')
    expect(textOf(find1(trigger, 'data-eterna-workbench-tone', 'accent'))).toBe('accept')
    expect(textOf(find1(trigger, 'data-eterna-workbench', 'log-dur'))).toBe('84ms')
    // fs.read 行:工具名带「工具 」前缀 + 成功徽标
    const fsRead = find1(logs, 'data-eterna-workbench-entry', 't9c81-fs-read')
    expect(textOf(find1(fsRead, 'data-eterna-workbench', 'log-src'))).toBe('工具 fs.read')
    expect(textOf(find1(fsRead, 'data-eterna-workbench-tone', 'success'))).toBe('成功')
    // web.fetch 拒绝徽标 + Report blocked 徽标
    expect(textOf(find1(find1(logs, 'data-eterna-workbench-entry', 't9c81-web-fetch'), 'data-eterna-workbench-tone', 'danger'))).toBe('拒绝')
    expect(textOf(find1(find1(logs, 'data-eterna-workbench-entry', 't9c81-report'), 'data-eterna-workbench-tone', 'warn'))).toBe('blocked')
  })

  it('展开态:受控 expandedIds → details open;Decision 条默认展开,其余收起', () => {
    const entries = byAttr(logs, 'data-eterna-workbench', 'log-entry')
    const openStates = entries.map(entry => entry.attrs['open'])
    expect(openStates.filter(state => state === 'true')).toEqual(['true'])
    expect(find1(logs, 'data-eterna-workbench-entry', 't9c81-decision').attrs['open']).toBe('true')
    expect(find1(logs, 'data-eterna-workbench-entry', 't9c81-trigger').attrs['open']).toBeUndefined()
    expect(find1(logs, 'data-eterna-workbench-entry', 't9c81-outbox').attrs['open']).toBeUndefined()
    const decisionFull = textOf(find1(find1(logs, 'data-eterna-workbench-entry', 't9c81-decision'), 'data-eterna-workbench', 'log-full'))
    expect(decisionFull).toContain('理由：名单内 + 明确 @；范围 = 三家供应商报价对比；Mandate v3 · L2 委派；stop 候选 0。')
    expect(decisionFull).toContain('策略版本 hitl.yaml@v7 随单固化，后续不可变（24 §7.5 合规优势）。')
  })

  it('展开全文 PII 过滤(30 §7-4):fs.read 展开态手机号/邮箱脱敏,原始明文不出现;未展开条目无全文', () => {
    const expanded = render(
      <LogsView
        snapshot={snapshot}
        filter={{ ticketId: 'T-9c81', query: '' }}
        onTicketChange={() => {}}
        onQueryChange={() => {}}
        expandedIds={new Set(['t9c81-fs-read'])}
        onToggleExpand={() => {}}
        t={t}
      />,
    )
    const fsRead = find1(expanded, 'data-eterna-workbench-entry', 't9c81-fs-read')
    expect(fsRead.attrs['open']).toBe('true')
    const full = find1(fsRead, 'data-eterna-workbench', 'log-full')
    const text = textOf(full)
    expect(text).toContain('联系人 [PII:cn-mobile] / 邮箱 [PII:email]（展示层 PII 正则脱敏）。')
    expect(rawText(expanded)).not.toContain('13812345678')
    expect(rawText(expanded)).not.toContain('jing.chen@corp.com')
    // 收起条目不渲染全文(展开路径才走 PII 过滤器)
    expect(byAttr(find1(expanded, 'data-eterna-workbench-entry', 't9c81-trigger'), 'data-eterna-workbench', 'log-full')).toHaveLength(0)
    expect(find1(expanded, 'data-eterna-workbench-entry', 't9c81-trigger').attrs['open']).toBeUndefined()
  })

  it('检索过滤渲染:query=fetch 只留 web.fetch 行(audit 1 条,worker 会话 1 条)', () => {
    const filtered = render(
      <LogsView
        snapshot={snapshot}
        filter={{ ticketId: 'T-9c81', query: 'fetch' }}
        onTicketChange={() => {}}
        onQueryChange={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        t={t}
      />,
    )
    const auditEntries = byAttr(byAttr(filtered, 'data-eterna-workbench', 'log-list')[0]!, 'data-eterna-workbench', 'log-entry')
    expect(auditEntries.map(entry => entry.attrs['data-eterna-workbench-entry'])).toEqual(['t9c81-web-fetch'])
    const workerEntries = byAttr(byAttr(filtered, 'data-eterna-workbench-logs', 'worker-session')[0]!, 'data-eterna-workbench', 'log-entry')
    expect(workerEntries.map(entry => entry.attrs['data-eterna-workbench-entry'])).toEqual(['t9c81-session-fetch'])
  })

  it('空工单占位:T-a21f 无日志 → 空态行(中文)', () => {
    const empty = render(
      <LogsView
        snapshot={snapshot}
        filter={{ ticketId: 'T-a21f', query: '' }}
        onTicketChange={() => {}}
        onQueryChange={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        t={t}
      />,
    )
    const placeholders = byAttr(empty, 'data-eterna-workbench', 'placeholder')
    expect(placeholders).toHaveLength(2)
    expect(placeholders.every(node => textOf(node) === '该工单暂无日志')).toBe(true)
  })
})

describe('视图四 评测监控 · 金集趋势与衰减渲染(原型 03 视图四逐字)', () => {
  it('四指标卡:标签/值/副行逐字;衰减卡与漂移卡形态(达标徽标/无警报)', () => {
    expect(textOf(find1(evalView, 'data-eterna-workbench', 'kicker'))).toBe('视图四')
    expect(textOf(find1(evalView, 'data-eterna-workbench', 'view-title'))).toBe('评测监控 · 金集趋势与衰减')
    const cards = byAttr(evalView, 'data-eterna-workbench', 'metric-card')
    expect(cards).toHaveLength(4)
    const rows = cards.map(card => [
      textOf(find1(card, 'data-eterna-workbench', 'metric-label')),
      textOf(find1(card, 'data-eterna-workbench', 'metric-value')),
      textOf(find1(card, 'data-eterna-workbench', 'metric-sub')),
    ])
    expect(rows).toEqual([
      ['金集通过率 · 最近跑批', '92.4%', '环比 +0.6pp · 金集 30 条'],
      ['路由金集衰减', '0.8pp', '会话深度 8 · 阈值 ≤ 2pp 达标'],
      ['漂移检测（observe）', '无警报', '连续 14 天无漂移'],
      ['本周回归跑批', '14 次', 'prompt 版本绑定请求（24 §7.6）'],
    ])
  })

  it('趋势图:标题/坐标点串/达标线 90%/warn 点(第 3 次 89.8)/轴标注与脚注', () => {
    const trend = find1(evalView, 'data-eterna-workbench-chart', 'trend')
    expect(textOf(find1(evalView, 'data-eterna-workbench', 'chart-title'))).toContain('金集通过率趋势（近 7 次跑批）')
    const series = find1(trend, 'data-eterna-workbench', 'chart-series')
    expect(series.attrs['points']).toBe('80,108.2 145,101 210,111.8 275,96.5 340,92 405,99.2 470,88.4')
    expect(find1(trend, 'data-eterna-workbench', 'chart-gate-lbl').text).toBe('达标线 90%')
    const warnPoints = byAttr(trend, 'data-eterna-workbench-warn', 'true')
    expect(warnPoints).toHaveLength(1)
    expect(warnPoints[0]!.attrs['cx']).toBe('210')
    expect(warnPoints[0]!.attrs['data-eterna-workbench-value']).toBe('89.8')
    const points = byAttr(trend, 'data-eterna-workbench', 'chart-pt')
    expect(points).toHaveLength(7)
    const labels = byAttr(trend, 'data-eterna-workbench', 'chart-lbl').map(node => node.text)
    expect(labels).toContain('第 1 次')
    expect(labels).toContain('第 7 次')
    expect(labels).toContain('通过率 %')
    expect(labels.slice(0, 5)).toEqual(['80', '85', '90', '95', '100'])
    expect(textOf(find1(evalView, 'data-eterna-workbench', 'chart-note'))).toBe('第 3 次 89.8% 触发达标线复核（dsh-evals 回归门）。')
  })

  it('趋势图 a11y 叙述(desc):与原型逐字(含第 3 次低于达标线)', () => {
    const trend = find1(evalView, 'data-eterna-workbench-chart', 'trend')
    const desc = byAttr(trend, 'tag', 'desc')[0] ?? all(trend, node => node.tag === 'desc')[0]
    expect(desc).toBeDefined()
    expect(desc!.text).toBe('近 7 次跑批通过率依次为 90.2、91.0、89.8、91.5、92.0、91.2、92.4；达标线 90%。第 3 次 89.8% 低于达标线，其余均达标。')
  })

  it('衰减曲线:标题/点位串/阈值线 2pp(28 §5)/深度轴标注与脚注', () => {
    const decay = find1(evalView, 'data-eterna-workbench-chart', 'decay')
    const titles = byAttr(evalView, 'data-eterna-workbench', 'chart-title').map(node => textOf(node))
    expect(titles).toContain('路由金集衰减曲线（压缩前后通过率差）')
    const series = find1(decay, 'data-eterna-workbench', 'chart-series')
    // x 坐标 = 均匀铺点取整(原型手摆点位与之差 ≤1px,几何同构;y 逐值一致)
    expect(series.attrs['points']).toBe('80,185.6 136,164 191,171.2 247,142.4 303,149.6 359,135.2 414,142.4 470,120.8')
    expect(find1(decay, 'data-eterna-workbench', 'chart-gate-lbl').text).toBe('阈值 2pp（28 §5）')
    expect(byAttr(decay, 'data-eterna-workbench', 'chart-pt')).toHaveLength(8)
    expect(byAttr(decay, 'data-eterna-workbench-warn', 'true')).toHaveLength(0)
    const labels = byAttr(decay, 'data-eterna-workbench', 'chart-lbl').map(node => node.text)
    expect(labels).toContain('深度 1')
    expect(labels).toContain('深度 8')
    expect(labels).toContain('衰减 pp')
    expect(labels.slice(0, 3)).toEqual(['0', '1', '2'])
    const notes = byAttr(evalView, 'data-eterna-workbench', 'chart-note').map(node => textOf(node))
    expect(notes).toContain('压缩前后各跑一遍路由金集；衰减超标调摘要档位，不靠 prompt 硬扛（28 §5）。')
  })

  it('衰减图 a11y 叙述(desc):与原型逐字(全程未超标)', () => {
    const decay = find1(evalView, 'data-eterna-workbench-chart', 'decay')
    const desc = all(decay, node => node.tag === 'desc')[0]
    expect(desc).toBeDefined()
    expect(desc!.text).toBe('会话深度 1 至 8 的衰减依次为 0.2、0.5、0.4、0.8、0.7、0.9、0.8、1.1 个百分点；阈值 2 个百分点，全程未超标。')
  })
})

describe('负向断言(38 号 F-11:全局时间轴回放不做)', () => {
  it('三视图渲染面不出现「回放」/「时间轴」UI 入口文案', () => {
    for (const tree of [kanbanAdmin, logs, evalView]) {
      expect(rawText(tree)).not.toContain('回放')
      expect(rawText(tree)).not.toContain('时间轴')
    }
  })
})
