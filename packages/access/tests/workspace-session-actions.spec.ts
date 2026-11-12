/**
 * workspace 会话系动作守卫回归(2026-11-12 修复「归档会话必被拒」):
 * 上游 wire 形态考古(workspace-controller index.ts)——archiveSession/unarchiveSession/
 * pinSession/unpinSession 的请求载荷只有 {sessionId}(可带 stopActivity),没有
 * workspaceId;守卫若按 workspaceId 归属校验,空串判非本人,UI 悬停归档/置顶按钮
 * 与右键菜单项点击后全部「工作区不存在或不属于你」。修复后按族分检:
 * session 系按 sessionId 账本归属;workspace 系(delete/rename/insert*)仍按 workspaceId。
 * 断言双面:HTTP 200 + 响应体(拒绝帧中文文案)+ 直调桩证据,沿 tenant-guard-matrix 基座。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

interface RecordedCall {
  readonly method: string
  readonly params: unknown[]
}

const SESSION_ACTIONS = ['pinSession', 'unpinSession', 'archiveSession', 'unarchiveSession'] as const

describe('workspace 会话系动作:sessionId 归属(archive/pin 家族)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let calls: RecordedCall[]
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let bobId: number
  let aliceWorkspaceId: string
  let aliceSessionId: string
  let bobSessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-ws-actions-'))
    store = new UserStore(join(dir, 'users.db'))
    calls = []
    routes = new Map()
    session = new SessionService(Buffer.from('tenant-secret-tenant-secret-000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    const services = {
      workspaceController: {
        // 桩:载荷透传即放行证据(直调形态={request:{...}})
        archiveSession: (request: unknown) => { calls.push({ method: 'archiveSession', params: [request] }); return { archivedSessionIds: ['x'] } },
        unarchiveSession: (request: unknown) => { calls.push({ method: 'unarchiveSession', params: [request] }); return { archivedSessionIds: [] } },
        pinSession: (request: unknown) => { calls.push({ method: 'pinSession', params: [request] }); return { pinnedSessionIds: ['x'] } },
        unpinSession: (request: unknown) => { calls.push({ method: 'unpinSession', params: [request] }); return { pinnedSessionIds: [] } },
        delete: (request: unknown) => { calls.push({ method: 'delete', params: [request] }); return { deleted: true } },
      },
    }
    const reflect = { get: (key: string): unknown => (services as Record<string, Record<string, (...args: unknown[]) => unknown>>)[key] }
    const registry: TenantFetchRegistry = {
      register: (route) => { routes.set(route.path, route); return () => Promise.resolve() },
    }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: () => {} }, { fetch: registry })
    aliceWorkspaceId = 'ws-alice'
    store.recordWorkspace(aliceWorkspaceId, aliceId, join(dir, 'workspaces', 'alice'))
    aliceSessionId = 's-alice-1'
    bobSessionId = 's-bob-1'
    store.recordSession(aliceSessionId, aliceId, aliceWorkspaceId)
    store.recordSession(bobSessionId, bobId, null)
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function cookieFor(userId: number): string {
    const user = store.getUserById(userId)
    return `eterna_session=${session.issue({ userId, passwordVersion: user?.passwordVersion ?? 1 })}`
  }

  async function call(path: string, account: 'alice' | 'bob' | undefined, payloadArgs: Record<string, unknown>) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (account !== undefined) headers.cookie = cookieFor(account === 'alice' ? aliceId : bobId)
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: path.slice(5), payload: { args: payloadArgs } }),
    }))
    const text = await response.text()
    let result: Record<string, unknown> | undefined
    try { result = JSON.parse(text) as Record<string, unknown> } catch { result = undefined }
    return { status: response.status, result }
  }

  const denialOf = (r: { result?: Record<string, unknown> | undefined }) =>
    (r.result?.result as { error?: { code?: string; message?: string } })?.error

  // ── session 系四端点 × {本人/他人/未登录} = 12 例 ──
  for (const action of SESSION_ACTIONS) {
    it(`${action}: 本人 sessionId 放行(直调桩收到原载荷)`, async () => {
      const r = await call(`/api/workspace/${action}`, 'alice', { request: { sessionId: aliceSessionId } })
      expect(r.status).toBe(200)
      expect(r.result?.result).toMatchObject({ ok: true })
      expect(calls.filter(c => c.method === action)).toHaveLength(1)
      expect(calls.find(c => c.method === action)?.params[0]).toEqual({ sessionId: aliceSessionId })
    })
    it(`${action}: stopActivity 透传(归档运行中会话二段形态)`, async () => {
      const r = await call(`/api/workspace/${action}`, 'alice', { request: { sessionId: aliceSessionId, stopActivity: true } })
      expect(r.result?.result).toMatchObject({ ok: true })
      expect(calls.find(c => c.method === action)?.params[0]).toEqual({ sessionId: aliceSessionId, stopActivity: true })
    })
    it(`${action}: 他人 sessionId → 拒绝帧(中文文案)+零直调`, async () => {
      const r = await call(`/api/workspace/${action}`, 'bob', { request: { sessionId: aliceSessionId } })
      expect(r.status).toBe(200)
      expect(denialOf(r)).toMatchObject({ code: 'tenant/denied' })
      expect(denialOf(r)?.message).toContain('不属于你')
      expect(calls.filter(c => c.method === action)).toHaveLength(0)
    })
    it(`${action}: 未登录 → tenant/unauthenticated`, async () => {
      const r = await call(`/api/workspace/${action}`, undefined, { request: { sessionId: aliceSessionId } })
      expect(denialOf(r)?.code).toBe('tenant/unauthenticated')
    })
  }

  // ── workspace 系语义不变(同修复的面护栏):delete 仍按 workspaceId 归属 ──
  it('workspace/delete: 本人 workspaceId 放行', async () => {
    const r = await call('/api/workspace/delete', 'alice', { request: { workspaceId: aliceWorkspaceId } })
    expect(r.result?.result).toMatchObject({ ok: true })
    expect(calls.filter(c => c.method === 'delete')).toHaveLength(1)
  })
  it('workspace/delete: 他人 workspaceId → 拒绝帧(工作区文案)', async () => {
    const r = await call('/api/workspace/delete', 'bob', { request: { workspaceId: aliceWorkspaceId } })
    expect(denialOf(r)).toMatchObject({ code: 'tenant/denied' })
    expect(denialOf(r)?.message).toContain('工作区不存在或不属于你')
  })
  it('workspace/delete: 缺 workspaceId → 拒绝(工作区文案,workspace 系口径不放松)', async () => {
    const r = await call('/api/workspace/delete', 'alice', { request: {} })
    expect(denialOf(r)?.message).toContain('工作区不存在或不属于你')
  })
})
