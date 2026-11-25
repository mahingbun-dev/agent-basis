/**
 * 实时评测端点门禁(2026-11-25,56 号 P0/P1):
 * snapshot / evaluate / settings / config/save。
 *
 * 契约(与 adviser/tasks-settings 同口径):
 * - 未登录 401;内核缺席 503;非 POST 405;跨源 403;参数缺失/不合法 400;
 * - **跨租户 404**(不泄漏会话是否存在;归属判定 = store.sessionOwner);
 * - **配置保存仅管理员 403**(全局模型/预算影响所有用户);
 * - 评测业务拒绝按码分流:预算用尽 429、同键在途 409、其余 400;
 * - 成功 200 + `cache-control: no-store`(载荷含实时数字);
 * - 服务面抛错 → 503(不把堆栈递给浏览器)。
 * 数据面用假件(SessionEvalFace 四方法),不涉真实评测服务——投影/裁判/队列语义
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
  let auditEvents: AccessAuditEvent[]
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
    face = makeFace()
    auditEvents = []
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

  /** 全方法假件(结构面四方法;用例按需覆写单支,避免可选属性破坏面类型). */
  function makeFace(): SessionEvalFace {
    return {
      snapshot: async (sessionId) => {
        calls.push(sessionId)
        return {
          sessionId, state: 'ok', generatedAt: 1, turns: 0, steps: 0, lastTurn: 0,
          metrics: [], issues: [], pending: [],
        }
      },
      evaluate: async (sessionId) => {
        calls.push(`evaluate:${sessionId}`)
        return { ok: true, accepted: 3, pending: 3, skipped: [] }
      },
      settings: async () => {
        calls.push('settings')
        return { config: { enabled: false, route: null }, metrics: [], providers: [] }
      },
      saveConfig: async (input) => {
        calls.push('saveConfig')
        return { ok: true, config: input }
      },
    }
  }

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

  it('snapshot 成功:200 + snapshot + no-store;服务面拿到原样 session id', async () => {
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
    expect((await post({}, adminCookie, 'settings')).status).toBe(503)
  })

  it('服务面抛错:503,不泄漏堆栈', async () => {
    face = {
      snapshot: async () => { throw new Error('boom: internal detail') },
      evaluate: async () => { throw new Error('boom: internal detail') },
      settings: async () => { throw new Error('boom: internal detail') },
      saveConfig: async () => { throw new Error('boom: internal detail') },
    }
    const reply = await post({ session: aliceSessionId })
    expect(reply.status).toBe(503)
    expect(reply.body).not.toContain('boom')
    expect((await post({ session: aliceSessionId }, adminCookie, 'evaluate')).status).toBe(503)
    expect((await post({}, adminCookie, 'settings')).status).toBe(503)
  })

  it('未知 action:404', async () => {
    expect((await post({ session: aliceSessionId }, adminCookie, 'recompute')).status).toBe(404)
  })

  it('evaluate 成功:200 + 受理计数;审计一条', async () => {
    const reply = await post({ session: aliceSessionId, scope: 'all' }, adminCookie, 'evaluate')
    expect(reply.status).toBe(200)
    const parsed = JSON.parse(reply.body as string) as Record<string, unknown>
    expect(parsed).toMatchObject({ ok: true, accepted: 3, pending: 3 })
    expect(calls).toContain(`evaluate:${aliceSessionId}`)
    expect(auditEvents.some(event => event.kind === 'access.session-eval.evaluate' && event.ok === true)).toBe(true)
  })

  it('evaluate 跨租户:404(归属校验先于服务调用)', async () => {
    expect((await post({ session: bobSessionId }, adminCookie, 'evaluate')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('evaluate 业务拒绝按码分流:预算 429 / 在途 409 / 未配置 400', async () => {
    face = {
      ...(face ?? makeFace()),
      evaluate: async () => ({ ok: false, code: 'budget', message: '预算用尽' }),
    }
    expect((await post({ session: aliceSessionId }, adminCookie, 'evaluate')).status).toBe(429)
    face = {
      ...(face ?? makeFace()),
      evaluate: async () => ({ ok: false, code: 'busy', message: '已在队列' }),
    }
    expect((await post({ session: aliceSessionId }, adminCookie, 'evaluate')).status).toBe(409)
    face = {
      ...(face ?? makeFace()),
      evaluate: async () => ({ ok: false, code: 'unconfigured', message: '未配置' }),
    }
    expect((await post({ session: aliceSessionId }, adminCookie, 'evaluate')).status).toBe(400)
  })

  it('evaluate 参数形状:scope 非枚举 400、turn 非正整数 400(均不触达服务面)', async () => {
    expect((await post({ session: aliceSessionId, scope: 'alll' }, adminCookie, 'evaluate')).status).toBe(400)
    expect((await post({ session: aliceSessionId, turn: 1.5 }, adminCookie, 'evaluate')).status).toBe(400)
    expect((await post({ session: aliceSessionId, turn: 0 }, adminCookie, 'evaluate')).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('settings:登录即可读(含 admin 标志);匿名 401', async () => {
    const reply = await post({}, userCookie, 'settings')
    expect(reply.status).toBe(200)
    const parsed = JSON.parse(reply.body as string) as Record<string, unknown>
    expect(parsed.ok).toBe(true)
    expect(parsed.admin).toBe(false)
    expect(reply.headers).toContainEqual(['cache-control', 'no-store'])
    expect((await post({}, '', 'settings')).status).toBe(401)
  })

  it('config/save:非管理员 403 且不触达服务面;管理员 200 + 审计', async () => {
    expect((await post({ config: {} }, userCookie, 'config/save')).status).toBe(403)
    expect(calls).not.toContain('saveConfig')
    const reply = await post({ config: { enabled: true } }, adminCookie, 'config/save')
    expect(reply.status).toBe(200)
    expect(calls).toContain('saveConfig')
    expect(auditEvents.some(event => event.kind === 'access.session-eval.config' && event.ok === true)).toBe(true)
  })

  it('config/save 校验失败:400 + 中文原因 + 失败审计', async () => {
    face = {
      ...(face ?? makeFace()),
      saveConfig: async () => ({ ok: false, error: 'sampling 必须在 0..1 之间' }),
    }
    const reply = await post({ config: { sampling: 2 } }, adminCookie, 'config/save')
    expect(reply.status).toBe(400)
    expect(reply.body).toContain('sampling')
    expect(auditEvents.some(event => event.kind === 'access.session-eval.config' && event.ok === false)).toBe(true)
  })
})
