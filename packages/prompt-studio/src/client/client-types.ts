/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面(slots / locale /
 * connection),与 dsh 客户端壳的运行时形状鸭子一致(对齐 packages/panel 的
 * client-types.ts 配方)。不导入跨包运行时模块,客户端 bundle 因此零运行时依赖
 * (基线外部模块除外:react);线载荷类型从 ../types.ts 以
 * `import type` 引入(纯类型,esbuild 全部擦除,Host/Client 单一事实源)。
 */

/** 槽位注册选项(list / keyed 两用的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  /** list 槽条目 id(sidebar.panellist 用;须与 main keyed 槽的 key 一致)。 */
  readonly id?: string
  /** keyed 槽单元格 key(main 用;layout.selectPanel 校验同名 main 条目)。 */
  readonly key?: string
  readonly order?: number
  readonly locale?: string
  /** 语言感知标签(侧栏行文案,随活跃语言重解)。 */
  readonly label?: () => string
  /** 注入面:hooks 份额(裸 observable 源)+ 普通值/回调。 */
  readonly inject?: () => Record<string, unknown>
}

/** React 组件(结构面:可调用、接收 props)。 */
export type SlotComponent = (props: never) => unknown

/** 槽位贡献 API(ctx.slots 的消费面)。 */
export interface SlotsFace {
  /** 向已声明槽位贡献一个条目;声明缺席时等待,声明坍塌即撤销。 */
  inject(name: string, contribute: () => (() => void) | Generator<() => void>): () => void
  /** 注册一个条目到槽位(选项字段由槽位 kind 决定)。 */
  register(options: SlotRegisterOptions, component: SlotComponent): () => void
}

/** 语言服务消费面。 */
export interface LocaleFace {
  /** 注册命名空间字典;返回撤销函数。 */
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
  /** 绑定命名空间的翻译函数。 */
  bind(ns: string): (key: string) => string
}

/** 宿主 RPC 结果封套(Connection RpcResult 形状)。 */
export interface RpcResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string; readonly code?: string }
}

/** 连接服务消费面(浏览器↔宿主官方 RPC 通道)。 */
export interface ConnectionFace {
  readonly rpc: {
    /** 经 /api 通道调用宿主端点(unary 载荷形状 { args: 命名参数对象 })。 */
    call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
  }
}

/** 浏览器插件上下文(本插件消费的最小服务面)。 */
export interface PromptStudioClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly connection: ConnectionFace
}
