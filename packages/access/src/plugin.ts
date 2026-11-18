/**
 * @eterna/access 装配位:DSH 宿主插件(default export 实例,DSH 硬性规范 1)。
 * inject ['webServer','connection','tools','llm'](前二=frontend-static 同款 lib/index.js:26 实证;
 * 'tools'=companion 分发边界 wrap 的宿主服务——cordis 过滤上下文访问未声明服务是 get trap
 * 抛错,2026-11-13 生产事故根因,声明缺失时运行侧另有 readToolsService 降级兜底;
 * 'llm'=2026-11-18 思考强度自动模式的档位表来源,同 get-trap 纪律);
 * register 四条路由(/login /logout /account 精确 + /access/api 前缀)+
 * tapIndex 注入账号角标;返回 handle 为 apply 的配逆闭包(路由 disposer + store close)。
 * seam 用结构类型钉住(形态取 @deepseek-ai/dsh-host-webserver 0.2.2-alpha.3
 * index.d.ts:193 register/tapIndex、dsh-client-connection rpc.d.ts:223 authenticatedUrl,
 * 升级门禁按行号复核):不 import 发布类型——其类型面拖入 cordis/typert-protocol/
 * credentials/brand 四个 peer 依赖,只为两三个方法签名,不值得。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { reportAccessAudit, type AccessAuditEvent, type AuditReflect } from './audit.ts'
import { companionTokenOf } from './companion.ts'
import { installCompanionExecutableWrap, readToolsService, routeCompanion } from './companion-inject.ts'
import { ApprovalBridge, toolApprovalTimeoutMs } from './approval-bridge.ts'
import { QuestionBridge, userQuestionTimeoutMs } from './question-bridge.ts'
import { type AccessRequest } from './http.ts'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-tools 对 cordis Events('tools/pre-execute')增广的触发器（governance-plugin 同款）：
// 下方 companion 身份注入钩子的监听签名依赖该声明文件进入本包 tsc 程序。
import type {} from '@deepseek-ai/dsh-tools'
import { handleAccessRequest, type AccessDeps } from './routes.ts'
import { loadOrCreateSecret, SessionService } from './session.ts'
import { SlidingWindow } from './ratelimit.ts'
import { createStreamBridgeHandler } from './stream.ts'
import { UserStore } from './store.ts'
import { installThinkingAuto, type ThinkingAutoLlm } from './thinking-auto.ts'
import { ensureFirstSession, ensureTenantWorkspace, registerTenantGuards, WORKBENCH_STREAM_ENDPOINT } from './tenant.ts'
import { createTenantPluginLoader, type TenantPluginToolsFace } from './tenant-plugins.ts'
import { defineInstallPersonalPluginTool } from './install-tool.ts'
import { installMuxIsolation, type MuxIsolationInstall } from './mux.ts'
import { installLoginGate } from './login-gate.ts'
import { registerChannelsWebhook } from './channels-webhook.ts'
import { installToolClamp, installSandboxBoundary } from './sandbox.ts'
import { installTerminalTenant, installTerminalSandbox } from './terminal.ts'
import { BADGE_SCRIPT } from './pages.ts'

export const ACCESS_PLUGIN_NAME = 'eterna-access'

export interface AccessPluginConfig {
  /** 数据目录(默认 $ETERNA_ACCESS_DIR,再退 $DSH_HOME/access);users.db/secret.key 落此。 */
  readonly dir?: string
}

/** 本插件消费的 Web 载体 seam(WebServer.register/tapIndex 的结构子集)。 */
export interface AccessWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
  tapIndex(transform: (html: string) => string): () => void
}

/** 本插件消费的 Connection seam(authenticatedUrl 桥接 + fetch 路由注册面 + 索引门禁包装面)。 */
export interface AccessConnection {
  authenticatedUrl(baseUrl: string): string
  fetch: import('./tenant.ts').TenantFetchRegistry
  /** 索引页认证(dsh-client-connection authorizeIndex);缺省=上游漂移,跳转门禁降级不装。 */
  authorizeIndex?: (request: unknown, sink: import('./login-gate.ts').IndexAuthSink) => boolean
}

/** 最小宿主上下文(结构类型,不依赖 cordis 类型面)。 */
export interface AccessContext {
  readonly webServer: AccessWebServer
  readonly connection: AccessConnection
  readonly reflect: AuditReflect
  /** llm 服务(2026-11-18 思考强度自动模式:resolveModelInfo 取档位表;结构面见 ThinkingAutoLlm)。 */
  readonly llm: ThinkingAutoLlm
}

const MAX_BODY_BYTES = 2 * 1024 * 1024

type BodyResult = { readonly kind: 'body'; readonly data: Uint8Array } | { readonly kind: 'oversize' } | { readonly kind: 'aborted' }

function collectBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const finish = (result: BodyResult): void => {
      if (done) return
      done = true
      resolve(result)
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        finish({ kind: 'oversize' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { finish({ kind: 'body', data: Buffer.concat(chunks) }) })
    req.on('error', () => { finish({ kind: 'aborted' }) })
  })
}

function createNodeHandler(deps: AccessDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://local').pathname
    } catch {
      // 非法 URL 按 / 处理,交 404
    }
    const collected = await collectBody(req)
    if (collected.kind !== 'body') {
      res.statusCode = collected.kind === 'oversize' ? 413 : 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: collected.kind === 'oversize' ? '请求体过大' : '请求中断' }))
      setImmediate(() => { req.destroy() })
      return
    }
    const request: AccessRequest = {
      method: (req.method ?? 'GET').toUpperCase(),
      pathname,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      host: req.headers.host,
      xff: req.headers['x-forwarded-for'],
      contentType: req.headers['content-type'],
      body: collected.data,
    }
    try {
      const reply = handleAccessRequest(deps, request)
      res.statusCode = reply.status
      for (const [name, value] of reply.headers) res.setHeader(name, value)
      if (reply.body === undefined) res.end()
      else if (typeof reply.body === 'string') res.end(reply.body)
      else res.end(Buffer.from(reply.body))
    } catch (error) {
      // 未预期异常显式落容器日志(R7 可观测性:门禁插件静默失败=裸 400 无从排障)
      console.error('[eterna-access] handler error:', error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'internal error' }))
      } else {
        res.destroy()
      }
    }
  }
}

export function defineAccessPlugin(config: AccessPluginConfig = {}) {
  return {
    name: ACCESS_PLUGIN_NAME,
    inject: ['webServer', 'connection', 'tools', 'llm'],
    apply(ctx: AccessContext & Context): () => void {
      const dir = config.dir
        ?? (process.env.ETERNA_ACCESS_DIR !== undefined && process.env.ETERNA_ACCESS_DIR !== ''
          ? process.env.ETERNA_ACCESS_DIR
          : join(process.env.DSH_HOME ?? process.cwd(), 'access'))
      const store = new UserStore(join(dir, 'users.db'))
      store.loadDisabledPlugins(join(dir, 'disabled-plugins.json'))
      store.loadRemovedPlugins(join(dir, 'removed-plugins.json'))
      const audit = (event: AccessAuditEvent): void => { reportAccessAudit(ctx, event) }
      const seededAccount = process.env.ETERNA_ACCESS_ADMIN_USER
      if (store.seedAdmin(seededAccount, process.env.ETERNA_ACCESS_ADMIN_PASSWORD) && seededAccount !== undefined) {
        audit({ kind: 'access.user.seed', account: seededAccount })
      }
      const session = new SessionService(loadOrCreateSecret(process.env.ETERNA_ACCESS_SECRET, dir), {
        secure: process.env.ETERNA_ACCESS_SECURE === '1',
      })
      const tenantRoot = process.env.ETERNA_TENANT_ROOT ?? join(process.env.DSH_HOME ?? process.cwd(), 'workspaces')
      // ── T6 装载器(2026-11-18):个人/共享工具插件进程内 mount(闭合 P4-T6 一期
      // 边界「mount 面留后续任务」)。tools 面惰性取用——ctx.tools 在 apply 时点可能
      // 未就绪(companion wrap 同款时序),bootScan 未就绪则跳过,由首个工具调用的
      // pre-execute 监听补扫(见下方 ensureBootScan);个人插件启停/安装/转内置
      // 从此免重启。装载失败只记插件状态+审计,绝不炸 boot。
      const pluginLoader = createTenantPluginLoader({
        store,
        sessionOwnerOf: (id: string) => store.sessionOwner(id),
        // register 面(区别于 companion 的 executable 面):本插件已 inject 'tools',
        // 属性直取不触发 get trap;仍留 undefined 兜底(companion readToolsService 同款宽松)。
        readTools: () => (ctx as unknown as { readonly tools?: TenantPluginToolsFace }).tools,
        audit,
      })
      let bootScanStarted = false
      const ensureBootScan = (): void => {
        if (bootScanStarted) return
        if (readToolsService(ctx) === undefined) return
        bootScanStarted = true
        void pluginLoader.bootScan()
      }
      // ── 工具审批桥(2026-11-13):web 前端无审批面,治理 ask 挂死不可见(session-
      // 7e15e6ab 事故)。宿主侧答者接内核 approval/request waterfall,按会话归属
      // 暴露给本人浏览器(轮询/裁决;超时 unavailable)。未知会话 next() 透传。
      const approvalBridge = new ApprovalBridge({
        sessionOwner: (id: string) => store.sessionOwner(id),
        audit,
        timeoutMs: toolApprovalTimeoutMs(process.env),
      })
      // ── 提问桥(2026-11-17):ask_user_question 在多租户下结构性不可达——网关
      // forward 只投 owner peer(dsh-api-gateway lib:1042/1136),mux 换血后浏览器
      // 是 eterna-user,提问挂死无 UI 无超时(session-c9a74388 事故 42 分钟)。
      // 宿主侧接 user-questions/request waterfall,浏览器轮询待答/提交答案。
      const questionBridge = new QuestionBridge({
        sessionOwner: (id: string) => store.sessionOwner(id),
        audit,
        timeoutMs: userQuestionTimeoutMs(process.env),
      })
      const deps: AccessDeps = {
        store,
        session,
        loginWindow: new SlidingWindow(5, 60_000),
        globalWindow: new SlidingWindow(30, 60_000),
        audit,
        bridgeHome: (origin: string) => ctx.connection.authenticatedUrl(origin),
        publicOrigin: process.env.ETERNA_PUBLIC_URL !== undefined && process.env.ETERNA_PUBLIC_URL !== '' ? process.env.ETERNA_PUBLIC_URL : undefined,
        dataDir: dir,
        provisionWorkspace: user => provisionTenantWorkspace({ store, reflect: ctx.reflect, tenantRoot, audit }, user),
        relayPublicWsUrl: process.env.ETERNA_RELAY_PUBLIC_URL !== undefined && process.env.ETERNA_RELAY_PUBLIC_URL !== ''
          ? process.env.ETERNA_RELAY_PUBLIC_URL
          : undefined,
        approvalBridge,
        questionBridge,
      }
      // 答者随插件卸载解除;disposers 数组在下方 createNodeHandler 后才初始化(TDZ),
      // 故先留柄、落数组时统一收编。on 注册面走结构面 cast(cordis on 具体重载不进桥)。
      //
      // prepend(2026-11-17 测试容器实证):waterfall 是链式竞速——api-remotes 的
      // 转发答者(把事件发给浏览器、等 owner peer 应答)同挂宿主链。缺 prepend 时
      // 它先注册先执行,mux 换血后的浏览器永非 owner → 永远等不到应答,本桥根本
      // 没机会执行(提问 42 分钟挂死、审计无任何桥事件)。head 位置 = 先于网关
      // 转发判定;未知会话仍 next() 透传,维持上游行为。
      const offApprovalAnswerer = approvalBridge.installAnswerer(
        listener => (ctx as unknown as { on: (event: string, listener: (request: unknown, next: () => unknown) => unknown, options?: { prepend?: boolean }) => () => void }).on('approval/request', listener, { prepend: true }),
      )
      // 提问答者:与审批同款 waterfall seam(user-questions/request,scopeTarget(agent)
      // 作用域,由 dsh-user-questions lib:709-714 发起)。prepend 理由同上。
      const offQuestionAnswerer = questionBridge.installAnswerer(
        listener => (ctx as unknown as { on: (event: string, listener: (request: unknown, next: () => unknown) => unknown, options?: { prepend?: boolean }) => () => void }).on('user-questions/request', listener, { prepend: true }),
      )
      // ── 思考强度自动模式(2026-11-18):每轮用户消息入箱时按启发式评分自动
      // 调 agent.model.select 选档。信号面=agent/created 登记 + session/event
      // (alpha.3 主路径)+ inbox/inserted(rc.1 兼容,双路径去重);选档落盘在
      // 微任务(session.append 派发中嵌套 append 被宿主禁止)。开关存 users.db
      // sessions.thinking_auto(默认开启),UI=模型菜单「自动」chip(模型菜单铁律内)。
      const offThinkingAuto = installThinkingAuto(
        { store, llm: ctx.llm, audit },
        (event, listener) => (ctx as unknown as {
          on: (event: string, listener: (...args: unknown[]) => void) => () => void
        }).on(event, listener),
      )
      // P3(2026-11-11):把归属账本 provide 出去(usage-stats 聚合的归属唯一事实源;
      // reflect 键 eternaAccessStore)。账本只读面,不含凭据。
      const storeProvide = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
      // ── companion 身份注入（E4 多用户浏览器执行面；2026-11-13 重做注入点）──
      // 内核在 createExecution 时对 arguments 做 snapshot+deepFreeze，且合同禁止
      // pre-execute 改写输入（companion-inject.ts 头注详述）——原「瀑布末段原地写
      // arguments._eternaToken」在冻结对象上必炸（2026-11-12 生产事故：
      // mcp__browser__* 全灭）。现注入点 = dispatch 边界（tools.executable 实例
      // wrap，展开新对象注入）；本监听只保留两件事：
      // 1. 惰性安装 wrap（幂等 + 一次性审计，沿 ensureMux 模式。首调发生在
      //    prepare 瀑布、先于 dispatch，时序成立；ctx.tools 在 apply 时点可能
      //    尚未就绪，故不设在 apply）；
      // 2. fail-closed deny 判定（已知归属未生成令牌 → deny，保持在人审之前）。
      // 语义不变：未知会话（系统任务等）→ 不注入（主域，同历史行为）。
      const companionDeps = {
        sessionOwner: (id: string) => store.sessionOwner(id),
        tokenOf: (id: number) => companionTokenOf(dir, id)?.token,
      }
      let companionWrap: (() => void) | undefined
      let companionAuditDone = false
      const ensureCompanionWrap = (): void => {
        if (companionWrap !== undefined) return
        // ctx.tools 读取必须走安全面:cordis 过滤上下文(inject 清单)访问未声明服务是
        // get trap 抛错(`cannot get property "tools" without inject`),可选链兜不住
        // ——2026-11-13 生产事故:本监听对每个工具调用先炸这一下,全工具面灭。
        // 根治 = inject 清单补 'tools';此助手只兜声明缺失/服务未就绪的退化路径。
        const tools = readToolsService(ctx)
        if (tools === undefined || typeof tools.executable !== 'function') return
        companionWrap = installCompanionExecutableWrap(tools, companionDeps)
        disposers.push(companionWrap)
        if (!companionAuditDone) {
          companionAuditDone = true
          audit({ kind: 'access.companion.install', detail: { executableWrap: true } })
        }
      }
      const offCompanionIdentity = ctx.on('tools/pre-execute', async (exec, next) => {
        ensureCompanionWrap()
        // T6 补扫:apply 时点 tools 未就绪导致 bootScan 跳过时,首个工具调用补扫
        // (此时 tools 服务必已就绪——本监听正是 tools/pre-execute)。
        ensureBootScan()
        if (!exec.name.startsWith('mcp__browser__')) return next()
        const route = routeCompanion(companionDeps, exec.agent?.session.id)
        if (route.kind === 'deny') return { kind: 'deny', reason: route.reason }
        return next()
      })

      const handler = createNodeHandler(deps)
      const disposers = [
        ctx.webServer.register({ kind: 'exact', path: '/login', handler }),
        ctx.webServer.register({ kind: 'exact', path: '/logout', handler }),
        // /account:旧独立页已废(账号自助=设置弹窗账号分区),此处仅接住残留链接
        // 302 回应用(routes.ts)——不注册则 webServer 直接 404 空体=浏览器黑屏。
        ctx.webServer.register({ kind: 'exact', path: '/account', handler }),
        ctx.webServer.register({ kind: 'prefix', path: '/access/api', handler }),
        // 工作台实时流桥(T15;38 号 O-5/G2-C4,路径唯一事实源 = tenant.ts
        // WORKBENCH_STREAM_ENDPOINT 守卫清单登记行):GET + 登录会话守卫,数据面 =
        // eterna-workbench live hub(tasks DomainEvents,反射键 eternaWorkbenchStream)。
        // 铁律 T2 路由面独占——workbench/tasks 不得自注册,登记面只在 access。
        ctx.webServer.register({ kind: 'exact', path: WORKBENCH_STREAM_ENDPOINT, handler: createStreamBridgeHandler({ store, session, reflect: ctx.reflect, audit }) }),
        ctx.webServer.tapIndex(html => injectBadge(html)),
      ]
      disposers.push(offCompanionIdentity)
      disposers.push(offApprovalAnswerer)
      disposers.push(offQuestionAnswerer)
      disposers.push(offThinkingAuto)
      // ── T6 自研安装工具(2026-11-18):install_personal_plugin。注册走 apply 直注
      // (glue knowledge/memory 先例;inject ['tools'] 使 ctx.tools 就绪),失败只降级
      // (审计+日志,不炸装配);装载器 disposer 随插件卸载(全部 mount 子树回收)。
      try {
        const toolDeps = { tenantDeps: { store, session, reflect: ctx.reflect, tenantRoot, audit }, loader: pluginLoader }
        disposers.push(ctx.tools.register(defineInstallPersonalPluginTool(toolDeps)))
      } catch (error) {
        audit({ kind: 'access.tenant', detail: { action: 'install-tool.register.failed', error: error instanceof Error ? error.message : String(error) } })
      }
      disposers.push(() => { pluginLoader.dispose() })
      ensureBootScan()
      // 索引页登录跳转门禁(2026-11-17):未登录/浏览器 cookie 过期访问根路径时,
      // dsh authorizeIndex 原本回裸 401 文本(index HTML 不发出→tapIndex 角标脚本
      // 永不运行)。包装为 302 /login;token 兑换 303 与已认证请求原样放行。
      const loginGateDispose = installLoginGate(ctx.connection)
      if (loginGateDispose !== undefined) disposers.push(loginGateDispose)
      audit({ kind: 'access.login.gate', detail: { installed: loginGateDispose !== undefined } })
      // channels webhook 公共面(39 号 E8;铁律 T2 路由面独占,24a 裁决口径):外部渠道
      // 入站 webhook 与邮件审批令牌是服务器到服务器的公共面(无浏览器 cookie,自带
      // HMAC/单次令牌 fail-closed 鉴权),路由面归本插件登记,数据面归 channels 网关
      // (逐请求 reflect 机会读,卸载即 503)。语义与失败兜底见 channels-webhook.ts 头注。
      disposers.push(registerChannelsWebhook(ctx.webServer, ctx.reflect))
      // Phase 2 租户面(T2.2/T2.5):存量 workspace 划归首个 admin
      adoptLegacyWorkspaces(store)
      // P1-T2(2026-11-11):mux 流租户隔离——principal 换血 + registerPolicy。
      // 连接服务经 ctx.connection 属性直取(inject 面,apply 时即得);remoteAccess 只经
      // reflect 可得且可能晚挂载。T6.1(2026-11-19)后 admit 包装(含市场面 admin 门)
      // 不再等 remoteAccess:**apply 即装**,无「首次请求前无门」窗口;策略面缺席时
      // mux 换血暂缺,由守卫请求重试 retryPolicy 补注册。审计记录首装与补注册两次事实。
      let muxInstall: MuxIsolationInstall | undefined
      let muxAuditDone = false
      const ensureMux = (): void => {
        if (muxInstall !== undefined) {
          // 服务晚挂载补注册(幂等);生效瞬间补审计,便于线上确认换血时点。
          if (!muxInstall.muxActive && muxInstall.retryPolicy()) {
            audit({ kind: 'access.mux.install', detail: { installed: true, policyLate: true, muxActive: true } })
          }
          return
        }
        // 连接服务经 ctx.connection 属性直取(cordis provide 面;reflect 键 'client-connection'
        // 实测不可得——2026-11-11 容器探针);remoteAccess 经 reflect 可得(探针实证),
        // 但可能晚挂载——传解析器让 retryPolicy 每次现查(T6.1 首装时它常缺席)。
        const connService = ctx.connection as unknown
        const accessService = ctx.reflect.get('remoteAccess', false)
        muxInstall = installMuxIsolation(
          { store, session },
          connService as never,
          () => ctx.reflect.get('remoteAccess', false) as never,
        )
        if (muxInstall !== undefined) disposers.push(muxInstall.dispose)
        if (!muxAuditDone) {
          muxAuditDone = true
          audit({
            kind: 'access.mux.install',
            detail: {
              installed: muxInstall !== undefined,
              muxActive: muxInstall?.muxActive === true,
              probe: {
                connection: typeof connService,
                remoteAccess: typeof accessService,
                workspaceController: typeof ctx.reflect.get('workspaceController', false),
              },
            },
          })
        }
      }
      ensureMux()
      // P1-T3(2026-11-11):沙箱写边界钉死=账号目录 + 工具参数逃逸钳制。
      // pre-execute 监听可即时挂(ctx.on 全局事件总线,沿 glue governance-plugin 挂法);
      // sandboxPolicy.resolve wrap 惰性(服务挂载时点,同 ensureMux)。
      // 【单一注册纪律】registerTenantGuards 只允许一次调用(重复注册路由抛错,
      // 曾致 apply 中断、惰性安装永不生效——2026-11-11 容器实抓,已合并)。
      const sandboxDeps = {
        sessionOwner: (id: string) => store.sessionOwner(id),
        accountOf: (id: number) => store.getUserById(id)?.account,
        tenantRoot,
      }
      const tenantAudit = (detail: Record<string, unknown>): void => { audit({ kind: 'access.sandbox.clamp', detail }) }
      if (typeof (ctx as unknown as { on?: unknown }).on === 'function') {
        const onFn = (ctx as unknown as { on: (event: string, listener: unknown) => () => void }).on
        disposers.push(installToolClamp(sandboxDeps, onFn, tenantAudit))
        audit({ kind: 'access.sandbox.install', detail: { toolClamp: true } })
      }
      let sandboxBoundaryDone = false
      const ensureSandbox = (): void => {
        if (sandboxBoundaryDone) return
        sandboxBoundaryDone = true
        const policy = ctx.reflect.get('sandboxPolicy', false) as never
        const dispose = installSandboxBoundary(sandboxDeps, policy)
        if (dispose !== undefined) disposers.push(dispose)
        audit({ kind: 'access.sandbox.install', detail: { boundaryWrap: dispose !== undefined } })
      }
      // P1-T4(2026-11-11):终端租户隔离(入口校验+PTY 沙箱包装,实例级 wrap)。
      let terminalDone = false
      const ensureTerminal = (): void => {
        if (terminalDone) return
        terminalDone = true
        const terminalSvc = ctx.reflect.get('terminalController', false) as never
        const tenantDispose = installTerminalTenant(sandboxDeps, terminalSvc)
        if (tenantDispose !== undefined) disposers.push(tenantDispose)
        const subprocess = ctx.reflect.get('subprocess', false) as never
        const sandbox = ctx.reflect.get('sandbox', false) as never
        const policy = ctx.reflect.get('sandboxPolicy', false) as never
        const sandboxDispose = installTerminalSandbox(sandbox, policy, subprocess)
        if (sandboxDispose !== undefined) disposers.push(sandboxDispose)
        audit({
          kind: 'access.terminal.install',
          detail: {
            tenant: tenantDispose !== undefined,
            ptySandbox: sandboxDispose !== undefined,
          },
        })
      }
      if (typeof storeProvide === 'function') {
        disposers.push(storeProvide.call(ctx, 'eternaAccessStore', {
          sessionOwner: (id: string) => store.sessionOwner(id),
          sessionsOfOwner: (id: number) => store.sessionsOfOwner(id),
          workspaceOwner: (id: string) => store.workspaceOwner(id),
          workspacesOfOwner: (id: number) => store.workspacesOfOwner(id),
          getUserById: (id: number) => store.getUserById(id),
        }))
      }
      disposers.push(registerTenantGuards({
        store,
        session,
        reflect: ctx.reflect,
        tenantRoot,
        audit,
        ensureMux: () => { ensureMux(); ensureSandbox(); ensureTerminal() },
        pluginLoader,
      }, ctx.connection))
      return () => {
        for (const dispose of disposers) dispose()
        store.close()
      }
    },
  }
}

/** 角标注入:replace 用函数形式避免 $ 逃逸;无 </body> 时尾部追加(纯变换,幂等无副作用)。 */
export function injectBadge(html: string): string {
  const tag = `<script>${BADGE_SCRIPT}</script>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, () => `${tag}</body>`)
  return html + tag
}

/**
 * 登录开通(问题4):用户名下零工作区时,在 workspaces/<account> 建根工作区并记账;
 * 首开再补一个空会话,让客户端首屏自动落座自己的工作区(否则自动引导会挑中
 * 其他用户的活跃工作区,点开即被守卫拒绝)。失败只落容器日志+审计,不阻断登录。
 */
export async function provisionTenantWorkspace(
  deps: {
    readonly store: UserStore
    readonly reflect: AuditReflect
    readonly tenantRoot: string
    audit(event: AccessAuditEvent): void
  },
  user: { readonly id: number; readonly account: string },
): Promise<void> {
  try {
    if (deps.store.ownsAnyWorkspace(user.id)) return
    const ensured = await ensureTenantWorkspace(deps, user.id, user.account)
    if (ensured === undefined) return
    const firstSessionId = ensured.created
      ? await ensureFirstSession(deps, user.id, ensured.workspaceId)
      : undefined
    deps.audit({
      kind: 'access.tenant',
      account: user.account,
      detail: { action: 'workspace.provision', ...ensured, firstSessionId },
    })
  } catch (error) {
    console.error('[eterna-access] provision workspace failed:', error)
    deps.audit({ kind: 'access.tenant', account: user.account, detail: { action: 'workspace.provision', error: error instanceof Error ? error.message : String(error) } })
  }
}

/** T2.5:存量 workspace(dsh storages/workspace.json)一次性划归首个 admin。 */
function adoptLegacyWorkspaces(store: UserStore): void {
  try {
    const admin = store.listUsers().find(user => user.role === 'admin')
    if (admin === undefined) return
    const file = join(process.env.DSH_HOME ?? process.cwd(), 'storages', 'workspace.json')
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const tables = (parsed as { tables?: { workspaces?: Record<string, { path?: string }> } }).tables
    const rows = Object.entries(tables?.workspaces ?? {})
      .filter(([, row]) => typeof row.path === 'string')
      .map(([workspaceId, row]) => ({ workspaceId, path: row.path as string }))
    if (rows.length > 0) store.adoptOrphanWorkspaces(admin.id, rows)
  } catch {
    // workspace.json 不存在/不可读=无存量,静默
  }
}
