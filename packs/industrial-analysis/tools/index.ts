/**
 * @industrial-analysis/pack 领域工具注册入口(组合层从这里取插件模块)。
 * 每个工具模块保持「注册表 + 唯一 ID」形态(packctl lint CORD002/003/004/005 强制)。
 * 首场景工具桩(§11.7 自建清单,T3-1):时序查询 / 预警列表 / 预警记录 —— 确定性核心,
 * 样例数据写死在桩内;模型面 defineTool 包装与 ctx.tools.register 在 ../plugin.ts
 * (DSH bundle 插件,apply 配逆闭包 disposer)。
 * 红线:达梦业务库只读(写权限仅限预警记录表);数据与知识层只经 MCP 访问。
 */
export { createTimeseriesTool, TIMESERIES_TOOL_SERVICE_ID } from './timeseries-tool.ts'
export type { IndustrialTimeseriesTool, TsPoint, TsTagMeta, TsQueryOptions, TsQueryResult } from './timeseries-tool.ts'
export { createAlertListTool, ALERT_LIST_TOOL_SERVICE_ID } from './alert-list-tool.ts'
export type { IndustrialAlertListTool, IndustrialAlert, AlertSeverity, AlertStatus, AlertListFilters, AlertListResult } from './alert-list-tool.ts'
export { createAlertRecordsTool, ALERT_RECORDS_TOOL_SERVICE_ID } from './alert-records-tool.ts'
export type { IndustrialAlertRecordsTool, AlertRecord, AlertRecordInput, AlertRecordsResult } from './alert-records-tool.ts'
