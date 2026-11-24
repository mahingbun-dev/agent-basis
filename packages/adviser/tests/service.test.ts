/**
 * AdviserService 单测:创建/上限/投递分流/失败码映射。
 *
 * 用结构端口假件(AdviserPorts)驱动——服务本身无 I/O,所有外部交互都在端口后面,
 * 因此这里能精确断言"调了什么、按什么顺序、失败时给什么码"。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ADVISER_LABEL,
  ADVISER_MAX_PER_PARENT,
  ADVISER_PRESET_ID,
  ADVISER_PROVIDER,
  AdviserService,
  mintAdviserSessionId,
  type AdviserActivationSpec,
  type AdviserPorts,
} from '../src/service.ts'

/** 调用记录(类型明确,避免 Record 索引在 noUncheckedIndexedAccess 下的 undefined)。 */
interface CallLog {
  readonly startActivation: AdviserActivationSpec[]
  readonly inject: { agentId: string; text: string }[]
  readonly followup: { agentId: string; text: string }[]
  readonly listDescendants: unknown[]
}

/** 可控假端口:记录全部调用,便于断言。 */
function makePorts(overrides: Partial<AdviserPorts> = {}): AdviserPorts & { calls: CallLog } {
  const calls: CallLog = { startActivation: [], inject: [], followup: [], listDescendants: [] }
  const base: AdviserPorts = {
    getAgent: sessionId => ({ id: sessionId }),
    ensureAgent: async sessionId => ({ id: sessionId }),
    startActivation: async (spec) => {
      calls.startActivation.push(spec)
      return { childId: spec.childId, messageId: 'msg-1' }
    },
    listDescendants: async () => {
      calls.listDescendants.push({})
      return []
    },
    inject: (agentId, text) => { calls.inject.push({ agentId, text }); return true },
    followup: (agentId, text) => { calls.followup.push({ agentId, text }); return true },
    ...overrides,
  }
  return { ...base, calls }
}

describe('list:只认 label=adviser 的 catalog 行', () => {
  it('过滤掉非参谋 child,并映射 activity', async () => {
    const ports = makePorts({
      listDescendants: async () => [
        { id: 'a1', label: ADVISER_LABEL, activity: 'running' },
        { id: 'w1', label: 'other-worker', activity: 'running' },
        { id: 'a2', label: ADVISER_LABEL, activity: 'inactive' },
        { id: 'x1' },
      ],
    })
    const service = new AdviserService(ports)
    const rows = await service.list('parent-1')
    expect(rows).toEqual([
      { sessionId: 'a1', label: ADVISER_LABEL, activity: 'running' },
      { sessionId: 'a2', label: ADVISER_LABEL, activity: 'inactive' },
    ])
  })
})

describe('create:fork + label + caller delivery', () => {
  it('用正确参数起 activation(P0 实测签名:parent/prompt 在 request 内)', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const result = await service.create('parent-1', '请帮我看看这个方案')
    expect(result.ok).toBe(true)
    const spec = ports.calls.startActivation[0]!
    expect(spec.provider).toBe('spawn')
    expect(spec.label).toBe(ADVISER_LABEL)
    expect(spec.delivery).toBe('caller')
    expect(spec.request).toEqual({
      parent: { id: 'parent-1' },
      prompt: [{ type: 'text', text: '请帮我看看这个方案' }],
      agentPreset: 'eterna-adviser',
    })
  })

  it('provider 必须是 spawn:fork 硬拒独立 preset(参谋会拿到父会话完整工具面)', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    await service.create('parent-1', 'x')
    const spec = ports.calls.startActivation[0]!
    // 上游 subagent-fork-in-process: capabilities.agentPreset=false + inheritsParentContext=true
    // → assertCapabilities 抛 UNSUPPORTED_CAPABILITY。故参谋只能走 spawn。
    expect(spec.provider).toBe(ADVISER_PROVIDER)
    expect(spec.provider).not.toBe('fork')
  })

  it('必传 eterna-adviser preset:省缺会继承父会话完整工具面(只读纪律失效)', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    await service.create('parent-1', 'x')
    const spec = ports.calls.startActivation[0]!
    // 上游 subagent/child-agent.ts:142 的语义:
    //   agentPreset = selectedPreset ?? parent.ctx.get('agentPresets').composedPreset(parent.ctx)
    // 即「不传 = 继承父会话」。参谋必须用只读 preset,故该字段不可省。
    expect(spec.request.agentPreset).toBe(ADVISER_PRESET_ID)
    expect(spec.request.agentPreset).toBe('eterna-adviser')
  })

  it('id 确定性推导:同一父会话第 n 个参谋 id 可复算(多开与恢复不靠额外登记表)', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const first = await service.create('parent-1', '第一条')
    expect(first.ok && first.sessionId).toBe(mintAdviserSessionId('parent-1', 1))
  })

  it('显式 childId 优先于推导值', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const result = await service.create('parent-1', 'x', 'custom-id')
    expect(result.ok && result.sessionId).toBe('custom-id')
  })

  it('达到上限时拒绝,且不调用 startActivation', async () => {
    const ports = makePorts({
      listDescendants: async () => Array.from({ length: ADVISER_MAX_PER_PARENT }, (_unused, i) => ({
        id: `a${i}`, label: ADVISER_LABEL, activity: 'inactive' as const,
      })),
    })
    const service = new AdviserService(ports)
    const result = await service.create('parent-1', 'x')
    expect(result).toMatchObject({ ok: false, code: 'limit' })
    expect(ports.calls.startActivation).toHaveLength(0)
  })

  it('父会话取不到 → parent-missing,不调用 startActivation', async () => {
    const ports = makePorts({
      getAgent: () => undefined,
      ensureAgent: async () => undefined,
    })
    const service = new AdviserService(ports)
    const result = await service.create('gone', 'x')
    expect(result).toMatchObject({ ok: false, code: 'parent-missing' })
    expect(ports.calls.startActivation).toHaveLength(0)
  })

  it('父会话不 live 时走 ensureAgent 冷恢复', async () => {
    const ensureAgent = vi.fn(async (id: string) => ({ id }))
    const ports = makePorts({ getAgent: () => undefined, ensureAgent })
    const service = new AdviserService(ports)
    await service.create('cold-parent', 'x')
    expect(ensureAgent).toHaveBeenCalledWith('cold-parent')
  })

  it('preset 装配失败映射为 preset-missing(中文消息透出根因)', async () => {
    const ports = makePorts({
      startActivation: async () => { throw new Error('agent-preset/invalid: tool-fs-search missing required value') },
    })
    const service = new AdviserService(ports)
    const result = await service.create('parent-1', 'x')
    expect(result).toMatchObject({ ok: false, code: 'preset-missing' })
    if (!result.ok) expect(result.message).toContain('参谋组合')
  })

  it('未知异常映射为 unavailable(失败码是闭集)', async () => {
    const ports = makePorts({
      startActivation: async () => { throw new Error('boom') },
    })
    const service = new AdviserService(ports)
    const result = await service.create('parent-1', 'x')
    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
  })
})

describe('deliver:双通道分流(inject 不唤醒 / followup 自成一轮)', () => {
  it('inject 只调 inject,不调 followup', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const result = await service.deliver('parent-1', '结论:建议选 B', 'inject')
    expect(result).toEqual({ ok: true, delivery: 'inject', sessionId: 'parent-1' })
    expect(ports.calls.inject).toEqual([{ agentId: 'parent-1', text: '结论:建议选 B' }])
    expect(ports.calls.followup).toHaveLength(0)
  })

  it('followup 只调 followup,不调 inject', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const result = await service.deliver('parent-1', '结论:请立即执行', 'followup')
    expect(result).toEqual({ ok: true, delivery: 'followup', sessionId: 'parent-1' })
    expect(ports.calls.followup).toEqual([{ agentId: 'parent-1', text: '结论:请立即执行' }])
    expect(ports.calls.inject).toHaveLength(0)
  })

  it('空内容拒绝(invalid),不投递', async () => {
    const ports = makePorts()
    const service = new AdviserService(ports)
    const result = await service.deliver('parent-1', '   \n\t ', 'inject')
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    expect(ports.calls.inject).toHaveLength(0)
  })

  it('投递被拒(inject 返回 false)→ unavailable,不误报成功', async () => {
    const ports = makePorts({ inject: () => false })
    const service = new AdviserService(ports)
    const result = await service.deliver('parent-1', 'x', 'inject')
    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('主会话不在 live 面时走 ensureAgent 冷恢复后投递', async () => {
    const ensureAgent = vi.fn(async (id: string) => ({ id }))
    const ports = makePorts({ getAgent: () => undefined, ensureAgent })
    const service = new AdviserService(ports)
    const result = await service.deliver('cold', 'x', 'followup')
    expect(ensureAgent).toHaveBeenCalledWith('cold')
    expect(result.ok).toBe(true)
  })

  it('冷恢复也失败 → parent-missing', async () => {
    const ports = makePorts({ getAgent: () => undefined, ensureAgent: async () => undefined })
    const service = new AdviserService(ports)
    const result = await service.deliver('gone', 'x', 'inject')
    expect(result).toMatchObject({ ok: false, code: 'parent-missing' })
  })
})

describe('服务面不自行 provide(铁律 T2 的结构约束)', () => {
  it('default export 的 apply 不注册任何 webServer/connection 路由', async () => {
    const plugin = (await import('../src/service.ts')).default
    const registered: string[] = []
    const ctx = {
      webServer: { register: () => { registered.push('webServer.register'); return () => {} } },
      connection: { register: () => { registered.push('connection.register'); return () => {} } },
    }
    const dispose = plugin.apply(ctx as never)
    expect(registered).toEqual([])
    expect(typeof dispose).toBe('function')
  })
})
