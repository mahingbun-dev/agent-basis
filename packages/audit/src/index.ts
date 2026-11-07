/**
 * @basis/audit —— 审计留痕(P0 骨架:A 事件流接线 / C 分页查询 / report 直投;
 * B 面令牌核验为 P1,见包 README 与 docs/design/enterprise-plugins.md §4 路线表)。
 */
export { AUDIT_ID, AUDIT_SERVICE_ID } from './service.ts'
export type { AuditPluginConfig, AuditQuery, AuditQueryPage, AuditWorld } from './service.ts'
export { DailyFileAuditSink } from './daily-sink.ts'
export { queryAuditRecords } from './query.ts'
export { AUDIT_PLUGIN_NAME, defaultAuditDir, defineAuditPlugin } from './plugin.ts'
export type { AuditActor, AuditRecord, AuditSink } from '@basis/governance'
