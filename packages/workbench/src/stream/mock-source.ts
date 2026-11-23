/**
 * mock 事件源(38 号 T5:先以 mock 事件流驱动前端,M3;30 号 §6 SSE 行)。
 *
 * 数据集 = 原型三(docs/prototypes/03-workbench-views.html)三视图静态稿 +
 * 视图五 worker 检查器、原型四(04-flow-a11y-list.html)旁挂列表的逐字落地:
 * 视图一工单看板 7 卡、冲突三指标;视图二信息流图九节点活况/活跃边/卡点气泡;
 * 视图三日志 8+2 条(摘要行四字段 + 展开全文);视图四评测四指标 + 两曲线
 * 序列;视图五子代理树/jobs/工具史/上下文与成本;**原型一(01-task-sidebar.html)
 * 会话侧栏**(T6:会话四行、我的工单 7 行分组/状态点、报告时间线 blocks 逐字)
 * 与**原型二(02-attention-card.html)站内横幅**(T7:T-a21f 超集卡,经 interact
 * card.ts buildApprovalCard 构造)。文案/状态/数值不得偏离原型(任务规格:
 * 原型即规格)。fs.read 展开全文中的手机号/邮箱为**原始明文**(mock 的 audit
 * 原文),展示层经 governance pii redact 过滤(pii-view.ts),原文不改(30 号 §7-4)。
 *
 * 增量时间线为 mock 脚本(原型为静态稿,未定义增量;脚本只改数据不动文案面):
 * +2s 突发 eval-run + log-appended(两事件同窗,演示 200ms 合批)、+4s
 * worker-updated(检查器上下文/成本推进,W-4 上游事件面的 mock)、+6s
 * ticket-moved(T-88b1 验收通过转 working,Assignment 卡点 3→2 派生刷新)。
 * 此后静默(指标心跳频率未拍板,38 号 O-7,不自行发明)。
 *
 * 分支/时间线亦为 mock 脚本数据(原型一为静态稿,未定义多分支形态——38 号
 * O-9 该两处以原型词汇为界):T-9c81 分支 1 = 首轮 failed(web.fetch 白名单外
 * 拒绝,一次重试可解,27 号 §1.2:failed 重试 = 新 Assignment 新分支)→ 分支 2
 * (活跃)= 原型一会话面逐字(14:02 委派发起 T+0 → 14:31 结果卡)。
 */
import { buildAttentionCard } from '../project/attention.ts'
import type { WorkbenchIncrement, WorkbenchSnapshot } from '../types.ts'

/** 视图五 worker 检查器静态面(原型 03 #v5 逐字;worker-updated 增量以此为基线推进)。 */
function mockWorkerSnapshot(): WorkbenchSnapshot['worker'] {
  return {
    workerId: 'event-planning-01',
    ticketId: 'T-9c81',
    runMinutes: 22,
    presetNote: 'preset standard（前台 60 秒转后台）',
    slotsUsed: 2,
    slotsTotal: 4,
    domainPack: 'event-planning',
    tree: {
      name: 'Orchestrator',
      role: '主 Session · 组织层',
      state: 'idle',
      children: [
        {
          name: 'worker event-planning-01',
          role: 'T-9c81 · 战术层',
          state: 'working',
          current: true,
          children: [
            { name: 'subagent 调查-报价A', role: '完成 · 3 分钟', state: 'ready' },
            { name: 'subagent 调查-报价B', role: '运行中 · 2 分钟 · 执行层', state: 'working' },
            { name: 'subagent reviewer', role: '排队 · 只读 preset', state: 'queued' },
          ],
        },
      ],
    },
    jobs: [
      { id: 'job-31', name: '解析 quote_b.pdf', meta: '后台 job #31 · 运行 2 分钟', running: true },
      { id: 'job-front', name: '汇总表格生成', meta: '前台 · 运行 1 分钟', running: true },
      { id: 'job-a', name: '解析 quote_a.pdf', meta: '3 分钟 · 成功', running: false },
      { id: 'job-c', name: '解析 quote_c.pdf', meta: '2 分钟 · 成功', running: false },
      { id: 'job-compare', name: '口径比对', meta: '1 分钟 · 成功', running: false },
      { id: 'job-index', name: '索引构建', meta: '40 秒 · 成功', running: false },
    ],
    toolHistory: [
      { id: 'tool-1', time: '14:09:47', tool: 'fs.read', params: 'quote_a.pdf 等 3 个文件', status: { label: '成功', tone: 'success' }, duration: '1.2s' },
      { id: 'tool-2', time: '14:10:02', tool: 'web.fetch', params: 'supplier-b.com · 白名单外', status: { label: '拒绝', tone: 'danger' }, duration: '96ms' },
      { id: 'tool-3', time: '14:12:18', tool: 'web.search', params: '报价 含税 口径', status: { label: '成功', tone: 'success' }, duration: '2.1s' },
      { id: 'tool-4', time: '14:15:40', tool: 'shell.python', params: 'calc_tax.py 换算脚本', status: { label: '成功', tone: 'success' }, duration: '1.8s' },
      { id: 'tool-5', time: '14:18:30', tool: 'report.write', params: '.ticket/T-9c81/report.md', status: { label: '成功', tone: 'success' }, duration: '40ms' },
    ],
    context: {
      percent: 68,
      thresholdPercent: 80,
      note: '阈值 80% 触发分层压缩（28 号） · 系统 12% / 会话 41% / 工单档案 15%',
    },
    cost: {
      spentYuan: 3.42,
      budgetYuan: 8,
      tokensNote: '184k（输入 160k / 输出 24k）',
      maxTurns: '32/60',
      note: '预算守卫 R1',
    },
  }
}

/** 会话侧栏「会话」分区(原型一逐字四行;发起自渠道注记,24 号 §7.2 原对话)。 */
function mockSessions(): WorkbenchSnapshot['sessions'] {
  return [
    { id: 'sess-1', title: '采购报价对比', channel: '飞书群' },
    { id: 'sess-2', title: '合同审查', channel: 'Web' },
    { id: 'sess-3', title: '周报整理', channel: '飞书私聊' },
    { id: 'sess-4', title: '活动排期', channel: 'Web' },
  ]
}

/** 多 Assignment 分支(T6;原型一静态稿未定义多分支形态——38 号 O-9,本数据为
 * mock 脚本,文案面取原型词汇:退回 = 同工单新 Assignment 新分支(24 号 §7.2
 * T+21min 行)、failed 重试 = 新分支(27 号 §1.2)。T-9c81 分支 1 = 首轮
 * failed → 分支 2(活跃)= 原型一会话面(14:02 委派发起);其余工单单分支。 */
function mockAssignments(): WorkbenchSnapshot['assignments'] {
  return [
    { ticketId: 'T-9c81', seq: 1, state: 'failed', note: '首轮 · web.fetch 拒绝', active: false },
    { ticketId: 'T-9c81', seq: 2, state: 'ready', note: '含税口径统一', active: true },
    { ticketId: 'T-a21f', seq: 1, state: 'working', note: '待审批', active: true },
    { ticketId: 'T-88b1', seq: 1, state: 'ready', note: '物料已就绪', active: true },
    { ticketId: 'T-3f2a', seq: 1, state: 'working', note: 'legal-02 审查中', active: true },
    { ticketId: 'T-77c0', seq: 1, state: 'working', note: 'sourcing-01 背调中', active: true },
    { ticketId: 'T-1d07', seq: 1, state: 'working', note: '排队 · 2/4 槽', active: true },
    { ticketId: 'T-55e9', seq: 1, state: 'ready', note: '观察模式 · 无待办', active: true },
  ]
}

/** T-9c81 分支 2 报告时间线(原型一会话面逐字:sysline 阶段线/message 消息/
 * ask 单问卡/result 结果卡;ask/result 按钮与输入为静态占位,动作经组件
 * props 留 M4 接口——原型标注五「静态稿声明」)。 */
function mockTimelineT9c81Branch2(): WorkbenchSnapshot['timelines'][number]['blocks'] {
  return [
    { kind: 'sysline', time: '今天 14:02', text: '委派发起（T+0）' },
    {
      kind: 'message',
      side: 'user',
      who: '陈默',
      time: '14:02',
      text: '帮我把这三家供应商的报价做成对比，出一版给采购总监的材料。',
      files: [
        { name: 'quote_a.pdf', meta: '1.2 MB' },
        { name: 'quote_b.pdf', meta: '0.9 MB' },
        { name: 'quote_c.pdf', meta: '1.0 MB' },
      ],
    },
    {
      kind: 'message',
      side: 'agent',
      who: 'agent',
      time: '14:02（T+5s 受理）',
      text: '已受理。范围：三家供应商报价对比；产出：给采购总监的材料。工单 T-9c81 已建立，进度见左侧「我的工单」分组。',
    },
    { kind: 'sysline', time: '14:03', text: '阶段 working · 侧栏出现「进行中」（T+1min）' },
    {
      kind: 'message',
      side: 'agent',
      who: 'agent · Attention #12（T+8min）',
      time: '14:10',
      text: '',
    },
    {
      kind: 'ask',
      title: '需要你回答一个问题（一次一问）',
      question: '两份报价口径不一致（A 含税 / B 不含税），材料按哪个口径出？',
      placeholder: '例：统一按含税口径，B 需换算',
      foot: '回答仅此一问；其余进度不发到本群（进度不进 IM）。4 小时未答复将升级通知主管。',
    },
    { kind: 'sysline', time: '14:31', text: '阶段 ready · 结果发回本对话（T+20min，本稿假定已答复「按含税」）' },
    {
      kind: 'message',
      side: 'agent',
      who: 'agent · Outbox',
      time: '14:31',
      text: '',
    },
    {
      kind: 'result',
      title: '材料已就绪 · 统一按含税口径',
      files: [
        { name: '供应商报价对比_含税口径.xlsx', meta: '86 KB' },
        { name: '给采购总监_要点摘要.md', meta: '4 KB' },
      ],
      summary: [
        '三家报价统一换算为含税口径，B 供应商换算后总价最低；',
        '交期与账期对比见附件第 2 页；',
        '两处口径疑点已按你的答复处理，无遗留问题。',
      ],
    },
  ]
}

/** T-9c81 分支 1 报告时间线(mock 脚本:首轮 failed,27 号 §1.2 failed 重试 =
 * 新 Assignment 新分支;文案面取原型词汇)。 */
function mockTimelineT9c81Branch1(): WorkbenchSnapshot['timelines'][number]['blocks'] {
  return [
    { kind: 'sysline', time: '13:40', text: '委派发起（首轮）' },
    {
      kind: 'message',
      side: 'agent',
      who: 'agent',
      time: '13:40（T+5s 受理）',
      text: '已受理。范围：三家供应商报价对比（首轮）。工单 T-9c81 已建立。',
    },
    {
      kind: 'message',
      side: 'agent',
      who: 'agent',
      time: '13:52',
      text: 'web.fetch 白名单外拒绝（supplier-b.com），改走人工附件路径仍未定稿口径（governance deny-wins，未重试）。',
    },
    { kind: 'sysline', time: '13:53', text: '阶段 failed · 一次重试可解 → 重试 = 新 Assignment 新分支（27 号 §1.2）' },
  ]
}

/** 报告时间线节(T6;分支 2 = 原型一逐字,分支 1 = mock 脚本;其余工单暂无
 * 会话面时间线,M4 由 audit trace/assistant blocks 实接)。 */
function mockTimelines(): WorkbenchSnapshot['timelines'] {
  return [
    { ticketId: 'T-9c81', branchSeq: 2, blocks: mockTimelineT9c81Branch2() },
    { ticketId: 'T-9c81', branchSeq: 1, blocks: mockTimelineT9c81Branch1() },
  ]
}

/** 驻留 Attention 卡(T7;原型二形态一站内横幅逐字:T-a21f 付款申请,R3,
 * 倒计时 = 4 小时窗口 − 已等 1 小时 20 分 = 剩余 2 小时 40 分)。payload 构造
 * 走 interact card.ts buildApprovalCard(A-1 不另起管线);五必备字段 + R3
 * 附加按 24 号 §5.2 组装,文案对齐原型二 attn-context。 */
function mockAttention(): NonNullable<WorkbenchSnapshot['attention']> {
  return buildAttentionCard({
    ticketId: 'T-a21f',
    question: '向供应商 QY-2201 支付预付款 ¥48,000，是否批准？',
    riskLabel: '资金红线 R3',
    originator: '陈默',
    channel: '飞书群「采购三部」',
    mandateNote: 'Mandate：v3 · L2 委派',
    contextNote: '预算校验通过（单据 BJ-0971）；命中 hitl.yaml 红线 pay.prepay > 20000；R3 冷静期 10 分钟已过半。',
    waitedMinutes: 80,
    remainingMinutes: 160,
    stage: 'normal',
    escalateNote: '超时升级：4 小时未答复将通知主管王琳（飞书 + 邮件）；升级不撤销工单，你的答复仍有效。',
    conversationNote: '回原对话',
    cardInput: {
      action: {
        kind: 'api',
        name: 'vendor.pay_order',
        params: { supplier: 'QY-2201', amountYuan: 48000, document: 'BJ-0971' },
      },
      why: { source: 'sop', name: '付款审批', entry: '预付款' },
      impact: {
        externalSystems: [{ system: '支付网关', object: '供应商 QY-2201 · 预付款 ¥48,000（单据 BJ-0971）' }],
      },
      rollback: { reversible: false, note: '付款指令发出后不可自动撤销，冷静期 10 分钟内可人工拦截' },
      matchedRule: { ruleId: 'pay.prepay', grade: 'R3', reason: '资金红线：单笔预付款 > ¥20,000（hitl.yaml pay.prepay）' },
      subjectName: '向供应商 QY-2201 支付预付款 ¥48,000',
      r3: { escalateTo: ['王琳'], coolingPeriodSec: 600, doubleConfirm: true },
    },
  })
}

/** mock 当前登录主体(视角 chip「普通用户(仅自己的)」的 realm 钳制对象)。 */
export const MOCK_PRINCIPAL = '陈默'

/** 初始全量快照(= 原型三静态稿逐字;seq 空间由流层分配,快照本身 seq=1)。 */
export function initialMockSnapshot(): WorkbenchSnapshot {
  return {
    tickets: [
      {
        id: 'T-9c81',
        title: '报价对比：口径确认',
        column: 'person',
        metaLine: [
          { text: 'T-9c81', mono: true },
          { text: 'person/answer' },
          { text: '等陈默回答' },
          { text: '4 小时', num: true },
        ],
        attention: { id: 12, note: '卡点驻留' },
        owner: '陈默',
        sinceTime: '14:18',
        waitMinutes: 240,
        recentNote: { time: '14:18', text: 'Attention #12 已发出' },
        a11yRow: { node: 'Assignment 委派', waiting: '陈默（发起人）', dwell: '4 小时' },
        sidebarLine: [
          { text: 'T-9c81', mono: true },
          { text: 'person/answer' },
          { text: '等你回答（Attention #12）' },
          { text: '已等 4 小时', num: true },
        ],
      },
      {
        id: 'T-a21f',
        title: '付款申请：预付款审批',
        column: 'person',
        metaLine: [
          { text: 'T-a21f', mono: true },
          { text: 'person/approve' },
          { text: '等王琳批准 · R3' },
          { text: '1 小时 20 分', num: true },
        ],
        owner: '王琳',
        sinceTime: '14:02',
        waitMinutes: 80,
        recentNote: { time: '14:02', text: '卡片已投递飞书' },
        a11yRow: { node: 'Assignment 委派', waiting: '王琳（审批人 · R3）', dwell: '1 小时 20 分' },
        sidebarLine: [
          { text: 'T-a21f', mono: true },
          { text: 'person/approve' },
          { text: '等你批准 · 资金红线 R3' },
          { text: '剩 2 小时', num: true },
        ],
      },
      {
        id: 'T-88b1',
        title: '客户答谢会物料',
        column: 'person',
        metaLine: [
          { text: 'T-88b1', mono: true },
          { text: 'person/accept' },
          { text: '等陈默验收' },
          { text: '6 分钟', num: true },
        ],
        owner: '陈默',
        sinceTime: '14:31',
        waitMinutes: 6,
        recentNote: { time: '14:31', text: '结果已发回原对话' },
        a11yRow: { node: 'Outbox 出箱', waiting: '陈默（发起人 · 验收）', dwell: '6 分钟' },
        sidebarLine: [
          { text: 'T-88b1', mono: true },
          { text: 'person/accept' },
          { text: '等你验收 · 结果已回到对话' },
          { text: '6 分钟前', num: true },
        ],
      },
      {
        id: 'T-3f2a',
        title: '合同审查',
        column: 'working',
        metaLine: [
          { text: 'T-3f2a', mono: true },
          { text: 'worker legal-02' },
          { text: '22 分钟', num: true },
        ],
        owner: '李娜',
        recentNote: { time: '14:20', text: '工具 fs.read ×4' },
        a11yRow: { node: 'Worker 执行', waiting: 'worker legal-02', dwell: '22 分钟' },
        sidebarLine: [
          { text: 'T-3f2a', mono: true },
          { text: 'working' },
          { text: '等 worker · legal-02' },
          { text: '22 分钟', num: true },
        ],
      },
      {
        id: 'T-77c0',
        title: '供应商背调',
        column: 'working',
        metaLine: [
          { text: 'T-77c0', mono: true },
          { text: 'worker sourcing-01' },
          { text: '12 分钟', num: true },
        ],
        owner: '李娜',
        a11yRow: { node: 'Worker 执行', waiting: 'worker sourcing-01', dwell: '12 分钟' },
        sidebarLine: [
          { text: 'T-77c0', mono: true },
          { text: 'working' },
          { text: '等 worker · sourcing-01' },
          { text: '12 分钟', num: true },
        ],
      },
      {
        id: 'T-1d07',
        title: '活动排期',
        column: 'queued',
        metaLine: [
          { text: 'T-1d07', mono: true },
          { text: '2/4 槽' },
          { text: '预计 15 分钟后启动' },
        ],
        owner: '陈默',
        recentNote: { time: '14:12', text: '建票完成' },
        a11yRow: { node: 'Ticket 工单', waiting: '排队（2/4 槽）', dwell: '9 分钟' },
        sidebarLine: [
          { text: 'T-1d07', mono: true },
          { text: 'working/queued' },
          { text: '2/4 槽' },
          { text: '预计 15 分钟后启动' },
        ],
      },
      {
        id: 'T-55e9',
        title: '周报整理',
        column: 'idle',
        metaLine: [
          { text: 'T-55e9', mono: true },
          { text: '观察模式 · 无待办' },
        ],
        owner: '王琳',
        recentNote: { time: '昨日 18:00', text: '上次跑批' },
        a11yRow: { node: '—', waiting: '观察模式 · 无待办', dwell: '—' },
        sidebarLine: [
          { text: 'T-55e9', mono: true },
          { text: 'idle' },
          { text: '观察模式 · 无待办' },
        ],
      },
    ],
    conflict: {
      attach: { count: 6, note: '同线程候选挂接 · 环比 -2' },
      duplicate: { percent: 3.2, thresholdPercent: 5, note: '幂等 trigger id 查重 · 阈值 < 5%' },
      jump: { count: 1, note: '人插队 +1 槽（WorkerSlots），唤醒优先于新 launch' },
    },
    logs: [
      {
        id: 't9c81-trigger',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:02:11',
        source: 'Trigger',
        summary: [
          { text: '飞书群 @agent · 幂等 id ' },
          { text: 'tri_9f21', mono: true },
        ],
        status: { label: 'accept', tone: 'accent' },
        duration: '84ms',
        full: [
          [{ text: '触发原文逐字保留（28 §5 D3）：「帮我把这三家供应商的报价做成对比，出一版给采购总监的材料。」' }],
          [{ text: '准入矩阵：名单内（采购三部）+ 明确 @ → explicit。附件 3 份（quote_a/b/c.pdf）。' }],
        ],
      },
      {
        id: 't9c81-eval',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:02:13',
        source: 'Eval',
        summary: [{ text: '候选 2 · attach 0 · duplicate 0' }],
        status: { label: 'done', tone: 'accent' },
        duration: '41ms',
        full: [[{ text: '线程上全部工单可见（含已结束）；无重复 accept（27 号机制③ 幂等 + 查重）。' }]],
      },
      {
        id: 't9c81-decision',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:02:13',
        source: 'Decision',
        summary: [
          { text: 'accept → 建票 ' },
          { text: 'T-9c81', mono: true },
        ],
        status: { label: 'accept', tone: 'accent' },
        duration: '12ms',
        full: [
          [{ text: '理由：名单内 + 明确 @；范围 = 三家供应商报价对比；Mandate v3 · L2 委派；stop 候选 0。' }],
          [
            { text: '策略版本 ' },
            { text: 'hitl.yaml@v7', mono: true },
            { text: ' 随单固化，后续不可变（24 §7.5 合规优势）。' },
          ],
        ],
      },
      {
        id: 't9c81-assignment',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:02:14',
        source: 'Assignment',
        summary: [
          { text: 'worker ' },
          { text: 'event-planning-01', mono: true },
          { text: ' · 槽位 2/4' },
        ],
        status: { label: 'done', tone: 'accent' },
        duration: '8ms',
        full: [
          [
            { text: '一工单一目录：' },
            { text: '.ticket/T-9c81/', mono: true },
            { text: '（空间分区，27 号防线①）。' },
          ],
        ],
      },
      {
        id: 't9c81-fs-read',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:09:47',
        source: '工具 fs.read',
        summary: [{ text: '参数：3 个文件（quote_a.pdf …）' }],
        status: { label: '成功', tone: 'success' },
        duration: '1.2s',
        full: [
          [
            { text: '参数全文：' },
            { text: 'fs.read paths=[quote_a.pdf, quote_b.pdf, quote_c.pdf] chunk=64k', mono: true },
          ],
          [
            // 联系人/邮箱为原始明文(audit 原文);渲染层经 PiiFilter.redact → [PII:cn-mobile]/[PII:email]
            { text: '结果摘要：共 12 页报价表；联系人 13812345678 / 邮箱 jing.chen@corp.com（展示层 PII 正则脱敏）。' },
          ],
        ],
      },
      {
        id: 't9c81-web-fetch',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:10:02',
        source: '工具 web.fetch',
        summary: [
          { text: '域名 ' },
          { text: 'supplier-b.com', mono: true },
          { text: ' 不在 egress 白名单' },
        ],
        status: { label: '拒绝', tone: 'danger' },
        duration: '96ms',
        full: [[{ text: 'governance deny-wins：目标域未在白名单；worker 改走人工附件路径，未重试。' }]],
      },
      {
        id: 't9c81-report',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:18:30',
        source: 'Report',
        summary: [{ text: 'blocked → Attention #12 · 报价口径不一致' }],
        status: { label: 'blocked', tone: 'warn' },
        duration: '200ms',
        full: [[{ text: '半成品标为半成品：材料完成 80%，口径问题阻塞交付（诚实报告纪律，24 §8）。' }]],
      },
      {
        id: 't9c81-outbox',
        ticketId: 'T-9c81',
        group: 'audit',
        time: '14:31:05',
        source: 'Outbox',
        summary: [{ text: '结果发回原对话（2 文件 + 摘要卡）' }],
        status: { label: '成功', tone: 'success' },
        duration: '340ms',
        full: [[{ text: '发回渠道 = 发起渠道（飞书群「采购三部」）；验收入口随卡附带。' }]],
      },
      {
        id: 't9c81-session-6',
        ticketId: 'T-9c81',
        group: 'worker-session',
        time: '14:09:50',
        source: 'session',
        summary: [{ text: '轮次 6 · 解析报价表 · 上下文 41%' }],
        status: { label: 'info', tone: 'muted' },
        duration: '—',
        full: [[{ text: 'fs.read 完成 3 份；发现 A 含税 / B 不含税口径差异，转入比对分支。' }]],
      },
      {
        id: 't9c81-session-fetch',
        ticketId: 'T-9c81',
        group: 'worker-session',
        time: '14:10:03',
        source: 'session',
        summary: [{ text: 'web.fetch 被拒 · 转人工附件路径' }],
        status: { label: 'warn', tone: 'warn' },
        duration: '—',
        full: [[{ text: 'egress 白名单拒once；不改判、不重试（fail-closed）。' }]],
      },
    ],
    eval: {
      trend: [90.2, 91.0, 89.8, 91.5, 92.0, 91.2, 92.4],
      passDelta: 0.6,
      suiteSize: 30,
      decaySeries: [0.2, 0.5, 0.4, 0.8, 0.7, 0.9, 0.8, 1.1],
      decayLatestPp: 0.8,
      decayThresholdPp: 2,
      drift: { label: '无警报', days: 14 },
      weeklyRuns: 14,
    },
    // 信息流图活况(原型 03 视图二 + 原型 04 视图 B 逐字;assignment/ticket/
    // worker 三节点由 tickets 派生,不入此节)。事件行 time/num/mono 段标记
    // 按原型 04 event-list 标注。
    flow: {
      nodes: [
        {
          key: 'trigger',
          state: 'idle',
          sub: '今日 23 次',
          events: [
            [
              { text: '14:02 · ', num: true },
              { text: 'tri_9f21', mono: true },
              { text: ' accept（' },
              { text: 'T-9c81', mono: true },
              { text: '）' },
            ],
          ],
        },
        {
          key: 'thread',
          state: 'active',
          sub: '2 运行',
          events: [
            [
              { text: '14:20 · ', num: true },
              { text: 'T-3f2a', mono: true },
              { text: ' 轮次 12' },
            ],
            [
              { text: '14:18 · ', num: true },
              { text: 'T-9c81', mono: true },
              { text: ' 阻塞等待答复' },
            ],
          ],
        },
        {
          key: 'eval',
          state: 'active',
          sub: '合批 200ms',
          events: [[{ text: '14:20 · 候选 2 · attach 0 · duplicate 0' }]],
        },
        {
          key: 'decision',
          state: 'idle',
          sub: 'accept 21 · stop 2',
          events: [
            [
              { text: '14:02 · accept ' },
              { text: 'T-9c81', mono: true },
              { text: '（名单内 + 明确 @）' },
            ],
          ],
        },
        {
          // worker 节点 sub/stat 由 working 工单计数派生(「2/4 槽」);在办清单为
          // 数据面(原型 04 逐字:在办 worker ≠ working 工单集合——event-planning-01
          // 在办但其工单卡点等人,原型即此口径)。
          key: 'worker',
          state: 'active',
          sub: '2/4 槽',
          events: [
            [
              { text: 'event-planning-01', mono: true },
              { text: ' · T-9c81 · 运行 ' },
              { text: '22 分钟', num: true },
            ],
            [
              { text: 'legal-02', mono: true },
              { text: ' · T-3f2a · 运行 ' },
              { text: '22 分钟', num: true },
            ],
          ],
        },
        {
          key: 'report',
          state: 'active',
          sub: '1 待发',
          events: [
            [
              { text: '14:18 · ', num: true },
              { text: 'T-9c81', mono: true },
              { text: ' blocked → Attention #12' },
            ],
          ],
        },
        {
          key: 'outbox',
          state: 'idle',
          sub: '今日已发 5',
          events: [
            [
              { text: '14:31 · ', num: true },
              { text: 'T-88b1', mono: true },
              { text: ' 结果发回原对话' },
            ],
          ],
        },
      ],
      liveEdges: [
        { from: 'thread', to: 'eval' },
        { from: 'ticket', to: 'assignment' },
      ],
      workerSlots: 4,
      slotsUsed: 2,
      replayOptions: ['T-9c81', 'T-a21f'],
    },
    worker: mockWorkerSnapshot(),
    sessions: mockSessions(),
    assignments: mockAssignments(),
    timelines: mockTimelines(),
    attention: mockAttention(),
  }
}

/**
 * mock 增量时间线(纯数据;快照由流层在连接时生成,不在此列)。
 * seq 从 2 起(1 为首连接快照)。突发组(burst)内事件在 200ms 合批窗口内
 * 同窗到达,由 batcher 合为一帧(38 号 T5 频控)。
 */
export interface MockIncrement {
  /** 相对连接时刻的延迟(ms)。 */
  readonly delayMs: number
  readonly event: WorkbenchIncrement
}

/** dev 默认时间线:+2s 突发两事件(eval-run + log-appended),+4s worker 检查器
 * 上下文/成本推进(W-4),+6s 工单流转(Assignment 卡点 3→2 派生刷新)。 */
export function mockTimeline(): readonly MockIncrement[] {
  return [
    {
      delayMs: 2000,
      event: { kind: 'eval-run', passRate: 92.8 },
    },
    {
      delayMs: 2100,
      event: {
        kind: 'log-appended',
        entry: {
          id: 't9c81-session-7',
          ticketId: 'T-9c81',
          group: 'worker-session',
          time: '14:36:12',
          source: 'session',
          summary: [{ text: '轮次 7 · 汇总口径差异 · 上下文 46%' }],
          status: { label: 'info', tone: 'muted' },
          duration: '—',
          full: [[{ text: '口径差异按含税口径统一；汇总表初稿生成，待 Attention #12 答复后定稿。' }]],
        },
      },
    },
    {
      delayMs: 4000,
      event: {
        kind: 'worker-updated',
        worker: {
          ...mockWorkerSnapshot(),
          runMinutes: 23,
          context: {
            percent: 71,
            thresholdPercent: 80,
            note: '阈值 80% 触发分层压缩（28 号） · 系统 12% / 会话 44% / 工单档案 15%',
          },
          cost: {
            spentYuan: 3.55,
            budgetYuan: 8,
            tokensNote: '191k（输入 166k / 输出 25k）',
            maxTurns: '33/60',
            note: '预算守卫 R1',
          },
        },
      },
    },
    {
      delayMs: 6000,
      event: {
        kind: 'ticket-moved',
        ticketId: 'T-88b1',
        column: 'working',
        metaLine: [
          { text: 'T-88b1', mono: true },
          { text: 'worker event-planning-02' },
          { text: '8 分钟', num: true },
        ],
      },
    },
  ]
}
