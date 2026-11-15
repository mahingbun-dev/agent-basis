/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1):DSH 处于 pre-stable,所有 L1 插件的适配面要在
 * CI 里用接口冒烟钉住。本文件用**已发布的 @deepseek-ai/dsh-*(与 deepseek-harness
 * 同为 0.2.2-alpha.2)类型**断言:记忆包的工具/注入接口与官方 seam 双向兼容——
 * DSH 升级破坏 seam 形态时,`pnpm --filter @eterna/memory run verify` 的 tsc 阶段即失败。
 *
 * 依据(deepseek-harness,只读):
 * - packages/core/tools/src/index.ts:ToolsService.register(definition, options?)
 *   → the exact disposer that unregisters the tool;
 * - packages/core/system-prompt/src/index.ts:SystemPrompt.section(section)
 *   → the exact Cordis effect disposer;
 * - packages/governance(T1)src/pii.ts:PiiFilter.assertClean(value, label?)
 *   —— memory 的 PiiGuard 结构子集,可直接注入(provide 可交换)。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { PiiFilter } from '@eterna/governance'
import { attachMemory, defineMemoryTools, dshHost, resolveCuratorRoute, runExtractionCall } from '../src/index.ts'
import type { Memory, MemoryHost, PiiGuard } from '../src/index.ts'

declare const liveCtx: Context
declare const liveMemory: Memory
declare const livePiiFilter: PiiFilter

/**
 * 钉住 ①:defineMemoryTools 产出的 ToolDefinition 可直接交给 dsh 官方
 * ToolsService.register(签名含可选 options;实参只传 definition 合法)。
 */
export function pinToolsRegisterable(register: ToolRuntime['register']): void {
  for (const definition of defineMemoryTools(liveMemory)) {
    register(definition)
  }
}

/**
 * 钉住 ②:dshHost(liveCtx) 可用真实 dsh 上下文构建宿主——依赖
 * `ctx.tools`(dsh-tools 的 Context augmentation)与 `ctx.systemPrompt`
 * (dsh-system-prompt 的 Context augmentation)的类型存在且形态相符。
 */
export const pinDshHost: MemoryHost = dshHost(liveCtx)

/**
 * 钉住 ③:attachMemory 产出的宿主级 effect disposer 形态为 () => void,
 * 可直接作为 Cordis effect 树中的配逆闭包。
 */
export const pinAttachDisposer: () => void = attachMemory(dshHost(liveCtx), liveMemory)

/**
 * 钉住 ④:@eterna/governance 的 PiiFilter 结构满足 memory 的 PiiGuard
 * (assertClean(value, label?) 同签名)——注入无需适配层(provide 可交换)。
 */
export const pinGovernancePiiInjectable: PiiGuard = livePiiFilter

/**
 * 钉住 ⑤(T7):提取直调面消费 ctx.llm(dsh-llm 的 Context augmentation)——
 * resolveCuratorRoute 的 listProviders/listModels 与 runExtractionCall 的
 * prepareCall(PreparedLlmCall 契约)+ call.stream(GenerateOptions)调用形态
 * 与真实 LlmRuntime 类型双向兼容;DSH 升级破坏 seam 时 tsc 阶段即失败。
 */
export async function pinExtractionLlmSeam(signal: AbortSignal): Promise<void> {
  const route = await resolveCuratorRoute(liveCtx)
  await runExtractionCall(liveCtx, route, '材料', { signal })
}

/**
 * 钉住 ⑥(T9,勘察 S2 结论 3):memoryApprovalAskRequest 的产物可直接作为官方
 * AskUserQuestionRequestEvent.questions 发给 ctx.userQuestions.ask()——
 * 官方通道一行切换面零形态转换(上游 web 发行包纳入 dsh-client-ui-approval /
 * dsh-client-ui-user-questions 后启用;interact tests/types.seam-pin.ts:41-43
 * 同款钉法)。DSH 升级破坏 user-questions 载荷形态时 tsc 阶段即失败。
 */
import type { ApprovalCard } from '@eterna/interact'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { buildMemoryApprovalCard, memoryApprovalAskRequest } from '../src/index.ts'
import type { MemoryPendingItemView } from '../src/index.ts'

declare const liveCardItems: readonly MemoryPendingItemView[]

export function pinMemoryApprovalAskPayloadOfficial(card: ApprovalCard): AskUserQuestionRequestEvent {
  void buildMemoryApprovalCard({
    sessionId: 'session-a', turnRef: 'turn:1', sessionDigest: '摘要', items: liveCardItems,
  })
  return memoryApprovalAskRequest(card, 'memory-review:session-a:1')
}
