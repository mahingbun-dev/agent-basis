// 中继核心（E1-T2）：扩展腿 ↔ CDP 腿的最小会话管理。
// 与 WS 传输解耦（ExtLink/CdpSink 注入），便于单测；E2 在此之上做断线状态机与幂等。
// 设计参照 Playwright MCP BrowserModel 的公开实现（Apache-2.0，仅借鉴结构，代码为本仓自研）。

import { CdpError, PROTO_VERSION, type ExtRequestFrame, type ExtToRelay, type RelayError, type RelayToExt, type TabInfo } from './protocol.ts'

const EXT_REQ_TIMEOUT_MS = 90_000
const ATTACH_TIMEOUT_MS = 15_000

/** 扩展连接抽象（WS 或测试桩） */
export interface ExtLink {
  send(frame: RelayToExt): void
  readonly extVersion?: string | undefined
  readonly chromeVersion?: string | undefined
}

/** CDP 客户端（playwright-core）侧的消息出口 */
export interface CdpSink {
  send(msg: unknown): void
}

interface PendingExt {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ClientPending {
  resolve: (result: unknown) => void
  reject: (err: CdpError) => void
  timer: ReturnType<typeof setTimeout>
}

function mapDetachReason(raw?: string): string {
  const r = (raw ?? '').toLowerCase()
  if (r.includes('devtools') || r.includes('f12')) return 'replaced_with_devtools'
  if (r.includes('cancel')) return 'canceled_by_user'
  return 'target_closed'
}

export class RelayCore {
  private ext: ExtLink | null = null
  private sink: CdpSink | null = null
  private extPending = new Map<number, PendingExt>()
  private clientPending = new Map<number, ClientPending>()
  private extSeq = 1
  private sessionSeq = 1
  /** CDP sessionId → tabId */
  private sessions = new Map<number, number>()
  private sessionByTab = new Map<number, number>()
  private readonly attachedTabs = new Set<number>()
  private readonly pendingSessions = new Map<number, Promise<number>>()
  private autoAttach = false
  private knownTabs = new Map<number, TabInfo>()
  onEventLog: (line: string) => void = () => {}

  // ---- 连接管理 ----

  get extension(): { extVersion?: string | undefined; chromeVersion?: string | undefined } | null {
    return this.ext === null ? null : { extVersion: this.ext.extVersion, chromeVersion: this.ext.chromeVersion }
  }

  get extensionConnected(): boolean {
    return this.ext !== null
  }

  get tabCount(): number {
    return this.knownTabs.size
  }

  setExt(link: ExtLink | null): void {
    if (this.ext !== null && link !== null) {
      throw new CdpError(-32000, '扩展已有连接，拒绝第二个扩展接入')
    }
    this.ext = link
    if (link === null) {
      // 扩展断开：会话全部失效（E1 最小处理；E2 做状态机与重 attach）
      this.attachedTabs.clear()
      for (const [sessionId] of this.sessions) {
        this.emitClient({ method: 'Inspector.detached', params: { reason: 'target_closed' }, sessionId: String(sessionId) })
      }
      this.sessions.clear()
      this.sessionByTab.clear()
      this.knownTabs.clear()
      this.rejectAllExtPending(new Error('扩展连接已断开'))
    }
  }

  setCdp(sink: CdpSink | null): void {
    if (this.sink !== null && sink !== null && this.sink !== sink) {
      this.onEventLog('CDP 客户端重连：旧会话作废')
    }
    this.sink = sink
    if (sink === null) {
      this.rejectAllClientPending(new CdpError(-32000, 'CDP 客户端已断开'))
      this.sessions.clear()
      this.sessionByTab.clear()
    }
  }

  async onExtHello(link: ExtLink, frame: Extract<ExtToRelay, { t: 'hello' }>): Promise<void> {
    if (frame.proto !== PROTO_VERSION) {
      throw new CdpError(-32000, `PROTO_MISMATCH: 扩展协议 ${String(frame.proto)} ≠ 服务端 ${String(PROTO_VERSION)}`)
    }
    this.setExt(link)
    // 重连后刷新 tab 快照
    try {
      const tabs = (await this.extRequest({ t: 'tabs.list', id: 0 }, 10_000)) as TabInfo[]
      if (Array.isArray(tabs)) {
        this.knownTabs.clear()
        for (const tab of tabs) this.knownTabs.set(tab.tabId, tab)
      }
    } catch {
      this.onEventLog('握手后刷新 tab 列表失败（忽略，等待生命周期帧）')
    }
    if (this.autoAttach && this.sink !== null) {
      await this.attachAllEligible()
    }
  }

  // ---- 扩展腿消息 ----

  async onExtFrame(frame: ExtToRelay): Promise<void> {
    switch (frame.t) {
      case 'hello':
        return // 由 server 显式调用 onExtHello（需要 link 注入）
      case 'pong':
        return
      case 'result': {
        const pending = this.extPending.get(frame.id)
        if (pending === undefined) return
        this.extPending.delete(frame.id)
        clearTimeout(pending.timer)
        if (frame.ok) pending.resolve(frame.result)
        else {
          // 错误码进消息前缀（CDP JSON-RPC error.code 是数值域，字符串码只能走 message）
          const e = new Error(`[${frame.error.code}] ${frame.error.message}`)
          pending.reject(e)
        }
        return
      }
      case 'event': {
        const sessionId = this.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined) {
          this.emitClient({ method: frame.method, params: frame.params, sessionId: String(sessionId) })
        }
        return
      }
      case 'detached': {
        this.attachedTabs.delete(frame.tabId)
        const sessionId = this.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined) {
          this.sessions.delete(sessionId)
          this.sessionByTab.delete(frame.tabId)
          this.emitClient({
            method: 'Inspector.detached',
            params: { reason: mapDetachReason(frame.reason) },
            sessionId: String(sessionId),
          })
        }
        return
      }
      case 'tab.created': {
        this.knownTabs.set(frame.tab.tabId, frame.tab)
        if (this.sink !== null) this.emitClient({ method: 'Target.targetCreated', params: { targetInfo: this.targetInfo(frame.tab, false) } })
        if (this.autoAttach && frame.tab.eligible && this.sink !== null) {
          try {
            await this.ensureSession(frame.tab.tabId)
          } catch (err) {
            this.onEventLog(`新 tab 自动 attach 失败：${err instanceof Error ? err.message : String(err)}`)
          }
        }
        return
      }
      case 'tab.updated': {
        const tab = this.knownTabs.get(frame.tabId)
        if (tab === undefined) return
        if (frame.title !== undefined) tab.title = frame.title
        if (frame.url !== undefined) tab.url = frame.url
        if (frame.active !== undefined) tab.active = frame.active
        if (this.sink !== null) this.emitClient({ method: 'Target.targetInfoChanged', params: { targetInfo: this.targetInfo(tab, this.sessionByTab.has(frame.tabId)) } })
        return
      }
      case 'tab.removed': {
        this.knownTabs.delete(frame.tabId)
        const sessionId = this.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined) {
          this.sessions.delete(sessionId)
          this.sessionByTab.delete(frame.tabId)
        }
        if (this.sink !== null) this.emitClient({ method: 'Target.targetDestroyed', params: { targetId: String(frame.tabId) } })
        return
      }
    }
  }

  // ---- CDP 腿消息 ----

  async handleClientMessage(raw: unknown): Promise<void> {
    const msg = raw as { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }
    if (typeof msg.id !== 'number' || typeof msg.method !== 'string') return
    this.onEventLog(`CDP ← ${msg.method}${msg.sessionId !== undefined ? ' (session)' : ''}`)
    try {
      const result = await this.dispatch(msg.method, msg.params ?? {}, msg.sessionId)
      const okReply: Record<string, unknown> = { id: msg.id, result: result ?? {} }
      if (msg.sessionId !== undefined) okReply.sessionId = msg.sessionId
      this.emitClient(okReply)
    } catch (err) {
      const code = err instanceof CdpError ? err.code : -32000
      const message = err instanceof Error ? err.message : String(err)
      this.onEventLog(`CDP error → ${msg.method}: [${String(code)}] ${message}`)
      const errReply: Record<string, unknown> = { id: msg.id, error: { code, message } }
      if (msg.sessionId !== undefined) errReply.sessionId = msg.sessionId
      this.emitClient(errReply)
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    // 浏览器级与 Target 编排命令在服务端本地处理；其余按 session 转发扩展
    switch (method) {
      case 'Browser.getVersion':
        return { protocolVersion: '1.3', product: 'Chrome', revision: '0', userAgent: 'EternaCompanionRelay/0.1', jsVersion: 'v8' }
      case 'Browser.close':
        return {}
      case 'Browser.getWindowForTarget':
        return { windowId: -1, bounds: { left: 0, top: 0, width: 0, height: 0, windowState: 'normal' } }
      // playwright connectOverCDP 初始化期发送的浏览器级命令：无害 stub（E1 下载走扩展层，E2 起按需补真实语义）
      case 'Browser.setDownloadBehavior':
      case 'Browser.setWindowBounds':
      case 'Browser.grantPermissions':
      case 'Browser.resetPermissions':
      case 'Browser.setUserAgentOverride':
        return {}
      case 'Target.getTargets':
        return { targetInfos: this.targetInfos() }
      case 'Target.setDiscoverTargets':
        return {}
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] }
      case 'Target.setAutoAttach': {
        this.autoAttach = params['autoAttach'] === true
        if (this.autoAttach && this.sink !== null) {
          await this.attachAllEligible()
        }
        return {}
      }
      case 'Target.attachToTarget': {
        const tabId = Number(params['targetId'])
        if (!Number.isFinite(tabId)) throw new CdpError(-32602, 'targetId 无效')
        const sid = await this.ensureSession(tabId)
        return { sessionId: String(sid) }
      }
      case 'Target.closeTarget': {
        const tabId = Number(params['targetId'])
        await this.extRequest({ t: 'tab.close', id: 0, tabId })
        return {}
      }
      case 'Target.createTarget': {
        const url = typeof params['url'] === 'string' ? params['url'] : 'about:blank'
        const created = (await this.extRequest({ t: 'tab.new', id: 0, url, active: true })) as { tabId: number }
        const tabId = created.tabId
        if (!this.knownTabs.has(tabId)) {
          this.knownTabs.set(tabId, { tabId, title: '', url, active: true, eligible: true })
        }
        if (this.autoAttach && this.sink !== null) {
          // attachedToTarget 必须先于 createTarget 响应到达：playwright doCreateNewPage 在
          // 响应后同步读 _crPages.get(targetId)，而该条目由 attachedToTarget 事件建立
          await this.ensureSession(tabId)
        }
        return { targetId: String(tabId) }
      }
      case 'Target.getTargetInfo': {
        const tabId = params['targetId'] === undefined ? this.firstTabId() : Number(params['targetId'])
        const tab = this.knownTabs.get(tabId)
        if (tab === undefined) throw new CdpError(-32000, `目标不存在：${String(tabId)}`)
        return { targetInfo: this.targetInfo(tab, this.sessionByTab.has(tabId)) }
      }
      case 'Target.activateTarget': {
        const tabId = Number(params['targetId'])
        await this.extRequest({ t: 'tab.activate', id: 0, tabId })
        return {}
      }
      case 'Target.sendMessageToTarget': {
        // 非 flatten 兼容路径：解包内层消息，按 session 分派，结果以事件回传
        const inner = JSON.parse(String(params['message'])) as { id?: number; method: string; params?: Record<string, unknown> }
        const sid = params['sessionId'] === undefined ? undefined : Number(params['sessionId'])
        const reply: Record<string, unknown> = {}
        try {
          reply['result'] = (await this.dispatch(inner.method, inner.params ?? {}, sid === undefined ? undefined : String(sid))) ?? {}
        } catch (err) {
          reply['error'] = { code: err instanceof CdpError ? err.code : -32000, message: err instanceof Error ? err.message : String(err) }
        }
        if (inner.id !== undefined) {
          this.emitClient({ method: 'Target.sendMessageToTarget', params: { sessionId: params['sessionId'], message: JSON.stringify({ id: inner.id, ...reply }) } })
        }
        return {}
      }
      default: {
        if (sessionId === undefined) {
          throw new CdpError(-32601, `不支持的方法：${method}（浏览器级命令仅支持 Target 编排子集）`)
        }
        const tabId = this.sessions.get(Number(sessionId))
        if (tabId === undefined) throw new CdpError(-32000, `未知 sessionId：${sessionId}`)
        return await this.extRequest({ t: 'cmd', id: 0, tabId, method, params })
      }
    }
  }

  // ---- 会话与 attach ----

  private async attachAllEligible(): Promise<void> {
    for (const tab of this.knownTabs.values()) {
      if (!tab.eligible) continue
      try {
        await this.ensureSession(tab.tabId)
      } catch (err) {
        this.onEventLog(`自动 attach tab#${String(tab.tabId)} 失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private async ensureSession(tabId: number): Promise<number> {
    const existing = this.sessionByTab.get(tabId)
    if (existing !== undefined) return existing
    // 并发去重（tab.created 自动挂载与 createTarget/attachToTarget 显式挂载竞态）
    const pending = this.pendingSessions.get(tabId)
    if (pending !== undefined) return await pending
    const p = (async () => {
      try {
        if (!this.attachedTabs.has(tabId)) {
          await this.extRequest({ t: 'attach', id: 0, tabId }, ATTACH_TIMEOUT_MS)
          this.attachedTabs.add(tabId)
        }
        const sessionId = this.sessionSeq++
        this.sessions.set(sessionId, tabId)
        this.sessionByTab.set(tabId, sessionId)
        const tab = this.knownTabs.get(tabId)
        if (this.sink !== null) {
          this.emitClient({
            method: 'Target.attachedToTarget',
            params: { sessionId: String(sessionId), targetInfo: this.targetInfo(tab ?? { tabId, title: '', url: '', active: false, eligible: true }, true), waitingForDebugger: false },
          })
        }
        return sessionId
      } finally {
        this.pendingSessions.delete(tabId)
      }
    })()
    this.pendingSessions.set(tabId, p)
    return await p
  }

  private firstTabId(): number {
    for (const tabId of this.knownTabs.keys()) return tabId
    throw new CdpError(-32000, '浏览器无可用 tab')
  }

  private targetInfo(tab: TabInfo, attached: boolean): Record<string, unknown> {
    // browserContextId 必填：playwright _onAttachedToTarget 对缺失该字段的 target 直接 detach；
    // 常量 id 未注册于 getBrowserContexts，playwright 会回退到默认 context
    return { targetId: String(tab.tabId), type: 'page', title: tab.title, url: tab.url, attached, canAccessOpener: false, browserContextId: 'eterna-default' }
  }

  private targetInfos(): Array<Record<string, unknown>> {
    return [...this.knownTabs.values()].map(tab => this.targetInfo(tab, this.sessionByTab.has(tab.tabId)))
  }

  // ---- 底层收发 ----

  private extRequest(frame: ExtRequestFrame, timeoutMs = EXT_REQ_TIMEOUT_MS): Promise<unknown> {
    const link = this.ext
    if (link === null) return Promise.reject(new CdpError(-32000, '扩展未连接'))
    const id = this.extSeq++
    const full: ExtRequestFrame = { ...frame, id }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.extPending.delete(id)
        reject(new CdpError(-32000, `TIMEOUT: 扩展命令超时（${String(timeoutMs)}ms）：${frame.t}`))
      }, timeoutMs)
      this.extPending.set(id, { resolve, reject, timer })
      link.send(full)
    })
  }

  private emitClient(msg: Record<string, unknown>): void {
    if (this.sink === null) return
    this.sink.send(msg)
  }

  private rejectAllExtPending(err: Error): void {
    for (const pending of this.extPending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.extPending.clear()
  }

  private rejectAllClientPending(err: CdpError): void {
    for (const pending of this.clientPending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.clientPending.clear()
  }

  // ---- 工具层公共 API（E1-T3：snapshot/click/fill 直连 CDP，不经 playwright）----

  /** tab 会话命令（自动 attach；扩展端 cmd 兜底也会补 attach） */
  async sendTabCommand(tabId: number, method: string, params?: unknown): Promise<unknown> {
    await this.ensureSession(tabId)
    return await this.extRequest({ t: 'cmd', id: 0, tabId, method, params })
  }

  /** 打开新 tab 并挂载会话 */
  async openTab(url?: string): Promise<number> {
    const created = (await this.extRequest({ t: 'tab.new', id: 0, url, active: true })) as { tabId: number }
    const tabId = created.tabId
    if (!this.knownTabs.has(tabId)) {
      this.knownTabs.set(tabId, { tabId, title: '', url: url ?? '', active: true, eligible: true })
    }
    await this.ensureSession(tabId)
    return tabId
  }

  /** 工具层诊断日志出口 */
  logLine(line: string): void {
    this.onEventLog(line)
  }

  getTabInfo(tabId: number): TabInfo | undefined {
    return this.knownTabs.get(tabId)
  }

  listTabs(): TabInfo[] {
    return [...this.knownTabs.values()]
  }

  /** 供 server 生成 /json/list */
  listForHttp(): Array<Record<string, unknown>> {
    return this.targetInfos().map(t => ({
      description: '',
      devtoolsFrontendUrl: '',
      faviconUrl: '',
      id: t['targetId'],
      type: t['type'],
      title: t['title'],
      url: t['url'],
      webSocketDebuggerUrl: '',
    }))
  }

  relayErrorToRelayError(err: unknown): RelayError {
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code ?? 'RELAY_ERROR'
    return { code, message }
  }
}
