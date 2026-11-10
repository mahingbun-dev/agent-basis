/**
 * 租户守卫门禁:归属判定/路径钳制/直调转交/记账与迁移。
 * 真实 store+session,服务用记录器替身(reflect 反射面同构)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { ensureFirstSession, registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

interface RecordedCall {
  readonly service: string
  readonly method: string
  readonly params: unknown[]
  result?: unknown
}

describe('tenant 守卫', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let calls: RecordedCall[]
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let bobId: number
  let root: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-tenant-'))
    store = new UserStore(join(dir, 'users.db'))
    calls = []
    routes = new Map()
    session = new SessionService(Buffer.from('tenant-secret-tenant-secret-000'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    const services: Record<string, Record<string, (...args: unknown[]) => unknown>> = {
      workspaceController: {
        create: (requestRaw: unknown) => {
          calls.push({ service: 'workspaceController', method: 'create', params: [requestRaw] })
          const request = requestRaw as { path: string }
          return { workspace: { workspaceId: `w-${calls.length}`, path: request.path, title: 'x' }, created: true }
        },
        delete: (request: unknown) => {
          calls.push({ service: 'workspaceController', method: 'delete', params: [request] })
          return { workspaceId: (request as { workspaceId: string }).workspaceId }
        },
        rename: (request: unknown) => {
          calls.push({ service: 'workspaceController', method: 'rename', params: [request] })
          return { workspaceId: 'w-1' }
        },
      },
      directoryPickerController: {
        list: (pathRaw: unknown) => {
          calls.push({ service: 'directoryPickerController', method: 'list', params: [pathRaw] })
          return { entries: [] }
        },
        createDirectory: (pathRaw: unknown, nameRaw: unknown) => {
          calls.push({ service: 'directoryPickerController', method: 'createDirectory', params: [pathRaw, nameRaw] })
          return join(pathRaw as string, nameRaw as string)
        },
      },
      sessionController: {
        create: (request: unknown) => {
          calls.push({ service: 'sessionController', method: 'create', params: [request] })
          return { sessionId: `s-${calls.length}` }
        },
        // 同构真实控制器契约:prompt(request, signal) 首行即 signal.throwIfAborted();
        // 守卫漏传 signal 必须在此炸出(回归:发送会话必挂的根因一)。
        prompt: (request: unknown, signal: unknown) => {
          if (!(signal instanceof AbortSignal)) {
            throw new TypeError("Cannot read properties of undefined (reading 'throwIfAborted')")
          }
          calls.push({ service: 'sessionController', method: 'prompt', params: [request, signal] })
          return { accepted: true }
        },
        modelCatalog: (request: unknown) => {
          calls.push({ service: 'sessionController', method: 'modelCatalog', params: [request] })
          return { models: [] }
        },
      },
    }
    const reflect = { get: (key: string): unknown => services[key] }
    const registry: TenantFetchRegistry = {
      register: (route) => {
        routes.set(route.path, route)
        return () => Promise.resolve()
      },
    }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function cookieFor(userId: number): string {
    const user = store.getUserById(userId)
    return `eterna_session=${session.issue({ userId, passwordVersion: user?.passwordVersion ?? 1 })}`
  }

  interface CallOutcome {
    readonly status: number
    readonly result: Record<string, unknown> | undefined
  }

  async function call(path: string, account: string | undefined, payloadArgs: Record<string, unknown>): Promise<CallOutcome> {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const request = new Request(`http://app.local${path}`, {
      method: 'POST',
      headers: account === undefined ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', cookie: cookieFor(account === 'alice' ? aliceId : bobId) },
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: payloadArgs } }),
    })
    const response = await handler.fetch(request)
    const text = await response.text()
    let result: Record<string, unknown> | undefined
    try {
      result = JSON.parse(text) as Record<string, unknown>
    } catch {
      result = undefined
    }
    return { status: response.status, result }
  }

  it('信封非法 → 400;未登录 → tenant/unauthenticated(含 details 线格式契约)', async () => {
    const createHandler = routes.get('/api/workspace/create')
    if (createHandler === undefined) throw new Error('create route missing')
    const bad = await createHandler.fetch(new Request('http://app.local/api/workspace/create', { method: 'POST', body: 'not-json' }))
    expect(bad.status).toBe(400)
    const anon = await call('/api/workspace/create', undefined, { request: { path: join(root, 'alice') } })
    // 客户端连接层按 rpcErrorSchema 校验失败帧 {code,message,details}:缺 details
    // 会整包解析失败,浏览器只见 "invalid server-response failure"(回归:根因二)。
    expect(anon.result?.result).toMatchObject({
      ok: false,
      error: { code: 'tenant/unauthenticated', message: '未登录', details: {} },
    })
  })

  it('workspace/create:根外拒绝;根内直调+归属记账', async () => {
    const outside = await call('/api/workspace/create', 'alice', { request: { path: '/data/other-user' } })
    expect(JSON.stringify(outside.result)).toContain('tenant/denied')
    expect(calls.filter(c => c.method === 'create')).toHaveLength(0)
    const inside = await call('/api/workspace/create', 'alice', { request: { path: join(root, 'alice', 'proj') } })
    expect(inside.result?.result).toMatchObject({ ok: true })
    expect(calls[0]).toMatchObject({ service: 'workspaceController', method: 'create' })
    const id = (inside.result?.result as { value: { workspace: { workspaceId: string } } }).value.workspace.workspaceId
    expect(store.workspaceOwner(id)).toBe(aliceId)
  })

  it('workspace/initializeDefault:用户根幂等建区', async () => {
    const first = await call('/api/workspace/initializeDefault', 'alice', {})
    expect(first.result?.result).toMatchObject({ ok: true })
    expect(calls[0]?.method).toBe('create')
    expect((calls[0]?.params[0] as { path: string }).path).toBe(join(root, 'alice'))
  })

  it('workspace/delete:他人工作区拒绝;自己的直调并解除记账', async () => {
    store.recordWorkspace('w-alice', aliceId, join(root, 'alice'))
    store.recordWorkspace('w-bob', bobId, join(root, 'bob'))
    const steal = await call('/api/workspace/delete', 'alice', { request: { workspaceId: 'w-bob' } })
    expect(JSON.stringify(steal.result)).toContain('tenant/denied')
    expect(calls.filter(c => c.method === 'delete')).toHaveLength(0)
    const own = await call('/api/workspace/delete', 'alice', { request: { workspaceId: 'w-alice' } })
    expect(own.result?.result).toMatchObject({ ok: true })
    expect(store.workspaceOwner('w-alice')).toBeUndefined()
  })

  it('directoryPicker:list 无参落到用户根;根外拒绝;createDirectory 钳制', async () => {
    const home = await call('/api/directoryPicker/list', 'bob', {})
    expect((home.result?.result as { value: unknown }).value).toEqual({ entries: [] })
    expect((calls[0]?.params[0] as string)).toBe(join(root, 'bob'))
    const escape = await call('/api/directoryPicker/list', 'bob', { path: '/data' })
    expect(JSON.stringify(escape.result)).toContain('tenant/denied')
    const mk = await call('/api/directoryPicker/createDirectory', 'bob', { path: join(root, 'bob'), name: '新建项目' })
    expect(mk.result?.result).toMatchObject({ ok: true })
    expect(calls.find(c => c.method === 'createDirectory')?.params).toEqual([join(root, 'bob'), '新建项目'])
  })

  it('session/create:他人 workspaceId 明确拒绝且文案含引导;根外 cwd 拒;归属 workspace 直通记账', async () => {
    store.recordWorkspace('w-alice', aliceId, join(root, 'alice'))
    const foreign = await call('/api/session/create', 'bob', { request: { workspaceId: 'w-alice' } })
    expect(JSON.stringify(foreign.result)).toContain('tenant/denied')
    expect(JSON.stringify(foreign.result)).toContain('不属于你')
    expect(JSON.stringify(foreign.result)).toContain('左侧')
    // 明确拒绝:不直调、不建区、不记账
    expect(calls.filter(c => c.method === 'create')).toHaveLength(0)
    const outside = await call('/api/session/create', 'alice', { request: { cwd: '/etc' } })
    expect(JSON.stringify(outside.result)).toContain('tenant/denied')
    const ok = await call('/api/session/create', 'alice', { request: { workspaceId: 'w-alice' } })
    expect(ok.result?.result).toMatchObject({ ok: true })
    expect(store.sessionOwner((ok.result?.result as { value: { sessionId: string } }).value.sessionId)).toBe(aliceId)
    // 复用会话 id 只认自己的:残留他人 id 剥掉按全新会话建(不泄权不误伤)
    const stripped = await call('/api/session/create', 'alice', { request: { workspaceId: 'w-alice', sessionId: 'not-mine' } })
    expect(stripped.result?.result).toMatchObject({ ok: true })
    const payload = calls.filter(c => c.method === 'create').at(-1)?.params[0] as { sessionId?: string }
    expect(payload.sessionId).toBeUndefined()
  })

  it('ensureFirstSession:直调建会话并记账;控制器缺席返回 undefined', async () => {
    const localServices: Record<string, Record<string, (...args: unknown[]) => unknown>> = {
      sessionController: {
        create: (request: unknown) => {
          calls.push({ service: 'sessionController', method: 'create', params: [request] })
          return { sessionId: 's-first' }
        },
      },
    }
    const reflect = { get: (key: string): unknown => localServices[key] }
    const made = await ensureFirstSession({ store, reflect }, bobId, 'w-bob')
    expect(made).toBe('s-first')
    expect(store.sessionOwner('s-first')).toBe(bobId)
    expect(calls.at(-1)?.params[0]).toEqual({ workspaceId: 'w-bob' })
    const absent = await ensureFirstSession({ store, reflect: { get: () => undefined } }, bobId, 'w-bob')
    expect(absent).toBeUndefined()
  })

  it('session/prompt:他人会话拒;自己的放行;无归属字段端点直放(modelCatalog)', async () => {
    store.recordSession('s-alice', aliceId, null)
    const foreign = await call('/api/session/prompt', 'bob', { request: { sessionId: 's-alice' } })
    expect(JSON.stringify(foreign.result)).toContain('tenant/denied')
    const own = await call('/api/session/prompt', 'alice', { request: { sessionId: 's-alice' } })
    expect(own.result?.result).toMatchObject({ ok: true })
    // 守卫必须把 HTTP 请求的 AbortSignal 透传给控制器第二参(真实 prompt 首行即消费)
    const promptCall = calls.find(c => c.method === 'prompt')
    expect(promptCall?.params[1]).toBeInstanceOf(AbortSignal)
    const catalog = await call('/api/session/modelCatalog', 'bob', {})
    expect(catalog.result?.result).toMatchObject({ ok: true })
    expect(calls.find(c => c.method === 'modelCatalog')).toBeDefined()
  })

  it('T2.5 迁移:存量 workspace 幂等划归首个 admin', () => {
    const admin = store.createUserWithSuffix({ account: 'Mr.Ma', password: 'MqbSunny0702', role: 'admin' }).user
    const adopted = store.adoptOrphanWorkspaces(admin.id, [
      { workspaceId: 'legacy-1', path: '/data/demo' },
      { workspaceId: 'legacy-2', path: '/data/demo2' },
    ])
    expect(adopted).toBe(2)
    expect(store.workspaceOwner('legacy-1')).toBe(admin.id)
    expect(store.adoptOrphanWorkspaces(admin.id, [{ workspaceId: 'legacy-1', path: '/data/demo' }])).toBe(0)
  })
})
