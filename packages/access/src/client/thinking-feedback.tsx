/**
 * 思考强度显式反馈(2026-11-18 V2):
 * 在 assistant 消息动作条(conversation.chat.assistant-actions,ui-chat 声明的原生
 * list slot)追加两枚轻按钮「想浅点/想深点」——把用户对某条回答的思考量判断
 * 变成会话级偏置(±0.2、同向累计、反向抵消、24h 半衰、钳位 ±0.5)。
 *
 * 纪律:
 * - 零新页面/零新入口:只注册上游 slot(list/scope=session,props 带 messageId
 *   与会话绑定的 sessionId——后者才是「这条消息属于哪个会话」的权威来源);
 * - 纯文字按钮(无手写 SVG;图标集无 minus,不硬凑);
 * - 令牌 `--et-*`、focus-visible 光圈、prefers-reduced-motion(样式在 styles.ts);
 * - 防重复点击:请求中 disabled;成功后短暂显示「已调浅/已调深」;
 * - 失败就地 aria-live 文案,不打断对话、不关闭任何面板。
 */
import { useEffect, useRef, useState } from 'react'
import type { Translate } from './i18n.ts'
import { activeSessionId } from './session-bridge.ts'

/** slot 注入份额:仅文案绑定。 */
export interface ThinkingFeedbackInjected {
  readonly t: Translate
}

/** slot 属主份额(ui-chat AssistantActionOwnerProps 子集)。 */
export interface ThinkingFeedbackOwnerProps {
  readonly messageId?: string
  /**
   * 渲染这条消息的会话 id。`conversation.chat.assistant-actions` 在 ui-chat 声明为
   * scope='session',ui-session 的会话绑定把 sessionId 作为标准 prop 随 kit 逐字下发
   * (ui-session/src/client/index.ts:269 `props: ['sessionId']`;缺 scope 绑定则渲染期
   * 直接抛 SlotAssemblyError)。**首选此值**:它等于「哪个会话正在渲染这条消息」。
   */
  readonly sessionId?: string
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

/** 导航「当前选择」快照(index.tsx readCurrentSession 同源)——**仅作降级**:
 * 它是最后一次导航选择的持久化,多 tab 共享、切账号后可能残留,不保证就是
 * 渲染当前消息的那个会话;标准席位缺席(旧壳/合成异常)时才回退到它。 */
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
  // 会话 id 在渲染时定一次:标准席位(scope='session' 交付的 props.sessionId)最权威;
  // 缺席时取会话桥(overlay 探针按 session 作用域写入的「当前渲染会话」);最末才回退
  // 导航快照。send 复用同值——避免「渲染时一个会话、提交时另一个会话」。
  const sessionId = props.sessionId !== undefined && props.sessionId !== ''
    ? props.sessionId
    : activeSessionId() ?? currentSessionId()

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
  }, [])

  if (messageId === undefined || messageId === '') return null
  if (sessionId === null) return null

  const send = (direction: Direction): void => {
    if (state?.phase === 'busy') return
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