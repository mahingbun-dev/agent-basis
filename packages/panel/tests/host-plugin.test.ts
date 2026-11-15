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

  it('原型携带 @Remote marker(手工施加等价于装饰器糖):snapshot + review(M-M2 T9)+ trackCorrection(T13)', () => {
    const markers = remoteMethods(Object.create(EternaPanelGateway.prototype) as object)
    expect(markers).toHaveLength(3)
    expect(markers.map(marker => marker.method).sort()).toEqual(['review', 'snapshot', 'trackCorrection'])
    // typert mark() 规则:exportName 与方法同名时省略,网关按 exportName ?? method 解析
    const snapshot = markers.find(marker => marker.method === 'snapshot')
    expect(snapshot?.exportName ?? snapshot?.method).toBe('snapshot')
  })

  it('snapshot() 方法存在且返回 Promise', async () => {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway & { ctx: never }
    // 不经构造器(避免注册服务);直接验证方法体可调用——给伪 ctx 返回空状态。
    const fakeCtx = { get: (): undefined => undefined } as never
    Object.defineProperty(gateway, 'ctx', { value: fakeCtx })
    const result = await gateway.snapshot.call({ ctx: fakeCtx })
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
  const call = async (ctx: unknown, payload: unknown): Promise<{ ok: boolean; code?: string; message?: string }> =>
    await Promise.resolve(EternaPanelGateway.prototype.trackCorrection.call({ ctx }, payload))

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
