/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面(slots / locale),
 * 与 dsh 客户端壳的运行时形状鸭子一致(panel/client-types.ts 同款纪律)。
 * 不导入跨包类型,客户端 bundle 因此零运行时依赖(基线外部模块除外:react)。
 */

/** 槽位注册选项(list / keyed 两用的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  /** list 槽条目 id(sidebar.panellist 用)。 */
  readonly id?: string
  /** keyed 槽单元格 key(main 用)。 */
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

/**
 * 会话导航服务消费面(宿主 ui-workspace 的 `uiWorkspace` 服务,2026-11-19
 * 「主会话」显式入口用):只取打开会话一个动作。
 */
export interface UiWorkspaceFace {
  /** 选中会话并把会话区切过去(宿主导航动作;未知 id 由宿主侧收敛)。 */
  openSession(sessionId: string): void
}

/** 浏览器插件上下文(本插件消费的最小服务面)。 */
export interface WorkbenchClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  /** 会话导航面(ui-workspace;裸宿主/测试可缺席,缺席时入口不渲染)。 */
  readonly uiWorkspace?: UiWorkspaceFace
}
