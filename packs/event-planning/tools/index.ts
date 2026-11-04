/**
 * @event/pack 领域工具注册入口(组合层从这里取插件模块)。
 * 每个工具模块保持「注册表 + 唯一 ID」形态(packctl lint CORD002/003/004/005 强制)。
 * 13 号文档 §3 工具候选:预算计算器 / 供应商库查询 / 场地库查询 / 排期冲突检查 /
 * 模板库检索 / 天气查询 —— v1 落前五个的确定性核心 + R3 审批/守卫核心,
 * 模型面 defineTool 包装与 ctx.tools.register 在 ../plugin.ts(DSH bundle 插件)。
 */
export { createBudgetTool, BUDGET_TOOL_SERVICE_ID } from './budget-tool.ts'
export type { EventBudgetTool, BudgetLine } from './budget-tool.ts'
export { createVendorRegistry, VENDOR_TOOL_SERVICE_ID, VENUE_CATALOG, comparableVenueTotal, searchVenueCatalog } from './vendor-registry.ts'
export type { VendorQuote, VendorRegistry, VenueRecord, VenueSearchFilters, VenueHit } from './vendor-registry.ts'
export { createScheduleTool, SCHEDULE_TOOL_SERVICE_ID } from './schedule-tool.ts'
export type { EventScheduleTool, ScheduleSegment, ScheduleWindow, ScheduleCheckResult, ScheduleOverlap } from './schedule-tool.ts'
export { createTemplateTool, TEMPLATE_TOOL_SERVICE_ID, TEMPLATE_LIBRARY } from './template-tool.ts'
export type { EventTemplateTool, PlanTemplate, TemplateMatch } from './template-tool.ts'
export { createApprovalTool, APPROVAL_TOOL_SERVICE_ID } from './approval-tool.ts'
export type { EventApprovalTool, DepositRequestInput, PaymentRequestDraft, BudgetChangeInput, BudgetChangeDraft } from './approval-tool.ts'
export { createGuardTool, GUARD_TOOL_SERVICE_ID } from './guard-tool.ts'
export type { EventGuardTool, GuardedAction, GuardedActionSummary } from './guard-tool.ts'
