/**
 * Human-facing `/clear` command over the context-clear transaction
 * (`./clear.ts`)。与 `/compact` 同构：宿主命令分发器自带 command/run +
 * command/done 生命周期留痕，命令层只做参数校验、事务调用与中文诊断映射。
 * @module @eterna/compaction/clear/command
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { clearSessionContext, ContextClearError } from './clear.ts'

export const name = 'command-clear'
export const inject = ['commands', 'tokenMeter', 'sessions']

const USAGE = 'Usage: /clear (no arguments)'

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown context clear error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
export function expectedClearFailure(error: ContextClearError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: '会话正在处理消息，或存在未完成的压缩，暂时无法清空，请稍后再试。',
      }
    case 'cancelled':
      return { kind: 'error', text: '已取消清空。' }
    case 'unbalanced':
      return {
        kind: 'error',
        text: '清空失败：会话存在未闭合的步骤边界，暂无法整段替换。',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: '上下文已清空，但会话落盘失败，请检查宿主日志。',
      }
    /* v8 ignore next 2 -- ContextClearErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/** Execute one argument-free context clear request. */
async function executeClear(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  try {
    const result = await clearSessionContext(
      { meter: ctx.tokenMeter, flush: async (session) => { await ctx.sessions.flush(session) } },
      invocation.agent,
      invocation.signal,
      invocation.commandId,
    )
    if (result === null) return { kind: 'success', text: '当前会话没有可清空的历史。' }
    return {
      kind: 'success',
      text: `已清空 ${result.clearedCount} 条历史消息（约释放 ${result.clearedTokenCount} tokens），下一轮起不再携带。`,
      sourceEventSeq: result.checkpointSeq,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: '已取消清空。' }
    if (error instanceof ContextClearError) return expectedClearFailure(error)
    throw error
  }
}

/**
 * Register `/clear` for every composed human-command adapter.
 * @param ctx - context carrying the command registry, token meter, and sessions.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeClear(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      // 命令身份用本包入口(与 profile 挂载行一致，循 command-compact 约定)。
      definitionId: CommandDefinitionId('@eterna/compaction/clear-plugin'),
      name: 'clear',
      description: '清空当前会话上下文（界面历史保留，下一轮起模型不再携带）',
      handler,
    })
  }, 'command-clear lifecycle')
}
