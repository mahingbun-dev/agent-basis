// chrome.debugger 逐 tab attach + CDP 命令转发薄翻译层（E1-T1，主 frame 闭环）。
// 红线 7：不可操作目标拒绝 attach。E2 在此之上做 detach 分类与状态恢复。

import { isEligibleUrl, type ExtToRelay, type RelayError, type RelayToExt, type TabInfo } from './protocol.ts'

const CMD_TIMEOUT_MS = 60_000

function toRelayError(err: unknown, fallbackCode: string): RelayError {
  const message = err instanceof Error ? err.message : String(err)
  return { code: fallbackCode, message }
}

interface WithId {
  id: number
}

export class CdpBridge {
  private readonly attached = new Set<number>()
  private readonly attaching = new Map<number, Promise<void>>()

  constructor(
    private readonly send: (frame: ExtToRelay) => void,
    private readonly onDebuggerEvent: (tabId: number, method: string, params: unknown) => void,
    private readonly onDebuggerDetached: (tabId: number, reason?: string) => void,
  ) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId
      if (tabId === undefined) return
      this.onDebuggerEvent(tabId, method, params ?? {})
    })
    chrome.debugger.onDetach.addListener((source) => {
      const tabId = source.tabId
      if (tabId === undefined) return
      const reason = chrome.runtime.lastError?.message
      this.onDebuggerDetached(tabId, reason)
    })
  }

  async handleFrame(frame: RelayToExt): Promise<void> {
    if (!('id' in frame)) return
    const idFrame = frame as RelayToExt & WithId
    const handler = this.route(idFrame)
    if (handler === null) return
    try {
      const result = await handler()
      this.send({ t: 'result', id: idFrame.id, ok: true, result })
    } catch (err) {
      this.send({ t: 'result', id: idFrame.id, ok: false, error: toRelayError(err, this.classify(err)) })
    }
  }

  private route(frame: RelayToExt & WithId): (() => Promise<unknown>) | null {
    switch (frame.t) {
      case 'tabs.list':
        return async () => await this.listTabs()
      case 'tab.new':
        return async () => {
          const tab = await chrome.tabs.create({ url: frame.url, active: frame.active ?? true })
          return { tabId: tab.id ?? -1 }
        }
      case 'tab.close':
        return async () => {
          await chrome.tabs.remove(frame.tabId)
          return {}
        }
      case 'tab.activate':
        return async () => {
          await chrome.tabs.update(frame.tabId, { active: true })
          return {}
        }
      case 'attach':
        return async () => {
          await this.attach(frame.tabId)
          return {}
        }
      case 'detach':
        return async () => {
          await chrome.debugger.detach({ tabId: frame.tabId })
          this.attached.delete(frame.tabId)
          return {}
        }
      case 'cmd':
        return async () => await this.sendCommand(frame.tabId, frame.method, frame.params)
      default:
        return null
    }
  }

  private classify(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('INELIGIBLE_TARGET') || msg.includes('Cannot attach to this target')) return 'INELIGIBLE_TARGET'
    if (msg.startsWith('TIMEOUT')) return 'TIMEOUT'
    if (msg.includes('Another debugger') || msg.includes('attach')) return 'ATTACH_FAILED'
    return 'CMD_FAILED'
  }

  private async listTabs(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({})
    return tabs
      .filter(tab => tab.id !== undefined)
      .map(tab => ({
        tabId: tab.id as number,
        title: tab.title ?? '',
        url: tab.url ?? tab.pendingUrl ?? '',
        active: tab.active ?? false,
        eligible: isEligibleUrl(tab.url ?? tab.pendingUrl ?? ''),
      }))
  }

  async attach(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId)
    const url = tab.url ?? tab.pendingUrl ?? ''
    if (!isEligibleUrl(url)) {
      throw new Error(`INELIGIBLE_TARGET: ${url} 属不可操作目标（chrome:// 等）`)
    }
    if (this.attached.has(tabId)) return
    // 并发 attach 去重（auto-attach 与 createTarget 显式挂载竞态：第二次 attach 会报 Another debugger）
    const inflight = this.attaching.get(tabId)
    if (inflight !== undefined) {
      await inflight
      return
    }
    const p = (async () => {
      try {
        await chrome.debugger.attach({ tabId }, '1.3')
        this.attached.add(tabId)
      } finally {
        this.attaching.delete(tabId)
      }
    })()
    this.attaching.set(tabId, p)
    await p
  }

  sendCommand(tabId: number, method: string, params: unknown): Promise<unknown> {
    if (!this.attached.has(tabId)) {
      // cmd 直达时自动补 attach（relay 侧常规路径先发 attach 帧）
      return this.attach(tabId).then(() => this.sendCommandInner(tabId, method, params))
    }
    return this.sendCommandInner(tabId, method, params)
  }

  private sendCommandInner(tabId: number, method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('TIMEOUT: CDP 命令超时（60s）'))
        }
      }, CMD_TIMEOUT_MS)
      chrome.debugger.sendCommand({ tabId }, method, (params ?? {}), (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (chrome.runtime.lastError !== undefined) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(result ?? {})
        }
      })
    })
  }

  markDetached(tabId: number, reason?: string): void {
    this.attached.delete(tabId)
    this.onDebuggerDetached(tabId, reason)
  }
}
