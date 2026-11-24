/**
 * 选中文字后的浮动动作(P7):「问参谋」。
 *
 * ## 它是谁渲染的
 * 上游 ui-chat 在对话区上叠了一层 `conversation.chat.text-interaction` 键控
 * 槽位;用户划选文字时,它把手势派发给所有注册的交互定义
 * (`ctx.uiConversation.interactions`),谁调了 `open()` 就渲染谁的键控条目。
 * 本组件就是 `key = ADVISER_SELECTION_ID` 的那一条,由 `entries.ts` 的
 * `registerSelectionInteraction` 触发。
 *
 * 因此它**天然只出现在对话文字旁**,不需要自己监听 mouseup、算坐标、防误触
 * ——定位与生命周期都是上游的职责(见 ui-chat 的 `visibleBounds`,它还会避开
 * 输入框区域)。这是走扩展点而非自建浮层的核心理由。
 *
 * ## 交互
 * 点一下 = 记住选区文本 + 打开参谋面板 + 收起浮层。选区作为首条上下文带去
 * 新建参谋(见 {@link takePendingSelection} 的消费方 AdviserPicker)。
 *
 * 为什么先 `preventDefault` 再点:`onPointerDown` 里取消默认,否则按钮吃下
 * mousedown 会让浏览器先清空选区,`readText()` 随即读到 null(上游 message-quotes
 * 的「引用文本」同一手法)。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { openAdviserTab, rememberSelection } from './entries.ts'
import type { AdviserClientContext } from './client-types.ts'

/** 上游注入给表面组件的选区动作(ui-chat 的 TextInteractionSurface)。 */
export interface SelectionSurfaceProps {
  readonly trigger: string
  readonly dismiss: () => void
  readonly readText: () => string | null
  readonly clearSelection: () => void
  readonly t: (key: string) => string
}

/**
 * 造出绑定到插件上下文的表面组件。
 *
 * 为什么是工厂而不是直接导出组件:组件需要通过 `ctx.sidebarRight` 导航,
 * 而槽位注册的组件是纯 props 组件(上游不给它插件上下文)。工厂在注册时
 * 把 ctx 闭包进去,组件本体只接收上游给的那几个动作。
 * @param ctx - 插件上下文(用于打开参谋 tab)。
 * @returns 槽位组件。
 */
export function createSelectionAction(ctx: AdviserClientContext): (props: SelectionSurfaceProps) => ReactElement {
  /** 「问参谋」浮层动作。 */
  return function AdviserSelectionAction({ dismiss, readText, clearSelection, t }: SelectionSurfaceProps): ReactElement {
    return (
      <button
        type="button"
        className="et-adviser-selection-action"
        // 取消默认,保住选区(否则读到 null 就白点了)。
        onPointerDown={(event) => { event.preventDefault() }}
        onClick={() => {
          const text = readText()
          if (text === null) {
            dismiss()
            return
          }
          rememberSelection(text)
          if (!openAdviserTab(ctx)) {
            // 无屏幕会话:不静默失败,收起浮层(这个场景几乎不可能——选区本来就
            // 发生在某个会话里,但禁止猜到不可能就崩溃)。
            dismiss()
            return
          }
          clearSelection()
          dismiss()
        }}
      >
        <Icon name="comment" size={14} />
        {` ${t('selection.ask')}`}
      </button>
    )
  }
}
