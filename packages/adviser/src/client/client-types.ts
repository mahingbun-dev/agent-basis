/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面(sidebarRightTabs /
 * slots / locale / sessions / resources),与 dsh 客户端壳的运行时形状鸭子一致。
 * 不导入跨包类型,客户端 bundle 因此零运行时依赖(基线外部模块除外:react)。
 */
import type { ReactNode } from 'react'

/** tab 类型注册选项(sidebarRightTabs.register 的消费面)。 */
export interface TabTypeDefinition {
  /** 本实现在 tab 系统中的身份,全局唯一(包名为自然值)。 */
  readonly id: string
  /** tab 种类:本类型显示的名称;一个 kind 至多一个 builtin + 一个 extension。 */
  readonly kind: string
  /** 资源型类型的地址 glob;页面型不声明,按 kind 打开。 */
  readonly patterns?: readonly string[]
  /** 同级竞争时的优先带。 */
  readonly priority?: 'extension' | 'builtin' | 'fallback'
  /** 否决一个地址匹配。 */
  readonly canOpen?: (address: string) => boolean
  /** tab chip 文本,在 tab 打开时捕获。 */
  readonly title: (address: string) => string
  /** 保留已访问的 body(跨 tab/会话切换、折叠、停靠)。 */
  readonly keepMounted?: boolean
  /** 独立实例(如终端、参谋多开):每次打开得到不同内容地址。 */
  readonly multiple?: boolean
  /**
   * 右栏导引页的入口卡片(不声明就只能在地址路由里被认领,用户无从打开)。
   * 参谋必须声明:资源型类型没有入口就没有任何可达路径。
   */
  readonly guide?: readonly TabGuideEntry[]
}

/** 导引页入口卡片。 */
export interface TabGuideEntry {
  /** 稳定身份(本类型内唯一)。 */
  readonly id: string
  /** 升序位置(与其它类型的条目一起排)。 */
  readonly order: number
  /** 卡片标题(每次取用时重读,切语言无需重注册)。 */
  readonly title: () => string
  /** 卡片下的一行说明。 */
  readonly description?: () => string
  /** 可选字形;省略则导引页画自己的占位方块。 */
  readonly icon?: unknown
}

/** tab 类型注册表消费面(ctx.sidebarRightTabs)。 */
export interface SidebarRightTabsFace {
  /** 注册 tab 类型;返回撤销函数。同 id 二次注册抛错。 */
  register(definition: TabTypeDefinition): () => void
}

/** 子槽位规格(children 声明表的值;kind/scope 由槽位契约决定)。 */
export interface SlotSpecFace {
  readonly kind: 'single' | 'list' | 'keyed' | 'chain' | 'hoc'
  readonly scope: 'root' | 'session-maybe' | 'session'
}

/** 槽位注册选项(list/keyed 槽的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  /** keyed 槽条目 key(list 槽改用 id)。 */
  readonly key?: string
  /** list 槽条目 id(list 槽必备,dsh 客户端 slot 纪律)。 */
  readonly id?: string
  readonly order?: number
  readonly locale?: string
  /**
   * 子槽位声明:声明即在**本 entry** 名下创建槽位记录(一个槽位只有一个声明者)。
   * 参谋面板必须声明自己的会话子槽位——框架只向「声明了非 root 子槽位」的 entry
   * 发放 `SessionProvider` 席(ui-renderer standardKit),没有它就切不了会话作用域。
   */
  readonly children?: Record<string, SlotSpecFace>
  /** 注入面:普通值/回调。 */
  readonly inject?: () => Record<string, unknown>
}

/** React 组件(结构面:可调用、接收 props)。 */
export type SlotComponent<P = never> = (props: P) => ReactNode

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

// ── 会话引用与作用域 ─────────────────────────────────────────────────────────

/**
 * 一个会话引用(`ctx.sessions.retain` 的返回,也是 `SessionProvider.session` 的
 * 入参)。持有期间该会话的 Client 作用域与历史保持打开;`release()` 幂等。
 */
export interface SessionReferenceFace {
  readonly sessionId: string
  /** 释放本引用(最后一个引用释放时拆作用域与历史)。 */
  release(): void
}

/** `retain` 的选项:消费者来源标签 + 等待取消。 */
export interface SessionRetainOptionsFace {
  /** 来源标签(计入 retainedBy 观测;本面板用 'adviserPanel')。 */
  readonly source: string
  readonly signal?: AbortSignal
}

/** 会话服务消费面(本插件只用 retain 与 projection 刷新)。 */
export interface SessionsFace {
  /**
   * 取得一个会话引用并启动其共享历史打开。
   * @param target - 会话 id(subagent 子会话可经父会话 catalog 解析)。
   * @param options - 来源标签与可选取消信号。
   * @returns 立即返回的引用;历史打开进度见其 ready。
   */
  retain(target: string, options: SessionRetainOptionsFace): SessionReferenceFace
  /**
   * 刷新某会话的投影(含子代理 catalog)。
   *
   * 为什么需要:retain 一个 subagent 子会话时,上游 `resolveTarget` 只在
   * 「live / 列表有 summary / subagentAddress 可解析」三者之一成立时才接受该 id,
   * 而 subagentAddress 来自**父会话**的 catalog 投影。父会话投影未拉过就到了
   * 「unknown session」——故列表拿到参谋后先刷一次父会话投影(上游 ui-subagent
   * 的 refreshProjection 同一手法)。
   */
  refreshProjections(sessionId: string): Promise<void>
}

// ── 资源协议(地址 → 会话引用)───────────────────────────────────────────────

/** 资源快照(status/value 子集)。 */
export interface ResourceSnapshotFace<Value> {
  readonly status: 'none' | 'loading' | 'live' | 'failed'
  readonly value: Value | undefined
}

/** 全局标准 hook:读一个地址的当前资源状态。 */
export type UseResourceFace = <Value>(address: string) => ResourceSnapshotFace<Value>

/** 资源打开上下文。 */
export interface ResourceOpenContextFace {
  readonly signal: AbortSignal
}

/** 一帧:成功带值,失败带错误(失败也是帧,不抛)。 */
export type ResourceFrameFace<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: unknown }

/** 一个协议的提供者。 */
export interface ResourceProviderFace<Value> {
  readonly protocol: string
  open(address: string, ctx: ResourceOpenContextFace): AsyncIterable<ResourceFrameFace<Value>>
}

/** 资源服务消费面(ctx.resources)。 */
export interface ResourcesFace {
  /** 注册一个协议的提供者;返回撤销函数。同协议二次注册抛错。 */
  register<Value>(provider: ResourceProviderFace<Value>): () => void
}

// ── tab 运行时信息 ───────────────────────────────────────────────────────────

/** tab 记录(contentId 是打开时的地址,布局持久化只存这几个字段)。 */
export interface TabRecordFace {
  readonly id: string
  readonly kind: string
  /** 打开时的地址:资源型是完整 `dsh-resource://` 地址。 */
  readonly contentId: string
  readonly title: string
}

/** tab 自身可做的动作(本插件只用 openResource 与 close)。 */
export interface TabActionsFace {
  /**
   * 从本 tab 打开一个资源;`replaceTab: true` 让新内容接管本 tab 的位置并关掉本 tab。
   * @param address - `dsh-resource://` 地址。
   * @param options - 放置选项与导航参数。
   */
  openResource(address: string, options?: {
    readonly replaceTab?: boolean
    readonly preferNewPane?: boolean
    readonly revealIfOpened?: boolean
    readonly destination?: 'sidebar' | 'float'
    readonly params?: unknown
  }): void
  /** 关掉本 tab。 */
  close(): void
}

/** `useTabInfo()` 的返回(本插件读 tab 记录与动作)。 */
export interface TabInfoFace {
  readonly tab: TabRecordFace & { readonly actions: TabActionsFace }
}

/** 框架注入的 tab 信息 hook(名字由 slot 声明的 hooks.tabInfo 决定)。 */
export type UseTabInfoFace = () => TabInfoFace

// ── 会话标准 props(Factory / 槽位作用域内)──────────────────────────────────

/** 会话快照子集(只读本插件用到的字段)。 */
export interface SessionSnapshotFace {
  readonly blank: boolean
  readonly running: boolean
  readonly awaitingFirstTurn: boolean
  readonly promptAttempted: boolean
  readonly openState: string
}

/** 会话快照选择 hook。 */
export type UseSessionFace = <T>(selector: (snapshot: SessionSnapshotFace) => T) => T

/** 会话对话快照子集。 */
export interface ConversationSnapshotFace {
  readonly activeTargets: ReadonlySet<unknown>
}

/** 会话对话快照选择 hook。 */
export type UseConversationFace = <T>(selector: (snapshot: ConversationSnapshotFace) => T) => T

/** Factory 局部席位选择(本插件只选 views)。 */
export interface FactoryLocalSlotsFace {
  readonly slots?: Record<string, SlotComponent>
}

/** `renderFactorySlot` 消费面(渲染 conversation.content 的 embedded 变体)。 */
export type RenderFactorySlotFace = (
  name: string,
  props: object,
  options?: FactoryLocalSlotsFace,
) => ReactNode

/** `SessionProvider` 席(由 entry 的 children 声明触发框架注入)。 */
export type SessionProviderFace = (props: {
  readonly session?: SessionReferenceFace | undefined
  readonly empty?: (() => unknown) | undefined
  readonly children: ReactNode
}) => ReactNode

/** Factory 内部 `renderSlot`(用于把 conversation.session 钉在 chat 视图上)。 */
export interface FactoryRenderSlotFace {
  renderSlot(key: string, owner: object): ReactNode
}

// ── 右侧栏导航(ctx.sidebarRight,与类型注册表是两个服务)────────────────────

/**
 * 右侧栏导航面:只声明本插件用到的两个方法。
 *
 * 为什么需要它:斜杠命令与快捷键都发生在**没有 tab 上下文**的地方(光标在
 * 主会话输入框),那里拿不到 `tab.actions`,只能请导航控制器按 kind 开一个
 * 页面 tab——`openTab(kind)` 落在当前屏幕会话的右栏,正是「/adviser 打开
 * 参谋」想要的语义。
 */
export interface SidebarRightFace {
  /** 按 kind 打开页面 tab(本插件的 kind 是 `adviser`,落在选择/新建面板)。 */
  openTab(kind: string, options?: { readonly params?: unknown }): void
  /** 当前屏幕会话的 id(无会话在屏时为 undefined)。 */
  readonly mounted: { getSnapshot(): string | undefined }
}

// ── 客户端命令面(ctx.commandUi)────────────────────────────────────────────

/**
 * 一条 `kind: 'action'` 的客户端命令贡献(斜杠菜单条目)。
 *
 * 只声明 action 变体:参谋命令是「点一下开面板」,不选值、不接受参数,
 * 因此不需要 popupSelect 的 options/onSelect 那一整套。
 */
export interface CommandActionContribution {
  /** 命令名(不带斜杠,与宿主命令重名会在候选合成时显式失败)。 */
  readonly name: string
  /** 菜单行标题(每次候选合成重读,切语言无需重注册)。 */
  label?(): string
  /** 菜单行说明。 */
  description?(): string
  /** 可用性过滤(每次候选合成拿一份新投影)。 */
  available(session: SessionContextFace): boolean
  readonly ui: { readonly kind: 'action'; run(session: SessionContextFace): void }
}

/** 命令面消费服务(ctx.commandUi)。 */
export interface CommandUiFace {
  register(contribution: CommandActionContribution): () => void
}

// ── 会话交互面(ctx.uiConversation.interactions)────────────────────────────

/** 文本手势的触发来源。 */
export type TextInteractionTriggerFace = 'selection' | 'contextmenu'

/** 派发给单个插件的手势请求(同步读取浏览器事件与 DOM 文本)。 */
export interface TextInteractionRequestFace {
  readonly trigger: TextInteractionTriggerFace
  readonly hasSelection: boolean
  /** 读当前选区文本;跨源或落在排除区时为 null。 */
  readonly readText: () => string | null
  /** 本次手势所属会话。 */
  readonly sessionId: string
  /** 选中**本插件**的键控表面(只有它会被渲染)。 */
  readonly open: () => void
}

/** 一个手势消费者的定义(id 同时是它的键控槽条目 key)。 */
export interface TextInteractionDefinitionFace {
  readonly id: string
  onInteraction(request: TextInteractionRequestFace): void
}

/** 会话交互注册表消费面(ctx.uiConversation.interactions)。 */
export interface ConversationInteractionsFace {
  register(definition: TextInteractionDefinitionFace): () => void
}

/** `ctx.uiConversation` 的本插件消费子集。 */
export interface UiConversationFace {
  readonly interactions: ConversationInteractionsFace
}

// ── 快捷键面(ctx.shortcuts)───────────────────────────────────────────────

/** 一条快捷键绑定(物理键码 + 逻辑修饰键)。 */
export interface ShortcutBindingFace {
  /** 物理键码,例如 `KeyA` / `Backslash`。 */
  readonly code: string
  readonly modifiers: readonly ('primary' | 'control' | 'alt' | 'shift' | 'meta')[]
}

/** 一条快捷键命令的注册选项。 */
export interface ShortcutCommandFace {
  /** 稳定命令 id(本插件前缀,全局唯一)。 */
  readonly id: string
  label(): string
  readonly aliases: readonly string[]
  /** 各平台默认绑定;`primary` 在 macOS 展开为 Meta,其余为 Control。 */
  readonly defaults: Readonly<Record<string, ShortcutBindingFace>>
  /** 允许触发的作用区(`page`=非可编辑区,`editable`=输入框内)。 */
  readonly regions: readonly ('page' | 'editable' | 'terminal')[]
  readonly modals: readonly string[]
  /** 解析动作;返回 handled 即执行 `run()`。 */
  resolve(context: { readonly region: string; readonly target: Element | null }): ShortcutResolutionFace
}

/** 一次快捷键解析的结论。 */
export type ShortcutResolutionFace =
  | { readonly status: 'handled'; run(): void }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'pass' }

/** 快捷键服务消费面(ctx.shortcuts)。 */
export interface ShortcutsFace {
  register(command: ShortcutCommandFace): () => void
}

// ── 会话上下文(命令回调收到的 ClientSessionContext 子集)───────────────────

/**
 * 命令回调收到的会话上下文子集。
 *
 * 只读 `sessionId`:参谋的所有数据面走 access 守卫路由(以 parent 为参数),
 * 不需要客户端会话快照。
 */
export interface SessionContextFace {
  readonly sessionId: string
}

/** 浏览器插件上下文(本插件消费的服务子集)。 */
export interface AdviserClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly sidebarRightTabs: SidebarRightTabsFace
  readonly sidebarRight: SidebarRightFace
  readonly sessions: SessionsFace
  readonly resources: ResourcesFace
  readonly commandUi: CommandUiFace
  readonly shortcuts: ShortcutsFace
  readonly uiConversation: UiConversationFace
}
