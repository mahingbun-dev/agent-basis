/**
 * 会话绑定探针(2026-11-18 收尾):
 * 注册在 `conversation.input.overlay`(ui-conversation 声明,list + scope='session'),
 * 只把 ui-session 会话标准席位下发的 `sessionId` 写进 session-bridge,渲染 null
 * ——不产生 DOM、不占布局、不抢焦点。
 *
 * 为什么需要它:模型菜单在 body 上命令式挂载,拿不到 slot props;localStorage 的
 * 导航快照在多 tab/多会话下可能指向另一会话(偏置读/重置会落错会话)。
 */
import { useEffect } from 'react'
import { bindActiveSessionId } from './session-bridge.ts'

/** slot 运行时 props:session 作用域的标准席位(ui-session 合并下发)。 */
export interface SessionProbeProps {
  readonly sessionId?: string
}

export function SessionBindingProbe(props: SessionProbeProps): null {
  const { sessionId } = props
  useEffect(() => {
    bindActiveSessionId(sessionId)
  }, [sessionId])
  return null
}
