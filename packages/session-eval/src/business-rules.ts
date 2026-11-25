/**
 * 规则型业务指标执行(56 号 §9.3/§9.7):确定性断言,零模型成本。
 *
 * 语义与 `tools/evals` 金集断言器对齐(离线金集与在线会话同一套判定):
 * - `trajectory.approval_flow`: `approval/asked` 按 tool 过滤计数 ≥ min_count;
 *   单轮口径按 asked.callId → `tool/call` 的 turn 归属(无 callId 的问询不计入单轮);
 * - `answer.not_contains`: 作用域内**最后一条**助手文本(与 dsh-evals
 *   `answer` 断言只看最终回答同口径),命中任一禁语即未过;
 * - `budget`: turn/start 去重轮数 ≤ max_turns,且 assistant usage 计费总量
 *   (`totalTokens ?? input+output+cacheRead+cacheWrite`)≤ max_tokens;仅 session 口径。
 *
 * 事件解析对外来数据 fail-closed(字段缺失按「无该事实」,不抛异常);不新增事件类型。
 */
import type { JudgeRunResult } from './judge-call.ts'
import type { JudgeMetricDef } from './judge-metrics.ts'
import type { BusinessAnswerSpec, BusinessBudgetSpec, BusinessMetric, BusinessTrajectorySpec } from './business-metrics.ts'

/** 带确定性规则的业务指标(恰一种规则形态;校验器已保证). */
export type BusinessRuleMetric =
  | BusinessMetric & { readonly trajectory: BusinessTrajectorySpec }
  | BusinessMetric & { readonly answer: BusinessAnswerSpec }
  | BusinessMetric & { readonly budget: BusinessBudgetSpec }

/** 规则求值事实(纯投影,按事件流确定性推导). */
export interface BusinessRuleFacts {
  /** turn/start 去重轮数. */
  readonly turns: number
  /** 计费口径 token 总量(与 dsh-evals summarize 同式). */
  readonly totalTokens: number
  /** 审批问询(asked.toolName 必填;callId/turn 可缺席). */
  readonly approvalsAsked: readonly {
    readonly toolName: string
    readonly callId?: string
    readonly turn?: number
  }[]
  /** 整条会话最后一条非空助手文本. */
  readonly finalAnswerText: string
  /** 每轮最后一条非空助手文本(assistant/message.turn 或当前轮). */
  readonly finalAnswerByTurn: ReadonlyMap<number, string>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** assistant/message / user/message 的文本块拼接(双包裹层容忍,与 evals 同式). */
function messageTextOf(event: { readonly type: string; readonly data: unknown }): string | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'user/message') return undefined
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const message = asRecord(data.message)
  const content = (message === undefined ? undefined : message.content) ?? data.content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === undefined || record.type !== 'text' || typeof record.text !== 'string') continue
    parts.push(record.text)
  }
  return parts.join('')
}

/** assistant/message 的 usage → 计费 token 增量(dsh-evals summarize 同式). */
function billedTokensOf(data: unknown): number {
  const usage = asRecord(asRecord(data)?.usage)
  if (usage === undefined) return 0
  const total = asNumber(usage.totalTokens)
  if (total !== undefined) return total
  return (asNumber(usage.inputTokens) ?? 0)
    + (asNumber(usage.outputTokens) ?? 0)
    + (asNumber(usage.cacheReadTokens) ?? 0)
    + (asNumber(usage.cacheWriteTokens) ?? 0)
}

/**
 * 从会话事件流投影规则事实(纯函数;未知事件静默跳过).
 * @param events - 会话事件窗口(引擎从宿主读到的快照).
 * @returns 三类规则共用的事实视图.
 */
export function buildBusinessRuleFacts(events: readonly { readonly type: string; readonly data: unknown }[]): BusinessRuleFacts {
  const turns = new Set<number>()
  const callTurn = new Map<string, number>()
  const asked: { toolName: string; callId?: string }[] = []
  const finalAnswerByTurn = new Map<number, string>()
  let totalTokens = 0
  let finalAnswerText = ''
  let currentTurn: number | undefined
  for (const event of events) {
    const data = asRecord(event.data)
    switch (event.type) {
      case 'turn/start': {
        const turn = data === undefined ? undefined : asNumber(data.turn)
        if (turn !== undefined) {
          turns.add(turn)
          currentTurn = turn
        }
        break
      }
      case 'tool/call': {
        const callId = data === undefined ? undefined : asString(data.callId)
        const turn = data === undefined ? undefined : asNumber(data.turn)
        if (callId !== undefined && turn !== undefined) callTurn.set(callId, turn)
        break
      }
      case 'approval/asked': {
        const toolName = data === undefined ? undefined : asString(data.toolName)
        if (toolName === undefined) break
        const callId = data === undefined ? undefined : asString(data.callId)
        asked.push({ toolName, ...callId === undefined ? {} : { callId } })
        break
      }
      case 'assistant/message': {
        totalTokens += billedTokensOf(event.data)
        const text = messageTextOf(event)
        if (text === undefined || text.trim() === '') break
        finalAnswerText = text
        const turn = (data === undefined ? undefined : asNumber(data.turn)) ?? currentTurn
        if (turn !== undefined) finalAnswerByTurn.set(turn, text)
        break
      }
      default:
        break
    }
  }
  return {
    turns: turns.size,
    totalTokens,
    approvalsAsked: asked.map(ask => ({
      ...ask,
      ...ask.callId === undefined || callTurn.get(ask.callId) === undefined
        ? {}
        : { turn: callTurn.get(ask.callId) as number },
    })),
    finalAnswerText,
    finalAnswerByTurn,
  }
}

/** 规则结果(ok/not_applicable;不伪造分数). */
function resultOf(pass: boolean, rationale: string, status: 'ok' | 'not_applicable' = 'ok'): JudgeRunResult {
  return {
    status,
    value: status === 'ok' ? pass : null,
    rationale: rationale.length <= 200 ? rationale : `${rationale.slice(0, 199)}…`,
    latencyMs: 0,
  }
}

/** 作用域润色(单轮口径加轮次前缀). */
function scopeNote(scope: 'session' | 'turn', turn: number | undefined): string {
  return scope === 'session' ? '整条会话' : turn === undefined ? '单轮（缺轮次）' : `第 ${turn} 轮`
}

/**
 * 执行一条规则型业务指标。
 * @param metric - 规则指标(校验器已保证恰一种).
 * @param facts - 事件事实投影.
 * @param turn - 单轮口径的目标轮(scope=session 时忽略).
 * @returns ok(通过/未过)或 not_applicable(无对象可判).
 */
export function runBusinessRule(
  metric: BusinessRuleMetric,
  facts: BusinessRuleFacts,
  turn?: number,
): JudgeRunResult {
  if (metric.trajectory?.approvalFlow !== undefined) {
    const flow = metric.trajectory.approvalFlow
    const hits = facts.approvalsAsked.filter(ask =>
      ask.toolName === flow.tool && (metric.scope === 'session' || ask.turn === turn))
    const pass = hits.length >= flow.minCount
    return resultOf(
      pass,
      `审批问询 ${hits.length} 次（要求 ≥ ${flow.minCount}，工具 ${flow.tool}；${scopeNote(metric.scope, turn)}）`,
    )
  }
  if (metric.answer !== undefined) {
    const text = metric.scope === 'session'
      ? facts.finalAnswerText
      : turn === undefined ? undefined : facts.finalAnswerByTurn.get(turn)
    if (text === undefined || text === '') {
      return resultOf(false, `没有可判的助手回复（${scopeNote(metric.scope, turn)}）。`, 'not_applicable')
    }
    const found = metric.answer.notContains.filter(word => text.includes(word))
    return resultOf(
      found.length === 0,
      found.length === 0
        ? `禁语未出现（${scopeNote(metric.scope, turn)}）`
        : `禁语命中：${found.join('、')}（${scopeNote(metric.scope, turn)}）`,
    )
  }
  if (metric.budget !== undefined) {
    const budget = metric.budget
    const overTurns = facts.turns > budget.maxTurns
    const overTokens = facts.totalTokens > budget.maxTokens
    return resultOf(
      !overTurns && !overTokens,
      `实际 ${facts.turns} 轮 / ${facts.totalTokens} tokens（上限 ${budget.maxTurns} 轮 / ${budget.maxTokens} tokens）`,
    )
  }
  return resultOf(false, '规则型指标定义缺失可执行形态。', 'not_applicable')
}

/** 是否规则型业务指标(类型守卫;内置定义与 rubric 型都不命中). */
export function isBusinessRuleMetric(metric: BusinessMetric | JudgeMetricDef): metric is BusinessRuleMetric {
  return !('judge' in metric) && ('trajectory' in metric || 'answer' in metric || 'budget' in metric)
}
