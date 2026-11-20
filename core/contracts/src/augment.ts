/**
 * cordis Context / Events 增强:六 seam 的服务名与事件名在此一次定型,
 * 全仓库消费方 `ctx.tools` / `ctx.on('tools/pre-execute', …)` 的类型面都来自本文件。
 *
 * 运行时由 v1 插件面 provide(名称即字符串键,cordis 只认 inject 声明的键):
 * - tools      ← @basis/tools
 * - llm        ← @basis/llm
 * - agents     ← @basis/agent-loop
 * - session    ← @basis/session
 * - systemPrompt ← @basis/system-prompt
 * - approval   ← @basis/approval-cli(或后续 Web 审批面)
 */
import type { AgentRegistry, StepDraft, TurnStoppingEvent } from './agents.ts'
import type { ApprovalOutcome, ApprovalRequest, ApprovalService } from './approval.ts'
import type { LlmRegistry } from './llm.ts'
import type { PromptRegistry } from './prompts.ts'
import type { SessionEvent, SessionStore } from './session.ts'
import type { PreToolDecision, ToolExecution, ToolRegistry, ToolResult } from './tools.ts'

declare module '@core/cordis' {
  interface Context {
    /** 工具注册表(@basis/tools)。 */
    tools: ToolRegistry
    /** LLM 路由(@basis/llm)。 */
    llm: LlmRegistry
    /** agent 注册表(@basis/agent-loop)。 */
    agents: AgentRegistry
    /** 会话事件流(@basis/session)。 */
    session: SessionStore
    /** system prompt 组装(@basis/system-prompt)。 */
    systemPrompt: PromptRegistry
    /** 人工审批(@basis/approval-cli 及后续替代实现)。 */
    approval: ApprovalService
  }

  interface Events {
    /** 工具执行前 waterfall:改写/拒绝(governance 规则引擎、ask 门注册点)。 */
    'tools/pre-execute'(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
    /** 工具执行后 emit:规范化结果观测点。 */
    'tools/post-execute'(exec: ToolExecution, result: ToolResult): void
    /** step 准备 waterfall:可改写 messages/tools 或拒绝本 step。 */
    'agent/pre-step'(draft: StepDraft, next: () => Promise<StepDraft>): Promise<StepDraft>
    /** turn 终止检查点(串行):守卫插件可经 agent.cancel 终止。 */
    'agent/turn-stopping'(event: TurnStoppingEvent): Promise<void> | void
    /** 审批留痕:问题已提出(随后必有 decided)。 */
    'approval/asked'(request: ApprovalRequest): void
    /** 审批留痕:结论已定。 */
    'approval/decided'(request: ApprovalRequest, outcome: ApprovalOutcome): void
    /** 会话事件已落 store(observe/评测采集点)。 */
    'session/event'(event: SessionEvent): void
  }
}

export {}
