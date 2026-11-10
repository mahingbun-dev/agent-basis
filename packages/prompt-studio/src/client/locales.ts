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
  | 'studio.persona.meta'
  | 'studio.panorama'
  | 'studio.layer.preset'
  | 'studio.layer.preset.hint'
  | 'studio.layer.domain'
  | 'studio.layer.domain.hint'
  | 'studio.layer.runtime'
  | 'studio.layer.runtime.hint'
  | 'studio.kind.patch-value'
  | 'studio.kind.line-anchor-readonly'
  | 'studio.kind.runtime-injection'
  | 'studio.entry.detail'
  | 'studio.entry.editable'
  | 'studio.entry.readonly'
  | 'studio.entry.upgradeRisk'
  | 'studio.entry.risks'
  | 'studio.entry.source'
  | 'studio.entry.maxBytes'
  | 'studio.entry.ruleSet'
  | 'studio.entry.redline.required'
  | 'studio.entry.redline.exempt'
  | 'studio.entry.versionsCount'
  | 'studio.entry.storeUnavailable'
  | 'studio.entry.noVersions'
  | 'studio.entry.readonly.title'
  | 'studio.entry.readonly.note'
  | 'studio.entry.readonly.value'
  | 'studio.entry.runtime.title'
  | 'studio.entry.runtime.note'
  | 'studio.entry.runtime.value'
  | 'studio.entry.valueUnreadable.title'
  | 'studio.entry.valueUnreadable.note'
  | 'studio.entry.valueUnreadable.fallback'
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
  | 'studio.versions.countLabel'
  | 'studio.versions.loading'
  | 'studio.versions.loadFailed'
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
  | 'studio.stats.entries'
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
  'studio.subtitle': '三层提示词全景:preset 预设 / 领域包 / 运行时注入。条目可查可改(保存走 R3 审批,对新会话生效、无需重启),版本可回滚。',
  'trace.subtitle': '最近会话的 agent loop 运行轨迹:轮次、工具调用、耗时与 token',
  refresh: '刷新',
  back: '返回会话列表',
  'state.loading': '正在加载…',
  'state.error': '加载失败',
  'state.empty': '暂无数据',
  'studio.persona.meta': '落点',
  'studio.panorama': '提示词全景(注册表)',
  'studio.layer.preset': 'preset 层',
  'studio.layer.preset.hint': '产品预设(profile patch 层)',
  'studio.layer.domain': '领域层',
  'studio.layer.domain.hint': '领域包(personaPrefix / persona.md)',
  'studio.layer.runtime': '运行时层',
  'studio.layer.runtime.hint': 'ctx.systemPrompt.section 动态注入',
  'studio.kind.patch-value': 'patch 值型',
  'studio.kind.line-anchor-readonly': '行锚点只读型',
  'studio.kind.runtime-injection': '运行时注入型',
  'studio.entry.detail': '条目详情',
  'studio.entry.editable': '可编辑',
  'studio.entry.readonly': '只读',
  'studio.entry.upgradeRisk': '升级可能覆盖',
  'studio.entry.risks': '风险标注',
  'studio.entry.source': '来源',
  'studio.entry.maxBytes': '字节上限',
  'studio.entry.ruleSet': '红线规则集',
  'studio.entry.redline.required': '红线必检',
  'studio.entry.redline.exempt': '红线豁免',
  'studio.entry.versionsCount': '版本数',
  'studio.entry.storeUnavailable': '版本库未挂载',
  'studio.entry.noVersions': '无版本链',
  'studio.entry.readonly.title': '只读条目(上游运行时生成)',
  'studio.entry.readonly.note': '该条目由上游插件运行时生成,无 patch 写回落点——保存通道对其 fail-closed 拒写,不存在「保存生效」语义。',
  'studio.entry.readonly.value': '当前值:每次注入时由上游插件生成(无静态文本可展示)。',
  'studio.entry.runtime.title': '运行时注入条目(装配时构建)',
  'studio.entry.runtime.note': '该条目由代码在装配时注入(运行时构建,无静态全文)——本视图只读;保存通道对其 fail-closed 拒写。',
  'studio.entry.runtime.value': '当前值:装配时动态构建,随运行时状态变化(无静态全文)。',
  'studio.entry.valueUnreadable.title': '条目当前值不可读',
  'studio.entry.valueUnreadable.note': '结构定位或反引失败(常见于 profile/pack 升级后的锚点漂移)。编辑器已收起——空内容不是合法基线;保存通道对不可读条目同样 fail-closed 拒写,可回滚到历史版本恢复。明细:',
  'studio.entry.valueUnreadable.fallback': '(服务端未返回读值问题明细)',
  'studio.editor': '条目编辑器',
  'studio.editor.note': '保存将走 R3 高危审批(二次确认);确认后按条目写回 patch 层,对新会话生效、无需重启。',
  'studio.editor.dirty': '有未保存修改',
  'studio.editor.pristine': '与当前生效内容一致',
  'studio.editor.summary': '变更摘要(可省)',
  'studio.editor.summaryPlaceholder': '例如:追加红线约束',
  'studio.save': '保存…(R3 审批)',
  'studio.saving': '提交中…',
  'studio.editor.bytes': '字节',
  'studio.versions': '版本列表(只增不删)',
  'studio.versions.note': '回滚=追加新版本指向目标内容,不删除历史;回滚同样走 R3 审批。',
  'studio.versions.countLabel': '个版本',
  'studio.versions.loading': '正在拉取该条目版本链…',
  'studio.versions.loadFailed': '版本链拉取失败(切换条目或点刷新重试)',
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
  'studio.transfer': '导入(JSON 包)',
  'studio.transfer.note': '导入=同一套按条目校验(非空/≤64KB/UTF-8/红线规则集)+ R3 审批,通过后成为包内 entryId 指名条目的新增本(默认条目缺省该字段);导出请在条目详情的版本区操作。',
  'studio.export.latest': '导出最新版本',
  'studio.export.done': '已导出',
  'studio.export.failed': '导出失败',
  'studio.import.pick': '选择 .json 导出包',
  'studio.import.do': '导入为新增本(R3 审批)',
  'studio.import.selected': '已选择',
  'studio.import.invalid': '所选文件不是合法的导出包(需 JSON 对象:schemaVersion=1、persona、checksum)',
  'studio.rollbackTo': '回滚到',
  'studio.approval': 'R3 高危审批(二次确认)',
  'studio.approval.note': '此操作修改提示词注册表条目,影响相应会话的系统提示(默认 persona 条目影响所有新会话的前缀与 KV-cache 命中)。',
  'studio.approval.detail': '审批卡详情',
  'studio.approval.approve': '确认执行(允许一次)',
  'studio.approval.reject': '拒绝',
  'studio.approval.working': '审批提交中…',
  'studio.write.status': '写入结果',
  'studio.stats.entries': '提示词条目',
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
  'studio.subtitle': 'Full registry panorama across three layers: presets / domain packs / runtime injection. Entries are inspectable and editable (saves go through R3 approval, effective for new sessions without restart); versions roll back.',
  'trace.subtitle': 'Recent session traces: turns, tool calls, durations and tokens',
  refresh: 'Refresh',
  back: 'Back to sessions',
  'state.loading': 'Loading…',
  'state.error': 'Failed to load',
  'state.empty': 'No data',
  'studio.persona.meta': 'Patch layer',
  'studio.panorama': 'Prompt panorama (registry)',
  'studio.layer.preset': 'Preset layer',
  'studio.layer.preset.hint': 'Product presets (profile patch layer)',
  'studio.layer.domain': 'Domain layer',
  'studio.layer.domain.hint': 'Domain packs (personaPrefix / persona.md)',
  'studio.layer.runtime': 'Runtime layer',
  'studio.layer.runtime.hint': 'ctx.systemPrompt.section dynamic injection',
  'studio.kind.patch-value': 'Patch value',
  'studio.kind.line-anchor-readonly': 'Line-anchor (read-only)',
  'studio.kind.runtime-injection': 'Runtime injection',
  'studio.entry.detail': 'Entry detail',
  'studio.entry.editable': 'Editable',
  'studio.entry.readonly': 'Read-only',
  'studio.entry.upgradeRisk': 'Upgrade may overwrite',
  'studio.entry.risks': 'Risk notes',
  'studio.entry.source': 'Source',
  'studio.entry.maxBytes': 'Byte cap',
  'studio.entry.ruleSet': 'Red-line rule set',
  'studio.entry.redline.required': 'Red lines required',
  'studio.entry.redline.exempt': 'Red lines exempt',
  'studio.entry.versionsCount': 'Versions',
  'studio.entry.storeUnavailable': 'version store not mounted',
  'studio.entry.noVersions': 'No version chain',
  'studio.entry.readonly.title': 'Read-only entry (generated upstream at runtime)',
  'studio.entry.readonly.note': 'This entry is generated at runtime by the upstream plugin and has no patch write-back point — the save path fail-closed rejects writes to it; there is no "save to take effect" semantics.',
  'studio.entry.readonly.value': 'Current value: generated by the upstream plugin on each injection (no static text to show).',
  'studio.entry.runtime.title': 'Runtime-injected entry (assembled at runtime)',
  'studio.entry.runtime.note': 'This entry is injected by code at assembly time (built at runtime, no static full text) — read-only here; the save path fail-closed rejects writes to it.',
  'studio.entry.runtime.value': 'Current value: built dynamically at assembly time, varying with runtime state (no static full text).',
  'studio.entry.valueUnreadable.title': 'Entry value unreadable',
  'studio.entry.valueUnreadable.note': 'Structural location or unquoting failed (typically anchor drift after a profile/pack upgrade). The editor is collapsed — an empty value is not a legal baseline; the save path also fail-closed rejects writes to unreadable entries. Roll back to a history version to recover. Details:',
  'studio.entry.valueUnreadable.fallback': '(server returned no read-problem details)',
  'studio.editor': 'Entry editor',
  'studio.editor.note': 'Saving goes through R3 approval (double confirm); writes back to the patch layer per entry and takes effect for new sessions, no restart.',
  'studio.editor.dirty': 'Unsaved changes',
  'studio.editor.pristine': 'Same as effective content',
  'studio.editor.summary': 'Summary (optional)',
  'studio.editor.summaryPlaceholder': 'e.g. add a red-line constraint',
  'studio.save': 'Save… (R3 approval)',
  'studio.saving': 'Submitting…',
  'studio.editor.bytes': 'bytes',
  'studio.versions': 'Versions (append-only)',
  'studio.versions.note': 'Rollback appends a new version pointing at the target content; history is never deleted. Rollback also goes through R3 approval.',
  'studio.versions.countLabel': 'versions',
  'studio.versions.loading': 'Fetching the version chain for this entry…',
  'studio.versions.loadFailed': 'Failed to fetch the version chain (switch entries or refresh to retry)',
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
  'studio.transfer': 'Import (JSON pack)',
  'studio.transfer.note': 'Import runs the same per-entry validation (non-empty/≤64KB/UTF-8/red-line rule set) plus R3 approval and becomes a new version of the entry named by the pack entryId (omitted for the default entry); export lives in the entry detail version area.',
  'studio.export.latest': 'Export latest',
  'studio.export.done': 'Exported',
  'studio.export.failed': 'Export failed',
  'studio.import.pick': 'Choose a .json pack',
  'studio.import.do': 'Import as new version (R3 approval)',
  'studio.import.selected': 'Selected',
  'studio.import.invalid': 'Not a valid export pack (expected a JSON object with schemaVersion=1, persona, checksum)',
  'studio.rollbackTo': 'Roll back to',
  'studio.approval': 'R3 approval (double confirm)',
  'studio.approval.note': 'This modifies a prompt-registry entry and affects the system prompt of corresponding sessions (the default persona entry affects every new session prefix and KV-cache hits).',
  'studio.approval.detail': 'Approval card detail',
  'studio.approval.approve': 'Confirm (allow once)',
  'studio.approval.reject': 'Reject',
  'studio.approval.working': 'Submitting approval…',
  'studio.write.status': 'Write result',
  'studio.stats.entries': 'Entries',
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
