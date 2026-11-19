/**
 * llm 插件:构造 openai-compat provider(LiteLLM 默认路由)并 provide ctx.llm。
 * API key 每次请求时从 env 求值(凭据不进配置)。
 */
import type { Context } from '@core/cordis'
import { LlmRegistryImpl } from './registry.ts'
import { createOpenAiCompatProvider } from './openai.ts'

export const LLM_PLUGIN_NAME = 'basis-llm'

export interface LlmPluginConfig {
  /** completions 端点基底;缺省 LiteLLM 网关(NAS:4000)。 */
  readonly baseUrl?: string
  /** API key 的 env 变量名;缺省 LITELLM_API_KEY。 */
  readonly apiKeyEnv?: string
  /** 默认模型;缺省 deepseek-chat。 */
  readonly model?: string
  /** provider 路由名;缺省 litellm。 */
  readonly provider?: string
}

export function defineLlmPlugin(config: LlmPluginConfig = {}) {
  return {
    name: LLM_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const providerName = config.provider ?? 'litellm'
      const apiKeyEnv = config.apiKeyEnv ?? 'LITELLM_API_KEY'
      const registry = new LlmRegistryImpl()
      const disposeProvider = registry.register(createOpenAiCompatProvider({
        name: providerName,
        model: config.model ?? 'deepseek-chat',
        baseUrl: config.baseUrl ?? 'http://127.0.0.1:4000/v1',
        apiKey: () => process.env[apiKeyEnv],
      }))
      const disposeProvide = ctx.provide('llm', registry)
      return () => {
        disposeProvide()
        disposeProvider()
      }
    },
  }
}

export default defineLlmPlugin()
