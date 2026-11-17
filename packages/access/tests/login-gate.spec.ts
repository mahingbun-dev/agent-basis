/**
 * 索引页登录跳转门禁:401 拒绝 → 302 /login;token 兑换 303 与已认证放行原样;
 * dispose 还原;上游缺席/不可写降级不装。shim 语义照上游 frontend-static:
 * writeHead/end 多次写以后写为准。
 */
import { describe, expect, it, vi } from 'vitest'
import { installLoginGate, LOGIN_GATE_LOCATION, type IndexAuthSink } from '../src/login-gate.ts'

interface Write {
  readonly kind: 'head' | 'end'
  readonly status?: number
  readonly headers?: unknown
  readonly body?: string | undefined
}

function recordingSink(): { sink: IndexAuthSink; writes: Write[] } {
  const writes: Write[] = []
  return {
    writes,
    sink: {
      writeHead(status, headers) { writes.push({ kind: 'head', status, headers }) },
      end(body) { writes.push({ kind: 'end', body }) },
    },
  }
}

/** 上游形态:authorizeIndex 依赖调用方 this(动态绑定语义照类方法)。 */
class FakeConnection {
  readonly calls: unknown[] = []
  constructor(private readonly refuse: 'authorized' | 'token' | 'unauthorized') {}
  authorizeIndex = function (this: FakeConnection, request: unknown, sink: IndexAuthSink): boolean {
    this.calls.push(request)
    if (this.refuse === 'authorized') return true
    if (this.refuse === 'token') {
      sink.writeHead(303, { location: './', 'cache-control': 'no-store' })
      sink.end()
      return false
    }
    sink.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    sink.end('dsh web authentication required')
    return false
  }
}

describe('installLoginGate', () => {
  it('已认证:原样放行,零改写', () => {
    const connection = new FakeConnection('authorized')
    installLoginGate(connection)
    const { sink, writes } = recordingSink()
    expect(connection.authorizeIndex('/req', sink)).toBe(true)
    expect(writes).toEqual([])
  })

  it('token 兑换 303:原样保留,不改写为 /login', () => {
    const connection = new FakeConnection('token')
    installLoginGate(connection)
    const { sink, writes } = recordingSink()
    expect(connection.authorizeIndex('/req', sink)).toBe(false)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ kind: 'head', status: 303, headers: { location: './' } })
    expect(writes.some(entry => entry.status === 302)).toBe(false)
  })

  it('401 拒绝:终态改写为 302 /login(shim 后写覆盖先写),仍返回 false', () => {
    const connection = new FakeConnection('unauthorized')
    installLoginGate(connection)
    const { sink, writes } = recordingSink()
    expect(connection.authorizeIndex({ headers: {} }, sink)).toBe(false)
    const heads = writes.filter(entry => entry.kind === 'head')
    expect(heads[0]).toMatchObject({ status: 401 })
    expect(heads.at(-1)).toMatchObject({
      status: 302,
      headers: { location: LOGIN_GATE_LOCATION, 'cache-control': 'no-store' },
    })
    expect(writes.at(-1)).toMatchObject({ kind: 'end' })
  })

  it('包装保留 this 绑定(上游类方法读取自身状态)', () => {
    const connection = new FakeConnection('authorized')
    installLoginGate(connection)
    connection.authorizeIndex('/req', recordingSink().sink)
    connection.authorizeIndex('/req2', recordingSink().sink)
    expect(connection.calls).toEqual(['/req', '/req2'])
  })

  it('dispose 还原原方法(行为回退裸 401);重复 dispose 安全', () => {
    const connection = new FakeConnection('unauthorized')
    const dispose = installLoginGate(connection)
    dispose?.()
    dispose?.()
    const { sink, writes } = recordingSink()
    connection.authorizeIndex('/after-dispose', sink)
    expect(connection.calls).toEqual(['/after-dispose'])
    expect(writes.filter(entry => entry.kind === 'head').map(entry => entry.status)).toEqual([401])
    expect(writes.at(-1)).toMatchObject({ kind: 'end', body: 'dsh web authentication required' })
  })

  it('上游无 authorizeIndex(版本漂移):不装、不抛', () => {
    expect(installLoginGate(undefined)).toBeUndefined()
    expect(installLoginGate({})).toBeUndefined()
  })

  it('上游对象不可写:降级不装,保留既有行为', () => {
    const frozen = Object.freeze({ authorizeIndex: vi.fn(() => false) })
    expect(installLoginGate(frozen as never)).toBeUndefined()
  })
})
