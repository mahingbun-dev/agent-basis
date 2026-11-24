/**
 * 参谋面板的正文(P5):右栏 tab body。
 *
 * ## 一个 tab 两种模式
 * 面板按 `tab.contentId` 的形态分派:
 * - **资源地址**(`dsh-resource://adviserchat/session/<子会话>?parent=<主会话>`)
 *   → 渲染一条真实参谋会话的完整对话。地址由资源提供者换成 `SessionReference`,
 *   再用 `SessionProvider.session` 把作用域切到参谋会话上。
 * - **页面地址**(`sidebar://adviser/<uuid>`,从右栏导引/命令打开)
 *   → 渲染「参谋选择/新建」面板。选中或新建后,`openResource` 把内容换成资源 tab。
 *
 * ## 为什么会话作用域必须显式切
 * 本 body 的槽位 `sidebar.right.pane.tab` 是 session 作用域,但那是**主会话**。
 * 参谋对话要用**参谋会话**的 useSession/useInput/composer,所以本 entry 声明自己
 * 的会话子槽位 `adviser.chat.conversation`(框架据此发放 `SessionProvider` 席),
 * 在 Provider 内渲染子槽位,子槽位里再渲染 `conversation.content` Factory。
 * 上游 `ui-subagent/sidebar-chat` 是同款三段式,本文件照抄其骨架。
 */
import { useCallback, useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@eterna/ui/icons'
import { adviserChatAddress, parseAdviserChatAddress } from './address.ts'
import type { AdviserChatResource } from './resource.ts'
import { AdviserFeedbackBar } from './AdviserFeedbackBar.tsx'
import { AdviserPicker } from './AdviserPicker.tsx'
import type {
  SessionProviderFace, UseResourceFace, UseTabInfoFace,
} from './client-types.ts'

/** 本 entry 声明的会话子槽位名(与 index.ts 的 children 声明一致)。 */
export const CONVERSATION_SLOT = 'adviser.chat.conversation'

/** tab body 收到的框架席位(标准 props 的结构子集)。 */
export interface AdviserPanelProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly useTabInfo: UseTabInfoFace
  readonly useResource: UseResourceFace
  readonly renderSlot: (key: string, owner: object) => ReactNode
  readonly SessionProvider: SessionProviderFace
  /** 当前主会话 id(标准 props;picker 用它作为 parent)。 */
  readonly sessionId?: string | undefined
}

/** tab 内容的模式判定(纯函数,便于单测)。 */
export type PanelMode =
  | { readonly kind: 'conversation'; readonly childSessionId: string; readonly parentSessionId: string; readonly address: string }
  | { readonly kind: 'picker'; readonly contentId: string }

/**
 * 由 tab 的 contentId 判定渲染模式。
 * @param contentId - tab 的 contentId(打开时的地址)。
 * @returns 会话模式(可解析的参谋地址)或选择模式(其余一切)。
 */
export function panelMode(contentId: string): PanelMode {
  const target = parseAdviserChatAddress(contentId)
  return target === undefined
    ? { kind: 'picker', contentId }
    : { kind: 'conversation', ...target, address: contentId }
}

/** 参谋 tab 正文:按模式分派,并承载资源→会话作用域的切换。 */
export function AdviserPanel(props: AdviserPanelProps): ReactElement {
  const { t, useTabInfo, useResource, renderSlot, SessionProvider, sessionId } = props
  const { tab } = useTabInfo()
  const mode = useMemo(() => panelMode(tab.contentId), [tab.contentId])
  // hooks 无条件调用(资源地址与页面地址共用同一条订阅;页面地址解析出 none)。
  const resource = useResource<AdviserChatResource>(tab.contentId)

  const openTarget = useCallback((childSessionId: string, parent: string): void => {
    // replaceTab:true —— 新内容接管本 tab 的位置并**自动关掉本 tab**(上游
    // SidebarRightPlacement 的语义)。不这么写就得自己 close(),而 close 与
    // openResource 的先后会让新 tab 落到「当前活跃 pane」而不是原位置。
    // 边界:目标参谋已在别处打开时上游只做 reveal、不关本 tab(选择面板留着,
    // 用户可以自己关)——比强行 close 后把用户丢到不知哪里的 pane 更可预期。
    tab.actions.openResource(adviserChatAddress(parent, childSessionId), { replaceTab: true })
  }, [tab])

  if (mode.kind === 'picker') {
    if (sessionId === undefined || sessionId === '') {
      return (
        <section data-eterna-adviser="panel" aria-labelledby="et-adviser-heading">
          <h2 id="et-adviser-heading">
            <Icon name="comment" size={18} label={t('panel.title')} />
            {` ${t('panel.title')}`}
          </h2>
          <p className="et-adviser-hint">{t('panel.noSession')}</p>
        </section>
      )
    }
    return <AdviserPicker t={t} parent={sessionId} onPick={openTarget} />
  }

  if (resource.status === 'failed') {
    return (
      <section data-eterna-adviser="panel" aria-labelledby="et-adviser-heading">
        <h2 id="et-adviser-heading">
          <Icon name="comment" size={18} label={t('panel.title')} />
          {` ${t('panel.title')}`}
        </h2>
        <p className="et-adviser-error" role="alert">{t('panel.openFailed')}</p>
      </section>
    )
  }
  const value = resource.value
  if (value === undefined) {
    return (
      <section data-eterna-adviser="panel" aria-busy="true" aria-labelledby="et-adviser-heading">
        <h2 id="et-adviser-heading">
          <Icon name="comment" size={18} label={t('panel.title')} />
          {` ${t('panel.title')}`}
        </h2>
        <p className="et-adviser-hint">{t('panel.loading')}</p>
      </section>
    )
  }
  return (
    <div data-eterna-adviser="chat">
      <div data-eterna-adviser="conversation">
        <SessionProvider
          session={value.reference}
          empty={() => <p className="et-adviser-error" role="alert">{t('panel.detached')}</p>}
        >
          {renderSlot(CONVERSATION_SLOT, {})}
        </SessionProvider>
      </div>
      {/* 回写条只出现在参谋 tab:主会话的输入区不长这条栏(P6 头注)。 */}
      <AdviserFeedbackBar t={t} parent={value.parentSessionId} />
    </div>
  )
}

/** 会话子槽位正文收到的 props(标准 session props 的结构子集)。 */
export interface AdviserConversationProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly useSession: <T>(selector: (snapshot: {
    readonly blank: boolean
    readonly running: boolean
    readonly awaitingFirstTurn: boolean
    readonly promptAttempted: boolean
    readonly openState: string
  }) => T) => T
  readonly useConversation: <T>(selector: (snapshot: {
    readonly activeTargets: ReadonlySet<unknown>
  }) => T) => T
  readonly renderFactorySlot: (name: string, props: object, options?: {
    readonly slots?: Record<string, (props: never) => ReactNode>
  }) => ReactNode
}

/** 固定的会话视图选择:只选 chat 视图(与上游 sidebar-chat 同一手法)。 */
function FixedChatConversationView(props: {
  readonly renderSlot: (key: string, owner: object) => ReactNode
}): ReactNode {
  return props.renderSlot('conversation.session', { view: 'chat' })
}

/**
 * 在参谋会话作用域内渲染 `conversation.content` 的 embedded 变体。
 *
 * phase/hero 推导逐行照抄上游 `ui-subagent/sidebar-chat` 的 ConversationSlotPanel
 * (settling/hero/active 三态决定空态外观);不同处只有一处:`widthControls` 不选,
 * 用 Factory 自带的空实现(侧栏窄,不需要宽度控制条)。
 */
export function AdviserConversation(props: AdviserConversationProps): ReactElement {
  const { useSession, useConversation, renderFactorySlot } = props
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const settling = shellPhase === 'blank' && session.openState === 'loading'
  const hero = shellPhase === 'blank' && session.openState === 'open'
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return (
    <>
      {renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
        slots: { views: FixedChatConversationView },
      })}
    </>
  )
}
