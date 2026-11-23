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
 * - TERM-004 终端一元门(2026-11-20 W5 门禁修复):`/api/terminal/*` 一元 RPC 同样换血
 *   per-user Peer——rc.5 网关对 owner principal 跳过 prepareInvocation 的 decide
 *   (dsh-api-gateway lib/index.js:1204),terminal 服务入口守卫因此拿不到身份,跨租户
 *   可读他人会话 cwd/shells。terminal 六方法的资源逐会话(agent lookup→session),故
 *   动作授在会话绑定(TERMINAL_UNARY_ACTIONS),他人会话由 decide 拒
 *   (remote-access/denied);策略面未就绪时 fail-closed 503,绝不退回 owner。
 * - T6.1 市场面收口(2026-11-19)→ T6.2 读放行/写 admin(2026-11-24):同一 admit 包装
 *   兼任市场路径门——插件市场 unary RPC 走 owner Peer、上游不认 eterna 角色,而装/卸/
 *   启停/索引源写入落**共享 profile**,影响全体用户。admit 是全部 `/api` 请求的请求级
 *   必经点(client-connection lib/index.js:1049 前缀路由 handler 首行),故在此 fail-closed
 *   收口:无 eterna 会话 401;admin 全量放行;非 admin 只放行读白名单
 *   (MARKET_MEMBER_METHODS + 两条 detail-file),写方法与宿主探测方法 403。
 * - 策略经 ctx.remoteAccess.registerPolicy('eterna-user', …):bindings 按归属账本
 *   (store.sessionOwner/workspaceOwner)返回资源绑定;此后流 open 越权抛 remote-access/denied、
 *   workspace/follow 列表按 allows() 逐项过滤(workspace-controller lib/index.js:965)全部
 *   由上游 decide 链自动生效。
 *
 * 绑定动作清单 = 上游全部 mode:'stream' 方法盘点(2026-11-11 typert.remote-client 全量扫描;
 *   2026-11-12 补 UI 门缺项——session/control 升 GLOBAL、会话级 unary 补 prompt/cancel/upload;
 *   2026-11-18 资源 kind 复核——动作按「网关解析出的资源 kind」归位,不再是按方法名一刀切 global):
 *   GLOBAL: workspace/follow · account/watch · account/watchExpiry · job/follow · session/control
 *           (open 时解析为 global 资源:无 lookup 参数、无 sessionId 参数、无对象参数带
 *           sessionId 字段;job/follow 的 sessionId 可选=双授,见 SESSION_STREAM_ACTIONS 注释)
 *   session 资源: session/follow · session/observeState · session/observeProjections ·
 *           session/observeEvent · session/control(双授) · terminal/attach · terminal/retain ·
 *           workspaceFiles/changes · job/list · job/follow(双授)
 *           ——2026-11-18「右侧文件面板 读取失败:remote access: workspaceFiles/changes:
 *           access denied (no-allow)」根因:上游自 0.2.2-rc.1 起这些流方法的资源解析即
 *           逐会话(dsh-api-gateway access.ts lookupResources:lookup 参数读 lookups.register
 *           的 resource kind;workspace-files lib/index.js:399 workspaceFileScope lookup
 *           resource:'session' · core/agent lib/index.js:452 agent lookup resource:'session';
 *           session-controller lib/index.js:3401 resolveSessionResource + :3801
 *           resources.register('session',{resolve}) 读 sessionId 参数/首对象参数的
 *           address.sessionId),decide 按 sameResource 严格匹配绑定(remote-access
 *           lib/index.js:338),global 绑定永不命中 → 恒 no-allow。T2 当年的
 *           「terminal 与 workspaceFiles 无 per-user 资源注册」盘点结论已过时。
 *           租户面同时收窄:旧 global 授予下任意登录用户可 attach/retain/watch 任意
 *           会话的终端与文件变更流(元数据越权),改会话绑定后仅本人会话可达。
 *   workspace 资源: workspace/follow(逐项可见性过滤用)
 *   session 事件: event:api-session/{status,added,removed,activity,error}(2026-11-13 补,
 *           逐会话资源判定零泄漏,停止按钮生命线 status 见 SESSION_EVENT_ACTIONS 处注释)
 *   global 事件: event:{llm/adapters-updated,llm/models-updated,settings/document-updated,
 *           credentials/reference-updated,credentials/record-updated}(2026-11-18 补,
 *           浏览器缓存失效信号,见 GLOBAL_EVENT_ACTIONS 处注释)
 * 防漂移:tests/mux-drift.spec.ts 断言本清单与上游 typert 流方法表差集=∅,且逐方法
 *   资源 kind(lookup/资源注册表推导)与归位清单一致——名称覆盖之外再锁 kind 归位。
 *   事件面两条互斥断言:会话事件必须带 resources={session}(逐租户过滤);
 *   全局事件必须不带 resources(不携带任何资源身份),且仅在 ACTION 清单内。
 */
import type { SessionService } from './session.ts'
import type { UserStore, UserRole } from './store.ts'

/** 换血后的 principal 形态(Typert PrincipalMap 合并声明;类型面,无运行时注册)。 */
export interface EternaUserPrincipal {
  readonly kind: 'eterna-user'
  readonly userId: number
}

/** mux 通道路径(=上游 REMOTE_STREAM_MUX_PATH,dsh-api-gateway lib/index.js:534)。 */
export const MUX_PATH = '/api/remote.mux'

/** 市场面路径前缀(请求级收口的**作用域**;读/写方法分类见
 *  MARKET_MEMBER_METHODS / MARKET_ADMIN_METHODS)。
 *
 *  T6.2(2026-11-24 用户裁定「任何角色都能进插件页、看到全部页签,只有『我的插件』
 *  可操作,其余只读」)把 T6.1 的整片 admin-only 改为**读放行 / 写 admin**:
 *  市场读方法对所有登录用户开放(页面能看到插件清单),写方法与宿主探测方法
 *  仍仅 admin。前端另加只读置灰(体验层),真正边界仍是本门。
 *
 *  为什么在市场 RPC 面做请求级门:市场写动作(安装/更新/卸载/启停/版本豁免/
 *  索引源写入)都落**共享 profile**(package.json + cordis.patch.yml + node_modules),
 *  影响全体用户;上游 unary 走 owner Peer(mux 策略只覆盖流通道),Web 面不认 eterna
 *  角色。admit 是 `/api` 全部请求的唯一必经点——前缀路由 handler 首行即
 *  `connection.admit(req)`,rejection 直接写 401/403(client-connection lib/index.js:1049),
 *  故收口于此,fail-closed。
 *
 *  路径形态(上游 0.2.2-rc.1 实核):
 *  - RPC 端点 = `/api/<method>`,方法名即路径段(endpointFromPath,lib/index.js:888):
 *    pluginManager/* 15 个方法与 pluginMarket/* 4 个方法由两份方法名清单分类覆盖;
 *  - detail-file fetch 路由 = `/api/plugin-manager/detail-file`(dsh-plugin-manager)与
 *    `/api/plugin-market/detail-file`(dsh-plugin-market lib/index.js:987)——二者经
 *    `/api` 前缀路由 admit 后才进 createSharedFetchHandler(lib/index.js:834),
 *    admit 拒绝即不触达;
 *  - 大小写敏感与上游端点匹配同口径(方法名 camelCase);`%2F` 等编码段过不了上游
 *    endpoint 校验(恒 404),无需本门额外解码。
 *
 *  豁免面:admin(role='admin')全量放行并走原 admit;非 admin 只放行读白名单
 *  (MARKET_MEMBER_METHODS + 两条 detail-file);安全操作(登录/守卫路由/我的插件
 *  /api/my-plugins/*)不在清单内,不受影响——个人插件面走 eterna 自己的守卫路由。 */
export const MARKET_SURFACE_PREFIXES: readonly string[] = [
  '/api/pluginManager/',
  '/api/pluginMarket/',
  '/api/plugin-manager/',
  '/api/plugin-market/',
]

/** 市场面路径前缀的**向后兼容别名**(T6.1 命名;语义已由 T6.2 更新为「市场面」)。 */
export const MARKET_ADMIN_PREFIXES: readonly string[] = MARKET_SURFACE_PREFIXES

/** 路径是否属市场面(前缀口径;query 串由调用方先剥离)。 */
export function isMarketPath(pathname: string): boolean {
  return MARKET_SURFACE_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

/** `/api/<ns>/<method>` → `<ns>/<method>`;空方法名或含额外路径段 → undefined。
 *
 *  纪律:只认两段且**命名空间必须是 RPC 命名空间**(pluginManager / pluginMarket);
 *  `/api/pluginManager/listBundles` ✓;`/api/pluginManager/a/b` 与
 *  `/api/plugin-manager/detail-file`(kebab 命名空间的 fetch 路由,由
 *  MARKET_MEMBER_FETCH_PATHS 精确匹配)在本函数下均不产生方法名——否则
 *  `/api/plugin-manager/anything` 会被误当成方法而绕过 fail-closed 语义。 */
export function marketMethodOf(pathname: string): string | undefined {
  const match = /^\/api\/(pluginManager|pluginMarket)\/([^/]+)$/u.exec(pathname)
  if (match === null) return undefined
  const namespace = match[1]
  const method = match[2]
  if (namespace === undefined || method === undefined) return undefined
  return `${namespace}/${method}`
}

/** 非 admin 可读的市场方法(T6.2 读白名单;**fail-closed**:不在本清单即拒)。
 *
 *  口径=「插件页渲染所需的最小读面」:
 *  - 已安装页:listBundles / listPlugins / listVersions / listVersionExemptions /
 *    readBundleDetail;
 *  - 发现页:listIndexes / search / readEntryDetail。
 *
 *  **不收** inspect / registries:二者接受路径 spec、可探测宿主文件系统,而只有
 *  安装对话框消费它们(非 admin 无法安装)——归写面。
 *
 *  防漂移:`tests/mux-drift.spec.ts` 读上游 typert 声明,断言
 *  「上游全部插件方法 ⊆ MARKET_MEMBER_METHODS ∪ MARKET_ADMIN_METHODS」,
 *  上游新增方法未分类即 CI 红(本清单是读侧白名单,未知方法默认拒)。 */
export const MARKET_MEMBER_METHODS: readonly string[] = [
  'pluginManager/listBundles',
  'pluginManager/listPlugins',
  'pluginManager/listVersions',
  'pluginManager/listVersionExemptions',
  'pluginManager/readBundleDetail',
  'pluginMarket/listIndexes',
  'pluginMarket/search',
  'pluginMarket/readEntryDetail',
]

/** 非 admin 可读的市场 detail-file 路由(只读图片)。
 *
 *  上游已钳(2026-11-24 实核):只允许「活详情文档自身文件源」的相对路径,
 *  `..`/绝对路径/反斜杠/NUL 全拒,仅图片扩展名,≤5 MiB——不构成任意文件读,
 *  故随读白名单放行(详情页缩略图对非 admin 可显示)。 */
export const MARKET_MEMBER_FETCH_PATHS: readonly string[] = [
  '/api/plugin-manager/detail-file',
  '/api/plugin-market/detail-file',
]

/** 市场写方法 + 宿主探测方法(仅 admin)。
 *
 *  - 写:installBundle / updateBundle / removeBundle / setBundleEnabled /
 *    setPluginEnabled / setVersionExemption / cancelInstall / waitForInstall
 *    (安装流程状态机)、pluginMarket/setIndexes(索引源写入,落 profile);
 *  - 探测:inspect / registries(接受路径 spec,可探宿主文件系统;仅安装对话框消费)。 */
export const MARKET_ADMIN_METHODS: readonly string[] = [
  'pluginManager/installBundle',
  'pluginManager/updateBundle',
  'pluginManager/removeBundle',
  'pluginManager/setBundleEnabled',
  'pluginManager/setPluginEnabled',
  'pluginManager/setVersionExemption',
  'pluginManager/cancelInstall',
  'pluginManager/waitForInstall',
  'pluginManager/inspect',
  'pluginManager/registries',
  'pluginMarket/setIndexes',
]

/** 非 admin 对该市场路径是否可读(读白名单 + 两条 detail-file;其余一律 false)。 */
export function marketMemberAllowed(pathname: string): boolean {
  if (MARKET_MEMBER_FETCH_PATHS.includes(pathname)) return true
  const method = marketMethodOf(pathname)
  return method !== undefined && MARKET_MEMBER_METHODS.includes(method)
}

/** 终端一元动作路径前缀(2026-11-20 W5 门禁修复 TERM-004;rc.5 实核)。 */
export const TERMINAL_UNARY_PATH_PREFIX = '/api/terminal/'

/** 路径是否属 terminal 一元 RPC(`POST /api/terminal/<method>`)。 */
export function isTerminalUnaryPath(pathname: string): boolean {
  return pathname.startsWith(TERMINAL_UNARY_PATH_PREFIX)
}

/** 文件面一元动作路径前缀(2026-11-20 W5 门禁修复 ACC-008/SEC-004)。
 *
 *  rc.5 workspaceFiles 五个一元方法的 scope 是 typert lookup `workspaceFileScope`
 *  (wire 名 workspaceFileScopeId,resource:'session'),网关对**非 owner** Peer
 *  会按会话资源 decide;但 `/api/workspaceFiles/<method>` 一元 HTTP 的 admit 恒
 *  owner Peer,decide 整段跳过 → 必须在本包装换血成 per-user Peer,资源判定才生效。 */
export const WORKSPACE_FILES_UNARY_PATH_PREFIX = '/api/workspaceFiles/'

/** 路径是否属 workspaceFiles 一元 RPC。 */
export function isWorkspaceFilesUnaryPath(pathname: string): boolean {
  return pathname.startsWith(WORKSPACE_FILES_UNARY_PATH_PREFIX)
}

/** 系统层 MCP 管理面一元路径前缀(2026-11-20 W5 门禁修复 MCPS-006/SEC-005)。
 *  probe/restart 只谈全局机群(可拉起任意 command),仅 admin;普通用户走个人层。 */
export const MCP_MANAGER_PATH_PREFIX = '/api/mcpManager/'

/** 路径是否属系统层 MCP 管理面一元 RPC。 */
export function isMcpManagerPath(pathname: string): boolean {
  return pathname.startsWith(MCP_MANAGER_PATH_PREFIX)
}

/** 文件面一元动作(5 个;changes 是会话级流,已在 SESSION_STREAM_ACTIONS)。
 *  资源=会话(workspaceFileScope lookup),故授**会话绑定**:本人会话放行、
 *  他人会话 deny;global 绑定永不命中会话资源(同 TERMINAL_UNARY_ACTIONS 纪律)。 */
export const WORKSPACE_FILE_UNARY_ACTIONS: readonly string[] = [
  'workspaceFiles/list',
  'workspaceFiles/stat',
  'workspaceFiles/read',
  'workspaceFiles/readBytes',
  'workspaceFiles/search',
]

/**
 * 终端一元动作(6 个;stream 三件套 attach/retain/watch 走 mux,不在此列)。
 *
 * 为什么必须授在**会话绑定**上而不是全局:rc.5 网关 prepareInvocation 对非 owner
 * Peer 先按 callResources 解析资源再 decide(dsh-api-gateway lib/index.js:1204-1215),
 * terminal 六方法的资源全部逐会话——首参 `agent` 是 lookup(typert.host.js 描述符
 * `source:'lookup', lookup:'agent'`;agent 注册 resource:'session',core/agent
 * lib/index.js:452),`list` 是具名 sessionId 参数(session-controller lib/index.js:3495
 * resolveSessionResource 按参数名直读)。remote-access evaluate 对资源做
 * sameResource 严格匹配(lib/index.js:338)——global 绑定永不命中 session 资源,
 * 只授 global 会让本人会话也恒 no-allow;授会话绑定则本人放行、他人会话 deny
 * (`remote-access/denied`)。
 *
 * 防漂移:tests/mux-drift.spec.ts 断言本清单与上游 terminal typert.host.js 的
 * 非流方法表一致。
 */
export const TERMINAL_UNARY_ACTIONS: readonly string[] = [
  'terminal/environment',
  'terminal/shells',
  'terminal/list',
  'terminal/create',
  'terminal/close',
  'terminal/rename',
]

/** 从 admit 请求的 url 面取 pathname。双形态兼容:node IncomingMessage 的 req.url
 *  为纯路径(`/api/...`),mux 升级/测试/部分载体可能带完整 URL——同 eternaUserOf
 *  的双形态纪律。解析失败按首段兜底(宁可少命中,不误伤其它路径)。 */
export function requestPathname(rawUrl: string): string {
  const trim = (value: string): string => value.split('?')[0] ?? ''
  if (rawUrl.startsWith('/')) return trim(rawUrl)
  try { return new URL(rawUrl).pathname } catch { return trim(rawUrl) }
}

/** open 时解析为 global 资源的流动作(策略 GLOBAL 绑定;新上游流方法归位错误时
 *  mux-drift 的资源 kind 断言红)。判定口径=网关 callResources(api-gateway
 *  lib/index.js:1207):无 lookup 参数、无 sessionId 参数、无对象参数带 sessionId
 *  字段,kind 注册面(resources.register)亦不命中 → 资源集空 → 按 GLOBAL 判定。
 *  remoteAccess/follow 为上游 FOLLOW_ACTION(decide 链恒 allow),不需绑定。
 *  session/control 双授亦在此列(2026-11-12 修复「发送按钮/控制流双失」):上游
 *  control 快照流是无载荷宿主级流(session-controller client/transport.ts:121 open
 *  不带 sessionId),网关资源解析为空时按 global 资源判定——只授在会话绑定上时
 *  open 恒 no-allow。租户安全:上游对流基线/增量逐会话 allows() 过滤
 *  (session-controller index.ts:636/641,action 取当前调用面 session/control,
 *  会话绑定已含),他人会话的投影不落本用户流。
 *  job/follow 双授亦在此列:JobFollowRequest.sessionId 可选(typert schema
 *  required 只含 jobId),省略时上游按「无主 job 任何调用者可观察」的自身语义
 *  放行——global 授予仅覆盖该无主面;带 sessionId 的有主读由会话绑定把关。 */
export const GLOBAL_STREAM_ACTIONS: readonly string[] = [
  'workspace/follow',
  'account/watch',
  'account/watchExpiry',
  'job/follow',
  'session/control',
  // rc.5 新增流面(2026-11-20 对账):远程面不再只住 dsh-api-*,扫描面=全部 dsh-*;
  // 资源 kind 由 mux-drift 按网关 callResources 口径推导并锁表。
  'productAnalytics/watchPolicy',
  'mcpManager/watch',
  'speech/follow',
  'forgePanel/changeRequestStates',
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
  // rc.5 会话导入入口门(2026-11-20 W5 门禁修复 UI-006):上游
  // ImportSessionsAction 先 `useRemoteAccess('deepseekChatImport/limits')`,
  // 答案非真直接返回 children(入口按钮不渲染);该动作无参数、无资源
  // (typert.host.js limits descriptor) = GLOBAL。缺项=「导入 DeepSeek 会话」
  // 入口整体消失,配额字段本身只读(maxUploadBytes)无泄露面。
  'deepseekChatImport/limits',
  // rc.5 B14 系统层 MCP 管理面(2026-11-20,50 §3.4.1):restart/probe 只谈全局机群
  // (rebuild 单个 server / 连接探测),授予 global 绑定;非 admin 不下发(见
  // ADMIN_ONLY_UNARY_ACTIONS)。写配置不走 RPC(settings 门收口),本组只开 UI 门。
  'mcpManager/restart',
  'mcpManager/probe',
]

/** 管理员专属一元门(角色 UI 门收窄面)。
 *
 *  T6.2(2026-11-24)从本清单**移除** `pluginManager/listBundles`:插件页
 *  (已安装 + 发现 + 恒灵插件 + 我的插件 + 全局蒸馏)对三档角色全部渲染,
 *  页面内写控件按角色置灰(体验层),服务端写方法仍 403(请求级门见
 *  MARKET_MEMBER_METHODS / MARKET_ADMIN_METHODS)。T6.1 时代本清单用它让非
 *  admin 整页不渲染——那使「我的插件」页签对非 admin 完全不可达(用户报告的
 *  原始问题),T6.2 起废除此用法。
 *
 *  分派纪律:只收窄不放宽——非 admin 动作集 = GLOBAL_UNARY_ACTIONS 减去本清单,
 *  内容绑定(流/会话/工作区)三角色仍逐项同构(WS-C 零放宽不变式)。本清单
 *  不得含任何流动作(流面按资源绑定判,只谈 UI 快照门)。
 *  防漂移:mux-policy 断言本清单 ⊆ GLOBAL_UNARY_ACTIONS、非 admin 不含清单项、
 *  且 listBundles **不在**本清单(三档角色都在位)。 */
export const ADMIN_ONLY_UNARY_ACTIONS: readonly string[] = [
  // rc.5 B14(2026-11-20):系统层 MCP restart/probe 仅 admin——rebuild 全局 server
  // (可拉起任意 command)与探测其连接面都是管理动作;普通用户只走个人层。
  'mcpManager/restart',
  'mcpManager/probe',
]

/** 管理员专属流门(2026-11-20,rc.5 B14):系统层 MCP 的 watch 面对非 admin 不下发
 *  ——普通用户只走个人层(mcp-personal),系统层连接状态/服务器清单仅管理员可见。
 *  纪律同 ADMIN_ONLY_UNARY_ACTIONS:本清单必须 ⊆ GLOBAL_STREAM_ACTIONS(只收窄);
 *  非 admin 全局绑定 = GLOBAL_STREAM_ACTIONS − 本清单。*/
export const ADMIN_ONLY_STREAM_ACTIONS: readonly string[] = [
  'mcpManager/watch',
]

/** 宿主级失效信号事件(策略 global 绑定;2026-11-18「设置页新增模型供应商保存后
 *  配置页看不到」根因修复)。
 *
 *  机制:网关对非 owner peer 的广播逐条 decide(action=`event:<名>`,资源=转发清单
 *  声明的 resources;api-gateway lib/index.js:625-633 + access.ts:98 无 readers
 *  即 GLOBAL)。mux 换血后浏览器 peer 恒 kind='eterna-user' ≠ owner(answers=false,
 *  index.js:584),故这五个事件在旧清单下恒 deny——保存落在宿主与磁盘、页面却
 *  永远读自己镜像里的旧 describe(mirror.ensure 只从 idle 读,settings-mirror.ts:125;
 *  模型页 load() 正是 ensure+getSnapshot),模型选择服务也订阅同样五个事件
 *  (ui-model-selection client/service.ts:54-58)。
 *
 *  安全面:五事件均为纯失效信号,上游声明无 resources(remote-events.ts 无
 *  resources 字段=GLOBAL 资源),载荷仅 adapters-updated() / models-updated(provider) /
 *  document-updated(ns,revision) / reference-updated(ref) / record-updated(key)——
 *  不含模型内容、会话/工作区身份或密钥值;其指向的目录面本就全员可读
 *  (settings/describe 全量命名空间、session/modelCatalog、credentials/describe 脱敏徽标)。
 *  三角色绑定保持同构(WS-C 不变式),不做角色分叉。
 *  防漂移:mux-drift 断言每个成员都在上游 emit 转发清单内**且不带 resources**
 *  (带 resources 的会话事件只许走 SESSION_EVENT_ACTIONS)。 */
export const GLOBAL_EVENT_ACTIONS: readonly string[] = [
  'event:llm/adapters-updated',
  'event:llm/models-updated',
  'event:settings/document-updated',
  'event:credentials/reference-updated',
  'event:credentials/record-updated',
]

/** 会话级广播事件动作(策略 session 绑定;2026-11-13 补「回合中无停止按钮」)。
 *  gateway broadcastRemoteEvent 对非 owner peer 按 action=`event:<名>` decide
 *  (api-gateway index.ts:626-635);api-session 五事件在转发清单逐会话声明资源
 *  (api-remotes remote-events.ts:30-34 resources={session:(id)=>id},经 gateway
 *  access.ts eventResources 解析)——decide 即逐会话租户判定:本人会话放行,
 *  他人会话在 decide 丢弃,**零跨租户元数据暴露**(与 R12 修复同构)。五事件=
 *  owner 体验全量:status=停止按钮生命线(客户端 running 旗标唯此一路:事件→
 *  sessions/manager.ts handleSessionStatus→InputBar interruptible:372/535,
 *  缺席=回合中按钮恒「发送消息」无从停止);added/removed=侧栏实时增删;
 *  activity=侧栏时序;error=会话错误浮出。客户端 $on 订阅见 session-controller
 *  client/index.ts:116-124。防漂移:mux-drift 断言均在上游转发清单(逐会话
 *  resources)+emit 声明表内,且全局绑定不得含任何**会话** event:* 动作(卫生锚;
 *  全局失效信号白名单见 GLOBAL_EVENT_ACTIONS)。 */
export const SESSION_EVENT_ACTIONS: readonly string[] = [
  'event:api-session/status',
  'event:api-session/added',
  'event:api-session/removed',
  'event:api-session/activity',
  'event:api-session/error',
]

/** 会话资源级一元动作(只授在用户自己的会话绑定上——上游右键菜单项
 *  session/rename/session/fork 逐项 remoteAccess.source 判定,缺席=菜单空;
 *  置顶/归档菜单项以 session 资源判 workspace 动作(Rows.tsx/context-menus.tsx
 *  remoteAccess.source('session', id, 'workspace/archiveSession')),故
 *  workspace 系会话动作也在此列)。实际调用走守卫 fetch 路由归属校验,双保险。
 *  session/prompt·session/cancel·fileUploads/upload(2026-11-12 修复「发送按钮
 *  消失」):InputBar.tsx:63-65 以 useAccess(...) === false 判定,缺席=发送/停止
 *  按钮与文件上传门整体不渲染(T2 换血后线上三按钮实证;fileUploads/upload
 *  同时是附件入口门——缺席=「+」菜单"文件"命令/粘贴/拖拽全拒,附件功能
 *  整体不可见,fix/attachment-entry 实证)。四动作均为上游 unary(mux-drift
 *  互斥断言保持绿),快照门在此,数据面仍由守卫路由把关。 */
export const SESSION_UNARY_ACTIONS: readonly string[] = [
  'session/rename',
  'session/fork',
  'fileUploads/upload',
  'workspace/pinSession',
  'workspace/unpinSession',
  'workspace/archiveSession',
  'workspace/unarchiveSession',
  'session/prompt',
  'session/cancel',
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

/** 会话级流动作(策略 session 绑定)。2026-11-18 资源 kind 复核后本清单收编四个
 *  原 GLOBAL 成员——上游资源解析逐会话,global 绑定永不命中(decide sameResource
 *  严格匹配,证据链见文件头注):
 *  - terminal/attach:参数 agent 为 lookup(agent 注册 resource:'session',
 *    core/agent lib/index.js:452),scope.context 亦 agent;
 *  - terminal/retain:参数名 sessionId,session 解析器按参数名直读
 *    (session-controller lib/index.js:3405);
 *  - workspaceFiles/changes:参数 workspaceFileScope 为 lookup(resource:'session',
 *    workspace-files lib/index.js:399-402)——「右侧文件面板读取失败」直接当事动作;
 *  - job/list:JobListRequest.sessionId required(schema required:['sessionId']),
 *    解析器读首对象参数 sessionId → 恒会话资源;
 *  - job/follow 双授:sessionId 可选(省略=无主 job,上游语义任何调用者可观察),
 *    会话绑定覆盖有主读那半。 */
export const SESSION_STREAM_ACTIONS: readonly string[] = [
  'session/follow',
  'session/observeState',
  'session/observeProjections',
  'session/observeEvent',
  'session/control',
  'terminal/attach',
  'terminal/retain',
  'terminal/watch',
  'workspaceFiles/changes',
  'job/list',
  'job/follow',
  // rc.5 新增会话级流(逐会话资源,跨租户 deny):
  'toolResults/watch',
  'forgePanel/follow',
  'userQuestions/attachWait',
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
  /** WS-C(37 号 M-2):增 getUserById——bindings 回调内按 principal.userId 现查角色,
   *  不得在 installMuxIsolation 时缓存(G2-C5「角色变更对 mux 可见性即时生效」)。
   *  2026-11-24:增 sessionIdsAccessibleBy——流绑定须覆盖子代理子孙会话(见 bindingsFor)。 */
  readonly store: Pick<UserStore, 'sessionsOfOwner' | 'sessionIdsAccessibleBy' | 'workspacesOfOwner' | 'getUserById'>
  readonly session: SessionService
}

/** 30 号 §4.5:工作台数据可见性档位——普通用户仅自己;审批人全租户待人项;管理员全量。
 *  消费面:P2 工作台数据端点(待人项过滤)与 G2-C3 三角色断言。mux 内容绑定不消费
 *  此谓词放宽(见 bindingsFor 的零放宽不变式)。 */
export type VisibilityScope = 'self' | 'tenant-pending' | 'all'

/** 三档映射(单真值;exhaustive switch,default fail-closed 判 'self'——宁可少可见,
 *  不可多可见,23 §3.1 fail-closed 纪律同构迁移)。 */
export function visibilityScopeOf(role: UserRole): VisibilityScope {
  switch (role) {
    case 'approver': return 'tenant-pending'
    case 'admin': return 'all'
    case 'user': return 'self'
    default: return 'self'
  }
}

/** 待人项动作分派表(37 号 M-2「角色感知」的唯一行为面):当前上游流方法表无任何
 *  person/* 待人项端点(本文件头注动作清单盘点;PLUGIN-AUTHORING §1.1 第 6 条:
 *  无上游端点即不登记动作,mux-drift 防漂移测试即红),三档一律空集=零新增动作。
 *  Record 以 VisibilityScope 全键约束——扩档漏配即编译红(同 exhaustive switch 语义,
 *  M-5 锚②的行为面)。WS-D 待人项端点落地时在此按档分派。 */
const PENDING_ACTIONS_BY_SCOPE: Record<VisibilityScope, readonly string[]> = {
  self: [],
  'tenant-pending': [],
  all: [],
}

function pendingStreamActionsOf(scope: VisibilityScope): readonly string[] {
  return PENDING_ACTIONS_BY_SCOPE[scope]
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

/** 一个用户的资源绑定(账本为唯一事实源;子代理子会话经 parentSessionId 由上游随父判定)。
 *
 * WS-C(37 号 M-2)内容绑定零放宽不变式:普通用户/审批人/管理员三角色返回**完全同构**
 * 的本人内容绑定(GLOBAL 内容动作 + 本人 sessions + 本人 workspaces)——30 §7-3 只授权
 * 审批人见「待人项」(工作台数据面),未授权跨租户会话/工作区内容流;「管理员全量」同样是
 * 工作台数据语义(30 §4.5),mux 内容流无放宽依据(37 号 §7 缺口 3)。角色现查(不缓存)
 * 仅驱动两处:**收窄**面=待人项动作分派点 pendingStreamActionsOf(本批三档皆空)与
 * 管理员专属 UI 门 ADMIN_ONLY_UNARY_ACTIONS(非 admin 不下发;T6.2 起只剩系统层
 * MCP 管理面——插件页整页门已按用户裁定放开,见该清单注释);
 * 任何角色档都不得因角色获得额外内容绑定(零放宽)。 */
export function bindingsFor(deps: MuxPolicyDeps, userId: number): readonly TenantBinding[] {
  const role: UserRole = deps.store.getUserById(userId)?.role ?? 'user'
  const unaryActions = role === 'admin'
    ? GLOBAL_UNARY_ACTIONS
    : GLOBAL_UNARY_ACTIONS.filter(action => !ADMIN_ONLY_UNARY_ACTIONS.includes(action))
  const streamActions = role === 'admin'
    ? GLOBAL_STREAM_ACTIONS
    : GLOBAL_STREAM_ACTIONS.filter(action => !ADMIN_ONLY_STREAM_ACTIONS.includes(action))
  const globalRole = { name: 'eterna:member-global', resource: 'global' as const, actions: [...streamActions, ...unaryActions, ...GLOBAL_EVENT_ACTIONS, ...pendingStreamActionsOf(visibilityScopeOf(role))] }
  // 会话资源还须授予 workspace/follow:上游 workspace-controller 的 follow 流对
  // workspace.sessionIds 逐项 allows({kind:'session',id}) 判定,action 取当前
  // 调用面(=workspace/follow)——会话绑定不含此动作时,连用户自己的会话也会被从
  // workspace 视图的 sessionIds 里过滤掉(侧栏落「未分组」),blank 会话的
  // sessionWorkspace/chipTitle 断链 = 新用户首屏死锁根因(2026-11-11 E2E)。
  const sessionRole = { name: 'eterna:session-member', resource: 'session' as const, actions: [...SESSION_STREAM_ACTIONS, ...TERMINAL_UNARY_ACTIONS, ...WORKSPACE_FILE_UNARY_ACTIONS, ...WORKSPACE_STREAM_ACTIONS, ...SESSION_UNARY_ACTIONS, ...SESSION_EVENT_ACTIONS] }
  const workspaceRole = { name: 'eterna:workspace-member', resource: 'workspace' as const, actions: [...WORKSPACE_STREAM_ACTIONS, ...WORKSPACE_UNARY_ACTIONS] }
  const bindings: TenantBinding[] = [{ resource: { kind: 'global' }, role: globalRole }]
  // 2026-11-24:绑定源用 sessionIdsAccessibleBy(直接入账行 + 子代理后代)——
  // 上游资源级答案严格查「该资源自身绑定」,global 不兜底(PR#57 教训);子会话
  // 不在绑定点上 ⇒ session/follow 恒 no-allow,点击子智能体打开历史即「历史加载
  // 失败:session/follow: access denied」。租户面不放宽:后代集合由账本父链推导,
  // 他人父链的子会话仍无绑定。
  for (const sessionId of deps.store.sessionIdsAccessibleBy(userId)) {
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
  /** mux 换血是否已生效(策略面注册完成)。false = 市场门已生效,但 mux 路径仍走原
   *  admit(owner Peer——remoteAccess 服务晚挂载时的过渡态)。 */
  readonly muxActive: boolean
  /** 策略面补注册(幂等;服务晚挂载时由调用方重试)。返回是否已生效。 */
  readonly retryPolicy: () => boolean
}

/**
 * 安装 mux 换血 + 租户策略 + T6.1 市场面 admin 门。connection 为 client-connection
 * 服务实例(ctx.connection,inject 面恒可得);remoteAccess 为 api-remote-access 服务
 * 实例或其**解析器**(上游服务晚挂载——传 `() => ctx.reflect.get('remoteAccess', false)`
 * 让 retryPolicy 每次现查;传实例则只试一次)。
 *
 * 分相(2026-11-19 T6.1):
 * - admit 包装(mux 换血 + 市场门)只依赖 connection,**首调即装**——市场门不得因
 *   remoteAccess 未就绪而出现无门窗口;
 * - 策略面依赖 remoteAccess.registerPolicy + connection.createPeer,缺席时 mux 路径
 *   维持原 admit(owner),由 retryPolicy 在服务挂载后补注册。
 * connection 缺席(上游漂移/非 Web 载体)返回 undefined(装载冒烟告警)。
 */
export function installMuxIsolation(
  deps: MuxPolicyDeps,
  connection: ServiceHandle | undefined,
  remoteAccess: ServiceHandle | (() => ServiceHandle | undefined) | undefined,
): MuxIsolationInstall | undefined {
  if (connection === undefined) return undefined
  const admitFn = connection.admit
  if (typeof admitFn !== 'function') return undefined
  const remoteAccessOf = (): ServiceHandle | undefined =>
    typeof remoteAccess === 'function' ? remoteAccess() : remoteAccess

  // 1. 策略(每用户绑定动态读账本+角色。TS-37-1 已核实上游求值时机:dsh-api-remote-access
  //    lib/index.js:326 bindingsOf 每 decide(:227)/allows(:259)直调 policy.bindings,
  //    无 per-principal 快照缓存(:212 注释「bindings() is called once per decision」;
  //    :245 长 coursing 流逐检查重读)——角色/归属变更下一次判定即生效,本批无需
  //    per-user Peer 失效面;绑定形变待人项落地时由调用方 remoteAccess.invalidate 推流。)
  let muxActive = false
  let disposePolicy: unknown
  const retryPolicy = (): boolean => {
    if (muxActive) return true
    const service = remoteAccessOf()
    const registerPolicyFn = service?.registerPolicy
    const createPeerFn = connection.createPeer
    if (typeof registerPolicyFn !== 'function' || typeof createPeerFn !== 'function') return false
    disposePolicy = registerPolicyFn.call(service, 'eterna-user', {
      bindings: (principal: EternaUserPrincipal) => bindingsFor(deps, principal.userId),
    })
    muxActive = true
    return true
  }
  retryPolicy()

  // 2. 换血 + T6.1 市场门 + TERM-004 终端一元门 + ACC-008 文件面门 + MCPS-006
  //    系统 MCP 管理门:单一 admit 包装,全部请求必经。
  //    - 市场路径:先按 eterna 登录态收口(fail-closed:无会话 401、非 admin 403),
  //      admin 走原 admit(owner Peer)——见 MARKET_ADMIN_PREFIXES;
  //    - 系统 MCP 管理面(/api/mcpManager/probe|restart):仅 admin。显式角色判
  //      403(可执行文案)+ 换血 per-user Peer(策略面亦不含非 admin 的这两个
  //      动作,双保险);普通用户只走个人层 /api/mcp-personal/*;
  //    - 终端一元路径(/api/terminal/*):必须换血成 per-user Peer——rc.5 的
  //      browser admit 恒 owner(client-connection lib/index.js:714/790-800),
  //      而 owner principal 会被网关 prepareInvocation 的 decide 整段跳过
  //      (dsh-api-gateway lib/index.js:1204 `peer.principal.kind !== 'owner'`),
  //      terminal 服务入口的归属守卫(terminal.ts)因此看不到任何身份。换血后
  //      网关按会话资源 decide:本人会话(会话绑定含 TERMINAL_UNARY_ACTIONS)放行,
  //      他人会话 deny(remote-access/denied)。策略面未就绪时 fail-closed 503,
  //      绝不以 owner 身份放行(否则跨租户读 cwd/shells 的老洞复现);
  //    - 文件面一元路径(/api/workspaceFiles/*):同上换血;workspaceFileScope
  //      lookup 解析为会话资源,他人会话 deny(ACC-008/SEC-004 读到他人文件的根因
  //      = owner Peer 令 decide 跳过);
  //    - mux 路径:策略面就绪时按 eterna_session 换血 per-user Peer(≤20 人,常驻不逐
  //      连接 dispose);未就绪时维持原 admit(过渡态,同旧行为);
  //    - 其余路径(含全部其它 unary HTTP 与 fetch 路由)→ 原 admit。
  const peers = new Map<number, { id: string; principal: unknown; dispose: () => unknown }>()
  const originalAdmit = admitFn.bind(connection)
  const createPeerFn = connection.createPeer
  const peerOf = (userId: number): { id: string; principal: unknown; dispose: () => unknown } => {
    let peer = peers.get(userId)
    if (peer === undefined) {
      if (typeof createPeerFn !== 'function') throw new Error('connection.createPeer is unavailable')
      peer = createPeerFn.call(connection, { principal: { kind: 'eterna-user', userId } })
      peers.set(userId, peer)
    }
    return peer
  }
  const wrapped = (request: unknown): unknown => {
    const rawUrl = (request as { url?: unknown }).url
    const path = typeof rawUrl === 'string' ? requestPathname(rawUrl) : ''
    if (path !== '' && isMarketPath(path)) {
      // T6.2:无 eterna 会话 401(持 owner 级 dsh cookie 也拒,fail-closed);
      // admin 全量走原 admit;非 admin 只放行读白名单(未知方法默认拒)。
      const userId = eternaUserOf(deps, request)
      if (userId === undefined) return { rejection: 401 }
      if (deps.store.getUserById(userId)?.role !== 'admin' && !marketMemberAllowed(path)) return { rejection: 403 }
      return originalAdmit(request)
    }
    if (path !== '' && isMcpManagerPath(path)) {
      if (!muxActive && !retryPolicy()) return { rejection: 503 }
      const userId = eternaUserOf(deps, request)
      if (userId === undefined) return { rejection: 401 }
      if (deps.store.getUserById(userId)?.role !== 'admin') return { rejection: 403 }
      if (typeof createPeerFn !== 'function') return { rejection: 503 }
      return { peer: peerOf(userId) }
    }
    if (path !== '' && isTerminalUnaryPath(path)) {
      // 策略未就绪(remoteAccess/createPeer 服务面缺席)→ 现场补注册;仍缺席则拒,
      // 不退回 owner Peer(终端租户校验的唯一身份来源是 eterna-user principal)。
      if (!muxActive && !retryPolicy()) return { rejection: 503 }
      const userId = eternaUserOf(deps, request)
      if (userId === undefined) return { rejection: 401 }
      if (typeof createPeerFn !== 'function') return { rejection: 503 }
      return { peer: peerOf(userId) }
    }
    if (path !== '' && isWorkspaceFilesUnaryPath(path)) {
      // 同终端:策略面缺席时 fail-closed,不得退回 owner Peer(否则 decide 跳过=
      // 跨租户读文件复现)。换血后由 workspaceFileScope 会话资源逐项判定。
      if (!muxActive && !retryPolicy()) return { rejection: 503 }
      const userId = eternaUserOf(deps, request)
      if (userId === undefined) return { rejection: 401 }
      if (typeof createPeerFn !== 'function') return { rejection: 503 }
      return { peer: peerOf(userId) }
    }
    const isMux = typeof rawUrl === 'string' && rawUrl.includes(MUX_PATH)
    if (!isMux || !muxActive || typeof createPeerFn !== 'function') return originalAdmit(request)
    const userId = eternaUserOf(deps, request)
    if (userId === undefined) return originalAdmit(request)
    return { peer: peerOf(userId) }
  }
  ;(connection as { admit: unknown }).admit = wrapped

  return {
    wrapped: true,
    get muxActive() { return muxActive },
    retryPolicy,
    dispose: () => {
      ;(connection as { admit: unknown }).admit = admitFn
      for (const peer of peers.values()) { try { void peer.dispose() } catch { /* 常驻 Peer 尽力而为 */ } }
      peers.clear()
      const disposePolicyFn = disposePolicy as (() => void) | undefined
      disposePolicyFn?.()
    },
  }
}
