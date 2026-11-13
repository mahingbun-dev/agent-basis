/**
 * 工具审批桥(2026-11-13):治理 default:ask 的调用在 web 前端不可见也不可决——
 * dsh-web-frontend 0.2.2-rc.1 发行包没有任何审批面(上游 dsh-client-ui-approval
 * 未打进 web 构建;api-session-controller 契约有 pendingInput 但前端不消费),
 * pending ask = 无限假死(session-7e15e6ab 实测 31+ 分钟转圈)。
 *
 * 本模块在宿主侧接住内核 approval/request waterfall(dsh-acp 同款答者 seam,
 * dsh-user-approval decide():dispatch 到各答者,首个有效 outcome 胜出;无人应答
 * = 'unavailable'):已知归属的会话 → 登记待决审批,按归属人暴露给本人浏览器
 * (轮询 + 裁决);未知会话(系统任务等)next() 透传。
 *
 * 语义对齐内核 ApprovalOutcome:
 * - 本人允许 → 'allowed-once';本人拒绝 → 'rejected'
 * - 超时未决(ETERNA_TOOL_APPROVAL_TIMEOUT_MS,缺省 300s)→ 'unavailable'
 *   (内核 deny reason =「无可用审批渠道」,模型可自纠;不冒充「用户拒绝」)
 * - turn 中止(signal abort)→ 'cancelled'(与内核 decide 的 abort 竞速语义一致)
 *
 * 多租户:登记按 sessionOwner 归账,裁决/列表都校验归属人,跨用户不可见不可决。
 */
import { randomUUID } from 'node:crypto'
import type { AccessAuditEvent } from './audit.ts'

/** 内核 ApprovalOutcome 的本桥可能产出的子集(unavailable=超时;cancelled=中止)。 */
export type BridgeOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 待决审批的浏览器视图(轮询端点返回体条目)。 */
export interface ToolApprovalView {
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  readonly callId: string | null
  readonly reason: string | null
  readonly requestedAt: number
  readonly expiresAt: number
}

export interface ApprovalBridgeDeps {
  /** dsh 会话 id → 归属用户 id;未知会话返回 undefined(companion 同款归属账本)。 */
  readonly sessionOwner: (sessionId: string) => number | undefined
  audit(event: AccessAuditEvent): void
  /** 超时未决毫秒数;到点以 'unavailable' 收场(见头注语义段)。 */
  readonly timeoutMs: number
}

/** 结构面:内核 approval/request 的字段子集(serviceAsk 装配,无 id——id 在 asked 事件里)。 */
interface ApprovalRequestLike {
  readonly toolName?: unknown
  readonly callId?: unknown
  readonly reason?: unknown
  readonly signal?: {
    addEventListener?: (type: string, listener: () => void, opts?: { once?: boolean }) => void
    removeEventListener?: (type: string, listener: () => void) => void
  }
  readonly agent?: { session?: { id?: unknown } }
}

interface PendingEntry {
  readonly id: string
  readonly ownerId: number
  readonly view: ToolApprovalView
  resolve(outcome: BridgeOutcome): void
}

const optString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

function sessionOf(request: ApprovalRequestLike): string | null {
  const id = request.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : null
}

function signalOf(request: ApprovalRequestLike): ApprovalRequestLike['signal'] {
  const signal = request.signal
  if (typeof signal?.addEventListener !== 'function') return undefined
  return signal
}

/** 工具审批桥:登记 + 答者 + 裁决面(routes.ts 薄包装消费)。 */
export class ApprovalBridge {
  readonly #pending = new Map<string, PendingEntry>()
  readonly #deps: ApprovalBridgeDeps

  constructor(deps: ApprovalBridgeDeps) {
    this.#deps = deps
  }

  /**
   * 注册 approval/request 答者(先例 dsh-acp lib/index.js:1093:waterfall 传播到宿主
   * ctx 的 on 注册面)。已知归属才接手;其余 next() 透传给后位答者(无人应答时内核
   * 以 'unavailable' 兜底)。register 由调用方装配(plugin.ts 侧结构面 cast,cordis
   * on 的具体重载面不进本模块)。返回 disposer。
   */
  installAnswerer(register: (listener: (request: unknown, next: () => unknown) => unknown) => () => void): () => void {
    return register((request, next) => {
      if (request === null || typeof request !== 'object') return next()
      const req = request as ApprovalRequestLike
      const sessionId = sessionOf(req)
      if (sessionId === null) return next()
      const ownerId = this.#deps.sessionOwner(sessionId)
      if (ownerId === undefined) return next()
      return this.#waitForDecision(req, ownerId, sessionId)
    })
  }

  /** 本人视角的待决列表(过期条目过滤;裁决后即消失)。 */
  listFor(ownerId: number): ToolApprovalView[] {
    const now = Date.now()
    return [...this.#pending.values()]
      .filter(entry => entry.ownerId === ownerId && entry.view.expiresAt > now)
      .map(entry => entry.view)
      .sort((a, b) => a.requestedAt - b.requestedAt)
  }

  /**
   * 本人裁决。返回 false = 条目不存在/已收场/非归属人(跨用户裁决一律拒绝)。
   * allow=true → 'allowed-once'(仅本次生效,内核语义);false → 'rejected'。
   */
  decide(id: string, userId: number, allow: boolean): boolean {
    const entry = this.#pending.get(id)
    if (entry === undefined || entry.ownerId !== userId) return false
    this.#finish(entry, allow ? 'allowed-once' : 'rejected')
    this.#deps.audit({
      kind: 'access.approval.decided',
      detail: { id, toolName: entry.view.toolName, sessionId: entry.view.sessionId, outcome: allow ? 'allow' : 'reject' },
    })
    return true
  }

  /** 当前归属人待决数(客户端轮询轻量面预留)。 */
  pendingCount(ownerId: number): number {
    return this.listFor(ownerId).length
  }

  #waitForDecision(request: ApprovalRequestLike, ownerId: number, sessionId: string): Promise<BridgeOutcome> {
    const id = randomUUID()
    const now = Date.now()
    const view: ToolApprovalView = {
      id,
      sessionId,
      toolName: optString(request.toolName) ?? '(unknown tool)',
      callId: optString(request.callId),
      reason: optString(request.reason),
      requestedAt: now,
      expiresAt: now + this.#deps.timeoutMs,
    }
    return new Promise<BridgeOutcome>((resolve) => {
      let settled = false
      const timerHolder: { timer?: ReturnType<typeof setTimeout> } = {}
      const signal = signalOf(request)
      const finish = (outcome: BridgeOutcome): void => {
        if (settled) return
        settled = true
        if (timerHolder.timer !== undefined) clearTimeout(timerHolder.timer)
        signal?.removeEventListener?.('abort', onAbort)
        this.#pending.delete(id)
        resolve(outcome)
      }
      const onAbort = (): void => {
        finish('cancelled')
      }
      timerHolder.timer = setTimeout(() => {
        this.#deps.audit({
          kind: 'access.approval.expired',
          detail: { id, toolName: view.toolName, sessionId, waitedMs: this.#deps.timeoutMs },
        })
        finish('unavailable')
      }, this.#deps.timeoutMs)
      signal?.addEventListener?.('abort', onAbort, { once: true })
      this.#pending.set(id, { id, ownerId, view, resolve: finish })
      this.#deps.audit({
        kind: 'access.approval.surfaced',
        detail: { id, toolName: view.toolName, sessionId, ownerId, timeoutMs: this.#deps.timeoutMs },
      })
    })
  }

  #finish(entry: PendingEntry, outcome: BridgeOutcome): void {
    entry.resolve(outcome)
  }
}

/** 超时读取:ETERNA_TOOL_APPROVAL_TIMEOUT_MS(毫秒,正整数),非法/缺省回 300s。 */
export function toolApprovalTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(env['ETERNA_TOOL_APPROVAL_TIMEOUT_MS'] ?? '', 10)
  return Number.isInteger(raw) && raw > 0 ? raw : 300_000
}
