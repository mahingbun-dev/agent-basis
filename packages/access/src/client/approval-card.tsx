/**
 * 工具审批卡(2026-11-13):治理 default:ask 的调用在 web 前端不可见也不可决
 * (上游 dsh-web-frontend 0.2.2-rc.1 无审批面,session-7e15e6ab 31+ 分钟假死)。
 * 本卡是宿主审批桥(../approval-bridge.ts)的浏览器半边:轮询本人待决审批,
 * 点击即 POST tool-decide(仅本次生效,核语义 allowed-once)。多标签页天然幂等
 * (裁决后条目消失)。零报错面:轮询失败静默。
 *
 * v4 叠层契约(2026-11-19,42 号 §7a.2):
 * - 不再自挂 document.body + fixed top:16px + z-index:10000(会与提问卡重叠、
 *   并压住宿主原生 toast 的 top:40px/1100)。
 * - 改为在 `conversation.input.overlay` 席位内渲染——该席位落在宿主输入卡顶边的
 *   零高度锚点(.overlayAnchor)内,「贴输入卡向上浮出」成为布局结果。
 * - 卡片作用域 = 会话:只呈当前 sessionId 的审批项。
 */
import { useEffect, useState } from 'react'

export interface ToolApprovalItem {
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  readonly callId: string | null
  readonly reason: string | null
  readonly requestedAt: number
  readonly expiresAt: number
}

const POLL_MS = 4_000

async function fetchPending(): Promise<ToolApprovalItem[]> {
  const res = await fetch('/access/api/approvals/tool-pending', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`status ${String(res.status)}`)
  const body = (await res.json()) as { items?: ToolApprovalItem[] }
  return Array.isArray(body.items) ? body.items : []
}

async function decide(id: string, allow: boolean): Promise<void> {
  const res = await fetch('/access/api/approvals/tool-decide', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, allow }),
  })
  if (!res.ok) throw new Error(`status ${String(res.status)}`)
}

function ApprovalCard(props: {
  readonly item: ToolApprovalItem
  readonly onDecided: (id: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const remaining = Math.max(0, Math.round((props.item.expiresAt - Date.now()) / 1000))
  // 倒计时进度:按 到期窗口推算(总量取 requestedAt→expiresAt)
  const window = Math.max(1, props.item.expiresAt - props.item.requestedAt)
  const remainingRatio = Math.min(1, Math.max(0, (props.item.expiresAt - Date.now()) / window))
  const submit = (allow: boolean): void => {
    if (busy) return
    setBusy(true)
    void decide(props.item.id, allow)
      .catch(() => { /* 失败不关卡:条目仍在,下一轮轮询会再呈现 */ })
      .finally(() => { setBusy(false); props.onDecided(props.item.id) })
  }
  return (
    <div className='et-decision-card' data-kind='approval' role='alertdialog' aria-label='工具调用审批'>
      {/* 倒计时是贴卡片顶边的 2px 条,不是独立一行(否则卡内出现一条横线切断内容) */}
      <div className='et-decision-track' aria-hidden='true'>
        <i style={{ width: `${String(remainingRatio * 100)}%` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className='et-badge' data-tone='warn'>待授权</span>
        <span style={{ font: '600 var(--et-text-body)/1.35 var(--et-font-body)' }}>Agent 请求调用工具</span>
      </div>
      <p className='eap-reason' style={{ marginTop: 8 }}>
        <code style={{ fontFamily: 'var(--et-font-mono)', fontSize: 'var(--et-text-caption)' }}>{props.item.toolName}</code>
        {props.item.reason !== null ? ` · ${props.item.reason}` : ''}
      </p>
      <p className='eap-meta'>
        批准仅对本次调用生效 · {String(remaining)} 秒后未处理将按「无审批渠道」拒绝
      </p>
      <div className='et-card-actions' style={{ justifyContent: 'flex-end' }}>
        <button type='button' className='et-btn et-btn--ghost et-btn--sm' disabled={busy}
          onClick={() => { submit(false) }}>拒绝</button>
        <button type='button' className='et-btn et-btn--primary et-btn--sm' disabled={busy}
          onClick={() => { submit(true) }}>允许本次</button>
      </div>
    </div>
  )
}

/**
 * 审批卡槽位组件：在 `conversation.input.overlay` 席位内渲染。
 * 只呈属于本会话（`sessionId`）的审批项——审批是会话作用域的。
 */
export function ApprovalCards(props: { readonly sessionId?: string | undefined }): React.JSX.Element {
  const [items, setItems] = useState<ToolApprovalItem[]>([])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const next = await fetchPending()
        if (alive) setItems(next)
      } catch { /* 静默:未登录/网络抖动下一轮再试 */ }
      if (alive) timer = setTimeout(() => { void tick() }, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  const onDecided = (id: string): void => { setItems(prev => prev.filter(item => item.id !== id)) }
  // 会话作用域:没有 sessionId 时保守显示全部(宿主可能在首帧未下发)
  const mine = props.sessionId === undefined
    ? items
    : items.filter(item => item.sessionId === props.sessionId)
  if (mine.length === 0) return <></>
  return <>{mine.map(item => <ApprovalCard key={item.id} item={item} onDecided={onDecided} />)}</>
}
