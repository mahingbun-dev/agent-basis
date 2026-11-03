/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1,与 @basis/governance types.seam-pin 同款纪律):
 * DSH pre-stable,本包的三个适配面要在 verify 的 tsc 阶段钉死——
 * ① egress 包装器包装的 ToolDefinition / 输出契约(ToolOutputDefinition.render
 *    返回 ContentBlock[])与已发布 0.2.2-alpha.2 类型双向兼容;
 * ② reviewer 工具门 → ctx.tools.restrict(ToolRestriction) 原生 disposer;
 * ③ reviewer persona 行配置 = @deepseek-ai/dsh-persona Config 形态;
 * ④ subagent 独立 preset 选项(SubagentStartRequest.agentPreset,spawn 专属);
 * ⑤ tenant realm 承载面 = cordis Context.isolate(name, label)。
 *
 * 依据(dsh-repo,只读):
 * - packages/core/tools/src/contracts.ts:23-58(ToolDefinition/execute/render)、376-381(ToolRestriction)
 * - packages/core/tools/README.md「Restrict tools per agent」(restrict 需 agent 作用域)
 * - packages/preset/persona/src/index.ts(Config: prefix/suffix/complete/includeRuntimeContext)
 * - packages/subagent/subagent/src/types.ts:127-135(SubagentStartRequest.agentPreset)
 * - packages/preset/agent-preset-registry/src/mount.ts:213(realm 纪律先例)
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, TextBlock } from '@deepseek-ai/dsh-llm'
import type { Config as PersonaConfig } from '@deepseek-ai/dsh-persona'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolOutputDefinition, ToolRestriction, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { EgressLite } from '@basis/governance'
import { buildReviewerPreset } from '../src/reviewer-preset.ts'
import { EgressToolWrapper } from '../src/egress-wrapper.ts'
import type { ToolLevelEgress } from '../src/egress-wrapper.ts'
import type { ToolGateHost } from '../src/reviewer-preset.ts'

declare const liveCtx: Context
declare const liveExec: ToolRunContext
declare const liveOutboundTool: ToolDefinition

/** 钉住 ①:包装器产物仍是合法 ToolDefinition(execute/output 契约不漂移)。 */
export function pinWrappedToolIsRegisterable(wrapper: EgressToolWrapper): ToolDefinition {
  return wrapper.wrap(liveOutboundTool)
}

/** 钉住 ①b:包装后的 execute 可直接进 dsh 执行面(args: unknown, exec: ToolRunContext)。 */
export async function pinWrappedExecute(wrapper: EgressToolWrapper, args: unknown): Promise<unknown> {
  return wrapper.wrap(liveOutboundTool).execute(args, liveExec)
}

/** 钉住 ①c:输出契约 render 返回 ContentBlock[](TextBlock 是其合法成员)。 */
export function pinRenderReturnsContentBlocks(output: ToolOutputDefinition, value: Parameters<ToolOutputDefinition['render']>[1]): ContentBlock[] {
  const blocks = output.render({}, value)
  const text: TextBlock = { type: 'text', text: 'x' }
  return [...blocks, text]
}

/** 钉住 ②:工具门宿主面 = ctx.tools.restrict 结构面;filter 是官方 ToolRestriction。 */
export const pinToolGateHost: ToolGateHost = {
  restrict(filter: ToolRestriction) {
    return liveCtx.tools.restrict(filter)
  },
}

/** 钉住 ③:产物 persona 行 config 满足 @deepseek-ai/dsh-persona 官方 Config。 */
export const pinPersonaConfig: PersonaConfig = buildReviewerPreset().persona.config

/** 钉住 ④:subagent 委派行携带的 agentPreset 是官方 SubagentStartRequest 的可选字段。 */
export function pinSubagentAgentPreset(request: SubagentStartRequest): string | undefined {
  return request.agentPreset
}

/** 钉住 ⑤:tenant realm 的 label 可直接喂 cordis ctx.isolate(name, label)。 */
export function pinTenantRealmIsolate(name: string, label: symbol): Context {
  return liveCtx.isolate(name, label)
}

/** 钉住 ⑥:governance EgressLite 满足本包 ToolLevelEgress 注入面(结构子集,可交换)。 */
export const pinEgressLiteSatisfiesToolLevel: ToolLevelEgress = new EgressLite({
  proxyUrl: 'http://127.0.0.1:7890',
  allowedOutboundTools: ['web_fetch'],
})
