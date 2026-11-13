/**
 * 输入框工具行「附件」按钮(官方席位 conversation.input.left,list,session 作用域)。
 *
 * 点击打开原生文件选择,选中文件走两步正规组合:
 *  ① conversation.createDrafts 注册草稿附件(图片/文件后台上传即启动);
 *  ② inputActions.addAttachments 把草稿 id 挂进当前输入草稿(附件栏显示、
 *     发送时随消息提交——与上游「+」菜单"文件"命令/粘贴/拖拽的最终状态同源)。
 * 预览/上传进度/失败重试全部由上游 ui-attachment 附件栏接管,本按钮不自建上传态。
 * 可见性门与上游 InputBar 同源:useAccess('fileUploads/upload')(租户策略
 * SESSION_UNARY_ACTIONS,T1 修复)为 false 时禁用;composer 锁定时禁用。
 */
import { useRef, type ChangeEvent } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { ConversationFace, InputActionsFace } from './client-types.ts'

/** session 作用域插槽的标准 props 官方注入面(结构子集,运行时鸭子一致)。 */
export interface AttachButtonProps {
  /** 当前会话标识;无会话时上游不渲染本席位(防御性判空)。 */
  readonly sessionId?: unknown
  /** composer 是否锁定(工具行语义)。 */
  readonly locked?: boolean
  /** 会话资源访问答案(结构子集;undefined 仅出现在无会话占位栏)。 */
  readonly useAccess?: (action: string) => boolean | undefined
  /** 官方注入的输入动作面(addAttachments=草稿附件挂载)。 */
  readonly inputActions?: InputActionsFace
  /** 本插件 inject 面提供的翻译函数。 */
  readonly t?: (key: string) => string
  /** 本插件 inject 面提供的会话控制器消费面。 */
  readonly conversation?: ConversationFace
}

/** 附件按钮(轻 React 实现,与 @eterna/panel 客户端同构建)。 */
export function AttachButton(props: AttachButtonProps): unknown {
  const { sessionId, locked, useAccess, inputActions, t, conversation } = props
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    // 清空 value 允许连续选择同一文件。
    event.target.value = ''
    if (files.length === 0 || typeof sessionId !== 'string') return
    // 正规组合:服务面注册草稿(上传即启动)→ 官方动作面把 id 挂进当前输入草稿
    // (附件栏显示+发送时随消息提交;与「+」菜单/粘贴/拖拽的最终状态面同源)。
    const drafts = conversation?.createDrafts(sessionId, files, true)
    if (drafts !== undefined && drafts.length > 0) inputActions?.addAttachments(drafts.map(d => d.id))
  }

  const label = t?.('attach') ?? '附件'
  const hint = t?.('attach.hint') ?? '添加图片或文件,发送后 Agent 可直接读取处理'
  const uploadDenied = useAccess?.('fileUploads/upload') === false
  const disabled = locked === true || uploadDenied

  return (
    <span data-eterna-attach="tooltip" data-tip={`${label} — ${hint}`}>
      <button
        type="button"
        data-eterna-attach="button"
        aria-label={label}
        title={hint}
        disabled={disabled}
        onClick={() => { inputRef.current?.click() }}
      >
        <Icon name="paperclip" size={16} />
      </button>
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
    </span>
  )
}
