/**
 * access 客户端 API 面:同源 fetch 封装(/access/api/*,eterna_session cookie
 * 自动携带)+最小类型(本地结构面,panel 同纪律:零外部类型依赖)。
 */

export interface Me {
  readonly id: number
  readonly account: string
  readonly nickname: string
  readonly role: 'admin' | 'user'
  readonly avatarUrl: string | null
}

export interface UserRowView {
  readonly id: number
  readonly account: string
  readonly nickname: string
  readonly role: 'admin' | 'user'
  readonly createdAt: string
  readonly hasAvatar: boolean
}

export interface PluginRowView {
  readonly id: string
  readonly label: string
  readonly redLine: boolean
  readonly disabled: boolean
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  const data: unknown = await res.json().catch(() => ({}))
  if (res.status === 401) {
    window.location.href = '/login'
    throw new ApiError(401, '未登录')
  }
  const body = data as { error?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `请求失败(${res.status})`)
  return data as T
}

export const api = {
  me: (): Promise<Me> => call('/access/api/me'),
  setNickname: (nickname: string): Promise<{ ok: true; nickname: string }> =>
    call('/access/api/nickname', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) }),
  setPassword: (oldPassword: string, newPassword: string): Promise<{ ok: true }> =>
    call('/access/api/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oldPassword, newPassword }) }),
  setAvatar: (dataUrl: string): Promise<{ ok: true; avatarUrl: string }> =>
    call('/access/api/avatar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl }) }),
  resetAvatar: (): Promise<{ ok: true }> => call('/access/api/avatar', { method: 'DELETE' }),
  users: (): Promise<{ users: UserRowView[] }> => call('/access/api/users'),
  createUser: (account: string, password: string, role: 'admin' | 'user'): Promise<{ user: UserRowView; finalAccount: string }> =>
    call('/access/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password, role }) }),
  deleteUser: (id: number): Promise<{ ok: true }> => call(`/access/api/users/${id}`, { method: 'DELETE' }),
  plugins: (): Promise<{ plugins: PluginRowView[] }> => call('/access/api/plugins'),
  togglePlugin: (id: string, action: 'disable' | 'enable'): Promise<{ ok: true; disabled: boolean; effectiveAfterRestart: boolean }> =>
    call(`/access/api/plugins/${id}/${action}`, { method: 'POST' }),
  logout: (): Promise<void> =>
    fetch('/logout', { method: 'POST', credentials: 'same-origin' }).then(() => undefined),
}

/** 客户端 canvas 缩放头像(≤256×256 PNG dataURL)。 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = Math.min(256 / img.width, 256 / img.height, 1)
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolvePromise(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { rejectPromise(new Error('图片读取失败')) }
    img.src = URL.createObjectURL(file)
  })
}
