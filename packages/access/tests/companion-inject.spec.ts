/**
 * companion 身份注入单测（2026-11-13 注入点重做）：内核在 pre-execute 前 deepFreeze
 * arguments 且合同禁止改写（companion-inject.ts 头注详述），注入走 tools.executable
 * 分发边界 wrap——冻结 args 展开成新对象后注入，绝不触碰冻结原件。
 * 本测试以 Object.freeze 钉死该不变量（原实现在此处必炸：Cannot add property
 * _eternaToken, object is not extensible，2026-11-12 生产事故）。
 */
import { describe, expect, it } from 'vitest'
import {
  companionShadowDefinition,
  installCompanionExecutableWrap,
  readToolsService,
  routeCompanion,
  type CompanionInjectDeps,
  type ExecutableCapable,
  type ToolDefinitionLike,
} from '../src/companion-inject.ts'
import { COMPANION_TOKEN_MISSING_REASON } from '../src/companion.ts'

const deps: CompanionInjectDeps = {
  sessionOwner: id => (id === 's-known' ? 7 : undefined),
  tokenOf: id => (id === 7 ? 'ec-token-7' : undefined),
}

/** 模拟内核 ToolRunContext 的结构面。 */
function execOf(sessionId: string | undefined): unknown {
  return { agent: { session: { id: sessionId } } }
}

/** 假工具定义：记录实际收到的 args（dispatch 边界的真实入参）。携带内核消费的
 * name/output 面（createSuccessResult 读 output.schema/render——shadow 必须透传）。 */
function recordingDef(): { def: ToolDefinitionLike & Record<string, unknown>; seen: unknown[] } {
  const seen: unknown[] = []
  const def: ToolDefinitionLike & Record<string, unknown> = {
    execute: async (args) => {
      seen.push(args)
      return { ok: true }
    },
    name: 'mcp__browser__browser_snapshot',
    description: 'snapshot',
    output: {
      schema: { type: 'object' },
      render: () => [{ type: 'text', text: 'rendered' }],
    },
  }
  return { def, seen }
}

describe('companion:routeCompanion', () => {
  it('未知会话/无会话 → passthrough；已知归属未生成令牌 → deny；有令牌 → inject', () => {
    expect(routeCompanion(deps, 's-unknown')).toEqual({ kind: 'passthrough' })
    expect(routeCompanion(deps, undefined)).toEqual({ kind: 'passthrough' })
    expect(routeCompanion(deps, '')).toEqual({ kind: 'passthrough' })
    expect(routeCompanion(deps, 's-known')).toEqual({ kind: 'inject', token: 'ec-token-7' })
    expect(routeCompanion({ sessionOwner: () => 9, tokenOf: () => undefined }, 's-x')).toEqual({
      kind: 'deny',
      reason: COMPANION_TOKEN_MISSING_REASON,
    })
  })
})

describe('companion:companionShadowDefinition', () => {
  it('冻结 args 不被触碰；令牌注入发生在展开的新对象上（内核 deepFreeze 不变量）', async () => {
    const { def, seen } = recordingDef()
    const shadow = companionShadowDefinition(def, deps)
    const frozenArgs = Object.freeze({ url: 'https://www.baidu.com/' })
    const returned = await shadow.execute(frozenArgs, execOf('s-known'))
    expect(returned).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    const dispatched = seen[0] as Record<string, unknown>
    expect(dispatched).toEqual({ url: 'https://www.baidu.com/', _eternaToken: 'ec-token-7' })
    // 原件仍是冻结的纯净对象：无 token 键、不可写
    expect(Object.isFrozen(frozenArgs)).toBe(true)
    expect(Object.keys(frozenArgs)).toEqual(['url'])
  })

  it('shadow 透传原定义其余字段——内核成功路径读 output.schema/render（2026-11-13 生产事故回归：只返回 {execute} 时成功调用必炸 reading \'schema\'）', async () => {
    const { def, seen } = recordingDef()
    const shadow = companionShadowDefinition(def, deps)
    // 内核 createSuccessResult 的消费形态:成功结果按 output.schema 校验、output.render 投影
    expect((shadow as Record<string, unknown>)['output']).toBe(def.output)
    expect(((shadow as Record<string, unknown>)['output'] as { schema: unknown }).schema).toEqual({ type: 'object' })
    expect((shadow as Record<string, unknown>)['name']).toBe('mcp__browser__browser_snapshot')
    expect((shadow as Record<string, unknown>)['description']).toBe('snapshot')
    await shadow.execute(Object.freeze({ url: 'https://x' }), execOf('s-known'))
    expect(seen).toHaveLength(1)
    // execute 是换面:shadow.execute !== def.execute
    expect(shadow.execute).not.toBe(def.execute)
  })

  it('模型伪造的 _eternaToken 被服务端值覆盖（服务端值赢）', async () => {
    const { def, seen } = recordingDef()
    const shadow = companionShadowDefinition(def, deps)
    await shadow.execute(Object.freeze({ url: 'https://x', _eternaToken: 'ec-forged' }), execOf('s-known'))
    expect((seen[0] as Record<string, unknown>)['_eternaToken']).toBe('ec-token-7')
  })

  it('未知会话 passthrough：原 args 原样下发（不注入）', async () => {
    const { def, seen } = recordingDef()
    const shadow = companionShadowDefinition(def, deps)
    const frozenArgs = Object.freeze({ url: 'https://x' })
    await shadow.execute(frozenArgs, execOf('s-unknown'))
    expect(seen[0]).toBe(frozenArgs)
  })

  it('已知归属未生成令牌 → throw 共享文案（内核物化为 Error: ${message}，同 pre-execute deny 形态）', async () => {
    const { def } = recordingDef()
    const shadow = companionShadowDefinition(def, { sessionOwner: () => 9, tokenOf: () => undefined })
    await expect(shadow.execute({}, execOf('s-known'))).rejects.toThrow(COMPANION_TOKEN_MISSING_REASON)
  })

  it('非对象 args（缺省/标量）也能注入', async () => {
    const { def, seen } = recordingDef()
    const shadow = companionShadowDefinition(def, deps)
    await shadow.execute(undefined, execOf('s-known'))
    expect(seen[0]).toEqual({ _eternaToken: 'ec-token-7' })
  })
})

describe('companion:installCompanionExecutableWrap', () => {
  function fakeTools(defs: Record<string, ToolDefinitionLike | undefined>): ExecutableCapable {
    return {
      executable: name => defs[name],
    }
  }

  it('browser 工具拿 shadow（execute 换面）；非 browser 拿原定义同一引用；未知名 undefined', async () => {
    const { def: browserDef, seen } = recordingDef()
    const otherDef: ToolDefinitionLike = { execute: async () => 'other' }
    const tools = fakeTools({ 'mcp__browser__browser_snapshot': browserDef, bash: otherDef })
    const dispose = installCompanionExecutableWrap(tools, deps)
    const shadow = tools.executable('mcp__browser__browser_snapshot')
    expect(shadow).not.toBe(browserDef)
    expect(shadow?.execute).not.toBe(browserDef.execute)
    await shadow?.execute(Object.freeze({ url: 'https://x' }), execOf('s-known'))
    expect((seen[0] as Record<string, unknown>)['_eternaToken']).toBe('ec-token-7')
    expect(tools.executable('bash')).toBe(otherDef)
    expect(tools.executable('definitely_not_registered')).toBeUndefined()
    dispose()
  })

  it('shadow 按原定义缓存（同一注册多次解析不重复包装）', () => {
    const { def: browserDef } = recordingDef()
    const tools = fakeTools({ 'mcp__browser__browser_click': browserDef })
    const dispose = installCompanionExecutableWrap(tools, deps)
    const first = tools.executable('mcp__browser__browser_click')
    const second = tools.executable('mcp__browser__browser_click')
    expect(first).toBe(second)
    dispose()
  })

  it('disposer 还原 executable（卸载后回到原方法）', () => {
    const { def: browserDef } = recordingDef()
    const tools = fakeTools({ 'mcp__browser__browser_snapshot': browserDef })
    const dispose = installCompanionExecutableWrap(tools, deps)
    dispose()
    expect(tools.executable('mcp__browser__browser_snapshot')).toBe(browserDef)
  })
})

describe('companion:readToolsService（2026-11-13 线上事故回归）', () => {
  it('cordis 过滤上下文 get trap 抛错 → 降级 undefined,不外抛', () => {
    // 真实形态:声明 inject 清单的 ctx 访问未声明服务,proxy get 直接 throw
    // (`cannot get property "tools" without inject`,cordis ReflectService.handler.get)。
    const hostileCtx = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'tools') throw new Error('cannot get property "tools" without inject')
        return undefined
      },
    })
    expect(readToolsService(hostileCtx)).toBeUndefined()
  })

  it('正常 ctx:tools 服务原样返回;tools 缺席/null 形态 → undefined', () => {
    const tools: ExecutableCapable = { executable: () => undefined }
    expect(readToolsService({ tools })).toBe(tools)
    expect(readToolsService({})).toBeUndefined()
    expect(readToolsService({ tools: null })).toBeUndefined()
    expect(readToolsService(undefined)).toBeUndefined()
  })
})
