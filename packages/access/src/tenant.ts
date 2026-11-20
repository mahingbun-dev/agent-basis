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
import { enrichModelCatalog, visionIndexFromConfigEditor } from './model-catalog.ts'
import type { CatalogValueShape } from './model-catalog.ts'
import { decayBias } from './thinking-score.ts'
// ── 知识库管理端点:调用者身份与服务面结构子集(仅类型;运行期零依赖)──
import type { KnowledgeAdminCaller, KnowledgeAdminFaceLike } from './knowledge-admin-face.ts'
import { registerUserPluginRoutes } from './user-plugins.ts'
import type { UserPluginLoader } from './user-plugins.ts'
import { ApprovalFlow, ensureApprovalSchema } from './approvals.ts'
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
  /** T6 装载器(2026-11-18):个人/共享插件进程内 mount;缺席=纯记账降级。 */
  readonly pluginLoader?: UserPluginLoader
}

/**
 * 工作台 SSE 流端点(38 号 O-5 开放问题的登记落位;33 号 G2-C4「新端点进本守卫
 * 清单」;本守卫清单登记的第一个插件数据端点):
 * - 铁律 T2 路由面独占:workbench/tasks 均不得自注册(tenant-scan
 *   tenant/route-escapes-gate CI 强制);24a 裁决 dwfq-843ec077-1 口径——
 *   **数据面经 tasks 提供、路由经 access 登记**;
 * - 数据面 = tasks 引擎 DomainEvents(eterna-workbench live hub 投影,服务反射键
 *   'eternaWorkbenchStream';src/stream.ts 桥装载,登记点 = plugin.ts 的
 *   webServer.register 精确路径);
 * - 守卫 = 登录会话(cookie→pwv→用户,与本清单同一身份面;未登录 401,hub 未就绪
 *   503 fail-closed);传输 = text/event-stream(GET,Last-Event-ID 续传,200ms
 *   合批,30 号 §3;插件启停面未收录——流随 eterna-workbench 装载,不在
 *   routes.ts TOGGLEABLE_PLUGINS)。
 */
export const WORKBENCH_STREAM_ENDPOINT = '/workbench/api/stream'

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
) => Response | Promise<Response>

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
  // 两族载荷不同(2026-11-12 修复「归档会话必被拒」):workspace 系上游 wire 带
  // workspaceId(archive/pin 系只带 sessionId,无 workspaceId——workspace-controller
  // index.ts WorkspaceArchiveSessionRequest),统一取 workspaceId 会把空串判成非本人,
  // 会话悬停归档/置顶按钮与右键菜单项点击后全部「工作区不存在或不属于你」。
  // 故按族分检:workspace 系校验 workspaceId 归属;session 系校验 sessionId 归属
  // (账本 sessionOwner,与 mux 策略同一事实源)。
  const workspaceOwned = ['delete', 'rename', 'insertBefore', 'insertSessionBefore'] as const
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

  // session 系 workspace 动作(UI 归档/置顶;上游 wire 载荷只带 sessionId)。
  const sessionOwned = ['pinSession', 'unpinSession', 'archiveSession', 'unarchiveSession'] as const
  for (const name of sessionOwned) {
    register(`/api/workspace/${name}`, async (rpcId, args, ctx) => {
      const request = args.request as { sessionId?: string } | undefined
      const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
      if (sessionId === '' || deps.store.sessionOwner(sessionId) !== ctx.userId) {
        return deniedFrame(rpcId, '会话不存在或不属于你')
      }
      const wc = serviceOf(deps, 'workspaceController')
      if (wc === undefined) return failureFrame(rpcId, new Error('workspaceController not ready'))
      const value = await callService(wc, name, request)
      tenantAudit(deps, `workspace.${name}`, ctx.account, { sessionId })
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
    'openWorkspacePath', 'canOpenWorkspacePath', 'initializeDefaultModel',
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

  // ── session/modelCatalog 专路(2026-11-13,模型能力 tag):catalog 请求不带
  //    sessionId/workspaceId/cwd,通用循环守卫本就全放行——专路只为在响应上富化
  //    「视觉」badge(能力真值=llm-pi-ai 配置行 input/defaultInput,见 model-catalog.ts)。
  //    configEditor 经 reflect 机会语义读取,缺席/未就绪→空索引=逐字段纯透传;
  //    富化只补缺,provider 自带 badge(官方 listing 来源)与 failures 原样不动。
  //    同一 RPC 亦供上游 ui-model-selection(触发器/上游菜单)——一处富化双端亮。 ──
  register('/api/session/modelCatalog', async (rpcId, args, _ctx, signal) => {
    const sc = serviceOf(deps, 'sessionController')
    if (sc === undefined) return failureFrame(rpcId, new Error('sessionController not ready'))
    const value = await callService(sc, 'modelCatalog', args.request ?? args, signal) as CatalogValueShape | undefined
    let visionIndex: Map<string, Set<string>> = new Map()
    const configEditor = serviceOf(deps, 'configEditor') as { configuration?: () => unknown } | undefined
    try {
      const configuration = configEditor?.configuration?.()
      if (configuration !== undefined) visionIndex = visionIndexFromConfigEditor(configuration)
    } catch { /* 配置面未就绪:空索引=纯透传,不炸目录读 */ }
    return okFrame(rpcId, enrichModelCatalog(value ?? {}, visionIndex))
  })

  // ── session/thinkingAuto 专路(2026-11-18,思考强度自动模式开关)──
  // 读 {request:{sessionId}} → {enabled};写 {request:{sessionId, enabled}} → {enabled}。
  // 纯 access 记账(users.db sessions.thinking_auto,不打扰上游 sessionController):
  // 宿主侧 thinking-auto 路由器按此开关在消息入箱时自动调 agent.model.select 选档。
  // 默认开启(列默认 1,用户拍板);归属守卫同通用循环——会话必须存在且属于当前用户。
  register('/api/session/thinkingAuto', (rpcId, args, ctx) => {
    const request0 = args.request as Record<string, unknown> | undefined
    const sessionId = firstString(request0, 'sessionId') ?? firstString(args, 'sessionId')
    if (sessionId === undefined || deps.store.sessionOwner(sessionId) !== ctx.userId) {
      tenantAudit(deps, 'thinking.auto.denied', ctx.account, { reason: 'owner' })
      return deniedFrame(rpcId, '会话不存在或不属于你')
    }
    // enabled 键存在即必须可解释为布尔:近似拼写、''、0、'false' 一律拒绝,不得静默
    // 落成读支(调用方会误以为写入成功);键缺席才是读。
    const enabledKey = keyKindOf(request0, 'enabled') ?? keyKindOf(args, 'enabled')
    if (enabledKey === 'near') {
      tenantAudit(deps, 'thinking.auto.denied', ctx.account, { sessionId, reason: 'enabled' })
      return deniedFrame(rpcId, 'enabled 无效')
    }
    const enabledArg = firstBoolean(request0, 'enabled') ?? firstBoolean(args, 'enabled')
    if (enabledKey === 'exact' && enabledArg === undefined) {
      tenantAudit(deps, 'thinking.auto.denied', ctx.account, { sessionId, reason: 'enabled' })
      return deniedFrame(rpcId, 'enabled 无效')
    }
    if (enabledArg === undefined) {
      return okFrame(rpcId, { enabled: deps.store.thinkingAutoOf(sessionId) })
    }
    if (!deps.store.setThinkingAuto(sessionId, enabledArg)) {
      tenantAudit(deps, 'thinking.auto.denied', ctx.account, { sessionId, reason: 'owner' })
      return deniedFrame(rpcId, '会话不存在或不属于你')
    }
    tenantAudit(deps, 'thinking.auto.set', ctx.account, { sessionId, enabled: enabledArg })
    return okFrame(rpcId, { enabled: enabledArg })
  })

  // ── session/thinkingFeedback 专路(V2,2026-11-18):显式纠正「想多了/想少了」──
  // 读 {request:{sessionId}} → {bias, effectiveBias}(bias=落库原值,effectiveBias=按 24h
  //   半衰减值;两者读侧不等,无偏置/已清零 ⇒ {0,0})。
  // 写 {request:{sessionId, messageId?, direction:'less'|'more'}} → 叠加 ±0.2 后同形。
  // 清 {request:{sessionId, messageId?, direction:'reset'}} → 清零后 {0,0}。
  // 语义:会话级偏置、同向累计/反向抵消、钳位 ±0.5;归属守卫同 thinkingAuto(会话必须
  // 存在且属于当前用户,守卫在方向分流之前);messageId 仅作审计锚点(须为 ≤128 字符的
  // 字符串;存在性不做校验——access 无消息访问面,越权由会话归属挡住)。
  // 审计:写/清各一条 thinking.feedback;所有拒绝(归属/方向/锚点)记 .denied + reason。
  // 读支不记(菜单每次打开都读,避免审计流被读刷屏)。
  register('/api/session/thinkingFeedback', (rpcId, args, ctx) => {
    const request0 = args.request as Record<string, unknown> | undefined
    const sessionId = firstString(request0, 'sessionId') ?? firstString(args, 'sessionId')
    if (sessionId === undefined || deps.store.sessionOwner(sessionId) !== ctx.userId) {
      tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { reason: 'owner' })
      return deniedFrame(rpcId, '会话不存在或不属于你')
    }
    const now = Date.now()
    // 分流按**原始键存在性**并识别近似拼写:firstString 把 ''/非字符串一律折成
    // undefined,按返回值判会把 direction:''/数字/拼错键静默解释成读请求。
    const directionKey = keyKindOf(request0, 'direction') ?? keyKindOf(args, 'direction')
    if (directionKey === 'near') {
      tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { sessionId, reason: 'direction' })
      return deniedFrame(rpcId, 'direction 无效')
    }
    if (directionKey === undefined) {
      const raw = deps.store.thinkingBiasOf(sessionId)
      if (raw === undefined) return okFrame(rpcId, { bias: 0, effectiveBias: 0 })
      return okFrame(rpcId, { bias: raw.bias, effectiveBias: decayBias(raw.bias, raw.updatedAt, now) })
    }
    const direction = firstString(request0, 'direction') ?? firstString(args, 'direction')
    if (direction !== 'less' && direction !== 'more' && direction !== 'reset') {
      tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { sessionId, reason: 'direction' })
      return deniedFrame(rpcId, 'direction 无效')
    }
    // messageId 仅作审计锚点:限长防放大审计日志;非字符串同样拒绝(不静默丢成 '')。
    const messageKey = keyKindOf(request0, 'messageId') ?? keyKindOf(args, 'messageId')
    const messageRaw = firstString(request0, 'messageId') ?? firstString(args, 'messageId')
    if (messageKey !== undefined
      && (messageRaw === undefined || messageRaw.length > MESSAGE_ID_MAX)) {
      tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { sessionId, reason: 'messageId' })
      return deniedFrame(rpcId, 'messageId 无效')
    }
    const messageId = messageRaw ?? ''
    if (direction === 'reset') {
      // 写前只读一次留痕:清零后 thinkingBiasOf 即 undefined。审计同时保留**原始落库值**
      // 与衰减后有效值——只记衰减值会在死区里显示 0,事后无法复盘清零前的真实偏置。
      const previous = deps.store.thinkingBiasOf(sessionId)
      const previousEffective = previous === undefined
        ? 0
        : decayBias(previous.bias, previous.updatedAt, now)
      if (!deps.store.resetThinkingBias(sessionId, now)) {
        tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { sessionId, reason: 'owner' })
        return deniedFrame(rpcId, '会话不存在或不属于你')
      }
      tenantAudit(deps, 'thinking.feedback', ctx.account, {
        sessionId,
        messageId,
        direction,
        bias: 0,
        effectiveBias: 0,
        previousBias: previous === undefined ? 0 : previous.bias,
        previousUpdatedAt: previous === undefined ? 0 : previous.updatedAt,
        previousBiasEffective: previousEffective,
      })
      return okFrame(rpcId, { bias: 0, effectiveBias: 0 })
    }
    const written = deps.store.addThinkingBias(sessionId, direction === 'less' ? -0.2 : 0.2, now)
    if (written === undefined) {
      tenantAudit(deps, 'thinking.feedback.denied', ctx.account, { sessionId, reason: 'owner' })
      return deniedFrame(rpcId, '会话不存在或不属于你')
    }
    // 落库时已把存量衰减到 now ⇒ effectiveBias=落库值(读侧再衰减,衰减函数同源)
    tenantAudit(deps, 'thinking.feedback', ctx.account, {
      sessionId, messageId, direction, bias: written.bias, effectiveBias: written.bias,
    })
    return okFrame(rpcId, { bias: written.bias, effectiveBias: written.bias })
  })

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

  // ── P4-T6/T7(2026-11-11):双层插件个人层端点+审批流(复用守卫 register=cookie 认证+审计) ──
  // T6(2026-11-18):装载器随 deps 注入——启停/移除/转内置即刻生效,零重启。
  ensureApprovalSchema(deps.store)
  const approvalFlow = new ApprovalFlow(deps)
  registerUserPluginRoutes(deps, register, {
    flow: approvalFlow,
    isAdmin: (userId: number) => deps.store.getUserById(userId)?.role === 'admin',
  }, deps.pluginLoader)

  // ── 记忆账号路由守卫(23 号 M-T2,S-6 修复,2026-11-16)─────────────────
  // unary SRC 通道的 invocation.principal 是 owner peer(不携带 userId,mux.ts
  // 头注:eterna-user principal 只存在于流通道)——panel 的记忆三端点因此拿不
  // 到登录账号,面板回落全局路径(已归档改名→空)。正解=身份面在守卫:本守卫
  // register 的 fetch 已做 cookie 认证(currentUser→userId/account),经 glue
  // provide 的 eterna-memory-accounts 账号路由面(账号级原语)完成路由与裁决。
  // 铁律对账:T2 路由面独占=access 是唯一合法的守卫注册方;数据仍由 glue 的
  // @eterna/memory 服务承载,本守卫零 SQL、零持久化逻辑。
  const accountsFaceOf = (): {
    accountOfUser(userId: number): string | undefined
    viewForAccount(account: string): unknown
    reviewForAccount(account: string, id: number, decision: 'approved' | 'rejected'): unknown
    recordCorrectionFor(account: string, section: string, keyHint: string): void
  } | undefined => serviceOf(deps, 'eterna-memory-accounts') as undefined

  register('/api/eternaMemory/accountSnapshot', (rpcId, _args, ctx) => {
    const face = accountsFaceOf()
    if (face === undefined) return failureFrame(rpcId, new Error('记忆路由面未挂载(eterna-memory 插件未启用)'))
    return okFrame(rpcId, face.viewForAccount(ctx.account))
  })

  register('/api/eternaMemory/review', (rpcId, args, ctx) => {
    const face = accountsFaceOf()
    if (face === undefined) return failureFrame(rpcId, new Error('记忆路由面未挂载(eterna-memory 插件未启用)'))
    const id = firstNumber(args, 'id')
    const decision = firstString(args, 'decision')
    if (id === undefined) return failureFrame(rpcId, new Error('id 必填(非负整数)'))
    if (decision !== 'approved' && decision !== 'rejected') {
      return failureFrame(rpcId, new Error("decision 只允许 'approved' | 'rejected'"))
    }
    return okFrame(rpcId, face.reviewForAccount(ctx.account, id, decision))
  })

  register('/api/eternaMemory/trackCorrection', (rpcId, args, ctx) => {
    const face = accountsFaceOf()
    if (face === undefined) return failureFrame(rpcId, new Error('记忆路由面未挂载(eterna-memory 插件未启用)'))
    const section = firstString(args, 'section')
    if (section === undefined || section.trim().length === 0 || section.trim().length > 64) {
      return failureFrame(rpcId, new Error('section 必填(非空,≤64 字符)'))
    }
    const keyHint = firstString(args, 'keyHint') ?? ''
    face.recordCorrectionFor(ctx.account, section.trim(), keyHint.slice(0, 128))
    return okFrame(rpcId, { ok: true })
  })

  // ── 面板快照守卫(2026-11-17):unary SRC 通道 principal 恒 owner(mux 换血只
  // 作用流通道,见 mux.ts 头注),登录身份只在守卫——快照按 cookie 身份组装
  // (admin=全局视野;普通账号=本人记忆/知识库/会话),同时堵住「登录后直调
  // /api/eternaPanel/snapshot 拿全局数据」的后端旁路。数据组装在 panel 包
  // (provide 'eterna-panel-accounts'),本守卫只做身份与归属解析(T2 语义)。
  register('/api/eternaPanel/snapshot', (rpcId, _args, ctx) => {
    const face = serviceOf(deps, 'eterna-panel-accounts') as unknown as {
      snapshotForUser?(identity: {
        readonly account: string
        readonly admin: boolean
        readonly ownedSessionIds: readonly string[]
      }): unknown
    } | undefined
    if (face?.snapshotForUser === undefined) {
      return failureFrame(rpcId, new Error('面板账号路由面未挂载(eterna-panel 插件未启用)'))
    }
    const user = deps.store.getUserById(ctx.userId)
    if (user === undefined) return failureFrame(rpcId, new Error('登录账号不可解析'))
    const admin = user.role === 'admin'
    return okFrame(rpcId, face.snapshotForUser({
      account: user.account,
      admin,
      ownedSessionIds: admin ? [] : deps.store.sessionsOfOwner(ctx.userId),
    }))
  })

  // 面板写端点直调硬化(review/reviewForAccount/trackCorrection 会写记忆库):
  // 客户端走 /api/eternaMemory/* 守卫端(账号路由),裸网关直调一律 admin-only
  // (宿主侧 adminAllowed 在 unary principal 恒 owner 下兜不住)。
  for (const [endpoint, method] of [
    ['review', 'review'],
    ['reviewForAccount', 'reviewForAccount'],
    ['trackCorrection', 'trackCorrection'],
  ] as const) {
    register(`/api/eternaPanel/${endpoint}`, async (rpcId, args, ctx) => {
      if (deps.store.getUserById(ctx.userId)?.role !== 'admin') {
        tenantAudit(deps, `panel.${endpoint}.denied`, ctx.account, {})
        return deniedFrame(rpcId, '需要管理员权限')
      }
      const gateway = serviceOf(deps, 'eternaPanel') as unknown as Record<string, (...fnArgs: unknown[]) => unknown> | undefined
      const fn = gateway?.[method]
      if (typeof fn !== 'function') return failureFrame(rpcId, new Error('面板网关未挂载(eterna-panel 插件未启用)'))
      return okFrame(rpcId, await fn.call(gateway, args.payload))
    })
  }

  // ── 知识库管理端点(@eterna/knowledge-admin,2026-11-18):17 方法守卫面 ──
  // 知识库管理是全员可用面(普通账号读写**本人**分库),不能整面 admin-only;守卫只做
  // ①cookie 身份(store.getUserById→{account,admin,userId})②显式跨账号兜底(非 admin 且
  // 目标账号≠本人 → denied+审计,零直调服务面;主防线仍是服务面 sanitizeTarget)
  // ③服务面机会语义读取(reflect.get(key,false),缺席=「未挂载」明说不静默降级)。
  // 调用约定:face[method].call(face, caller, args)——args 原样透传(unpack 已把
  // payload.args 解包,即客户端 rpc.call('/api','knowledgeAdmin/<m>',{args:DTO}) 的 DTO),
  // **绝不**传 owner/peer/principal 任何绕过字段(unary SRC 通道 principal 恒 owner,
  // 服务面不得自解身份——tenant.ts 头注不变式)。裸网关直调面 /api/eternaKnowledgeAdmin/*
  // 一律不注册;客户端只能走本守卫面。
  /** 知识库管理端点前缀(守卫路由;客户端只走这里,永不裸连网关)。 */
  const KNOWLEDGE_ADMIN_PREFIX = '/api/knowledgeAdmin'

  /**
   * 读类白名单(只读投影,不写库;仍经守卫身份,服务面自行按 caller 裁剪)。
   * 注:以 @eterna/knowledge-admin 契约表为准;方法名如变更须同步更新本白名单。
   */
  const KNOWLEDGE_ADMIN_READ_METHODS = [
    'listAccounts', 'overview', 'listDocs', 'readDoc', 'listProposals',
    'search', 'ask', 'listMembers', 'listAudit', 'testSource',
  ] as const

  /**
   * 写类白名单(逐条落 access 审计:成功 ok=true,失败带 error 摘要)。
   * 注:以 @eterna/knowledge-admin 契约表为准;方法名如变更须同步更新本白名单。
   */
  const KNOWLEDGE_ADMIN_WRITE_METHODS = [
    'saveDoc', 'deprecateDoc', 'undoDeprecate', 'reviewProposal', 'discardProposal',
    'importMarkdown', 'importRepo', 'setMember',
  ] as const

  const KNOWLEDGE_ADMIN_WRITE_SET: ReadonlySet<string> = new Set(KNOWLEDGE_ADMIN_WRITE_METHODS)

  /**
   * 请求体里的显式目标账号(跨账号兜底判据)。取 DTO 优先(body 形态兼容),再取 args 顶层;
   * 键只认 account/targetAccount/accountId——其余形态(以文档 id/成员键寻址)由服务面
   * sanitizeTarget 主防线裁决。
   */
  const knowledgeTargetAccountOf = (args: Record<string, unknown>): string | undefined => {
    const body0 = args.body
    const body = typeof body0 === 'object' && body0 !== null && !Array.isArray(body0)
      ? body0 as Record<string, unknown>
      : undefined
    for (const source of [body, args]) {
      if (source === undefined) continue
      const value = firstString(source, 'account')
        ?? firstString(source, 'targetAccount')
        ?? firstString(source, 'accountId')
      if (value !== undefined) return value
    }
    return undefined
  }

  const knowledgeErrorSummary = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error)
    return message.length > 256 ? `${message.slice(0, 256)}…` : message
  }

  for (const method of [...KNOWLEDGE_ADMIN_READ_METHODS, ...KNOWLEDGE_ADMIN_WRITE_METHODS] as const) {
    const isWrite = KNOWLEDGE_ADMIN_WRITE_SET.has(method)
    register(`${KNOWLEDGE_ADMIN_PREFIX}/${method}`, async (rpcId, args, ctx) => {
      // ① 身份:守卫已 cookie 认证(ctx.userId/account);admin 由 access store 判读
      //    (与 /api/eternaPanel/snapshot 同一读法,不另建身份解析)。
      const user = deps.store.getUserById(ctx.userId)
      if (user === undefined) return failureFrame(rpcId, new Error('登录账号不可解析'))
      const admin = user.role === 'admin'
      // ② 兜底裁决:非管理员显式指向他人账号 → 守卫层先拒(服务面 sanitizeTarget 是主防线)
      const target = knowledgeTargetAccountOf(args)
      if (!admin && target !== undefined && target !== user.account) {
        tenantAudit(deps, `knowledgeAdmin.${method}.denied`, user.account, { target })
        return deniedFrame(rpcId, '非管理员只能访问本人知识库账号')
      }
      // ③ 服务面:机会语义读取(reflect.get(key,false),同 serviceOf);
      //    缺席 = failureFrame 明说,不静默降级、不回退全局库(23 号 M 记忆路由同口径)。
      const face = deps.reflect.get('eterna-knowledge-admin', false) as KnowledgeAdminFaceLike | undefined
      const fn = face?.[method]
      if (face === undefined || typeof fn !== 'function') {
        return failureFrame(rpcId, new Error('知识库管理服务未挂载(eterna-knowledge-admin 未注册)'))
      }
      // ④ 调用者身份 {account, admin, userId, human}:human=true 只由本守卫铸出(浏览器真人);
      //    Agent 工具/网关恒 false —— 服务面据此把审批/直接发布限死在面板。
      const caller: KnowledgeAdminCaller = { account: user.account, admin, userId: user.id, human: true }
      try {
        const value = await Promise.resolve(fn.call(face, caller, args))
        if (isWrite) tenantAudit(deps, `knowledgeAdmin.${method}`, user.account, { ok: true, target: target ?? user.account })
        return okFrame(rpcId, value)
      } catch (error) {
        if (isWrite) {
          tenantAudit(deps, `knowledgeAdmin.${method}`, user.account, {
            ok: false, target: target ?? user.account, error: knowledgeErrorSummary(error),
          })
        }
        return failureFrame(rpcId, error)
      }
    })
  }

  // ── 提示词工坊/循环轨迹端点管理员门(2026-11-17):工坊=系统提示词全局管理面,
  // unary principal 恒 owner → 宿主侧 requireAdmin 在此通道兜不住;守卫层按
  // cookie 角色拒绝非 admin。admin 直调网关方法(语义与网关 SRC 派发一致:
  // 带参端点 wire args={input:…},无参端点 {};参数按方法名传给实例方法)。
  const LOOP_PROMPT_METHODS: Readonly<Record<string, string>> = {
    'snapshot': 'snapshot',
    'trace': 'trace',
    'prompt-get': 'promptGet',
    'prompt-save': 'promptSave',
    'prompt-versions': 'promptVersions',
    'prompt-rollback': 'promptRollback',
    'prompt-export': 'promptExport',
    'prompt-import': 'promptImport',
    'session-snapshot': 'sessionSnapshot',
    'ai-status': 'aiStatus',
    'ai-polish': 'aiPolish',
    'ai-review': 'aiReview',
    'ai-proposal': 'aiProposal',
  }
  for (const [endpoint, method] of Object.entries(LOOP_PROMPT_METHODS)) {
    register(`/api/loopPrompt/${endpoint}`, async (rpcId, args, ctx) => {
      if (deps.store.getUserById(ctx.userId)?.role !== 'admin') {
        tenantAudit(deps, 'prompt-studio.denied', ctx.account, { endpoint })
        return deniedFrame(rpcId, '提示词工坊仅管理员可用(需要管理员权限)')
      }
      const gateway = serviceOf(deps, 'loopPrompt') as unknown as Record<string, (...fnArgs: unknown[]) => unknown> | undefined
      const fn = gateway?.[method]
      if (typeof fn !== 'function') return failureFrame(rpcId, new Error('提示词工坊服务未挂载(eterna-prompt-studio 插件未启用)'))
      return okFrame(rpcId, await fn.call(gateway, args.input))
    })
  }

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
  // ── rc.5 B14 系统层第一道门(2026-11-20,50 §3.4.1/WP4-1)──────────────────
  // 命名空间集合从 {'llm-pi-ai'} 扩为 {'llm-pi-ai','mcp-manager'}:系统层 MCP 服务器
  // 机群的 servers 条目带 command/args/env/url,普通用户可写=在共享容器里拉起任意
  // 进程并读其他租户数据(H14)。mcp-manager 的写面与 llm-pi-ai 同门:仅 admin;
  // 普通用户走个人层(mcp-personal,按用户表),不碰全局表。
  // 真值=行 id(settingsNs),与 profile 的 `- id: mcp-manager` 行同名。
  const GATEWAY_SETTINGS_NS: ReadonlySet<string> = new Set(['llm-pi-ai', 'mcp-manager'])
  /** 角色拒绝文案(按命名空间给可执行的下一步;同含「仅管理员可修改」便于客户端识别)。 */
  const gatewaySettingsDeniedMessage = (ns: string): string => ns === 'mcp-manager'
    ? '系统 MCP 服务器配置仅管理员可修改（普通用户请使用个人 MCP 设置）'
    : '模型网关配置仅管理员可修改（普通用户只读）'
  // ── rc.5 B14 系统层第三道门(2026-11-20,50 §3.4.1):describe 面对非 admin 过滤
  // mcp-manager 命名空间。写门之外读面也要收:系统层 watch 流已被 mux 收窄
  // (ADMIN_ONLY_STREAM_ACTIONS),但 describe 会整表下发每个命名空间的 schema/
  // value/base/user——mcp-manager 的 servers(含 command/args/env/url)从这里照样
  // 可读。llm-pi-ai **不在**过滤集(D1:普通用户可读脱敏视图,apiKeyEnv 槽永不回传值)。
  const ADMIN_ONLY_SETTINGS_NS: ReadonlySet<string> = new Set(['mcp-manager'])
  /**
   * describe 响应过滤:非 admin 剥掉 ADMIN_ONLY_SETTINGS_NS 行,其余字段原样。
   * 入参/出参形状=上游 SettingsDescribeValue{writable,hasDocument,namespaces[]}
   * (dsh-api-settings-controller index.js:394-400)。形状漂移(上游改字段名)按
   * **fail-closed** 处理:非 admin 得到空 namespaces,不把未知结构原样透出——
   * 宁可见性回归/上报,不可静默泄露系统层配置。
   */
  const filterSettingsDescribe = (value: unknown, admin: boolean): unknown => {
    if (admin) return value
    if (typeof value !== 'object' || value === null) return value
    const record = value as Record<string, unknown>
    const namespaces = record.namespaces
    if (!Array.isArray(namespaces)) return { ...record, namespaces: [] }
    return {
      ...record,
      namespaces: namespaces.filter((row) => {
        const ns = typeof row === 'object' && row !== null ? (row as { ns?: unknown }).ns : undefined
        return typeof ns !== 'string' || !ADMIN_ONLY_SETTINGS_NS.has(ns)
      }),
    }
  }
  // describe 无参数(typert descriptor parameters:[]),HTTP fetch 路由直调实例;
  // 同写面:精确 path 注册优先于 gateway interceptor,响应仍是标准 server-response 帧。
  register('/api/settings/describe', async (rpcId, _args, ctx) => {
    const sc = serviceOf(deps, 'settingsController')
    if (sc === undefined) return failureFrame(rpcId, new Error('settingsController not ready'))
    const value = await callService(sc, 'describe')
    const user = deps.store.getUserById(ctx.userId)
    return okFrame(rpcId, filterSettingsDescribe(value, user?.role === 'admin'))
  })
  const settingsWritePaths = ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']
  const settingsMethodOf = (path: string): string => path.split('/').pop() ?? ''
  for (const path of settingsWritePaths) {
    register(path, async (rpcId, args, ctx) => {
      const method = settingsMethodOf(path)
      // wire 第二参数名随方法而异(typert descriptor:update=patch / replace=section /
      // mutate=ops)。曾对三路统一取 ops,把 update/replace 的载荷丢成 undefined——
      // settings.update(ns, undefined) 在 @deepseek/settings cloneJsonShaped 抛
      // 「Config $ contains a non-plain root」,设置面所有 update/replace 写全灭
      // (Agent 预设分区「设为默认」= settings.update 即用户所报)。
      const payloadKey = method === 'update' ? 'patch' : method === 'replace' ? 'section' : 'ops'
      const request0 = args.request as Record<string, unknown> | undefined
      const ns = firstString(request0, 'ns') ?? firstString(args, 'ns')
      const sc = serviceOf(deps, 'settingsController')
      if (sc === undefined) return failureFrame(rpcId, new Error('settingsController not ready'))
      // 直调展开为位置参数 settingsController.<method>(ns, payload, expectedRevision)
      // (typert.host 签名);expectedRevision 原样透传,保住写冲突栅栏(此前硬编码
      // undefined 等于无条件写,静默吞掉并发编辑检测)。
      const revisionOf = (source: Record<string, unknown>): number | undefined =>
        typeof source.expectedRevision === 'number' ? source.expectedRevision : undefined
      const callArgs: unknown[] = request0 !== undefined
        ? [request0.ns, request0[payloadKey], revisionOf(request0)]
        : [args.ns, args[payloadKey], revisionOf(args)]
      if (ns === undefined || !GATEWAY_SETTINGS_NS.has(ns)) {
        // 非系统层命名空间(用户个人设置)原样代理,不做角色判断
        const value = await callService(sc, method, ...callArgs)
        return okFrame(rpcId, value)
      }
      const user = deps.store.getUserById(ctx.userId)
      if (user?.role !== 'admin') {
        tenantAudit(deps, 'gateway.settings.denied', ctx.account, { ns, method })
        return deniedFrame(rpcId, gatewaySettingsDeniedMessage(ns))
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
    // 写面 ns 读取**两种形态**都认:
    // - 位置参数 settingsController.<method>(ns, payload, revision)(typert.host 直调;
    //   守卫 fetch 路由即此形态)——只读对象 .ns 会恒得 undefined,wrap 静默放行;
    // - 单对象 {request:{ns,…}} / {ns,…}(既有单测与部分内部调用形态)。
    const settingsNsOf = (callArgs: unknown[]): string | undefined => {
      const first = callArgs[0]
      if (typeof first === 'string') return first
      if (typeof first !== 'object' || first === null) return undefined
      const top = (first as { ns?: unknown }).ns
      if (typeof top === 'string') return top
      const request = (first as { request?: unknown }).request
      if (typeof request === 'object' && request !== null) {
        const nested = (request as { ns?: unknown }).ns
        if (typeof nested === 'string') return nested
      }
      return undefined
    }
    for (const method of ['mutate', 'update', 'replace'] as const) {
      const original = settingsController[method]
      if (typeof original !== 'function') continue
      const bound = (original as (...args: unknown[]) => unknown).bind(settingsController)
      settingsController[method] = (...callArgs: unknown[]): unknown => {
        const ns0 = settingsNsOf(callArgs)
        if (ns0 === undefined || !GATEWAY_SETTINGS_NS.has(ns0)) return bound(...callArgs)
        // 角色门只管 eterna-user principal(mux 换血用户);owner/本地流放行
        const principal = invocationOf().principal
        if (principal?.kind !== 'eterna-user' || typeof principal.userId !== 'number') return bound(...callArgs)
        const user = deps.store.getUserById(principal.userId)
        if (user?.role !== 'admin') {
          tenantAudit(deps, 'gateway.settings.denied', user?.account ?? String(principal.userId), { ns: ns0, method })
          const error = new Error(gatewaySettingsDeniedMessage(ns0)) as Error & { code?: string }
          error.code = 'tenant/denied'
          throw error
        }
        return bound(...callArgs)
      }
    }
    // 读面第三道门的实例侧(覆盖 mux/进程内 describe 调用面,与 HTTP 路由同语义):
    // eterna-user 非 admin 拿到过滤后的 namespaces;owner/本地流原样放行。
    const describeOriginal = settingsController.describe
    if (typeof describeOriginal === 'function') {
      const boundDescribe = (describeOriginal as (...args: unknown[]) => unknown).bind(settingsController)
      settingsController.describe = (...callArgs: unknown[]): unknown => {
        const value = boundDescribe(...callArgs)
        const principal = invocationOf().principal
        if (principal?.kind !== 'eterna-user' || typeof principal.userId !== 'number') return value
        const user = deps.store.getUserById(principal.userId)
        return filterSettingsDescribe(value, user?.role === 'admin')
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

/** 原始键存在性(含值为 undefined):分流判定专用——firstString 会折掉 ''/非字符串。 */
function hasKey(source: Record<string, unknown> | undefined, key: string): boolean {
  return source !== undefined && Object.prototype.hasOwnProperty.call(source, key)
}

/** 审计锚点 messageId 的字符上限(防伪造/超长值放大审计日志)。 */
const MESSAGE_ID_MAX = 128

/**
 * 键的三分判定:exact=精确键存在;near=存在前缀相近的拼错键(如 directon/enabeld);
 * undefined=完全没提及。分流前先跑本判定,拼错键不得静默落进读支。
 */
function keyKindOf(source: Record<string, unknown> | undefined, key: string): 'exact' | 'near' | undefined {
  if (source === undefined) return undefined
  if (hasKey(source, key)) return 'exact'
  const prefix = key.slice(0, 3).toLowerCase()
  for (const candidate of Object.keys(source)) {
    if (candidate === 'request') continue
    if (candidate.toLowerCase().startsWith(prefix)) return 'near'
  }
  return undefined
}

function firstNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function firstBoolean(source: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = source?.[key]
  return typeof value === 'boolean' ? value : undefined
}
