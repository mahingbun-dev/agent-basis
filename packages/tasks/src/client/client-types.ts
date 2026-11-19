/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面,与 dsh 客户端壳的运行时形状
 * 鸭子一致;不导入跨包类型(memory/panel 同款纪律),客户端 bundle 因此零运行时依赖
 * (基线外部模块除外:react)。
 */

/** 槽位注册选项(list / keyed 两用的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly priority?: number
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
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
}

/** 会话导航面(dsh-client-ui-workspace 的 UiWorkspace 结构子集;workbench 同款)。 */
export interface UiWorkspaceFace {
  openSession(sessionId: string): void
}

/** 用户文本节点(user.text 规则的返回形态;宿主按 id 选中 node 渲染器)。 */
export interface UserTextRuleMatch {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly data?: unknown
}

/** 用户文本转换规则(宿主 uiConversation.userText.register 的消费面)。 */
export interface UserTextRule {
  readonly id: string
  readonly order: number
  match(text: string, from: number, context: { read(key: string): unknown }): UserTextRuleMatch | undefined
}

/** 宿主 uiConversation 服务面(本插件只用 userText 规则注册)。 */
export interface UiConversationFace {
  readonly userText: {
    register(rule: UserTextRule): () => void
  }
}

/** 会话头 utilities 席位的标准 props(结构子集:sessionId 与会话作用域同源)。 */
export interface SessionSlotProps {
  readonly sessionId?: unknown
  /** 本插件 inject 面提供的翻译函数。 */
  readonly t?: (key: string, params?: Record<string, string | number>) => string
}

/** conversation.user.text.node 席位 props(node 为规则产物,raw 为原文)。 */
export interface UserTextNodeSlotProps {
  readonly node: UserTextRuleMatch
  readonly raw?: string
  readonly interactive?: boolean
  readonly t?: (key: string, params?: Record<string, string | number>) => string
}

/** 浏览器插件上下文(本插件消费的最小服务面)。 */
export interface TasksClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly uiWorkspace?: UiWorkspaceFace
  readonly uiConversation?: UiConversationFace
}
