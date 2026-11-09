/**
 * 浏览器半边的本地结构类型与共享调用面(零跨包类型依赖;对齐 packages/panel
 * client-types.ts 纪律)。RPC 载荷形状:unary { args: { input: <命名参数对象> } }。
 */

/** 槽位注册选项(运行时字段;对齐 panel client-types)。 */
export interface SlotRegisterOptions {
  readonly name: string
  readonly key?: string
  readonly inject?: () => Record<string, unknown>
}

/** 槽位贡献 API(ctx.slots 消费面)。 */
export interface SlotsFace {
  inject(name: string, contribute: () => (() => void) | Generator<() => void>): () => void
  register(options: SlotRegisterOptions, component: (props: never) => unknown): () => void
}

/** Connection RPC 消费面(panel 同款)。 */
export interface ConnectionFace {
  rpc: {
    call(
      path: string,
      endpoint: string,
      payload: unknown,
    ): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }>
  }
}

/** 浏览器插件上下文(本包消费面)。 */
export interface DoctorClientContext {
  readonly slots: SlotsFace
  readonly connection: ConnectionFace
  /** 统一 RPC 入口(apply 时闭包注入;组件侧不直接摸 connection)。 */
  callDoctor(endpoint: string, input?: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown; message?: string }>
}

/** 卡片属主共享 props(官方 ProviderCardExtrasOwnerProps 子集)。 */
export interface CardOwnerProps {
  readonly provider?: { readonly settingsNs?: string; readonly provider?: string }
  readonly configured?: boolean
}

/** 宿主 health 报告形状(DoctorHealthReport 的浏览器侧子集)。 */
export interface HealthReport {
  checkedAt?: string
  health?: readonly { provider: string; verdict: string; ok: boolean; detail: string }[]
  routes?: readonly { provider: string; displayName?: string; models: readonly string[] }[]
  lastAutoFix?: readonly { provider: string; api: string; from: string; to: string }[]
  lastError?: string
}

/** 逐模型测试态。 */
export interface ModelState {
  status: 'idle' | 'testing' | 'ok' | 'fail'
  latencyMs?: number
  preview?: string
  error?: string
}
