/**
 * 工作台字典(zh 为主,en 可用;AGENTS.md:UI 面向用户文字一律中文)。
 * 视图长文案(视图描述/指标副行/日志全文等)内聚在各视图组件的中文常量
 * (panel PanelPage.tsx CompactionCard 同款先例:引用 30/27/28 号条款的
 * 叙述文案不做双语字典拆分);此处只收界面骨架键。
 */

export const NS = 'eternaWorkbench'

export type WorkbenchLocaleKey =
  | 'panel'
  | 'nav.session'
  | 'nav.monitor'
  | 'nav.flow'
  | 'nav.logs'
  | 'nav.eval'
  | 'nav.worker'
  | 'state.connecting'
  | 'state.ready'
  | 'state.error'
  | 'state.retry'
  | 'state.emptyLogs'
  | 'toolbar.role'
  | 'toolbar.stage'
  | 'toolbar.ticket'
  | 'toolbar.searchLabel'
  | 'toolbar.searchPlaceholder'
  | 'toolbar.pause'
  | 'toolbar.resume'
  | 'toolbar.replay'
  | 'toolbar.replayEmpty'
  | 'toolbar.replayStart'
  | 'sidebar.sessions'
  | 'sidebar.tickets'
  | 'timeline.emptyTitle'
  | 'timeline.emptySub'
  | 'timeline.ticketPrefix'
  | 'timeline.branchPrefix'
  | 'timeline.branchGroup'
  | 'timeline.emptyBlocks'
  | 'timeline.foot'
  | 'timeline.answerLabel'
  | 'timeline.answerSubmit'
  | 'timeline.accept'
  | 'timeline.return'
  | 'attention.bannerLabel'
  | 'attention.needDecision'
  | 'attention.originator'
  | 'attention.channel'
  | 'attention.waited'
  | 'attention.approve'
  | 'attention.approveR3'
  | 'attention.approveConfirm'
  | 'attention.supplement'
  | 'attention.supplementLabel'
  | 'attention.supplementPlaceholder'
  | 'attention.supplementSubmit'
  | 'attention.reject'
  | 'attention.rejectConfirm'
  | 'attention.reasonLabel'
  | 'attention.reasonPlaceholder'
  | 'toolbar.master'

export const zh: Record<WorkbenchLocaleKey, string> = {
  panel: '工作台',
  'nav.session': '任务侧栏',
  'nav.monitor': '工作监控',
  'nav.flow': '信息流实时图',
  'nav.logs': '日志监控',
  'nav.eval': '评测监控',
  'nav.worker': 'worker 检查器',
  'state.connecting': 'SSE 连接中…',
  'state.ready': '实时连接正常',
  'state.error': 'SSE 连接失败',
  'state.retry': '重试',
  'state.emptyLogs': '该工单暂无日志',
  'toolbar.role': '视角：',
  'toolbar.stage': '阶段：',
  'toolbar.ticket': '工单：',
  'toolbar.searchLabel': '检索日志',
  'toolbar.searchPlaceholder': '检索工具 / 参数 / 状态',
  'toolbar.pause': '暂停',
  'toolbar.resume': '继续',
  'toolbar.replay': '按工单回放',
  'toolbar.replayEmpty': '暂无可回放工单',
  'toolbar.replayStart': '重放事件序列',
  'sidebar.sessions': '会话',
  'sidebar.tickets': '我的工单',
  'timeline.emptyTitle': '选择工单查看报告时间线',
  'timeline.emptySub': '在左侧选中一个任务后，这里会显示它的执行时间线',
  'timeline.ticketPrefix': '工单 ',
  'timeline.branchPrefix': '分支 ',
  'timeline.branchGroup': '多 Assignment 分支切换（退回/重试 = 新 Assignment = 新分支）',
  'timeline.emptyBlocks': '该分支暂无时间线记录',
  'timeline.foot': '小提示：退回或补充说明都会继续当前任务，无需重新发起。',
  'timeline.answerLabel': '你的回答',
  'timeline.answerSubmit': '提交回答',
  'timeline.accept': '验收通过',
  'timeline.return': '退回并说明',
  'attention.bannerLabel': '需要你拍板 · Attention 横幅',
  'attention.needDecision': '需要你拍板',
  'attention.originator': '发起人：',
  'attention.channel': '渠道：',
  'attention.waited': '已等待：',
  'attention.approve': '批准',
  'attention.approveR3': '批准（R3 需二次确认）',
  'attention.approveConfirm': '再次点击确认批准',
  'attention.supplement': '补充说明',
  'attention.supplementLabel': '补充说明',
  'attention.supplementPlaceholder': '结构化追问，答复回到原对话',
  'attention.supplementSubmit': '提交说明',
  'attention.reject': '拒绝（需一句理由）',
  'attention.rejectConfirm': '确认拒绝',
  'attention.reasonLabel': '拒绝理由',
  'attention.reasonPlaceholder': '一句话理由（必填）',
  'toolbar.master': '主会话',
}

export const en: Record<WorkbenchLocaleKey, string> = {
  panel: 'Workbench',
  'nav.session': 'Task sidebar',
  'nav.monitor': 'Monitoring',
  'nav.flow': 'Live flow graph',
  'nav.logs': 'Logs',
  'nav.eval': 'Evals',
  'nav.worker': 'Worker inspector',
  'state.connecting': 'Connecting SSE…',
  'state.ready': 'Live feed connected',
  'state.error': 'SSE connection failed',
  'state.retry': 'Retry',
  'state.emptyLogs': 'No logs for this ticket',
  'toolbar.role': 'Perspective: ',
  'toolbar.stage': 'Stage: ',
  'toolbar.ticket': 'Ticket: ',
  'toolbar.searchLabel': 'Search logs',
  'toolbar.searchPlaceholder': 'Search tool / params / status',
  'toolbar.pause': 'Pause',
  'toolbar.resume': 'Resume',
  'toolbar.replay': 'Replay by ticket',
  'toolbar.replayEmpty': 'No replayable tickets',
  'toolbar.replayStart': 'Replay event sequence',
  'sidebar.sessions': 'Sessions',
  'sidebar.tickets': 'My tickets',
  'timeline.emptyTitle': 'Select a ticket to view its report timeline',
  'timeline.emptySub': 'Pick a ticket under “My tickets”; the timeline renders per Assignment branch',
  'timeline.ticketPrefix': 'Ticket ',
  'timeline.branchPrefix': 'Branch ',
  'timeline.branchGroup': 'Assignment branch switch (return/retry = new Assignment = new branch)',
  'timeline.emptyBlocks': 'No timeline blocks on this branch yet',
  'timeline.foot': 'Tip: returns and follow-ups continue the same task — no need to start over.',
  'timeline.answerLabel': 'Your answer',
  'timeline.answerSubmit': 'Submit answer',
  'timeline.accept': 'Accept',
  'timeline.return': 'Return with note',
  'attention.bannerLabel': 'Needs your decision · Attention banner',
  'attention.needDecision': 'Needs your decision',
  'attention.originator': 'Initiator: ',
  'attention.channel': 'Channel: ',
  'attention.waited': 'Waiting: ',
  'attention.approve': 'Approve',
  'attention.approveR3': 'Approve (R3 needs double confirm)',
  'attention.approveConfirm': 'Click again to confirm approval',
  'attention.supplement': 'Supplement',
  'attention.supplementLabel': 'Supplement note',
  'attention.supplementPlaceholder': 'Structured follow-up; the answer returns to the original conversation',
  'attention.supplementSubmit': 'Submit note',
  'attention.reject': 'Reject (one-line reason)',
  'attention.rejectConfirm': 'Confirm rejection',
  'attention.reasonLabel': 'Rejection reason',
  'attention.reasonPlaceholder': 'One-line reason (required)',
  'toolbar.master': 'Master session',
}
