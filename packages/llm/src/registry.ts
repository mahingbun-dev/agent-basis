/**
 * LLM 注册表实现:命名 provider 路由 + 默认路由。
 */
import type { LlmProvider, LlmRegistry } from '@core/contracts'

export class LlmRegistryImpl implements LlmRegistry {
  private readonly providers = new Map<string, LlmProvider>()
  private default: string | undefined

  /** 注册 provider,返回 the exact disposer;同名重复抛错。 */
  register(provider: LlmProvider): () => void {
    if (this.providers.has(provider.name)) {
      throw new Error(`llm provider "${provider.name}" 已注册(唯一名纪律)`)
    }
    this.providers.set(provider.name, provider)
    if (this.default === undefined) this.default = provider.name
    return () => {
      this.providers.delete(provider.name)
      if (this.default === provider.name) this.default = undefined
    }
  }

  /** 按名解析;缺省走默认路由;不存在抛错(fail-loud)。 */
  resolve(name?: string): LlmProvider {
    const target = name ?? this.default
    const provider = target === undefined ? undefined : this.providers.get(target)
    if (provider === undefined) {
      throw new Error(`llm provider 未注册:${target ?? '(无默认路由)'};已注册:[${[...this.providers.keys()].join(', ')}]`)
    }
    return provider
  }

  defaultRoute(): string | undefined {
    return this.default
  }

  /** 设默认路由(未注册的名字抛错)。 */
  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`llm provider 未注册:${name}`)
    }
    this.default = name
  }
}
