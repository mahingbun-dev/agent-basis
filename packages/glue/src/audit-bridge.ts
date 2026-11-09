/**
 * 组合层审计桥(T8):governance/egress 的宿主决策 → ctx.audit 直投。
 *
 * 包边界(@basis/governance 不 import @basis/audit,设计 §3.4 不变量 4):
 * 治理事件经 ctx.audit.report() 直投(唯一 AuditProjector 归 audit 插件);
 * 桥在组合层(glue)以结构子集读取 ctx.audit——audit 插件缺席时静默跳过,
 * 决策 veto 本身不受影响。读取是逐调用惰性的:glue 装载行序里 governance 先于
 * audit,apply 时刻 ctx.audit 尚未 provide(audit 插件读 ctx.governance.pii 用的是
 * 「先装载先在场」的反向依赖,packages/audit/src/plugin.ts,两侧不对称)。
 *
 * 读取 seam(2026-11-09 治理 E2E 教训):不能裸读 ctx 属性——cordis get 陷阱对未在
 * inject 表声明的兄弟插件服务抛 "cannot get property ... without inject"
 * (vendor/cordis src/reflect.ts:152);inject 是硬依赖表,声明 audit 会把 governance/
 * egress 绑死在 audit 上(违背「审计缺席只降级」)。ctx.reflect.get(name, false) 是
 * 受认可的无 inject 读取(同文件 :240「without the inject requirement」;harness
 * 先例 liveshare share-host.ts:134,238),strict=false = 值在 store 即用(机会语义)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { AUDIT_SERVICE_ID } from '@basis/audit'
import type { AuditActor } from '@basis/governance'

/** ctx.audit 的最小结构子集(report 直投;AuditWorld.report 的超集兼容面)。 */
export interface AuditReportSink {
  report(detail: Readonly<Record<string, unknown>> & { readonly actor?: AuditActor }): readonly unknown[]
}

/** 直投一条治理明细到 ctx.audit(缺席时无操作);不抛——审计不改变决策路径。 */
export function reportToAudit(ctx: Context, detail: Readonly<Record<string, unknown>> & { readonly actor?: AuditActor }): void {
  const audit = ctx.reflect.get(AUDIT_SERVICE_ID, false) as AuditReportSink | undefined
  audit?.report(detail)
}
