/**
 * 会话上下文清空事务：经官方 surface replace seam（压缩同款）把当前 live
 * surface（保留系统头 node 0）整段替换为一条最小 checkpoint 消息——下一轮
 * prompt 不再携带旧历史，会话 id 不变，原始 append-only 日志不动（界面历史
 * 仍可回看）。与 /compact 的差别：不做摘要、无异步间隙，整个事务在
 * `agent.runMaintenance()` 空闲闸内同步完成。
 *
 * 事件词汇约束（2026-11-23 勘察结论）：v4 持久化恢复对未知非 ignorable 事件
 * 类型直接拒载（session-format-v3-to-v4 validation.ts:59-63），且
 * `session.append` 无法携带 ignorable 信封——因此本事务**不新增事件类型**：
 * 审计与元数据全部落在 checkpoint 消息的 `source`（merge-extensible
 * MessageSourceMap，消费者对未知 kind 回落；compaction 'compact-checkpoint'
 * 先例）里，宿主命令分发器自动落 command/run + command/done 生命周期事件。
 *
 * @module @eterna/compaction/clear
 */

import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assertNoActiveCompaction, inspectCompactionEntryState, systemHead } from '../basic/region.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * 上下文清空 checkpoint 的生产者标记。载荷即清空审计：被遮蔽的 surface
     * 节点 seq、按启发式口径的释放价（与 /compact 的 shadowedTokenCount 同
     * 口径）与触发命令身份。
     */
    'eterna-clear-checkpoint': {
      kind: 'eterna-clear-checkpoint'
      clearedAt: string
      clearedSeqs: readonly number[]
      clearedTokenCount: number
      sourceCommandId?: CommandId
    }
  }
}

/** 闭合失败码：命令层逐一映射人类可读中文诊断。 */
export type ContextClearErrorCode = 'busy' | 'cancelled' | 'unbalanced' | 'persistence'

/** 清空的预期失败（闲闸/取消/边界不整/落盘），区别于未知内部错误（原样上抛）。 */
export class ContextClearError extends Error {
  readonly code: ContextClearErrorCode

  constructor(code: ContextClearErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ContextClearError'
    this.code = code
  }
}

/** 清空依赖面：会话计价器（单一 fold 来源）与成功后的落盘检查点。 */
export interface ClearDeps {
  readonly meter: TokenMeter
  flush(session: Session): Promise<void>
}

/** 成功清空的结果：checkpoint 事件 seq（命令结果展示锚点）+ 审计计数。 */
export interface ClearResult {
  readonly checkpointSeq: SessionSeq
  readonly clearedCount: number
  readonly clearedTokenCount: number
}

/** checkpoint 正文：同时是下一轮模型能读到的唯一历史说明。 */
export const CLEAR_CHECKPOINT_TEXT
  = '（上下文已清空：此前的对话内容已从当前上下文移除。如需引用之前的信息，请重新提供。）'

/**
 * 同步清空事务（调用方须已保证 agent 空闲）：校验压缩锁与开 turn、按系统头
 * 定首切点、tool 配对边界校验、计价，然后单条 user/message replace 落盘。
 * 无可清空（空 surface / 仅系统头）返回 null 且零事件追加。
 */
function clearSurface(deps: ClearDeps, session: Session, sourceCommandId?: CommandId): ClearResult | null {
  assertNoActiveCompaction(session, 'context clear')
  if (inspectCompactionEntryState(session).openTurn !== null) {
    throw new ContextClearError('busy', 'context clear: the session already has an open turn')
  }
  const nodes = session.surface.nodes
  const headSeq = nodes.length > 0 ? nodes[0] : undefined
  const firstIdx = headSeq !== undefined && systemHead(session, headSeq) !== undefined ? 1 : 0
  if (nodes.length <= firstIdx) return null
  const startSeq = nodes[firstIdx]
  const endSeq = nodes[nodes.length - 1]
  if (startSeq === undefined || endSeq === undefined) return null
  if (!toolPairingBalancedBefore(session, startSeq) || !toolPairingBalancedAfter(session, endSeq)) {
    throw new ContextClearError(
      'unbalanced',
      'context clear: the surface boundaries would split an open step',
    )
  }
  const measurement = deps.meter.measure(session)
  if (measurement.nodes.length !== nodes.length
    || measurement.nodes.some((node, index) => node.seq !== nodes[index])) {
    throw new Error('context clear: token-meter surface does not match the current session surface')
  }
  const shadowedSeqs = nodes.slice(firstIdx)
  // 汇报口径与 /compact 的 shadowedTokenCount 一致：固定启发式价求和。
  const clearedTokenCount = measurement.nodes
    .slice(firstIdx)
    .reduce((total, node) => total + node.heuristicTokens, 0)
  const clearedAt = new Date().toISOString()
  const checkpointMessage = createUserMessage({
    content: [{ type: 'text', text: CLEAR_CHECKPOINT_TEXT }],
    source: {
      kind: 'eterna-clear-checkpoint',
      clearedAt,
      clearedSeqs: [...shadowedSeqs],
      clearedTokenCount,
      ...sourceCommandId === undefined ? {} : { sourceCommandId },
    },
  })
  const checkpointEvent = session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: [...shadowedSeqs],
  })
  return {
    checkpointSeq: checkpointEvent.seq,
    clearedCount: shadowedSeqs.length,
    clearedTokenCount,
  }
}

/**
 * 清空一个 agent 会话的上下文。`agent.runMaintenance()` 空闲闸（照
 * compactNow）：会话处理中 / 压缩进行中 / 边界不整 / 落盘失败分别落闭合码。
 * @param deps - 会话计价器与落盘检查点（`ctx.sessions.flush`）。
 * @param agent - 目标会话的 agent（其 session 的 surface 被整段替换）。
 * @param signal - 发起方取消信号（维护期内生效）。
 * @param sourceCommandId - 发起命令身份（/clear 命令分发器分配）。
 * @returns 成功清空结果；无可清空历史时为 null。
 */
export async function clearSessionContext(
  deps: ClearDeps,
  agent: Agent,
  signal: AbortSignal,
  sourceCommandId?: CommandId,
): Promise<ClearResult | null> {
  signal.throwIfAborted()
  try {
    return await agent.runMaintenance(async (agentSignal) => {
      const operationSignal = AbortSignal.any([agentSignal, signal])
      try {
        operationSignal.throwIfAborted()
        const cleared = clearSurface(deps, agent.session, sourceCommandId)
        if (cleared === null) return null
        try {
          await deps.flush(agent.session)
        } catch (cause: unknown) {
          throw new ContextClearError(
            'persistence',
            'context clear: durability checkpoint failed',
            { cause },
          )
        }
        operationSignal.throwIfAborted()
        return cleared
      } catch (error: unknown) {
        if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
          throw new ContextClearError('cancelled', 'context clear was cancelled', { cause: error })
        }
        throw error
      }
    })
  } catch (error: unknown) {
    if (error instanceof ContextClearError) throw error
    if (signal.aborted) {
      throw new ContextClearError('cancelled', 'context clear was cancelled', { cause: error })
    }
    throw new ContextClearError(
      'busy',
      'context clear requires an idle agent with no waking queued work',
      { cause: error },
    )
  }
}
