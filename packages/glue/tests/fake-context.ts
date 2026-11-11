/**
 * glue 插件测试共享假 ctx(形态对齐 packages/audit/tests/plugin.spec.ts 的
 * makeFakeContext:只声明插件 apply 用到的 provide/on 两面,不依赖 cordis 运行时)。
 *
 * 与 audit spec 的差异:provide 同步镜像为 ctx 属性(§3.0-1:provide 的 name 就是
 * ctx 属性名,真实 cordis 由 props[name] 承载)——governance 的审计桥逐调用读
 * ctx.audit 属性、audit 插件 apply 读 ctx.governance 属性,属性必须落在 fake 本体上。
 * 卸载不 delete 属性(oxlint no-dynamic-delete)而是置 undefined:消费侧全部经
 * `?.`/`??` 读取,undefined 与缺席同义。
 */

/** pre-execute 决策的结构面(结构兼容 dsh PreToolDecision 的治理子集)。 */
export interface PreToolDecisionLike {
  readonly kind: 'allow' | 'deny' | 'ask' | 'cancel'
  readonly reason?: string
}

/** pre-execute 执行体的结构面(结构兼容 dsh ToolExecution 的治理子集)。 */
export interface ToolExecutionLike {
  readonly name: string
  readonly arguments?: unknown
  readonly callId?: string
}

type AnyListener = (...args: unknown[]) => unknown
type PreExecuteListener = (
  exec: ToolExecutionLike,
  next: () => Promise<PreToolDecisionLike>,
) => Promise<PreToolDecisionLike>

export interface FakeContextHarness {
  /** 形态满足插件 apply 的 ctx(测试里 as unknown as Context);自身即属性镜像面。 */
  readonly fake: FakeContext
  /** 预置一个服务(镜像真实 provide:进 services 表 + ctx 属性),返回卸载器。 */
  provide(name: string, value: unknown): () => void
  /** 按注册序取某事件的监听器。 */
  listenersOf(event: string): readonly AnyListener[]
  /** 派发一条 session 事件(audit 插件的入口)。 */
  emitSession(event: { readonly type: string; readonly data: unknown; readonly seq?: number; readonly time?: number }): void
  /** 以 waterfall 语义派发 tools/pre-execute(注册序从外到内;末位 next 返回 allow)。 */
  dispatchPreExecute(exec: ToolExecutionLike): Promise<PreToolDecisionLike>
  /** 服务名清单(provide 顺序)。 */
  services(): readonly string[]
  /** 取服务值(无泛型——调用侧自行收窄)。 */
  service(name: string): unknown
}

export interface FakeContext {
  provide(name: string, value: unknown): () => Promise<void>
  on(event: string, listener: (...args: unknown[]) => unknown): () => void
  /** cordis 无 inject 读取面(audit-bridge/audit 插件的机会读取走 ctx.reflect.get)。 */
  readonly reflect: { get(name: string, strict?: boolean): unknown }
  /**
   * reflect mixin 的 ctx.get 直读面(cordis ReflectService constructor mixin('reflect',
   * ['get', ...]);memory-plugin 的注册表读取面经它机会读取 promptRegistry 服务)。
   */
  get(name: string): unknown
}

export function makeFakeContext(): FakeContextHarness {
  const listeners = new Map<string, Set<AnyListener>>()
  const services = new Map<string, unknown>()
  // fake 本体即 §3.0-1 的属性镜像面(Record 分支持任意 name 键;写入走索引签名)。
  // reflect.get 模拟 cordis 的无 inject 读取(vendor/cordis src/reflect.ts:240;真 cordis
  // 对裸属性读取抛 "cannot get property ... without inject",:152)——从 services 表取值,
  // 缺席返回 undefined(与「服务缺席 → 机会读取降级」同义)。
  const fake: FakeContext & Record<string, unknown> = {
    provide: (name, value) => {
      services.set(name, value)
      fake[name] = value
      return async () => {
        services.delete(name)
        fake[name] = undefined
      }
    },
    on: (event, listener) => {
      let set = listeners.get(event)
      if (set === undefined) {
        set = new Set<AnyListener>()
        listeners.set(event, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    reflect: { get: name => services.get(name) },
    get: name => services.get(name),
  }

  return {
    fake,
    provide: (name, value) => {
      services.set(name, value)
      fake[name] = value
      return () => {
        services.delete(name)
        fake[name] = undefined
      }
    },
    listenersOf: event => [...(listeners.get(event) ?? [])],
    emitSession: (event) => {
      for (const listener of [...(listeners.get('session/event') ?? [])]) listener({}, event)
    },
    dispatchPreExecute: async (exec) => {
      const chain = [...(listeners.get('tools/pre-execute') ?? [])] as unknown as PreExecuteListener[]
      const run = (index: number): Promise<PreToolDecisionLike> => {
        const listener = chain[index]
        if (listener === undefined) return Promise.resolve({ kind: 'allow' as const })
        return listener(exec, () => run(index + 1))
      }
      return run(0)
    },
    services: () => [...services.keys()],
    service: name => services.get(name),
  }
}
