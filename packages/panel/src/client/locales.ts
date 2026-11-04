/**
 * 面板字典(zh/en):所有产品可见文案经 ctx.locale 标准席位(dsh 客户端本地化规约)。
 */

export const NS = 'basisPanel'

export type BasisPanelLocaleKey =
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
  | 'guide'
  | 'guide.hint'
  | 'guide.copy'
  | 'guide.copied'
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

export const zh: Record<BasisPanelLocaleKey, string> = {
  panel: '基座面板',
  subtitle: '领域 Agent 基座能力总览',
  services: '服务清单',
  'services.governance': '治理 governance',
  'services.memory': '记忆 memory',
  'services.knowledge': '知识 knowledge',
  'services.tools': '@event 工具清单',
  'services.rules': '规则数',
  'services.audit': '最近审计',
  'services.entities': '实体数',
  'services.recentKeys': '最近 5 条 key',
  'services.wikiDocs': 'wiki-local 文档',
  'services.proposals': '待审提案',
  'services.weknora': 'WeKnora',
  guide: '操作指引',
  'guide.hint': '点击复制示例 prompt,粘贴到输入框即可触发对应能力',
  'guide.copy': '复制',
  'guide.copied': '已复制',
  observability: '可观测样例',
  'observability.session': '会话',
  'observability.turns': '轮次',
  'observability.input': '输入',
  'observability.output': '输出',
  'observability.cacheRead': '缓存读',
  'observability.cacheHit': '缓存命中率',
  refresh: '刷新',
  'state.loading': '读取快照中…',
  'state.error': '快照读取失败',
  'state.empty': '无数据',
  'units.rules': '条规则',
  'units.entries': '条',
  'units.entities': '个',
}

export const en: Record<BasisPanelLocaleKey, string> = {
  panel: 'Basis Panel',
  subtitle: 'Domain agent basis capabilities',
  services: 'Services',
  'services.governance': 'Governance',
  'services.memory': 'Memory',
  'services.knowledge': 'Knowledge',
  'services.tools': '@event tools',
  'services.rules': 'Rules',
  'services.audit': 'Recent audit',
  'services.entities': 'Entities',
  'services.recentKeys': 'Recent 5 keys',
  'services.wikiDocs': 'wiki-local docs',
  'services.proposals': 'Pending proposals',
  'services.weknora': 'WeKnora',
  guide: 'Guide',
  'guide.hint': 'Click to copy an example prompt, then paste it into the composer',
  'guide.copy': 'Copy',
  'guide.copied': 'Copied',
  observability: 'Observability',
  'observability.session': 'Session',
  'observability.turns': 'Turns',
  'observability.input': 'Input',
  'observability.output': 'Output',
  'observability.cacheRead': 'Cache read',
  'observability.cacheHit': 'Cache hit rate',
  refresh: 'Refresh',
  'state.loading': 'Loading snapshot…',
  'state.error': 'Snapshot failed',
  'state.empty': 'No data',
  'units.rules': 'rules',
  'units.entries': 'entries',
  'units.entities': '',
}
