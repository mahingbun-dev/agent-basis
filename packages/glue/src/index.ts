/**
 * @eterna/glue — 组合层:把 @eterna 服务装配为真实 DSH 插件。
 *
 * 装配面(全部经官方 seam,零内核改动):
 * - memory:defineMemoryTools → ctx.tools.register;记忆索引 → ctx.systemPrompt.section
 * - governance:规则文件 → ctx.governance 服务 provide + tools/pre-execute veto 接线(T8)
 * - audit:@eterna/audit 插件出口(session/event → 按日落盘 + ctx.audit 查询服务,T8)
 * - egress:@eterna/extra EgressToolWrapper 三层出网判定 → tools/pre-execute veto 接线(T8)
 * - channels:绑定存储/令牌/Source 注册表 → ctx.channels 服务 provide + webhook 网关
 *   挂宿主 webServer(POST /channels/api/webhook/:channelType,39 号 §3-E8)
 * - interact:hitl.yaml 分档/提问合并/负信号总线 → ctx.interact 服务 provide(39 号 §3-E8)
 * - tasks-access-bridge:orchestrator 主会话归属登记入 access 账本(A2;realm→账号
 *   映射 + recordSession upsert,幂等)
 *
 * Cordis 纪律:插件导出 name + inject + apply(ctx);注册返回 disposer 即 effect 逆。
 */
export { defineMemoryPlugin } from './plugins/memory-plugin.ts'
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
export {
  CHANNELS_PLUGIN_SERVICE_ID,
  CHANNELS_WEBHOOK_PATH_PREFIX,
  ETERNA_CHANNELS_PLUGIN_NAME,
  defineChannelsPlugin,
} from './plugins/channels-plugin.ts'
export type { ChannelsCardsFace, ChannelsWorld } from './plugins/channels-plugin.ts'
export {
  DEFAULT_HITL_YAML,
  ETERNA_INTERACT_PLUGIN_NAME,
  INTERACT_PLUGIN_SERVICE_ID,
  defineInteractPlugin,
} from './plugins/interact-plugin.ts'
export { reportToAudit } from './audit-bridge.ts'
export type { AuditReportSink } from './audit-bridge.ts'
export {
  ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME,
  defineTasksAccessBridgePlugin,
} from './plugins/tasks-access-bridge-plugin.ts'
export type { AccessStoreBridgeFace, TasksBridgeFace } from './plugins/tasks-access-bridge-plugin.ts'
export { ETERNA_GLUE_PLUGIN_NAME } from './types.ts'
export type {
  ChannelsPluginConfig, EgressPluginConfig, GovernancePluginConfig, InteractPluginConfig,
} from './types.ts'
