/**
 * 实时评测端点门禁(2026-11-25,56 号 P0):/access/api/session-eval/snapshot。
 *
 * 契约(与 adviser/tasks-settings 同口径):
 * - 未登录 401;内核缺席 503;非 POST 405;跨源 403;参数缺失 400;
 * - **跨租户 404**(不泄漏会话是否存在;归属判定 = store.sessionOwner);
 * - 成功 200 `{ok:true, snapshot}` + `cache-control: no-store`(快照含实时数字);
 * - 服务面抛错 → 503(不把堆栈递给浏览器)。
 * 数据面用假件(SessionEvalFace 单键),不涉真实评测服务——投影与规则语义
 * 由 session-eval/tests 覆盖。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import type { AccessReply, AccessRequest } from '../src/http.ts'
import {
  handleAccessRequest, handleSessionEvalRequest,
  type AccessDeps, type SessionEvalFace,
} from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'

describe('实时评测路由(access)', () => {
  let dir: string
  let store: UserStore
  let deps: AccessDeps
  let adminCookie: string
  let userCookie: string
  let face: SessionEvalFace | undefined
  let calls: string[]
  const aliceSessionId = 'alice-session-eval'
  const bobSessionId = 'bob-session-eval'

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-session-eval-'))
    store = new UserStore(join(dir, 'users.db'))
    const session = new SessionService(Buffer.from('test-secret-test-secret-test-s'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'admin' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8', role: 'user' })
    store.recordSession(aliceSessionId, alice.user.id, null)
    store.recordSession(bobSessionId, bob.user.id, null)
    calls = []
    face = {
      snapshot: async (sessionId) => {
        calls.push(sessionId)
        return {
          sessionId, state: 'ok', generatedAt: 1, turns: 0, steps: 0, lastTurn: 0,
          metrics: [], issues: [], pending: [],
        }
      },
    }
    const auditEvents: AccessAuditEvent[] = []
    deps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000),
      globalWindow: new SlidingWindow(30, 60_000),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
      provisionWorkspace: async () => {},
      sessionEval: () => face,
    }
    adminCookie = login('alice', 'password8')
    userCookie = login('bob', 'password8')
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function login(account: string, password: string): string {
    const reply = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/login', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ account, password })),
    }))
    expect(reply.status).toBe(200)
    return reply.headers.find(([name]) => name === 'set-cookie')?.[1] ?? ''
  }
  function req(overrides: Partial<AccessRequest>): AccessRequest {
    return {
      method: 'GET', pathname: '/', cookie: undefined, origin: undefined,
      host: 'localhost:3210', xff: undefined, contentType: undefined, body: undefined, ...overrides,
    }
  }
  function post(body: unknown, cookie = adminCookie, action = 'snapshot'): Promise<AccessReply> {
    return handleSessionEvalRequest(deps, req({
      method: 'POST', pathname: `/access/api/session-eval/${action}`, cookie,
      origin: 'http://localhost:3210', contentType: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }))
  }

  it('成功:200 + snapshot + no-store;服务面拿到原样 session id', async () => {
    const reply = await post({ session: aliceSessionId })
    expect(reply.status).toBe(200)
    const parsed = JSON.parse(reply.body as string) as Record<string, unknown>
    expect(parsed.ok).toBe(true)
    expect((parsed.snapshot as Record<string, unknown>).sessionId).toBe(aliceSessionId)
    expect(reply.headers).toContainEqual(['cache-control', 'no-store'])
    expect(calls).toEqual([aliceSessionId])
  })

  it('匿名:401', async () => {
    expect((await post({ session: aliceSessionId }, '')).status).toBe(401)
  })

  it('非 POST:405', async () => {
    const reply = await handleSessionEvalRequest(deps, req({
      method: 'GET', pathname: '/access/api/session-eval/snapshot', cookie: adminCookie,
    }))
    expect(reply.status).toBe(405)
  })

  it('跨源 POST:403(同源闸)', async () => {
    const reply = await handleSessionEvalRequest(deps, req({
      method: 'POST', pathname: '/access/api/session-eval/snapshot', cookie: adminCookie,
      origin: 'http://evil.example', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ session: aliceSessionId })),
    }))
    expect(reply.status).toBe(403)
  })

  it('缺少/空白 session:400,且不触达服务面', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ session: '   ' })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('跨租户与不存在的会话:一律 404(不泄漏存在性)', async () => {
    expect((await post({ session: aliceSessionId }, userCookie)).status).toBe(404)
    expect((await post({ session: 'no-such-session' })).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('内核缺席:503(fail-closed)', async () => {
    face = undefined
    expect((await post({ session: aliceSessionId })).status).toBe(503)
  })

  it('服务面抛错:503,不泄漏堆栈', async () => {
    face = { snapshot: async () => { throw new Error('boom: internal detail') } }
    const reply = await post({ session: aliceSessionId })
    expect(reply.status).toBe(503)
    expect(reply.body).not.toContain('boom')
  })

  it('未知 action:404', async () => {
    expect((await post({ session: aliceSessionId }, adminCookie, 'recompute')).status).toBe(404)
  })
})
