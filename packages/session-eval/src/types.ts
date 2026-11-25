/**
 * @eterna/session-eval 服务端词汇:轨迹投影、规则评分与快照的结构面。
 *
 * 这些类型同时是 **host → access → 浏览器** 三层的数据契约(snapshot 路由原样
 * 序列化,客户端只按此形状渲染),因此不 import 上游类型包:上游事件形状用结构
 * 子集声明(与 observe / cache-guard 同纪律),升级破坏面由测试的 seam 断言兜住。
 */

/**
 * session 事件流的最小事件包(结构兼容 dsh `SessionEvent`:{type, seq, time, data}).
 * 未知类型一律静默跳过(前向兼容,observe metrics.ts 同款口径)。
 */
export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
  readonly seq?: number
  readonly time?: number
}

/** 一次工具调用的投影(call 与 result 按 callId 配对)。 */
export interface ToolCallRecord {
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: string
  /** 模型产出的原始 JSON 字符串(未解析;判参数合法率用)。 */
  readonly arguments: string
  /** JSON.parse 成功与否(空串按不合法计:模型没给参数对象)。 */
  readonly argsValid: boolean
  /** 结果是否失败:`message.isError === true` 或 `data.error` 存在。 */
  readonly failed: boolean
  /** 失败身份(上游 error.name/code;规则不解释语义,只留痕)。 */
  readonly errorCode?: string
  /** 该调用名是否在本会话出现过的工具面清单里(清单缺席 → undefined,不判)。 */
  readonly knownTool?: boolean
  /** 同 (name, 规范化参数) 上一次出现的位置(重复调用检测;无重复省略)。 */
  readonly repeatOf?: { readonly turn: number; readonly step: number }
}

/** 逐轮投影(结束原因与耗时;未被 turn/end 收口的轮 reason 缺席)。 */
export interface TurnRecord {
  readonly turn: number
  readonly steps: number
  readonly toolCalls: number
  readonly failedCalls: number
  readonly endReason?: string
  /** 起止事件时间差(毫秒;事件无 time 时为 null)。 */
  readonly durationMs: number | null
}

/** 审批汇总(asked/decided 按 id 配对;被拒=decided outcome 非 allowed-once)。 */
export interface ApprovalSummary {
  readonly asked: number
  readonly decided: number
  /** 非放行的结局数(rejected / cancelled / unavailable)。 */
  readonly denied: number
  /** 被拒审批关联的 tool callId(上游 approval/asked 可带 callId;缺失则不入)。 */
  readonly deniedCallIds: readonly string[]
  /** 被拒审批涉及的工具名(上游 approval/asked.toolName;缺失则不入)。 */
  readonly deniedToolNames: readonly string[]
}

/** 六桶用量(互斥口径与 observe TokenBuckets 同源:input 只含未缓存输入)。 */
export interface UsageBuckets {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  /** 计费口径合计 = input + cacheRead + cacheWrite + output。 */
  readonly billed: number
}

/** 轨迹投影(纯函数产物;所有字段都由事件流确定性推导)。 */
export interface Trajectory {
  readonly sessionId: string
  /** 事件窗口(输入数组边界)。 */
  readonly window: {
    readonly events: number
    readonly firstSeq?: number
    readonly lastSeq?: number
    readonly firstTime?: number
    readonly lastTime?: number
  }
  readonly turns: readonly TurnRecord[]
  readonly calls: readonly ToolCallRecord[]
  readonly approvals: ApprovalSummary
  readonly usage: UsageBuckets
  /** 带 usage 的模型调用次数。 */
  readonly modelCalls: number
  /** 缓存命中率 = cacheRead / (input+cacheRead+cacheWrite);未报告缓存桶时为 null。 */
  readonly cacheHitRate: number | null
  /** 会话出现过的全部工具名(来自 request/header.header.tools;空集 = 清单缺席)。 */
  readonly knownTools: readonly string[]
  /** 最近一次请求路由(provider/model;无 header/context 时为 null)。 */
  readonly route: { readonly provider: string; readonly model: string } | null
}

/** 评分状态:只有 ok 进分母(not_applicable / error 不进,Inspect 三态口径)。 */
export type ScoreStatus = 'ok' | 'error' | 'not_applicable'

/** 指标方向:lower = 越低越好(lower 指标给 pass 阈值时按 ≤ 判)。 */
export type MetricDirection = 'higher' | 'lower' | 'none'

/** 一条规则评分(一次判定)。 */
export interface MetricScore {
  /** 稳定键(内置指标前缀 process./outcome.;与 packs 的指标 key 空间同形)。 */
  readonly key: string
  readonly name: string
  readonly category: 'process' | 'outcome'
  readonly source: 'rule'
  readonly status: ScoreStatus
  /** 数值(计数/百分比/毫秒);status != ok 时为 null。 */
  readonly value: number | null
  /** 人读值(带单位,如「3 次」「95.2%」);status != ok 时为状态文案。 */
  readonly display: string
  readonly direction: MetricDirection
  /** 通过判定:null = 本指标不判通过(仅计量)。 */
  readonly pass: boolean | null
  /** 口径或异常的说明(默认折叠)。 */
  readonly detail?: string
}

/** 面板「问题」区最多列出的条目数(超出只报计数,防长会话把快照撑爆). */
export const ISSUE_LIMIT = 50
/** 问题列表被截断时的说明(客户端原样展示). */
export const ISSUE_OVERFLOW_NOTE = `问题超过 ${ISSUE_LIMIT} 条,列表已截断;完整明细见会话轨迹。`

/** 问题定位条目(面板「问题」区;点击可定位轮次)。 */
export interface EvalIssue {
  readonly turn: number
  readonly kind: 'tool_error' | 'tool_unknown' | 'repeat' | 'approval_denied' | 'turn_error' | 'arg_invalid'
  readonly title: string
  readonly detail: string
}

/** 综合结论(P0 只有确定性检查;结果类裁判缺席即 unrated,绝不伪报通过)。 */
export interface EvalVerdict {
  readonly level: 'pass' | 'warn' | 'unrated'
  readonly label: string
  readonly reasons: readonly string[]
}

/** 快照(右栏面板渲染的全部输入;`state` 决定空态文案)。 */
export interface EvalSnapshot {
  readonly sessionId: string
  /** ok = 有可评内容;empty = 会话尚无事件;not_loaded = 会话不在宿主内存(未打开)。 */
  readonly state: 'ok' | 'empty' | 'not_loaded'
  /** 服务端生成时刻(毫秒)。 */
  readonly generatedAt: number
  readonly turns: number
  readonly steps: number
  /** 截至第 N 轮(0 = 无轮)。 */
  readonly lastTurn: number
  /** 会话首末事件时差(毫秒;无 time 时为 null)。 */
  readonly durationMs: number | null
  readonly usage: UsageBuckets
  readonly cacheHitRate: number | null
  readonly costUsd: number | null
  readonly route: { readonly provider: string; readonly model: string } | null
  readonly verdict: EvalVerdict
  readonly metrics: readonly MetricScore[]
  readonly issues: readonly EvalIssue[]
  /** 待评/未评说明(P1 裁判项与不可在线测项,一次性列清,不混进分数)。 */
  readonly pending: readonly string[]
}

/** 快照请求/应答的线上形状(access 守卫路由与客户端 api.ts 共用)。 */
export interface SnapshotReply {
  readonly ok: true
  readonly snapshot: EvalSnapshot
}
