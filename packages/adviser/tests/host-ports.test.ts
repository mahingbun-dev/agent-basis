/**
 * Host 装配单测:端口在依赖缺席/存在时的行为,以及「不崩」的降级契约。
 *
 * 这些测试不 boot 真实 dsh(那是 /tmp 探针的事),而是用结构假 ctx
 * 验证:① 服务缺席时各端口返回空值而非抛异常;② parent 恒等校验靠端口
 * 自己解析出的真 Agent;③ 投递走 inject/followup 两个不同方法且不混用。
 */
import { describe, expect, it } from 'vitest'
import { ADVISER_SERVICE_ID, createHostPorts, mountAdviser } from '../src/host.ts'

/** 造一个最小 Agent 假件。 */
function fakeAgent(id: string, sink: { calls: string[] }) {
  return {
    id,
    inject: () => { sink.calls.push(`inject:${id}`) },
    followup: () => { sink.calls.push(`followup:${id}`) },
  }
}

/** 结构假 ctx:`get` 按名字返回,`provide` 记录调用。 */
function fakeCtx(services: Record<string, unknown>) {
  const provided: Array<{ id: string; value: unknown }> = []
  const ctx = {
    get: (name: string) => services[name],
    provide: (id: string, value: unknown) => {
      provided.push({ id, value })
      return () => { /* dispose */ }
    },
  }
  return { ctx: ctx as never, provided }
}

describe('createHostPorts:依赖缺席时降级而非抛', () => {
  it('全空 ctx:getAgent/ensureAgent 返回 undefined,listDescendants 返回空表,投递返回 false', async () => {
    const { ctx } = fakeCtx({})
    const ports = createHostPorts(ctx)
    expect(ports.getAgent('s1')).toBeUndefined()
    expect(await ports.ensureAgent('s1')).toBeUndefined()
    expect(await ports.listDescendants('p1')).toEqual([])
    expect(ports.inject('s1', 'x')).toBe(false)
    expect(ports.followup('s1', 'x')).toBe(false)
  })

  it('ctx.get 抛错(未 inject 声明)也不炸', () => {
    const ctx = { get: () => { throw new Error('cannot get property "agents" without inject') } } as never
    const ports = createHostPorts(ctx)
    expect(ports.getAgent('s1')).toBeUndefined()
    expect(ports.inject('s1', 'x')).toBe(false)
  })

  it('startActivation 无 subagents 服务时抛(由服务面映射为 preset-missing/unavailable)', async () => {
    const { ctx } = fakeCtx({})
    const ports = createHostPorts(ctx)
    await expect(ports.startActivation({
      provider: 'fork', label: 'adviser', name: 'adviser-1', childId: 'c1',
      request: { parent: { id: 'p1' }, prompt: [{ type: 'text', text: 'x' }], agentPreset: 'eterna-adviser' },
      signal: new AbortController().signal, delivery: 'caller',
    })).rejects.toThrow(/subagents/)
  })
})

describe('createHostPorts:parent 恒等校验', () => {
  it('startActivation 用端口自己解析出的真 Agent 作 parent(不信任传入结构件)', async () => {
    const sink = { calls: [] as string[] }
    const realParent = fakeAgent('p1', sink)
    let seenParent: unknown
    const { ctx } = fakeCtx({
      agents: { get: (id: string) => (id === 'p1' ? realParent : undefined) },
      subagents: {
        startActivation: async (spec: { request: { parent: unknown } }) => {
          seenParent = spec.request.parent
          return { childId: 'c1', messageId: 'm1' }
        },
        listDescendants: async () => [],
      },
    })
    const ports = createHostPorts(ctx)
    const result = await ports.startActivation({
      provider: 'fork', label: 'adviser', name: 'adviser-1', childId: 'c1',
      request: { parent: { id: 'p1' }, prompt: [{ type: 'text', text: 'x' }], agentPreset: 'eterna-adviser' },
      signal: new AbortController().signal, delivery: 'caller',
    })
    expect(seenParent).toBe(realParent)   // 同一个对象引用
    expect(result).toEqual({ childId: 'c1', messageId: 'm1' })
  })

  it('父会话解析不到时 startActivation 抛 parent-missing(不伪造)', async () => {
    const { ctx } = fakeCtx({
      subagents: { startActivation: async () => ({ childId: 'c1' }), listDescendants: async () => [] },
    })
    const ports = createHostPorts(ctx)
    await expect(ports.startActivation({
      provider: 'fork', label: 'adviser', name: 'adviser-1', childId: 'c1',
      request: { parent: { id: 'gone' }, prompt: [], agentPreset: 'eterna-adviser' },
      signal: new AbortController().signal, delivery: 'caller',
    })).rejects.toThrow(/parent-missing/)
  })
})

describe('createHostPorts:冷恢复委托 sessionController', () => {
  it('live 缺席时用 controller.resolveAgent 的返回', async () => {
    const sink = { calls: [] as string[] }
    const resumed = fakeAgent('p1', sink)
    let asked: string | undefined
    const { ctx } = fakeCtx({
      agents: { get: () => undefined },
      sessionController: {
        resolveAgent: async (id: string) => {
          asked = id
          return { agent: resumed }
        },
      },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.ensureAgent('p1')).toBe(resumed)
    expect(asked).toBe('p1')
  })

  it('controller 抛错(subagent 归属/不存在)收敛成 undefined', async () => {
    const { ctx } = fakeCtx({
      agents: { get: () => undefined },
      sessionController: { resolveAgent: async () => { throw new Error('session/agent-busy') } },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.ensureAgent('s1')).toBeUndefined()
  })

  it('live 优先:controller 存在也不调它', async () => {
    const sink = { calls: [] as string[] }
    const live = fakeAgent('p1', sink)
    let controllerCalled = false
    const { ctx } = fakeCtx({
      agents: { get: () => live },
      sessionController: { resolveAgent: async () => { controllerCalled = true; return { agent: live } } },
    })
    const ports = createHostPorts(ctx)
    expect(ports.getAgent('p1')).toBe(live)
    await ports.ensureAgent('p1')
    expect(controllerCalled).toBe(false)
  })
})

describe('createHostPorts:listDescendants 映射', () => {
  it('丢弃空 id 行;label/activity 按存在性透传', async () => {
    const { ctx } = fakeCtx({
      subagents: {
        startActivation: async () => ({ childId: 'x' }),
        listDescendants: async () => [
          { id: 'a1', label: 'adviser', activity: 'running' },
          { id: 'x1' },
          { id: '', label: 'adviser' },
          {},
        ],
      },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.listDescendants('p1')).toEqual([
      { id: 'a1', label: 'adviser', activity: 'running' },
      { id: 'x1' },
    ])
  })

  it('catalog 读失败时返回空表(不把异常抛给服务面)', async () => {
    const { ctx } = fakeCtx({
      subagents: {
        startActivation: async () => ({ childId: 'x' }),
        listDescendants: async () => { throw new Error('projection unavailable') },
      },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.listDescendants('p1')).toEqual([])
  })
})

describe('createHostPorts:投递分流', () => {
  it('inject 只调 agent.inject,followup 只调 agent.followup', () => {
    const sink = { calls: [] as string[] }
    const agent = fakeAgent('p1', sink)
    const { ctx } = fakeCtx({ agents: { get: () => agent } })
    const ports = createHostPorts(ctx)
    expect(ports.inject('p1', 'x')).toBe(true)
    expect(ports.followup('p1', 'y')).toBe(true)
    expect(sink.calls).toEqual(['inject:p1', 'followup:p1'])
  })

  it('agent 方法抛错时返回 false(不误报成功)', () => {
    const { ctx } = fakeCtx({
      agents: { get: () => ({ id: 'p1', inject: () => { throw new Error('boom') }, followup: () => { throw new Error('boom') } }) },
    })
    const ports = createHostPorts(ctx)
    expect(ports.inject('p1', 'x')).toBe(false)
    expect(ports.followup('p1', 'x')).toBe(false)
  })
})

describe('createHostPorts:服务懒解析(不在 apply 时固化快照)', () => {
  /**
   * 实机坑(2026-11-24 E2E 实证):插件装载顺序由服务可用性驱动,adviser 常在
   * agents/subagents 注册之前 apply。若在 apply 时把 `ctx.get(...)` 存成闭包常量,
   * 它会永久为 undefined——list 恒空、create 恒 parent-missing,而 ctx.get 其实已就绪。
   */
  it('构造端口时服务缺席,之后出现 → 端口立即生效(证明是现读而非快照)', async () => {
    const sink = { calls: [] as string[] }
    const parent = fakeAgent('p1', sink)
    const services: Record<string, unknown> = {}   // 构造时全空
    const ctx = { get: (name: string) => services[name] } as never

    const ports = createHostPorts(ctx)
    expect(ports.getAgent('p1')).toBeUndefined()   // 此刻确实没有

    // 之后宿主把服务挂上(真实装载顺序)
    services.agents = { get: (id: string) => (id === 'p1' ? parent : undefined) }
    services.subagents = {
      startActivation: async () => ({ childId: 'c1', messageId: 'm1' }),
      listDescendants: async () => [{ id: 'a1', label: 'adviser', activity: 'running' }],
    }

    expect(ports.getAgent('p1')).toBe(parent)                       // create 的父解析可用
    expect(await ports.listDescendants('p1')).toEqual([{ id: 'a1', label: 'adviser', activity: 'running' }])
    expect(ports.inject('p1', 'x')).toBe(true)
    expect(sink.calls).toEqual(['inject:p1'])
  })

  it('构造端口时服务在场,之后卸载 → 端口立即降级(不握着悬空引用)', async () => {
    const sink = { calls: [] as string[] }
    const parent = fakeAgent('p1', sink)
    const services: Record<string, unknown> = { agents: { get: () => parent } }
    const ports = createHostPorts({ get: (name: string) => services[name] } as never)
    expect(ports.getAgent('p1')).toBe(parent)
    delete services.agents
    expect(ports.getAgent('p1')).toBeUndefined()
  })
})

describe('createHostPorts:模型继承与独立切换(2026-11-25)', () => {
  it('parentModel 读 agent.model.current();无模型面=undefined', () => {
    const { ctx } = fakeCtx({
      agents: {
        get: (id: string) => id === 'p1'
          ? { ...fakeAgent('p1', { calls: [] }), model: { current: () => ({ provider: 'r', model: 'm', reasoningEffort: 'high', extra: 1 }) } }
          : fakeAgent(id, { calls: [] }),
      },
    })
    const ports = createHostPorts(ctx)
    expect(ports.parentModel('p1')).toEqual({ provider: 'r', model: 'm', reasoningEffort: 'high' })
    expect(ports.parentModel('plain')).toBeUndefined()   // 假件没有 model 面
  })

  it('readModel:live 优先读 model.current()', async () => {
    const { ctx } = fakeCtx({
      agents: {
        get: () => ({ ...fakeAgent('c1', { calls: [] }), model: { current: () => ({ provider: 'r', model: 'm' }) } }),
      },
      // query 即便在场也不该被 live 路径调用
      sessionQuery: { observeSession: async () => { throw new Error('should not be called') } },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.readModel('c1')).toEqual({ provider: 'r', model: 'm' })
  })

  it('readModel:冷会话读 modelSelection 投影(next 优先),并在用后释放观察', async () => {
    let disposed = false
    const { ctx } = fakeCtx({
      sessionQuery: {
        observeSession: async (id: string, options: { projectionMode?: string }) => {
          expect(id).toBe('c1')
          expect(options.projectionMode).toBe('all')
          return {
            projections: { values: { modelSelection: { lastUsed: { provider: 'r', model: 'old' }, next: { provider: 'r', model: 'new' } } } },
            [Symbol.dispose]: () => { disposed = true },
          }
        },
      },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.readModel('c1')).toEqual({ provider: 'r', model: 'new' })
    expect(disposed).toBe(true)
  })

  it('readModel:投影缺席 next 时回退 lastUsed;观察异常收敛为 undefined', async () => {
    const { ctx } = fakeCtx({
      sessionQuery: {
        observeSession: async (id: string) => {
          if (id === 'boom') throw new Error('not found')
          return {
            projections: { values: { modelSelection: { lastUsed: { provider: 'r', model: 'used' }, next: null } } },
            [Symbol.dispose]: () => {},
          }
        },
      },
    })
    const ports = createHostPorts(ctx)
    expect(await ports.readModel('c1')).toEqual({ provider: 'r', model: 'used' })
    expect(await ports.readModel('boom')).toBeUndefined()
  })

  it('writeModel:live 走 model.select(带接收者),并先用 llm 校验可用性', async () => {
    const calls: string[] = []
    const model = {
      select(this: unknown, selection: { provider: string; model: string }) {
        calls.push(`select:${this === model ? 'receiver' : 'detached'}:${selection.provider}/${selection.model}`)
      },
    }
    const { ctx } = fakeCtx({
      agents: { get: () => ({ ...fakeAgent('c1', { calls: [] }), model }) },
      llm: { resolveCallConfig: async (selection: unknown) => { calls.push(`validate:${JSON.stringify(selection)}`); return selection } },
    })
    const ports = createHostPorts(ctx)
    await ports.writeModel('c1', { provider: 'r', model: 'm', reasoningEffort: 'low' })
    expect(calls).toEqual([
      'validate:{"provider":"r","model":"m","reasoningEffort":"low"}',
      'select:receiver:r/m',
    ])
  })

  it('writeModel:模型不可用(llm 拒绝)→ AdviserModelRejection(invalid),不调 select', async () => {
    let selected = false
    const { ctx } = fakeCtx({
      agents: {
        get: () => ({ ...fakeAgent('c1', { calls: [] }), model: { select: () => { selected = true } } }),
      },
      llm: { resolveCallConfig: async () => { throw new Error('unknown route') } },
    })
    const ports = createHostPorts(ctx)
    await expect(ports.writeModel('c1', { provider: 'nope', model: 'x' }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(selected).toBe(false)
  })

  it('writeModel:冷会话向持久化追加 model/selection(seq 取 stat.eventCount),flush 后关句柄', async () => {
    const calls: string[] = []
    let opened: string | undefined
    let appended: readonly unknown[] = []
    const handle = {
      read: async () => { calls.push('read'); return { events: [] } },
      append: async (events: readonly unknown[]) => { appended = events; calls.push('append') },
      flush: async () => { calls.push('flush') },
      close: async () => { calls.push('close') },
    }
    const { ctx } = fakeCtx({
      sessionPersistence: {
        stat: async () => ({ eventCount: 7 }),
        open: async (id: string, access: string) => { opened = `${id}/${access}`; return handle },
      },
    })
    const ports = createHostPorts(ctx)
    await ports.writeModel('c1', { provider: 'r', model: 'm' })
    const events = appended as readonly { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }[]
    expect(opened).toBe('c1/write')
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('model/selection')
    expect(events[0]?.seq).toBe(7)
    expect(typeof events[0]?.time).toBe('number')
    expect(events[0]?.data).toEqual({ provider: 'r', model: 'm' })
    // stat.eventCount 可用时不读全量日志;持久化屏障在关句柄之前。
    expect(calls).toEqual(['append', 'flush', 'close'])
  })

  it('writeModel:stat 无 eventCount 时读日志末条 seq+1(冷会话低频路径)', async () => {
    let appended: readonly { seq?: unknown }[] = []
    const { ctx } = fakeCtx({
      sessionPersistence: {
        stat: async () => ({}),
        open: async () => ({
          read: async () => ({ events: [{ seq: 4 }, { seq: 5 }] }),
          append: async (events: readonly { seq?: unknown }[]) => { appended = events },
          flush: async () => {},
          close: async () => {},
        }),
      },
    })
    const ports = createHostPorts(ctx)
    await ports.writeModel('c1', { provider: 'r', model: 'm' })
    expect(appended[0]?.seq).toBe(6)
  })

  it('writeModel:冷会话写句柄被占用 → AdviserModelRejection(unavailable)', async () => {
    const { ctx } = fakeCtx({
      sessionPersistence: {
        stat: async () => ({ eventCount: 0 }),
        open: async () => { throw new Error('session already owned') },
      },
    })
    const ports = createHostPorts(ctx)
    await expect(ports.writeModel('c1', { provider: 'r', model: 'm' }))
      .rejects.toMatchObject({ code: 'unavailable' })
  })

  it('writeModel:既非 live 也无持久化 → unavailable', async () => {
    const { ctx } = fakeCtx({})
    const ports = createHostPorts(ctx)
    await expect(ports.writeModel('c1', { provider: 'r', model: 'm' }))
      .rejects.toMatchObject({ code: 'unavailable' })
  })

  it('startActivation 把 inherited agentOptions 双写(rc 顶层 + alpha request 装箱)', async () => {
    const parent = fakeAgent('p1', { calls: [] })
    let seen: Record<string, unknown> | undefined
    const { ctx } = fakeCtx({
      agents: { get: () => parent },
      subagents: {
        startActivation: async (spec: Record<string, unknown>) => { seen = spec; return { childId: 'c1' } },
        listDescendants: async () => [],
      },
    })
    const ports = createHostPorts(ctx)
    await ports.startActivation({
      provider: 'spawn', label: 'adviser', name: 'adviser-1', childId: 'c1',
      request: {
        parent: { id: 'p1' },
        prompt: [{ type: 'text', text: 'x' }],
        agentPreset: 'eterna-adviser',
        agentOptions: { provider: 'r', model: 'm' },
      },
      signal: new AbortController().signal, delivery: 'caller',
    })
    expect(seen?.agentOptions).toEqual({ provider: 'r', model: 'm' })
    expect((seen?.request as { agentOptions?: unknown }).agentOptions).toEqual({ provider: 'r', model: 'm' })
  })
})

describe('mountAdviser', () => {
  it('以 ADVISER_SERVICE_ID provide 出服务对象', () => {
    const { ctx, provided } = fakeCtx({})
    const dispose = mountAdviser(ctx)
    expect(provided).toHaveLength(1)
    expect(provided[0]?.id).toBe(ADVISER_SERVICE_ID)
    expect(provided[0]?.id).toBe('eternaAdviser')
    expect(typeof dispose).toBe('function')
  })

  it('无 provide 的 ctx 返回空 disposer(不抛)', () => {
    const dispose = mountAdviser({ get: () => undefined } as never)
    expect(typeof dispose).toBe('function')
  })
})
