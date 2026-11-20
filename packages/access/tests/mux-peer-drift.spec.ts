/**
 * T2 换血防漂移(2026-11-11):admit 包装行为断言(假 connection)。
 * - mux 路径 + 合法 eterna_session → per-user Peer(principal={kind:'eterna-user',userId}),按用户缓存;
 * - mux 路径 + 无/非法 cookie → 原 admit 兜底(owner);
 * - 非 mux/非市场路径(含 unary HTTP)→ 原 admit(owner——上游 fetch 路由硬性要求 owner);
 * - dispose 后 admit 还原、Peer dispose。
 *
 * T6.1 市场面 admin 门(2026-11-19):同一包装对 MARKET_ADMIN_PREFIXES 路径先按 eterna
 * 登录态收口——无会话 401、非 admin 403(不触达原 admit)、admin 放行;角色逐请求现查。
 *
 * TERM-004 终端一元门(2026-11-20 W5):`/api/terminal/*` 必须换血 eterna-user Peer
 * (rc.5 浏览器 admit 恒 owner,网关对 owner 跳过 decide → 服务入口守卫无身份可判);
 * 无 eterna 会话 401、策略面未就绪 503(fail-closed,绝不退回 owner)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { installMuxIsolation, MUX_PATH } from '../src/mux.ts'

type Admission = { peer?: unknown; rejection?: number }

describe('T2 换血:admit 包装', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let aliceCookie: string
  let adminCookie: string

  const cookieOf = (userId: number): string =>
    `eterna_session=${session.issue({ userId, passwordVersion: store.getUserById(userId)?.passwordVersion ?? 1 })}`

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mux-peer-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('mux-peer-secret-mux-peer-000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    aliceCookie = cookieOf(aliceId)
    const root = store.createUserWithSuffix({ account: 'root', password: 'password8' })
    store.setUserRole(root.user.id, 'admin')
    adminCookie = cookieOf(root.user.id)
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
      admit: original as (request: unknown) => unknown,
      createPeer: vi.fn((options: { principal: unknown }) => {
        created.push(options)
        return { id: `peer-${created.length}`, principal: options.principal, dispose: vi.fn() }
      }),
    }
    return connection
  }

  const admitOf = (connection: ReturnType<typeof fakeConnection>) =>
    connection.admit as unknown as (request: unknown) => Admission

  const muxReq = (cookie?: string) => ({
    url: `http://app.local${MUX_PATH}`,
    headers: typeof cookie === 'string' ? { cookie } : {},
  })
  const httpReq = (cookie?: string) => ({
    url: 'http://app.local/api/session/list',
    headers: { get: (name: string) => name === 'cookie' ? cookie : undefined },
  })
  const marketReq = (path: string, cookie?: string) => ({
    url: `http://app.local${path}`,
    headers: typeof cookie === 'string' ? { cookie } : {},
  })

  it('mux+合法 cookie → eterna-user Peer,同用户复用缓存', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    expect(install?.wrapped).toBe(true)
    expect(install?.muxActive).toBe(true)
    const a1 = admitOf(connection)(muxReq(aliceCookie))
    expect((a1.peer as { principal: unknown }).principal).toEqual({ kind: 'eterna-user', userId: aliceId })
    const a2 = admitOf(connection)(muxReq(aliceCookie))
    expect((a2.peer as { id: string }).id).toBe((a1.peer as { id: string }).id)
    expect(connection.created).toHaveLength(1)
    install?.dispose()
  })

  it('mux+无 cookie → 原 admit 兜底(owner);mux+非法 cookie 同', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const noCookie = admitOf(connection)(muxReq())
    expect(noCookie.peer).toBe('owner-peer')
    const badCookie = admitOf(connection)(muxReq('eterna_session=garbage'))
    expect(badCookie.peer).toBe('owner-peer')
    expect(connection.created).toHaveLength(0)
    install?.dispose()
  })

  it('非 mux/非市场/非 terminal 路径(含 unary HTTP+合法 cookie)→ 原 admit(owner,守卫路由硬性要求)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const unary = admitOf(connection)(httpReq(aliceCookie))
    expect(unary.peer).toBe('owner-peer')
    expect(connection.created).toHaveLength(0)
    install?.dispose()
  })

  it('TERM-004 终端一元路径 → eterna-user Peer(与 mux 同用户缓存;无 cookie 401)', () => {
    // rc.5:terminal 六方法资源逐会话,但浏览器 admit 恒 owner Peer、网关对 owner
    // 跳过 decide——不在 admit 换血则服务入口守卫拿不到任何身份(跨租户读 cwd/shells)。
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    for (const method of ['environment', 'shells', 'list', 'create', 'close', 'rename']) {
      const admitted = admitOf(connection)(marketReq(`/api/terminal/${method}`, aliceCookie))
      expect((admitted.peer as { principal: unknown }).principal, method).toEqual({ kind: 'eterna-user', userId: aliceId })
    }
    // 同用户复用缓存(不逐请求建 Peer)
    expect(connection.created).toHaveLength(1)
    const anonymous = admitOf(connection)(marketReq('/api/terminal/environment'))
    expect(anonymous.rejection).toBe(401)
    const badCookie = admitOf(connection)(marketReq('/api/terminal/environment', 'eterna_session=garbage'))
    expect(badCookie.rejection).toBe(401)
    // 近形路径不倒(不能把其它 /api 面卷进换血)
    for (const path of ['/api/terminalX/environment', '/api/terminals/list', '/api/session/list']) {
      expect(admitOf(connection)(marketReq(path, aliceCookie)).peer, path).toBe('owner-peer')
    }
    install?.dispose()
  })

  it('TERM-004 策略面未就绪 → 终端一元 503(fail-closed,绝不退回 owner)', () => {
    const connection = fakeConnection()
    const box: { service?: { registerPolicy: () => unknown } } = {}
    const install = installMuxIsolation({ store, session }, connection, () => box.service)
    expect(install?.muxActive).toBe(false)
    expect(admitOf(connection)(marketReq('/api/terminal/environment', aliceCookie)).rejection).toBe(503)
    expect(connection.original).not.toHaveBeenCalled()
    expect(connection.created).toHaveLength(0)
    // 策略服务挂载后现场补注册即放行为 eterna-user Peer(无需重装)
    box.service = { registerPolicy: vi.fn(() => vi.fn()) }
    const admitted = admitOf(connection)(marketReq('/api/terminal/environment', aliceCookie))
    expect((admitted.peer as { principal: unknown }).principal).toEqual({ kind: 'eterna-user', userId: aliceId })
    install?.dispose()
  })

  it('T6.1 市场面:非 admin 403、无 eterna 会话 401,均不触达原 admit', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const denied = admitOf(connection)(marketReq('/api/pluginManager/installBundle', aliceCookie))
    expect(denied.rejection).toBe(403)
    const anonymous = admitOf(connection)(marketReq('/api/pluginMarket/setIndexes'))
    expect(anonymous.rejection).toBe(401)
    const badCookie = admitOf(connection)(marketReq('/api/pluginManager/removeBundle', 'eterna_session=garbage'))
    expect(badCookie.rejection).toBe(401)
    expect(connection.original).not.toHaveBeenCalled()
    expect(connection.created).toHaveLength(0)
    install?.dispose()
  })

  it('T6.1 市场面:admin 放行到原 admit(owner Peer)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    const allowed = admitOf(connection)(marketReq('/api/pluginManager/installBundle', adminCookie))
    expect(allowed.peer).toBe('owner-peer')
    expect(connection.original).toHaveBeenCalledTimes(1)
    install?.dispose()
  })

  it('T6.1 路径覆盖:RPC 端点 + 两 detail-file(带 query)全覆盖;近形路径与个人插件面不倒', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    expect(admitOf(connection)(marketReq('/api/pluginManager/updateBundle', aliceCookie)).rejection).toBe(403)
    expect(admitOf(connection)(marketReq('/api/pluginMarket/search', aliceCookie)).rejection).toBe(403)
    expect(admitOf(connection)(marketReq('/api/plugin-manager/detail-file?document=d&path=img/a.png', aliceCookie)).rejection).toBe(403)
    expect(admitOf(connection)(marketReq('/api/plugin-market/detail-file?document=d&path=img/a.png', aliceCookie)).rejection).toBe(403)
    // 个人插件面(eterna 自己的守卫路由)与近似路径不在市场面:普通用户照常放行到原 admit
    for (const path of ['/api/my-plugins/list', '/api/pluginManagerX/list', '/api/pluginmanager/list', '/api/session/list']) {
      expect(admitOf(connection)(marketReq(path, aliceCookie)).peer).toBe('owner-peer')
    }
    install?.dispose()
  })

  it('T6.1 角色现查:同一已装包装,用户提为 admin 后即刻放行(无重装/无缓存)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn() })
    expect(admitOf(connection)(marketReq('/api/pluginManager/listBundles', aliceCookie)).rejection).toBe(403)
    store.setUserRole(aliceId, 'admin')
    expect(admitOf(connection)(marketReq('/api/pluginManager/listBundles', aliceCookie)).peer).toBe('owner-peer')
    store.setUserRole(aliceId, 'user')
    expect(admitOf(connection)(marketReq('/api/pluginManager/listBundles', aliceCookie)).rejection).toBe(403)
    install?.dispose()
  })

  it('dispose 还原 admit 并 dispose per-user Peer;策略注销', () => {
    const connection = fakeConnection()
    const disposePolicy = vi.fn()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: vi.fn(() => disposePolicy) })
    admitOf(connection)(muxReq(aliceCookie))
    install?.dispose()
    expect(connection.admit).toBe(connection.original)
    expect(disposePolicy).toHaveBeenCalledTimes(1)
    expect(connection.created[0] && (connection.created[0].principal as { kind: string }).kind).toBe('eterna-user')
  })

  it('connection 缺席 → undefined(装载告警路径);remoteAccess 缺席 → 市场门先装、换血待补注册', () => {
    expect(installMuxIsolation({ store, session }, undefined, { registerPolicy: vi.fn() })).toBeUndefined()

    // T6.1:remoteAccess 晚挂载时 admit 包装(市场门)必须已在——不得出现无门窗口。
    const connection = fakeConnection()
    const box: { service?: { registerPolicy: () => unknown } } = {}
    const install = installMuxIsolation({ store, session }, connection, () => box.service)
    expect(install?.wrapped).toBe(true)
    expect(install?.muxActive).toBe(false)
    // 过渡态:mux 维持原 admit(owner);市场门已生效
    expect(admitOf(connection)(muxReq(aliceCookie)).peer).toBe('owner-peer')
    expect(admitOf(connection)(marketReq('/api/pluginManager/installBundle', aliceCookie)).rejection).toBe(403)
    // 服务晚挂载 → retryPolicy 补注册,换血即刻生效
    const disposePolicy = vi.fn()
    box.service = { registerPolicy: vi.fn(() => disposePolicy) }
    expect(install?.retryPolicy()).toBe(true)
    expect(install?.muxActive).toBe(true)
    expect((admitOf(connection)(muxReq(aliceCookie)).peer as { principal: unknown }).principal)
      .toEqual({ kind: 'eterna-user', userId: aliceId })
    install?.dispose()
    expect(disposePolicy).toHaveBeenCalledTimes(1)
  })
})
