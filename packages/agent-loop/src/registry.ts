/**
 * agents 注册表实现:具名 factory + 默认名。
 */
import type { AgentFactory, AgentRegistry } from '@core/contracts'

export class AgentRegistryImpl implements AgentRegistry {
  private readonly factories = new Map<string, AgentFactory>()
  private readonly runners = new Map<string, { run(input: string): Promise<import('@core/contracts').TurnResult> }>()
  private default: string | undefined

  /** 注册具名 agent factory,返回 the exact disposer。 */
  register(name: string, factory: AgentFactory): () => void {
    if (this.factories.has(name)) throw new Error(`agent "${name}" 已注册(唯一名纪律)`)
    this.factories.set(name, factory)
    if (this.default === undefined) this.default = name
    return () => {
      this.factories.delete(name)
      const runner = this.runners.get(name)
      this.runners.delete(name)
      if (this.default === name) this.default = undefined
      void runner
    }
  }

  /** 按名物化 runner(同纤程内缓存);未注册抛错。 */
  resolve(name?: string, ctx?: import('@core/cordis').Context): { run(input: string): Promise<import('@core/contracts').TurnResult> } {
    const target = name ?? this.default
    if (target === undefined) throw new Error('agents:未注册任何 agent 且未指定默认')
    const factory = this.factories.get(target)
    if (factory === undefined) throw new Error(`agent 未注册:${target};已注册:[${[...this.factories.keys()].join(', ')}]`)
    const cached = this.runners.get(target)
    if (cached !== undefined) return cached
    if (ctx === undefined) throw new Error(`agents:物化 runner 需要 ctx(agent:${target})`)
    const runner = factory(ctx)
    this.runners.set(target, runner)
    return runner
  }

  defaultName(): string | undefined {
    return this.default
  }

  /** 设默认 agent(未注册的名字抛错)。 */
  setDefault(name: string): void {
    if (!this.factories.has(name)) throw new Error(`agent 未注册:${name}`)
    this.default = name
  }
}
