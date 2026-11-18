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
import type { AccessAuditEvent } from '../src/audit.ts'
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
  // modelCatalog 专路测试注入口:配置行清单(缺省 undefined=纯透传)与上游返回值
  let configEditorConfiguration: unknown
  let upstreamCatalog: Record<string, unknown>
  let audits: AccessAuditEvent[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-tenant-'))
    store = new UserStore(join(dir, 'users.db'))
    calls = []
    routes = new Map()
    audits = []
    configEditorConfiguration = undefined
    upstreamCatalog = {
      default: { provider: 'litellm', model: 'glm-flash' },
      routableProviders: ['litellm'],
      groups: [{ id: 'litellm', name: '企业模型网关（LiteLLM）', models: [
        { id: 'glm-flash', name: 'GLM Flash' },
        { id: 'glm-vision', name: 'GLM Vision' },
        { id: 'glm-catalog-vision', name: 'GLM Catalog Vision' },
      ] }],
      failures: [{ id: 'ghost', name: '幽灵路由', message: 'no key' }],
    }
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
          return upstreamCatalog
        },
      },
      configEditor: {
        configuration: () => configEditorConfiguration,
      },
    }
    const reflect = { get: (key: string): unknown => services[key] }
    const registry: TenantFetchRegistry = {
      register: (route) => {
        routes.set(route.path, route)
        return () => Promise.resolve()
      },
    }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: (event) => { audits.push(event) } }, { fetch: registry })
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

  it('session/modelCatalog:pi-ai 声明 image 的模型富化「视觉」badge;无配置=逐字段透传;上游值不被变异', async () => {
    configEditorConfiguration = { entries: [{ entry: { options: { id: 'llm-pi-ai' } }, override: { providers: {
      litellm: {
        defaultInput: ['text'],
        models: [
          { id: 'glm-flash', input: ['text'] },
          { id: 'glm-vision', input: ['text', 'image'] },
        ],
        modelOverrides: { 'glm-catalog-vision': { input: ['image'] } },
      },
    } } }] }
    const enriched = await call('/api/session/modelCatalog', 'bob', {})
    expect(enriched.result?.result).toMatchObject({ ok: true })
    const value = (enriched.result?.result as { value: Record<string, unknown> }).value
    const models = (value.groups as { models: Record<string, unknown>[] }[])[0]!.models
    expect(models[0]).not.toHaveProperty('badge') // 显式 text-only 不打
    expect(models[1]!.badge).toEqual({ text: { en: 'Vision', zh: '视觉' }, tone: 'neutral' })
    expect(models[2]!.badge).toEqual({ text: { en: 'Vision', zh: '视觉' }, tone: 'neutral' }) // modelOverrides 命中
    expect(value.failures).toEqual(upstreamCatalog.failures) // failures 原样
    // 不可变富化:上游返回对象本身不被改写
    const upstreamModels = (upstreamCatalog.groups as { models: Record<string, unknown>[] }[])[0]!.models
    expect(upstreamModels[1]).not.toHaveProperty('badge')
    // configEditor 无配置 → 纯透传(逐字段等于上游值)
    configEditorConfiguration = undefined
    const passthrough = await call('/api/session/modelCatalog', 'bob', {})
    expect((passthrough.result?.result as { value: unknown }).value).toEqual(upstreamCatalog)
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

  it('session/thinkingAuto:默认开启可读;写开关即记账;他人/未知会话拒绝', async () => {
    store.recordSession('s-auto', aliceId, null)
    // 读:列默认 1 ⇒ 归属会话默认开启
    const read1 = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-auto' } })
    expect(read1.result?.result).toMatchObject({ ok: true, value: { enabled: true } })
    // 写:关→读回 false;再开→true
    const off = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-auto', enabled: false } })
    expect(off.result?.result).toMatchObject({ ok: true, value: { enabled: false } })
    expect(store.thinkingAutoOf('s-auto')).toBe(false)
    const on = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-auto', enabled: true } })
    expect(on.result?.result).toMatchObject({ ok: true, value: { enabled: true } })
    // 他人会话(归属守卫)与未知会话一律 denied
    const other = await call('/api/session/thinkingAuto', 'bob', { request: { sessionId: 's-auto' } })
    expect(JSON.stringify(other.result)).toContain('tenant/denied')
    const ghostAuto = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-ghost' } })
    expect(JSON.stringify(ghostAuto.result)).toContain('tenant/denied')
  })

  it('session/thinkingFeedback:±0.2 累计与抵消;非法 direction/他人/未知会话拒绝', async () => {
    store.recordSession('s-fb', aliceId, null)
    const more = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb', messageId: 'm1', direction: 'more' },
    })
    expect(more.result?.result).toMatchObject({ ok: true, value: { bias: 0.2, effectiveBias: 0.2 } })
    expect(store.thinkingBiasOf('s-fb')?.bias).toBeCloseTo(0.2)
    // 反向点击抵消到 0
    const less = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb', messageId: 'm2', direction: 'less' },
    })
    expect((less.result?.result as { value?: { bias?: number } }).value?.bias).toBeCloseTo(0)
    // 非法方向、他人会话、未知会话一律 denied
    const bad = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb', direction: 'sideways' },
    })
    expect(JSON.stringify(bad.result)).toContain('tenant/denied')
    const other = await call('/api/session/thinkingFeedback', 'bob', {
      request: { sessionId: 's-fb', direction: 'more' },
    })
    expect(JSON.stringify(other.result)).toContain('tenant/denied')
    const ghost = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-ghost', direction: 'more' },
    })
    expect(JSON.stringify(ghost.result)).toContain('tenant/denied')
    expect(store.thinkingBiasOf('s-ghost')).toBeUndefined()
  })

  it('session/thinkingFeedback 读支:无偏置 {0,0};写后读回原值与衰减值;零审计', async () => {
    store.recordSession('s-fb2', aliceId, null)
    // 从未反馈 ⇒ {0,0}(归属已过守卫,undefined 只能是「从未反馈/已清零」,不是 denied)
    const fresh = await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb2' } })
    expect(fresh.result?.result).toMatchObject({ ok: true, value: { bias: 0, effectiveBias: 0 } })
    // 写后读回:bias=落库原值 0.2,effectiveBias=刚写完的现值(≈0.2)
    await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb2', direction: 'more' } })
    const read = await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb2' } })
    const readValue = (read.result?.result as { value?: { bias?: number; effectiveBias?: number } }).value
    expect(readValue?.bias).toBeCloseTo(0.2)
    expect(readValue?.effectiveBias).toBeCloseTo(0.2)
    // 读支零审计;写支一条(审计只记写)
    const feedbackAudits = audits.filter(event => event.detail?.action === 'thinking.feedback')
    expect(feedbackAudits).toHaveLength(1)
    expect(feedbackAudits[0]?.detail).toMatchObject({ sessionId: 's-fb2', direction: 'more' })
    // 读支不直调 sessionController(access 记账面,控制器无此方法)
    expect(calls.filter(recorded => recorded.service === 'sessionController')).toHaveLength(0)
  })

  it('session/thinkingFeedback reset:清零后读 {0,0} 且 thinkingBiasOf undefined;审计记 reset+previousBias', async () => {
    store.recordSession('s-fb3', aliceId, null)
    await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb3', messageId: 'm1', direction: 'more' },
    })
    const reset = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb3', messageId: 'm2', direction: 'reset' },
    })
    expect(reset.result?.result).toMatchObject({ ok: true, value: { bias: 0, effectiveBias: 0 } })
    expect(store.thinkingBiasOf('s-fb3')).toBeUndefined()
    const after = await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb3' } })
    expect(after.result?.result).toMatchObject({ ok: true, value: { bias: 0, effectiveBias: 0 } })
    const resetAudit = audits.find(event => event.detail?.action === 'thinking.feedback'
      && event.detail?.direction === 'reset')
    expect(resetAudit?.detail).toMatchObject({ sessionId: 's-fb3', messageId: 'm2', bias: 0, effectiveBias: 0 })
    expect(resetAudit?.detail?.previousBias as number).toBeCloseTo(0.2)
    // 幂等:再 reset 一次仍 ok(命中行语义,不因已清零而失败)
    const again = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb3', direction: 'reset' },
    })
    expect(again.result?.result).toMatchObject({ ok: true, value: { bias: 0, effectiveBias: 0 } })
    // 未知会话不建行
    expect(store.sessionOwner('s-fb3')).toBe(aliceId)
  })

  it('session/thinkingFeedback 伪造方向:direction:\'\'/数字/null 一律 denied 而非静默当读', async () => {
    store.recordSession('s-fb4', aliceId, null)
    for (const direction of ['', 0, 5, null, true] as unknown[]) {
      const forged = await call('/api/session/thinkingFeedback', 'alice', {
        request: { sessionId: 's-fb4', direction },
      })
      expect(JSON.stringify(forged.result), `direction=${JSON.stringify(direction)}`).toContain('tenant/denied')
      expect(JSON.stringify(forged.result)).toContain('direction 无效')
    }
    // 顶层 args 上的 direction 同样生效(键存在即分流,非读支)
    const topLevel = await call('/api/session/thinkingFeedback', 'alice', {
      sessionId: 's-fb4', direction: '',
    })
    expect(JSON.stringify(topLevel.result)).toContain('direction 无效')
    // 归属守卫在方向分流之前:他人/未知会话即使 direction 非法也按归属拒绝
    const otherRead = await call('/api/session/thinkingFeedback', 'bob', { request: { sessionId: 's-fb4' } })
    expect(JSON.stringify(otherRead.result)).toContain('tenant/denied')
    expect(JSON.stringify(otherRead.result)).not.toContain('direction 无效')
    const ghostRead = await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-ghost2' } })
    expect(JSON.stringify(ghostRead.result)).toContain('tenant/denied')
    const ghostReset = await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-ghost2', direction: 'reset' },
    })
    expect(JSON.stringify(ghostReset.result)).toContain('tenant/denied')
    // 未知会话/伪造方向都不建行
    expect(store.thinkingBiasOf('s-ghost2')).toBeUndefined()
    expect(store.sessionOwner('s-ghost2')).toBeUndefined()
  })

  it('session/thinkingFeedback 读支随时间衰减:24h 前写 0.4 ⇒ bias=0.4, effectiveBias≈0.2', async () => {
    store.recordSession('s-fb5', aliceId, null)
    store.addThinkingBias('s-fb5', 0.4, Date.now() - 24 * 60 * 60_000)
    const read = await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb5' } })
    const value = (read.result?.result as { value?: { bias?: number; effectiveBias?: number } }).value
    expect(value?.bias).toBeCloseTo(0.4)
    expect(value?.effectiveBias).toBeCloseTo(0.2)
  })

  it('session/thinkingFeedback reset 只清偏置:不动 thinking_auto 与归属行', async () => {
    store.recordSession('s-fb6', aliceId, null)
    store.setThinkingAuto('s-fb6', false)
    await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb6', direction: 'more' } })
    await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb6', direction: 'reset' } })
    expect(store.thinkingAutoOf('s-fb6')).toBe(false)
    expect(store.sessionOwner('s-fb6')).toBe(aliceId)
  })

  it('session/thinkingFeedback reset 审计保留原始偏置:24h 前 0.4 ⇒ previousBias=0.4, previousBiasEffective≈0.2', async () => {
    store.recordSession('s-fb7', aliceId, null)
    store.addThinkingBias('s-fb7', 0.4, Date.now() - 24 * 60 * 60_000)
    await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb7', direction: 'reset' } })
    const resetAudit = audits.filter(event => event.detail?.action === 'thinking.feedback'
      && event.detail?.direction === 'reset').at(-1)
    expect(resetAudit?.detail?.previousBias as number).toBeCloseTo(0.4)
    expect(resetAudit?.detail?.previousBiasEffective as number).toBeCloseTo(0.2)
    expect(resetAudit?.detail?.previousUpdatedAt as number).toBeGreaterThan(0)
  })

  it('session/thinkingFeedback 拒绝均落 denied 审计(归属/方向拼错/锚点超长)', async () => {
    store.recordSession('s-fb8', aliceId, null)
    const deniedOf = () => audits.filter(event => event.detail?.action === 'thinking.feedback.denied')
    const before = deniedOf().length
    // 他人会话
    await call('/api/session/thinkingFeedback', 'bob', { request: { sessionId: 's-fb8', direction: 'more' } })
    // 方向键拼错(近似键)
    await call('/api/session/thinkingFeedback', 'alice', { request: { sessionId: 's-fb8', directon: 'more' } })
    // 锚点超长
    await call('/api/session/thinkingFeedback', 'alice', {
      request: { sessionId: 's-fb8', messageId: 'x'.repeat(129), direction: 'more' },
    })
    const reasons = deniedOf().slice(before).map(event => event.detail?.reason)
    expect(reasons).toEqual(['owner', 'direction', 'messageId'])
    // 拒绝不应写入偏置
    expect(store.thinkingBiasOf('s-fb8')).toBeUndefined()
  })

  it('session/thinkingAuto 严格化:enabled 非布尔或近似键拒绝,不再静默当读', async () => {
    store.recordSession('s-fb9', aliceId, null)
    for (const enabled of ['', 0, 'false', null] as unknown[]) {
      const forged = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-fb9', enabled } })
      expect(JSON.stringify(forged.result), `enabled=${JSON.stringify(enabled)}`).toContain('enabled 无效')
    }
    const typo = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-fb9', enable: true } })
    expect(JSON.stringify(typo.result)).toContain('enabled 无效')
    // 合法布尔仍生效;键缺席仍是读
    await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-fb9', enabled: false } })
    expect(store.thinkingAutoOf('s-fb9')).toBe(false)
    const read = await call('/api/session/thinkingAuto', 'alice', { request: { sessionId: 's-fb9' } })
    expect(read.result?.result).toMatchObject({ ok: true, value: { enabled: false } })
    const denied = audits.filter(event => event.detail?.action === 'thinking.auto.denied'
      && event.detail?.reason === 'enabled')
    expect(denied.length).toBeGreaterThanOrEqual(5)
  })
})
