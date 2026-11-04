/**
 * DSH seam 的本地最小形态(结构兼容层)。
 *
 * 来源与依据(../dsh-repo,0.2.2-alpha.2,只读):
 * - tools/pre-execute waterfall:packages/core/tools/src/events.ts:18
 *   `(exec: ToolExecution, next) => Promise<PreToolDecision>`,其中 ToolExecution 暴露
 *   `name: string` / `arguments: unknown`(packages/core/tools/src/contracts.ts:180-219)。
 * - agent/turn-stopping:packages/core/agent/src/runtime-types.ts:417
 *   `(payload: { agent, turn, signal }) => Promise<void> | void`;live Agent 具备
 *   `cancel(cause: AgentCancelCause, options?)`(runtime-types.ts:206-208),hook 取值
 *   `{ kind: 'hook', reason }`(packages/core/session/src/types.ts:194-198)。
 * - session 事件包:packages/core/session/src/types.ts:504-518
 *   `{ type, seq, time, data }`;data 形态见 SessionEventMap(types.ts:287-436)。
 *
 * 本文件只声明治理代码实际消费的字段(比官方类型更窄),由 tests/types.seam-pin.ts
 * 在编译期断言官方类型可赋值进来 —— DSH 升级破坏 seam 时 tsc --noEmit 即失败。
 */

/**
 * tools/pre-execute 的调用形态(结构兼容 dsh `ToolExecution`)。
 * 官方类型额外字段(token/signal/agent 等)对本包透明。
 */
export interface ToolCallLike {
  readonly name: string
  readonly arguments?: unknown
}

/**
 * dsh `PreToolDecision` 的结构子集(packages/core/tools/src/contracts.ts:357-363)。
 * 治理只产生 allow/deny/ask;cancel 由其他 pre-execute 监听者专用。
 */
export type GovernancePreDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'ask'; readonly reason?: string }

/** agent/turn-stopping 载荷里,预算守卫实际调用的 agent 能面(方法双变下与 live Agent 兼容)。 */
export interface TurnStoppingAgentLike {
  readonly id: string
  /** dsh `Agent.cancel(cause: AgentCancelCause, options?: CancelOptions)` 的窄化。 */
  cancel(cause: TurnCancelCause, options?: { readonly keepInbox?: boolean }): void
}

/** dsh `AgentCancelCause` 的 hook 分支(session/src/types.ts:197)。 */
export interface TurnCancelCause {
  readonly kind: 'hook'
  readonly reason: string
}

/** dsh `agent/turn-stopping` 事件载荷的最小形态(runtime-types.ts:417)。 */
export interface TurnStoppingEvent {
  readonly agent: TurnStoppingAgentLike
  readonly turn: number
  readonly signal: AbortSignal
}

/** 可直接注册为 dsh `agent/turn-stopping` 监听器的处理器形态。 */
export type TurnStoppingHandler = (event: TurnStoppingEvent) => void | Promise<void>

/**
 * session 事件流的最小事件包形态(结构兼容 dsh `SessionEvent`,types.ts:504)。
 * 审计投影与预算记账只消费 type/data/(seq/time 可选)。
 */
export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
  readonly seq?: number
  readonly time?: number
}

/** 任意嵌套 JSON 值的稳定串化(键排序),供参数子串匹配与审计预览。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      record[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return record
  }
  return value
}
