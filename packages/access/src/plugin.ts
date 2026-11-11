/**
 * @eterna/access 装配位:DSH 宿主插件(default export 实例,DSH 硬性规范 1)。
 * inject ['webServer','connection'](frontend-static 同款,frontend-static lib/index.js:26 实证);
 * register 五条路由(/login /logout /account /admin/users 精确 + /access/api 前缀)+
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
import { type AccessRequest } from './http.ts'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-tools 对 cordis Events('tools/pre-execute')增广的触发器（governance-plugin 同款）：
// 下方 companion 身份注入钩子的监听签名依赖该声明文件进入本包 tsc 程序。
import type {} from '@deepseek-ai/dsh-tools'
import { handleAccessRequest, type AccessDeps } from './routes.ts'
import { loadOrCreateSecret, SessionService } from './session.ts'
import { SlidingWindow } from './ratelimit.ts'
import { UserStore } from './store.ts'
import { ensureFirstSession, ensureTenantWorkspace, registerTenantGuards } from './tenant.ts'
import { installMuxIsolation, type MuxIsolationInstall } from './mux.ts'
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

/** 本插件消费的 Connection seam(authenticatedUrl 桥接 + fetch 路由注册面)。 */
export interface AccessConnection {
  authenticatedUrl(baseUrl: string): string
  fetch: import('./tenant.ts').TenantFetchRegistry
}

/** 最小宿主上下文(结构类型,不依赖 cordis 类型面)。 */
export interface AccessContext {
  readonly webServer: AccessWebServer
  readonly connection: AccessConnection
  readonly reflect: AuditReflect
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
    inject: ['webServer', 'connection'],
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
      }
      // P3(2026-11-11):把归属账本 provide 出去(usage-stats 聚合的归属唯一事实源;
      // reflect 键 eternaAccessStore)。账本只读面,不含凭据。
      const storeProvide = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
      // ── companion 身份注入（E4 多用户浏览器执行面）────────────────────────
      // pre-execute 瀑布末段（access 的 insert 行在模板尾部=apply 序最后）：
      // mcp__browser__* 调用按 exec.agent.session.id → sessions 表 owner → 用户令牌，
      // 无条件覆盖 arguments._eternaToken（服务端值赢：模型不可伪造；注入晚于
      // audit/egress/governance——审计与治理面均不接触令牌值）。
      // 语义：已知会话归属但用户未生成令牌 → deny（fail-closed，防跨用户路由到
      // 主浏览器）；未知会话（系统任务等）→ 不注入（主域，同历史行为）。
      const offCompanionIdentity = ctx.on('tools/pre-execute', async (exec, next) => {
        if (!exec.name.startsWith('mcp__browser__')) return next()
        const sessionId = exec.agent?.session.id
        if (typeof sessionId !== 'string' || sessionId === '') return next()
        const ownerId = store.sessionOwner(sessionId)
        if (ownerId === undefined) return next()
        const entry = companionTokenOf(dir, ownerId)
        if (entry === undefined) {
          return {
            kind: 'deny',
            reason: '[companion] 浏览器执行面令牌未生成：请在 设置 → 账号 → 浏览器执行面 生成令牌并安装扩展（安装指引见令牌卡片链接）',
          }
        }
        const args = exec.arguments as Record<string, unknown>
        args['_eternaToken'] = entry.token
        return await next()
      })

      const handler = createNodeHandler(deps)
      const disposers = [
        ctx.webServer.register({ kind: 'exact', path: '/login', handler }),
        ctx.webServer.register({ kind: 'exact', path: '/logout', handler }),
        ctx.webServer.register({ kind: 'prefix', path: '/access/api', handler }),
        ctx.webServer.tapIndex(html => injectBadge(html)),
      ]
      disposers.push(offCompanionIdentity)
      // Phase 2 租户面(T2.2/T2.5):存量 workspace 划归首个 admin
      adoptLegacyWorkspaces(store)
      // P1-T2(2026-11-11):mux 流租户隔离——principal 换血 + registerPolicy。
      // 服务(client-connection/remoteAccess)在插件 apply 时点尚未挂载,故惰性安装:
      // 首个守卫请求时落地(届时 webServer 已工作,上游服务必已就绪),并审计安装结果。
      let muxInstall: MuxIsolationInstall | undefined
      let muxAuditDone = false
      const ensureMux = (): void => {
        if (muxInstall !== undefined) return
        // 连接服务经 ctx.connection 属性直取(cordis provide 面;reflect 键 'client-connection'
        // 实测不可得——2026-11-11 容器探针);remoteAccess 经 reflect 可得(探针实证)。
        const connService = ctx.connection as unknown
        const accessService = ctx.reflect.get('remoteAccess', false)
        muxInstall = installMuxIsolation(
          { store, session },
          connService as never,
          accessService as never,
        )
        if (muxInstall !== undefined) disposers.push(muxInstall.dispose)
        if (!muxAuditDone) {
          muxAuditDone = true
          audit({
            kind: 'access.mux.install',
            detail: {
              installed: muxInstall !== undefined,
              probe: {
                connection: typeof connService,
                remoteAccess: typeof accessService,
                workspaceController: typeof ctx.reflect.get('workspaceController', false),
              },
            },
          })
        }
      }
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
