/**
 * T2 mux 流租户隔离(2026-11-11,统一方案 §6/P1-T2):principal 换血 + registerPolicy。
 *
 * 架构(源码考证见隔离计划 §7 T2/T0.2,全部 file:line 实核):
 * - 浏览器请求共享 owner Peer(client-connection lib/index.js:714),而 WS mux 通道
 *   (/api/remote.mux)完全绕过 eterna 守卫 → 会话/工作区列表元数据全局可见(R12)。
 * - 修法:对 mux 升级请求按 eterna_session 换血——wrap `admit`,mux 路径且 cookie 合法时
 *   返回 per-user Peer(principal={kind:'eterna-user',userId});其余路径(含全部 unary HTTP)
 *   维持 owner Peer + 守卫路由双保险(unary fetch 路由上游硬性要求 owner,
 *   client-connection lib/index.js:830)。
 * - 策略经 ctx.remoteAccess.registerPolicy('eterna-user', …):bindings 按归属账本
 *   (store.sessionOwner/workspaceOwner)返回资源绑定;此后流 open 越权抛 remote-access/denied、
 *   workspace/follow 列表按 allows() 逐项过滤(workspace-controller lib/index.js:965)全部
 *   由上游 decide 链自动生效。
 *
 * 绑定动作清单 = 上游全部 mode:'stream' 方法盘点(2026-11-11 typert.remote-client 全量扫描;
 *   2026-11-12 补 UI 门缺项——session/control 升 GLOBAL、会话级 unary 补 prompt/cancel/upload):
 *   GLOBAL: workspace/follow · terminal/attach · terminal/retain · workspaceFiles/changes ·
 *           account/watch · account/watchExpiry · job/list · job/follow · session/control
 *           (宿主级共享面,owner 等价——terminal 与 workspaceFiles 无 per-user 资源注册,
 *           维持现状语义,T4/T6 收紧;control 见 GLOBAL_STREAM_ACTIONS 处注释)
 *   session 资源: session/follow · session/observeState · session/observeProjections ·
 *           session/observeEvent · session/control
 *   workspace 资源: workspace/follow(逐项可见性过滤用)
 * 防漂移:tests/mux-drift.spec.ts 断言本清单与上游 typert 流方法表差集=∅。
 */
import type { SessionService } from './session.ts'
import type { UserStore } from './store.ts'

/** 换血后的 principal 形态(Typert PrincipalMap 合并声明;类型面,无运行时注册)。 */
export interface EternaUserPrincipal {
  readonly kind: 'eterna-user'
  readonly userId: number
}

/** mux 通道路径(=上游 REMOTE_STREAM_MUX_PATH,dsh-api-gateway lib/index.js:534)。 */
export const MUX_PATH = '/api/remote.mux'

/** 宿主级共享面的流动作(策略 GLOBAL 绑定;新上游流方法在此缺失时 mux-drift 测试红)。
 *  remoteAccess/follow 为上游 FOLLOW_ACTION(decide 链恒 allow),不需绑定。
 *  session/control 亦在此列(2026-11-12 修复「发送按钮/控制流双失」):上游 control
 *  快照流是无载荷宿主级流(session-controller client/transport.ts:121 open 不带
 *  sessionId),网关资源解析为空时按 global 资源判定(api-gateway access.ts:35-37)
 *  ——只授在会话绑定上时 open 恒 no-allow。租户安全:上游对流基线/增量逐会话
 *  allows() 过滤(session-controller index.ts:636/641,action 取当前调用面
 *  session/control,会话绑定已含),他人会话的投影不落本用户流。 */
export const GLOBAL_STREAM_ACTIONS: readonly string[] = [
  'workspace/follow',
  'terminal/attach',
  'terminal/retain',
  'workspaceFiles/changes',
  'account/watch',
  'account/watchExpiry',
  'job/list',
  'job/follow',
  'session/control',
]

/** 宿主级一元(非流)读面动作:浏览器 peer 换血为 eterna-user 后,客户端 whenAccess
 *  门控的授权快照按本策略判定——缺项即对应 UI 永不注册(2026-11-11 E2E:
 *  settings/describe 缺席=设置弹窗入口消失;pluginManager/listBundles 缺席=
 *  插件发现页不渲染)。实际一元 HTTP 走 owner peer 不受影响,此处只开 UI 门。
 *  session/create(2026-11-11 第二轮):上游三处新建会话入口(工作区行「+」/
 *  侧栏头/侧栏根)全部 useRemoteAccess('session/create') 门控,缺席=按钮不渲染。
 *  实际创建由守卫 fetch 路由校验工作区归属+钳制 cwd,此处只开按钮门。
 *  schedule/list(2026-11-12 同批清扫):会话日程目录入口门(ui-schedule
 *  ScheduleCatalogAction.tsx:41 useAccess('schedule/list'),缺席=入口不渲染)。
 *  防漂移:mux-drift 断言本清单与流方法表交集=∅(一元/流互斥,防重复放宽)。 */
export const GLOBAL_UNARY_ACTIONS: readonly string[] = [
  'settings/describe',
  'pluginManager/listBundles',
  'session/create',
  'schedule/list',
]

/** 会话资源级一元动作(只授在用户自己的会话绑定上——上游右键菜单项
 *  session/rename/session/fork 逐项 remoteAccess.source 判定,缺席=菜单空;
 *  置顶/归档菜单项以 session 资源判 workspace 动作(Rows.tsx/context-menus.tsx
 *  remoteAccess.source('session', id, 'workspace/archiveSession')),故
 *  workspace 系会话动作也在此列)。实际调用走守卫 fetch 路由归属校验,双保险。
 *  session/prompt·session/cancel·fileUploads/upload(2026-11-12 修复「发送按钮
 *  消失」):InputBar.tsx:63-65 以 useAccess(...) === false 判定,缺席=发送/停止
 *  按钮与文件上传门整体不渲染(T2 换血后线上三按钮实证)。三动作均为上游
 *  unary(mux-drift 互斥断言保持绿),快照门在此,数据面仍由守卫路由把关。 */
export const SESSION_UNARY_ACTIONS: readonly string[] = [
  'session/rename',
  'session/fork',
  'workspace/pinSession',
  'workspace/unpinSession',
  'workspace/archiveSession',
  'workspace/unarchiveSession',
  'session/prompt',
  'session/cancel',
  'fileUploads/upload',
  // schedule/list 双授(global+session):入口挂会话头部槽位(ui-schedule
  // index.ts:271 conversation.session.header.utilities),上游资源级答案严格查
  // 该资源自身绑定(PR#57 实证),global 绑定不兜底——按两处 useAccess 的
  // 资源口径各自命中。
  'schedule/list',
]

/** 工作区资源级一元动作(只授在用户自己的工作区绑定上——上游右键菜单
 *  重命名/删除与会话置顶/归档逐项 remoteAccess.source 判定,缺席=菜单空)。
 *  session/create(2026-11-12 第三轮):dsh 0.2.2-rc.1 的工作区行「+」不是全局门,
 *  是 useWorkspaceAccess(workspaceId,'session/create') 资源级门(ui-workspace
 *  Rows.tsx:273),而客户端 answer() 对资源答案严格查该资源自身绑定
 *  (remote-access client/state.ts),global 绑定永不兜底——缺项=工作区行加号
 *  不渲染(mux 隔离上线前 owner peer 恒真所以从未暴露)。未分组行/侧栏头/
 *  侧栏根三处仍走全局门,不受影响。实际创建仍由守卫 fetch 路由校验工作区
 *  归属+钳制 cwd,双保险不变。
 *  实际调用走守卫 fetch 路由 workspaceOwned 归属校验,双保险。
 *  workspace/insertBefore(2026-11-12 同批清扫):侧栏行拖拽排序门
 *  (ui-workspace Rows.tsx:275 useWorkspaceAccess(id,'workspace/insertBefore'),
 *  缺席=拖拽把手不渲染;守卫路由同名单租户校验)。 */
export const WORKSPACE_UNARY_ACTIONS: readonly string[] = [
  'workspace/rename',
  'workspace/delete',
  'session/create',
  'workspace/pinSession',
  'workspace/unpinSession',
  'workspace/archiveSession',
  'workspace/unarchiveSession',
  'workspace/insertBefore',
]

/** 会话级流动作(策略 session 绑定)。 */
export const SESSION_STREAM_ACTIONS: readonly string[] = [
  'session/follow',
  'session/observeState',
  'session/observeProjections',
  'session/observeEvent',
  'session/control',
]

/** 工作区级流动作(策略 workspace 绑定;供 follow 逐项可见性过滤)。 */
export const WORKSPACE_STREAM_ACTIONS: readonly string[] = [
  'workspace/follow',
]

/** 上游 remote-access 绑定的结构同构(避免引 @deepseek-ai 类型面,行号注记升级门禁复核)。 */
export interface TenantBinding {
  readonly resource: { readonly kind: 'global' } | { readonly kind: 'session'; readonly id: string } | { readonly kind: 'workspace'; readonly id: string }
  readonly role: { readonly name: string; readonly resource: 'global' | 'session' | 'workspace'; readonly actions: readonly string[] }
}

/** 策略所需的最小依赖面。 */
export interface MuxPolicyDeps {
  readonly store: Pick<UserStore, 'sessionsOfOwner' | 'workspacesOfOwner'>
  readonly session: SessionService
}

interface ServiceHandle {
  admit?: (request: unknown) => unknown
  createPeer?: (options: { principal: unknown }) => { id: string; principal: unknown; dispose: () => unknown }
  registerPolicy?: (kind: string, policy: unknown) => unknown
}

/** 解析 mux 升级请求的 eterna 登录态(合法 → userId;否则 undefined 走原 admit)。
 *  双形态兼容:Fetch Request(headers.get)与 node 升级请求(headers.cookie 平面属性)。 */
function eternaUserOf(deps: MuxPolicyDeps, request: unknown): number | undefined {
  const headers = (request as { headers?: unknown }).headers
  let cookie: string | undefined
  if (headers !== null && typeof headers === 'object' && typeof (headers as { get?: unknown }).get === 'function') {
    cookie = (headers as { get: (name: string) => string | null }).get('cookie') ?? undefined
  } else if (headers !== null && typeof headers === 'object') {
    const value = (headers as Record<string, unknown>).cookie
    if (typeof value === 'string') cookie = value
  }
  if (cookie === undefined) return undefined
  const claims = deps.session.resolveUser(cookie)
  if (claims === undefined) return undefined
  return claims.userId
}

/** 一个用户的资源绑定(账本为唯一事实源;子代理子会话经 parentSessionId 由上游随父判定)。 */
export function bindingsFor(deps: MuxPolicyDeps, userId: number): readonly TenantBinding[] {
  const globalRole = { name: 'eterna:member-global', resource: 'global' as const, actions: [...GLOBAL_STREAM_ACTIONS, ...GLOBAL_UNARY_ACTIONS] }
  // 会话资源还须授予 workspace/follow:上游 workspace-controller 的 follow 流对
  // workspace.sessionIds 逐项 allows({kind:'session',id}) 判定,action 取当前
  // 调用面(=workspace/follow)——会话绑定不含此动作时,连用户自己的会话也会被从
  // workspace 视图的 sessionIds 里过滤掉(侧栏落「未分组」),blank 会话的
  // sessionWorkspace/chipTitle 断链 = 新用户首屏死锁根因(2026-11-11 E2E)。
  const sessionRole = { name: 'eterna:session-member', resource: 'session' as const, actions: [...SESSION_STREAM_ACTIONS, ...WORKSPACE_STREAM_ACTIONS, ...SESSION_UNARY_ACTIONS] }
  const workspaceRole = { name: 'eterna:workspace-member', resource: 'workspace' as const, actions: [...WORKSPACE_STREAM_ACTIONS, ...WORKSPACE_UNARY_ACTIONS] }
  const bindings: TenantBinding[] = [{ resource: { kind: 'global' }, role: globalRole }]
  for (const sessionId of deps.store.sessionsOfOwner(userId)) {
    bindings.push({ resource: { kind: 'session', id: sessionId }, role: sessionRole })
  }
  for (const workspaceId of deps.store.workspacesOfOwner(userId)) {
    bindings.push({ resource: { kind: 'workspace', id: workspaceId }, role: workspaceRole })
  }
  return bindings
}

export interface MuxIsolationInstall {
  /** 卸载:还原 admit/解除 per-user Peer/撤销策略。 */
  readonly dispose: () => void
  /** 防漂移观测:换血 hook 是否已挂(测试与 gate 断言面)。 */
  readonly wrapped: boolean
}

/**
 * 安装 mux 换血 + 租户策略。connection 为 client-connection 服务实例
 * (reflect.get('client-connection', false)),remoteAccess 为 api-remote-access 服务实例。
 * 返回 disposer;服务缺席返回 undefined(装载冒烟告警)。
 */
export function installMuxIsolation(
  deps: MuxPolicyDeps,
  connection: ServiceHandle | undefined,
  remoteAccess: ServiceHandle | undefined,
): MuxIsolationInstall | undefined {
  if (connection === undefined || remoteAccess === undefined) return undefined
  const admitFn = connection.admit
  const createPeerFn = connection.createPeer
  const registerPolicyFn = remoteAccess.registerPolicy
  if (typeof admitFn !== 'function' || typeof createPeerFn !== 'function') return undefined
  if (typeof registerPolicyFn !== 'function') return undefined

  // 1. 策略(每用户绑定动态读账本;归属变更由调用方 invalidate)
  const disposePolicy = registerPolicyFn.call(remoteAccess, 'eterna-user', {
    bindings: (principal: EternaUserPrincipal) => bindingsFor(deps, principal.userId),
  })

  // 2. 换血:仅 mux 升级路径;per-user Peer 缓存(≤20 人,常驻不逐连接 dispose)
  const peers = new Map<number, { id: string; principal: unknown; dispose: () => unknown }>()
  const originalAdmit = admitFn.bind(connection)
  const wrapped = (request: unknown): unknown => {
    const url = (request as { url?: unknown }).url
    const isMux = typeof url === 'string' && url.includes(MUX_PATH)
    if (!isMux) return originalAdmit(request)
    const userId = eternaUserOf(deps, request)
    if (userId === undefined) return originalAdmit(request)
    let peer = peers.get(userId)
    if (peer === undefined) {
      peer = createPeerFn.call(connection, { principal: { kind: 'eterna-user', userId } })
      peers.set(userId, peer)
    }
    return { peer }
  }
  ;(connection as { admit: unknown }).admit = wrapped

  return {
    wrapped: true,
    dispose: () => {
      ;(connection as { admit: unknown }).admit = admitFn
      for (const peer of peers.values()) { try { void peer.dispose() } catch { /* 常驻 Peer 尽力而为 */ } }
      peers.clear()
      const disposePolicyFn = disposePolicy as (() => void) | undefined
      disposePolicyFn?.()
    },
  }
}
