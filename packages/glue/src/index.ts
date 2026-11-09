/**
 * @eterna/glue — 组合层:把 @eterna 服务装配为真实 DSH 插件。
 *
 * 装配面(全部经官方 seam,零内核改动):
 * - memory:defineMemoryTools → ctx.tools.register;记忆索引 → ctx.systemPrompt.section
 * - knowledge:toDshTools → ctx.tools.register
 * - governance:规则文件 → ctx.governance 服务 provide + tools/pre-execute veto 接线(T8)
 * - audit:@eterna/audit 插件出口(session/event → 按日落盘 + ctx.audit 查询服务,T8)
 * - egress:@eterna/extra EgressToolWrapper 三层出网判定 → tools/pre-execute veto 接线(T8)
 *
 * Cordis 纪律:插件导出 name + inject + apply(ctx);注册返回 disposer 即 effect 逆。
 */
export { defineMemoryPlugin } from './plugins/memory-plugin.ts'
export { defineKnowledgePlugin } from './plugins/knowledge-plugin.ts'
export { defineGovernancePlugin, GOVERNANCE_SERVICE_ID, emptyRules } from './plugins/governance-plugin.ts'
export type { GovernanceWorld } from './plugins/governance-plugin.ts'
export {
  AUDIT_ID,
  AUDIT_PLUGIN_NAME,
  AUDIT_SERVICE_ID,
  defaultAuditDir,
  defineAuditPlugin,
} from './plugins/audit-plugin.ts'
export type { AuditPluginConfig } from './plugins/audit-plugin.ts'
export { ETERNA_EGRESS_PLUGIN_NAME, DEFAULT_ALLOWED_OUTBOUND_TOOLS, defineEgressPlugin } from './plugins/egress-plugin.ts'
export { reportToAudit } from './audit-bridge.ts'
export type { AuditReportSink } from './audit-bridge.ts'
export { ETERNA_GLUE_PLUGIN_NAME } from './types.ts'
export type { EgressPluginConfig, GovernancePluginConfig } from './types.ts'
