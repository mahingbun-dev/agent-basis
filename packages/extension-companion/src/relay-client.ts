// relay WebSocket 客户端：重连退避 + 20s 保活（契约：CDP-FRAME-PROTOCOL.md）。
// SW 被杀重启后由 background 顶层重建；连接状态写入 storage.session 供设置页展示。

import type { ExtToRelay, RelayToExt } from './protocol.ts'
import type { Settings } from './state.ts'
import { setConnState } from './state.ts'

export interface RelayClientHooks {
  onFrame: (frame: RelayToExt) => void
  onHello: () => ExtToRelay
  onPing: () => ExtToRelay
}

export class RelayClient {
  private ws: WebSocket | null = null
  private backoffMs = 1000
  private timer: ReturnType<typeof setTimeout> | null = null
  private keepalive: ReturnType<typeof setInterval> | null = null
  private settings: Settings = { relayUrl: 'ws://127.0.0.1:9310/extension', token: '' }
  private closedByUs = false

  constructor(private readonly hooks: RelayClientHooks) {}

  configure(settings: Settings): void {
    const urlChanged = settings.relayUrl !== this.settings.relayUrl
    this.settings = settings
    if (urlChanged && (this.ws !== null || this.timer !== null)) {
      this.reconnectNow()
    }
  }

  start(settings: Settings): void {
    this.settings = settings
    this.connect()
    chrome.alarms.create('keepalive', { periodInMinutes: 0.5 })
  }

  stop(): void {
    this.closedByUs = true
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.keepalive !== null) clearInterval(this.keepalive)
    this.ws?.close()
  }

  send(frame: ExtToRelay): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
    }
  }

  private reconnectNow(): void {
    this.ws?.close()
    this.schedule(0)
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.connect()
    }, delayMs)
  }

  private connect(): void {
    if (this.closedByUs) return
    void setConnState('connecting', this.settings.relayUrl)
    try {
      const url = this.settings.token !== '' ? `${this.settings.relayUrl}?token=${encodeURIComponent(this.settings.token)}` : this.settings.relayUrl
      const ws = new WebSocket(url)
      this.ws = ws
      ws.onopen = () => {
        this.backoffMs = 1000
        void setConnState('connected', this.settings.relayUrl)
        this.send(this.hooks.onHello())
        if (this.keepalive !== null) clearInterval(this.keepalive)
        this.keepalive = setInterval(() => {
          this.send(this.hooks.onPing())
        }, 20_000)
      }
      ws.onmessage = (ev) => {
        try {
          this.hooks.onFrame(JSON.parse(String(ev.data)) as RelayToExt)
        } catch {
          // 非法帧忽略（服务端契约保证合法；防御性处理）
        }
      }
      ws.onclose = () => {
        if (this.keepalive !== null) clearInterval(this.keepalive)
        this.keepalive = null
        this.ws = null
        if (this.closedByUs) return
        void setConnState('disconnected', `重连于 ${this.backoffMs}ms 后`)
        this.schedule(this.backoffMs)
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
      }
      ws.onerror = () => {
        ws.close()
      }
    } catch {
      void setConnState('disconnected', 'URL 无效')
      this.schedule(this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
    }
  }
}
