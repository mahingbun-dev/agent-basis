/**
 * 对话框一键触发条:挂 DSH 官方席位 `conversation.composer.dock`
 * (composer 卡下方常驻条目,list,session 作用域)。
 *
 * 点击语义(用户定版):启动流程——setDraft 写入流程启动语,**由 useInput
 * 草稿落位自动触发 submit**(Lexical 写入异步提交,立即 submit 会被
 * "空白草稿不可发送"守卫静默拒绝——用户实测反馈 2026-11-05)。
 * Agent 收到 kickoff 后先向用户确认所需信息,再执行;R3 照常走审批。
 */
import { useEffect, useState } from 'react'
import { GUIDE_PROMPTS } from '../prompts.ts'

/** 官方注入的输入动作面(结构子集,运行时鸭子一致)。 */
export interface InputActionsFace {
  /** 用纯文本替换整个草稿(移除引用 chips)。 */
  setDraft(text: string): void
  /** Enter 提交(裁决/认领/默认 sink 在内部)。 */
  submit(): void
}

/** session 作用域插槽的标准 props 官方注入面(结构子集)。 */
export interface ComposerDockProps {
  readonly sessionId?: unknown
  readonly inputActions?: InputActionsFace
  /** 官方注入的输入状态选择器钩子(草稿落位监视用)。 */
  readonly useInput?: <S>(selector: (state: { draft: string }) => S) => S
  readonly locked?: boolean
  readonly t?: (key: string) => string
}

/** chips 条(轻 React 实现,与 PanelPage 同构建)。 */
export function ComposerChips(props: ComposerDockProps): unknown {
  const { inputActions, locked, useInput } = props
  const [pending, setPending] = useState<string | null>(null)
  // 草稿落位监视(官方 useInput 席位;缺省回退定时器)
  const draft: string | undefined = useInput ? useInput(s => s.draft) : undefined

  // 自动提交:草稿写入落位(含 kickoff 前缀)→ 延迟一拍 submit(LIFO 稳定)
  useEffect(() => {
    if (pending === null || inputActions === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    if (useInput && typeof draft === 'string' && draft.includes(pending.slice(0, 12))) {
      timer = setTimeout(() => {
        inputActions.submit()
        setPending(null)
      }, 120)
    } else if (!useInput) {
      timer = setTimeout(() => {
        inputActions.submit()
        setPending(null)
      }, 200)
    }
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [pending, draft, inputActions, useInput])

  const start = (kickoff: string): void => {
    if (inputActions === undefined || locked === true) return
    inputActions.setDraft(kickoff)
    setPending(kickoff)
  }

  const el = (
    <div data-basis-panel="chips" data-basis-panel-chips="true" role="toolbar" aria-label="一键启动基座能力流程">
      <span data-basis-panel="chips-label">流程启动(Agent 会先向你确认所需信息):</span>
      {GUIDE_PROMPTS.filter(entry => entry.capability !== 'memory').map(entry => (
        <button
          key={entry.id}
          type="button"
          data-basis-panel="chip"
          data-basis-panel-chip={entry.id}
          disabled={inputActions === undefined || locked === true}
          title={entry.kickoff ?? entry.prompt}
          onClick={() => start(entry.kickoff ?? entry.prompt)}
        >
          {entry.title}
        </button>
      ))}
    </div>
  )
  return el
}
