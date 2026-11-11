/**
 * P2-T1.7a(2026-11-11,D1 拍板):网关配置角色门——settings 写三路(mutate/update/replace)
 * 对 llm-pi-ai ns 仅 admin;普通用户拒绝帧;其他 ns 原样代理。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

describe('P2-T1.7a:网关配置角色门', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let adminId: number
  let userId: number
  let settingsCalls: Array<{ method: string; params: unknown }>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-gw-role-'))
    store = new UserStore(join(dir, 'users.db'))
    routes = new Map()
    session = new SessionService(Buffer.from('gw-role-secret-gw-role-0000'))
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    userId = user.user.id
    settingsCalls = []
    const reflect = {
      get: (key: string): unknown => key === 'settingsController'
        ? {
          mutate: (request: unknown) => { settingsCalls.push({ method: 'mutate', params: request }); return { revision: 2 } },
          update: (request: unknown) => { settingsCalls.push({ method: 'update', params: request }); return { revision: 3 } },
          replace: (request: unknown) => { settingsCalls.push({ method: 'replace', params: request }); return { revision: 4 } },
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
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: { request: { ns, ops: [] } } } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('普通用户写 llm-pi-ai ns → 拒绝帧(中文文案)+零直调(三路全拒)', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'alice', 'llm-pi-ai')
      expect((r.result as { error?: { code?: string; message?: string } }).error).toMatchObject({ code: 'tenant/denied' })
      expect((r.result as { error?: { message?: string } }).error?.message).toContain('仅管理员可修改')
    }
    expect(settingsCalls).toHaveLength(0)
  })

  it('admin 写 llm-pi-ai ns → 直调控制器放行(三路)', async () => {
    for (const path of ['/api/settings/mutate', '/api/settings/update', '/api/settings/replace']) {
      const r = await settingsWrite(path, 'root', 'llm-pi-ai')
      expect((r.result as { ok?: boolean }).ok).toBe(true)
    }
    expect(settingsCalls.map(c => c.method).sort()).toEqual(['mutate', 'replace', 'update'])
  })

  it('其他命名空间(用户个人设置)普通用户原样代理(不受角色门影响)', async () => {
    const r = await settingsWrite('/api/settings/mutate', 'alice', 'permission')
    expect((r.result as { ok?: boolean }).ok).toBe(true)
    expect(settingsCalls).toHaveLength(1)
  })

  it('key 不回传断言面:守卫层不新增任何回显配置值的端点(读路径未触碰)', () => {
    // 结构断言:三写路由已注册;读路由(describe/openSettingsDocument)未被包装
    expect(routes.has('/api/settings/mutate')).toBe(true)
    expect(routes.has('/api/settings/update')).toBe(true)
    expect(routes.has('/api/settings/replace')).toBe(true)
    expect(routes.has('/api/settings/describe')).toBe(false)
    expect(routes.has('/api/settings/openSettingsDocument')).toBe(false)
  })
})
