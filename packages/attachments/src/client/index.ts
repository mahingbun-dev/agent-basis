/**
 * @eterna/attachments 浏览器半边:输入框工具行「附件」按钮。
 *
 * 官方席位 conversation.input.left(list,session 作用域,InputBar 工具行权限/
 * 计划按钮旁)。点击经 uiConversation.createDrafts 注册草稿附件;附件栏(预览/
 * 上传/重试)由上游 ui-attachment 占位的 conversation.input.attachments 席位
 * 渲染,本插件不自建上传管线与附件 UI。
 *
 * 类型采用本地结构面(client-types.ts):浏览器运行的 cordis 服务面比本仓库
 * 安装类型宽,跨包类型导入会引入 dsh 客户端包依赖;运行时鸭子一致,构建期
 * 零外部类型依赖(@eterna/panel 同款纪律)。
 */
import { AttachButton } from './AttachButton.tsx'
import { NS, en, zh } from './locales.ts'
import { injectAttachStyles } from './styles.ts'
import type { AttachmentsClientContext } from './client-types.ts'

/** 依赖服务:slot 注册表、语言、会话控制器(草稿附件入口;注入名 'conversation'
 * = dsh-client-ui-conversation 的 ConversationController,'uiConversation' 是
 * 另一个目标无关注册表服务,不可混用)。 */
export const inject = ['slots', 'locale', 'conversation']

/** 附件入口插件体:注册字典与工具行按钮贡献。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销字典注册的 disposer(slot 贡献随插件 fiber 自撤)。 */
export function apply(ctx: AttachmentsClientContext): () => void {
  injectAttachStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)
  const disposeSlot = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'eterna-attachments-trigger',
    locale: NS,
    inject: () => ({ t, conversation: ctx.conversation }),
  }, AttachButton))
  return () => {
    disposeSlot()
    disposeLocale()
  }
}
