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
  | 'memory'
  | 'memory.hint'
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
  subtitle: '这里能看到基座的全部能力:左边看状态,下面照着示例发一句话就能用',
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
  memory: '工作区记忆',
  'memory.hint': 'Agent 在会话中自主维护(相关历史自动检索、偏好与结论自动沉淀;只在你明确说「记住…」时显式写入)',
  guide: '怎么用(点「复制」→ 粘到对话框 → 发送)',
  'guide.hint': '不需要懂任何技术:复制一句示例,粘贴到对话框发送,Agent 会调用对应能力并展示结果',
  'guide.copy': '复制',
  'guide.copied': '已复制 ✓',
  'steps.title': '三步上手',
  'steps.one': '① 在「怎么用」里点「复制」',
  'steps.two': '② 粘贴到左下角对话框,回车发送',
  'steps.three': '③ 在对话里看 Agent 调用工具与结果(要审批的会先问你)',
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
  subtitle: 'Everything the agent can do — check status above, copy an example below to try it',
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
  memory: 'Workspace memory',
  'memory.hint': 'Maintained autonomously by the agent during sessions',
  'services.weknora.off': 'Not enabled (configurable)',
  guide: 'How to use (Copy → paste into the chat box → send)',
  'guide.hint': 'No expertise needed: copy an example, paste it into the chat box, and the agent calls the right capability',
  'guide.copy': 'Copy',
  'guide.copied': 'Copied ✓',
  'steps.title': 'Three steps to start',
  'steps.one': '① Click “Copy” on any example below',
  'steps.two': '② Paste into the chat box and send',
  'steps.three': '③ Watch the agent call tools in the chat (risky ones ask you first)',
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
