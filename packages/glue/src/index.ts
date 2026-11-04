/**
 * @basis/glue — 组合层:把 @basis 服务装配为真实 DSH 插件。
 *
 * 装配面(全部经官方 seam,零内核改动):
 * - memory:defineMemoryTools → ctx.tools.register;记忆索引 → ctx.systemPrompt.section
 * - knowledge:toDshTools → ctx.tools.register
 * - governance:规则文件 → ctx.governance 服务 provide(供 interact/knowledge 等 coeffect)
 *
 * Cordis 纪律:插件导出 name + inject + apply(ctx);注册返回 disposer 即 effect 逆。
 */
export { defineMemoryPlugin } from './plugins/memory-plugin.ts'
export { defineKnowledgePlugin } from './plugins/knowledge-plugin.ts'
export { defineGovernancePlugin } from './plugins/governance-plugin.ts'
export { BASIS_GLUE_PLUGIN_NAME } from './types.ts'
