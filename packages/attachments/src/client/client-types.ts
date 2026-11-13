/**
 * 浏览器半边的本地结构类型:仅声明本插件消费的服务面(slots / locale /
 * uiConversation),与 dsh 客户端壳的运行时形状鸭子一致。不导入跨包类型,
 * 客户端 bundle 因此零运行时依赖(基线外部模块除外:react)。
 */

/** 槽位注册选项(list 槽的运行时字段)。 */
export interface SlotRegisterOptions {
  readonly name: string
  /** list 槽条目 id(必备,dsh 客户端 slot 纪律)。 */
  readonly id: string
  readonly order?: number
  readonly locale?: string
  /** 注入面:普通值/回调(本插件无 hooks 份额)。 */
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

/** 会话草稿附件描述符(createDrafts 的返回元素;id 即 inputActions.addAttachments 的入参)。 */
export interface ComposerAttachmentFace {
  readonly id: string
  readonly [key: string]: unknown
}

/**
 * conversation 服务消费面(dsh-client-ui-conversation 的 ConversationController
 * 结构子集,客户端 Context 注入名 'conversation'):createDrafts 是把浏览器 File
 * 注册为草稿附件的正规入口——图片/文件的后台上传、预览、失败重试由该服务与
 * 上游 ui-attachment 附件栏接管。注意区分同名前缀的 'uiConversation' 服务
 * (目标无关注册表,无会话动作)。
 */
export interface ConversationFace {
  /**
   * 注册运行时草稿附件:浏览器 MIME 为受支持图片类型的成为图片草稿(带预览),
   * 其余成为文件草稿;后台上传随注册即启动(uploadImages=true 时含图片)。
   * @param sessionId - 目标会话(Agent 作用域标识)。
   * @param files - 浏览器 File 列表。
   * @param uploadImages - 会话是否接受图片上传(主会话 composer 恒 true)。
   */
  createDrafts(
    sessionId: string,
    files: readonly File[],
    uploadImages: boolean,
  ): readonly ComposerAttachmentFace[]
}

/** session 标准 props 的输入动作面(结构子集;官方注入,与 setDraft/submit 同源)。 */
export interface InputActionsFace {
  /** 追加浏览器持有的草稿附件 id 到当前输入草稿(附件栏随之显示,发送时随消息提交)。 */
  addAttachments(ids: readonly string[]): boolean
}

/** 浏览器插件上下文(本插件消费的最小服务面)。 */
export interface AttachmentsClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly conversation: ConversationFace
}
