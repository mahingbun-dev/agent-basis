/**
 * 对话框一键触发条:挂 DSH 官方席位 `conversation.input.dock`
 * (composer 卡上方整宽常驻条,list,session 作用域;hero 首屏同样渲染)。
 * 席位变更史见 index.ts 注册处注释(2026-11-17:input.right 紧凑席位放不下
 * 整宽工具条,溢出视口)。
 *
 * 数据源(2026-11-20 改版):每用户各自一套,静态 GUIDE_PROMPTS 退役——经
 * chipsSource(apply() 手写 observable,守卫端点 eternaPanel/chips 按 cookie
 * 身份拉取)useSyncExternalStore 订阅;设置分区「流程启动条」保存成功后
 * refreshChips() 同步。visible=false 或无启用条目 → 整条不渲染(初始为空,
 * 用户拍板);首拉未归(loading)同样不渲染,避免闪空条。
 *
 * 点击语义(用户定版):启动流程——setDraft 写入流程启动语,**由 useInput
 * 草稿落位自动触发 submit**(Lexical 写入异步提交,立即 submit 会被
 * "空白草稿不可发送"守卫静默拒绝——用户实测反馈 2026-11-05)。
 * Agent 收到 kickoff 后先向用户确认所需信息,再执行;R3 照常走审批。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { chipsBarEntries } from '../chips.ts'
import type { ChipsClientState, ExternalSource } from './client-types.ts'

/** 官方注入的输入动作面(结构子集,运行时鸭子一致)。 */
export interface InputActionsFace {
  /** 用纯文本替换整个草稿(移除引用 chips)。 */
  setDraft(text: string): void
  /** Enter 提交(裁决/认领/默认 sink 在内部)。 */
  submit(): void
}

/** chipsSource 缺席时的稳定回退(不渲染;hooks 参数必须引用稳定)。 */
const NO_SOURCE_STATE: ChipsClientState = { status: 'loading' }
const subscribeNoop = (): (() => void) => () => undefined
const getSnapshotNoop = (): ChipsClientState => NO_SOURCE_STATE

/** session 作用域插槽的标准 props 官方注入面(结构子集)。 */
export interface ComposerDockProps {
  readonly sessionId?: unknown
  readonly inputActions?: InputActionsFace
  /** 官方注入的输入状态选择器钩子(草稿落位监视用)。 */
  readonly useInput?: <S>(selector: (state: { draft: string }) => S) => S
  readonly locked?: boolean
  readonly t?: (key: string) => string
  /** 触发条配置源(index.ts apply() 注入;缺席=旧宿主,整条隐藏)。 */
  readonly chipsSource?: ExternalSource<ChipsClientState>
}

/** chips 条(轻 React 实现,与 PanelPage 同构建)。 */
export function ComposerChips(props: ComposerDockProps): unknown {
  const { inputActions, locked, useInput, chipsSource } = props
  const [pending, setPending] = useState<string | null>(null)
  // 草稿落位监视(官方 useInput 席位;缺省回退定时器)
  const draft: string | undefined = useInput ? useInput(s => s.draft) : undefined
  // 触发条配置(每用户;守卫端点拉取,设置分区保存后经源发布刷新)
  const chipsState: ChipsClientState = useSyncExternalStore(
    chipsSource?.subscribe ?? subscribeNoop,
    chipsSource?.getSnapshot ?? getSnapshotNoop,
  )
  const entries = chipsState.status === 'ready' ? chipsBarEntries(chipsState.config) : []

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

  // 空态整条不渲染(初始为空/总开关关/首拉未归/配置源缺席):触发条是可选
  // 快捷面,不该在无内容时占一行说明文字。
  if (entries.length === 0) return null

  const start = (kickoff: string): void => {
    if (inputActions === undefined || locked === true) return
    inputActions.setDraft(kickoff)
    setPending(kickoff)
  }

  const el = (
    <div data-eterna-panel="chips" data-eterna-panel-chips="true" role="toolbar" aria-label="一键启动基座能力流程">
      <span data-eterna-panel="chips-label">流程启动(Agent 会先向你确认所需信息):</span>
      {entries.map(chip => (
        <button
          key={chip.id}
          type="button"
          data-eterna-panel="chip"
          data-eterna-panel-chip={chip.id}
          disabled={inputActions === undefined || locked === true}
          title={chip.note ?? chip.kickoff}
          onClick={() => start(chip.kickoff)}
        >
          {chip.title}
        </button>
      ))}
    </div>
  )
  return el
}
