// Service Worker 入口：设置加载 → relay 连接 → 帧路由（tabs 生命周期 + debugger 事件桥）。
// SW 每次唤醒都会重新执行本文件（无状态）：连接由 RelayClient 重建，attach 状态按需重建。

import { CdpBridge } from './cdp.ts'
import { isEligibleUrl, PROTO_VERSION, type ExtToRelay, type RelayToExt, type TabInfo } from './protocol.ts'
import { RelayClient } from './relay-client.ts'
import { getSettings, setConnState } from './state.ts'

function chromeVersion(): string | undefined {
  const ua = navigator.userAgent
  const m = /Chrome\/(\d+[\d.]*)/.exec(ua)
  return m?.[1]
}

const client = new RelayClient({
  onHello: () => ({
    t: 'hello',
    proto: PROTO_VERSION,
    ext: 'eterna-companion',
    extVersion: chrome.runtime.getManifest().version,
    chromeVersion: chromeVersion(),
  }),
  onPing: () => ({ t: 'pong' }),
  onFrame: (frame: RelayToExt) => {
    void bridge.handleFrame(frame)
  },
})

const bridge = new CdpBridge(
  (frame: ExtToRelay) => {
    client.send(frame)
  },
  (tabId: number, method: string, params: unknown) => {
    client.send({ t: 'event', tabId, method, params })
  },
  (tabId: number, reason?: string) => {
    client.send({ t: 'detached', tabId, reason })
  },
)

// tabs 生命周期 → 专用帧（契约见 CDP-FRAME-PROTOCOL.md）
function tabToInfo(tab: ChromeTab): TabInfo | null {
  if (tab.id === undefined) return null
  const url = tab.url ?? tab.pendingUrl ?? ''
  return {
    tabId: tab.id,
    title: tab.title ?? '',
    url,
    active: tab.active ?? false,
    eligible: isEligibleUrl(url),
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  const info = tabToInfo(tab)
  if (info !== null) client.send({ t: 'tab.created', tab: info })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  client.send({ t: 'tab.removed', tabId })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === 'complete') {
    const info = tabToInfo(tab)
    if (info === null) {
      client.send({ t: 'tab.removed', tabId })
      return
    }
    client.send({ t: 'tab.updated', tabId, title: info.title, url: info.url, active: info.active })
  }
})

// 设置变更 → 重连到新 relay URL；启动 → 连接
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['settings'] !== undefined) {
    void getSettings().then((s) => {
      client.configure(s)
    })
  }
})

void (async () => {
  const settings = await getSettings()
  client.configure(settings)
  client.start(settings)
})()

// SW 唤醒兜底（alarms 最小间隔 30s，Chrome 120+）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    client.send({ t: 'pong' })
  }
})

void (async () => {
  await setConnState('connecting', 'SW 启动')
})()
