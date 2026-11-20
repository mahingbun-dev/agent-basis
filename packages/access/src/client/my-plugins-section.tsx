/**
 * 设置弹窗分区:我的插件(个人层发现/启停/安装/转内置)+消息与审批(全员)+
 * 审批队列(admin)。数据走同源 /api/my-plugins/* 与 /api/approvals/*。
 * UI 纪律:ea-* 令牌类(styles.ts)/合并保存思路/两击确认/防重复点击。
 */
import { useCallback, useEffect, useState } from 'react'
import type { PluginTabProps, PluginTabUpdate } from '@deepseek-ai/dsh-client-ui-plugin-manager'
import { ArmedDelete } from './confirm-button.tsx'
import type { Translate } from './i18n.ts'
import { postRpc } from './rpc.ts'

interface MyPlugin {
  pluginId: string
  dir: string
  dirExists: boolean
  enabled: boolean
  promoted: boolean
  withinRoot: boolean
  mounted: boolean
  tools: string[]
  mountError?: string
}

interface ScanItem {
  dirName: string
  dir: string
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

/** 侧栏插件页页签形态(plugins.tab):owner props 按 rc.5 `PluginTabProps` 全量声明
 *  (install/update/openPackage 均必填;`update` 为 rc.5 新增项)。
 *  本页签的个人层插件走自绘目录导入/转内置链路,不依赖页面的安装与 git 更新能力
 *  ——`update` 只作契约对齐位,不渲染更新入口;`t` 由 slot inject 注入。 */
export function MyPluginsTab(props: PluginTabProps & { readonly t: Translate }): React.JSX.Element {
  return <MyPluginsSection t={props.t} />
}

/** 编译期断言(rc.5):页签 props 必须携带必填 `update(target: PluginTabUpdate)`。
 *  契约影子若漏项/走形,此处先红;仅存在于类型层,不进 bundle。 */
export type MyPluginsTabCarriesUpdate =
  Parameters<typeof MyPluginsTab>[0]['update'] extends (target: PluginTabUpdate) => void ? true : false

export function MyPluginsSection(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [items, setItems] = useState<MyPlugin[]>([])
  const [scanned, setScanned] = useState<ScanItem[] | undefined>(undefined)
  const [name, setName] = useState('')
  const [dirName, setDirName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const r = await postRpc('/api/my-plugins/list')
    if (r.ok && typeof r.value === 'object' && r.value !== null) {
      setItems((r.value as { items: MyPlugin[] }).items)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const action = async (path: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const r = await postRpc(path, { request: body })
      if (!r.ok) setMessage(r.error?.message ?? t('plugins.actionFailed'))
      else await refresh()
    } finally { setBusy(false) }
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const r = await postRpc('/api/my-plugins/scan')
      if (r.ok && typeof r.value === 'object' && r.value !== null) setScanned((r.value as { items: ScanItem[] }).items)
      else setMessage(r.error?.message ?? t('plugins.actionFailed'))
    } finally { setBusy(false) }
  }

  // 装载状态徽标文案(T6 装载器):已启用=已装载 n 个工具/装载失败(+原因);
  // 已停用=未装载;转内置标记独立追加。
  const mountMeta = (item: MyPlugin): string => {
    if (!item.enabled) return t('plugins.disabled')
    if (item.mountError !== undefined && item.mountError !== '') return `${t('plugins.mountFailed')}(${item.mountError})`
    if (item.mounted) return t('plugins.mountedTools').replace('{count}', String(item.tools.length))
    return t('plugins.enabled')
  }

  return <section className="ea-section" data-eterna-access-root data-eterna-my-plugins>
    <h3>{t('plugins.title')}</h3>
    <p className="ea-hint">{t('plugins.hint')}</p>
    {message !== '' && <p className="ea-error" role="alert">{message}</p>}
    <div className="ea-list">
      {items.length === 0 && <p className="ea-hint">{t('plugins.empty')}</p>}
      {items.map(item => <div key={item.pluginId} className="ea-row" data-eterna-plugin-row={item.pluginId}>
        <span className="ea-row-title">{item.pluginId}</span>
        <span className="ea-row-meta" data-eterna-plugin-mount={item.enabled ? (item.mounted ? 'mounted' : item.mountError !== undefined && item.mountError !== '' ? 'failed' : 'recorded') : 'disabled'}>
          {mountMeta(item)}{item.promoted ? ` · ${t('plugins.promoted')}` : ''}
        </span>
        <span className="ea-row-actions">
          <button type="button" className="ea-btn ghost" disabled={busy}
            onClick={() => { void action(item.enabled ? '/api/my-plugins/disable' : '/api/my-plugins/enable', { pluginId: item.pluginId }) }}>
            {item.enabled ? t('plugins.disable') : t('plugins.enable')}
          </button>
          <ArmedDelete busy={busy} label={t('plugins.delete')} confirmLabel={t('plugins.deleteConfirm')} onConfirm={() => { void action('/api/my-plugins/remove', { pluginId: item.pluginId }) }} />
          {!item.promoted && <button type="button" className="ea-btn ghost" disabled={busy}
            onClick={() => { void action('/api/my-plugins/promote-request', { pluginId: item.pluginId }) }}>
            {t('plugins.promote')}</button>}
        </span>
      </div>)}
    </div>
    {/* T6 发现性:扫描 plugins 根下未登记目录,一键导入(替代手填表单) */}
    <div className="ea-row" style={{ marginTop: 10 }}>
      <button type="button" className="ea-btn ghost" disabled={busy} data-eterna-plugin-scan
        onClick={() => { void scan() }}>
        {t('plugins.scan')}
      </button>
      {scanned !== undefined && (scanned.length === 0
        ? <span className="ea-hint">{t('plugins.scanEmpty')}</span>
        : <span className="ea-row-actions">
          {scanned.map(entry => <button key={entry.dirName} type="button" className="ea-btn ghost" disabled={busy}
            onClick={() => { void action('/api/my-plugins/install', { name: entry.dirName, dir: entry.dirName }) }}>
            {`${t('plugins.install')}: ${entry.dirName}`}
          </button>)}
        </span>)}
    </div>
    <div className="ea-row" style={{ marginTop: 10 }}>
      <input className="ea-input" placeholder={t('plugins.namePlaceholder')} aria-label={t('plugins.nameLabel')}
        value={name} onChange={e => { setName(e.target.value) }} />
      <input className="ea-input" placeholder={t('plugins.dirPlaceholder')} aria-label={t('plugins.dirLabel')}
        value={dirName} onChange={e => { setDirName(e.target.value) }} />
      <button type="button" className="ea-btn" disabled={busy || name === '' || dirName === ''}
        onClick={() => { void action('/api/my-plugins/install', { name, dir: dirName }).then(() => { setName(''); setDirName('') }) }}>
        {t('plugins.install')}</button>
    </div>
  </section>
}

export function NotificationsSection(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [mine, setMine] = useState<ApprovalItem[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    const [notif, myApprovals] = await Promise.all([
      postRpc('/api/notifications'),
      postRpc('/api/approvals/mine'),
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

  return <section className="ea-section" data-eterna-access-root data-eterna-notifications data-eterna-settings-section="notifications">
    <h3>{t('notifications.title')}{unread > 0 ? t('notifications.unread').replace('{count}', String(unread)) : ''}</h3>
    <div className="ea-list">
      {notifications.length === 0 && <p className="ea-hint">{t('notifications.empty')}</p>}
      {notifications.map(n => <div key={n.id} className="ea-row" style={n.read === 0 ? { fontWeight: 'var(--et-weight-display)' } : undefined}>
        <span>{n.message}</span>
      </div>)}
    </div>
    {mine.length > 0 && <>
      <h4 style={{ margin: '8px 0 4px' }}>{t('notifications.mine')}</h4>
      <div className="ea-list">
        {mine.map(a => <div key={a.id} className="ea-row" data-eterna-approval-mine={a.id}>
          <span>#{a.id} {a.type}({a.payload.pluginId ?? ''})</span>
          <span className="ea-row-meta">{a.status === 'pending' ? t('notifications.pending') : a.status === 'approved' ? t('notifications.approved') : t('notifications.rejected')}</span>
        </div>)}
      </div>
    </>}
    {unread > 0 && <button type="button" className="ea-btn ghost" onClick={() => { void postRpc('/api/notifications/read-all').then(() => refresh()) }}>
      {t('notifications.readAll')}</button>}
  </section>
}

export function ApprovalQueueSection(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<Record<number, string>>({})

  const refresh = useCallback(async (): Promise<void> => {
    const r = await postRpc('/api/approvals/pending')
    if (r.ok && typeof r.value === 'object' && r.value !== null) {
      setItems((r.value as { items: ApprovalItem[] }).items)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const decide = async (id: number, approve: boolean, note: string): Promise<void> => {
    setBusy(true)
    try {
      await postRpc('/api/my-plugins/promote-decide', { request: { requestId: id, approve, note } })
      await refresh()
    } finally { setBusy(false) }
  }

  return <section className="ea-section" data-eterna-access-root data-eterna-approval-queue data-eterna-settings-section="approval-queue">
    <h3>{t('approval.title')}</h3>
    {items.length === 0 && <p className="ea-hint">{t('approval.empty')}</p>}
    <div className="ea-list">
      {items.map(a => <div key={a.id} className="ea-row" data-eterna-approval-queue={a.id}>
        <span>#{a.id} {a.type} · {a.payload.pluginId ?? ''}({t('approval.applicant')} {a.payload.requesterAccount ?? '?'})</span>
        <span className="ea-row-actions">
          <input className="ea-input" placeholder={t('approval.notePlaceholder')} aria-label={t('approval.noteLabel')} value={notes[a.id] ?? ''}
            onChange={e => { setNotes(prev => ({ ...prev, [a.id]: e.target.value })) }} />
          <button type="button" className="ea-btn" disabled={busy} onClick={() => { void decide(a.id, true, notes[a.id] ?? '') }}>{t('approval.approve')}</button>
          <button type="button" className="ea-btn ea-btn-danger" disabled={busy} onClick={() => { void decide(a.id, false, notes[a.id] ?? '') }}>{t('approval.reject')}</button>
        </span>
      </div>)}
    </div>
  </section>
}
