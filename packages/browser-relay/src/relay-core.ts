// 中继核心（E1-T2 → E4 多用户，2026-11-11）：扩展腿按「命名空间=凭据串」多路复用。
// 每个有效 token（主 token 或 access 下发的用户 token）一个独立状态域——tabs/sessions/
// pending 各自隔离，多用户浏览器并行互不可见。/cdp 腿（playwright sidecar 兜底，T2）
// 维持绑定主命名空间（未上线生产；E5 工作时再命名空间化）。
// 与 WS 传输解耦（ExtLink/CdpSink 注入），便于单测；设计参照 Playwright MCP BrowserModel
// 的公开实现（Apache-2.0，仅借鉴结构，代码为本仓自研）。

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

/** 单命名空间状态：一条扩展连接 + 它浏览器的全部会话事实 */
interface NsState {
  link: ExtLink | null
  extVersion?: string | undefined
  chromeVersion?: string | undefined
  extPending: Map<number, PendingExt>
  extSeq: number
  /** CDP sessionId → tabId */
  sessions: Map<number, number>
  sessionByTab: Map<number, number>
  readonly attachedTabs: Set<number>
  pendingSessions: Map<number, Promise<number>>
  knownTabs: Map<number, TabInfo>
}

function newState(): NsState {
  return {
    link: null,
    extVersion: undefined,
    chromeVersion: undefined,
    extPending: new Map(),
    extSeq: 1,
    sessions: new Map(),
    sessionByTab: new Map(),
    attachedTabs: new Set(),
    pendingSessions: new Map(),
    knownTabs: new Map(),
  }
}

function mapDetachReason(raw?: string): string {
  const r = (raw ?? '').toLowerCase()
  if (r.includes('devtools') || r.includes('f12')) return 'replaced_with_devtools'
  if (r.includes('cancel')) return 'canceled_by_user'
  return 'target_closed'
}

export class RelayCore {
  /** 主命名空间（主 token；无 token 开发形态 '__local__'）——/cdp 腿与无凭据工具调用的落点 */
  readonly defaultNs: string
  private readonly nsStates = new Map<string, NsState>()
  private sink: CdpSink | null = null
  private clientPending = new Map<number, ClientPending>()
  private sessionSeq = 1
  private autoAttach = false
  onEventLog: (line: string) => void = () => {}

  constructor(defaultNs = '__local__') {
    this.defaultNs = defaultNs
  }

  // ---- 命名空间解析 ----

  /** 工具调用的路由命名空间：带凭据（_eternaToken）→ 该用户域；缺省 → 主域 */
  nsFor(credential?: string): string {
    if (credential !== undefined && credential !== '') return credential
    return this.defaultNs
  }

  private state(ns: string): NsState {
    let s = this.nsStates.get(ns)
    if (s === undefined) {
      s = newState()
      this.nsStates.set(ns, s)
    }
    return s
  }

  nsConnected(ns: string): boolean {
    return (this.nsStates.get(ns)?.link ?? null) !== null
  }

  /** 任一命名空间有连接（/api/status 汇总用） */
  get extensionConnected(): boolean {
    for (const s of this.nsStates.values()) {
      if (s.link !== null) return true
    }
    return false
  }

  /** 已连接命名空间数（多用户并发视图） */
  get connectedCount(): number {
    let n = 0
    for (const s of this.nsStates.values()) {
      if (s.link !== null) n += 1
    }
    return n
  }

  /** 连接清单（/api/status 多用户视图；不含凭据，只含版本信息） */
  connections(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    for (const [ns, s] of this.nsStates) {
      if (s.link === null) continue
      out.push({
        extVersion: s.extVersion ?? null,
        chromeVersion: s.chromeVersion ?? null,
        tabCount: s.knownTabs.size,
        primary: ns === this.defaultNs,
      })
    }
    return out
  }

  // ---- 连接管理 ----

  setExt(ns: string, link: ExtLink | null): void {
    const s = this.state(ns)
    if (s.link !== null && link !== null) {
      throw new CdpError(-32000, '该令牌已有浏览器连接，拒绝同令牌的第二接入（每令牌一台浏览器）')
    }
    s.link = link
    if (link === null) {
      // 扩展断开：该域会话全部失效（E1 最小处理；E2 做状态机与重 attach）
      s.attachedTabs.clear()
      for (const [sessionId] of s.sessions) {
        if (ns === this.defaultNs) {
          this.emitClient({ method: 'Inspector.detached', params: { reason: 'target_closed' }, sessionId: String(sessionId) })
        }
      }
      s.sessions.clear()
      s.sessionByTab.clear()
      s.knownTabs.clear()
      this.rejectNsExtPending(ns, new Error('扩展连接已断开'))
    }
  }

  setCdp(sink: CdpSink | null): void {
    if (this.sink !== null && sink !== null && this.sink !== sink) {
      this.onEventLog('CDP 客户端重连：旧会话作废')
    }
    this.sink = sink
    if (sink === null) {
      this.rejectAllClientPending(new CdpError(-32000, 'CDP 客户端已断开'))
      const s = this.state(this.defaultNs)
      s.sessions.clear()
      s.sessionByTab.clear()
    }
  }

  async onExtHello(link: ExtLink, frame: Extract<ExtToRelay, { t: 'hello' }>, ns: string): Promise<void> {
    if (frame.proto !== PROTO_VERSION) {
      throw new CdpError(-32000, `PROTO_MISMATCH: 扩展协议 ${String(frame.proto)} ≠ 服务端 ${String(PROTO_VERSION)}`)
    }
    const s = this.state(ns)
    s.extVersion = link.extVersion
    s.chromeVersion = link.chromeVersion
    this.setExt(ns, link)
    // 重连后刷新 tab 快照
    try {
      const tabs = (await this.extRequest(ns, { t: 'tabs.list', id: 0 }, 10_000)) as TabInfo[]
      if (Array.isArray(tabs)) {
        s.knownTabs.clear()
        for (const tab of tabs) s.knownTabs.set(tab.tabId, tab)
      }
    } catch {
      this.onEventLog(`[${this.nsLabel(ns)}] 握手后刷新 tab 列表失败（忽略，等待生命周期帧）`)
    }
    if (this.autoAttach && ns === this.defaultNs && this.sink !== null) {
      await this.attachAllEligible(ns)
    }
  }

  // ---- 扩展腿消息 ----

  async onExtFrame(frame: ExtToRelay, ns: string): Promise<void> {
    const s = this.state(ns)
    const primary = ns === this.defaultNs
    switch (frame.t) {
      case 'hello':
        return // 由 server 显式调用 onExtHello（需要 link 注入）
      case 'pong':
        return
      case 'result': {
        const pending = s.extPending.get(frame.id)
        if (pending === undefined) return
        s.extPending.delete(frame.id)
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
        const sessionId = s.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined && primary) {
          this.emitClient({ method: frame.method, params: frame.params, sessionId: String(sessionId) })
        }
        return
      }
      case 'detached': {
        s.attachedTabs.delete(frame.tabId)
        const sessionId = s.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined) {
          s.sessions.delete(sessionId)
          s.sessionByTab.delete(frame.tabId)
          if (primary) {
            this.emitClient({
              method: 'Inspector.detached',
              params: { reason: mapDetachReason(frame.reason) },
              sessionId: String(sessionId),
            })
          }
        }
        return
      }
      case 'tab.created': {
        s.knownTabs.set(frame.tab.tabId, frame.tab)
        if (primary && this.sink !== null) this.emitClient({ method: 'Target.targetCreated', params: { targetInfo: this.targetInfo(frame.tab, false) } })
        if (this.autoAttach && frame.tab.eligible && primary && this.sink !== null) {
          try {
            await this.ensureSession(ns, frame.tab.tabId)
          } catch (err) {
            this.onEventLog(`[${this.nsLabel(ns)}] 新 tab 自动 attach 失败：${err instanceof Error ? err.message : String(err)}`)
          }
        }
        return
      }
      case 'tab.updated': {
        const tab = s.knownTabs.get(frame.tabId)
        if (tab === undefined) return
        if (frame.title !== undefined) tab.title = frame.title
        if (frame.url !== undefined) tab.url = frame.url
        if (frame.active !== undefined) tab.active = frame.active
        if (primary && this.sink !== null) this.emitClient({ method: 'Target.targetInfoChanged', params: { targetInfo: this.targetInfo(tab, s.sessionByTab.has(frame.tabId)) } })
        return
      }
      case 'tab.removed': {
        s.knownTabs.delete(frame.tabId)
        const sessionId = s.sessionByTab.get(frame.tabId)
        if (sessionId !== undefined) {
          s.sessions.delete(sessionId)
          s.sessionByTab.delete(frame.tabId)
        }
        if (primary && this.sink !== null) this.emitClient({ method: 'Target.targetDestroyed', params: { targetId: String(frame.tabId) } })
        return
      }
    }
  }

  // ---- CDP 腿消息（主命名空间；T2 sidecar 兜底用） ----

  async handleClientMessage(raw: unknown): Promise<void> {
    const msg = raw as { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }
    if (typeof msg.id !== 'number' || typeof msg.method !== 'string') return
    this.onEventLog(`CDP ← ${msg.method}${msg.sessionId !== undefined ? ' (session)' : ''}`)
    try {
      const result = await this.dispatch(this.defaultNs, msg.method, msg.params ?? {}, msg.sessionId)
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

  private async dispatch(ns: string, method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const s = this.state(ns)
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
        return { targetInfos: this.targetInfos(s) }
      case 'Target.setDiscoverTargets':
        return {}
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] }
      case 'Target.setAutoAttach': {
        this.autoAttach = params['autoAttach'] === true
        if (this.autoAttach && this.sink !== null) {
          await this.attachAllEligible(ns)
        }
        return {}
      }
      case 'Target.attachToTarget': {
        const tabId = Number(params['targetId'])
        if (!Number.isFinite(tabId)) throw new CdpError(-32602, 'targetId 无效')
        const sid = await this.ensureSession(ns, tabId)
        return { sessionId: String(sid) }
      }
      case 'Target.closeTarget': {
        const tabId = Number(params['targetId'])
        await this.extRequest(ns, { t: 'tab.close', id: 0, tabId })
        return {}
      }
      case 'Target.createTarget': {
        const url = typeof params['url'] === 'string' ? params['url'] : 'about:blank'
        const created = (await this.extRequest(ns, { t: 'tab.new', id: 0, url, active: true })) as { tabId: number }
        const tabId = created.tabId
        if (!s.knownTabs.has(tabId)) {
          s.knownTabs.set(tabId, { tabId, title: '', url, active: true, eligible: true })
        }
        if (this.autoAttach && this.sink !== null) {
          // attachedToTarget 必须先于 createTarget 响应到达：playwright doCreateNewPage 在
          // 响应后同步读 _crPages.get(targetId)，而该条目由 attachedToTarget 事件建立
          await this.ensureSession(ns, tabId)
        }
        return { targetId: String(tabId) }
      }
      case 'Target.getTargetInfo': {
        const tabId = params['targetId'] === undefined ? this.firstTabId(s) : Number(params['targetId'])
        const tab = s.knownTabs.get(tabId)
        if (tab === undefined) throw new CdpError(-32000, `目标不存在：${String(tabId)}`)
        return { targetInfo: this.targetInfo(tab, s.sessionByTab.has(tabId)) }
      }
      case 'Target.activateTarget': {
        const tabId = Number(params['targetId'])
        await this.extRequest(ns, { t: 'tab.activate', id: 0, tabId })
        return {}
      }
      case 'Target.sendMessageToTarget': {
        // 非 flatten 兼容路径：解包内层消息，按 session 分派，结果以事件回传
        const inner = JSON.parse(String(params['message'])) as { id?: number; method: string; params?: Record<string, unknown> }
        const sid = params['sessionId'] === undefined ? undefined : Number(params['sessionId'])
        const reply: Record<string, unknown> = {}
        try {
          reply['result'] = (await this.dispatch(ns, inner.method, inner.params ?? {}, sid === undefined ? undefined : String(sid))) ?? {}
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
        const tabId = s.sessions.get(Number(sessionId))
        if (tabId === undefined) throw new CdpError(-32000, `未知 sessionId：${sessionId}`)
        return await this.extRequest(ns, { t: 'cmd', id: 0, tabId, method, params })
      }
    }
  }

  // ---- 会话与 attach ----

  private async attachAllEligible(ns: string): Promise<void> {
    const s = this.state(ns)
    for (const tab of s.knownTabs.values()) {
      if (!tab.eligible) continue
      try {
        await this.ensureSession(ns, tab.tabId)
      } catch (err) {
        this.onEventLog(`自动 attach tab#${String(tab.tabId)} 失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private async ensureSession(ns: string, tabId: number): Promise<number> {
    const s = this.state(ns)
    const existing = s.sessionByTab.get(tabId)
    if (existing !== undefined) return existing
    // 并发去重（tab.created 自动挂载与 createTarget/attachToTarget 显式挂载竞态）
    const pending = s.pendingSessions.get(tabId)
    if (pending !== undefined) return await pending
    const p = (async () => {
      try {
        if (!s.attachedTabs.has(tabId)) {
          await this.extRequest(ns, { t: 'attach', id: 0, tabId }, ATTACH_TIMEOUT_MS)
          s.attachedTabs.add(tabId)
        }
        const sessionId = this.sessionSeq++
        s.sessions.set(sessionId, tabId)
        s.sessionByTab.set(tabId, sessionId)
        const tab = s.knownTabs.get(tabId)
        if (ns === this.defaultNs && this.sink !== null) {
          this.emitClient({
            method: 'Target.attachedToTarget',
            params: { sessionId: String(sessionId), targetInfo: this.targetInfo(tab ?? { tabId, title: '', url: '', active: false, eligible: true }, true), waitingForDebugger: false },
          })
        }
        return sessionId
      } finally {
        s.pendingSessions.delete(tabId)
      }
    })()
    s.pendingSessions.set(tabId, p)
    return await p
  }

  private firstTabId(s: NsState): number {
    for (const tabId of s.knownTabs.keys()) return tabId
    throw new CdpError(-32000, '浏览器无可用 tab')
  }

  private targetInfo(tab: TabInfo, attached: boolean): Record<string, unknown> {
    // browserContextId 必填：playwright _onAttachedToTarget 对缺失该字段的 target 直接 detach；
    // 常量 id 未注册于 getBrowserContexts，playwright 会回退到默认 context
    return { targetId: String(tab.tabId), type: 'page', title: tab.title, url: tab.url, attached, canAccessOpener: false, browserContextId: 'eterna-default' }
  }

  private targetInfos(s: NsState): Array<Record<string, unknown>> {
    return [...s.knownTabs.values()].map(tab => this.targetInfo(tab, s.sessionByTab.has(tab.tabId)))
  }

  // ---- 底层收发 ----

  private extRequest(ns: string, frame: ExtRequestFrame, timeoutMs = EXT_REQ_TIMEOUT_MS): Promise<unknown> {
    const s = this.state(ns)
    const link = s.link
    if (link === null) return Promise.reject(new CdpError(-32000, '扩展未连接'))
    const id = s.extSeq++
    const full: ExtRequestFrame = { ...frame, id }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        s.extPending.delete(id)
        reject(new CdpError(-32000, `TIMEOUT: 扩展命令超时（${String(timeoutMs)}ms）：${frame.t}`))
      }, timeoutMs)
      s.extPending.set(id, { resolve, reject, timer })
      link.send(full)
    })
  }

  private emitClient(msg: Record<string, unknown>): void {
    if (this.sink === null) return
    this.sink.send(msg)
  }

  private rejectNsExtPending(ns: string, err: Error): void {
    const s = this.state(ns)
    for (const pending of s.extPending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    s.extPending.clear()
  }

  private rejectAllClientPending(err: CdpError): void {
    for (const pending of this.clientPending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.clientPending.clear()
  }

  private nsLabel(ns: string): string {
    return ns === this.defaultNs ? 'primary' : 'user'
  }

  // ---- 工具层公共 API（E1-T3：snapshot/click/fill 直连 CDP，不经 playwright；E4 ns 化）----

  /** tab 会话命令（自动 attach；扩展端 cmd 兜底也会补 attach） */
  async sendTabCommand(ns: string, tabId: number, method: string, params?: unknown): Promise<unknown> {
    await this.ensureSession(ns, tabId)
    return await this.extRequest(ns, { t: 'cmd', id: 0, tabId, method, params })
  }

  /** 打开新 tab 并挂载会话 */
  async openTab(ns: string, url?: string): Promise<number> {
    const s = this.state(ns)
    const created = (await this.extRequest(ns, { t: 'tab.new', id: 0, url, active: true })) as { tabId: number }
    const tabId = created.tabId
    if (!s.knownTabs.has(tabId)) {
      s.knownTabs.set(tabId, { tabId, title: '', url: url ?? '', active: true, eligible: true })
    }
    await this.ensureSession(ns, tabId)
    return tabId
  }

  /** 工具层诊断日志出口 */
  logLine(line: string): void {
    this.onEventLog(line)
  }

  getTabInfo(ns: string, tabId: number): TabInfo | undefined {
    return this.state(ns).knownTabs.get(tabId)
  }

  listTabs(ns: string): TabInfo[] {
    return [...this.state(ns).knownTabs.values()]
  }

  /** 供 server 生成 /json/list（主命名空间） */
  listForHttp(): Array<Record<string, unknown>> {
    return this.targetInfos(this.state(this.defaultNs)).map(t => ({
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
