/**
 * §4.2 规则指标:确定性、零模型成本、可全量(56 号 §4.2/§5.2 ①)。
 *
 * 输入是两条**已经各自被测试过**的投影:
 * - `aggregateSessionMetrics`(observe,口径真值源):轮/步/四桶/成本/缓存命中/结束原因;
 * - `projectTrajectory`(本包):工具调用配对、参数合法率、重复调用、审批结局、工具面清单。
 *
 * 三条纪律:
 * 1. **没数据就说没数据**:分母为 0 的比率一律 `not_applicable`(三态计分,不进分母),
 *    绝不用 0 冒充「零失败」。
 * 2. **只有语义无歧义的项判通过**(失败数/拒绝数/异常轮数 = 0);比率类只计量,
 *    `pass: null` —— 阈值要经校准(P1),此处不编门槛。
 * 3. **过程指标不判整体通过**:P0 的综合结论只说「确定性检查」,结果类裁判缺席时
 *    结论是「未评」而不是「通过」(56 号 D2/§5.3)。
 */
import { estimateCostUsd, lookupPrice } from '@eterna/observe'
import { formatCost } from './format.ts'
import type { SessionMetrics } from '@eterna/observe'
import type { EvalIssue, EvalVerdict, MetricScore, Trajectory } from './types.ts'

// 面板共用常量住在 types.ts(客户端半边可安全 import,不牵动 observe 的 node 依赖)。
import { ISSUE_LIMIT } from './types.ts'

export { ISSUE_LIMIT, ISSUE_OVERFLOW_NOTE } from './types.ts'

/** 规则指标的组装输入(aggregate 与 trajectory 必须来自同一事件数组). */
export interface RuleMetricInput {
  readonly aggregate: SessionMetrics
  readonly trajectory: Trajectory
}

/** 一次规则评测的产物(快照里的 metrics/issues/verdict/pending 三块). */
export interface RuleEvaluation {
  readonly metrics: readonly MetricScore[]
  readonly issues: readonly EvalIssue[]
  readonly verdict: EvalVerdict
  readonly pending: readonly string[]
  /** 全路由成本估算(USD);价格表全未命中时为 null(不猜价). */
  readonly costUsd: number | null
}

/** 百分比一位小数(0/0 不上报,调用方先判分母). */
function percent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 10
}

function fixed1(value: number): string {
  return value.toFixed(1)
}

/** 计数指标(带通过判定;pass 只用于「= 0 即通过」的语义无歧义项). */
function countMetric(
  input: {
    key: string
    name: string
    value: number
    unit: string
    detail?: string | undefined
    passWhenZero: boolean
    status?: MetricScore['status']
  },
): MetricScore {
  const status = input.status ?? 'ok'
  return {
    key: input.key,
    name: input.name,
    category: 'process',
    source: 'rule',
    status,
    value: status === 'ok' ? input.value : null,
    display: status === 'ok' ? `${input.value} ${input.unit}`.trim() : '不适用',
    direction: 'lower',
    pass: status === 'ok' && input.passWhenZero ? input.value === 0 : null,
    ...input.detail === undefined ? {} : { detail: input.detail },
  }
}

/**
 * 计算 §4.2 全部规则指标、问题定位与 P0 综合结论。
 * @param input - observe 聚合 + 本包轨迹投影(同一事件数组)。
 * @returns 指标、问题、结论与未评说明。
 */
export function evaluateRules(input: RuleMetricInput): RuleEvaluation {
  const { aggregate, trajectory } = input
  const calls = trajectory.calls
  const failedCalls = calls.filter(call => call.failed)
  const invalidArgs = calls.filter(call => !call.argsValid)
  const unknownCalls = calls.filter(call => call.knownTool === false)
  const repeated = calls.filter(call => call.repeatOf !== undefined)
  const errorTurns = aggregate.turnEnd.error ?? 0
  const abortedTurns = aggregate.turnEnd.aborted ?? 0
  const maxTokenTurns = aggregate.turnEnd['max-tokens'] ?? 0
  const durations = trajectory.turns
    .map(turn => turn.durationMs)
    .filter((value): value is number => value !== null)
  const averageDuration = durations.length === 0
    ? null
    : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)

  const metrics: MetricScore[] = [
    {
      key: 'process.turns', name: '轮数', category: 'process', source: 'rule', status: 'ok',
      value: aggregate.turns, display: `${aggregate.turns} 轮`, direction: 'lower', pass: null,
    },
    {
      key: 'process.steps', name: '步数', category: 'process', source: 'rule', status: 'ok',
      value: aggregate.steps, display: `${aggregate.steps} 步`, direction: 'lower', pass: null,
      detail: '一步 = 一次模型调用及其请求的工具执行;dsh-evals 的 budget.max_turns 按轮计,不按步计。',
    },
    countMetric({
      key: 'process.tool_calls', name: '工具调用', value: calls.length, unit: '次', passWhenZero: false,
      detail: calls.length === 0 ? '本会话尚未发起工具调用。' : undefined,
    }),
    {
      key: 'process.tool_success_rate',
      name: '工具成功率',
      category: 'process',
      source: 'rule',
      status: calls.length === 0 ? 'not_applicable' : 'ok',
      value: calls.length === 0 ? null : percent(calls.length - failedCalls.length, calls.length),
      display: calls.length === 0 ? '不适用' : `${fixed1(percent(calls.length - failedCalls.length, calls.length))}%`,
      direction: 'higher',
      pass: null,
      detail: '失败口径:结果 message.isError 或携带 error 字段(被拒调用同样先记 tool/call,按 callId 判)。',
    },
    countMetric({
      key: 'process.tool_failures', name: '工具失败', value: failedCalls.length, unit: '次', passWhenZero: true,
    }),
    {
      key: 'process.arg_valid_rate',
      name: '参数合法率',
      category: 'process',
      source: 'rule',
      status: calls.length === 0 ? 'not_applicable' : 'ok',
      value: calls.length === 0 ? null : percent(calls.length - invalidArgs.length, calls.length),
      display: calls.length === 0 ? '不适用' : `${fixed1(percent(calls.length - invalidArgs.length, calls.length))}%`,
      direction: 'higher',
      pass: null,
      detail: '合法 = 模型产出的 arguments 是可解析的 JSON 对象;不校验工具 schema(需要工具定义面的逐版本比对,P1)。',
    },
    {
      key: 'process.invalid_args',
      name: '参数不可解析',
      category: 'process',
      source: 'rule',
      status: calls.length === 0 ? 'not_applicable' : 'ok',
      value: calls.length === 0 ? null : invalidArgs.length,
      display: calls.length === 0 ? '不适用' : `${invalidArgs.length} 次`,
      direction: 'lower',
      pass: calls.length === 0 ? null : invalidArgs.length === 0,
    },
    {
      key: 'process.unknown_tool_calls',
      name: '未知工具调用',
      category: 'process',
      source: 'rule',
      status: trajectory.knownTools.length === 0 ? 'not_applicable' : 'ok',
      value: trajectory.knownTools.length === 0 ? null : unknownCalls.length,
      display: trajectory.knownTools.length === 0 ? '不适用' : `${unknownCalls.length} 次`,
      direction: 'lower',
      pass: trajectory.knownTools.length === 0 ? null : unknownCalls.length === 0,
      detail: trajectory.knownTools.length === 0
        ? '会话日志里没有 request/header 的工具清单,无法判定调用名是否合法(不伪报)。'
        : '清单来源:request/header.header.tools 的并集(每步装配面)。',
    },
    countMetric({
      key: 'process.repeat_calls', name: '重复调用', value: repeated.length, unit: '次', passWhenZero: true,
      detail: '同名 + 同参数(去首尾空白)在会话内第二次及以后出现即计一次;用于发现原地打转,不等于错误。',
    }),
    {
      key: 'process.approval_denied',
      name: '审批拒绝',
      category: 'process',
      source: 'rule',
      status: 'ok',
      value: trajectory.approvals.denied,
      display: `${trajectory.approvals.denied} 次`,
      direction: 'lower',
      pass: trajectory.approvals.denied === 0,
      detail: `已问 ${trajectory.approvals.asked} 次 / 已决 ${trajectory.approvals.decided} 次;非放行结局(rejected/cancelled/unavailable)计入拒绝。`,
    },
    {
      key: 'process.error_turns',
      name: '异常结束轮',
      category: 'process',
      source: 'rule',
      status: 'ok',
      value: errorTurns + abortedTurns + maxTokenTurns,
      display: `${errorTurns + abortedTurns + maxTokenTurns} 轮`,
      direction: 'lower',
      pass: errorTurns + abortedTurns + maxTokenTurns === 0,
      detail: `错误 ${errorTurns} / 中止 ${abortedTurns} / 触顶 ${maxTokenTurns}。中止常由用户主动取消,不必然代表缺陷。`,
    },
    {
      key: 'process.turn_latency',
      name: '轮耗时(均值)',
      category: 'process',
      source: 'rule',
      status: averageDuration === null ? 'not_applicable' : 'ok',
      value: averageDuration,
      display: averageDuration === null ? '不适用' : `${(averageDuration / 1000).toFixed(1)} 秒`,
      direction: 'lower',
      pass: null,
      detail: averageDuration === null
        ? '事件流没有时间戳(或没有已结束的轮),无法计算。'
        : `样本 ${durations.length} 轮;耗时 = turn/end.time − turn/start.time。`,
    },
    {
      key: 'process.tokens',
      name: '计费 token',
      category: 'process',
      source: 'rule',
      status: 'ok',
      value: aggregate.tokens.billed,
      display: `${aggregate.tokens.billed.toLocaleString('zh-CN')} tokens`,
      direction: 'lower',
      pass: null,
      detail: `互斥四桶:未缓存输入 ${aggregate.tokens.input} / 缓存读 ${aggregate.tokens.cacheRead} / 缓存写 ${aggregate.tokens.cacheWrite} / 输出 ${aggregate.tokens.output}(reasoning 已含在输出内)。`,
    },
  ]

  const cost = costOfRoutes(aggregate)
  metrics.push({
    key: 'process.cost_usd',
    name: '成本估算',
    category: 'process',
    source: 'rule',
    status: cost.costUsd === null ? 'not_applicable' : 'ok',
    value: cost.costUsd,
    display: cost.costUsd === null ? '不适用' : formatCost(cost.costUsd),
    direction: 'lower',
    pass: null,
    detail: cost.costUsd === null
      ? '价格表未命中本会话的 provider/model,按 0 计会误导,故不上报。'
      : `按 observe DEFAULT_PRICING 估算(非账单);未计价 token ${cost.unpricedBilledTokens}。`,
  })

  metrics.push({
    key: 'process.cache_hit_rate',
    name: '缓存命中率',
    category: 'process',
    source: 'rule',
    status: aggregate.cacheHitRate === null ? 'not_applicable' : 'ok',
    value: aggregate.cacheHitRate === null ? null : percent(aggregate.cacheHitRate, 1),
    display: aggregate.cacheHitRate === null ? '不适用' : `${fixed1(percent(aggregate.cacheHitRate, 1))}%`,
    direction: 'higher',
    pass: null,
    detail: aggregate.cacheHitRate === null
      ? '没有任何一次模型调用报告缓存桶(小会话常见),不伪报 0%。'
      : '口径 = cacheRead / (input + cacheRead + cacheWrite),与 observe 完全同式。',
  })

  const issues = buildIssues(trajectory)
  const failures = metrics.filter(metric => metric.pass === false)
  const verdict = buildVerdict(failures, trajectory)
  const pending = [
    '结果类指标(任务完成、约束满足、业务 rubric)需要裁判模型,属于 P1;当前不上报、不判通过。',
    '通过线阈值需要校准后才能用于门禁(P1 校准面);当前比率类只计量。',
    'pass^k 一致性需要重跑同一任务,不在线做(第二轨 dsh-evals / ai-evo 的职责)。',
  ]

  return { metrics, issues, verdict, pending, costUsd: cost.costUsd }
}

/** 全路由成本:逐路由查价(缓存/输出分价);一条都查不到 → null(不猜价). */
function costOfRoutes(aggregate: SessionMetrics): { costUsd: number | null; unpricedBilledTokens: number } {
  let costUsd = 0
  let priced = false
  for (const route of aggregate.routes) {
    if (!route.priced) continue
    const price = lookupPrice(route)
    if (price === undefined) continue
    costUsd += estimateCostUsd({
      inputTokens: route.tokens.input,
      outputTokens: route.tokens.output,
      cacheReadTokens: route.tokens.cacheRead,
      cacheWriteTokens: route.tokens.cacheWrite,
    }, price)
    priced = true
  }
  return {
    costUsd: priced ? Math.round(costUsd * 1e6) / 1e6 : null,
    unpricedBilledTokens: aggregate.unpricedBilledTokens,
  }
}

/** 问题定位(按轮次升序,最多 ISSUE_LIMIT 条). */
function buildIssues(trajectory: Trajectory): readonly EvalIssue[] {
  const issues: EvalIssue[] = []
  for (const call of trajectory.calls) {
    const where = { turn: call.turn, step: call.step }
    if (call.failed) {
      issues.push({
        turn: call.turn,
        kind: 'tool_error',
        title: `第 ${call.turn} 轮 · ${call.name} 调用失败`,
        detail: `step ${where.step}${call.errorCode === undefined ? '' : ` · ${call.errorCode}`}`,
      })
    }
    if (call.knownTool === false) {
      issues.push({
        turn: call.turn,
        kind: 'tool_unknown',
        title: `第 ${call.turn} 轮 · 调用了不在工具面清单里的工具 ${call.name}`,
        detail: `step ${where.step};清单来自 request/header.header.tools。`,
      })
    }
    if (!call.argsValid) {
      issues.push({
        turn: call.turn,
        kind: 'arg_invalid',
        title: `第 ${call.turn} 轮 · ${call.name} 的参数不是合法 JSON 对象`,
        detail: `step ${where.step};原始参数前 80 字:${call.arguments.slice(0, 80)}`,
      })
    }
    if (call.repeatOf !== undefined) {
      issues.push({
        turn: call.turn,
        kind: 'repeat',
        title: `第 ${call.turn} 轮 · ${call.name} 重复了第 ${call.repeatOf.turn} 轮的同一调用`,
        detail: '同名 + 同参数;若原调用是失败的,重复通常是重试而非原地打转,需结合失败项看。',
      })
    }
  }
  for (const turn of trajectory.turns) {
    if (turn.endReason !== 'error') continue
    issues.push({
      turn: turn.turn,
      kind: 'turn_error',
      title: `第 ${turn.turn} 轮异常结束`,
      detail: 'turn/end.reason.kind = error;失败身份见会话日志的 error 事件。',
    })
  }
  for (const toolName of trajectory.approvals.deniedToolNames) {
    issues.push({
      turn: 0,
      kind: 'approval_denied',
      title: `工具 ${toolName} 的审批未放行`,
      detail: '审批结局非 allowed-once(rejected/cancelled/unavailable);轮次按调用配对可得,当前未在审批事件上携带。',
    })
  }
  if (trajectory.approvals.denied > trajectory.approvals.deniedToolNames.length) {
    issues.push({
      turn: 0,
      kind: 'approval_denied',
      title: `另有 ${trajectory.approvals.denied - trajectory.approvals.deniedToolNames.length} 次审批未放行`,
      detail: '审批事件未携带工具名时只计数,不臆测归属。',
    })
  }
  // 排序:轮次升序(未知轮次排后),稳定可读。
  const sorted = issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => {
      const leftTurn = left.issue.turn === 0 ? Number.MAX_SAFE_INTEGER : left.issue.turn
      const rightTurn = right.issue.turn === 0 ? Number.MAX_SAFE_INTEGER : right.issue.turn
      return leftTurn === rightTurn ? left.index - right.index : leftTurn - rightTurn
    })
    .map(entry => entry.issue)
  return sorted.slice(0, ISSUE_LIMIT)
}

/** P0 综合结论:只看确定性检查;有任何 pass=false 即 warn,无内容=unrated. */
function buildVerdict(
  failures: readonly MetricScore[],
  trajectory: Trajectory,
): EvalVerdict {
  if (trajectory.window.events === 0) {
    return { level: 'unrated', label: '未评：会话尚无内容', reasons: ['当前会话还没有可投影的事件。'] }
  }
  if (failures.length === 0) {
    return {
      level: 'pass',
      label: '确定性检查通过（结果类未评）',
      reasons: [
        '零模型成本规则项全部无异常。',
        '任务完成与业务 rubric 需要裁判模型，P1 之前不并入结论。',
      ],
    }
  }
  return {
    level: 'warn',
    label: `确定性检查：${failures.length} 项异常（结果类未评）`,
    reasons: failures.map(metric => `${metric.name}: ${metric.display}`),
  }
}

/** 供测试与面板:指标键序(展示顺序即此序). */
export const RULE_METRIC_KEYS: readonly string[] = [
  'process.turns',
  'process.steps',
  'process.tool_calls',
  'process.tool_success_rate',
  'process.tool_failures',
  'process.arg_valid_rate',
  'process.invalid_args',
  'process.unknown_tool_calls',
  'process.repeat_calls',
  'process.approval_denied',
  'process.error_turns',
  'process.turn_latency',
  'process.tokens',
  'process.cost_usd',
  'process.cache_hit_rate',
]
