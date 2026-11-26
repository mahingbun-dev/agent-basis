/**
 * Skill 管理端点(个人 + 共享),全部 POST + RPC 信封 + 登录门。
 *
 * 前缀刻意用 `/api/skills-manage`——上游已有 session 级 `skills/list` Remote
 * (slash 技能菜单用),不能同名遮蔽。端点:
 *   list / read / save / install-md / install-zip / toggle / delete
 *
 * 权限:
 * - 个人:只能操作本人的账号根(服务端从 cookie 会话取 account,绝不收客户端账号);
 * - 共享:读所有登录用户可见(停用项仅 admin 可见),写仅 admin。
 *
 * 审计只记 action/scope/name/字节数;正文、frontmatter、资源内容一律不落审计。
 * 响应带 `cache-control: no-store`(管理面数据不缓存)。
 */
import type { AccessAuditEvent } from './audit.ts'
import type { SessionService } from './session.ts'
import type { SkillMarket } from './skill-market.ts'
import { registerSkillMarketRoutes } from './skill-market-routes.ts'
import {
  SkillStoreError, SKILL_LIMITS,
  type SkillEntry, type SkillItem, type SkillScope, type SkillStore,
} from './skills-store.ts'

/** Skill 管理端点前缀。 */
export const SKILLS_PREFIX = '/api/skills-manage'

export interface SkillsCaller {
  readonly userId: number
  readonly account: string
  readonly role: 'admin' | 'approver' | 'user'
}

type SkillsHandler = (
  rpcId: string,
  args: Record<string, unknown>,
  caller: SkillsCaller,
  signal: AbortSignal,
) => Response | Promise<Response>

export interface SkillsRegister {
  (path: string, handler: SkillsHandler): void
}

export interface SkillsDeps {
  readonly skills: SkillStore
  readonly session: SessionService
  audit(event: AccessAuditEvent): void
  readonly runtime: { invalidate(): void }
  /** 调用者身份(账号/角色);与 provider 共用 users 表读取面。 */
  readonly userOf: (userId: number) => { readonly account: string; readonly role: 'admin' | 'approver' | 'user' } | undefined
  /** 改密即下线:与 tenant 守卫同一 password_version 口径。 */
  readonly passwordVersionOf: (userId: number) => number | undefined
  /** 技能市场(缺席=不注册 market/* 端点)。 */
  readonly market?: SkillMarket | undefined
}

export interface SkillsFetchRegistry {
  register(route: {
    readonly path: string
    readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
    readonly requestBody: 'buffered' | 'streaming'
    readonly fetch: (request: Request) => Promise<Response>
  }): () => Promise<void> | void
}

export interface SkillsFetchHost {
  readonly fetch: SkillsFetchRegistry
  readonly onRequest?: (() => void) | undefined
}

/** 条目 → 前端视图(市场安装的响应也复用同一形状)。 */
export function skillItemOf(entry: SkillEntry): SkillItem {
  return {
    scope: entry.scope,
    name: entry.name,
    description: entry.description,
    ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
    enabled: entry.enabled,
    origin: entry.origin,
    files: entry.files,
    bytes: entry.bytes,
    updatedAt: entry.updatedAt,
  }
}

/** 注册技能 + 市场端点(调用方=已含登录门/信封的 register 面)。 */
export function registerSkillsRoutes(deps: SkillsDeps, register: SkillsRegister): void {
  const store = deps.skills

  const auditOk = (caller: SkillsCaller, action: string, detail: Record<string, unknown> = {}): void => {
    deps.audit({ kind: 'skills.manage', account: caller.account, ok: true, detail: { action, ...detail } })
  }
  const auditDeny = (caller: SkillsCaller, action: string, reason: string, detail: Record<string, unknown> = {}): void => {
    deps.audit({ kind: 'skills.manage', account: caller.account, ok: false, detail: { action, reason, ...detail } })
  }
  const viewOf = (entry: SkillEntry): SkillItem => skillItemOf(entry)

  const scopeOf = (args: Record<string, unknown>): SkillScope | undefined =>
    args.scope === 'personal' || args.scope === 'shared' ? args.scope : undefined
  const nameOf = (args: Record<string, unknown>): string | undefined =>
    typeof args.name === 'string' && args.name !== '' ? args.name : undefined

  /** shared 写门:非 admin 一律拒(读 disabled 也走这里)。 */
  const canWrite = (caller: SkillsCaller, scope: SkillScope): boolean => scope === 'personal' || caller.role === 'admin'

  register(`${SKILLS_PREFIX}/list`, (rpcId, _args, caller) => {
    if (!store.available) return unavailableFrame(rpcId)
    const personal = store.listPersonal(caller.account, true, true)
    const shared = store.listShared(caller.role === 'admin', true)
    return okFrame(rpcId, {
      items: [...personal, ...shared].map(viewOf),
      personalLimit: SKILL_LIMITS.personal,
      sharedLimit: SKILL_LIMITS.shared,
      ...(caller.role === 'admin' ? {} : { sharedReadOnly: true }),
    })
  })

  register(`${SKILLS_PREFIX}/read`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    const name = nameOf(args)
    if (scope === undefined || name === undefined) return deniedFrame(rpcId, '参数不完整(scope/name)')
    try {
      const read = store.read(scope, caller.account, name)
      if (scope === 'shared' && !read.entry.enabled && caller.role !== 'admin') {
        auditDeny(caller, 'read', 'shared-disabled', { scope, name })
        return deniedFrame(rpcId, '共享技能已停用')
      }
      return okFrame(rpcId, { item: viewOf(read.entry), markdown: read.markdown })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'read', { scope, name })
    }
  })

  register(`${SKILLS_PREFIX}/save`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    if (scope === undefined) return deniedFrame(rpcId, '参数不完整(scope)')
    if (!canWrite(caller, scope)) {
      auditDeny(caller, 'save', 'admin-required', { scope })
      return deniedFrame(rpcId, '共享技能仅管理员可编辑')
    }
    if (typeof args.markdown !== 'string') return deniedFrame(rpcId, 'markdown 必须是字符串')
    const existing = args.name === undefined ? undefined : nameOf(args)
    if (args.name !== undefined && existing === undefined) return deniedFrame(rpcId, 'name 非法')
    try {
      const entry = store.save(scope, caller.account, args.markdown, existing)
      deps.runtime.invalidate()
      auditOk(caller, existing === undefined ? 'create' : 'save', { scope, name: entry.name, bytes: entry.bytes })
      return okFrame(rpcId, { item: viewOf(entry) })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'save', { scope, name: existing })
    }
  })

  register(`${SKILLS_PREFIX}/install-md`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    if (scope === undefined) return deniedFrame(rpcId, '参数不完整(scope)')
    if (!canWrite(caller, scope)) {
      auditDeny(caller, 'install-md', 'admin-required', { scope })
      return deniedFrame(rpcId, '共享技能仅管理员可安装')
    }
    if (typeof args.content !== 'string') return deniedFrame(rpcId, 'content 必须是字符串')
    try {
      const entry = store.installMarkdown(scope, caller.account, args.content)
      deps.runtime.invalidate()
      auditOk(caller, 'install-md', { scope, name: entry.name, bytes: entry.bytes })
      return okFrame(rpcId, { item: viewOf(entry) })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'install-md', { scope })
    }
  })

  register(`${SKILLS_PREFIX}/install-zip`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    if (scope === undefined) return deniedFrame(rpcId, '参数不完整(scope)')
    if (!canWrite(caller, scope)) {
      auditDeny(caller, 'install-zip', 'admin-required', { scope })
      return deniedFrame(rpcId, '共享技能仅管理员可安装')
    }
    if (typeof args.dataBase64 !== 'string') return deniedFrame(rpcId, 'dataBase64 必须是字符串')
    const encoded = args.dataBase64
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
      return deniedFrame(rpcId, 'zip 数据不是合法 base64')
    }
    if (encoded.length > Math.ceil(SKILL_LIMITS.zipBytes / 3) * 4 + 8) {
      return deniedFrame(rpcId, `zip 不能超过 ${SKILL_LIMITS.zipBytes / 1024 / 1024}MB`)
    }
    const bytes = Buffer.from(encoded, 'base64')
    try {
      const entry = store.installZip(scope, caller.account, bytes)
      deps.runtime.invalidate()
      auditOk(caller, 'install-zip', { scope, name: entry.name, bytes: entry.bytes })
      return okFrame(rpcId, { item: viewOf(entry) })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'install-zip', { scope })
    }
  })

  register(`${SKILLS_PREFIX}/toggle`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    const name = nameOf(args)
    if (scope === undefined || name === undefined || typeof args.enabled !== 'boolean') {
      return deniedFrame(rpcId, '参数不完整(scope/name/enabled)')
    }
    if (!canWrite(caller, scope)) {
      auditDeny(caller, 'toggle', 'admin-required', { scope, name })
      return deniedFrame(rpcId, '共享技能仅管理员可启停')
    }
    try {
      const entry = store.toggle(scope, caller.account, name, args.enabled)
      deps.runtime.invalidate()
      auditOk(caller, args.enabled ? 'enable' : 'disable', { scope, name, enabled: entry.enabled })
      return okFrame(rpcId, { item: viewOf(entry) })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'toggle', { scope, name })
    }
  })

  register(`${SKILLS_PREFIX}/delete`, (rpcId, args, caller) => {
    const scope = scopeOf(args)
    const name = nameOf(args)
    if (scope === undefined || name === undefined) return deniedFrame(rpcId, '参数不完整(scope/name)')
    if (!canWrite(caller, scope)) {
      auditDeny(caller, 'delete', 'admin-required', { scope, name })
      return deniedFrame(rpcId, '共享技能仅管理员可删除')
    }
    try {
      store.delete(scope, caller.account, name)
      deps.runtime.invalidate()
      auditOk(caller, 'delete', { scope, name })
      return okFrame(rpcId, { removed: true })
    } catch (error) {
      return storeFailure(rpcId, error, caller, deps, 'delete', { scope, name })
    }
  })

  // 技能市场(2026-11-26):来源由 admin 维护;浏览/安装全员,shared 安装仅 admin。
  if (deps.market !== undefined) registerSkillMarketRoutes(deps, register)
}

/** 把 registerSkillsRoutes 挂到 connection.fetch(登录门/信封/401 帧同 MCP 个人层)。 */
export function installSkillsFetchRoutes(deps: SkillsDeps, host: SkillsFetchHost): () => void {
  const disposers: Array<() => void> = []
  let disposed = false
  const register: SkillsRegister = (path, handler) => {
    if (disposed) return
    const dispose = host.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        host.onRequest?.()
        const raw = await request.text()
        let body: unknown
        try {
          body = raw === '' ? undefined : JSON.parse(raw)
        } catch {
          body = undefined
        }
        const unpacked = unpackEnvelope(body)
        if (unpacked === undefined) return new Response('invalid client-request message', { status: 400 })
        const caller = callerOf(deps, request)
        if (caller === undefined) return unauthenticatedFrame(unpacked.rpcId)
        try {
          return await handler(unpacked.rpcId, unpacked.args, caller, request.signal)
        } catch (error) {
          return failureFrame(unpacked.rpcId, error)
        }
      },
    })
    disposers.push(() => { void dispose() })
  }
  registerSkillsRoutes(deps, register)
  return () => {
    disposed = true
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}

// ── 信封/身份/错误帧 ─────────────────────────────────────────────────────

function unpackEnvelope(body: unknown): { rpcId: string; args: Record<string, unknown> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as Record<string, unknown>
  if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') return undefined
  const payload = envelope.payload as Record<string, unknown> | undefined
  const args = payload?.args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { rpcId: envelope.rpcId, args: args as Record<string, unknown> }
}

function callerOf(deps: SkillsDeps, request: Request): SkillsCaller | undefined {
  const claims = deps.session.resolveUser(request.headers.get('cookie') ?? undefined)
  if (claims === undefined) return undefined
  if (deps.passwordVersionOf(claims.userId) !== claims.passwordVersion) return undefined
  const user = deps.userOf(claims.userId)
  if (user === undefined) return undefined
  return { userId: claims.userId, account: user.account, role: user.role }
}

export function frame(rpcId: string, result: unknown): Response {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export function okFrame(rpcId: string, value: unknown): Response {
  return frame(rpcId, { ok: true, value })
}

export function deniedFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'skills/denied', message, details: {} } })
}

function unauthenticatedFrame(rpcId: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/unauthenticated', message: '未登录', details: {} } })
}

function unavailableFrame(rpcId: string): Response {
  return frame(rpcId, {
    ok: false,
    error: { code: 'skills/unavailable', message: '技能存储不可用（共享目录未就绪）', details: {} },
  })
}

function failureFrame(rpcId: string, error: unknown): Response {
  return frame(rpcId, {
    ok: false,
    error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error), details: {} },
  })
}

/** 存储业务错误 → 稳定错误码;未知错误仍走 gateway/internal。 */
function storeFailure(
  rpcId: string,
  error: unknown,
  caller: SkillsCaller,
  deps: SkillsDeps,
  action: string,
  detail: Record<string, unknown>,
): Response {
  if (error instanceof SkillStoreError) {
    deps.audit({
      kind: 'skills.manage',
      account: caller.account,
      ok: false,
      detail: { action, reason: error.code, message: error.message.slice(0, 256), ...detail },
    })
    return frame(rpcId, { ok: false, error: { code: `skills/${error.code}`, message: error.message, details: {} } })
  }
  return failureFrame(rpcId, error)
}
