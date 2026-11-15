/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面,与 dsh 客户端壳的运行时
 * 形状鸭子一致;不导入跨包类型(@eterna/panel、@eterna/attachments 同款纪律),
 * 客户端 bundle 因此零运行时依赖(基线外部模块除外:react)。
 */

/** 槽位注册选项(list / keyed 两用的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly locale?: string
  readonly label?: () => string
  readonly inject?: () => Record<string, unknown>
}

/** 槽位贡献 API(ctx.slots 的消费面)。 */
export interface SlotsFace {
  inject(name: string, contribute: () => (() => void) | Generator<() => void>): () => void
  register(options: SlotRegisterOptions, component: unknown): () => void
}

/** 语言服务消费面。 */
export interface LocaleFace {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
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
    call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
  }
}

/** 主面板切换(usage-stats/access 同款结构子集;Sources 行「跳转面板」用)。 */
export interface LayoutFace {
  readonly selectMainPanel: (key: string) => void
}

/**
 * Conversation 事件累计器注册面(dsh-client-ui-conversation 的 UiConversation
 * 结构子集:events 注册表;register 的 Definition 入参按 ConversationNodeDefinitionInput
 * 的结构面本地声明——match 表/函数两形态,本插件用函数形态)。
 */
export interface ConversationEventsFace {
  readonly events: {
    register(definition: ConversationNodeDefinitionLike): () => void
  }
}

/** ConversationNodeDefinition 的本地结构面(契约字段;State 自定义)。 */
export interface ConversationNodeDefinitionLike {
  readonly kind: string
  match(event: SessionEventLike): { readonly id: string; readonly role: 'start' | 'update' } | null
  start(context: ConversationNodeContextLike, match: ConversationMatchLike): unknown
  update(context: ConversationNodeContextLike & { readonly state: unknown }, match: ConversationMatchLike): unknown
  buildLocationData?(
    context: ConversationNodeContextLike,
    scope: 'turn' | 'step',
    previous: ConversationLocationDataLike | null,
  ): ConversationLocationDataLike | null
}

/** 会话事件的结构面(dsh-session types 的载荷按事件类型本地收窄)。 */
export interface SessionEventLike {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: Record<string, unknown>
}

/** Definition 的 match 产物(context/match 形状面;本插件只消费 event)。 */
export interface ConversationMatchLike {
  readonly event: SessionEventLike
  readonly role: 'start' | 'update'
}

/** Definition 的 context 形状面(本插件的 State 经泛型参数承载)。 */
export interface ConversationNodeContextLike {
  readonly key: string
  readonly kind: string
  readonly id: string
}

/** Location data 值的形状面(buildLocationData 产出;kind+turn+key+value)。 */
export interface ConversationLocationDataLike {
  readonly kind: 'turn' | 'step'
  readonly turn: number
  readonly key: string
  readonly value: unknown
}

/** TurnLocation 的本地结构面(turnTail owner 的读取面;data.get 读业务键)。 */
export interface TurnLocationLike {
  readonly turn: number
  readonly status: 'open' | 'closed' | 'unknown'
  readonly data: { get(key: string): unknown }
}

/** turnTail slot 官方 owner(TurnTailOwnerProps 结构子集)。 */
export interface TurnTailOwnerPropsLike {
  readonly turn: TurnLocationLike
  readonly seq: number
  readonly openFile: (path: string) => void
}

/** session 作用域插槽的标准 props 官方注入面(结构子集,运行时鸭子一致)。 */
export interface SessionSlotProps {
  /** 当前会话标识;无会话时上游不渲染本席位(attachments 同款防御)。 */
  readonly sessionId?: unknown
  /** composer 是否锁定。 */
  readonly locked?: boolean
  /** 官方注入的输入状态选择器钩子。 */
  readonly useInput?: <S>(selector: (state: { draft: string }) => S) => S
  /** 官方注入的输入动作面(setDraft/submit)。 */
  readonly inputActions?: {
    readonly setDraft: (text: string) => void
    readonly submit: () => void
  }
  /** 本插件 inject 面提供的翻译函数。 */
  readonly t?: (key: string) => string
}

/** 浏览器插件上下文(本插件消费的最小服务面)。 */
export interface MemoryClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly connection: ConnectionFace
  readonly layout: LayoutFace
  readonly uiConversation: ConversationEventsFace
}
