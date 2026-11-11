/**
 * 设置弹窗分区:我的插件(个人层发现/启停/安装/转内置)+消息与审批(全员)+
 * 审批队列(admin)。数据走同源 /api/my-plugins/* 与 /api/approvals/*。
 * UI 纪律:ea-* 令牌类(styles.ts)/合并保存思路/两击确认/防重复点击。
 */
import { useCallback, useEffect, useState } from 'react'

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message?: string } | undefined }> {
  const r = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = await r.json().catch(() => null) as { result?: { ok?: boolean; value?: unknown; error?: { message?: string } | undefined } } | null
  return { ok: payload?.result?.ok === true, value: payload?.result?.value, error: payload?.result?.error ?? undefined }
}

interface MyPlugin {
  pluginId: string
  dir: string
  dirExists: boolean
  enabled: boolean
  promoted: boolean
  withinRoot: boolean
}

interface ApprovalItem {
  id: number
  type: string
  payload: { pluginId?: string; requesterAccount?: string }
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
}

interface NotificationItem {
  id: number
  kind: string
  message: string
  read: number
}

/** 侧栏插件页页签形态(plugins.tab):PluginTabProps 提供页面级 install/openPackage,
 *  本页自有安装/转内置链路不依赖它们——自绘内容即 MyPluginsSection 全量功能。 */
export function MyPluginsTab(_props: { readonly install: (target: unknown) => void; readonly openPackage: (name: string) => void }): React.JSX.Element {
  return <MyPluginsSection />
}

export function MyPluginsSection(): React.JSX.Element {
  const [items, setItems] = useState<MyPlugin[]>([])
  const [name, setName] = useState('')
  const [dirName, setDirName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const r = await postJson('/api/my-plugins/list')
    if (r.ok && typeof r.value === 'object' && r.value !== null) {
      setItems((r.value as { items: MyPlugin[] }).items)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const action = async (path: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const r = await postJson(path, { request: body })
      if (!r.ok) setMessage(r.error?.message ?? '操作失败')
      else await refresh()
    } finally { setBusy(false) }
  }

  return <section className="ea-section" data-eterna-access-root data-eterna-my-plugins>
    <h3>我的插件</h3>
    <p className="ea-hint">个人插件仅本人可见可用;好用的插件可发起「转内置」给全团队使用。</p>
    {message !== '' && <p className="ea-error" role="alert">{message}</p>}
    <div className="ea-list">
      {items.length === 0 && <p className="ea-hint">还没有安装个人插件</p>}
      {items.map(item => <div key={item.pluginId} className="ea-row" data-eterna-plugin-row={item.pluginId}>
        <span className="ea-row-title">{item.pluginId}</span>
        <span className="ea-row-meta">{item.enabled ? '已启用' : '已停用'}{item.promoted ? ' · 已转内置' : ''}</span>
        <span className="ea-row-actions">
          <button type="button" className="ea-btn ghost" disabled={busy}
            onClick={() => { void action(item.enabled ? '/api/my-plugins/disable' : '/api/my-plugins/enable', { pluginId: item.pluginId }) }}>
            {item.enabled ? '停用' : '启用'}
          </button>
          {confirming !== item.pluginId
            ? <button type="button" className="ea-btn ghost" disabled={busy} onClick={() => { setConfirming(item.pluginId) }}>删除</button>
            : <button type="button" className="ea-btn ea-btn-danger" disabled={busy}
              onClick={() => { void action('/api/my-plugins/remove', { pluginId: item.pluginId }).then(() => { setConfirming(null) }) }}>
              确认删除?</button>}
          {!item.promoted && <button type="button" className="ea-btn ghost" disabled={busy}
            onClick={() => { void action('/api/my-plugins/promote-request', { pluginId: item.pluginId }) }}>
            转内置</button>}
        </span>
      </div>)}
    </div>
    <div className="ea-row" style={{ marginTop: 10 }}>
      <input className="ea-input" placeholder="插件名(如 hello)" aria-label="插件名"
        value={name} onChange={e => { setName(e.target.value) }} />
      <input className="ea-input" placeholder="plugins 下的目录名" aria-label="插件目录名"
        value={dirName} onChange={e => { setDirName(e.target.value) }} />
      <button type="button" className="ea-btn" disabled={busy || name === '' || dirName === ''}
        onClick={() => { void action('/api/my-plugins/install', { name, dir: dirName }).then(() => { setName(''); setDirName('') }) }}>
        安装</button>
    </div>
  </section>
}

export function NotificationsSection(): React.JSX.Element {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [mine, setMine] = useState<ApprovalItem[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    const [notif, myApprovals] = await Promise.all([
      postJson('/api/notifications'),
      postJson('/api/approvals/mine'),
    ])
    if (notif.ok && typeof notif.value === 'object' && notif.value !== null) {
      const v = notif.value as { items: NotificationItem[]; unread: number }
      setNotifications(v.items); setUnread(v.unread)
    }
    if (myApprovals.ok && typeof myApprovals.value === 'object' && myApprovals.value !== null) {
      setMine((myApprovals.value as { items: ApprovalItem[] }).items)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  return <section className="ea-section" data-eterna-access-root data-eterna-notifications>
    <h3>消息与审批{unread > 0 ? `(${unread} 未读)` : ''}</h3>
    <div className="ea-list">
      {notifications.length === 0 && <p className="ea-hint">暂无消息</p>}
      {notifications.map(n => <div key={n.id} className="ea-row" style={n.read === 0 ? { fontWeight: 600 } : undefined}>
        <span>{n.message}</span>
      </div>)}
    </div>
    {mine.length > 0 && <>
      <h4 style={{ margin: '8px 0 4px' }}>我的申请</h4>
      <div className="ea-list">
        {mine.map(a => <div key={a.id} className="ea-row" data-eterna-approval-mine={a.id}>
          <span>#{a.id} {a.type}({a.payload.pluginId ?? ''})</span>
          <span className="ea-row-meta">{a.status === 'pending' ? '待审批' : a.status === 'approved' ? '已通过' : '已驳回'}</span>
        </div>)}
      </div>
    </>}
    {unread > 0 && <button type="button" className="ea-btn ghost" onClick={() => { void postJson('/api/notifications/read-all').then(() => refresh()) }}>
      全部标为已读</button>}
  </section>
}

export function ApprovalQueueSection(): React.JSX.Element {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<Record<number, string>>({})

  const refresh = useCallback(async (): Promise<void> => {
    const r = await postJson('/api/approvals/pending')
    if (r.ok && typeof r.value === 'object' && r.value !== null) {
      setItems((r.value as { items: ApprovalItem[] }).items)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const decide = async (id: number, approve: boolean, note: string): Promise<void> => {
    setBusy(true)
    try {
      await postJson('/api/my-plugins/promote-decide', { request: { requestId: id, approve, note } })
      await refresh()
    } finally { setBusy(false) }
  }

  return <section className="ea-section" data-eterna-access-root data-eterna-approval-queue>
    <h3>审批队列</h3>
    {items.length === 0 && <p className="ea-hint">暂无待审批请求</p>}
    <div className="ea-list">
      {items.map(a => <div key={a.id} className="ea-row" data-eterna-approval-queue={a.id}>
        <span>#{a.id} {a.type} · {a.payload.pluginId ?? ''}(申请人 {a.payload.requesterAccount ?? '?'})</span>
        <span className="ea-row-actions">
          <input className="ea-input" placeholder="意见(可选)" aria-label="审批意见" value={notes[a.id] ?? ''}
            onChange={e => { setNotes(prev => ({ ...prev, [a.id]: e.target.value })) }} />
          <button type="button" className="ea-btn" disabled={busy} onClick={() => { void decide(a.id, true, notes[a.id] ?? '') }}>通过</button>
          <button type="button" className="ea-btn ea-btn-danger" disabled={busy} onClick={() => { void decide(a.id, false, notes[a.id] ?? '') }}>驳回</button>
        </span>
      </div>)}
    </div>
  </section>
}
