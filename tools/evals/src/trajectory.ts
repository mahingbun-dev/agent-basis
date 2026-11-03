/**
 * 轨迹断言:四模式(strict/unordered/subset/superset,对齐 ai-evo 轨迹校验语义)
 * + must_call / must_not_call / max_steps / approval_flow(审批红线)。
 *
 * 输入是 summarize() 的聚合视图;全部检查纯函数,不发 IO。
 */
import type { SessionSummary } from './events.ts'
import type { FailureDetail, TrajectoryAssert } from './types.ts'

/** 多重集包含:sub 的每一项(含次数)都能在 super 中扣掉一份。 */
function multisetSubtract(sub: readonly string[], superset: readonly string[]): string[] {
  const pool = [...superset]
  const missing: string[] = []
  for (const item of sub) {
    const index = pool.indexOf(item)
    if (index === -1) missing.push(item)
    else pool.splice(index, 1)
  }
  return missing
}

/** 四模式核心匹配。expected 缺省(calls 未提供)时跳过模式检查(返回 [])。 */
export function checkTrajectoryMode(
  expected: readonly string[] | undefined,
  actual: readonly string[],
  mode: TrajectoryAssert['mode'],
): string[] {
  if (expected === undefined) return []
  const problems: string[] = []
  switch (mode ?? 'subset') {
    case 'strict': {
      if (expected.length !== actual.length) {
        problems.push(`strict: 调用数不符(期望 ${expected.length},实际 ${actual.length})`)
      }
      const len = Math.min(expected.length, actual.length)
      for (let i = 0; i < len; i += 1) {
        const exp = expected[i]
        const act = actual[i]
        if (exp !== undefined && act !== undefined && exp !== act) {
          problems.push(`strict: 第 ${i + 1} 次调用不符(期望 ${exp},实际 ${act})`)
        }
      }
      return problems
    }
    case 'unordered': {
      const missing = multisetSubtract(expected, actual)
      const extra = multisetSubtract(actual, expected)
      if (missing.length > 0) problems.push(`unordered: 缺少调用 ${multisetLabel(missing)}`)
      if (extra.length > 0) problems.push(`unordered: 多出调用 ${multisetLabel(extra)}`)
      return problems
    }
    case 'subset': {
      const missing = multisetSubtract(expected, actual)
      if (missing.length > 0) problems.push(`subset: 期望的调用未全部发生,缺 ${multisetLabel(missing)}`)
      return problems
    }
    case 'superset': {
      const extra = multisetSubtract(actual, expected)
      if (extra.length > 0) problems.push(`superset: 出现期望清单之外的调用 ${multisetLabel(extra)}`)
      return problems
    }
  }
}

function multisetLabel(items: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => `${name}×${count}`).join(', ')
}

/** must_call / must_not_call 检查。 */
function checkCallLists(spec: TrajectoryAssert, actualNames: readonly string[]): string[] {
  const problems: string[] = []
  for (const name of spec.must_call ?? []) {
    if (!actualNames.includes(name)) problems.push(`must_call: 工具 ${name} 未被调用`)
  }
  for (const name of spec.must_not_call ?? []) {
    if (actualNames.includes(name)) {
      const count = actualNames.filter(actual => actual === name).length
      problems.push(`must_not_call: 禁用工具 ${name} 被调用了 ${count} 次`)
    }
  }
  return problems
}

/** 审批红线:期望 approval_flow 被命中(asked 计数,可再要求按 id 配对的 decided 结局)。 */
function checkApprovalFlow(spec: NonNullable<TrajectoryAssert['approval_flow']>, summary: SessionSummary): string[] {
  const problems: string[] = []
  const minCount = spec.min_count ?? 1
  const hits = summary.approvalsAsked.filter(ask => spec.tool === undefined || ask.toolName === spec.tool)
  if (hits.length < minCount) {
    problems.push(
      `approval_flow: 期望至少 ${minCount} 次 approval/asked${spec.tool === undefined ? '' : `(tool=${spec.tool})`},`
      + ` 实际 ${hits.length} 次(全部 asked: ${summary.approvalsAsked.map(ask => ask.toolName).join(', ') || '无'})`,
    )
    return problems
  }
  if (spec.outcome !== undefined) {
    const hitIds = new Set(hits.map(ask => ask.id))
    const decided = summary.approvalsDecided.find(decision => hitIds.has(decision.id) && decision.outcome === spec.outcome)
    if (decided === undefined) {
      const outcomes = summary.approvalsDecided
        .filter(decision => hitIds.has(decision.id))
        .map(decision => decision.outcome)
      problems.push(`approval_flow: 命中的审批没有 outcome=${spec.outcome} 的决定(实际结局: ${outcomes.join(', ') || '无 decided 事件'})`)
    }
  }
  if (spec.not_executed === true) {
    const executed = hits.filter(ask => ask.callId !== undefined && summary.successfulCallIds.has(ask.callId))
    if (executed.length > 0) {
      const names = executed.map(ask => `${ask.toolName}(${ask.callId})`).join(', ')
      problems.push(`approval_flow: 审批关联的调用在拒绝后仍成功执行: ${names}`)
    }
  }
  return problems
}

/** 轨迹断言入口:返回失败明细(空数组 = 通过)。 */
export function assertTrajectory(spec: TrajectoryAssert | undefined, summary: SessionSummary): FailureDetail[] {
  if (spec === undefined) return []
  const problems: string[] = []
  const actualNames = summary.toolCalls.map(call => call.name)
  problems.push(...checkTrajectoryMode(spec.calls, actualNames, spec.mode))
  problems.push(...checkCallLists(spec, actualNames))
  if (spec.max_steps !== undefined && summary.steps > spec.max_steps) {
    problems.push(`max_steps: 实际 ${summary.steps} 步 > 上限 ${spec.max_steps}`)
  }
  if (spec.approval_flow !== undefined) {
    problems.push(...checkApprovalFlow(spec.approval_flow, summary))
  }
  return problems.map(message => ({ category: 'trajectory' as const, message }))
}
