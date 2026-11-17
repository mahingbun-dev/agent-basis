/**
 * 面板字典(zh/en):所有产品可见文案经 ctx.locale 标准席位(dsh 客户端本地化规约)。
 * 工具名/说明随系统语言切换(用户反馈:工具清单不得裸露英文)。
 */

export const NS = 'eternaPanel'

export type EternaPanelLocaleKey =
  | 'panel'
  | 'subtitle'
  | 'services'
  | 'services.governance'
  | 'services.memory'
  | 'services.knowledge'
  | 'services.tools'
  | 'services.rules'
  | 'services.audit'
  | 'services.entities'
  | 'services.recentKeys'
  | 'services.wikiDocs'
  | 'services.proposals'
  | 'services.weknora'
  | 'services.weknora.off'
  | 'services.weknora.ok'
  | 'services.weknora.error'
  | 'memory'
  | 'memory.hint'
  | 'memory.pendingTitle'
  | 'memory.pendingCountLabel'
  | 'memory.countLabel'
  | 'memory.pendingHint'
  | 'memory.pendingCompaction'
  | 'memory.pendingExpand'
  | 'memory.pendingCollapse'
  | 'memory.approve'
  | 'memory.reject'
  | 'memory.rejectConfirm'
  | 'memory.deciding'
  | 'memory.portraitTitle'
  | 'memory.portraitHint'
  | 'memory.portraitEmpty'
  | 'memory.portraitSectionEmpty'
  | 'memory.portraitCorrect'
  | 'memory.portraitCorrectReady'
  | 'memory.domainTitle'
  | 'memory.domainUnit'
  | 'memory.domainEmpty'
  | 'memory.domainCandidate'
  | 'memory.domainMemories'
  | 'memory.domainSessions'
  | 'memory.domainLastUsed'
  | 'memory.domainPending'
  | 'memory.metricsTitle'
  | 'memory.metricsHint'
  | 'memory.metricsAcceptance'
  | 'memory.metricsLatency'
  | 'memory.metricsCorrections'
  | 'memory.metricsDomains'
  | 'memory.metricsIndexZonePortrait'
  | 'memory.metricsIndexZoneDomain'
  | 'memory.metricsIndexZoneFallback'
  | 'memory.metricsNoData'
  | 'guide'
  | 'guide.hint'
  | 'guide.copy'
  | 'guide.copied'
  | 'steps.title'
  | 'steps.one'
  | 'steps.two'
  | 'steps.three'
  | 'observability'
  | 'observability.session'
  | 'observability.turns'
  | 'observability.input'
  | 'observability.output'
  | 'observability.cacheRead'
  | 'observability.cacheHit'
  | 'refresh'
  | 'state.loading'
  | 'state.error'
  | 'state.empty'
  | 'units.rules'
  | 'units.entries'
  | 'units.entities'
  | `tools.${string}`

/** 单个工具的本地化条目。 */
export interface ToolLocale {
  /** 中文名(随语言)。 */
  readonly label: string
  /** 一句话人话说明(随语言)。 */
  readonly desc: string
}

/** 工具字典(PanelPage 按 data-eterna-panel-tool 名取用;en/zh 双语)。 */
export const TOOL_LOCALES: Record<string, ToolLocale> = {
  budget_calc: { label: '预算计算', desc: '按明细行算预算与小计,自动判断是否超支' },
  schedule_conflict_check: { label: '排期冲突检查', desc: '检查多个环节的时间安排是否撞车' },
  template_search: { label: '策划模板检索', desc: '从模板库找同类型活动的现成框架' },
  venue_search: { label: '场地库查询', desc: '按人数、预算、区域筛选可用场地' },
  budget_change: { label: '预算变更(需审批)', desc: '调整已定预算——必须经人审批,静默改动会被拦截' },
  pay_deposit: { label: '付款申请(需审批)', desc: '生成付款/定金申请——必须经人审批后才执行' },
  send_email: { label: '发送邮件(需审批)', desc: '对外发信前必须经人审批' },
  transfer_money: { label: '资金划转(需审批)', desc: '任何资金操作前必须经人审批' },
  sign_contract: { label: '合同签署(需审批)', desc: '签署动作必须由人完成,助手只做准备材料' },
  vendor_award: { label: '供应商定标(需审批)', desc: '定标决定必须经人审批,保持中立' },
}

function toolKey(name: string): EternaPanelLocaleKey {
  return `tools.${name}`
}

export const zh: Record<EternaPanelLocaleKey, string> = {
  panel: '基座面板',
  subtitle: '这里汇总基座的全部能力:上方管理工作区记忆(待审、画像、功能域),下方看服务状态、照着示例发一句话就能用',
  services: '能力状态',
  'services.governance': '治理与安全',
  'services.memory': '长期记忆',
  'services.knowledge': '知识库',
  'services.tools': '活动策划工具',
  'services.rules': '拦截规则',
  'services.audit': '审计记录',
  'services.entities': '记住的条目',
  'services.recentKeys': '最近记住',
  'services.wikiDocs': '知识文档',
  'services.proposals': '待你确认的提案',
  'services.weknora': '企业知识库接入',
  'services.weknora.off': '未启用(可在配置中开启)',
  'services.weknora.ok': '已接入',
  'services.weknora.error': '连接异常',
  memory: '工作区记忆',
  'memory.hint': 'Agent 在会话中自主维护(相关历史自动检索、偏好与结论自动沉淀;只在你明确说「记住…」时显式写入)',
  'memory.pendingTitle': '待你审批的记忆',
  'memory.pendingCountLabel': '{count} 条待审',
  'memory.countLabel': '{count} 条',
  'memory.pendingHint': '这些是 Agent 从会话中学到的内容,批准后才会长期生效并影响后续会话;拒绝则作废(可追溯,不会真的删除记录)',
  'memory.pendingCompaction': '来自压缩摘要',
  'memory.pendingExpand': '展开详情',
  'memory.pendingCollapse': '收起详情',
  'memory.approve': '记住',
  'memory.reject': '跳过',
  'memory.rejectConfirm': '确认跳过?',
  'memory.deciding': '处理中…',
  'memory.portraitTitle': '你的画像',
  'memory.portraitHint': '从与你的对话中沉淀(派生视图)。某一条不对?点「纠正」——回到对话后,输入框旁的「画像纠正」标签会把这句话带进输入框,回车发送即生效。',
  'memory.portraitEmpty': '画像尚未生成:Agent 会从你的会话中学习稳定偏好,积累后自动生成。',
  'memory.portraitSectionEmpty': '暂无沉淀',
  'memory.portraitCorrect': '纠正此项',
  'memory.portraitCorrectReady': '纠正草稿已备好({section}):回到对话,点击输入框旁的「画像纠正」标签后回车发送。',
  'memory.domainTitle': '功能域',
  'memory.domainUnit': '个域',
  'memory.domainEmpty': '暂无功能域:会话内容会自动按域归档(新域需 3 个会话命中才注册)。',
  'memory.domainCandidate': '候选中',
  'memory.domainMemories': '记忆 {count} 条',
  'memory.domainSessions': '会话 {count} 次',
  'memory.domainLastUsed': '最近使用 {value}',
  'memory.domainPending': '待审 {count} 条',
  'memory.metricsTitle': '记忆指标',
  'memory.metricsHint': '审批采纳率 / 响应中位 / 画像纠正率 / 域绑定 / 索引分区占用(token)。「暂无」= 尚无数据。',
  'memory.metricsAcceptance': '审批采纳率',
  'memory.metricsLatency': '审批响应(中位)',
  'memory.metricsCorrections': '画像纠正率',
  'memory.metricsDomains': '域绑定(次)',
  'memory.metricsIndexZonePortrait': '索引·画像区',
  'memory.metricsIndexZoneDomain': '索引·域区',
  'memory.metricsIndexZoneFallback': '索引·兜底区',
  'memory.metricsNoData': '暂无',
  guide: '怎么用',
  'guide.hint': '不需要懂任何技术:复制一句示例,粘贴到对话框发送,Agent 会调用对应能力并展示结果',
  'guide.copy': '复制',
  'guide.copied': '已复制',
  'steps.title': '三步上手',
  'steps.one': '在「怎么用」里点「复制」',
  'steps.two': '粘贴到左下角对话框,回车发送',
  'steps.three': '在对话里看 Agent 调用工具与结果(要审批的会先问你)',
  observability: '用量观测(最近会话)',
  'observability.session': '会话',
  'observability.turns': '轮次',
  'observability.input': '输入',
  'observability.output': '输出',
  'observability.cacheRead': '缓存读',
  'observability.cacheHit': '缓存命中率',
  refresh: '刷新',
  'state.loading': '正在加载…',
  'state.error': '加载失败',
  'state.empty': '暂无数据',
  'units.rules': '条',
  'units.entries': '条',
  'units.entities': '条',
}

export const en: Record<EternaPanelLocaleKey, string> = {
  panel: 'EternaAgent Panel',
  subtitle: 'Everything the base can do — manage workspace memory above (approvals, profile, domains), check services and copy an example below to try it',
  services: 'Capability status',
  'services.governance': 'Governance & safety',
  'services.memory': 'Long-term memory',
  'services.knowledge': 'Knowledge base',
  'services.tools': 'Event-planning tools',
  'services.rules': 'Guard rules',
  'services.audit': 'Audit entries',
  'services.entities': 'Remembered items',
  'services.recentKeys': 'Recently remembered',
  'services.wikiDocs': 'Wiki documents',
  'services.proposals': 'Proposals awaiting you',
  'services.weknora': 'Enterprise KB (WeKnora)',
  'services.weknora.ok': 'Connected',
  'services.weknora.error': 'Error',
  memory: 'Workspace memory',
  'memory.hint': 'Maintained autonomously by the agent during sessions',
  'memory.pendingTitle': 'Memory awaiting your approval',
  'memory.pendingCountLabel': '{count} pending',
  'memory.countLabel': '{count} items',
  'memory.pendingHint': 'Learned from your sessions — approve to make them permanent; rejecting discards them (traceable, never hard-deleted)',
  'memory.pendingCompaction': 'From compaction summary',
  'memory.pendingExpand': 'Show details',
  'memory.pendingCollapse': 'Hide details',
  'memory.approve': 'Remember',
  'memory.reject': 'Skip',
  'memory.rejectConfirm': 'Confirm skip?',
  'memory.deciding': 'Working…',
  'memory.portraitTitle': 'Your profile',
  'memory.portraitHint': 'Distilled from your sessions (derived view). Something wrong? Click "Correct" — back in the chat, the "Profile correction" chip beside the input box carries the message; press Enter to apply.',
  'memory.portraitEmpty': 'Profile not yet generated: the agent learns stable preferences from your sessions and generates it over time.',
  'memory.portraitSectionEmpty': 'Nothing yet',
  'memory.portraitCorrect': 'Correct',
  'memory.portraitCorrectReady': 'Correction staged ({section}): back in the chat, click the "Profile correction" chip beside the input box and press Enter.',
  'memory.domainTitle': 'Domains',
  'memory.domainUnit': 'domains',
  'memory.domainEmpty': 'No domains yet: session content is archived by domain automatically (a new domain registers after 3 sessions).',
  'memory.domainCandidate': 'candidate',
  'memory.domainMemories': '{count} memories',
  'memory.domainSessions': '{count} sessions',
  'memory.domainLastUsed': 'last used {value}',
  'memory.domainPending': '{count} pending',
  'memory.metricsTitle': 'Memory metrics',
  'memory.metricsHint': 'Acceptance / review latency (median) / correction rate / domain binds / index zone usage (tokens). "n/a" = no data yet.',
  'memory.metricsAcceptance': 'Acceptance',
  'memory.metricsLatency': 'Review latency (median)',
  'memory.metricsCorrections': 'Correction rate',
  'memory.metricsDomains': 'Domain binds',
  'memory.metricsIndexZonePortrait': 'Index · portrait',
  'memory.metricsIndexZoneDomain': 'Index · domain',
  'memory.metricsIndexZoneFallback': 'Index · fallback',
  'memory.metricsNoData': 'n/a',
  'services.weknora.off': 'Not enabled (configurable)',
  guide: 'How to use',
  'guide.hint': 'No expertise needed: copy an example, paste it into the chat box, and the agent calls the right capability',
  'guide.copy': 'Copy',
  'guide.copied': 'Copied',
  'steps.title': 'Three steps to start',
  'steps.one': 'Click “Copy” on any example below',
  'steps.two': 'Paste into the chat box and send',
  'steps.three': 'Watch the agent call tools in the chat (risky ones ask you first)',
  observability: 'Usage (recent sessions)',
  'observability.session': 'Session',
  'observability.turns': 'Turns',
  'observability.input': 'In',
  'observability.output': 'Out',
  'observability.cacheRead': 'Cache read',
  'observability.cacheHit': 'Cache hit',
  refresh: 'Refresh',
  'state.loading': 'Loading…',
  'state.error': 'Failed to load',
  'state.empty': 'No data',
  'units.rules': '',
  'units.entries': '',
  'units.entities': '',
}

/** 英文工具词条(en 界面用;zh 界面用 TOOL_LOCALES)。 */
export const TOOL_LOCALES_EN: Record<string, ToolLocale> = {
  budget_calc: { label: 'Budget calculator', desc: 'Totals budget lines and flags overruns' },
  schedule_conflict_check: { label: 'Schedule conflict check', desc: 'Detects clashing time slots across segments' },
  template_search: { label: 'Template search', desc: 'Finds ready-made plan frameworks by event type' },
  venue_search: { label: 'Venue lookup', desc: 'Filters venues by headcount, budget and area' },
  budget_change: { label: 'Budget change (approval)', desc: 'Changing an approved budget requires human approval' },
  pay_deposit: { label: 'Payment request (approval)', desc: 'Drafts deposit/payment requests — human-approved only' },
  send_email: { label: 'Send email (approval)', desc: 'Outbound email requires human approval' },
  transfer_money: { label: 'Money transfer (approval)', desc: 'Any money movement requires human approval' },
  sign_contract: { label: 'Contract signing (approval)', desc: 'Signing is human-only; the agent prepares materials' },
  vendor_award: { label: 'Vendor award (approval)', desc: 'Award decisions require human approval; stays neutral' },
}

/** 工具条目取用(按当前语言;缺省回退英文名)。 */
export function toolLocale(lang: 'zh' | 'en', name: string): ToolLocale {
  const table = lang === 'en' ? TOOL_LOCALES_EN : TOOL_LOCALES
  return table[name] ?? { label: name, desc: '' }
}

export { toolKey }
