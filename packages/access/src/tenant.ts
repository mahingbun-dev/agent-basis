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
import { join, resolve, sep } from 'node:path'
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
}

type ServiceHandle = Record<string, (...args: never[]) => unknown>

/** 反射取宿主控制器(audit-bridge 模式:strict=false 机会语义,缺席返回 undefined)。 */
function serviceOf(deps: TenantDeps, key: string): ServiceHandle | undefined {
  return deps.reflect.get(key, false) as ServiceHandle | undefined
}

interface GuardContext {
  readonly deps: TenantDeps
  readonly userId: number
  readonly account: string
}

function userRoot(ctx: GuardContext): string {
  const root = resolve(ctx.deps.tenantRoot, ctx.account)
  mkdirSync(root, { recursive: true })
  return root
}

function withinRoot(path: string, root: string): boolean {
  const p = resolve(path)
  return p === root || p.startsWith(root + sep)
}

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

function deniedFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/denied', message } })
}

function unauthenticatedFrame(rpcId: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/unauthenticated', message: '未登录' } })
}

function failureFrame(rpcId: string, error: unknown): Response {
  return frame(rpcId, {
    ok: false,
    error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error) },
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
 * slice-1 覆盖:workspace 写路径/picker 钳制/session 建与归属校验。
 * follow(WS mux)不注册——见 R12。
 */
type GuardHandler = (rpcId: string, args: Record<string, unknown>, ctx: GuardContext) => Promise<Response>

export function registerTenantGuards(deps: TenantDeps, connection: { fetch: TenantFetchRegistry }): () => void {
  const disposers: Array<() => void> = []
  const register = (path: string, handler: GuardHandler): void => {
    const dispose = connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson(request)
        const unpacked = unpack(body)
        if (unpacked === undefined) return new Response('invalid client-request message', { status: 400 })
        const ctx = currentUser({ deps }, request)
        if (ctx === undefined) return unauthenticatedFrame(unpacked.rpcId)
        try {
          return await handler(unpacked.rpcId, unpacked.args, ctx)
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

  // ── session/create:workspaceId 归属或 cwd 钳制 + 会话记账 ──
  register('/api/session/create', async (rpcId, args, ctx) => {
    const request = args.request as { workspaceId?: string; cwd?: string; sessionId?: string } | undefined
    const root = userRoot(ctx)
    const workspaceId = typeof request?.workspaceId === 'string' ? request.workspaceId : undefined
    const cwd = typeof request?.cwd === 'string' ? resolve(request.cwd) : undefined
    if (workspaceId !== undefined) {
      if (deps.store.workspaceOwner(workspaceId) !== ctx.userId) return deniedFrame(rpcId, '工作区不存在或不属于你')
    } else if (cwd !== undefined) {
      if (!withinRoot(cwd, root)) return deniedFrame(rpcId, `会话目录必须在你的目录 ${root} 之内`)
    }
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const value = await callService(sc, 'create', request) as { sessionId?: string; id?: string } | undefined
    const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : typeof value?.id === 'string' ? value.id : undefined
    if (sessionId !== undefined) deps.store.recordSession(sessionId, ctx.userId, workspaceId ?? null)
    tenantAudit(deps, 'session.create', ctx.account, { workspaceId: workspaceId ?? null, cwd: cwd ?? null })
    return okFrame(rpcId, value)
  })

  // ── session 其余端点(载荷带 sessionId/workspaceId 时校验归属;否则放行直调;
  //    流类端点(events/follow)走 WS mux 不在此列) ──
  const sessionValidated = [
    'rename', 'cancel', 'fork', 'page', 'search', 'observeState',
    'observeProjections', 'prompt', 'control', 'attachment',
    'openWorkspacePath', 'canOpenWorkspacePath', 'initializeDefaultModel', 'modelCatalog',
  ]
  for (const name of sessionValidated) {
    register(`/api/session/${name}`, async (rpcId, args, ctx) => {
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
      const value = await callService(sc, name, request0 ?? args)
      return okFrame(rpcId, value)
    })
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
