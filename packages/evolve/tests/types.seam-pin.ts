/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计 08 §8 风险 1):DSH pre-stable,适配面在 CI 用接口冒烟钉住。
 * 本文件用已发布 @deepseek-ai/dsh-llm(0.2.2-alpha.2,与 deepseek-harness 同版)类型断言:
 * evolve 的模型调用面(ModelCaller + dshLlmModelCaller)与官方 ctx.llm seam 双向兼容。
 *
 * 依据(deepseek-harness,只读):
 * - packages/llm/llm/src/types.ts:564-600(GenerateOptions:provider/model/messages/system/temperature/maxTokens)
 * - packages/llm/llm/src/types.ts:496-512(StreamChunk:text-delta{index,text}/usage/finish{reason})
 * - packages/llm/llm/src/index.ts:189('llm/stream' 瀑布后的 chunk 流)
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { dshLlmModelCaller, DEFAULT_MODEL_ROUTES, reflect } from '../src/index.ts'
import type { DshChunkLike, DshLlmLike, ModelRoute, SignalLike } from '../src/index.ts'

declare const dshChunks: readonly StreamChunk[]
declare const dshGenerateOptions: GenerateOptions
declare const dshCallConfig: LlmCallConfig

/** 钉住 ①:官方 StreamChunk 的 text-delta/finish 成员满足 DshChunkLike 消费面。 */
export const pinChunkTextDelta: DshChunkLike | undefined = dshChunks[0]?.type === 'text-delta'
  ? { type: 'text-delta', text: dshChunks[0].text }
  : undefined
export const pinChunkFinish: DshChunkLike | undefined = dshChunks[0]?.type === 'finish'
  ? { type: 'finish', reason: { kind: dshChunks[0].reason.kind } }
  : undefined

/**
 * 钉住 ②:官方 LlmRuntime.stream 的消费形态 —— DshLlmLike.stream(options) 的 options
 * 是 GenerateOptions 的结构子集(provider/model/messages/system/temperature/maxTokens),
 * 官方 GenerateOptions 值可直接传入本包适配层构造的调用。
 */
export const pinGenerateOptionsSubset: DshLlmLike['stream'] extends (options: infer O) => AsyncIterable<DshChunkLike>
  ? O
  : never = {
    provider: dshGenerateOptions.provider,
    model: dshGenerateOptions.model,
    messages: dshGenerateOptions.messages,
    ...(dshGenerateOptions.system !== undefined ? { system: dshGenerateOptions.system } : {}),
  }

/** 钉住 ③:LlmCallConfig 的 provider/model 即 ModelRoute 的全部字段(路由锚定消费面)。 */
export const pinModelRoute: ModelRoute = { provider: dshCallConfig.provider, model: dshCallConfig.model }

/** 钉住 ④:默认路由三角色全可配置、缺省 deepseek-flash(T10 口径,配置可覆写)。 */
export const pinDefaultRoutes: Readonly<Record<'reflector' | 'curator' | 'reviewer', ModelRoute>> = DEFAULT_MODEL_ROUTES
export const pinDefaultReflector: string = `${DEFAULT_MODEL_ROUTES.reflector.provider}/${DEFAULT_MODEL_ROUTES.reflector.model}`
export const pinDefaultReflectorIsFlash = DEFAULT_MODEL_ROUTES.reflector.model === 'deepseek-flash'

/** 钉住 ⑤:dshLlmModelCaller 把官方 stream 形态适配为 ModelCaller(text-delta 聚合 + finish=stop)。 */
const fakeLlm: DshLlmLike = {
  async *stream(options) {
    void options
    yield { type: 'text-delta', text: '{"mast":"F5"' }
    yield { type: 'text-delta', text: ',"root_cause":"knowledge-missing"}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
export const pinCaller = dshLlmModelCaller(fakeLlm)

/** 钉住 ⑥:ModelCaller 可直接驱动 reflector(mock 注入面 = 生产注入面,同一接口)。 */
export const pinReflectWithDshCaller = reflect([] satisfies readonly SignalLike[], {
  caller: pinCaller,
  routes: { reflector: pinModelRoute },
})
