/**
 * 三个入口(P7):斜杠命令 `/adviser`、快捷键、选中文字。
 *
 * ## 为什么三个入口都要
 * 参谋是**旁注式**能力:用户想到它的时候,人正待在主会话里(光标在输入框、
 * 或刚选中一段对话文字),不在参谋面板里。只做右侧栏导引卡片,等于要求用户
 * 先离开当前语境去找入口——这就是「可有可无的功能」和「随手可用的助手」的
 * 区别。三入口各覆盖一种「想到的瞬间」:
 *
 * | 入口 | 覆盖的场景 | 上游扩展点 |
 * |---|---|---|
 * | `/adviser` | 打字时想到,习惯命令的人 | `ctx.commandUi.register`(action 变体) |
 * | ⌥⌘K | 手在键盘上,不想离开输入框 | `ctx.shortcuts.register` |
 * | 选中文字 | 读到某段想追问问「这段什么意思/下一步」 | `ctx.uiConversation.interactions.register` |
 *
 * ## 共同落点
 * 三者都只做一件事:**在当前屏幕会话的右侧栏开一个参谋页面 tab**
 * (`ctx.sidebarRight.openTab('adviser')`)。带选区的那条会先记下选区文本,
 * 新建参谋时作为首条上下文(见 {@link takePendingSelection})。
 *
 * 为什么不像上游 ui-subagent 那样自己拿 tab 上下文:三个入口都在**主会话**里
 * 发生,那里没有参谋 tab 的 `tab.actions`;导航控制器是唯一有权限写别的
 * 会话右栏的入口。
 *
 * ## 上游契约的三个坑(2026-11-24 从 rc.1 源码读出)
 * 1. **命令名不能与宿主命令重名**:候选合成阶段会显式抛错(不是静默覆盖),
 *    故用本包私有名 `adviser`;
 * 2. **快捷键 `resolve()` 必须同步决定**:它返回 `{status:'handled', run}` 之后
 *    才执行,因此打开动作放在 `run` 里,而可用性判断(有无屏幕会话)放外面
 *    ——没有会话时返回 `blocked` 并给出原因,而不是静默什么都不做;
 * 3. **选区交互的 `open()` 只是「选我渲染」**:真正的渲染发生在
 *    `conversation.chat.text-interaction` 键控槽位里,key 必须等于交互 id。
 */
import { NS } from './locales.ts'
import type {
  AdviserClientContext,
  SessionContextFace,
  ShortcutResolutionFace,
  TextInteractionRequestFace,
} from './client-types.ts'

/** 斜杠命令名(不带斜杠)。 */
export const ADVISER_COMMAND_NAME = 'adviser'

/** 快捷键命令 id(前缀本包名,避免与上游命令冲突)。 */
export const ADVISER_SHORTCUT_ID = '@eterna/adviser/open'

/**
 * 参谋快捷键的物理键码:⌥⌘J。
 *
 * ## 为什么不是 ⌥⌘K(初版选择,实机撞车后改)
 * `session.search` 在 web 上默认占 ⌘K,**并把 ⌥⌘K 列为它的 web 回退组合**;
 * 上游 `ShortcutRegistry.register` 发现默认绑定重叠会**抛错**(不是警告),而抛错
 * 发生在 `apply` 里 → 整个插件 fiber 失败,连此前已注册成功的 `/adviser` 命令
 * 一起被回收。P7 浏览器实证时正是三个入口全哑,靠一次性诊断才看到
 * `Conflicting shortcut defaults: @eterna/adviser/open and session.search (web:macos)`。
 *
 * 选 J 的依据:实测本机上游客户端包用掉的物理键码是
 * A/B/F/G/K/N/O/P/R/T/W(遍历 30+ 个 `dsh-client-ui-*` 产物),**J 未被占用**。
 */
export const ADVISER_SHORTCUT_CODE = 'KeyJ'

/** 选中文字交互的 id,同时是键控槽位条目 key。 */
export const ADVISER_SELECTION_ID = 'adviser-selection'

/** 参谋 tab kind(与 index.ts 注册的类型一致;打开面板靠它)。 */
export const ADVISER_TAB_KIND = 'adviser'

/**
 * 从选中文字带过来的首条上下文(一次性)。
 *
 * 为什么用模块级变量而不是 React 状态:选区的发生地在**主会话**的对话区,
 * 而消费地在**参谋面板**(另一个 tab、另一棵 React 树)。两者之间没有共同的
 * React 祖先,唯一现实的通道是这个模块。面板在新建时读一次即清空,避免
 * 用户下次开参谋时莫名其妙地带着上一段旧选区。
 */
let pendingSelection: string | undefined

/** 记下一次待用的选区(空文本视为没有)。 */
export function rememberSelection(text: string | undefined): void {
  const trimmed = text?.trim() ?? ''
  pendingSelection = trimmed === '' ? undefined : trimmed
}

/** 取走待用选区(取后即清)。 */
export function takePendingSelection(): string | undefined {
  const value = pendingSelection
  pendingSelection = undefined
  return value
}

/** 当前屏幕会话 id(三个入口都用它当投递目标;无会话时为 undefined)。 */
function screenSession(ctx: AdviserClientContext): string | undefined {
  try {
    return ctx.sidebarRight.mounted.getSnapshot()
  } catch {
    return undefined
  }
}

/**
 * 打开参谋 tab(命令与快捷键的公共动作)。
 * @param ctx - 插件上下文。
 * @returns 是否真的打开了(无屏幕会话时为 false)。
 */
export function openAdviserTab(ctx: AdviserClientContext): boolean {
  if (screenSession(ctx) === undefined) return false
  ctx.sidebarRight.openTab(ADVISER_TAB_KIND)
  return true
}

/** 注册斜杠命令 `/adviser`。 */
export function registerCommand(ctx: AdviserClientContext): () => void {
  const t = ctx.locale.bind(NS)
  return ctx.commandUi.register({
    name: ADVISER_COMMAND_NAME,
    label: () => t('command.label'),
    description: () => t('command.description'),
    // 没有屏幕会话时右栏无所依附;菜单里不显示,而不是显示一个点了没反应的条目。
    available: () => screenSession(ctx) !== undefined,
    ui: {
      kind: 'action',
      run: (session: SessionContextFace) => {
        // 命令发生在某个具体会话里;右栏挂在同一个会话上。会话 id 只做存在性
        // 校验——真正的导航由 openTab 落到「当前屏幕会话」。
        if (session.sessionId === '') return
        openAdviserTab(ctx)
      },
    },
  })
}

/**
 * 注册快捷键。
 *
 * 注册失败**不能中断插件**(上游在默认绑定撞车时抛错):本函数把异常吃掉并
 * 记一条 console.warn——参谋的另外两个入口(斜杠命令、选中文字)照常可用,
 * 总比整个面板因为一个键位冲突而消失好。返回的 disposer 在失败时是空操作。
 */
export function registerShortcut(ctx: AdviserClientContext): () => void {
  const t = ctx.locale.bind(NS)
  /** 各平台同一组合:J + primary(⌘/Ctrl)+ alt(键码选择见 ADVISER_SHORTCUT_CODE)。 */
  const binding = { code: ADVISER_SHORTCUT_CODE, modifiers: ['primary' as const, 'alt' as const] }
  try {
    return ctx.shortcuts.register({
      id: ADVISER_SHORTCUT_ID,
      label: () => t('shortcut.label'),
      aliases: ['adviser', '参谋'],
      defaults: {
        'desktop:macos': binding,
        'desktop:windows': binding,
        'desktop:linux': binding,
        'web:macos': binding,
        'web:windows': binding,
        'web:linux': binding,
      },
      // 输入框内也要能唤起:用户常常正打着字才想到要问参谋。终端里不抢键。
      regions: ['page', 'editable'],
      modals: [],
      resolve: (): ShortcutResolutionFace => {
        if (screenSession(ctx) === undefined) {
          return { status: 'blocked', reason: t('shortcut.noSession') }
        }
        return { status: 'handled', run: () => { openAdviserTab(ctx) } }
      },
    })
  } catch (error) {
    // 键位被上游占用等情况:降级为「没有快捷键」,不牵连其它入口。
    console.warn('[adviser] 快捷键注册失败(其它入口不受影响):', error)
    return () => {}
  }
}

/**
 * 注册选中文字交互(手势消费方)。
 *
 * 只认 `selection` 触发(右键菜单不是本功能的语义),且要求确有选区文本。
 * 命中后 `open()` 让自己的键控表面被渲染——那个表面就是
 * {@link AdviserSelectionAction}(在 `conversation.chat.text-interaction` 槽里)。
 */
export function registerSelectionInteraction(ctx: AdviserClientContext): () => void {
  return ctx.uiConversation.interactions.register({
    id: ADVISER_SELECTION_ID,
    onInteraction: (request: TextInteractionRequestFace) => {
      if (request.trigger !== 'selection') return
      if (!request.hasSelection) return
      if (screenSession(ctx) === undefined) return
      request.open()
    },
  })
}
