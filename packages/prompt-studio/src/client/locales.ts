/**
 * 提示词工坊字典(zh/en):可见文案经 ctx.locale 标准席位(dsh 客户端本地化规约,
 * panel 同款)。轨迹/工坊两视图与侧栏标签共用本命名空间。
 */

export const NS = 'promptStudio'

export type StudioLocaleKey =
  | 'studio'
  | 'trace'
  | 'studio.subtitle'
  | 'trace.subtitle'
  | 'refresh'
  | 'back'
  | 'state.loading'
  | 'state.error'
  | 'state.empty'
  | 'studio.composed'
  | 'studio.composed.note'
  | 'studio.persona.meta'
  | 'studio.persona.unavailable'
  | 'studio.editor'
  | 'studio.editor.note'
  | 'studio.editor.dirty'
  | 'studio.editor.pristine'
  | 'studio.editor.summary'
  | 'studio.editor.summaryPlaceholder'
  | 'studio.save'
  | 'studio.saving'
  | 'studio.editor.bytes'
  | 'studio.versions'
  | 'studio.versions.note'
  | 'studio.version.seq'
  | 'studio.version.source'
  | 'studio.version.author'
  | 'studio.version.bytes'
  | 'studio.version.summary'
  | 'studio.version.show'
  | 'studio.version.hide'
  | 'studio.version.load'
  | 'studio.version.rollback'
  | 'studio.version.compare'
  | 'studio.version.export'
  | 'studio.diff'
  | 'studio.diff.note'
  | 'studio.diff.close'
  | 'studio.diff.added'
  | 'studio.diff.removed'
  | 'studio.diff.identical'
  | 'studio.diff.truncated'
  | 'studio.transfer'
  | 'studio.transfer.note'
  | 'studio.export.latest'
  | 'studio.export.done'
  | 'studio.export.failed'
  | 'studio.import.pick'
  | 'studio.import.do'
  | 'studio.import.selected'
  | 'studio.import.invalid'
  | 'studio.rollbackTo'
  | 'studio.approval'
  | 'studio.approval.note'
  | 'studio.approval.detail'
  | 'studio.approval.approve'
  | 'studio.approval.reject'
  | 'studio.approval.working'
  | 'studio.write.status'
  | 'studio.stats.versions'
  | 'studio.stats.sessions'
  | 'studio.stats.channel'
  | 'studio.stats.pending'
  | 'trace.pipeline'
  | 'trace.sessions'
  | 'trace.turns'
  | 'trace.tokens.in'
  | 'trace.tokens.out'
  | 'trace.tokens.cache'
  | 'trace.duration'
  | 'trace.endReason'
  | 'trace.tools'
  | 'trace.approvals'
  | 'trace.events'
  | 'trace.noSelection'
  | 'trace.detail.empty'

export const zh: Record<StudioLocaleKey, string> = {
  studio: '提示词工坊',
  trace: '循环轨迹',
  'studio.subtitle': '查看最终生效的系统提示词组合,编辑 persona 段(保存走 R3 审批,新会话生效)',
  'trace.subtitle': '最近会话的 agent loop 运行轨迹:轮次、工具调用、耗时与 token',
  refresh: '刷新',
  back: '返回会话列表',
  'state.loading': '正在加载…',
  'state.error': '加载失败',
  'state.empty': '暂无数据',
  'studio.composed': '最终生效组合(只读)',
  'studio.composed.note': '本视图展示当前生效的 persona 段全文;plan-mode/skill/agent-instructions 等其余段落本期只读不可编辑。',
  'studio.persona.meta': '落点',
  'studio.persona.unavailable': 'persona 段当前不可读',
  'studio.editor': 'personaPrefix 编辑器',
  'studio.editor.note': '保存将走 R3 高危审批(二次确认);确认后写入 profile patch 层,对新会话生效、无需重启。',
  'studio.editor.dirty': '有未保存修改',
  'studio.editor.pristine': '与当前生效内容一致',
  'studio.editor.summary': '变更摘要(可省)',
  'studio.editor.summaryPlaceholder': '例如:追加红线约束',
  'studio.save': '保存…(R3 审批)',
  'studio.saving': '提交中…',
  'studio.editor.bytes': '字节',
  'studio.versions': '版本列表(只增不删)',
  'studio.versions.note': '回滚=追加新版本指向目标内容,不删除历史;回滚同样走 R3 审批。',
  'studio.version.seq': '版本',
  'studio.version.source': '来源',
  'studio.version.author': '操作者',
  'studio.version.bytes': '字节',
  'studio.version.summary': '摘要',
  'studio.version.show': '查看内容',
  'studio.version.hide': '收起',
  'studio.version.load': '载入编辑器',
  'studio.version.rollback': '回滚到此版本',
  'studio.version.compare': '与上一版对比',
  'studio.version.export': '导出',
  'studio.diff': '版本对比',
  'studio.diff.note': '逐行对比(+ 新增行 / − 移除行);回滚前先看这一版到底改了什么。',
  'studio.diff.close': '关闭对比',
  'studio.diff.added': '新增行',
  'studio.diff.removed': '移除行',
  'studio.diff.identical': '两版本内容完全一致',
  'studio.diff.truncated': '差异行数过多,仅渲染前一部分(内容仍完整参与计算)',
  'studio.transfer': '导出 / 导入(JSON 包)',
  'studio.transfer.note': '导出=只读 JSON 包(schemaVersion/persona/checksum/exportedAt/exportedBy),不走审批;导入=同一套校验(非空/≤64KB/UTF-8/红线段)+ R3 审批,通过后成为新增本。',
  'studio.export.latest': '导出最新版本',
  'studio.export.done': '已导出',
  'studio.export.failed': '导出失败',
  'studio.import.pick': '选择 .json 导出包',
  'studio.import.do': '导入为新增本(R3 审批)',
  'studio.import.selected': '已选择',
  'studio.import.invalid': '所选文件不是合法的导出包(需 JSON 对象:schemaVersion=1、persona、checksum)',
  'studio.rollbackTo': '回滚到',
  'studio.approval': 'R3 高危审批(二次确认)',
  'studio.approval.note': '此操作修改 system prompt persona 段,影响所有新会话的前缀与 KV-cache 命中。',
  'studio.approval.detail': '审批卡详情',
  'studio.approval.approve': '确认执行(允许一次)',
  'studio.approval.reject': '拒绝',
  'studio.approval.working': '审批提交中…',
  'studio.write.status': '写入结果',
  'studio.stats.versions': '版本',
  'studio.stats.sessions': '最近会话',
  'studio.stats.channel': '生效通道',
  'studio.stats.pending': '在途审批',
  'trace.pipeline': '数据管线',
  'trace.sessions': '最近会话',
  'trace.turns': '轮次',
  'trace.tokens.in': '输入',
  'trace.tokens.out': '输出',
  'trace.tokens.cache': '缓存读',
  'trace.duration': '耗时',
  'trace.endReason': '结束原因',
  'trace.tools': '工具调用',
  'trace.approvals': '审批点',
  'trace.events': '事件',
  'trace.noSelection': '点击左侧会话查看轮次树',
  'trace.detail.empty': '该会话暂无轮次数据',
}

export const en: Record<StudioLocaleKey, string> = {
  studio: 'Prompt Studio',
  trace: 'Loop Trace',
  'studio.subtitle': 'Inspect the effective system prompt, edit the persona segment (saves go through R3 approval)',
  'trace.subtitle': 'Recent session traces: turns, tool calls, durations and tokens',
  refresh: 'Refresh',
  back: 'Back to sessions',
  'state.loading': 'Loading…',
  'state.error': 'Failed to load',
  'state.empty': 'No data',
  'studio.composed': 'Effective composition (read-only)',
  'studio.composed.note': 'Shows the effective persona segment; other segments (plan-mode/skill/agent-instructions) are read-only this phase.',
  'studio.persona.meta': 'Patch layer',
  'studio.persona.unavailable': 'Persona segment is currently unreadable',
  'studio.editor': 'personaPrefix editor',
  'studio.editor.note': 'Saving goes through R3 approval (double confirm); writes the profile patch layer and takes effect for new sessions, no restart.',
  'studio.editor.dirty': 'Unsaved changes',
  'studio.editor.pristine': 'Same as effective content',
  'studio.editor.summary': 'Summary (optional)',
  'studio.editor.summaryPlaceholder': 'e.g. add a red-line constraint',
  'studio.save': 'Save… (R3 approval)',
  'studio.saving': 'Submitting…',
  'studio.editor.bytes': 'bytes',
  'studio.versions': 'Versions (append-only)',
  'studio.versions.note': 'Rollback appends a new version pointing at the target content; history is never deleted. Rollback also goes through R3 approval.',
  'studio.version.seq': 'Version',
  'studio.version.source': 'Source',
  'studio.version.author': 'Author',
  'studio.version.bytes': 'bytes',
  'studio.version.summary': 'Summary',
  'studio.version.show': 'View content',
  'studio.version.hide': 'Collapse',
  'studio.version.load': 'Load into editor',
  'studio.version.rollback': 'Roll back to this version',
  'studio.version.compare': 'Diff with previous',
  'studio.version.export': 'Export',
  'studio.diff': 'Version diff',
  'studio.diff.note': 'Line-by-line diff (+ added / − removed); see what a version changed before rolling back.',
  'studio.diff.close': 'Close diff',
  'studio.diff.added': 'added',
  'studio.diff.removed': 'removed',
  'studio.diff.identical': 'Identical content',
  'studio.diff.truncated': 'Too many changed lines; only the first part is rendered (all lines still counted)',
  'studio.transfer': 'Export / Import (JSON pack)',
  'studio.transfer.note': 'Export is a read-only JSON pack (schemaVersion/persona/checksum/exportedAt/exportedBy), no approval. Import runs the same validation (non-empty/≤64KB/UTF-8/red lines) plus R3 approval and becomes a new version.',
  'studio.export.latest': 'Export latest',
  'studio.export.done': 'Exported',
  'studio.export.failed': 'Export failed',
  'studio.import.pick': 'Choose a .json pack',
  'studio.import.do': 'Import as new version (R3 approval)',
  'studio.import.selected': 'Selected',
  'studio.import.invalid': 'Not a valid export pack (expected a JSON object with schemaVersion=1, persona, checksum)',
  'studio.rollbackTo': 'Roll back to',
  'studio.approval': 'R3 approval (double confirm)',
  'studio.approval.note': 'This rewrites the system prompt persona segment and affects every new session prefix and KV-cache hits.',
  'studio.approval.detail': 'Approval card detail',
  'studio.approval.approve': 'Confirm (allow once)',
  'studio.approval.reject': 'Reject',
  'studio.approval.working': 'Submitting approval…',
  'studio.write.status': 'Write result',
  'studio.stats.versions': 'Versions',
  'studio.stats.sessions': 'Recent sessions',
  'studio.stats.channel': 'Channel',
  'studio.stats.pending': 'Pending approval',
  'trace.pipeline': 'Pipeline',
  'trace.sessions': 'Recent sessions',
  'trace.turns': 'Turns',
  'trace.tokens.in': 'In',
  'trace.tokens.out': 'Out',
  'trace.tokens.cache': 'Cache read',
  'trace.duration': 'Duration',
  'trace.endReason': 'End reason',
  'trace.tools': 'Tool calls',
  'trace.approvals': 'Approval points',
  'trace.events': 'Events',
  'trace.noSelection': 'Pick a session to inspect its turn tree',
  'trace.detail.empty': 'No turn data for this session',
}
