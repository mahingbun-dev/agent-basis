// 本扩展用到的 chrome.* 最小类型面（自持，不用 @types/chrome：
// oxlint/tsgolint 对其解析不稳定会导致整片 chrome API 被判 any）。
// 仅声明实际使用的成员；新用 API 在此补类型。
// 形态说明：不能用 `namespace debugger`（TS2819）也不能 `const debugger`（TS1389），
// 故整个 chrome 用「declare const + 属性类型」表达。

interface ChromeEvent<Args extends unknown[]> {
  addListener(cb: (...args: Args) => void): void
  removeListener(cb: (...args: Args) => void): void
}

interface Debuggee {
  tabId?: number | undefined
  extensionId?: string | undefined
  targetId?: string | undefined
}

interface DebuggerStatic {
  attach(target: Debuggee, requiredVersion: string): Promise<void>
  detach(target: Debuggee): Promise<void>
  sendCommand(target: Debuggee, method: string, params: object | undefined, callback: (result?: object  ) => void): void
  onEvent: ChromeEvent<[source: Debuggee, method: string, params: object | undefined]>
  onDetach: ChromeEvent<[source: Debuggee]>
}

interface ChromeTab {
  id?: number | undefined
  index?: number | undefined
  windowId?: number | undefined
  title?: string | undefined
  url?: string | undefined
  pendingUrl?: string | undefined
  active?: boolean | undefined
}

interface TabsStatic {
  query(query: Record<string, unknown>): Promise<ChromeTab[]>
  create(createProperties: { url?: string | undefined; active?: boolean | undefined }): Promise<ChromeTab>
  get(tabId: number): Promise<ChromeTab>
  remove(tabId: number | number[]): Promise<void>
  update(tabId: number, updateProperties: { active?: boolean | undefined; url?: string | undefined }): Promise<ChromeTab | undefined>
  onCreated: ChromeEvent<[tab: ChromeTab]>
  onUpdated: ChromeEvent<[tabId: number, changeInfo: { status?: string; title?: string; url?: string }, tab: ChromeTab]>
  onRemoved: ChromeEvent<[tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }]>
}

interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

interface StorageStatic {
  local: StorageArea
  session: StorageArea
  onChanged: ChromeEvent<[changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string]>
}

interface RuntimeStatic {
  lastError: { message: string } | undefined
  getManifest(): { name: string; version: string; manifest_version: number }
}

interface Alarm {
  name: string
  scheduledTime: number
}

interface AlarmsStatic {
  create(name: string, alarmInfo: { periodInMinutes?: number; when?: number; delayInMinutes?: number }): void
  onAlarm: ChromeEvent<[alarm: Alarm]>
}

declare const chrome: {
  debugger: DebuggerStatic
  tabs: TabsStatic
  storage: StorageStatic
  runtime: RuntimeStatic
  alarms: AlarmsStatic
}
