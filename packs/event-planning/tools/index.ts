/**
 * @event/pack 领域工具注册入口(组合层从这里取插件模块)。
 * 每个工具模块保持「注册表 + 唯一 ID」形态(packctl lint CORD002/003/004/005 强制)。
 * 13 号文档 §3 工具候选:预算计算器 / 供应商库查询 / 场地库查询 / 排期冲突检查 /
 * 模板库检索 / 天气查询 —— v0 先落前两个的确定性核心,其余随 S2 迭代。
 */
export { createBudgetTool, BUDGET_TOOL_SERVICE_ID } from './budget-tool.ts'
export type { EventBudgetTool, BudgetLine } from './budget-tool.ts'
export { createVendorRegistry, VENDOR_TOOL_SERVICE_ID } from './vendor-registry.ts'
export type { VendorQuote, VendorRegistry } from './vendor-registry.ts'
