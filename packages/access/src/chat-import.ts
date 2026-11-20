/**
 * T30 chat-import 租户桥(2026-11-20;47 §2.11/B16 · 50 §3.6/§5.3 · 54 §4.6)。
 *
 * 上游事实(rc.5,实核):
 * - `@deepseek-ai/dsh-deepseek-chat-import` 以 exact Fetch 路由登记
 *   `POST /api/deepseek-chat-import/archive`(lib/index.js:1402 UPLOAD_PATH、
 *   :1683 `ctx.connection.fetch.register({path, methods:['POST'],
 *   requestBody:'streaming'})`),响应体是 `application/x-ndjson` 的进度行 +
 *   唯一一条 outcome 行(lib/index.js:1400-1410、:1470-1490):
 *   `{"type":"outcome","outcome":{"ok":true,"value":{…,"sessionIds":[…]}}}` /
 *   `{"type":"outcome","outcome":{"ok":false,"error":{"reason","message"}}}`;
 * - 成功后 `sessionIds` = 本次写入的会话 id 列表(lib/index.js:1090-1102);
 * - 资格判定只有 `principalOf(ctx.invocation) !== undefined`(lib/index.js:1712
 *   `limits()`),而 unary HTTP 恒 owner Peer → 对本品每个登录用户都"通过",
 *   等于没有租户校验(H10);workspaceRegistry 是全局注册表,猜到他人
 *   workspaceId 即可把会话写进他人工作区(47 §2.11 第 2 条);
 * - 导入直接写 sessionPersistence,绕过 /api/session/create 的
 *   store.recordSession → 导入会话在 access 账本里无主(47 §2.11 第 3 条)。
 *
 * 接入缝(为什么不是 admit 包装):design 47 B16 写的是"在 admit 返回的 Response
 * 上包 TransformStream",但 rc.5 的 `connection.admit(req)` 只返回
 * `{peer}` / `{rejection}`(dsh-client-connection lib/index.js:742-750),Response
 * 在 bridge 内部由 fetch 路由创建(:82-96),admit 层拿不到 body。本车道又被
 * 明令不改 mux.ts(admit 包装所在处)。因此本模块接上游**声明过的** waterfall
 * 扩展点 `connection/request`
 * (dsh-client-connection lib/types/index.d.ts:21-31:"Admit or wrap an
 * authenticated shared API request, including body transfer";发起处
 * lib/index.js:1055,在 admit 通过后、bridge 之前):
 *   1. 请求级租户门——命中 POST /api/deepseek-chat-import/archive 时先按 eterna
 *      cookie 判定:无会话 401、workspaceId 缺失 400、workspace 非本人 403,
 *      拒绝即不 next()(等于拦在导入体读取之前,不读上传内容、不落日志);
 *   2. 流式记账——放行后给 Node 响应的 write/end 套一层 pass-through
 *      `TransformStream`(不缓冲整包,逐 chunk 透传 + 逐行解析),解析最终 outcome
 *      行的 `outcome.value.sessionIds`,逐条幂等 `store.recordSession`;
 *   3. 失败/取消对账——响应 finish/close 后读
 *      `workspaceRegistry.get(workspaceId).sessionIds`,把账本里无主的会话补给
 *      workspace 属主(workspace 单属主,不跨租户);对账失败也走审计。
 *
 * 纪律:
 * - 单行上限 64KB(50 §5.3):超限整行丢弃、不阻断、继续解析后续行;
 * - 解析失败只告警不阻断上传(同上);记账**绝不改写既有归属**——
 *   `sessionOwner(id) !== undefined` 一律跳过(幂等 + 防跨租户窃取);
 * - 审计只记 userId/workspaceId/结果/会话数,**不记标题与压缩包内容**(B16);
 * - 上游 owner 检查保留(纵深;本模块不替代它,也不依赖它)。
 */
import type { AccessAuditEvent } from './audit.ts'

/** 上游上传路由(绝对路径,含 /api 前缀;lib/index.js:1396-1399 UPLOAD_PATH)。 */
export const CHAT_IMPORT_ARCHIVE_PATH = '/api/deepseek-chat-import/archive'

/** 单行上限 64KB(50 §5.3);超限整行丢弃但流继续。 */
export const CHAT_IMPORT_MAX_LINE_BYTES = 64 * 1024

const NEWLINE = 0x0a

/** 一次导入的最终结果行(50 §5.3;只有最终 outcome 行被记账)。 */
export interface ChatImportOutcome {
  readonly ok: boolean
  /** outcome.ok=true 时的 `outcome.value.sessionIds`(已滤掉非字符串项)。 */
  readonly sessionIds: readonly string[]
}

/** 本模块消费的 Node 请求面(node:http IncomingMessage 的结构子集)。 */
export interface ChatImportRequest {
  readonly url?: unknown
  readonly method?: unknown
  readonly headers?: unknown
  /** 早拒时掐断未读上传体(512MiB 不读、不缓冲);测试可缺席。 */
  destroy?: () => void
}

/** 本模块消费的 Node 响应面(node:http ServerResponse 的结构子集)。 */
export interface ChatImportResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  write(chunk: unknown, ...rest: unknown[]): unknown
  end(chunk?: unknown, ...rest: unknown[]): unknown
  /** 终止信号面:正常结束 finish、客户端断开 close。 */
  once?: (event: 'finish' | 'close', listener: () => void) => unknown
  /** bridge 用 writableEnded 判读客户端是否已断开(dsh-client-connection :40-46)。 */
  readonly writableEnded?: boolean
}

/** waterfall 监听器(`connection/request` 的 next 链)。 */
export type ChatImportGateListener = (
  request: ChatImportRequest,
  response: ChatImportResponse,
  next: () => Promise<void>,
) => Promise<void>

/** 本模块消费的登录/账本/工作区面(结构子集;不 import store/session 类型面)。 */
export interface ChatImportGateDeps {
  readonly store: {
    workspaceOwner(workspaceId: string): number | undefined
    sessionOwner(sessionId: string): number | undefined
    recordSession(sessionId: string, ownerId: number, workspaceId: string | null): void
    getPasswordVersion(userId: number): number | undefined
    getUserById(userId: number): { readonly id: number } | undefined
  }
  readonly session: {
    resolveUser(cookieHeader: string | undefined): { readonly userId: number; readonly passwordVersion: number } | undefined
  }
  /** `workspaceRegistry.get(id).sessionIds`(reflect 惰性读;服务未就绪返回 undefined)。 */
  readonly workspaceSessionIds: (workspaceId: string) => readonly string[] | undefined
  audit(event: AccessAuditEvent): void
}

/** `connection/request` 的注册面(cordis ctx.on 的结构子集)。 */
export interface ChatImportEventHost {
  on?: (event: 'connection/request', listener: ChatImportGateListener, options?: { readonly prepend?: boolean }) => () => void
}

export interface ChatImportGate {
  readonly listener: ChatImportGateListener
  /** 观测/测试面:等在途的响应解析与对账收敛(生产侧不依赖)。 */
  whenIdle(): Promise<void>
}

// ── 通用小工具 ──────────────────────────────────────────────────────────────

/** 从 req.url 取 pathname(双形态:纯路径或完整 URL;解析失败按去 query 原文)。 */
export function chatImportPathnameOf(rawUrl: string): string {
  if (rawUrl === '') return ''
  const cut = rawUrl.indexOf('?')
  const bare = cut === -1 ? rawUrl : rawUrl.slice(0, cut)
  if (bare.startsWith('/')) return bare
  try {
    return new URL(bare).pathname
  } catch {
    return bare
  }
}

/** 从 req.url 取 workspaceId(上游同款:URL.searchParams.get,lib/index.js:1421)。 */
export function chatImportWorkspaceIdOf(rawUrl: string): string {
  try {
    return new URL(rawUrl, 'http://dsh.internal').searchParams.get('workspaceId') ?? ''
  } catch {
    return ''
  }
}

function headerOf(request: ChatImportRequest, name: string): string | undefined {
  const headers = request.headers
  if (headers === null || typeof headers !== 'object') return undefined
  const bag = headers as Record<string, unknown>
  const value = bag[name] ?? bag[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function toBytes(chunk: unknown): Uint8Array | undefined {
  if (chunk instanceof Uint8Array) return chunk
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  return undefined
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left, 0)
  merged.set(right, left.length)
  return merged
}

// ── NDJSON 逐行解析(TransformStream pass-through)─────────────────────────────

/**
 * pass-through NDJSON 行解析器:输出=输入(立刻 enqueue,不缓冲整包),
 * 每凑满一行(遇 `\n`)调一次 `onLine`;单行超 `maxLineBytes` 整行丢弃、流继续。
 * 解析/回调异常不外抛(50 §5.3「解析失败不阻断上传」)。
 */
export function createNdjsonTap(
  onLine: (line: string) => void,
  maxLineBytes: number = CHAT_IMPORT_MAX_LINE_BYTES,
): TransformStream<Uint8Array, Uint8Array> {
  let carry: Uint8Array = new Uint8Array(0)
  let overflow = false
  const decoder = new TextDecoder()

  const deliver = (bytes: Uint8Array): void => {
    if (bytes.length === 0) return
    try {
      onLine(decoder.decode(bytes))
    } catch {
      // 单行解析/回调故障:丢弃该行,不阻断上传
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      let start = 0
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== NEWLINE) continue
        const tail = chunk.subarray(start, index)
        start = index + 1
        // 单行上限:超限整行丢弃(含「前几段已攒进 carry」的情况),流继续。
        if (overflow || carry.length + tail.length > maxLineBytes) {
          overflow = false
          carry = new Uint8Array(0)
          continue
        }
        deliver(carry.length === 0 ? tail : concatBytes(carry, tail))
        carry = new Uint8Array(0)
      }
      const rest = chunk.subarray(start)
      if (rest.length === 0 || overflow) return
      if (carry.length + rest.length > maxLineBytes) {
        overflow = true
        carry = new Uint8Array(0)
        return
      }
      carry = carry.length === 0 ? new Uint8Array(rest) : concatBytes(carry, rest)
    },
    flush() {
      if (!overflow && carry.length > 0) deliver(carry)
      carry = new Uint8Array(0)
      overflow = false
    },
  })
}

/**
 * 解析一行 NDJSON,只有最终 outcome 行有值:
 * - `{type:'outcome',outcome:{ok:true,value:{sessionIds:[…]}}}`;
 * - `{type:'outcome',outcome:{ok:false,error:{reason,message}}}`(sessionIds 空)。
 * 其余行(progress 等)与非 JSON 文本返回 undefined。
 */
export function parseChatImportOutcome(line: string): ChatImportOutcome | undefined {
  const text = line.trim()
  if (text === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as { readonly type?: unknown; readonly outcome?: unknown }
  if (record.type !== 'outcome') return undefined
  const outcome = record.outcome
  if (outcome === null || typeof outcome !== 'object') return undefined
  const outcomeBag = outcome as { readonly ok?: unknown; readonly value?: unknown }
  if (outcomeBag.ok !== true) return { ok: false, sessionIds: [] }
  const value = outcomeBag.value
  if (value === null || typeof value !== 'object') return { ok: true, sessionIds: [] }
  const raw = (value as { readonly sessionIds?: unknown }).sessionIds
  if (!Array.isArray(raw)) return { ok: true, sessionIds: [] }
  const sessionIds = raw.filter((id): id is string => typeof id === 'string' && id !== '')
  return { ok: true, sessionIds }
}

// ── 审计(只记身份/结果/计数;不记标题与压缩包内容)──────────────────────────

type AuditAction = 'denied' | 'import.ok' | 'import.rejected' | 'import.cancelled' | 'import.failed'

function audit(deps: ChatImportGateDeps, action: AuditAction, detail: Record<string, unknown>): void {
  try {
    deps.audit({ kind: 'access.chatImport', detail: { action, ...detail } })
  } catch {
    // 审计故障吞掉:决策/记账已落,不能反咬 HTTP 面
  }
}

// ── 请求级租户门 ─────────────────────────────────────────────────────────────

/** cookie → 登录用户(与 tenant.ts currentUser 同口径:pwv 比对 + 用户存在)。 */
function userIdOfCookie(deps: ChatImportGateDeps, cookie: string | undefined): number | undefined {
  const claims = deps.session.resolveUser(cookie)
  if (claims === undefined) return undefined
  const passwordVersion = deps.store.getPasswordVersion(claims.userId)
  if (passwordVersion === undefined || passwordVersion !== claims.passwordVersion) return undefined
  const user = deps.store.getUserById(claims.userId)
  if (user === undefined) return undefined
  return user.id
}

/** 早拒:写状态与短文本,不读请求体;响应冲完再掐断未读上传(上游 413 同款)。 */
function reject(request: ChatImportRequest, response: ChatImportResponse, status: number, body: string): void {
  const destroyBody = (): void => {
    try {
      request.destroy?.()
    } catch {
      // 无 destroy 面/已断:忽略
    }
  }
  // 先挂 finish 再 end:真实 node 里 finish 在 end 之后异步触发;
  // 替身/异常载体若同步触发也不会漏掐上传体。
  const destroyAfterFlush = typeof request.destroy === 'function'
  if (destroyAfterFlush && typeof response.once === 'function') response.once('finish', destroyBody)
  try {
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      connection: 'close',
    })
  } catch {
    // 头部已发:尽力而为,下面仍试 end
  }
  try {
    response.end(body)
    return
  } catch {
    // 连接已断
  }
  if (destroyAfterFlush) destroyBody()
}

export function createChatImportGate(deps: ChatImportGateDeps): ChatImportGate {
  let pending: Promise<void> = Promise.resolve()

  const listener: ChatImportGateListener = async (request, response, next) => {
    const rawUrl = typeof request.url === 'string' ? request.url : ''
    if (chatImportPathnameOf(rawUrl) !== CHAT_IMPORT_ARCHIVE_PATH) return next()
    // 只有 POST 能导入(上游 methods:['POST']);其它方法原样交回上游(恒 404/405),
    // 不在本门制造与上游不一致的状态码。
    if ((typeof request.method === 'string' ? request.method : 'GET').toUpperCase() !== 'POST') return next()

    const cookie = headerOf(request, 'cookie')
    const userId = userIdOfCookie(deps, cookie)
    if (userId === undefined) {
      audit(deps, 'denied', { reason: 'unauthenticated' })
      reject(request, response, 401, 'unauthorized')
      return
    }
    const workspaceId = chatImportWorkspaceIdOf(rawUrl)
    if (workspaceId === '') {
      audit(deps, 'denied', { reason: 'workspace-missing', userId })
      reject(request, response, 400, 'workspaceId is required')
      return
    }
    if (deps.store.workspaceOwner(workspaceId) !== userId) {
      // 不读 body、不打印压缩包内容(47 B16 第 1 条);连标题都不入审计。
      audit(deps, 'denied', { reason: 'workspace-foreign', userId, workspaceId })
      reject(request, response, 403, 'forbidden')
      return
    }

    pending = runGated(response, next, deps, userId, workspaceId)
    await pending
  }

  return {
    listener,
    whenIdle: () => pending,
  }
}

/** 记账:幂等且绝不改写既有归属(sessionOwner 已存在 → 跳过,含他人所有)。 */
function recordOnce(
  deps: ChatImportGateDeps,
  sessionId: string,
  userId: number,
  workspaceId: string,
): boolean {
  if (sessionId === '') return false
  if (deps.store.sessionOwner(sessionId) !== undefined) return false
  deps.store.recordSession(sessionId, userId, workspaceId)
  return true
}

/**
 * 放行后的流式记账 + 终态对账。响应体原样透传,写出的每个 chunk 同时喂给
 * pass-through TransformStream 逐行解析;只有最终 outcome 行的
 * `outcome.value.sessionIds` 被逐条记账,终态再按 workspace 会话清单对账补记。
 */
async function runGated(
  response: ChatImportResponse,
  next: () => Promise<void>,
  deps: ChatImportGateDeps,
  userId: number,
  workspaceId: string,
): Promise<void> {
  const state: { outcome?: ChatImportOutcome; status: number; recorded: number; skipped: number; failure?: string } = {
    status: 0,
    recorded: 0,
    skipped: 0,
  }

  const tap = createNdjsonTap((line) => {
    const outcome = parseChatImportOutcome(line)
    if (outcome === undefined) return
    state.outcome = outcome
    if (!outcome.ok) return
    for (const sessionId of outcome.sessionIds) {
      if (recordOnce(deps, sessionId, userId, workspaceId)) state.recorded += 1
      else state.skipped += 1
    }
  })

  const writer = tap.writable.getWriter()
  const drained: Promise<void> = tap.readable.pipeTo(new WritableStream()).catch(() => {
    // 丢弃输出侧失败:解析器故障不得反咬响应
  })
  let chain: Promise<void> = Promise.resolve()
  let closing = false
  const closeTap = (): void => {
    if (closing) return
    closing = true
    chain = chain.then(() => writer.close()).catch(() => {
      // 已关闭/流已错:忽略
    })
  }
  const feed = (chunk: unknown): void => {
    const bytes = toBytes(chunk)
    if (bytes === undefined) return
    chain = chain.then(() => writer.write(bytes)).catch(() => {
      // 解析器故障吞掉(50 §5.3):响应字节与调用方不受影响
    })
  }

  const originalWrite = response.write.bind(response)
  const originalEnd = response.end.bind(response)
  const originalWriteHead = response.writeHead.bind(response)
  const originalOnce = response.once?.bind(response)

  // 记状态码(只为终态审计定性:415/404 等「上游未产出 outcome」不能记成「取消」)。
  response.writeHead = (status: number, headers?: Record<string, string>): unknown => {
    state.status = status
    return originalWriteHead(status, headers)
  }
  response.write = (chunk: unknown, ...rest: unknown[]): unknown => {
    feed(chunk)
    return originalWrite(chunk, ...rest)
  }
  response.end = (chunk?: unknown, ...rest: unknown[]): unknown => {
    if (chunk !== undefined) feed(chunk)
    closeTap()
    return originalEnd(chunk, ...rest)
  }

  let settlePromise: Promise<void> = Promise.resolve()
  let settled = false
  const finalize = (): Promise<void> => {
    if (settled) return settlePromise
    settled = true
    // 断连/早终时上游不再写 end:先冲刷解析器(flush 会交付末段半行),再等等读侧收敛。
    closeTap()
    settlePromise = chain.then(() => drained).then(() => { reconcile() }).catch(() => {
      // 终态收敛故障:审计在 reconcile 内尽力而为,不抛给宿主
    })
    return settlePromise
  }

  originalOnce?.('finish', () => { void finalize() })
  originalOnce?.('close', () => { void finalize() })

  try {
    await next()
  } catch (error) {
    state.failure = error instanceof Error ? error.message : String(error)
    // 上游 bridge 自行处理绝大多数失败;此处只兜底「响应未结束」的残局,
    // 不让导入链的异常外溢成未处理拒绝。
    if (response.writableEnded !== true) {
      try {
        response.end()
      } catch {
        // 已断:忽略
      }
    }
  } finally {
    await finalize()
  }

  /** 终态对账:workspace 是单属主(store.workspaceOwner 已校验),只补无主会话。 */
  function reconcile(): void {
    const sessionIds = deps.workspaceSessionIds(workspaceId) ?? []
    let reconciled = 0
    for (const sessionId of sessionIds) {
      if (recordOnce(deps, sessionId, userId, workspaceId)) reconciled += 1
    }
    const outcome = state.outcome
    // 无 outcome 行时按状态码定性:上游受理(200)却无终态行 = 取消/断开;
    // 非 200(415 非 octet-stream、404 路由未装载等)= 上游拒绝,不是取消。
    const action: AuditAction = outcome === undefined
      ? (state.failure !== undefined
        ? 'import.failed'
        : (state.status !== 0 && state.status !== 200 ? 'import.rejected' : 'import.cancelled'))
      : (outcome.ok ? 'import.ok' : 'import.rejected')
    audit(deps, action, {
      userId,
      workspaceId,
      sessions: state.recorded,
      skipped: state.skipped,
      reconciled,
      ...(outcome === undefined ? {} : { outcomeOk: outcome.ok }),
      ...(state.status === 0 ? {} : { status: state.status }),
      ...(state.failure === undefined ? {} : { error: state.failure }),
    })
  }
}

/** 安装(默认 prepend:先于其它 waterfall 监听器,门在最前);host 缺面返回 undefined。 */
export function installChatImportGate(
  deps: ChatImportGateDeps,
  host: ChatImportEventHost | undefined,
): (() => void) | undefined {
  const on = host?.on
  if (typeof on !== 'function') return undefined
  try {
    return on('connection/request', createChatImportGate(deps).listener, { prepend: true })
  } catch {
    // 事件总线不可注册(宿主漂移):放弃安装,审计由调用方记录
    return undefined
  }
}

/**
 * workspaceRegistry 读取面(reflect 惰性):`get(id).sessionIds`
 * (dsh-workspace lib/types/index.d.ts:136 `get`、:89 `Workspace.sessionIds`)。
 * 服务缺席/形态漂移一律 undefined(对账降级,不阻断导入)。
 */
export function workspaceSessionIdsOf(
  reflect: { get(name: string, strict?: boolean): unknown },
  workspaceId: string,
): readonly string[] | undefined {
  try {
    const registry = reflect.get('workspaceRegistry', false) as
      | { get?: (id: string) => unknown }
      | undefined
    const workspace = registry?.get?.(workspaceId)
    if (workspace === null || workspace === undefined || typeof workspace !== 'object') return undefined
    const sessionIds = (workspace as { readonly sessionIds?: unknown }).sessionIds
    if (!Array.isArray(sessionIds)) return undefined
    return sessionIds.filter((id): id is string => typeof id === 'string')
  } catch {
    return undefined
  }
}
