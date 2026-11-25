/**
 * 参谋面板客户端 API 面:同源 fetch 封装(/access/api/adviser/*)。
 *
 * 五条端点全部 POST + JSON body(access 侧 `createNodeHandler` 的 pathname 已被
 * `new URL(...).pathname` 剥掉 query,GET 读不到 parent;POST 同时吃到同源闸)。
 * 身份靠 `eterna_session` cookie 自动携带,本层不碰凭据。
 *
 * 模型目录(`fetchModelCatalog`)不走 access 路由:它读的是宿主既有 typert 端点
 * `/api/session/modelCatalog`(主会话模型菜单同源),信封与上游客户端同构。
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

/** 参谋模型选择(与 host 侧 AdviserModelSelection 同形)。 */
export interface AdviserModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 模型目录的思考档位(上游 ModelCatalogModel.reasoning.efforts 子集)。 */
export interface AdviserReasoningEffort {
  readonly id: string
  readonly name: string
}

/** 模型目录的一行模型(只取面板展示需要的字段;badge 等留白不渲染)。 */
export interface AdviserCatalogModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: {
    readonly efforts: readonly AdviserReasoningEffort[]
    readonly defaultEffort?: string
  }
}

/** 模型目录的一个供应商。 */
export interface AdviserCatalogProvider {
  readonly id: string
  readonly name?: string
  readonly models?: readonly AdviserCatalogModel[]
}

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

/** 读参谋当前模型;服务面未知时 null(UI 显示「未知」并仍允许设置)。 */
export async function readAdviserModel(
  parent: string,
  child: string,
): Promise<AdviserModelSelection | null> {
  const result = await call<{ selection?: AdviserModelSelection | null }>('/access/api/adviser/model/read', { parent, child })
  return result.selection ?? null
}

/** 切参谋模型(互不影响主会话);返回服务面确认后的选择。 */
export async function setAdviserModel(
  parent: string,
  child: string,
  selection: AdviserModelSelection,
): Promise<AdviserModelSelection> {
  const result = await call<{ selection?: AdviserModelSelection }>('/access/api/adviser/model', {
    parent, child, ...selection,
  })
  return result.selection ?? selection
}

/**
 * 读全局模型目录(宿主 typert 端点;与主会话模型菜单同一份数据)。
 * @returns 供应商分组(失败由调用方降级为空态)。
 */
export async function fetchModelCatalog(): Promise<readonly AdviserCatalogProvider[]> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: globalThis.crypto.randomUUID(),
    method: 'modelCatalog',
    payload: { args: {} },
  })
  const response = await fetch('/api/session/modelCatalog', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body,
  })
  const parsed = await response.json().catch(() => null) as {
    result?: { ok?: boolean; value?: { groups?: readonly AdviserCatalogProvider[] }; error?: { message?: string } }
  } | null
  if (parsed?.result?.ok !== true) {
    throw new AdviserApiError(response.status, parsed?.result?.error?.message ?? '模型目录不可用')
  }
  return parsed.result.value?.groups ?? []
}
