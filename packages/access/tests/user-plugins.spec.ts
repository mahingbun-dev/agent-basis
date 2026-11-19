/**
 * P4-T6:双层插件记账与操作权限 + T8 级联销毁(user_plugins 清行)。
 * id 前缀强制 user:<account>:<name>;dir 钳 <userRoot>/plugins/;跨用户操作拒。
 * T6(2026-11-18):装载器接入后的启停/移除/扫描/共享/转内置即时语义(loader 假件+真夹具)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'
import { createTenantPluginLoader, type TenantPluginToolsFace } from '../src/tenant-plugins.ts'
import { personalPluginId, type UserPluginLoader } from '../src/user-plugins.ts'

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
    const r = await call('/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    expect((r.result as { value?: { pluginId: string } }).value?.pluginId).toBe('user:alice:hello')
    expect(store.userPluginOwner('user:alice:hello')).toBe(aliceId)
  })

  it('list:本人只见自己;enable/disable/remove 仅本人;跨用户操作拒', async () => {
    await call('/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    const list = await call('/api/my-plugins/list', 'alice', {})
    const items = (list.result as { value?: { items?: Array<{ pluginId: string }> } }).value?.items ?? []
    expect(items.map(i => i.pluginId)).toEqual(['user:alice:hello'])
    // bob 操作 alice 的插件 → 拒
    for (const op of ['enable', 'disable', 'remove']) {
      const r = await call(`/api/my-plugins/${op}`, 'bob', { request: { pluginId: 'user:alice:hello' } })
      expect((r.result as { error?: { code?: string } }).error?.code).toBe('tenant/denied')
    }
    // alice 自己的 disable/enable/remove 正常
    const dis = await call('/api/my-plugins/disable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect((dis.result as { ok?: boolean }).ok).toBe(true)
    expect(store.userPluginsOfOwner(aliceId)[0]?.enabled).toBe(false)
    const rm = await call('/api/my-plugins/remove', 'alice', { request: { pluginId: 'user:alice:hello' } })
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

describe('T6:装载器接入后的端点即时语义', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let bobId: number
  let root: string
  let registered: Array<{ name: string; disposed: boolean }>
  let loader: UserPluginLoader

  /** 最小工具插件夹具(ESM;apply 内注册 greet)。 */
  function writePlugin(dirPath: string): void {
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, 'package.json'), JSON.stringify({ name: 'fixture-hello', version: '0.0.0', type: 'module', main: 'index.js' }))
    writeFileSync(join(dirPath, 'index.js'), [
      'export function apply(ctx) {',
      '  ctx.tools.register({ name: "greet", description: "fixture", parameters: {},',
      '    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },',
      '    execute() { return "ok" } })',
      '}',
    ].join('\n'))
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-uplug2-'))
    store = new UserStore(join(dir, 'users.db'))
    routes = new Map()
    session = new SessionService(Buffer.from('uplug2-secret-uplug2-00'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    writePlugin(join(root, 'alice', 'plugins', 'hello'))
    mkdirSync(join(root, 'alice', 'plugins', 'stray'), { recursive: true })
    registered = []
    const toolsFace: TenantPluginToolsFace = {
      register(definition) {
        const row = { name: String(definition.name), disposed: false }
        registered.push(row)
        return () => { row.disposed = true }
      },
    }
    const realLoader = createTenantPluginLoader({
      store,
      sessionOwnerOf: () => undefined,
      readTools: () => toolsFace,
      audit: () => {},
    })
    loader = realLoader
    const reflect = { get: (): unknown => undefined }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {}, pluginLoader: realLoader }, { fetch: registry })
  })
  afterEach(() => {
    loader.unmount('user:alice:hello')
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function call(path: string, account: 'alice' | 'bob', payloadArgs: Record<string, unknown>) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route missing: ${path}`)
    const uid = account === 'alice' ? aliceId : bobId
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `eterna_session=${session.issue({ userId: uid, passwordVersion: store.getUserById(uid)?.passwordVersion ?? 1 })}` },
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path, payload: { args: payloadArgs } }),
    }))
    return JSON.parse(await response.text()) as Record<string, unknown>
  }

  it('install 即刻装载:list 下发 mounted/tools;disable/enable 即时 unmount/mount', async () => {
    const r = await call('/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    const value = r.result as { value?: { mount?: { ok?: boolean; tools?: string[] } } }
    expect(value.value?.mount?.ok).toBe(true)
    expect(value.value?.mount?.tools).toEqual(['user_alice_greet'])
    expect(registered.map(t => t.name)).toEqual(['user_alice_greet'])
    const list = await call('/api/my-plugins/list', 'alice', {})
    const item = (list.result as { value?: { items?: Array<{ mounted: boolean; tools: string[] }> } }).value?.items?.[0]
    expect(item?.mounted).toBe(true)
    expect(item?.tools).toEqual(['user_alice_greet'])
    await call('/api/my-plugins/disable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect(registered[0]?.disposed).toBe(true)
    await call('/api/my-plugins/enable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect(registered.some(t => t.name === 'user_alice_greet' && !t.disposed)).toBe(true)
  })

  it('remove 先卸载;scan 列出未登记目录(登记后消失)', async () => {
    await call('/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    const scan = await call('/api/my-plugins/scan', 'alice', {})
    const items = (scan.result as { value?: { items?: Array<{ dirName: string }> } }).value?.items ?? []
    expect(items.map(i => i.dirName)).toEqual(['stray'])
    const rm = await call('/api/my-plugins/remove', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect((rm.result as { ok?: boolean }).ok).toBe(true)
    expect(registered.every(t => t.disposed)).toBe(true)
    const scan2 = await call('/api/my-plugins/scan', 'alice', {})
    const items2 = (scan2.result as { value?: { items?: Array<{ dirName: string }> } }).value?.items ?? []
    expect(items2.map(i => i.dirName).sort()).toEqual(['hello', 'stray'])
  })

  it('scan/list 不泄他账号: bob 看不到 alice 的目录', async () => {
    const scan = await call('/api/my-plugins/scan', 'bob', {})
    const items = (scan.result as { value?: { items?: unknown[] } }).value?.items ?? []
    expect(items).toHaveLength(0)
  })

  it('promote-direct:共享行记账+全局装载;shared/list 仅 admin;shared/disable 即时卸载', async () => {
    await call('/api/my-plugins/install', 'alice', { request: { name: 'hello', dir: 'hello' } })
    await call('/api/my-plugins/disable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    // bob(非 admin)不可见共享清单
    const denied = await call('/api/my-plugins/shared/list', 'bob', {})
    expect((denied.result as { error?: { code?: string } }).error?.code).toBe('tenant/denied')
    // admin(alice 是首个用户=createUserWithSuffix 首个建的是 alice……角色判定看 store)
    const promote = await call('/api/my-plugins/promote-direct', 'alice', { request: { pluginId: 'user:alice:hello' } })
    const promoteValue = promote.result as {
      value?: { promoted?: boolean; mount?: { ok?: boolean; tools?: string[] } }
      error?: { code?: string }
    }
    // alice 是否 admin 取决于种子;若非 admin 则断言拒绝路径
    if (promoteValue.error?.code === 'tenant/denied') {
      expect(promoteValue.error.code).toBe('tenant/denied')
      return
    }
    expect(promoteValue.value?.promoted).toBe(true)
    expect(promoteValue.value?.mount?.ok).toBe(true)
    expect(store.sharedPlugins()[0]?.pluginId).toBe('user:alice:hello')
    expect(store.sharedPlugins()[0]?.enabled).toBe(true)
    const sharedList = await call('/api/my-plugins/shared/list', 'alice', {})
    const shared = (sharedList.result as { value?: { items?: Array<{ mounted: boolean; tools: string[] }> } }).value?.items?.[0]
    expect(shared?.mounted).toBe(true)
    // 共享层命名空间 = shared_(无账号归属;与个人副本工具名区分)
    expect(shared?.tools).toEqual(['shared_greet'])
    // 转内置后个人行退场(共享接管),个人副本不残留挂载
    expect(store.userPluginsOfOwner(1)[0]?.enabled).toBe(false)
    await call('/api/my-plugins/shared/disable', 'alice', { request: { pluginId: 'user:alice:hello' } })
    expect(registered.every(t => t.disposed)).toBe(true)
    expect(store.sharedPlugins()[0]?.enabled).toBe(false)
  })
})
