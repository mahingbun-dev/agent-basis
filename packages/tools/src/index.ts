/** @basis/tools —— 工具注册表与执行链。 */
export { ToolRegistryImpl, matchesPattern } from './registry.ts'
export type { ExecInput, ToolExecutor } from './registry.ts'
export { ToolGateError, createToolExecutor } from './executor.ts'
export { TOOLS_PLUGIN_NAME, defineToolsPlugin } from './plugin.ts'
export { default } from './plugin.ts'
