/**
 * 租户守卫(T2.2,模型 A):connection.fetch 路由按完整路径拥有 unary /api 端点,
 * 读 eterna_session 归属用户 → ownership 表判定 → 钳制/放行 → 进程内直调真实
 * 控制器(spike 实证 reflect.get('<serviceKey>', false))→ 自框 RPC 信封。
 *
 * 事实依据(2026-11-10 spike/源码实读):
 * - fetchRoutes 按完整 pathname verbatim 键控,网页/直连同门(client-connection lib/index.js:823/849)
 * - 控制器方法直调可用,请求参数对象形态 {request:{...}}(workspace) / {path,name}(picker)
 * - 真实流(workspace/follow)走 WS mux /api/remote.mux(REMOTE_STREAM_MUX_PATH),
 *   fetch 守卫不覆盖 → 列表元数据可见性=R12 已知限制;数据面(写/picker/session)全守
 * - 直连线格式 payload={args:{...}}(REMOTE_EVENT_STREAM_PAYLOAD 同源解谜);
 *   守卫层在 gateway 校验之前,读原始 body 自行解包
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { withinRoot } from './within-root.ts'
import { registerUserPluginRoutes } from './user-plugins.ts'
import type { AccessAuditEvent, AuditReflect } from './audit.ts'
import type { SessionService } from './session.ts'
import type { UserStore } from './store.ts'

/** 守卫消费的 connection.fetch 注册面(结构子集,register 返回 async disposer)。 */
export interface TenantFetchRegistry {
  register(route: {
    readonly path: string
    readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
    readonly requestBody: 'buffered' | 'streaming'
    readonly fetch: (request: Request) => Promise<Response>
  }): () => Promise<void>
}

export interface TenantDeps {
  readonly store: UserStore
  readonly session: SessionService
  readonly reflect: AuditReflect
  /** 租户根基目录(默认 $ETERNA_TENANT_ROOT,再退 $DSH_HOME/workspaces);每用户根=其下账号目录。 */
  readonly tenantRoot: string
  audit(event: AccessAuditEvent): void
  /** P1-T2:mux 隔离惰性安装钩子(服务在插件 apply 后才挂载,首个守卫请求时落地)。 */
  readonly ensureMux?: () => void
}

type ServiceHandle = Record<string, (...args: never[]) => unknown>

/** 反射取宿主控制器(audit-bridge 模式:strict=false 机会语义,缺席返回 undefined)。 */
function serviceOf(deps: Pick<TenantDeps, 'reflect'>, key: string): ServiceHandle | undefined {
  return deps.reflect.get(key, false) as ServiceHandle | undefined
}

interface GuardContext {
  readonly deps: TenantDeps
  readonly userId: number
  readonly account: string
}

function userRoot(ctx: GuardContext): string {
  return userRootFor(ctx.deps.tenantRoot, ctx.account)
}

/** 用户根目录:<tenantRoot>/<account>;缺目录则建(登录开通与守卫共用)。 */
export function userRootFor(tenantRoot: string, account: string): string {
  const root = resolve(tenantRoot, account)
  mkdirSync(root, { recursive: true })
  return root
}

/**
 * 确保用户根工作区存在并记账:先查属主+路径记账,缺则直调控制器 create
 * (上游按 canonical path 幂等)再补记账。控制器未就绪返回 undefined。
 * 登录开通用;created=本次新建(区别于已记账复用),首开空会话以此为触发。
 */
export async function ensureTenantWorkspace(
  deps: Pick<TenantDeps, 'store' | 'reflect' | 'tenantRoot'>,
  userId: number,
  account: string,
): Promise<{ readonly workspaceId: string; readonly path: string; readonly created: boolean } | undefined> {
  const root = userRootFor(deps.tenantRoot, account)
  const recorded = deps.store.workspaceIdByOwnerPath(userId, root)
  if (recorded !== undefined) return { workspaceId: recorded, path: root, created: false }
  const wc = serviceOf(deps, 'workspaceController')
  if (wc === undefined) return undefined
  const value = await callService(wc, 'create', { path: root }) as
    { workspace?: { workspaceId?: string; path?: string } } | undefined
  const id = value?.workspace?.workspaceId
  if (typeof id !== 'string') return undefined
  deps.store.recordWorkspace(id, userId, value?.workspace?.path ?? root)
  return { workspaceId: id, path: value?.workspace?.path ?? root, created: true }
}

/**
 * 首开引导:新工作区建好后立刻建一个空会话——客户端引导(recentWorkspace)按
 * 「工作区内最近会话的 updatedAt」挑自动落座目标,没有会话的工作区会输给其他
 * 用户的活跃工作区;带上这个空会话,新用户首屏(除秒级竞态窗口)自动落座自己的
 * 工作区。空会话会被客户端复用(connectWorkspace 优先复用可复用空成员)。
 */
export async function ensureFirstSession(
  deps: Pick<TenantDeps, 'store' | 'reflect'>,
  userId: number,
  workspaceId: string,
): Promise<string | undefined> {
  const sc = serviceOf(deps, 'sessionController')
  if (sc === undefined) return undefined
  const value = await callService(sc, 'create', { workspaceId }) as
    { sessionId?: string; id?: string } | undefined
  const sessionId = typeof value?.sessionId === 'string' ? value.sessionId
    : typeof value?.id === 'string' ? value.id : undefined
  if (sessionId === undefined) return undefined
  deps.store.recordSession(sessionId, userId, workspaceId)
  return sessionId
}

// withinRoot 已抽至 ./within-root.ts(T1 G4 修复;T3 sandbox 钳制共用)。
// 见该文件:双侧 realpath 实解析 + 不存在路径向上取最近存在祖先实解析拼尾段。

/** 解包客户端信封:{type,rpcId,method,payload:{args:{...}}} → {rpcId, args}。 */
function unpack(body: unknown): { rpcId: string; args: Record<string, unknown> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as Record<string, unknown>
  if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') return undefined
  const payload = envelope.payload as Record<string, unknown> | undefined
  const args = payload?.args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { rpcId: envelope.rpcId, args: args as Record<string, unknown> }
}

function frame(rpcId: string, result: unknown): Response {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okFrame(rpcId: string, value: unknown): Response {
  return frame(rpcId, { ok: true, value })
}

// 失败帧必须带 details:record——客户端连接层(client/connection rpc.ts)按
// rpcErrorSchema 校验 {code,message,details},缺 details 会整包解析失败,
// 用户只能看到 "invalid server-response failure (gateway/internal)" 而非真实原因。
function deniedFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/denied', message, details: {} } })
}

function unauthenticatedFrame(rpcId: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/unauthenticated', message: '未登录', details: {} } })
}

function failureFrame(rpcId: string, error: unknown): Response {
  return frame(rpcId, {
    ok: false,
    error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error), details: {} },
  })
}

/** 归属解析:cookie → 会话(pwv 比对)→ 用户;失败返回 undefined(由守卫回 401 帧)。 */
function currentUser(ctx: { deps: TenantDeps }, request: Request): GuardContext | undefined {
  const claims = ctx.deps.session.resolveUser(request.headers.get('cookie') ?? undefined)
  if (claims === undefined) return undefined
  const pwv = ctx.deps.store.getPasswordVersion(claims.userId)
  if (pwv === undefined || pwv !== claims.passwordVersion) return undefined
  const user = ctx.deps.store.getUserById(claims.userId)
  if (user === undefined) return undefined
  return { deps: ctx.deps, userId: user.id, account: user.account }
}

/** 从守卫请求读 JSON 信封(守卫在 gateway 校验前,自行解包)。 */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function callService(service: ServiceHandle, method: string, ...params: unknown[]): Promise<unknown> {
  const fn = service[method]
  if (typeof fn !== 'function') return Promise.reject(new Error(`service method missing: ${method}`))
  return Promise.resolve((fn as (...a: unknown[]) => unknown).apply(service, params))
}

/** 写路径归属审计(kind 统一 access.tenant)。 */
function tenantAudit(deps: TenantDeps, action: string, account: string, detail: Record<string, unknown>): void {
  deps.audit({ kind: 'access.tenant', account, detail: { action, ...detail } })
}

/**
 * 注册全部租户守卫;返回组合 disposer。
 * slice-1 覆盖:workspace 写路径/picker 钳制/session 建与归属校验;
 * session/create 对他人 workspaceId 明确拒绝(文案含引导)——自动落座自己的
 * 工作区由登录开通保障(开通根工作区+首开空会话赢得 recentWorkspace 竞争);
 * 自动引导仍挑中他人工作区的极端竞态由门禁角标拒绝监听补可见提示。
 * follow(WS mux)不注册——见 R12。
 */
// signal 透传:session 控制器多个 Remote 方法(prompt/page/search/openWorkspacePath)
// 以 (request, signal) 签名消费 AbortSignal,prompt 首行即 signal.throwIfAborted();
// 直调漏传会让每次调用抛 TypeError,再被 failureFrame 包成协议外信封(发送会话即挂)。
type GuardHandler = (
  rpcId: string, args: Record<string, unknown>, ctx: GuardContext, signal: AbortSignal,
) => Promise<Response>

export function registerTenantGuards(deps: TenantDeps, connection: { fetch: TenantFetchRegistry }): () => void {
  const disposers: Array<() => void> = []
  const register = (path: string, handler: GuardHandler): void => {
    const dispose = connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        deps.ensureMux?.()
        const body = await readJson(request)
        const unpacked = unpack(body)
        if (unpacked === undefined) return new Response('invalid client-request message', { status: 400 })
        const ctx = currentUser({ deps }, request)
        if (ctx === undefined) return unauthenticatedFrame(unpacked.rpcId)
        try {
          return await handler(unpacked.rpcId, unpacked.args, ctx, request.signal)
        } catch (error) {
          return failureFrame(unpacked.rpcId, error)
        }
      },
    })
    disposers.push(() => { void dispose() })
  }

  // ── workspace/create:路径钳制到用户根 + 归属记账 ──
  register('/api/workspace/create', async (rpcId, args, ctx) => {
    const request = args.request as { path?: string } | undefined
    const path = typeof request?.path === 'string' ? request.path : ''
    const root = userRoot(ctx)
    if (path === '' || !withinRoot(path, root)) {
      return deniedFrame(rpcId, `工作区路径必须在你的目录 ${root} 之内`)
    }
    const wc = serviceOf(deps, 'workspaceController')
    if (wc === undefined) return failureFrame(rpcId, new Error('workspaceController not ready'))
    const value = await callService(wc, 'create', request) as { workspace?: { workspaceId?: string; path?: string } } | undefined
    const id = value?.workspace?.workspaceId
    if (typeof id === 'string') deps.store.recordWorkspace(id, ctx.userId, value?.workspace?.path ?? path)
    tenantAudit(deps, 'workspace.create', ctx.account, { path })
    return okFrame(rpcId, value)
  })

  // ── workspace/initializeDefault:每用户默认工作区=其根目录(上游 create 幂等:
  //    已登记路径返回 created:false,无需自建合成值) ──
  register('/api/workspace/initializeDefault', async (rpcId, _args, ctx) => {
    const wc = serviceOf(deps, 'workspaceController')
    if (wc === undefined) return failureFrame(rpcId, new Error('workspaceController not ready'))
    const root = userRoot(ctx)
    const value = await callService(wc, 'create', { path: root }) as { workspace?: { workspaceId?: string; path?: string } } | undefined
    const id = value?.workspace?.workspaceId
    if (typeof id === 'string') deps.store.recordWorkspace(id, ctx.userId, value?.workspace?.path ?? root)
    return okFrame(rpcId, value)
  })

  // ── workspace 写路径(归属校验后直调) ──
  const workspaceOwned = [
    'delete', 'rename', 'insertBefore', 'insertSessionBefore',
    'pinSession', 'unpinSession', 'archiveSession', 'unarchiveSession',
  ] as const
  for (const name of workspaceOwned) {
    register(`/api/workspace/${name}`, async (rpcId, args, ctx) => {
      const request = args.request as { workspaceId?: string; sessionId?: string } | undefined
      const workspaceId = typeof request?.workspaceId === 'string' ? request.workspaceId : ''
      if (workspaceId === '' || deps.store.workspaceOwner(workspaceId) !== ctx.userId) {
        return deniedFrame(rpcId, '工作区不存在或不属于你')
      }
      const wc = serviceOf(deps, 'workspaceController')
      if (wc === undefined) return failureFrame(rpcId, new Error('workspaceController not ready'))
      const value = await callService(wc, name, request)
      if (name === 'delete') deps.store.forgetWorkspace(workspaceId)
      if (name === 'insertSessionBefore' && typeof request?.sessionId === 'string') {
        deps.store.recordSession(request.sessionId, ctx.userId, workspaceId)
      }
      tenantAudit(deps, `workspace.${name}`, ctx.account, { workspaceId })
      return okFrame(rpcId, value)
    })
  }

  // ── directoryPicker:路径钳制到用户根 ──
  register('/api/directoryPicker/list', async (rpcId, args, ctx) => {
    const dpc = serviceOf(deps, 'directoryPickerController')
    if (dpc === undefined) return failureFrame(rpcId, new Error('directoryPickerController not ready'))
    const root = userRoot(ctx)
    const raw = args.path
    const path = typeof raw === 'string' && raw !== '' ? resolve(raw) : root
    if (!withinRoot(path, root)) return deniedFrame(rpcId, `只能浏览你的目录 ${root}`)
    const value = await callService(dpc, 'list', path)
    return okFrame(rpcId, value)
  })
  register('/api/directoryPicker/createDirectory', async (rpcId, args, ctx) => {
    const dpc = serviceOf(deps, 'directoryPickerController')
    if (dpc === undefined) return failureFrame(rpcId, new Error('directoryPickerController not ready'))
    const root = userRoot(ctx)
    const path = typeof args.path === 'string' ? resolve(args.path) : ''
    if (path === '' || typeof args.name !== 'string' || args.name === '' || !withinRoot(path, root)) {
      return deniedFrame(rpcId, `只能在你的目录 ${root} 内创建`)
    }
    const value = await callService(dpc, 'createDirectory', path, args.name)
    tenantAudit(deps, 'picker.createDirectory', ctx.account, { path: join(path, args.name) })
    return okFrame(rpcId, value)
  })

  // ── session/create:归属校验(明确报错+引导)+ 会话记账 ──
  // 他人 workspaceId 明确拒绝,文案即引导(客户端手动路径的 toast 会透出 message;
  // 自动引导路径的静默失败由门禁角标监听拒绝帧补提示,见 pages.ts BADGE_SCRIPT)。
  // 自动落座由登录开通保障:开通过的工作区 + 首开空会话让 recentWorkspace 首屏
  // 选中用户自己的工作区(拒绝仅发生在点他人工作区/极端竞态,属预期反馈)。
  register('/api/session/create', async (rpcId, args, ctx) => {
    const request = args.request as { workspaceId?: string; cwd?: string; sessionId?: string } | undefined
    const root = userRoot(ctx)
    const workspaceId = typeof request?.workspaceId === 'string' ? request.workspaceId : undefined
    const cwd = typeof request?.cwd === 'string' ? resolve(request.cwd) : undefined
    if (workspaceId !== undefined && deps.store.workspaceOwner(workspaceId) !== ctx.userId) {
      return deniedFrame(rpcId, '该工作区不属于你：请在左侧点击你自己的工作区（家目录）新建会话')
    }
    if (workspaceId === undefined && cwd !== undefined && !withinRoot(cwd, root)) {
      return deniedFrame(rpcId, `会话目录必须在你的目录 ${root} 之内`)
    }
    // G5 修复(2026-11-11):不带 workspaceId 且不带 cwd 的缺省分支——上游落宿主 defaultCwd
    // (session-controller lib/index.js:673 附近),多用户下即落共享宿主目录;钳制为强制 cwd=用户根。
    const defaultCwdPatched = workspaceId === undefined && cwd === undefined
    const payload0 = request === undefined ? request : { ...request, ...(defaultCwdPatched ? { cwd: root } : {}) }
    // 复用会话 id 只认自己的(客户端选择残留他人 id 时剥掉,按全新会话建)
    const reuseId = typeof request?.sessionId === 'string' && deps.store.sessionOwner(request.sessionId) === ctx.userId
      ? request.sessionId
      : undefined
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const payload = payload0 === undefined ? payload0 : { ...payload0, sessionId: reuseId }
    const value = await callService(sc, 'create', payload) as { sessionId?: string; id?: string } | undefined
    const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : typeof value?.id === 'string' ? value.id : undefined
    if (sessionId !== undefined) deps.store.recordSession(sessionId, ctx.userId, workspaceId ?? null)
    tenantAudit(deps, 'session.create', ctx.account, { workspaceId: workspaceId ?? null, cwd: cwd ?? (defaultCwdPatched ? root : null) })
    return okFrame(rpcId, value)
  })

  // ── session 其余端点(载荷带 sessionId/workspaceId 时校验归属;否则放行直调;
  //    流类端点(follow/observeState 流形态)走 WS mux 由 T2 policy 过滤,unary 形态在此列) ──
  // T1 补全(2026-11-11,G1/G2):state/projections/selectModel/updateQueue/wait 为 unary 且
  // 载荷带 sessionId——通用归属校验即覆盖。
  const sessionValidated = [
    'rename', 'cancel', 'fork', 'page', 'search', 'observeState',
    'observeProjections', 'prompt', 'control', 'attachment',
    'openWorkspacePath', 'canOpenWorkspacePath', 'initializeDefaultModel', 'modelCatalog',
    'state', 'projections', 'selectModel', 'updateQueue', 'wait',
  ]
  for (const name of sessionValidated) {
    register(`/api/session/${name}`, async (rpcId, args, ctx, signal) => {
      const request0 = args.request as Record<string, unknown> | undefined
      const sessionId = firstString(request0, 'sessionId') ?? firstString(args, 'sessionId')
      const workspaceId = firstString(request0, 'workspaceId') ?? firstString(args, 'workspaceId')
      const cwd = firstString(request0, 'cwd') ?? firstString(args, 'cwd')
      const root = userRoot(ctx)
      if (sessionId !== undefined && deps.store.sessionOwner(sessionId) !== ctx.userId) {
        return deniedFrame(rpcId, '会话不存在或不属于你')
      }
      if (workspaceId !== undefined && deps.store.workspaceOwner(workspaceId) !== ctx.userId) {
        return deniedFrame(rpcId, '工作区不存在或不属于你')
      }
      if (sessionId === undefined && workspaceId === undefined && cwd !== undefined && !withinRoot(cwd, root)) {
        return deniedFrame(rpcId, `路径必须在你的目录 ${root} 之内`)
      }
      const sc = serviceOf(deps, 'sessionController')
      if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
      const value = await callService(sc, name, request0 ?? args, signal)
      return okFrame(rpcId, value)
    })
  }

  // ── T1 补全(G1):session/events——读任意会话完整历史,之前完全不在守卫清单 ──
  // 请求形态 SessionPageRequest:{address:{kind:'session',sessionId}} 或
  // {address:{kind:'subagent',parentSessionId,childSessionId}}(子代理历史按父归属判定)。
  register('/api/session/events', async (rpcId, args, ctx, signal) => {
    interface EventsRequest { address?: { kind?: string; sessionId?: string; parentSessionId?: string; childSessionId?: string } }
    const request0 = args.request as EventsRequest | undefined
    const address = request0?.address
    const primaryId = address?.kind === 'subagent' ? address.parentSessionId : address?.sessionId
    if (typeof primaryId !== 'string' || primaryId === '' || deps.store.sessionOwner(primaryId) !== ctx.userId) {
      tenantAudit(deps, 'session.events.denied', ctx.account, { addressKind: address?.kind ?? null })
      return deniedFrame(rpcId, '会话不存在或不属于你')
    }
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const value = await callService(sc, 'events', request0 ?? args, signal)
    return okFrame(rpcId, value)
  })

  // ── T1 补全(G2):session/list——结果集按归属过滤(非全拒;清单语义) ──
  // 上游 SessionListValue={items:[{sessionId,parentSessionId?,origin?,cwd?,…}]}。
  // 过滤规则:sessionId 属于本人,或 parentSessionId 属于本人(subagent 子会话随父可见);
  // 未归属且无父的条目剔除(存量已由启动迁移划归 admin)。
  register('/api/session/list', async (rpcId, args, ctx, signal) => {
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const value = await callService(sc, 'list', args.request, signal) as { items?: Array<Record<string, unknown>> } | undefined
    const items = Array.isArray(value?.items) ? value.items : []
    const filtered = items.filter((item) => {
      const id = typeof item.sessionId === 'string' ? item.sessionId : undefined
      const parentId = typeof item.parentSessionId === 'string' ? item.parentSessionId : undefined
      if (id !== undefined && deps.store.sessionOwner(id) === ctx.userId) return true
      if (parentId !== undefined && deps.store.sessionOwner(parentId) === ctx.userId) return true
      return false
    })
    return okFrame(rpcId, { ...(value ?? {}), items: filtered })
  })

  // ── T1 补全(G2):session/workspacePathApplications——载荷按 path 寻址,钳制用户根 ──
  register('/api/session/workspacePathApplications', async (rpcId, args, ctx, signal) => {
    const request0 = args.request as { path?: string } | undefined
    const path = typeof request0?.path === 'string' ? request0.path : firstString(args, 'path')
    if (path !== undefined && !withinRoot(path, userRoot(ctx))) {
      return deniedFrame(rpcId, `路径必须在你的目录 ${userRoot(ctx)} 之内`)
    }
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const value = await callService(sc, 'workspacePathApplications', request0 ?? args, signal)
    return okFrame(rpcId, value)
  })

  // ── P4-T6(2026-11-11):双层插件个人层端点(复用守卫 register=cookie 认证+审计) ──
  registerUserPluginRoutes(deps, register)

  // ── P2-T1.7a(2026-11-11,D1 拍板):网关配置角色门——admin 可写,普通用户只读 ──
  // llm-pi-ai 承载行的设置命名空间=settingsNs=行 id('llm-pi-ai');供应商 key 与
  // baseURL 是组织资产,普通用户可写=可把全组织模型流量劫到任意端点。
  // 读(describe/openSettingsDocument)全员可用(D1:普通用户只读视图;响应含 redacted
  // views,apiKeyEnv 槽永不回传值——上游 settings describe 实证)。
  // 写(mutate/update/replace)仅 admin;其余命名空间(用户个人设置)不受影响。
  // 【双层拦截】HTTP unary 通道 peer 恒 owner(T2 换血只作用 mux)——实例 wrap 对
  // HTTP 免疫,故第一层=守卫 fetch 路由(cookie 判角色,fetchRoutes 精确匹配优先于
  // gateway interceptor,同 session/list 生效通路);第二层=实例 wrap(invocation
  // principal 判角色,覆盖 mux/进程内调用面)。两层同语义,漏一层即红(key-leak E2E)。
  const GATEWAY_SETTINGS_NS = 'llm-pi-ai'
  const settingsWritePaths = ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']
  const settingsMethodOf = (path: string): string => path.split('/').pop() ?? ''
  for (const path of settingsWritePaths) {
    register(path, async (rpcId, args, ctx) => {
      const request0 = args.request as { ns?: string; ops?: unknown } | undefined
      const ns = firstString(request0, 'ns') ?? firstString(args, 'ns')
      const method = settingsMethodOf(path)
      const sc = serviceOf(deps, 'settingsController')
      if (sc === undefined) return failureFrame(rpcId, new Error('settingsController not ready'))
      // wire 参数在 args 顶层 {ns, ops, expectedRevision}——直调展开为位置参数
      // (settingsController.mutate(ns, ops, expectedRevision),typert.host 签名)
      const callArgs: unknown[] = request0 !== undefined
        ? [request0.ns, request0.ops, undefined]
        : [args.ns, args.ops, undefined]
      if (ns !== GATEWAY_SETTINGS_NS) {
        // 非网关命名空间(用户个人设置)原样代理,不做角色判断
        const value = await callService(sc, method, ...callArgs)
        return okFrame(rpcId, value)
      }
      const user = deps.store.getUserById(ctx.userId)
      if (user?.role !== 'admin') {
        tenantAudit(deps, 'gateway.settings.denied', ctx.account, { ns, method })
        return deniedFrame(rpcId, '模型网关配置仅管理员可修改（普通用户只读）')
      }
      const value = await callService(sc, method, ...callArgs)
      return okFrame(rpcId, value)
    })
  }
  const settingsController = serviceOf(deps, 'settingsController') as Record<string, unknown> | undefined
  if (settingsController !== undefined) {
    const invocationOf = (): { principal?: { kind?: string; userId?: number } } => {
      const raw = (settingsController as { ctx?: { invocation?: { principal?: { kind?: string; userId?: number } } } }).ctx
      return raw?.invocation ?? {}
    }
    for (const method of ['mutate', 'update', 'replace'] as const) {
      const original = settingsController[method]
      if (typeof original !== 'function') continue
      const bound = (original as (...args: unknown[]) => unknown).bind(settingsController)
      settingsController[method] = (...callArgs: unknown[]): unknown => {
        const ns0 = (callArgs[0] as { ns?: string } | undefined)?.ns
        if (ns0 !== GATEWAY_SETTINGS_NS) return bound(...callArgs)
        // 角色门只管 eterna-user principal(mux 换血用户);owner/本地流放行
        const principal = invocationOf().principal
        if (principal?.kind !== 'eterna-user' || typeof principal.userId !== 'number') return bound(...callArgs)
        const user = deps.store.getUserById(principal.userId)
        if (user?.role !== 'admin') {
          tenantAudit(deps, 'gateway.settings.denied', user?.account ?? String(principal.userId), { ns: ns0, method })
          const error = new Error('模型网关配置仅管理员可修改（普通用户只读）') as Error & { code?: string }
          error.code = 'tenant/denied'
          throw error
        }
        return bound(...callArgs)
      }
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 守卫卸载失败不阻断其余逆闭包
      }
    }
  }
}

function firstString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}
