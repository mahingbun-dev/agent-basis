/**
 * 模型角色配置与 provider 接口(设计 10 §1:D1 决议「全可配置,不写实,默认 Flash」)。
 *
 * - 三个角色 reflector(归因/打标)/ curator(delta 起草)/ reviewer(高危复核建议)
 *   各自 { provider, model },缺省 deepseek-flash;部署只改配置不改代码;
 * - 模型调用统一走 ModelCaller 接口(可注入 mock —— 单测绝不真实调用);
 * - dshLlmModelCaller(dshLlm) 把 DSH 的 ctx.llm(catalog 路由 + stream)适配成
 *   ModelCaller:请求形态对齐 GenerateOptions(provider/model/messages/system),
 *   消费 text-delta/finish chunk(类型钉住见 tests/types.seam-pin.ts)。
 */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** 默认路由(任务 T10 口径:三角色默认 deepseek-flash;部署可覆写,如 reviewer 换 pro)。 */
export const DEFAULT_MODEL_ROUTES: Readonly<Record<ModelRole, ModelRoute>> = {
  reflector: { provider: 'deepseek', model: 'deepseek-flash' },
  curator: { provider: 'deepseek', model: 'deepseek-flash' },
  reviewer: { provider: 'deepseek', model: 'deepseek-flash' },
}

export type ModelRole = 'reflector' | 'curator' | 'reviewer'

/** 模型角色路由表(部分覆写:缺省角色回落 DEFAULT_MODEL_ROUTES)。 */
export interface ModelRoutes {
  readonly reflector?: ModelRoute
  readonly curator?: ModelRoute
  readonly reviewer?: ModelRoute
}

export function resolveRoutes(overrides: ModelRoutes = {}): Readonly<Record<ModelRole, ModelRoute>> {
  return {
    reflector: overrides.reflector ?? DEFAULT_MODEL_ROUTES.reflector,
    curator: overrides.curator ?? DEFAULT_MODEL_ROUTES.curator,
    reviewer: overrides.reviewer ?? DEFAULT_MODEL_ROUTES.reviewer,
  }
}

/** 一次补全请求的最小形态(对齐 DSH GenerateOptions 的消费子集)。 */
export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** 模型调用统一接口(单测注入 mock;生产由 dshLlmModelCaller 适配 ctx.llm)。 */
export interface ModelCaller {
  /**
   * 单轮补全;失败必须 reject(不许静默返回空串 —— 进化提案链路上
   * 「模型没说话」与「模型说不知道」是两种不同的降级路径)。
   */
  call(input: {
    readonly route: ModelRoute
    readonly system?: string
    readonly messages: readonly ModelMessage[]
    /** JSON 模式提示(模型侧尽力保证输出可解析;调用方仍需防御性解析)。 */
    readonly json?: boolean
  }): Promise<string>
}

/**
 * DSH llm seam 适配器:消费 ctx.llm.catalog 路由 + stream 的最小面。
 * 形态对齐 deepseek-harness packages/llm/llm(src/index.ts LlmRuntime.stream +
 * src/types.ts GenerateOptions/StreamChunk,0.2.2-alpha.2):
 * - 请求:{ provider, model, messages, system?, temperature?, maxTokens? };
 * - 流:聚合 text-delta.text 直到 finish;error/aborted finish → reject。
 */
export interface DshLlmLike {
  stream(options: {
    readonly provider: string
    readonly model: string
    readonly messages: readonly unknown[]
    readonly system?: string
    readonly temperature?: number
    readonly maxTokens?: number
  }): AsyncIterable<DshChunkLike>
}

/**
 * chunk 消费面:text-delta 聚合文本;finish.reason 取官方 FinishReason 的结构形态
 * (判别联合,kind 判别;0.2.2-alpha.2 packages/llm/llm/src/types.ts:163-172)。
 */
export type DshChunkLike =
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'finish'; readonly reason: { readonly kind: string } }

export function dshLlmModelCaller(dshLlm: DshLlmLike): ModelCaller {
  return {
    async call(input) {
      const chunks: string[] = []
      let finishKind: string | undefined
      for await (const chunk of dshLlm.stream({
        provider: input.route.provider,
        model: input.route.model,
        ...(input.system !== undefined ? { system: input.system } : {}),
        ...(input.json === true ? { temperature: 0 } : {}),
        messages: input.messages.map(m => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
      })) {
        if (chunk.type === 'text-delta') {
          chunks.push(chunk.text)
        } else {
          finishKind = chunk.reason.kind
          break
        }
      }
      if (finishKind === undefined) {
        throw new Error(`[evolve] 模型流未收到 finish(provider=${input.route.provider} model=${input.route.model})`)
      }
      if (finishKind !== 'stop') {
        throw new Error(`[evolve] 模型流异常终止:${finishKind}(provider=${input.route.provider} model=${input.route.model})`)
      }
      return chunks.join('')
    },
  }
}

/** 从模型输出中抢救 JSON(reflector/curator 的 json 模式兜底;失败返回 undefined)。 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 尝试下一个候选形态
    }
  }
  return undefined
}
