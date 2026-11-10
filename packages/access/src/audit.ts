/**
 * 审计桥:access 事件 → ctx.audit 直投(audit-bridge 模式,audit 缺席降级不阻塞)。
 * 读取 seam:不能裸读 ctx 属性——cordis get 陷阱对未声明 inject 的兄弟插件服务抛
 * "cannot get property ... without inject";ctx.reflect.get(name, false) 是受认可的
 * 无 inject 读取(strict=false = 值在 store 即用,机会语义)。
 */
export interface AuditReflect {
  get(name: string, strict?: boolean): unknown
}

export interface AccessAuditEvent {
  readonly kind: string
  readonly account?: string
  readonly ip?: string
  readonly ok?: boolean
  readonly detail?: Record<string, unknown>
}

/** 直投一条 access 事件到 ctx.audit(缺席时无操作);不抛——审计不改变决策路径。 */
export function reportAccessAudit(ctx: { reflect: AuditReflect }, event: AccessAuditEvent): void {
  const audit = ctx.reflect.get('audit', false) as
    | { report(detail: Readonly<Record<string, unknown>> & { readonly actor?: unknown }): readonly unknown[] }
    | undefined
  audit?.report({
    kind: event.kind,
    ...(event.account !== undefined ? { account: event.account } : {}),
    ...(event.ip !== undefined ? { ip: event.ip } : {}),
    ...(event.ok !== undefined ? { ok: event.ok } : {}),
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
    actor: { pluginId: 'eterna-access', source: 'decision' },
  })
}
