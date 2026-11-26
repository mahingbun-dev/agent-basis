/**
 * 会话绑定探针(2026-11-18 收尾):
 * 注册在 `conversation.input.overlay`(ui-conversation 声明,list + scope='session'),
 * 只把 ui-session 会话标准席位下发的 `sessionId` 写进 session-bridge,渲染 null
 * ——不产生 DOM、不占布局、不抢焦点。
 *
 * 为什么需要它:模型菜单在 body 上命令式挂载,拿不到 slot props;localStorage 的
 * 导航快照在多 tab/多会话下可能指向另一会话(偏置读/重置会落错会话)。
 *
 * 为什么还要过滤子会话(2026-11-25 实机):参谋面板(以及上游子代理聊天)在右栏
 * 里渲染的是**子会话**的完整 conversation,同一个 overlay 席位照样渲染探针。
 * 后挂载的子会话会覆盖桥 → 主会话的模型菜单把 `selectModel` 发到
 * `…--adviser-N`,宿主以 `session/agent-busy`(owned by subagent routing)拒绝。
 * 子会话判定由注册侧按 `ctx.sessions.subagentAddress` 注入(与上游模型选择器的
 * 可用性门同源)——子会话根本不该成为「主对话会话」。
 */
import { useEffect } from 'react'
import { bindActiveSessionId, shouldBindActiveSession } from './session-bridge.ts'

/** slot 运行时 props:session 作用域的标准席位(ui-session 合并下发)。 */
export interface SessionProbeProps {
  readonly sessionId?: string
  /** 本席位所属会话是否为 subagent 子会话(参谋/子代理);由注册侧 inject 下发。 */
  readonly subagent?: boolean
}

export function SessionBindingProbe(props: SessionProbeProps): null {
  const { sessionId, subagent } = props
  useEffect(() => {
    if (!shouldBindActiveSession(sessionId, subagent)) return
    bindActiveSessionId(sessionId)
  }, [sessionId, subagent])
  return null
}