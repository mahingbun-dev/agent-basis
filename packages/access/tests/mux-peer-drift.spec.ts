/**
 * T2 换血防漂移(2026-11-11):admit 包装行为断言(假 connection)。
 * - mux 路径 + 合法 eterna_session → per-user Peer(principal={kind:'eterna-user',userId}),按用户缓存;
 * - mux 路径 + 无/非法 cookie → 原 admit 兜底(owner);
 * - 非 mux 路径(含 unary HTTP)→ 原 admit(owner——上游 fetch 路由硬性要求 owner);
 * - dispose 后 admit 还原、Peer dispose。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { installMuxIsolation, MUX_PATH } from '../src/mux.ts'

describe('T2 换血:admit 包装', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let aliceCookie: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mux-peer-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('mux-peer-secret-mux-peer-000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    aliceCookie = `eterna_session=${session.issue({ userId: aliceId, passwordVersion: store.getUserById(aliceId)?.passwordVersion ?? 1 })}`
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function fakeConnection() {
    const created: Array<{ principal: unknown }> = []
    const original = vi.fn(() => ({ peer: 'owner-peer' }))
    const connection = {
      created,
      original,
      admit: original,
      createPeer: vi.fn((options: { principal: unknown }) => {
        created.push(options)
        return { id: `peer-${created.length}`, principal: options.principal, dispose: vi.fn() }
      }),
    }
    return connection
  }

  const muxReq = (cookie?: string) => ({
    url: `http://app.local${MUX_PATH}`,
    headers: typeof cookie === 'string' ? { cookie } : {},
  })
  const httpReq = (cookie?: string) => ({
    url: 'http://app.local/api/session/list',
    headers: { get: (name: string) => name === 'cookie' ? cookie : undefined },
  })

  it('mux+合法 cookie → eterna-user Peer,同用户复用缓存', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    expect(install?.wrapped).toBe(true)
    const a1 = (connection.admit as unknown as (r: unknown) => { peer: { id: string; principal: unknown } })(muxReq(aliceCookie))
    expect(a1.peer.principal).toEqual({ kind: 'eterna-user', userId: aliceId })
    const a2 = (connection.admit as unknown as (r: unknown) => { peer: { id: string } })(muxReq(aliceCookie))
    expect(a2.peer.id).toBe(a1.peer.id)
    expect(connection.created).toHaveLength(1)
    install?.dispose()
  })

  it('mux+无 cookie → 原 admit 兜底(owner);mux+非法 cookie 同', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const noCookie = (connection.admit as unknown as (r: unknown) => { peer: string })(muxReq())
    expect(noCookie.peer).toBe('owner-peer')
    const badCookie = (connection.admit as unknown as (r: unknown) => { peer: string })(muxReq('eterna_session=garbage'))
    expect(badCookie.peer).toBe('owner-peer')
    expect(connection.created).toHaveLength(0)
    install?.dispose()
  })

  it('非 mux 路径(含 unary HTTP+合法 cookie)→ 原 admit(owner,守卫路由硬性要求)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const unary = (connection.admit as unknown as (r: unknown) => { peer: string })(httpReq(aliceCookie))
    expect(unary.peer).toBe('owner-peer')
    expect(connection.created).toHaveLength(0)
    install?.dispose()
  })

  it('dispose 还原 admit 并 dispose per-user Peer;策略注销', () => {
    const connection = fakeConnection()
    const disposePolicy = vi.fn()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: disposePolicy })
    const admitBefore = connection.admit
    ;(connection.admit as unknown as (r: unknown) => { peer: { principal: { kind: string } } })(muxReq(aliceCookie))
    install?.dispose()
    expect(connection.admit).toBe(admitBefore === connection.admit ? connection.original : connection.admit)
    expect(connection.original).toHaveBeenCalledTimes(connection.original.mock.calls.length)
    expect(disposePolicy).toHaveBeenCalledTimes(1)
    expect(connection.created[0] && (connection.created[0].principal as { kind: string }).kind).toBe('eterna-user')
  })

  it('服务缺席 → undefined(装载告警路径)', () => {
    expect(installMuxIsolation({ store, session }, undefined, { registerPolicy: vi.fn() })).toBeUndefined()
    expect(installMuxIsolation({ store, session }, fakeConnection(), undefined)).toBeUndefined()
  })
})
