/**
 * 同源 RPC 客户端(tenant 守卫路由专用)。
 *
 * 服务端 `registerTenantGuards` 的每条路由都过 `unpack()`:必须收到上游 typert
 * 同构信封 `{type:'client-request', rpcId, method, payload:{args}}`,裸 body 一律
 * 400 `invalid client-request message`。2026-11-18 实证事故:我的插件/共享工具
 * 两个分区曾发裸 body,浏览器里永远 400 → 分区不渲染(「发现不了、管理不了」);
 * E2E 手写信封直打 HTTP,掩盖了客户端缺陷。信封只此一处构造。
 */

export interface RpcResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

/** rpcId 不必全局唯一,只需同连接内可关联;crypto.randomUUID 在非安全源不可用,故留退路。 */
function newRpcId(): string {
  const c: { randomUUID?: () => string } | undefined = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** POST 一条 client-request 到 tenant 守卫路由;网络/解析失败按失败结果返回。 */
export async function postRpc<T = unknown>(path: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const body = JSON.stringify({ type: 'client-request', rpcId: newRpcId(), method: path.replace(/^\/api\//u, ''), payload: { args } })
  const r = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body,
  })
  const payload = await r.json().catch(() => null) as { result?: { ok?: boolean; value?: T; error?: { message?: string } } } | null
  if (payload?.result?.ok === true) {
    return payload.result.value === undefined ? { ok: true } : { ok: true, value: payload.result.value }
  }
  const err = payload?.result?.error
  return err === undefined ? { ok: false } : { ok: false, error: err }
}
