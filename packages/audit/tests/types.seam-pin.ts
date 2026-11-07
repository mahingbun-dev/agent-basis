/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 * 与 governance/tests/types.seam-pin.ts 同款约定:DSH pre-stable,适配面用类型断言钉住。
 */
import type { Context } from '@deepseek-ai/cordis'
import { AUDIT_ID, AUDIT_SERVICE_ID, defineAuditPlugin } from '../src/index.ts'
import type { AuditPluginConfig, AuditWorld } from '../src/index.ts'

/** 钉住 ①(设计 §3.0-1):服务名必须恰为 'audit' —— cordis provide 的 name 即 ctx 属性名,
 * 名字漂移 = ctx.audit 永不存在(r2 评审点)。 */
export const pinServiceId: 'audit' = AUDIT_SERVICE_ID

/** 钉住 ②(设计 §3.0-4):库内对象 id 标签恰为 '@basis/audit'(注册表命名空间,与服务名分名)。 */
export const pinObjectId: '@basis/audit' = AUDIT_ID

/** 钉住 ③:本包 service.ts 的 Context 增广使 ctx.audit 类型面可达,且形态 = AuditWorld。 */
declare const ctx: Context
export const pinContextAudit: AuditWorld | undefined = ctx.audit

/** 钉住 ④:配置面仅由 AuditPluginConfig 承载(全可选),defineAuditPlugin 零参可用。 */
export const pinConfigFactory: ReturnType<typeof defineAuditPlugin> = defineAuditPlugin({})
export const pinEmptyConfig: AuditPluginConfig = {}
