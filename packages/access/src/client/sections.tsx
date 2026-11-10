/**
 * 设置弹窗分区(React):账号(资料合并保存+密码独立)/用户管理/插件启停。
 * 官方语义令牌渲染,弹窗内与产品风格天然统一。
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fileToAvatarDataUrl, type Me, type UserRowView } from './api.ts'

function Avatar(props: { url: string | null; nickname: string; size?: number }): React.JSX.Element {
  const size = props.size ?? 40
  if (props.url !== null) {
    return <span className="ea-avatar" style={{ width: size, height: size }}><img src={props.url} alt="" /></span>
  }
  return <span className="ea-avatar" style={{ width: size, height: size }}>{props.nickname.slice(0, 1) || '?'}</span>
}

/** 账号分区:资料卡(合并保存,脏检查)+密码卡(独立,确认输入)。 */
export function AccountSection(): React.JSX.Element {
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
      setNick(value.nickname)
      setSavedNick(value.nickname)
    }).catch(() => {})
  }, [])

  const dirty = (nick !== savedNick && nick.trim() !== '') || pendingAvatar !== null
  const hint = !dirty
    ? '资料未改动'
    : pendingAvatar !== null && nick !== savedNick ? '将更新昵称与头像' : pendingAvatar !== null ? '将更新头像' : '将更新昵称'
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
      setPendingAvatar(null)
      setAvatarBust(value => value + 1)
      setMe(previous => previous === null ? previous : { ...previous, nickname: nick })
      void results
      setProfileMsg({ ok: true, text: '已保存' })
    }).catch((error: unknown) => {
      setBusy(false)
      setProfileMsg({ ok: false, text: error instanceof Error ? error.message : '保存失败' })
    })
  }, [nick, pendingAvatar, savedNick])

  const savePassword = useCallback(() => {
    if (newPw !== newPw2) {
      setPwMsg({ ok: false, text: '两次输入的新密码不一致' })
      return
    }
    setBusy(true)
    setPwMsg({ ok: true, text: '' })
    api.setPassword(oldPw, newPw).then(() => {
      setBusy(false)
      setPwMsg({ ok: true, text: '密码已修改，其他设备需重新登录' })
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    }).catch((error: unknown) => {
      setBusy(false)
      setPwMsg({ ok: false, text: error instanceof Error ? error.message : '修改失败' })
    })
  }, [oldPw, newPw, newPw2])

  if (me === null) return <div data-eterna-access-root><p className="ea-lead">加载中…</p></div>

  return <div data-eterna-access-root>
    <div className="ea-grid">
      <div className="ea-card">
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>个人资料</h3>
        <div className="ea-row" style={{ margin: '0 0 12px' }}>
          <Avatar url={avatarUrl} nickname={nick || me.account} />
          <input id="ea-file" className="ea-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ flex: 1 }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file === undefined) return
              fileToAvatarDataUrl(file).then((dataUrl) => {
                setPendingAvatar(dataUrl)
              }).catch((error: unknown) => {
                setProfileMsg({ ok: false, text: error instanceof Error ? error.message : '图片读取失败' })
              })
            }} />
        </div>
        <label className="ea-label" htmlFor="ea-nick">昵称</label>
        <input id="ea-nick" className="ea-input" value={nick} maxLength={32} onChange={event => { setNick(event.target.value) }} />
        <div className="ea-row between" style={{ marginTop: 16 }}>
          <button className="ea-btn" disabled={!dirty || busy} onClick={saveProfile}>保存更改</button>
          <span className="ea-hint">{busy ? '保存中…' : hint}</span>
        </div>
        <p className={profileMsg.ok ? 'ea-ok' : 'ea-err'}>{profileMsg.text}</p>
      </div>
      <div className="ea-card">
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>修改密码</h3>
        <p className="ea-hint" style={{ margin: '0 0 8px' }}>修改后本机保持登录，其他设备需重新登录。</p>
        <label className="ea-label" htmlFor="ea-oldPw">旧密码</label>
        <input id="ea-oldPw" className="ea-input" type="password" autoComplete="current-password" value={oldPw} onChange={event => { setOldPw(event.target.value) }} />
        <label className="ea-label" htmlFor="ea-newPw">新密码</label>
        <input id="ea-newPw" className="ea-input" type="password" autoComplete="new-password" placeholder="至少 8 位" value={newPw} onChange={event => { setNewPw(event.target.value) }} />
        <label className="ea-label" htmlFor="ea-newPw2">确认新密码</label>
        <input id="ea-newPw2" className="ea-input" type="password" autoComplete="new-password" placeholder="再次输入新密码" value={newPw2} onChange={event => { setNewPw2(event.target.value) }} />
        <div className="ea-row" style={{ marginTop: 14 }}>
          <button className="ea-btn" disabled={busy || oldPw === '' || newPw === ''} onClick={savePassword}>修改密码</button>
        </div>
        <p className={pwMsg.ok ? 'ea-ok' : 'ea-err'}>{pwMsg.text}</p>
      </div>
    </div>
  </div>
}

/** 用户管理分区(admin):添加(重名自动后缀)+两击删除。 */
export function UsersSection(): React.JSX.Element {
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
      setMsg({ ok: true, text: result.finalAccount === account ? `用户 ${result.finalAccount} 已创建` : `用户已创建，账号为 ${result.finalAccount}（重名自动后缀）` })
      setAccount('')
      setPassword('')
      return api.users().then(value => { setUsers(value.users) })
    }).catch((error: unknown) => {
      setBusy(false)
      setMsg({ ok: false, text: error instanceof Error ? error.message : '创建失败' })
    })
  }, [account, password, role])

  const remove = useCallback((id: number) => {
    api.deleteUser(id).then(() => {
      setUsers(previous => previous.filter(user => user.id !== id))
      setMsg({ ok: true, text: '用户已删除，其会话已失效' })
    }).catch((error: unknown) => {
      setMsg({ ok: false, text: error instanceof Error ? error.message : '删除失败' })
    })
  }, [])

  return <div data-eterna-access-root>
    <p className="ea-lead">添加用户（重名自动追加数字后缀；默认昵称=账号、头像=昵称首字母）。</p>
    <div className="ea-row" style={{ margin: '0 0 6px' }}>
      <input className="ea-input" placeholder="账号" value={account} onChange={event => { setAccount(event.target.value) }} style={{ flex: 1 }} />
      <input className="ea-input" type="password" placeholder="密码（至少 8 位）" value={password} onChange={event => { setPassword(event.target.value) }} style={{ flex: 1 }} />
      <select className="ea-input" value={role} onChange={event => { setRole(event.target.value as 'admin' | 'user') }} style={{ width: 110 }}>
        <option value="user">普通用户</option>
        <option value="admin">管理员</option>
      </select>
      <button className="ea-btn" disabled={busy || account === '' || password === ''} onClick={create}>添加</button>
    </div>
    <table className="ea-table">
      <thead><tr><th></th><th>账号</th><th>昵称</th><th>角色</th><th>创建时间</th><th></th></tr></thead>
      <tbody>
        {users.map(user => <tr key={user.id}>
          <td><Avatar url={user.hasAvatar ? `/access/api/avatar/${user.id}` : null} nickname={user.nickname} size={24} /></td>
          <td>{user.account}</td>
          <td>{user.nickname}</td>
          <td>{user.role === 'admin' ? <span className="ea-tag brand">管理员</span> : <span className="ea-tag">用户</span>}</td>
          <td className="ea-hint">{user.createdAt}</td>
          <td>{user.id === selfId
            ? <span className="ea-hint">当前登录</span>
            : <DeleteButton onConfirm={() => { remove(user.id) }} />}</td>
        </tr>)}
      </tbody>
    </table>
    <p className={msg.ok ? 'ea-ok' : 'ea-err'}>{msg.text}</p>
  </div>
}

/** 两击删除确认(禁用原生对话框——内嵌 webview 卡死实测)。 */
function DeleteButton(props: { onConfirm: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return <button className="ea-dangerclick" onClick={() => { setArmed(true) }}
      onMouseLeave={() => { setArmed(false) }}>删除</button>
  }
  return <button className="ea-dangerclick" onClick={() => { props.onConfirm() }}>确认删除?</button>
}
