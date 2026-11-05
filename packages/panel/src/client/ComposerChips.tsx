/**
 * 对话框一键触发条:挂 DSH 官方席位 `conversation.composer.dock`
 * (composer 卡下方常驻条目,list,session 作用域)。
 * 每个 chip 点击 = `inputActions.setDraft(prompt)` + `inputActions.submit()`
 * ——官方 SessionStandardProps 注入的稳定公开输入动作("Stable public input
 * actions for this Session"),与用户按 Enter 完全同路径:R3 动作照常触发
 * 审批卡片,echo/queue/steer 语义全部由官方 composer 承担。
 * 用户零复制粘贴:点一下,Agent 就开始干活(傻瓜式,用户反馈 2026-11-05)。
 */
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
  readonly locked?: boolean
  readonly t?: (key: string) => string
}

/** chips 条(轻 React 实现,与 PanelPage 同构建)。 */
export function ComposerChips(props: ComposerDockProps): unknown {
  const { inputActions, locked } = props
  // 点击语义(用户 2026-11-05 拍板):启动流程而非发送固定内容——
  // 提交该能力的「流程启动语」,Agent 先向用户确认所需信息,再执行。
  const start = (kickoff: string): void => {
    if (inputActions === undefined || locked === true) return
    inputActions.setDraft(kickoff)
    inputActions.submit()
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
