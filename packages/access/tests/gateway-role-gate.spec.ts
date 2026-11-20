/**
 * P2-T1.7a(2026-11-11,D1 拍板):网关配置角色门——settingsController 实例 wrap,
 * mutate/update/replace 对 llm-pi-ai ns 仅 admin(invocation principal 判定);
 * 其他 ns 原样;非 eterna-user principal(owner/本地流)放行。
 * 实现形态说明:HTTP /api typert 方法走 gateway interceptor(fetch 路由精确匹配
 * 不命中上游方法),故必须服务实例 wrap——守卫路由形态拦不到(key-leak E2E 实抓)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { ApprovalBridge, type ToolApprovalView } from '../src/approval-bridge.ts'
import { QuestionBridge, type UserQuestionView } from '../src/question-bridge.ts'
import { handleAccessRequest, type AccessDeps } from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'
import { ADMIN_ONLY_STREAM_ACTIONS, ADMIN_ONLY_UNARY_ACTIONS, bindingsFor, visibilityScopeOf } from '../src/mux.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

describe('P2-T1.7a:网关配置角色门(实例 wrap)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let adminId: number
  let userId: number
  let settingsCalls: Array<{ method: string; args: unknown[] }>
  let auditEvents: AccessAuditEvent[]
  let describeValue: unknown
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  interface SettingsControllerStub {
    ctx?: { invocation?: { principal?: { kind?: string; userId?: number } } }
    describe: () => unknown
    mutate: (...args: unknown[]) => unknown
    update: (...args: unknown[]) => unknown
    replace: (...args: unknown[]) => unknown
  }
  let settingsController: SettingsControllerStub & Record<string, unknown>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-gw-role-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('gw-role-secret-gw-role-0000'))
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    userId = user.user.id
    settingsCalls = []
    auditEvents = []
    describeValue = {
      writable: true,
      hasDocument: true,
      namespaces: ['llm-pi-ai', 'mcp-manager', 'permission'].map(ns => ({
        ns, autoGenerate: true, schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
      })),
    }
    settingsController = {
      ctx: {},
      describe: () => describeValue,
      mutate: (_request: unknown) => { settingsCalls.push({ method: 'mutate', args: [_request] }); return { revision: 2 } },
      update: (_request: unknown) => { settingsCalls.push({ method: 'update', args: [_request] }); return { revision: 3 } },
      replace: (_request: unknown) => { settingsCalls.push({ method: 'replace', args: [_request] }); return { revision: 4 } },
    }
    const reflect = {
      get: (key: string): unknown => key === 'settingsController' ? settingsController : undefined,
    }
    routes = new Map()
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: event => auditEvents.push(event) }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function callAs(principal: { kind?: string; userId?: number } | undefined, method: string, ns: string): unknown {
    settingsController.ctx = { invocation: principal === undefined ? {} : { principal } }
    const fn = settingsController[method] as (...args: unknown[]) => unknown
    return fn({ ns, ops: [] })
  }

  /** typert.host 直调形态(位置参数 ns, payload, expectedRevision)——mux/守卫
   *  fetch 路由的真实调用形态;此前的对象 .ns 读法在此形态恒 undefined=静默放行。 */
  function writePositional(principal: { kind?: string; userId?: number } | undefined, method: string, ns: string): unknown {
    settingsController.ctx = { invocation: principal === undefined ? {} : { principal } }
    const fn = settingsController[method] as (...args: unknown[]) => unknown
    return fn(ns, [], 1)
  }

  it('eterna-user(普通用户)写 llm-pi-ai → throw tenant/denied 中文文案+零直调(三方法)', () => {
    for (const method of ['mutate', 'update', 'replace']) {
      expect(() => callAs({ kind: 'eterna-user', userId }, method, 'llm-pi-ai'))
        .toThrow('模型网关配置仅管理员可修改')
      try { callAs({ kind: 'eterna-user', userId }, method, 'llm-pi-ai') } catch (e) {
        expect((e as { code?: string }).code).toBe('tenant/denied')
      }
    }
    expect(settingsCalls).toHaveLength(0)
  })

  it('eterna-user(admin)写 llm-pi-ai → 放行直调(三方法)', () => {
    for (const method of ['mutate', 'update', 'replace']) {
      const r = callAs({ kind: 'eterna-user', userId: adminId }, method, 'llm-pi-ai') as { revision: number }
      expect(r.revision).toBeGreaterThan(0)
    }
    expect(settingsCalls.map(c => c.method).sort()).toEqual(['mutate', 'replace', 'update'])
  })

  it('owner principal(本地流)原样放行(角色门只管 eterna-user)', () => {
    for (const method of ['mutate', 'update', 'replace']) {
      const r = callAs({ kind: 'owner' }, method, 'llm-pi-ai') as { revision: number }
      expect(r.revision).toBeGreaterThan(0)
    }
    expect(settingsCalls).toHaveLength(3)
  })

  it('其他命名空间(用户个人设置)eterna-user 原样代理(不受角色门影响)', () => {
    const r = callAs({ kind: 'eterna-user', userId }, 'mutate', 'permission') as { revision: number }
    expect(r.revision).toBe(2)
    expect(settingsCalls).toHaveLength(1)
  })

  // ── rc.5 B14 系统层:ns 集合 {'llm-pi-ai','mcp-manager'}(2026-11-20,T25) ──

  it('B14:eterna-user 写 mcp-manager(位置参数形态)→ throw tenant/denied+审计+零直调(三方法)', () => {
    for (const method of ['mutate', 'update', 'replace']) {
      expect(() => writePositional({ kind: 'eterna-user', userId }, method, 'mcp-manager'))
        .toThrow('仅管理员可修改')
      try { writePositional({ kind: 'eterna-user', userId }, method, 'mcp-manager') } catch (e) {
        expect((e as { code?: string }).code).toBe('tenant/denied')
      }
    }
    expect(settingsCalls).toHaveLength(0)
    const denied = auditEvents.filter(e => e.detail?.action === 'gateway.settings.denied')
    expect(denied.length).toBeGreaterThanOrEqual(3)
    for (const event of denied) {
      expect(event.detail).toMatchObject({ ns: 'mcp-manager' })
      expect(event.account).toBe('alice')
    }
  })

  it('B14:eterna-user 写 mcp-manager(对象形态回归)→ 同样拒绝', () => {
    expect(() => callAs({ kind: 'eterna-user', userId }, 'mutate', 'mcp-manager'))
      .toThrow('系统 MCP 服务器配置仅管理员可修改')
    expect(settingsCalls).toHaveLength(0)
  })

  it('B14:eterna-user(admin)/owner principal 写 mcp-manager → 放行(门只收窄 non-admin eterna-user)', () => {
    for (const method of ['mutate', 'update', 'replace']) {
      const r = writePositional({ kind: 'eterna-user', userId: adminId }, method, 'mcp-manager') as { revision: number }
      expect(r.revision).toBeGreaterThan(0)
    }
    for (const method of ['mutate', 'update', 'replace']) {
      const r = writePositional({ kind: 'owner' }, method, 'mcp-manager') as { revision: number }
      expect(r.revision).toBeGreaterThan(0)
    }
    expect(settingsCalls).toHaveLength(6)
  })

  it('B14:describe 面非 admin 过滤 mcp-manager ns,其余命名空间与顶层字段原样', () => {
    settingsController.ctx = { invocation: { principal: { kind: 'eterna-user', userId } } }
    const asUser = settingsController.describe() as { writable: boolean; hasDocument: boolean; namespaces: Array<{ ns: string }> }
    expect(asUser.namespaces.map(n => n.ns)).toEqual(['llm-pi-ai', 'permission'])
    expect(asUser.writable).toBe(true)
    expect(asUser.hasDocument).toBe(true)
    // admin / owner(本地流)看到全量
    settingsController.ctx = { invocation: { principal: { kind: 'eterna-user', userId: adminId } } }
    expect((settingsController.describe() as { namespaces: Array<{ ns: string }> }).namespaces.map(n => n.ns))
      .toEqual(['llm-pi-ai', 'mcp-manager', 'permission'])
    settingsController.ctx = { invocation: { principal: { kind: 'owner' } } }
    expect((settingsController.describe() as { namespaces: Array<{ ns: string }> }).namespaces.map(n => n.ns))
      .toContain('mcp-manager')
  })

  it('B14:describe 形状漂移(上游改字段)→ 非 admin fail-closed 空清单,不原样透出', () => {
    describeValue = { writable: true, hasDocument: true, namespaces: 'drifted' }
    settingsController.ctx = { invocation: { principal: { kind: 'eterna-user', userId } } }
    expect(settingsController.describe()).toEqual({ writable: true, hasDocument: true, namespaces: [] })
    // admin 不受影响(透传原值)
    settingsController.ctx = { invocation: { principal: { kind: 'eterna-user', userId: adminId } } }
    expect(settingsController.describe()).toEqual({ writable: true, hasDocument: true, namespaces: 'drifted' })
  })
})


describe('P2-T1.7a:守卫 fetch 路由层(HTTP cookie 判角色)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let adminId: number
  let userId: number
  let settingsCalls: Array<{ method: string; args: unknown[] }>
  let auditEvents: AccessAuditEvent[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-gw-role-http-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('gw-role-http-secret-gw-role-00'))
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    userId = user.user.id
    settingsCalls = []
    auditEvents = []
    routes = new Map()
    const reflect = {
      get: (key: string): unknown => key === 'settingsController'
        ? {
          // 直调签名=位置参数(...args)(typert.host);全量捕获供转发形状断言。
          describe: () => ({
            writable: true,
            hasDocument: true,
            namespaces: ['llm-pi-ai', 'mcp-manager', 'permission'].map(ns => ({
              ns, autoGenerate: true, schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
            })),
          }),
          mutate: (...callArgs: unknown[]) => { settingsCalls.push({ method: 'mutate', args: callArgs }); return { revision: 2 } },
          update: (...callArgs: unknown[]) => { settingsCalls.push({ method: 'update', args: callArgs }); return { revision: 3 } },
          replace: (...callArgs: unknown[]) => { settingsCalls.push({ method: 'replace', args: callArgs }); return { revision: 4 } },
        }
        : undefined,
    }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: event => auditEvents.push(event) }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  // wire 载荷形状照抄浏览器 typert 代理(参数名即 descriptor):mutate=ops /
  // update=patch / replace=section;expectedRevision 数字或缺席。
  const payloadOf = (path: string, ns: string): Record<string, unknown> => {
    const method = path.split('/').pop() ?? ''
    const revision = { expectedRevision: 7 }
    if (method === 'update') return { ns, patch: { selectedDefault: 'cordis' }, ...revision }
    if (method === 'replace') return { ns, section: { selectedDefault: 'cordis' }, ...revision }
    return { ns, ops: [{ op: 'set', path: ['defaultPreset'], value: 'cordis' }], ...revision }
  }

  async function settingsWrite(path: string, account: 'root' | 'alice' | undefined, ns: string) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route missing: ${path}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (account !== undefined) {
      const uid = account === 'root' ? adminId : userId
      headers.cookie = `eterna_session=${session.issue({ userId: uid, passwordVersion: store.getUserById(uid)?.passwordVersion ?? 1 })}`
    }
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: payloadOf(path, ns) } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('普通用户写 llm-pi-ai → 拒绝帧+零直调(三路)', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'alice', 'llm-pi-ai')
      expect((r.result as { error?: { code?: string; message?: string } }).error).toMatchObject({ code: 'tenant/denied' })
      expect((r.result as { error?: { message?: string } }).error?.message).toContain('仅管理员可修改')
    }
    expect(settingsCalls).toHaveLength(0)
  })

  it('admin 写 llm-pi-ai → 代理直调(三路);其他 ns 普通用户原样代理', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'root', 'llm-pi-ai')
      expect((r.result as { ok?: boolean }).ok).toBe(true)
    }
    expect(settingsCalls).toHaveLength(3)
    const other = await settingsWrite('/api/settings/mutate', 'alice', 'permission')
    expect((other.result as { ok?: boolean }).ok).toBe(true)
    expect(settingsCalls).toHaveLength(4)
  })

  it('2026-11-12 回归:update/replace 载荷键名随 descriptor 转发,不再丢成 undefined', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'root', 'agent-preset-registry')
      expect((r.result as { ok?: boolean }).ok).toBe(true)
    }
    // 三路转发形状(ns, 载荷, expectedRevision):update 收 patch、replace 收 section、
    // mutate 收 ops;曾统一取 ops → settings.update(ns, undefined) 在 settings 侧
    // cloneJsonShaped 抛「Config $ contains a non-plain root」(用户报障原文)。
    expect(settingsCalls.map(c => c.method)).toEqual(['mutate', 'update', 'replace'])
    const [mutate, update, replace] = settingsCalls
    expect(mutate?.args).toEqual(['agent-preset-registry', [{ op: 'set', path: ['defaultPreset'], value: 'cordis' }], 7])
    expect(update?.args).toEqual(['agent-preset-registry', { selectedDefault: 'cordis' }, 7])
    expect(replace?.args).toEqual(['agent-preset-registry', { selectedDefault: 'cordis' }, 7])
  })

  // ── rc.5 B14 系统层:HTTP 层的 ns 门 + describe 过滤(2026-11-20,T25) ──

  async function settingsDescribe(account: 'root' | 'alice' | undefined) {
    const handler = routes.get('/api/settings/describe')
    if (handler === undefined) throw new Error('route missing: /api/settings/describe')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (account !== undefined) {
      const uid = account === 'root' ? adminId : userId
      headers.cookie = `eterna_session=${session.issue({ userId: uid, passwordVersion: store.getUserById(uid)?.passwordVersion ?? 1 })}`
    }
    const response = await handler.fetch(new Request('http://app.local/api/settings/describe', {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: 'settings/describe', payload: { args: {} } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('B14:普通用户写 mcp-manager → 拒绝帧+审计+零直调(三路)', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'alice', 'mcp-manager')
      expect((r.result as { error?: { code?: string; message?: string } }).error).toMatchObject({ code: 'tenant/denied' })
      expect((r.result as { error?: { message?: string } }).error?.message).toContain('仅管理员可修改')
    }
    expect(settingsCalls).toHaveLength(0)
    const denied = auditEvents.filter(e => e.detail?.action === 'gateway.settings.denied')
    expect(denied).toHaveLength(3)
    for (const event of denied) expect(event.detail).toMatchObject({ ns: 'mcp-manager' })
  })

  it('B14:admin 写 mcp-manager → 代理直调(三路);普通用户仍可写其他 ns', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'root', 'mcp-manager')
      expect((r.result as { ok?: boolean }).ok).toBe(true)
    }
    expect(settingsCalls).toHaveLength(3)
    const other = await settingsWrite('/api/settings/mutate', 'alice', 'permission')
    expect((other.result as { ok?: boolean }).ok).toBe(true)
    expect(settingsCalls).toHaveLength(4)
  })

  it('B14:describe 面非 admin 过滤 mcp-manager(HTTP cookie 判角色);admin 全量;未登录 401 帧', async () => {
    const asUser = await settingsDescribe('alice')
    const userValue = (asUser.result as { ok?: boolean; value?: { namespaces: Array<{ ns: string }> } }).value
    expect((asUser.result as { ok?: boolean }).ok).toBe(true)
    expect(userValue?.namespaces.map(n => n.ns)).toEqual(['llm-pi-ai', 'permission'])
    const asAdmin = await settingsDescribe('root')
    expect((asAdmin.result as { value?: { namespaces: Array<{ ns: string }> } }).value?.namespaces.map(n => n.ns))
      .toEqual(['llm-pi-ai', 'mcp-manager', 'permission'])
    const anonymous = await settingsDescribe(undefined)
    expect((anonymous.result as { error?: { code?: string } }).error).toMatchObject({ code: 'tenant/unauthenticated' })
  })
})


/**
 * WS-C(37 号 §3 M-4,M1 段):审批人角色门——三角色对现有数据面的响应体 JSON
 * 特征字段断言(禁全页文本子串断言,33 号 G2-C3 引 docs/USER-GUIDE.md:50-51 纪律)。
 * M3 段待人项三档断言见下方「WS-C 待人项可见性三档」describe(37 号 M-4「同文件扩」)。
 */
describe('WS-C 审批人角色门(M-4 M1 段)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let now: number
  let adminId: number
  let approverId: number
  let userId: number
  let adminCookie: string
  let approverCookie: string
  let userCookie: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-wsc-role-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('wsc-role-secret-wsc-role-secret0'))
    auditEvents = []
    now = 1_000_000
    deps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000, () => now),
      globalWindow: new SlidingWindow(30, 60_000, () => now),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
      provisionWorkspace: async () => {},
    }
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const approver = store.createUserWithSuffix({ account: 'auditor', password: 'password8', role: 'approver' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    approverId = approver.user.id
    userId = user.user.id
    // 三角色各持同构资源面(1 session + 1 workspace)——② 同构断言的对照组
    store.recordSession(`s-${adminId}`, adminId, null)
    store.recordWorkspace(`w-${adminId}`, adminId, join(dir, 'root'))
    store.recordSession(`s-${approverId}`, approverId, null)
    store.recordWorkspace(`w-${approverId}`, approverId, join(dir, 'auditor'))
    store.recordSession(`s-${userId}`, userId, null)
    store.recordWorkspace(`w-${userId}`, userId, join(dir, 'alice'))
    adminCookie = login('root')
    approverCookie = login('auditor')
    userCookie = login('alice')
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function login(account: string): string {
    const reply = handleAccessRequest(deps, {
      method: 'POST', pathname: '/login', cookie: undefined, origin: undefined,
      host: 'localhost:3210', xff: undefined, contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ account, password: 'password8' })),
    })
    expect(reply.status).toBe(200)
    return reply.headers.find(([name]) => name === 'set-cookie')?.[1] ?? ''
  }

  function call(overrides: Partial<{ method: string; pathname: string; cookie?: string; body?: Buffer }>) {
    const reply = handleAccessRequest(deps, {
      method: overrides.method ?? 'GET', pathname: overrides.pathname ?? '/', cookie: overrides.cookie,
      origin: undefined, host: 'localhost:3210', xff: undefined, contentType: 'application/json',
      body: overrides.body,
    })
    const body = typeof reply.body === 'string' ? JSON.parse(reply.body) as Record<string, unknown> : {}
    return { status: reply.status, body }
  }

  it('① /access/api/me:三角色 role 字段正确(JSON 特征字段)', () => {
    expect(call({ pathname: '/access/api/me', cookie: adminCookie }).body).toMatchObject({ account: 'root', role: 'admin' })
    expect(call({ pathname: '/access/api/me', cookie: approverCookie }).body).toMatchObject({ account: 'auditor', role: 'approver' })
    expect(call({ pathname: '/access/api/me', cookie: userCookie }).body).toMatchObject({ account: 'alice', role: 'user' })
  })

  it('② bindingsFor:三角色内容绑定同构(仅本人资源,零放宽不变式)', () => {
    const muxDeps = { store, session }
    const shapeOf = (id: number) => {
      const bindings = bindingsFor(muxDeps, id)
      return {
        kinds: bindings.map(b => b.resource.kind),
        roleNames: bindings.map(b => b.role.name),
        actions: bindings.map(b => [...b.role.actions].sort()),
        // T6.1/B14:管理员专属门(插件页 UI 门 + 系统 MCP 流门)只收窄不放宽——剥离后比内容面,
        // 与 mux-policy 的 contentView 同口径。
        contentActions: bindings.map(b => b.role.actions
          .filter(a => !ADMIN_ONLY_UNARY_ACTIONS.includes(a) && !ADMIN_ONLY_STREAM_ACTIONS.includes(a))
          .sort()),
        sessionIds: bindings.filter(b => b.resource.kind === 'session').map(b => (b.resource as { id: string }).id),
        workspaceIds: bindings.filter(b => b.resource.kind === 'workspace').map(b => (b.resource as { id: string }).id),
      }
    }
    const admin = shapeOf(adminId)
    const approver = shapeOf(approverId)
    const user = shapeOf(userId)
    // 结构逐项全等(角色名/动作清单/kind 序列);资源 id 各归各人
    expect(approver.kinds).toEqual(user.kinds)
    expect(approver.roleNames).toEqual(user.roleNames)
    expect(approver.actions).toEqual(user.actions)
    expect(approver.contentActions).toEqual(user.contentActions)
    expect(admin.kinds).toEqual(user.kinds)
    expect(admin.roleNames).toEqual(user.roleNames)
    expect(admin.contentActions).toEqual(user.contentActions)
    // 唯一角色分派面(收窄):admin 多插件页整页门,非 admin 无——不得反向放宽
    expect(admin.actions.flat().join(' ')).toContain('pluginManager/listBundles')
    expect(user.actions.flat()).not.toContain('pluginManager/listBundles')
    // 审批人仅见本人 session/workspace(不因 tenant-pending 档放宽 mux 内容绑定)
    expect(approver.sessionIds).toEqual([`s-${approverId}`])
    expect(approver.workspaceIds).toEqual([`w-${approverId}`])
    expect(approver.sessionIds).not.toContain(`s-${userId}`)
    expect(approver.workspaceIds).not.toContain(`w-${adminId}`)
  })

  it('③ admin 面端点对 approver 403:用户列表/建号/删号/角色变更/插件启停(审批人≠管理员)', () => {
    expect(call({ pathname: '/access/api/users', cookie: approverCookie }).status).toBe(403)
    expect(call({ method: 'POST', pathname: '/access/api/users', cookie: approverCookie, body: Buffer.from('{"account":"x1","password":"password8"}') }).status).toBe(403)
    expect(call({ method: 'DELETE', pathname: `/access/api/users/${userId}`, cookie: approverCookie }).status).toBe(403)
    expect(call({ method: 'POST', pathname: `/access/api/users/${userId}/role`, cookie: approverCookie, body: Buffer.from('{"role":"user"}') }).status).toBe(403)
    expect(call({ pathname: '/access/api/plugins', cookie: approverCookie }).status).toBe(403)
    expect(call({ method: 'POST', pathname: '/access/api/plugins/eterna-memory/disable', cookie: approverCookie }).status).toBe(403)
  })
})


/**
 * WS-C 待人项可见性三档(37 号 §3 M-4 M3 段;33 G2-C3「审批人见全租户待人项;
 * 普通用户仅自己的工单/会话;管理员全量——三角色断言走响应体 JSON 特征字段」)。
 *
 * 断言对象口径(37 号 §7 缺口 1 如实登记):WS-D 工作台待人项端点今日不存在
 * (mux.ts:194「上游流方法表无任何 person/* 待人端点」;packages/access/src/routes.ts
 * 无工作台数据面)——本文件把三档断言钉在今日真实存在的三个 access 面:
 *  ① 三档谓词 × 账本闭环:`visibilityScopeOf`(mux.ts:185,30 §4.5 的 access 单真值)
 *     对 store 实际角色行逐档断言;角色变更即档位翻转——37 号 §8「工作台(WS-D)
 *     待人项实接时,其数据端点消费 visibilityScopeOf 与本批角色模型」的消费契约;
 *  ② 既有两个待人面(tool-pending/questions-pending)三档本人-only:tenant-pending/all
 *     档**不放宽**这两面(37 号 §7 缺口 2 fail-closed 拍板现状),跨用户裁决/作答一律
 *     404——桥内归属校验(approval-bridge.ts:117/question-bridge.ts:261)与角色无关;
 *  ③ 档位翻转即时 + mux 内容绑定零放宽(M-2 不变式在角色门视角的翻转时点复述)。
 * WS-D 端点落地后,三档断言按缺口 1 拍板的字段名扩进 E2E 脚本
 * (packages/access/scripts/verify-visibility-e2e.mjs,verify-governance-e2e 模式)。
 */
describe('WS-C 待人项可见性三档(M-4 M3 段,G2-C3/G2-C5)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let now: number
  let adminId: number
  let approverId: number
  let userId: number
  let adminCookie: string
  let approverCookie: string
  let userCookie: string
  let aliceApprovalId: string
  let aliceQuestionId: string
  let approverApprovalId: string
  let approverQuestionId: string

  /** 捕获桥答者的 register 形(installAnswerer 的 register 参数;approval-bridge.spec 同构)。 */
  let approvalListener: ((request: unknown, next: () => unknown) => unknown) | undefined
  let questionListener: ((request: unknown, next: () => unknown) => unknown) | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-wsc-pending-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('wsc-pending-secret-wsc-pending0'))
    auditEvents = []
    now = 1_000_000
    // 真 桥(非桩):归属真值=store.sessionOwner(plugin.ts:167-180 同款接线),
    // 档位可见性行为断言跑在生产代码路径上。
    const approvalBridge = new ApprovalBridge({
      sessionOwner: id => store.sessionOwner(id),
      audit: event => auditEvents.push(event),
      timeoutMs: 60_000,
    })
    const questionBridge = new QuestionBridge({
      sessionOwner: id => store.sessionOwner(id),
      audit: event => auditEvents.push(event),
      timeoutMs: 60_000,
    })
    // register 契约=返回 disposer(answerer 注册面);测试只捕获 listener,disposer 空实现。
    approvalBridge.installAnswerer((register) => { approvalListener = register; return () => {} })
    questionBridge.installAnswerer((register) => { questionListener = register; return () => {} })
    deps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000, () => now),
      globalWindow: new SlidingWindow(30, 60_000, () => now),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
      provisionWorkspace: async () => {},
      approvalBridge,
      questionBridge,
    }
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const approver = store.createUserWithSuffix({ account: 'auditor', password: 'password8', role: 'approver' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    approverId = approver.user.id
    userId = user.user.id
    // 会话归属账本:三人各持一会话(store.sessionOwner 真值;mock 工单 realm 钳制的
    // access 侧同构物——30 §4.5「工作台数据按 access realm 钳制」的归属底座)。
    store.recordSession('s-root', adminId, null)
    store.recordSession('s-auditor', approverId, null)
    store.recordSession('s-alice', userId, null)
    // 种两单:alice(普通用户)与 auditor(审批人)各持一条待人审批+待答提问——
    // 跨档过滤断言需要「列表非空且互不可见」,空表断言无法区分「过滤生效」与「无数据」。
    aliceApprovalId = seedApproval('s-alice')
    approverApprovalId = seedApproval('s-auditor')
    aliceQuestionId = seedQuestion('s-alice')
    approverQuestionId = seedQuestion('s-auditor')
    adminCookie = login('root')
    approverCookie = login('auditor')
    userCookie = login('alice')
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** 经捕获的答者登记一条待人审批(真桥 #pending;返回 JSON 特征字段 id)。 */
  function seedApproval(sessionId: string): string {
    const promise = approvalListener?.(
      { toolName: 'working_directory', callId: `call-${sessionId}`, reason: '治理策略要求人工确认', agent: { session: { id: sessionId } } },
      () => 'unavailable',
    ) as Promise<unknown>
    expect(promise).toBeInstanceOf(Promise)
    const view = (deps.approvalBridge?.listFor(store.sessionOwner(sessionId) ?? -1) ?? [])
      .find(item => item.sessionId === sessionId)
    expect(view).toBeDefined()
    return (view as ToolApprovalView).id
  }

  /** 经捕获的答者登记一张待答提问(单问即可;skip 语义验证不依赖问题数)。 */
  function seedQuestion(sessionId: string): string {
    const promise = questionListener?.(
      {
        questions: [{ id: 'topic', question: '这次要检索的主题是什么?', options: [{ label: 'A' }, { label: 'B' }] }],
        agent: { session: { id: sessionId } },
      },
      () => 'unavailable',
    ) as Promise<unknown>
    expect(promise).toBeInstanceOf(Promise)
    const view = (deps.questionBridge?.listFor(store.sessionOwner(sessionId) ?? -1) ?? [])
      .find(item => item.sessionId === sessionId)
    expect(view).toBeDefined()
    return (view as UserQuestionView).id
  }

  function login(account: string): string {
    const reply = handleAccessRequest(deps, {
      method: 'POST', pathname: '/login', cookie: undefined, origin: undefined,
      host: 'localhost:3210', xff: undefined, contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ account, password: 'password8' })),
    })
    expect(reply.status).toBe(200)
    return reply.headers.find(([name]) => name === 'set-cookie')?.[1] ?? ''
  }

  function call(overrides: Partial<{ method: string; pathname: string; cookie?: string; body?: Buffer }>) {
    const reply = handleAccessRequest(deps, {
      method: overrides.method ?? 'GET', pathname: overrides.pathname ?? '/', cookie: overrides.cookie,
      origin: undefined, host: 'localhost:3210', xff: undefined, contentType: 'application/json',
      body: overrides.body,
    })
    const body = typeof reply.body === 'string' ? JSON.parse(reply.body) as Record<string, unknown> : {}
    return { status: reply.status, body }
  }

  const sessionIdsOf = (body: { items?: Array<{ sessionId?: string }> }): string[] =>
    (body.items ?? []).map(item => item.sessionId ?? '')

  it('① 三档谓词×账本:store 角色行逐档映射;角色变更即档位翻转(WS-D 消费契约)', () => {
    // 三档映射从账本实读(非字面量直呼)——30 §4.5「工作台数据按 access realm 钳制」
    // 的 access 单真值;unknown 值 fail-closed 判 self(mux.ts:190)。
    expect(visibilityScopeOf(store.getUserById(userId)!.role)).toBe('self')
    expect(visibilityScopeOf(store.getUserById(approverId)!.role)).toBe('tenant-pending')
    expect(visibilityScopeOf(store.getUserById(adminId)!.role)).toBe('all')
    // 分配→可见性变化闭环(G2-C5,账本侧):user→approver 即 tenant-pending,收回即 self。
    store.setUserRole(userId, 'approver')
    expect(visibilityScopeOf(store.getUserById(userId)!.role)).toBe('tenant-pending')
    store.setUserRole(userId, 'user')
    expect(visibilityScopeOf(store.getUserById(userId)!.role)).toBe('self')
  })

  it('② 普通用户(self 档):两面均只见本人条目(JSON 特征字段);本人裁决后条目消失', () => {
    const toolPending = call({ pathname: '/access/api/approvals/tool-pending', cookie: userCookie }).body as { items?: ToolApprovalView[] }
    expect(sessionIdsOf(toolPending)).toEqual(['s-alice'])
    expect(toolPending.items?.[0]?.id).toBe(aliceApprovalId)
    const questionPending = call({ pathname: '/access/api/questions/pending', cookie: userCookie }).body as { items?: UserQuestionView[] }
    expect(sessionIdsOf(questionPending)).toEqual(['s-alice'])
    expect(questionPending.items?.[0]?.id).toBe(aliceQuestionId)
    // 本人裁决正控:条目真实可决,且裁决后即从本人列表消失(可见性闭环)。
    const decided = call({
      method: 'POST', pathname: '/access/api/approvals/tool-decide', cookie: userCookie,
      body: Buffer.from(JSON.stringify({ id: aliceApprovalId, allow: true })),
    })
    expect(decided.status).toBe(200)
    expect(decided.body).toMatchObject({ ok: true })
    const answered = call({
      method: 'POST', pathname: '/access/api/questions/answer', cookie: userCookie,
      body: Buffer.from(JSON.stringify({ id: aliceQuestionId, skip: true })),
    })
    expect(answered.status).toBe(200)
    expect(call({ pathname: '/access/api/approvals/tool-pending', cookie: userCookie }).body).toMatchObject({ items: [] })
    expect(call({ pathname: '/access/api/questions/pending', cookie: userCookie }).body).toMatchObject({ items: [] })
  })

  it('② 审批人(tenant-pending 档)不放宽既有两面:见本人、不见他人;跨用户裁决 404(缺口 2 fail-closed)', () => {
    // 「审批人全租户待人」(30 §4.5)作用对象=WS-D 工作台数据面(端点今日不存在,
    // 缺口 1);既有插件审批面/提问面按 37 号 §7 缺口 2 维持本人-only——
    // 审批人看到自己的条目,但他人的条目不可见、不可决。
    const toolPending = call({ pathname: '/access/api/approvals/tool-pending', cookie: approverCookie }).body as { items?: ToolApprovalView[] }
    expect(sessionIdsOf(toolPending)).toEqual(['s-auditor'])
    expect(toolPending.items?.[0]?.id).toBe(approverApprovalId)
    expect(sessionIdsOf(toolPending)).not.toContain('s-alice')
    const questionPending = call({ pathname: '/access/api/questions/pending', cookie: approverCookie }).body as { items?: UserQuestionView[] }
    expect(sessionIdsOf(questionPending)).toEqual(['s-auditor'])
    expect(questionPending.items?.[0]?.id).toBe(approverQuestionId)
    // 跨用户裁决/作答:桥内归属校验拒之(approval-bridge.ts:119;question-bridge.ts:261)。
    const decided = call({
      method: 'POST', pathname: '/access/api/approvals/tool-decide', cookie: approverCookie,
      body: Buffer.from(JSON.stringify({ id: aliceApprovalId, allow: true })),
    })
    expect(decided.status).toBe(404)
    expect(decided.body).toMatchObject({ error: '审批不存在、已收场或不属于你' })
    const answered = call({
      method: 'POST', pathname: '/access/api/questions/answer', cookie: approverCookie,
      body: Buffer.from(JSON.stringify({ id: aliceQuestionId, skip: true })),
    })
    expect(answered.status).toBe(404)
    expect(answered.body).toMatchObject({ error: '提问不存在、已结束或不属于你' })
    // 拒绝即零副作用:alice 的条目仍在(不是「裁掉了再说不可见」)。
    expect(sessionIdsOf(call({ pathname: '/access/api/approvals/tool-pending', cookie: userCookie }).body as { items?: ToolApprovalView[] }))
      .toEqual(['s-alice'])
  })

  it('② 管理员(all 档)不放宽既有两面:本人零条目;他人条目不可见不可决(缺口 2 fail-closed)', () => {
    // 「管理员全量」(30 §4.5)同为 WS-D 工作台数据语义;root 未持任何待人项,
    // 两面返回空表——不是全租户聚合(缺口 2)。
    const toolPending = call({ pathname: '/access/api/approvals/tool-pending', cookie: adminCookie }).body as { items?: ToolApprovalView[] }
    expect(toolPending).toMatchObject({ items: [] })
    const questionPending = call({ pathname: '/access/api/questions/pending', cookie: adminCookie }).body as { items?: UserQuestionView[] }
    expect(questionPending).toMatchObject({ items: [] })
    const decided = call({
      method: 'POST', pathname: '/access/api/approvals/tool-decide', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ id: aliceApprovalId, allow: true })),
    })
    expect(decided.status).toBe(404)
    const answered = call({
      method: 'POST', pathname: '/access/api/questions/answer', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ id: approverQuestionId, skip: true })),
    })
    expect(answered.status).toBe(404)
  })

  it('③ 档位翻转即时:mux 内容绑定零放宽不变式在 tenant-pending 档仍成立(M-2 不变式翻转时点)', () => {
    store.setUserRole(userId, 'approver')
    const muxDeps = { store, session }
    const bindings = bindingsFor(muxDeps, userId)
    // 档位已入 tenant-pending,但内容绑定仍仅本人 session/workspace(30 §7-3 只授权
    // 工作台待人项数据面,mux 内容流无放宽依据——37 号 §7 缺口 3)。
    expect(bindings.filter(binding => binding.resource.kind === 'session').map(binding => (binding.resource as { id: string }).id))
      .toEqual(['s-alice'])
    expect(bindings.filter(binding => binding.resource.kind === 'workspace').map(binding => (binding.resource as { id: string }).id))
      .toEqual([])
    // 面上同句柄再证:approver 档下本人待答面照常可达(角色读取每请求现查,不缓存)。
    const questionPending = call({ pathname: '/access/api/questions/pending', cookie: userCookie }).body as { items?: UserQuestionView[] }
    expect(sessionIdsOf(questionPending)).toEqual(['s-alice'])
  })
})
