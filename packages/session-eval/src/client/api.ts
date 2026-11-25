/**
 * 评测面板客户端 API 面:同源 fetch 封装(/access/api/session-eval/*)。
 *
 * 端点 POST + JSON body(access 侧 pathname 已剥 query,GET 读不到 session;
 * POST 同时吃到同源闸)。身份靠 `eterna_session` cookie 自动携带,本层不碰凭据。
 * 错误面与 adviser api.ts 同形:{error: 中文} + 非 2xx → 抛带 status 的错误,
 * UI 据此区分「未登录 401」「会话不属于你 404」「内核未就绪 503」
 * 「预算用尽 429」「在途冲突 409」。
 */
import type { EvalSnapshot } from '../types.ts'
import type { JudgeConfig, JudgeSettingsView } from '../judge-types.ts'

/** 带 HTTP 状态的服务端失败(UI 据此选文案). */
export class SessionEvalApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SessionEvalApiError'
    this.status = status
  }
}

/** 手动评测受理结果(与 JudgeEvaluateReply 成功支同形). */
export interface EvaluateAccepted {
  readonly accepted: number
  readonly pending: number
  readonly skipped: readonly string[]
}

/** 设置读面应答(settings + admin 标志). */
export interface JudgeSettingsReply {
  readonly settings: JudgeSettingsView
  readonly admin: boolean
}

/** 统一 POST + 解析 + 错误映射. */
async function postJson(action: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(`/access/api/session-eval/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    ...signal === undefined ? {} : { signal },
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new SessionEvalApiError(res.status, '服务返回了无法解析的内容')
  }
  const record = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  if (!res.ok) {
    const message = record.error
    throw new SessionEvalApiError(res.status, typeof message === 'string' ? message : '请求失败')
  }
  return record
}

/**
 * 拉取一个会话的评测快照。
 * @param session - 会话 id(面板所在会话).
 * @param signal - 取消信号(卸载/切会话时中止在途请求).
 * @returns 快照(结构完整,含空态).
 */
export async function fetchSnapshot(session: string, signal?: AbortSignal): Promise<EvalSnapshot> {
  const parsed = await postJson('snapshot', { session }, signal)
  const snapshot = parsed.snapshot
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new SessionEvalApiError(200, '应答缺少 snapshot 字段')
  }
  return snapshot as EvalSnapshot
}

/**
 * 手动触发裁判评测(「立即评测」)。
 * @param session - 会话 id.
 * @param options - 范围(all/outcome/process)与目标轮.
 * @returns 受理数量与跳过原因;业务拒绝由抛错表达(status 400/409/429)。
 */
export async function evaluateSession(
  session: string,
  options: { readonly scope?: 'all' | 'outcome' | 'process'; readonly turn?: number } = {},
  signal?: AbortSignal,
): Promise<EvaluateAccepted> {
  const parsed = await postJson('evaluate', { session, ...options }, signal)
  return {
    accepted: typeof parsed.accepted === 'number' ? parsed.accepted : 0,
    pending: typeof parsed.pending === 'number' ? parsed.pending : 0,
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped.filter((item): item is string => typeof item === 'string') : [],
  }
}

/**
 * 读裁判设置(配置 + 指标目录 + 模型目录)。
 * @param signal - 取消信号.
 * @returns 设置视图与当前用户是否管理员(保存按钮据此禁用)。
 */
export async function fetchJudgeSettings(signal?: AbortSignal): Promise<JudgeSettingsReply> {
  const parsed = await postJson('settings', {}, signal)
  const settings = parsed.settings
  if (typeof settings !== 'object' || settings === null) {
    throw new SessionEvalApiError(200, '应答缺少 settings 字段')
  }
  return { settings: settings as JudgeSettingsView, admin: parsed.admin === true }
}

/**
 * 保存裁判配置(仅管理员;服务端二次校验)。
 * @param config - 完整配置对象(不做部分合并).
 * @param signal - 取消信号.
 * @returns 服务端确认后的配置(与提交值一致).
 */
export async function saveJudgeConfig(config: JudgeConfig, signal?: AbortSignal): Promise<JudgeConfig> {
  const parsed = await postJson('config/save', { config }, signal)
  const saved = parsed.config
  if (typeof saved !== 'object' || saved === null) {
    throw new SessionEvalApiError(200, '应答缺少 config 字段')
  }
  return saved as JudgeConfig
}
