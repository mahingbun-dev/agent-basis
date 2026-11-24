/**
 * 参谋面板客户端 API 面:同源 fetch 封装(/access/api/adviser/*)。
 *
 * 三条端点全部 POST + JSON body(access 侧 `createNodeHandler` 的 pathname 已被
 * `new URL(...).pathname` 剥掉 query,GET 读不到 parent;POST 同时吃到同源闸)。
 * 身份靠 `eterna_session` cookie 自动携带,本层不碰凭据。
 *
 * 错误面:access 用 `{error: 中文}` 形态回错(status 非 2xx),本层统一抛
 * {@link AdviserApiError} 并把 status 带出来,让 UI 能区分「未登录 401」与
 * 「内核未就绪 503」。
 */

/** 一条参谋会话(与 host 侧 AdviserSessionView 同形)。 */
export interface AdviserRowView {
  readonly sessionId: string
  readonly label: string
  readonly activity: 'running' | 'inactive'
}

/** 投递方式:inject 不唤醒(下次发言才见)/ followup 自成一轮(立即处理)。 */
export type AdviserDelivery = 'inject' | 'followup'

/** 带 HTTP 状态的服务端失败(UI 据此选文案)。 */
export class AdviserApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdviserApiError'
    this.status = status
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new AdviserApiError(res.status, '服务返回了无法解析的内容')
  }
  if (!res.ok) {
    const message = (parsed as { error?: unknown }).error
    throw new AdviserApiError(res.status, typeof message === 'string' ? message : '请求失败')
  }
  return parsed as T
}

/** 列某主会话下的全部参谋。 */
export async function listAdvisers(parent: string): Promise<readonly AdviserRowView[]> {
  const result = await call<{ advisers?: readonly AdviserRowView[] }>('/access/api/adviser/list', { parent })
  return result.advisers ?? []
}

/** 建一个参谋会话。 */
export function createAdviser(parent: string, seed: string): Promise<{ sessionId: string; messageId: string }> {
  return call('/access/api/adviser/create', { parent, seed })
}

/** 把一条结论投递给主会话。 */
export function deliverToParent(
  parent: string,
  text: string,
  delivery: AdviserDelivery,
): Promise<{ delivery: AdviserDelivery; sessionId: string }> {
  return call('/access/api/adviser/deliver', { parent, text, delivery })
}
