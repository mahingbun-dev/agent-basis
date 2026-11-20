/**
 * 工具执行链:遮罩门 → tools/pre-execute waterfall(governance/ask 门)→
 * ask 决策走 ctx.approval → execute → output.render 投影 → tools/post-execute。
 * 失败不抛到 loop:规范化为 ToolResult(ok=false),turn 不中断。
 */
import type { Context } from '@core/cordis'
import type { ApprovalService, PreToolDecision, ToolResult } from '@core/contracts'
import { ToolRegistryImpl } from './registry.ts'
import type { ExecInput } from './registry.ts'

/** 工具门拒绝(规范化前的内部错误形态)。 */
export class ToolGateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolGateError'
  }
}

export function createToolExecutor(ctx: Context, registry: ToolRegistryImpl): { exec(input: ExecInput): Promise<ToolResult> } {
  return {
    async exec(input: ExecInput): Promise<ToolResult> {
      const callId = registry.newCallId()
      const definition = registry.list().find(candidate => candidate.name === input.name)
      const fail = (message: string, errorName = 'ToolError'): ToolResult => ({
        callId,
        name: input.name,
        ok: false,
        content: [{ type: 'text', text: message }],
        error: { name: errorName, message },
      })

      if (definition === undefined) return fail(`工具 ${input.name} 未注册`)
      if (registry.restricted(input.name)) return fail(`工具 ${input.name} 已被 restrict 遮罩`, 'ToolGateError')

      const signal = input.signal ?? (
        definition.timeoutMs !== undefined
          ? AbortSignal.timeout(definition.timeoutMs)
          : new AbortController().signal
      )
      const execPayload = {
        callId,
        name: input.name,
        arguments: input.args,
        signal,
        ...(input.turn !== undefined ? { turn: input.turn } : {}),
        ...(input.step !== undefined ? { step: input.step } : {}),
      }

      // 1) pre-execute waterfall:监听者可 deny/ask;无人管则内建放行
      const allow = (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' })
      const decision: PreToolDecision = await ctx.waterfall('tools/pre-execute', execPayload, allow)
      if (decision.kind === 'deny') return fail(`工具 ${input.name} 被拒绝:${decision.reason}`, 'ToolGateError')
      if (decision.kind === 'ask') {
        const approval: ApprovalService = ctx.approval
        const outcome = await approval.request({
          id: callId,
          tool: input.name,
          callId,
          args: input.args,
          reasons: decision.reason !== undefined ? [decision.reason] : [`[governance] ${input.name} 命中 ask 规则`],
          riskTier: input.riskTier ?? 'R2',
        })
        if (outcome !== 'allowed-once') return fail(`工具 ${input.name} 审批未通过:${outcome}`, 'ApprovalDenied')
      }

      // 2) execute
      try {
        const value = await definition.execute(input.args, { callId, name: input.name, signal })
        if (signal.aborted) return fail(`工具 ${input.name} 已取消`, 'Aborted')
        const content = definition.output.render(input.args, value)
        const result: ToolResult = { callId, name: input.name, ok: true, value, content }
        ctx.emit('tools/post-execute', execPayload, result)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const result: ToolResult = fail(message, error instanceof ToolGateError ? 'ToolGateError' : 'ToolExecutionError')
        ctx.emit('tools/post-execute', execPayload, result)
        return result
      }
    },
  }
}
