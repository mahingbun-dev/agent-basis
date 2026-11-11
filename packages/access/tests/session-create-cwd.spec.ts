/**
 * T1(G5 修复):session/create defaultCwd 钳制——不带 workspaceId 且不带 cwd 时,
 * 守卫强制注入 cwd=用户根(上游缺省落宿主 defaultCwd,多用户下即落共享宿主目录)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

describe('T1(G5):session/create defaultCwd 钳制', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let root: string
  let lastCreatePayload: Record<string, unknown> | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-cwd-'))
    store = new UserStore(join(dir, 'users.db'))
    routes = new Map()
    session = new SessionService(Buffer.from('tenant-secret-tenant-secret-000'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    lastCreatePayload = undefined
    const reflect = {
      get: (key: string): unknown => key === 'sessionController'
        ? { create: (request: unknown) => { lastCreatePayload = request as Record<string, unknown>; return { sessionId: 's-new' } } }
        : undefined,
    }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function create(request: Record<string, unknown>) {
    const handler = routes.get('/api/session/create')
    if (handler === undefined) throw new Error('route missing')
    const cookie = `eterna_session=${session.issue({ userId: aliceId, passwordVersion: store.getUserById(aliceId)?.passwordVersion ?? 1 })}`
    const response = await handler.fetch(new Request('http://app.local/api/session/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: 'session/create', payload: { args: { request } } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('完全缺省 → 转交载荷被注入 cwd=用户根(不再落宿主 defaultCwd)', async () => {
    const r = await create({})
    expect(JSON.stringify(r)).not.toContain('tenant/denied')
    expect((lastCreatePayload as { cwd?: string }).cwd).toBe(join(root, 'alice'))
    expect(store.sessionOwner('s-new')).toBe(aliceId)
  })

  it('显式越界 cwd → 拒绝帧(原有钳制保持)', async () => {
    const r = await create({ cwd: '/etc' })
    expect(JSON.stringify(r)).toContain('tenant/denied')
    expect(lastCreatePayload).toBeUndefined()
  })

  it('带 workspaceId 的缺省 cwd → 不注入(cwd 归属由 workspace 决定)', async () => {
    store.recordWorkspace('w-alice', aliceId, join(root, 'alice'))
    const r = await create({ workspaceId: 'w-alice' })
    expect(JSON.stringify(r)).not.toContain('tenant/denied')
    expect(lastCreatePayload?.cwd).toBeUndefined()
  })
})
