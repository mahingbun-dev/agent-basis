// 设置持久化（chrome.storage.local）+ 连接状态镜像（chrome.storage.session，供设置页只读展示）。
// 令牌存 local（本机用户配置），不进任何日志。

export interface Settings {
  relayUrl: string
  token: string
}

export const DEFAULT_RELAY_URL = 'ws://127.0.0.1:9310/extension'

const SETTINGS_KEY = 'settings'
const CONN_KEY = 'connState'

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY)
  const raw = (got[SETTINGS_KEY] ?? {}) as Partial<Settings>
  return {
    relayUrl: typeof raw.relayUrl === 'string' && raw.relayUrl !== '' ? raw.relayUrl : DEFAULT_RELAY_URL,
    token: typeof raw.token === 'string' ? raw.token : '',
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
}

export type ConnState = 'disconnected' | 'connecting' | 'connected'

export async function setConnState(state: ConnState, detail?: string): Promise<void> {
  await chrome.storage.session.set({ [CONN_KEY]: { state, detail: detail ?? '', at: Date.now() } })
}

export async function getConnState(): Promise<{ state: ConnState; detail: string; at: number }> {
  const got = await chrome.storage.session.get(CONN_KEY)
  const v = got[CONN_KEY] as { state?: ConnState; detail?: string; at?: number } | undefined
  return { state: v?.state ?? 'disconnected', detail: v?.detail ?? '', at: v?.at ?? 0 }
}
