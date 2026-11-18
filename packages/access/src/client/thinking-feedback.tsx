/**
 * 思考强度显式反馈(2026-11-18 V2):
 * 在 assistant 消息动作条(conversation.chat.assistant-actions,ui-chat 声明的原生
 * list slot)追加两枚轻按钮「想浅点/想深点」——把用户对某条回答的思考量判断
 * 变成会话级偏置(±0.2、同向累计、反向抵消、24h 半衰、钳位 ±0.5)。
 *
 * 纪律:
 * - 零新页面/零新入口:只注册上游 slot(list/scope=session,props 带 messageId);
 * - 纯文字按钮(无手写 SVG;图标集无 minus,不硬凑);
 * - 令牌 `--et-*`、focus-visible 光圈、prefers-reduced-motion(样式在 styles.ts);
 * - 防重复点击:请求中 disabled;成功后短暂显示「已调浅/已调深」;
 * - 失败就地 aria-live 文案,不打断对话、不关闭任何面板。
 */
import { useEffect, useRef, useState } from 'react'
import type { Translate } from './i18n.ts'

/** slot 注入份额:仅文案绑定。 */
export interface ThinkingFeedbackInjected {
  readonly t: Translate
}

/** slot 属主份额(ui-chat AssistantActionOwnerProps 子集)。 */
export interface ThinkingFeedbackOwnerProps {
  readonly messageId?: string
}

/** typert RPC 同构信封(POST /api/session/<method>;与 model-menu 同源)。 */
async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method,
    payload: { args },
  })
  const r = await fetch(`/api/session/${method}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body,
  })
  const d = await r.json() as { result?: { ok?: boolean; value?: T; error?: { message?: string } } }
  if (d?.result?.ok !== true) throw new Error(d?.result?.error?.message ?? `RPC ${method} 失败`)
  return d.result.value as T
}

/** 当前会话 id(与 index.tsx readCurrentSession 同源;缺席=不渲染按钮)。 */
function currentSessionId(): string | null {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    const parsed = raw === null ? null : JSON.parse(raw) as { sessionId?: string }
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : null
  } catch { return null }
}

type Direction = 'less' | 'more'
interface FeedbackState {
  readonly direction: Direction
  readonly phase: 'busy' | 'done' | 'error'
}

export function ThinkingFeedbackActions(
  props: ThinkingFeedbackOwnerProps & ThinkingFeedbackInjected,
): React.JSX.Element | null {
  const { messageId, t } = props
  const [state, setState] = useState<FeedbackState | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
  }, [])

  if (messageId === undefined || messageId === '') return null
  if (currentSessionId() === null) return null

  const send = (direction: Direction): void => {
    if (state?.phase === 'busy') return
    const sessionId = currentSessionId()
    if (sessionId === null) return
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    setState({ direction, phase: 'busy' })
    rpc<{ bias: number; effectiveBias: number }>('thinkingFeedback', {
      request: { sessionId, messageId, direction },
    }).then(() => {
      setState({ direction, phase: 'done' })
      timerRef.current = window.setTimeout(() => { setState(null) }, 1800)
    }).catch(() => { setState({ direction, phase: 'error' }) })
  }

  const busy = state?.phase === 'busy'
  const done = (direction: Direction): boolean => state?.direction === direction && state.phase === 'done'

  return (
    <span className="ea-think-feedback" data-eterna-think-feedback="">
      <button
        type="button"
        className="ea-think-btn"
        data-done={done('less') ? 'true' : undefined}
        disabled={busy}
        aria-label={t('thinking.lessAria')}
        title={t('thinking.lessAria')}
        onClick={() => send('less')}
      >
        {done('less') ? t('thinking.lessDone') : t('thinking.less')}
      </button>
      <button
        type="button"
        className="ea-think-btn"
        data-done={done('more') ? 'true' : undefined}
        disabled={busy}
        aria-label={t('thinking.moreAria')}
        title={t('thinking.moreAria')}
        onClick={() => send('more')}
      >
        {done('more') ? t('thinking.moreDone') : t('thinking.more')}
      </button>
      <span className="ea-think-error" role="status" aria-live="polite">
        {state?.phase === 'error' ? t('thinking.failed') : ''}
      </span>
    </span>
  )
}