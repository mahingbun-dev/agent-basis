/**
 * 工具审批卡(2026-11-13):治理 default:ask 的调用在 web 前端不可见也不可决
 * (上游 dsh-web-frontend 0.2.2-rc.1 无审批面,session-7e15e6ab 31+ 分钟假死)。
 * 本卡是宿主审批桥(../approval-bridge.ts)的浏览器半边:轮询本人待决审批,
 * body 级固定横幅呈现(允/拒),点击即 POST tool-decide(仅本次生效,内核语义
 * allowed-once)。多标签页天然幂等(裁决后条目消失)。零报错面:轮询失败静默。
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
  const submit = (allow: boolean): void => {
    if (busy) return
    setBusy(true)
    void decide(props.item.id, allow)
      .catch(() => { /* 失败不关卡:条目仍在,下一轮轮询会再呈现 */ })
      .finally(() => { setBusy(false); props.onDecided(props.item.id) })
  }
  return (
    <div className='eap-card' role='alertdialog' aria-label='工具调用审批'>
      <div className='eap-strip'>需要你确认</div>
      <div className='eap-body'>
        <div className='eap-headline'>Agent 请求调用工具(等待你的批准,期间任务暂停)</div>
        <div className='eap-tool'><code>{props.item.toolName}</code></div>
        {props.item.reason !== null ? <p className='eap-reason'>{props.item.reason}</p> : null}
        <div className='eap-meta'>批准仅对本次调用生效 · {String(remaining)} 秒后未处理将按「无审批渠道」拒绝</div>
      </div>
      <div className='eap-actions'>
        <button type='button' className='eap-reject' disabled={busy} onClick={() => { submit(false) }}>拒绝</button>
        <button type='button' className='eap-allow' disabled={busy} onClick={() => { submit(true) }}>允许本次</button>
      </div>
    </div>
  )
}

export function ApprovalCardOverlay(): React.JSX.Element {
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
  if (items.length === 0) return <></>
  return (
    <div className='eap-overlay'>
      {items.map(item => <ApprovalCard key={item.id} item={item} onDecided={onDecided} />)}
    </div>
  )
}

export interface ApprovalCardHandle {
  dispose(): void
}

/** 装载审批卡(body 级 React 挂载,ModelMenu 同款形态;任何失败静默不影响主流程)。
 * createRoot 由调用方传入——react-dom/client 是壳注入的 CJS external(index.tsx
 * requireShim 同款),客户端工件不得静态 import。 */
export function installApprovalCard(
  createRoot: (container: Element) => { render(node: React.ReactElement): void; unmount(): void },
): ApprovalCardHandle | undefined {
  try {
    const host = document.createElement('div')
    host.setAttribute('data-eterna-approval-root', '')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<ApprovalCardOverlay />)
    return {
      dispose: () => {
        try { root.unmount() } catch { /* 尽力而为 */ }
        host.remove()
      },
    }
  } catch {
    return undefined
  }
}
