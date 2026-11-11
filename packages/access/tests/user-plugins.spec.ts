/**
 * P4-T6:双层插件记账与操作权限 + T8 级联销毁(user_plugins 清行)。
 * id 前缀强制 user:<account>:<name>;dir 钳 <userRoot>/plugins/;跨用户操作拒。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'
import { personalPluginId } from '../src/user-plugins.ts'

describe('P4-T6:个人插件记账(id 前缀与目录钳制)', () => {
  it('personalPluginId:合法名生成 user:account:name;非法名(含 / 空)undefined', () => {
    expect(personalPluginId('alice', 'hello')).toBe('user:alice:hello')
    expect(personalPluginId('alice', '../etc')).toBeUndefined()
    expect(personalPluginId('alice', '')).toBeUndefined()
    expect(personalPluginId('alice', 'a/b')).toBeUndefined()
  })
})

describe('P4-T6:插件端点权限矩阵', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let bobId: number
  let root: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-uplug-'))
    store = new UserStore(join(dir, 'users.db'))
    routes = new Map()
    session = new SessionService(Buffer.from('uplug-secret-uplug-secret-000'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    mkdirSync(join(root, 'alice', 'plugins', 'hello'), { recursive: true })
    const reflect = { get: (): unknown => undefined }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function call(path: string, account: 'alice' | 'bob' | undefined, payloadArgs: Record<string, unknown>) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route missing: ${path}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (account !== undefined) {
      const uid = account === 'alice' ? aliceId : bobId
      headers.cookie = `eterna_session=${session.issue({ userId: uid, passwordVersion: store.getUserById(uid)?.passwordVersion ?? 1 })}`
    }
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path, payload: { args: payloadArgs } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('install:本人合法目录记账+id 前缀生成', async () => {
    const r = await call('/access/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    expect((r.result as { value?: { pluginId: string } }).value?.pluginId).toBe('user:alice:hello')
    expect(store.userPluginOwner('user:alice:hello')).toBe(aliceId)
  })

  it('list:本人只见自己;enable/disable/remove 仅本人;跨用户操作拒', async () => {
    await call('/access/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    const list = await call('/access/api/my-plugins/list', 'alice', {})
    const items = (list.result as { value?: { items?: Array<{ pluginId: string }> } }).value?.items ?? []
    expect(items.map(i => i.pluginId)).toEqual(['user:alice:hello'])
    // bob 操作 alice 的插件 → 拒
    for (const op of ['enable', 'disable', 'remove']) {
      const r = await call(`/access/api/my-plugins/${op}`, 'bob', { request: { pluginId: 'user:alice:hello' } })
      expect((r.result as { error?: { code?: string } }).error?.code).toBe('tenant/denied')
    }
    // alice 自己的 disable/enable/remove 正常
    const dis = await call('/access/api/my-plugins/disable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect((dis.result as { ok?: boolean }).ok).toBe(true)
    expect(store.userPluginsOfOwner(aliceId)[0]?.enabled).toBe(false)
    const rm = await call('/access/api/my-plugins/remove', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect((rm.result as { ok?: boolean }).ok).toBe(true)
    expect(store.userPluginOwner('user:alice:hello')).toBeUndefined()
  })

  it('T8 级联:deleteUser 清 user_plugins 行', async () => {
    store.recordUserPlugin(aliceId, 'user:alice:hello', join(root, 'alice', 'plugins', 'hello'), true)
    store.deleteUser(aliceId, bobId)
    expect(store.userPluginOwner('user:alice:hello')).toBeUndefined()
    expect(store.userPluginsOfOwner(aliceId)).toHaveLength(0)
  })
})
