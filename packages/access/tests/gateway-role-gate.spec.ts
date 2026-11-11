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
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

describe('P2-T1.7a:网关配置角色门(实例 wrap)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let adminId: number
  let userId: number
  let settingsCalls: Array<{ method: string }>
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  interface SettingsControllerStub {
    ctx?: { invocation?: { principal?: { kind?: string; userId?: number } } }
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
    settingsController = {
      ctx: {},
      mutate: (_request: unknown) => { settingsCalls.push({ method: 'mutate' }); return { revision: 2 } },
      update: (_request: unknown) => { settingsCalls.push({ method: 'update' }); return { revision: 3 } },
      replace: (_request: unknown) => { settingsCalls.push({ method: 'replace' }); return { revision: 4 } },
    }
    const reflect = {
      get: (key: string): unknown => key === 'settingsController' ? settingsController : undefined,
    }
    routes = new Map()
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: () => {} }, { fetch: registry })
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
})


describe('P2-T1.7a:守卫 fetch 路由层(HTTP cookie 判角色)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let adminId: number
  let userId: number
  let settingsCalls: Array<{ method: string }>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-gw-role-http-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('gw-role-http-secret-gw-role-00'))
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    userId = user.user.id
    settingsCalls = []
    routes = new Map()
    const reflect = {
      get: (key: string): unknown => key === 'settingsController'
        ? {
          mutate: (_request: unknown) => { settingsCalls.push({ method: 'mutate' }); return { revision: 2 } },
          update: (_request: unknown) => { settingsCalls.push({ method: 'update' }); return { revision: 2 } },
          replace: (_request: unknown) => { settingsCalls.push({ method: 'replace' }); return { revision: 2 } },
        }
        : undefined,
    }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

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
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: { ns, ops: [] } } }),
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
})
