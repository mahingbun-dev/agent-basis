// CDP 帧协议契约（冻结 v1，proto=1）——与 packages/extension-companion/src/protocol.ts 镜像，改一处必改另一处。
// 契约文档：docs/CDP-FRAME-PROTOCOL.md

export const PROTO_VERSION = 1

export interface RelayError {
  code: string
  message: string
}

export interface TabInfo {
  tabId: number
  title: string
  url: string
  active: boolean
  /** 不可操作目标（chrome:// 等）为 false，拒绝 attach */
  eligible: boolean
}

export type ExtToRelay =
  | { t: 'hello'; proto: number; ext: string; extVersion: string; chromeVersion?: string | undefined }
  | { t: 'pong' }
  | { t: 'result'; id: number; ok: true; result: unknown }
  | { t: 'result'; id: number; ok: false; error: RelayError }
  | { t: 'event'; tabId: number; method: string; params: unknown }
  | { t: 'detached'; tabId: number; reason?: string | undefined }
  | { t: 'tab.created'; tab: TabInfo }
  | { t: 'tab.updated'; tabId: number; title?: string | undefined; url?: string | undefined; active?: boolean | undefined }
  | { t: 'tab.removed'; tabId: number }

export type RelayToExt =
  | { t: 'ping' }
  | { t: 'tabs.list'; id: number }
  | { t: 'tab.new'; id: number; url?: string | undefined; active?: boolean | undefined }
  | { t: 'tab.close'; id: number; tabId: number }
  | { t: 'tab.activate'; id: number; tabId: number }
  | { t: 'attach'; id: number; tabId: number }
  | { t: 'detach'; id: number; tabId: number }
  | { t: 'cmd'; id: number; tabId: number; method: string; params?: unknown }

/** 服务端 → 扩展的请求帧（带递增 id；RelayCore.extRequest 内部覆写 id） */
export type ExtRequestFrame = Exclude<RelayToExt, { t: 'ping' }>

/** 红线 7：不可操作目标判定（与契约文档一致） */
export function isEligibleUrl(url: string): boolean {
  const u = url.toLowerCase()
  if (u === '' || u === 'about:blank') return true
  if (u.startsWith('chrome://') || u.startsWith('chrome-extension://') || u.startsWith('edge://')) return false
  if (u.startsWith('about:') || u.startsWith('devtools://')) return false
  if (u.startsWith('https://chromewebstore.google.com') || u.startsWith('https://chrome.google.com/webstore')) return false
  return true
}

/** CDP 层错误（回给 playwright 客户端的 JSON-RPC error） */
export class CdpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'CdpError'
  }
}
