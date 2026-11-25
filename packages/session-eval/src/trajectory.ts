/**
 * 轨迹投影:一段 session 事件流 → {@link Trajectory}(纯函数,零副作用)。
 *
 * 设计纪律(56 号 §5.2/§5.4):
 * - **不新增事件类型、不读会话日志**;输入就是宿主 `session.snapshotEvents()` 的
 *   现成数组,冷会话由上层决定是否可评(本函数只做投影)。
 * - **未知事件静默跳过**:dsh 事件集 66+ 且随版本扩张;按 type 白名单消费,
 *   其余一律忽略(observe metrics.ts 同款前向兼容口径)。
 * - **失败口径按 callId 判**:被拒/失败的调用仍会先记 `tool/call`,再记带
 *   `message.isError` 或兄弟字段 `error` 的 `tool/result`(tools/evals/src/events.ts:210)。
 * - **工具面清单来自 `request/header.header.tools`**(每步权威装配面);清单缺席
 *   时 `knownTool` 为 undefined(不判非法工具,不伪报)。
 *
 * 口径依据:TokenUsage 四桶互斥(input 只含未缓存输入;reasoning 已含在 output)
 * 与 observe TokenBuckets 同源同式 —— 缓存命中率 = cacheRead / (input+cacheRead+cacheWrite)。
 */
import type {
  ApprovalSummary,
  SessionEventLike,
  ToolCallRecord,
  Trajectory,
  TurnRecord,
  UsageBuckets,
} from './types.ts'

/** 事件 data 是 JSON 对象时才可读字段(非对象一律当缺席)。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 非负有限数才计入桶(上游 usage 字段可能缺席). */
function count(value: unknown): number {
  const number = asNumber(value)
  return number === undefined || number < 0 ? 0 : number
}

/** 一轮的可变累积态(投影结束再冻结成 TurnRecord). */
interface MutableTurn {
  turn: number
  steps: number
  toolCalls: number
  failedCalls: number
  endReason?: string
  startTime?: number
  durationMs: number | null
}

/** 一次审批请求的可变态(配对 decided 用 id). */
interface MutableApproval {
  readonly id: string
  readonly callId?: string
  readonly toolName?: string
  decidedOutcome?: string
}

/**
 * 投影一段会话事件流。
 * @param sessionId - 会话 id(只回填到产物,不参与判定)。
 * @param events - 有序事件数组(取宿主快照;seq 交叉时以数组序为准)。
 * @returns 轨迹投影(全部字段由事件确定性推导;无事件时为空轨迹)。
 */
export function projectTrajectory(sessionId: string, events: readonly SessionEventLike[]): Trajectory {
  const turns = new Map<number, MutableTurn>()
  const calls: { record: MutableCall }[] = []
  const callsById = new Map<string, MutableCall>()
  const approvals = new Map<string, MutableApproval>()
  const toolNames = new Set<string>()
  const buckets = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  let modelCalls = 0
  let cacheReported = 0
  let route: { provider: string; model: string } | null = null
  let firstSeq: number | undefined
  let lastSeq: number | undefined
  let firstTime: number | undefined
  let lastTime: number | undefined

  const turnOf = (turn: number): MutableTurn => {
    const current = turns.get(turn)
    if (current !== undefined) return current
    const created: MutableTurn = { turn, steps: 0, toolCalls: 0, failedCalls: 0, durationMs: null }
    turns.set(turn, created)
    return created
  }

  for (const event of events) {
    if (event.seq !== undefined) {
      firstSeq ??= event.seq
      lastSeq = event.seq
    }
    if (event.time !== undefined) {
      firstTime ??= event.time
      lastTime = event.time
    }
    const data = asRecord(event.data)
    if (data === undefined) continue

    switch (event.type) {
      case 'turn/start': {
        const turn = asNumber(data.turn)
        if (turn === undefined) break
        const current = turnOf(turn)
        if (current.startTime === undefined && event.time !== undefined) current.startTime = event.time
        break
      }
      case 'turn/end': {
        const turn = asNumber(data.turn)
        if (turn === undefined) break
        const current = turnOf(turn)
        const reason = asRecord(data.reason)
        current.endReason = asString(reason?.kind) ?? 'unknown'
        if (current.startTime !== undefined && event.time !== undefined) {
          current.durationMs = Math.max(0, event.time - current.startTime)
        }
        break
      }
      case 'step/start': {
        const turn = asNumber(data.turn)
        if (turn === undefined) break
        turnOf(turn).steps += 1
        break
      }
      case 'assistant/message': {
        const usageData = asRecord(data.usage)
        if (usageData === undefined) break
        const input = count(usageData.inputTokens)
        const output = count(usageData.outputTokens)
        const cacheRead = count(usageData.cacheReadTokens)
        const cacheWrite = count(usageData.cacheWriteTokens)
        modelCalls += 1
        if (usageData.cacheReadTokens !== undefined || usageData.cacheWriteTokens !== undefined) cacheReported += 1
        buckets.input += input
        buckets.output += output
        buckets.cacheRead += cacheRead
        buckets.cacheWrite += cacheWrite
        buckets.reasoning += count(usageData.reasoningTokens)
        break
      }
      case 'tool/call': {
        const turn = asNumber(data.turn)
        const step = asNumber(data.step)
        const callId = asString(data.callId)
        const name = asString(data.name)
        if (turn === undefined || step === undefined || callId === undefined || name === undefined) break
        const rawArguments = typeof data.arguments === 'string' ? data.arguments : ''
        const record: MutableCall = {
          turn, step, callId, name, arguments: rawArguments,
          argsValid: argsValid(rawArguments),
          failed: false,
        }
        calls.push({ record })
        callsById.set(callId, record)
        turnOf(turn).toolCalls += 1
        break
      }
      case 'tool/result': {
        const message = asRecord(data.message)
        const callId = asString(message?.toolCallId)
        if (callId === undefined) break
        const call = callsById.get(callId)
        const failed = message?.isError === true || data.error !== undefined
        if (call === undefined) break
        // 幂等:同一 callId 的第二条 result 不重复计失败(上游不会发,但投影不假设)。
        const becameFailed = failed && !call.failed
        call.failed = failed
        const error = asRecord(data.error)
        const code = asString(error?.code) ?? asString(error?.name)
        if (failed && code !== undefined) call.errorCode = code
        if (becameFailed) turnOf(call.turn).failedCalls += 1
        break
      }
      case 'request/header': {
        const header = asRecord(data.header)
        const config = asRecord(header?.config)
        route = readRoute(config) ?? route
        for (const schema of asArray(header?.tools)) {
          const name = asString(asRecord(schema)?.name)
          if (name !== undefined) toolNames.add(name)
        }
        break
      }
      case 'request/context': {
        route = readRoute(data) ?? route
        break
      }
      case 'approval/asked': {
        const id = asString(data.id)
        if (id === undefined) break
        approvals.set(id, {
          id,
          ...asString(data.callId) === undefined ? {} : { callId: asString(data.callId) as string },
          ...asString(data.toolName) === undefined ? {} : { toolName: asString(data.toolName) as string },
        })
        break
      }
      case 'approval/decided': {
        const id = asString(data.id)
        const outcome = asString(data.outcome)
        if (id === undefined || outcome === undefined) break
        const approval = approvals.get(id) ?? { id }
        approval.decidedOutcome = outcome
        approvals.set(id, approval)
        break
      }
      default:
        // 未知/不消费的事件类型:静默跳过(前向兼容)。
        break
    }
  }

  // 第二遍:工具面清单与重复调用(清单可能出现在调用之后——不假设事件顺序)。
  const known = toolNames.size > 0 ? toolNames : undefined
  const repeatSeen = new Map<string, { turn: number; step: number }>()
  const frozenCalls: ToolCallRecord[] = []
  let repeatCount = 0
  for (const { record } of calls) {
    const key = `${record.name}\u0000${record.arguments.trim()}`
    const previous = repeatSeen.get(key)
    const repeatOf = previous === undefined ? undefined : previous
    if (previous === undefined) repeatSeen.set(key, { turn: record.turn, step: record.step })
    else repeatCount += 1
    frozenCalls.push({
      turn: record.turn,
      step: record.step,
      callId: record.callId,
      name: record.name,
      arguments: record.arguments,
      argsValid: record.argsValid,
      failed: record.failed,
      ...record.errorCode === undefined ? {} : { errorCode: record.errorCode },
      ...known === undefined ? {} : { knownTool: known.has(record.name) },
      ...repeatOf === undefined ? {} : { repeatOf },
    })
  }

  const usage: UsageBuckets = {
    input: buckets.input,
    output: buckets.output,
    cacheRead: buckets.cacheRead,
    cacheWrite: buckets.cacheWrite,
    reasoning: buckets.reasoning,
    billed: buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output,
  }
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite
  const frozenTurns: TurnRecord[] = [...turns.values()]
    .sort((left, right) => left.turn - right.turn)
    .map(turn => ({
      turn: turn.turn,
      steps: turn.steps,
      toolCalls: turn.toolCalls,
      failedCalls: turn.failedCalls,
      ...turn.endReason === undefined ? {} : { endReason: turn.endReason },
      durationMs: turn.durationMs,
    }))

  return {
    sessionId,
    window: {
      events: events.length,
      ...firstSeq === undefined ? {} : { firstSeq },
      ...lastSeq === undefined ? {} : { lastSeq },
      ...firstTime === undefined ? {} : { firstTime },
      ...lastTime === undefined ? {} : { lastTime },
    },
    turns: frozenTurns,
    calls: frozenCalls,
    approvals: freezeApprovals(approvals),
    usage,
    modelCalls,
    cacheHitRate: cacheReported > 0 && promptTokens > 0 ? usage.cacheRead / promptTokens : null,
    knownTools: [...toolNames],
    route,
  }
}

/** 内部可变调用记录(投影结束冻结为 ToolCallRecord). */
interface MutableCall {
  turn: number
  step: number
  callId: string
  name: string
  arguments: string
  argsValid: boolean
  failed: boolean
  errorCode?: string
}

/** 参数 JSON 可解析即合法(空串/非对象记不合法;数组与标量不算合法参数对象)。 */
function argsValid(raw: string): boolean {
  const text = raw.trim()
  if (text === '') return false
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function readRoute(value: Record<string, unknown> | undefined): { provider: string; model: string } | null {
  const provider = asString(value?.provider)
  const model = asString(value?.model)
  return provider === undefined || model === undefined ? null : { provider, model }
}

/** 桶累加已由局部计数器完成(见 projectTrajectory 末尾冻结段). */

/** 审批态冻结(被拒 = 结局不是 allowed-once;未决不计入 denied)。 */
function freezeApprovals(approvals: Map<string, MutableApproval>): ApprovalSummary {
  let decided = 0
  let denied = 0
  const deniedCallIds: string[] = []
  const deniedToolNames: string[] = []
  for (const approval of approvals.values()) {
    if (approval.decidedOutcome === undefined) continue
    decided += 1
    if (approval.decidedOutcome === 'allowed-once') continue
    denied += 1
    if (approval.callId !== undefined) deniedCallIds.push(approval.callId)
    if (approval.toolName !== undefined) deniedToolNames.push(approval.toolName)
  }
  return { asked: approvals.size, decided, denied, deniedCallIds, deniedToolNames }
}
