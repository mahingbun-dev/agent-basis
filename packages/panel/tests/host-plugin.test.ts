/**
 * Host 半边插件测试:SRC Remote 命中(网关 resolveSrcDescriptor 依赖的
 * typertRemote 绑定 + @Remote marker,手工施加路径的等价性)与插件形态。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import plugin, { ETERNA_PANEL_SERVICE_ID, EternaPanelGateway, REVIEW_ENDPOINT, SNAPSHOT_ENDPOINT } from '../src/index.ts'

// 隔离可观测读取:指向空临时 DSH_HOME,不读真实 ~/.dsh/sessions。
const isolatedHome = mkdtempSync(join(tmpdir(), 'eterna-panel-host-'))
const previousHome = process.env.DSH_HOME
beforeAll(() => {
  process.env.DSH_HOME = isolatedHome
})
afterAll(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(isolatedHome, { recursive: true, force: true })
})

describe('EternaPanelGateway(Typert SRC 端点)', () => {
  it('服务名与端点字符串', () => {
    expect(ETERNA_PANEL_SERVICE_ID).toBe('eternaPanel')
    expect(SNAPSHOT_ENDPOINT).toBe('eternaPanel/snapshot')
    expect(REVIEW_ENDPOINT).toBe('eternaPanel/review')
  })

  it('原型携带 @Remote marker(手工施加等价于装饰器糖):snapshot + review + reviewForAccount(M-T2)+ trackCorrection(T13)', () => {
    const markers = remoteMethods(Object.create(EternaPanelGateway.prototype) as object)
    expect(markers).toHaveLength(4)
    expect(markers.map(marker => marker.method).sort()).toEqual(['review', 'reviewForAccount', 'snapshot', 'trackCorrection'])
    // typert mark() 规则:exportName 与方法同名时省略,网关按 exportName ?? method 解析
    const snapshot = markers.find(marker => marker.method === 'snapshot')
    expect(snapshot?.exportName ?? snapshot?.method).toBe('snapshot')
  })

  it('snapshot() 方法存在且返回 Promise', async () => {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway & { ctx: never }
    // 不经构造器(避免注册服务);直接验证方法体可调用——给伪 ctx 返回空状态。
    const fakeCtx = { get: (): undefined => undefined } as never
    Object.defineProperty(gateway, 'ctx', { value: fakeCtx })
    const result = await gateway.snapshot()
    expect(result.generatedAt).toBeTruthy()
    expect(result.governance.ruleCount).toBe(0)
    expect(result.observability.sessions).toEqual([])
  })
})

describe('eternaPanel/review(M-M2 T9 记忆裁决端点)', () => {
  /** 伪 ctx:可注入 memory 服务、invocation principal 与 access store。 */
  function fakeCtxOf(options: {
    memory?: { review(id: number, decision: 'approved' | 'rejected'): unknown }
    principal?: { kind?: string; userId?: number }
    adminRole?: string
  } = {}): never {
    return {
      get: (name: string) => name === '@eterna/memory' ? options.memory : undefined,
      invocation: options.principal === undefined ? undefined : { principal: options.principal },
      reflect: { get: (name: string) => name === 'eternaAccessStore' && options.adminRole !== undefined
        ? { getUserById: () => ({ role: options.adminRole }) }
        : undefined },
    } as never
  }

  function gatewayOf(ctx: never): EternaPanelGateway {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway
    Object.defineProperty(gateway, 'ctx', { value: ctx })
    return gateway
  }

  it('裁决透传:approved/rejected 走 Memory.review,返回行投影', async () => {
    const calls: Array<{ id: number; decision: string }> = []
    const gateway = gatewayOf(fakeCtxOf({
      memory: {
        review: (id, decision) => {
          calls.push({ id, decision })
          return { id, subject: 'user', key: 'k', reviewState: decision, invalidAt: decision === 'rejected' ? 123 : null }
        },
      },
    }))
    await expect(gateway.review({ id: 11, decision: 'approved' })).resolves.toEqual({
      ok: true,
      record: { id: 11, subject: 'user', key: 'k', reviewState: 'approved', invalidAt: null },
    })
    await expect(gateway.review({ id: 12, decision: 'rejected' })).resolves.toMatchObject({ ok: true, record: { reviewState: 'rejected', invalidAt: 123 } })
    expect(calls).toEqual([{ id: 11, decision: 'approved' }, { id: 12, decision: 'rejected' }])
  })

  it('行不存在(已处理/越界 id)→ ok:true record:null(裁决语义,不猜行状态)', async () => {
    const gateway = gatewayOf(fakeCtxOf({ memory: { review: () => null } }))
    await expect(gateway.review({ id: 1, decision: 'approved' })).resolves.toEqual({ ok: true, record: null })
  })

  it('载荷校验:非对象/坏 id/坏 decision → invalid + 中文 message', async () => {
    const gateway = gatewayOf(fakeCtxOf({ memory: { review: () => null } }))
    await expect(gateway.review(null)).resolves.toMatchObject({ ok: false, code: 'invalid' })
    await expect(gateway.review({ decision: 'approved' })).resolves.toMatchObject({ ok: false, code: 'invalid' })
    await expect(gateway.review({ id: 1.5, decision: 'approved' })).resolves.toMatchObject({ ok: false, code: 'invalid' })
    await expect(gateway.review({ id: -1, decision: 'approved' })).resolves.toMatchObject({ ok: false, code: 'invalid' })
    await expect(gateway.review({ id: 1, decision: 'delete' })).resolves.toMatchObject({ ok: false, code: 'invalid' })
  })

  it('服务缺席(eterna-memory 停用)→ unavailable', async () => {
    const gateway = gatewayOf(fakeCtxOf())
    await expect(gateway.review({ id: 1, decision: 'approved' })).resolves.toMatchObject({
      ok: false, code: 'unavailable',
    })
  })

  it('review 抛错 → unavailable(不向网关漏异常)', async () => {
    const gateway = gatewayOf(fakeCtxOf({ memory: { review: () => { throw new Error('库已关闭') } } }))
    const result = await gateway.review({ id: 1, decision: 'approved' })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 'unavailable' })
    if (!result.ok) expect(result.message).toContain('库已关闭')
  })

  it('鉴权(compaction admin-plugin 同款):owner Peer 放行;eterna-user 流通道须 admin', async () => {
    const memory = { review: () => null }
    // owner Peer(unary,无 principal):放行
    await expect(gatewayOf(fakeCtxOf({ memory })).review({ id: 1, decision: 'approved' })).resolves.toMatchObject({ ok: true })
    // eterna-user + admin:放行
    await expect(gatewayOf(fakeCtxOf({ memory, principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }))
      .review({ id: 1, decision: 'approved' })).resolves.toMatchObject({ ok: true })
    // eterna-user + 非 admin:forbidden
    await expect(gatewayOf(fakeCtxOf({ memory, principal: { kind: 'eterna-user', userId: 2 }, adminRole: 'member' }))
      .review({ id: 1, decision: 'approved' })).resolves.toMatchObject({ ok: false, code: 'forbidden' })
    // eterna-user + access store 缺席:forbidden(fail-closed)
    await expect(gatewayOf(fakeCtxOf({ memory, principal: { kind: 'eterna-user', userId: 3 } }))
      .review({ id: 1, decision: 'approved' })).resolves.toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('是 { name, apply } 插件对象,apply 返回 disposer', () => {
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.name).toBe('eterna-panel')
  })
})

describe('trackCorrection 端点(T13 画像纠正留痕)', () => {
  // 账号隔离(2026-11-17)后 trackCorrection 经同类辅助方法解析调用者——this 须
  // 沿原型链(Object.create,review 测试同款),不能用裸 { ctx } 字面量。
  const call = async (ctx: unknown, payload: unknown): Promise<{ ok: boolean; code?: string; message?: string }> => {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway & { ctx: never }
    gateway.ctx = ctx as never
    return await Promise.resolve(gateway.trackCorrection(payload))
  }

  it('合法载荷 → Memory.recordCorrection 落一行;用户级动作不查 admin', async () => {
    const recorded: unknown[] = []
    const ctx = { get: () => ({ recordCorrection: (entry: unknown) => { recorded.push(entry) } }) }
    const outcome = await call(ctx, { section: '风格偏好', keyHint: 'prefers-concise' })
    expect(outcome.ok).toBe(true)
    expect(recorded).toEqual([{ section: '风格偏好', keyHint: 'prefers-concise' }])
  })

  it('section 缺失/非串 → invalid;服务缺席 → unavailable', async () => {
    expect((await call({ get: () => undefined }, { section: '风格偏好' })).code).toBe('unavailable')
    expect((await call({ get: () => ({}) }, {})).code).toBe('invalid')
    expect((await call({ get: () => ({}) }, { section: '  ' })).code).toBe('invalid')
  })
})

describe('面板账号隔离(2026-11-17):snapshot 按 principal 裁剪 / trackCorrection 账号路由', () => {
  const GLOBAL_MEMORY_DB = join(process.cwd(), '.eterna', 'memory.sqlite3')
  const GLOBAL_KNOWLEDGE_DB = join(process.cwd(), '.eterna', 'knowledge.sqlite3')

  interface MemoryLike {
    review(id: number, decision: 'approved' | 'rejected'): unknown
    recordCorrection?(entry: { section: string; keyHint: string }): void
  }

  /** 伪 ctx:服务面按名分派 + principal + access store(sessionsOfOwner/getUserById)。 */
  function isolationCtx(options: {
    principal?: { kind: string; userId: number }
    adminRole?: string
    memoryAccounts?: {
      accountOfUser(userId: number): string | undefined
      memoryForAccount(account: string): MemoryLike | undefined
      dbPathForAccount(account: string): string | undefined
    }
    knowledgeAccounts?: {
      accountOfUser(userId: number): string | undefined
      statusForAccount(account: string): unknown
    }
    ownedSessions?: readonly string[]
    globalMemory?: MemoryLike
  }): never {
    const services: Record<string, unknown> = {
      '@eterna/memory': options.globalMemory,
      'eterna-memory-accounts': options.memoryAccounts,
      'eterna-knowledge-accounts': options.knowledgeAccounts,
    }
    return {
      get: (name: string) => services[name],
      invocation: options.principal === undefined ? undefined : { principal: options.principal },
      reflect: {
        get: (name: string) => (name === 'eternaAccessStore'
          ? {
            getUserById: () => ({ role: options.adminRole }),
            sessionsOfOwner: () => [...(options.ownedSessions ?? [])],
          }
          : undefined),
      },
    } as never
  }

  function gatewayOf(ctx: never): EternaPanelGateway {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway
    Object.defineProperty(gateway, 'ctx', { value: ctx })
    return gateway
  }

  const cherryPrincipal = { kind: 'eterna-user', userId: 2 }

  function cherryFaces(): {
    memoryAccounts: NonNullable<Parameters<typeof isolationCtx>[0]['memoryAccounts']>
    knowledgeAccounts: NonNullable<Parameters<typeof isolationCtx>[0]['knowledgeAccounts']>
  } {
    return {
      memoryAccounts: {
        accountOfUser: () => 'cherry',
        memoryForAccount: () => ({ review: () => null }),
        dbPathForAccount: () => '/tenants/cherry/.eterna/memory.sqlite3',
      },
      knowledgeAccounts: {
        accountOfUser: () => 'cherry',
        statusForAccount: () => ({
          account: 'cherry', available: true, dbPath: '/tenants/cherry/.eterna/knowledge.sqlite3',
          wikiDocCount: 2, proposalCount: 1,
        }),
      },
    }
  }

  it('普通账号:记忆/知识库按本人账号库,不读全局库;/access/api/me 之外无他路', async () => {
    const faces = cherryFaces()
    const snapshot = await gatewayOf(isolationCtx({ principal: cherryPrincipal, ...faces })).snapshot()
    expect(snapshot.memory.dbPath).toBe('/tenants/cherry/.eterna/memory.sqlite3')
    expect(snapshot.memory.dbPath).not.toBe(GLOBAL_MEMORY_DB)
    expect(snapshot.knowledge.dbPath).toBe('/tenants/cherry/.eterna/knowledge.sqlite3')
    expect(snapshot.knowledge.dbPath).not.toBe(GLOBAL_KNOWLEDGE_DB)
    expect(snapshot.knowledge).toMatchObject({ available: true, wikiDocCount: 2, proposalCount: 1 })
  })

  it('admin 与 owner(本地流):知识库走全局库;记忆仍按各自账号(admin)/全局(owner)', async () => {
    // admin:知识库=全局,记忆=admin 自己账号库(管理面视野,记忆仍是私人数据)
    const adminSnapshot = await gatewayOf(isolationCtx({
      principal: { kind: 'eterna-user', userId: 1 },
      adminRole: 'admin',
      memoryAccounts: {
        accountOfUser: () => 'root',
        memoryForAccount: () => ({ review: () => null }),
        dbPathForAccount: () => '/tenants/root/.eterna/memory.sqlite3',
      },
      knowledgeAccounts: { accountOfUser: () => 'root', statusForAccount: () => ({ wikiDocCount: 999 }) },
      ownedSessions: ['session-someone-else'],
    })).snapshot()
    expect(adminSnapshot.knowledge.dbPath).toBe(GLOBAL_KNOWLEDGE_DB)
    expect(adminSnapshot.memory.dbPath).toBe('/tenants/root/.eterna/memory.sqlite3')
    // owner(无 principal,本地/unary 旧形态):记忆与知识库都是全局
    const ownerSnapshot = await gatewayOf(isolationCtx({})).snapshot()
    expect(ownerSnapshot.knowledge.dbPath).toBe(GLOBAL_KNOWLEDGE_DB)
    expect(ownerSnapshot.memory.dbPath).toBe(GLOBAL_MEMORY_DB)
  })

  it('普通账号但账号路由面缺席 → 记忆/知识库双 fail-closed(不回落全局库)', async () => {
    const snapshot = await gatewayOf(isolationCtx({ principal: cherryPrincipal })).snapshot()
    expect(snapshot.memory.available).toBe(false)
    expect(snapshot.memory.dbPath).toContain('账号记忆库不可用')
    expect(snapshot.memory.dbPath).not.toBe(GLOBAL_MEMORY_DB)
    expect(snapshot.knowledge.available).toBe(false)
    expect(snapshot.knowledge.dbPath).toContain('账号知识库不可用')
    expect(snapshot.knowledge.dbPath).not.toBe(GLOBAL_KNOWLEDGE_DB)
  })

  it('trackCorrection 账号路由:普通账号落本人账号库;账号不可解析 fail-closed;owner 走全局', async () => {
    const accountCalls: unknown[] = []
    const globalCalls: unknown[] = []
    const accountMemory: MemoryLike = {
      review: () => null,
      recordCorrection: (entry) => { accountCalls.push(entry) },
    }
    const globalMemory: MemoryLike = {
      review: () => null,
      recordCorrection: (entry) => { globalCalls.push(entry) },
    }
    // 普通账号:落本人账号库,全局零调用
    const cherryGateway = gatewayOf(isolationCtx({
      principal: cherryPrincipal,
      globalMemory,
      memoryAccounts: {
        accountOfUser: () => 'cherry',
        memoryForAccount: () => accountMemory,
        dbPathForAccount: () => '/tenants/cherry/.eterna/memory.sqlite3',
      },
    }))
    await expect(cherryGateway.trackCorrection({ section: '风格偏好', keyHint: 'k' }))
      .resolves.toMatchObject({ ok: true })
    expect(accountCalls).toEqual([{ section: '风格偏好', keyHint: 'k' }])
    expect(globalCalls).toEqual([])
    // 普通账号但账号库不可解析:拒绝(VS owner 回退全局——多租户下绝不落全局)
    const deniedGateway = gatewayOf(isolationCtx({ principal: cherryPrincipal, globalMemory }))
    await expect(deniedGateway.trackCorrection({ section: '风格偏好' }))
      .resolves.toMatchObject({ ok: false, code: 'unavailable' })
    expect(globalCalls).toEqual([])
    // owner(本地流):全局服务(现行为)
    await expect(gatewayOf(isolationCtx({ globalMemory })).trackCorrection({ section: '风格偏好' }))
      .resolves.toMatchObject({ ok: true })
    expect(globalCalls).toEqual([{ section: '风格偏好', keyHint: '' }])
  })
})
