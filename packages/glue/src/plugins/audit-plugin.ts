/**
 * audit 插件装载位(T8):@basis/audit 的宿主侧出口。
 *
 * bundle 装载行的 name 解析为 '@basis/glue/audit-plugin' —— 与 governance/memory/
 * knowledge 同通道(profile node_modules 保证 @basis/glue 根链可达;@basis/audit
 * 本体只保证在 glue 的依赖树里)。本体零改动重导出:配置经 defineAuditPlugin 透传,
 * default export 为 loader 取用的插件实例(DSH 硬性规范 1)。
 */
import { defineAuditPlugin } from '@basis/audit'

export { AUDIT_ID, AUDIT_PLUGIN_NAME, AUDIT_SERVICE_ID, defaultAuditDir, defineAuditPlugin } from '@basis/audit'
export type { AuditPluginConfig } from '@basis/audit'

// DSH bundle loader 取 default export 插件实例(漏写 = 静默不装载,硬性规范 1)
export default defineAuditPlugin()
