/**
 * 设置弹窗分区(React):账号(资料合并保存+密码独立)/用户管理/插件启停。
 * 官方语义令牌渲染,弹窗内与产品风格天然统一。
 */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import { api, fileToAvatarDataUrl, type CompanionView, type Me, type UserRowView } from './api.ts'
import { DeleteButton, TwoClickButton } from './confirm-button.tsx'
import type { Translate } from './i18n.ts'

function Avatar(props: { url: string | null; nickname: string; size?: number }): React.JSX.Element {
  const size = props.size ?? 40
  if (props.url !== null) {
    return <span className="ea-avatar" style={{ width: size, height: size }}><img src={props.url} alt="" /></span>
  }
  return <span className="ea-avatar" style={{ width: size, height: size }}>{props.nickname.slice(0, 1) || '?'}</span>
}

/** 密码输入(右缘可见性切换,与登录页同交互)。 */
function PasswordInput(props: {
  readonly id: string
  readonly value: string
  readonly placeholder?: string
  readonly autoComplete?: string
  readonly onChange: (value: string) => void
  readonly t: Translate
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return <div style={{ position: 'relative', display: 'block' }}>
    <input id={props.id} className='ea-input' type={visible ? 'text' : 'password'}
      autoComplete={props.autoComplete} placeholder={props.placeholder} value={props.value}
      onChange={event => { props.onChange(event.target.value) }} style={{ paddingRight: 46 }} />
    <button type="button" aria-label={props.t('account.passwordToggle')} title={props.t('account.passwordToggleTitle')}
      onClick={() => { setVisible(v => !v) }}
      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36,
        margin: 0, minWidth: 0, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 0, borderRadius: 4, color: 'var(--et-muted, currentColor)', cursor: 'pointer' }}>
      <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
    </button>
  </div>
}

/** 一键复制文本（clipboard API 优先，execCommand 兜底）；返回复制动作与是否成功反馈。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 浏览器执行面卡:令牌(等宽展示+一键复制)+生成/重置(两击确认)+指引页跳转。 */
export function CompanionCard(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [view, setView] = useState<CompanionView | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })

  useEffect(() => {
    api.companion().then(setView).catch((error: unknown) => {
      setMsg({ ok: false, text: error instanceof Error ? error.message : t('companion.readFailed') })
    })
  }, [])

  const generate = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await api.resetCompanionToken()
      setView({ token: next.token, createdAt: next.createdAt, guideUrl: next.guideUrl })
      setMsg({ ok: true, text: t('companion.generated') })
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : t('companion.generateFailed') })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (view?.token === null || view?.token === undefined) return
    const ok = await copyText(view.token)
    setCopied(ok)
    window.setTimeout(() => { setCopied(false) }, 2000)
  }

  return <div className="ea-card ea-card-wide">
    <h3 style={{ margin: '0 0 12px' }}>{t('companion.title')}</h3>
    <p className="ea-hint" style={{ margin: '0 0 8px' }}>{t('companion.desc')}</p>
    {view === null
      ? <p className="ea-hint">{t('companion.loading')}</p>
      : view.token === null
        ? <p className="ea-hint">{t('companion.empty')}</p>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <code style={{
              flex: 1, minWidth: 220, fontFamily: 'var(--et-font-mono)', fontSize: 12,
              padding: '7px 10px', borderRadius: 4,
              border: '1px solid var(--et-border)',
              background: 'var(--et-surface-2)',
              wordBreak: 'break-all',
            }}>{view.token}</code>
            <button type="button" className="ea-btn" style={{ margin: 0 }} onClick={() => { void copy() }}>{copied ? t('companion.copied') : t('companion.copy')}</button>
          </div>}
    <div className="ea-row between" style={{ marginTop: 14 }}>
      {view?.token !== null && view?.token !== undefined
        ? <TwoClickButton
            label={t('companion.reset')}
            confirmLabel={t('companion.resetConfirm')}
            className="ea-btn ghost"
            armedClassName="ea-btn ea-btn-danger"
            disabled={busy}
            onConfirm={() => { void generate() }}
          />
        : <button type="button" className="ea-btn" disabled={busy} onClick={() => { void generate() }}>{t('companion.generate')}</button>}
      {view !== null && <a href={view.guideUrl} target="_blank" rel="noopener noreferrer" style={{
        fontSize: 'var(--et-text-caption)', color: 'var(--et-accent)', textDecoration: 'none',
      }}>{t('companion.guide')}</a>}
    </div>
    <p className={msg.ok ? 'ea-ok' : 'ea-err'}>{msg.text}</p>
  </div>
}

/** 账号分区:资料卡(合并保存,脏检查)+密码卡(独立,确认输入)+浏览器执行面卡。 */
export function AccountSection(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [me, setMe] = useState<Me | null>(null)
  const [nick, setNick] = useState('')
  const [savedNick, setSavedNick] = useState('')
  const [pendingAvatar, setPendingAvatar] = useState<'RESET' | string | null>(null)
  const [avatarBust, setAvatarBust] = useState(0)
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.me().then((value) => {
      setMe(value)
      const stored = sessionStorage.getItem(`eterna.account.nick.${value.id}`)
      setNick(stored ?? value.nickname)
      setSavedNick(value.nickname)
    }).catch(() => {})
  }, [])

  const dirty = (nick !== savedNick && nick.trim() !== '') || pendingAvatar !== null
  const hint = !dirty
    ? t('account.unchanged')
    : pendingAvatar !== null && nick !== savedNick ? t('account.willUpdateBoth') : pendingAvatar !== null ? t('account.willUpdateAvatar') : t('account.willUpdateNick')
  const avatarUrl = pendingAvatar !== null && pendingAvatar !== 'RESET'
    ? pendingAvatar
    : me?.avatarUrl !== undefined && me.avatarUrl !== null ? `${me.avatarUrl}?v=${avatarBust}` : null

  const saveProfile = useCallback(() => {
    setBusy(true)
    setProfileMsg({ ok: true, text: '' })
    const jobs: Array<Promise<unknown>> = []
    if (nick !== savedNick && nick.trim() !== '') jobs.push(api.setNickname(nick))
    if (pendingAvatar === 'RESET') jobs.push(api.resetAvatar())
    else if (pendingAvatar !== null) jobs.push(api.setAvatar(pendingAvatar))
    Promise.all(jobs).then((results) => {
      setBusy(false)
      setSavedNick(nick)
      if (me !== null) sessionStorage.removeItem(`eterna.account.nick.${me.id}`)
      setPendingAvatar(null)
      setAvatarBust(value => value + 1)
      setMe(previous => previous === null ? previous : { ...previous, nickname: nick })
      void results
      setProfileMsg({ ok: true, text: t('account.saved') })
    }).catch((error: unknown) => {
      setBusy(false)
      setProfileMsg({ ok: false, text: error instanceof Error ? error.message : t('account.saveFailed') })
    })
  }, [me, nick, pendingAvatar, savedNick, t])

  const savePassword = useCallback(() => {
    if (newPw !== newPw2) {
      setPwMsg({ ok: false, text: t('account.passwordMismatch') })
      return
    }
    setBusy(true)
    setPwMsg({ ok: true, text: '' })
    api.setPassword(oldPw, newPw).then(() => {
      setBusy(false)
      setPwMsg({ ok: true, text: t('account.passwordChanged') })
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    }).catch((error: unknown) => {
      setBusy(false)
      setPwMsg({ ok: false, text: error instanceof Error ? error.message : t('account.passwordChangeFailed') })
    })
  }, [oldPw, newPw, newPw2, t])

  if (me === null) return <div data-eterna-access-root><p className="ea-lead">{t('account.loading')}</p></div>

  return <div data-eterna-access-root data-eterna-settings-section="account">
    <div className="ea-grid">
      <div className="ea-card">
        <h3 style={{ margin: '0 0 12px' }}>{t('account.profile')}</h3>
        <div className="ea-row" style={{ margin: '0 0 12px' }}>
          <Avatar url={avatarUrl} nickname={nick || me.account} />
          <input id="ea-file" className="ea-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ flex: 1 }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file === undefined) return
              fileToAvatarDataUrl(file).then((dataUrl) => {
                setPendingAvatar(dataUrl)
              }).catch((error: unknown) => {
                setProfileMsg({ ok: false, text: error instanceof Error ? error.message : t('account.avatarReadFailed') })
              })
            }} />
        </div>
        <label className="ea-label" htmlFor="ea-nick">{t('account.nickname')}</label>
        <input id="ea-nick" className="ea-input" value={nick} maxLength={32} onChange={event => {
          const value = event.target.value
          setNick(value)
          if (me !== null) {
            if (value === savedNick) sessionStorage.removeItem(`eterna.account.nick.${me.id}`)
            else sessionStorage.setItem(`eterna.account.nick.${me.id}`, value)
          }
        }} />
        <div className="ea-row between" style={{ marginTop: 16 }}>
          <button className="ea-btn" disabled={!dirty || busy} onClick={saveProfile}>{t('account.save')}</button>
          <span className="ea-hint">{busy ? t('account.saving') : hint}</span>
        </div>
        <p className={profileMsg.ok ? 'ea-ok' : 'ea-err'}>{profileMsg.text}</p>
      </div>
      <div className="ea-card">
        <h3 style={{ margin: '0 0 12px' }}>{t('account.passwordCard')}</h3>
        <p className="ea-hint" style={{ margin: '0 0 8px' }}>{t('account.passwordNote')}</p>
        <label className="ea-label" htmlFor="ea-oldPw">{t('account.oldPassword')}</label>
        <PasswordInput id="ea-oldPw" autoComplete="current-password" value={oldPw} onChange={setOldPw} t={t} />
        <label className="ea-label" htmlFor="ea-newPw">{t('account.newPassword')}</label>
        <PasswordInput id="ea-newPw" autoComplete="new-password" placeholder={t('account.newPasswordPlaceholder')} value={newPw} onChange={setNewPw} t={t} />
        <label className="ea-label" htmlFor="ea-newPw2">{t('account.confirmPassword')}</label>
        <PasswordInput id="ea-newPw2" autoComplete="new-password" placeholder={t('account.confirmPlaceholder')} value={newPw2} onChange={setNewPw2} t={t} />
        <div className="ea-row" style={{ marginTop: 14 }}>
          <button className="ea-btn" disabled={busy || oldPw === '' || newPw === ''} onClick={savePassword}>{t('account.changePassword')}</button>
        </div>
        <p className={pwMsg.ok ? 'ea-ok' : 'ea-err'}>{pwMsg.text}</p>
      </div>
      <CompanionCard t={t} />
    </div>
  </div>
}

/** 用户管理分区(admin):添加(重名自动后缀)+两击删除。 */
export function UsersSection(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [users, setUsers] = useState<UserRowView[]>([])
  const [selfId, setSelfId] = useState<number | null>(null)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.users().then(value => { setUsers(value.users) }).catch(() => {})
    api.me().then(me => { setSelfId(me.id) }).catch(() => {})
  }, [])

  const create = useCallback(() => {
    setBusy(true)
    setMsg({ ok: true, text: '' })
    api.createUser(account, password, role).then((result) => {
      setBusy(false)
      setMsg({ ok: true, text: (result.finalAccount === account ? t('users.created') : t('users.createdSuffix')).replace('{account}', result.finalAccount) })
      setAccount('')
      setPassword('')
      return api.users().then(value => { setUsers(value.users) })
    }).catch((error: unknown) => {
      setBusy(false)
      setMsg({ ok: false, text: error instanceof Error ? error.message : t('users.createFailed') })
    })
  }, [account, password, role, t])

  const remove = useCallback((id: number) => {
    api.deleteUser(id).then(() => {
      setUsers(previous => previous.filter(user => user.id !== id))
      setMsg({ ok: true, text: t('users.deleted') })
    }).catch((error: unknown) => {
      setMsg({ ok: false, text: error instanceof Error ? error.message : t('users.deleteFailed') })
    })
  }, [t])

  return <div data-eterna-access-root data-eterna-settings-section="users">
    <p className="ea-lead">{t('users.lead')}</p>
    <div className="ea-row" style={{ margin: '0 0 6px' }}>
      <input className="ea-input" placeholder={t('users.account')} value={account} onChange={event => { setAccount(event.target.value) }} style={{ flex: 1 }} />
      <input className="ea-input" type="password" placeholder={t('users.password')} value={password} onChange={event => { setPassword(event.target.value) }} style={{ flex: 1 }} />
      <select className="ea-input" value={role} onChange={event => { setRole(event.target.value as 'admin' | 'user') }} style={{ width: 110 }}>
        <option value="user">{t('users.roleUser')}</option>
        <option value="admin">{t('users.roleAdmin')}</option>
      </select>
      <button className="ea-btn" disabled={busy || account === '' || password === ''} onClick={create}>{t('users.add')}</button>
    </div>
    <div className="ea-table-wrap">
      <table className="ea-table">
        <thead><tr><th></th><th>{t('users.account')}</th><th>{t('users.nickname')}</th><th>{t('users.role')}</th><th>{t('users.createdAt')}</th><th></th></tr></thead>
        <tbody>
          {users.map(user => <tr key={user.id}>
            <td><Avatar url={user.hasAvatar ? `/access/api/avatar/${user.id}` : null} nickname={user.nickname} size={24} /></td>
            <td>{user.account}</td>
            <td>{user.nickname}</td>
            <td>{user.role === 'admin' ? <span className="ea-tag brand">{t('users.roleAdmin')}</span> : <span className="ea-tag">{t('users.roleUser')}</span>}</td>
            <td className="ea-hint">{user.createdAt}</td>
            <td>{user.id === selfId
              ? <span className="ea-hint">{t('users.current')}</span>
              : <DeleteButton onConfirm={() => { remove(user.id) }} label={t('users.delete')} confirmLabel={t('users.deleteConfirm')} />}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className={msg.ok ? 'ea-ok' : 'ea-err'}>{msg.text}</p>
  </div>
}
