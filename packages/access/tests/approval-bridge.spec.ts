/**
 * 工具审批桥单测(2026-11-13):web 前端无审批面,治理 ask 挂死不可见——本桥在
 * 宿主接 approval/request waterfall,按会话归属暴露给本人浏览器裁决。
 * 钉死:归属路由(未知会话透传/已知会话登记)、裁决语义(allowed-once/rejected)、
 * 超时 unavailable、signal abort cancelled、跨用户裁决拒绝、审计三事件。
 */
import { describe, expect, it } from 'vitest'
import { ApprovalBridge, toolApprovalTimeoutMs, type ToolApprovalView } from '../src/approval-bridge.ts'
import type { AccessAuditEvent } from '../src/audit.ts'

interface FakeCtx {
  readonly handlers: Map<string, Array<(request: unknown, next: () => unknown) => unknown>>
  on(event: string, listener: (request: unknown, next: () => unknown) => unknown): () => void
}

function fakeCtx(): FakeCtx {
  const handlers = new Map<string, Array<(request: unknown, next: () => unknown) => unknown>>()
  return {
    handlers,
    on(event, listener) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return () => {
        handlers.set(event, list.filter(l => l !== listener))
      }
    },
  }
}

function requestOf(sessionId: string | undefined, toolName = 'working_directory', extra: { signal?: AbortSignal } = {}): unknown {
  return {
    toolName,
    callId: 'call_1',
    reason: '治理策略要求人工确认',
    agent: { session: { id: sessionId } },
    ...extra.signal !== undefined ? { signal: extra.signal } : {},
  }
}

function makeBridge(overrides: Partial<{ sessionOwner: (id: string) => number | undefined; timeoutMs: number }> = {}): {
  bridge: ApprovalBridge
  audits: AccessAuditEvent[]
} {
  const audits: AccessAuditEvent[] = []
  const bridge = new ApprovalBridge({
    sessionOwner: overrides.sessionOwner ?? (id => (id === 's-7' ? 7 : undefined)),
    audit: (event) => { audits.push(event) },
    timeoutMs: overrides.timeoutMs ?? 60_000,
  })
  return { bridge, audits }
}

describe('approval-bridge:installAnswerer', () => {
  it('未知会话 next() 透传;已知归属返回 pending promise 并登记', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    expect(listener).toBeDefined()

    const sentinel = { skipped: true }
    const passthrough = listener?.(requestOf(undefined), () => sentinel)
    expect(passthrough).toBe(sentinel) // 同一引用=透传

    const pending = listener?.(requestOf('s-7'), () => 'unavailable') as Promise<string>
    expect(pending).toBeInstanceOf(Promise)
    expect(bridge.listFor(7)).toHaveLength(1)
    expect(bridge.listFor(8)).toHaveLength(0) // 非归属人不可见
    bridge.decide(bridge.listFor(7)[0]?.id ?? '', 7, true)
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('非对象请求透传', () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const sentinel = { skipped: true }
    expect(listener?.(null, () => sentinel)).toBe(sentinel)
  })
})

describe('approval-bridge:decide', () => {
  it('本人允许/拒绝 → allowed-once/rejected', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const p1 = listener?.(requestOf('s-7'), () => 'unavailable') as Promise<string>
    const id1 = bridge.listFor(7)[0]?.id ?? ''
    bridge.decide(id1, 7, true)
    await expect(p1).resolves.toBe('allowed-once')

    const p2 = listener?.(requestOf('s-7'), () => 'unavailable') as Promise<string>
    const id2 = bridge.listFor(7)[0]?.id ?? ''
    expect(id2).not.toBe(id1)
    bridge.decide(id2, 7, false)
    await expect(p2).resolves.toBe('rejected')
  })

  it('跨用户/未知名裁决一律 false(不收场原条目)', () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    void listener?.(requestOf('s-7'), () => 'unavailable')
    const id = bridge.listFor(7)[0]?.id ?? ''
    expect(bridge.decide(id, 8, true)).toBe(false) // 非归属人
    expect(bridge.decide('nope', 7, true)).toBe(false) // 不存在
    expect(bridge.listFor(7)).toHaveLength(1) // 条目仍在
  })
})

describe('approval-bridge:超时与中止', () => {
  it('超时未决 → unavailable(不冒充用户拒绝),条目消失', async () => {
    const { bridge } = makeBridge({ timeoutMs: 30 })
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const pending = listener?.(requestOf('s-7'), () => 'unavailable') as Promise<string>
    await expect(pending).resolves.toBe('unavailable')
    expect(bridge.listFor(7)).toHaveLength(0)
  }, 5_000)

  it('signal abort → cancelled 且条目清理(与内核 decide 的 abort 竞速语义对齐)', async () => {
    const { bridge, audits } = makeBridge({ timeoutMs: 60_000 })
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const controller = new AbortController()
    const pending = listener?.(requestOf('s-7', 'working_directory', { signal: controller.signal }), () => 'unavailable') as Promise<string>
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(bridge.listFor(7)).toHaveLength(0)
    const kinds = audits.map(event => event.kind)
    expect(kinds).toContain('access.approval.surfaced')
  })

  it('无 signal 形态的请求也能正常登记与裁决(结构面兼容)', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const bare = { toolName: 'bash', agent: { session: { id: 's-7' } } }
    const pending = listener?.(bare, () => 'unavailable') as Promise<string>
    bridge.decide(bridge.listFor(7)[0]?.id ?? '', 7, true)
    await expect(pending).resolves.toBe('allowed-once')
  })
})

describe('approval-bridge:视图与审计', () => {
  it('视图字段完整且按时间排序;审计出 surfaced/decided 两事件', async () => {
    const { bridge, audits } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    void listener?.(requestOf('s-7', 'tool_a'), () => 'unavailable')
    void listener?.(requestOf('s-7', 'tool_b'), () => 'unavailable')
    const list: ToolApprovalView[] = bridge.listFor(7)
    expect(list).toHaveLength(2)
    expect(list[0]?.toolName).toBe('tool_a')
    expect(list[0]?.callId).toBe('call_1')
    expect(list[0]?.reason).toBe('治理策略要求人工确认')
    expect(list[0]?.expiresAt).toBeGreaterThan(list[0]?.requestedAt ?? 0)
    bridge.decide(list[0]?.id ?? '', 7, true)
    const kinds = audits.map(event => event.kind)
    expect(kinds).toEqual(['access.approval.surfaced', 'access.approval.surfaced', 'access.approval.decided'])
  })

  it('过期条目从列表过滤(但裁决仍按登记收场)', async () => {
    const { bridge } = makeBridge({ timeoutMs: 20 })
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('approval/request', listener))
    const listener = ctx.handlers.get('approval/request')?.[0]
    const pending = listener?.(requestOf('s-7'), () => 'unavailable') as Promise<string>
    await pending
    expect(bridge.listFor(7)).toHaveLength(0)
  }, 5_000)
})

describe('toolApprovalTimeoutMs', () => {
  it('合法 env 生效;非法/缺省回 300s', () => {
    expect(toolApprovalTimeoutMs({ ETERNA_TOOL_APPROVAL_TIMEOUT_MS: '5000' })).toBe(5000)
    expect(toolApprovalTimeoutMs({})).toBe(300_000)
    expect(toolApprovalTimeoutMs({ ETERNA_TOOL_APPROVAL_TIMEOUT_MS: 'nope' })).toBe(300_000)
    expect(toolApprovalTimeoutMs({ ETERNA_TOOL_APPROVAL_TIMEOUT_MS: '-1' })).toBe(300_000)
  })
})
