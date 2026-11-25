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
import type { BusinessMetric } from '../business-metrics.ts'
import type { JudgeConfig, JudgeSettingsView, JudgeTrialView, OverviewView } from '../judge-types.ts'

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
 * 读评测总览(近 14 天,服务端只聚合**本人名下**的会话)。
 * @param signal - 取消信号.
 * @returns 总览视图(服务端按登录身份过滤会话集).
 */
export async function fetchOverview(signal?: AbortSignal): Promise<OverviewView> {
  const parsed = await postJson('overview', {}, signal)
  const overview = parsed.overview
  if (typeof overview !== 'object' || overview === null) {
    throw new SessionEvalApiError(200, '应答缺少 overview 字段')
  }
  return overview as OverviewView
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

/** 业务指标保存应答(文件新版本 + 回显条目 + 完整 YAML). */
export interface BusinessSavedReply {
  readonly version: number
  readonly metric: BusinessMetric
  readonly yaml: string
}

/**
 * 保存一条业务指标(写入**当前账号**的覆盖层;账号由服务端从登录态取)。
 * @param metric - 指标对象(外层 camelCase,嵌套 snake_case,与 metrics.yaml 同形).
 * @param baseVersion - 前端读到的文件版本(乐观锁;409 = 请重新读取).
 * @param signal - 取消信号.
 * @returns 文件新版本、回显条目与完整 YAML.
 */
export async function saveBusinessMetric(metric: unknown, baseVersion: number, signal?: AbortSignal): Promise<BusinessSavedReply> {
  const parsed = await postJson('metrics/save', { metric, baseVersion }, signal)
  const saved = parsed.metric
  if (typeof saved !== 'object' || saved === null) {
    throw new SessionEvalApiError(200, '应答缺少 metric 字段')
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : baseVersion + 1,
    metric: saved as BusinessMetric,
    yaml: typeof parsed.yaml === 'string' ? parsed.yaml : '',
  }
}

/** YAML 导入解析结果(文件元信息 + 条目;不落盘). */
export interface BusinessParsedReply {
  readonly version: number
  readonly updatedAt: string
  readonly updatedBy: string
  readonly metrics: readonly BusinessMetric[]
}

/**
 * 解析导入的 metrics.yaml(纯解析,不写文件;失败抛 400 带行级中文原因)。
 * @param text - 粘贴的文件原文.
 * @param signal - 取消信号.
 * @returns 文件版本/更新者与解析出的条目.
 */
export async function parseMetricsYaml(text: string, signal?: AbortSignal): Promise<BusinessParsedReply> {
  const parsed = await postJson('metrics/parse', { text }, signal)
  const metrics = parsed.metrics
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 0,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : '',
    metrics: Array.isArray(metrics)
      ? metrics.filter((item): item is BusinessMetric => typeof item === 'object' && item !== null)
      : [],
  }
}

/** 人工复核结果(判得对=agrees / 判错了=disagrees). */
export type JudgeLabelMark = 'agrees' | 'disagrees'

/**
 * 记录一条人工复核(校准数据;标注人由服务端从登录态取)。
 * @param session - 会话 id.
 * @param metric - 裁判指标键.
 * @param turn - 逐轮指标的目标轮(会话类不传).
 * @param agrees - 人工是否认可裁判判定.
 * @returns 服务端确认的标注值.
 */
export async function saveJudgeLabel(
  session: string,
  metric: string,
  turn: number | undefined,
  agrees: boolean,
  signal?: AbortSignal,
): Promise<JudgeLabelMark> {
  const parsed = await postJson('labels/save', {
    session, metric, agrees, ...turn === undefined ? {} : { turn },
  }, signal)
  return parsed.label === 'disagrees' ? 'disagrees' : 'agrees'
}

/**
 * 单指标试跑(真实模型;不落评分行,计入日预算;原始输出原样返回)。
 * @param session - 会话 id.
 * @param metric - 指标键(内置 judge.* 或本账号 rubric 业务指标).
 * @param turn - 逐轮指标的目标轮(缺省末轮).
 * @param signal - 取消信号.
 * @returns 试跑结果(含模型原始输出).
 */
export async function runJudgeTrial(
  session: string,
  metric: string,
  turn: number | undefined,
  signal?: AbortSignal,
): Promise<JudgeTrialView> {
  const parsed = await postJson('trial', { session, metric, ...turn === undefined ? {} : { turn } }, signal)
  const trial = parsed.trial
  if (typeof trial !== 'object' || trial === null) {
    throw new SessionEvalApiError(200, '应答缺少 trial 字段')
  }
  return trial as JudgeTrialView
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
