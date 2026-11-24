/**
 * @eterna/adviser 浏览器半边:右侧栏「参谋」tab。
 *
 * ## 三段注册(ui-sidebar-right 的 Extension seats 契约 + 资源模型)
 * 1. **资源提供者** —— `ctx.resources.register({ protocol: 'adviserchat', open })`:
 *    把 `dsh-resource://adviserchat/session/<子会话>?parent=<主会话>` 换成
 *    `SessionReference`。没有它,tab 的 contentId 只是字符串,刷新后无法恢复会话。
 * 2. **tab 类型** —— `ctx.sidebarRightTabs.register({ id, kind, priority, title, multiple })`
 *    静态声明,无运行时钩子;`multiple: true` 允许同一会话开多个独立参谋
 *    (地址由 `openResource` 铸造,含不同 childSessionId → 天然不同 tab)。
 * 3. **body** —— `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 类型 id,
 *    children: { <会话子槽位> } }, Body)`:body 声明自己的会话子槽位,框架据此发放
 *    `SessionProvider` 席;子槽位里再渲染 `conversation.content` embedded Factory。
 *
 * ## 为什么 kind 不自建独立面板
 * 计划书 R7:不接管上游 kind(subagentchat 属 ui-subagent),用独立 `adviser` kind 与
 * 独立 id。页面地址(tab 由导引/命令打开)落在选择面板,资源地址落在真实对话。
 *
 * 类型采用本地结构面(client-types.ts):浏览器运行的 cordis 服务面比本仓库安装
 * 类型宽,跨包类型导入会引入 dsh 客户端包依赖;运行时鸭子一致,构建期零外部类型
 * 依赖(@eterna/panel / @eterna/attachments 同款纪律)。
 */
import { AdviserConversation, AdviserPanel, CONVERSATION_SLOT } from './AdviserPanel.tsx'
import { createSelectionAction } from './AdviserSelectionAction.tsx'
import { ADVISER_CHAT_ADDRESS, ADVISER_PROTOCOL, parseAdviserChatAddress } from './address.ts'
import {
  ADVISER_SELECTION_ID,
  ADVISER_TAB_KIND,
  registerCommand,
  registerSelectionInteraction,
  registerShortcut,
} from './entries.ts'
import { NS, en, zh } from './locales.ts'
import { createAdviserChatProvider } from './resource.ts'
import { injectAdviserStyles } from './styles.ts'
import type { AdviserClientContext } from './client-types.ts'

/** tab 类型的全系统身份(ui-sidebar-right 契约:id 唯一,kind 至多一 builtin 一 extension)。 */
const TAB_TYPE_ID = '@eterna/adviser/panel'

/** 选中文字浮层所在的键控槽位(ui-chat 声明;key = 交互 id)。 */
const SELECTION_SLOT = 'conversation.chat.text-interaction'

/**
 * 依赖服务:slot 注册表、语言、右侧栏 tab 类型注册表、右侧栏导航、会话、资源、
 * 命令面、快捷键、会话交互注册表(P7 三入口)。
 *
 * 注意 sidebarRightTabs 与 sidebarRight 是两个服务——前者注册**类型**,后者
 * **导航**(命令与快捷键靠它开 tab)。
 */
export const inject = [
  'slots',
  'locale',
  'sidebarRightTabs',
  'sidebarRight',
  'sessions',
  'resources',
  'commandUi',
  'shortcuts',
  'uiConversation',
]

/**
 * 参谋面板插件体:注入样式、注册字典、资源提供者、tab 类型与其 body。
 * @param ctx - 浏览器插件上下文。
 * @returns disposer(注册随插件 fiber 自撤)。
 */
export function apply(ctx: AdviserClientContext): () => void {
  const disposeStyles = injectAdviserStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)

  const disposeResource = ctx.resources.register(createAdviserChatProvider(ctx.sessions))

  const disposeType = ctx.sidebarRightTabs.register({
    id: TAB_TYPE_ID,
    kind: ADVISER_TAB_KIND,
    // 资源地址声明:只有参谋地址进入本类型(页面地址由 openTab 按 kind 打开)。
    patterns: [`${ADVISER_CHAT_ADDRESS}**`],
    priority: 'extension',
    canOpen: address => parseAdviserChatAddress(address) !== undefined,
    title: () => t('tab.title'),
    multiple: true,
    keepMounted: true,
    // 导引页入口:资源型类型不会自己出现在任何菜单里,没有这张卡片用户就无从
    // 打开参谋(点击=openTab(kind),落在选择/新建面板)。
    guide: [{
      id: 'open',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  })

  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_TYPE_ID,
    locale: NS,
    // 会话子槽位:声明才会拿到 SessionProvider 席(见 AdviserPanel 头注)。
    children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
    inject: () => ({ t }),
  }, AdviserPanel as never))

  const disposeConversation = ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
    name: CONVERSATION_SLOT,
    locale: NS,
    inject: () => ({ t }),
  }, AdviserConversation as never))

  // ── P7 三入口 ────────────────────────────────────────────────────────────
  // ① 斜杠命令 /adviser ② 快捷键 ③ 选中文字(手势定义 + 它的键控浮层)。
  //
  // 三入口各自独立容错:上游在这些扩展点上会**抛异常**(快捷键默认绑定与别的
  // 插件重叠就 throw,命令名与宿主命令重名也在候选合成时 throw)。P7 浏览器
  // 实证里一次 ⌥⌘K 撞车就导致 apply 中断、面板整体失踪——一个可选入口不该
  // 有这种杀伤力。降级策略:丢掉坏掉的那个入口,其余照常,并留一条 warn。
  const guarded = <T>(label: string, register: () => T, fallback: T): T => {
    try {
      return register()
    } catch (error) {
      console.warn(`[adviser] ${label} 注册失败(其余入口不受影响):`, error)
      return fallback
    }
  }
  const noop = (): void => {}

  const disposeCommand = guarded('斜杠命令', () => registerCommand(ctx), noop)
  const disposeShortcut = guarded('快捷键', () => registerShortcut(ctx), noop)
  const disposeInteraction = guarded('选中文字交互', () => registerSelectionInteraction(ctx), noop)
  const selectionAction = createSelectionAction(ctx)
  const disposeSelection = ctx.slots.inject(SELECTION_SLOT, () => ctx.slots.register({
    name: SELECTION_SLOT,
    key: ADVISER_SELECTION_ID,
    locale: NS,
    inject: () => ({ t }),
  }, selectionAction as never))

  return () => {
    disposeSelection()
    disposeInteraction()
    disposeShortcut()
    disposeCommand()
    disposeConversation()
    disposeBody()
    disposeType()
    disposeResource()
    disposeLocale()
    disposeStyles()
  }
}

/** 协议常量对外导出(门禁与探针用)。 */
export { ADVISER_PROTOCOL }
