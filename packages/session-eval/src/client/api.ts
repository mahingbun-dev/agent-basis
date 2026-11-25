/**
 * 评测面板客户端 API 面:同源 fetch 封装(/access/api/session-eval/*)。
 *
 * 端点 POST + JSON body(access 侧 pathname 已剥 query,GET 读不到 session;
 * POST 同时吃到同源闸)。身份靠 `eterna_session` cookie 自动携带,本层不碰凭据。
 * 错误面与 adviser api.ts 同形:{error: 中文} + 非 2xx → 抛带 status 的错误,
 * UI 据此区分「未登录 401」「会话不属于你 404」「内核未就绪 503」。
 */
import type { EvalSnapshot } from '../types.ts'

/** 带 HTTP 状态的服务端失败(UI 据此选文案). */
export class SnapshotApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SnapshotApiError'
    this.status = status
  }
}

/**
 * 拉取一个会话的评测快照。
 * @param session - 会话 id(面板所在会话).
 * @param signal - 取消信号(卸载/切会话时中止在途请求).
 * @returns 快照(结构完整,含空态).
 */
export async function fetchSnapshot(session: string, signal?: AbortSignal): Promise<EvalSnapshot> {
  const res = await fetch('/access/api/session-eval/snapshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session }),
    credentials: 'same-origin',
    ...signal === undefined ? {} : { signal },
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new SnapshotApiError(res.status, '服务返回了无法解析的内容')
  }
  if (!res.ok) {
    const message = (parsed as { error?: unknown }).error
    throw new SnapshotApiError(res.status, typeof message === 'string' ? message : '请求失败')
  }
  const snapshot = (parsed as { snapshot?: unknown }).snapshot
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new SnapshotApiError(res.status, '应答缺少 snapshot 字段')
  }
  return snapshot as EvalSnapshot
}
