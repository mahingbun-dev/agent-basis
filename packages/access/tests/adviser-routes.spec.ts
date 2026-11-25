/**
 * 参谋面板路由门禁(2026-11-24):/access/api/adviser/{list,create,deliver}。
 *
 * 契约(对齐既有 tasks-settings 口径):
 * - 未登录 401;内核缺席 503;非 POST 405;跨源 403;
 * - **跨租户 404**(不泄漏父会话是否存在;归属判定 = store.sessionOwner,
 *   含子代理父链回退);
 * - create/deliver 失败码映射:limit/invalid→400、parent-missing/forbidden→404、
 *   preset-missing/unavailable→503;
 * - 成功 create/deliver 出审计(不记投递正文);list 响应 no-store。
 * 数据面用假件(AdviserFace 四键),不涉真实 adviser 服务——语义面由
 * adviser/tests/service.test.ts 覆盖。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import type { AccessReply, AccessRequest } from '../src/http.ts'
import {
  handleAccessRequest, handleAdviserRequest,
  type AccessDeps, type AdviserCreateOutcome, type AdviserDeliverOutcome, type AdviserFace,
} from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'

describe('参谋面板路由(access)', () => {
  let dir: string
  let store: UserStore
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let adminCookie: string
  let userCookie: string
  let face: AdviserFace | undefined
  let aliceSessionId: string
  let bobSessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-adviser-'))
    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    const session = new SessionService(Buffer.from('test-secret-test-secret-test-s'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'admin' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8', role: 'user' })
    aliceSessionId = 'alice-session-1'
    bobSessionId = 'bob-session-1'
    store.recordSession(aliceSessionId, alice.user.id, null)
    store.recordSession(bobSessionId, bob.user.id, null)
    face = {
      list: async () => [{ sessionId: 'a1', label: 'adviser', activity: 'inactive' }],
      create: async () => ({ ok: true, sessionId: 'a1', messageId: 'm1' }),
      deliver: async (_parent, _text, delivery) => ({ ok: true, delivery, sessionId: _parent }),
      model: async (_parent, _child, selection) => ({ ok: true, selection }),
    }
    deps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000),
      globalWindow: new SlidingWindow(30, 60_000),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
      provisionWorkspace: async () => {},
      adviser: () => face,
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
  function bodyOf(reply: AccessReply): Record<string, unknown> {
    expect(typeof reply.body).toBe('string')
    return JSON.parse(reply.body as string) as Record<string, unknown>
  }
  function post(action: string, body: unknown, cookie = adminCookie): Promise<AccessReply> {
    return handleAdviserRequest(deps, req({
      method: 'POST', pathname: `/access/api/adviser/${action}`, cookie, origin: 'http://localhost:3210',
      contentType: 'application/json', body: Buffer.from(JSON.stringify(body)),
    }))
  }

  // ── 身份门 ──────────────────────────────────────────────────────────────
  it('匿名:list/create/deliver 都 401', async () => {
    expect((await post('list', { parent: aliceSessionId }, '')).status).toBe(401)
    expect((await post('create', { parent: aliceSessionId, seed: 'x' }, '')).status).toBe(401)
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'inject' }, '')).status).toBe(401)
  })

  it('非 POST:405', async () => {
    const reply = await handleAdviserRequest(deps, req({ method: 'GET', pathname: '/access/api/adviser/list', cookie: adminCookie }))
    expect(reply.status).toBe(405)
  })

  it('跨源 POST:403', async () => {
    const reply = await handleAdviserRequest(deps, req({
      method: 'POST', pathname: '/access/api/adviser/list', cookie: adminCookie,
      origin: 'http://evil.example', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ parent: aliceSessionId })),
    }))
    expect(reply.status).toBe(403)
  })

  it('内核缺席:503(fail-closed,与 tasks 设置面同纪律)', async () => {
    face = undefined
    expect((await post('list', { parent: aliceSessionId })).status).toBe(503)
    expect((await post('create', { parent: aliceSessionId, seed: 'x' })).status).toBe(503)
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'inject' })).status).toBe(503)
  })

  // ── 归属门(核心负用例)──────────────────────────────────────────────────
  it('跨租户:Bob 操作 Alice 的会话一律 404(不泄漏存在性)', async () => {
    expect((await post('list', { parent: aliceSessionId }, userCookie)).status).toBe(404)
    expect((await post('create', { parent: aliceSessionId, seed: 'x' }, userCookie)).status).toBe(404)
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'inject' }, userCookie)).status).toBe(404)
  })

  it('不存在的会话:404(与本会话 id 之外无差别)', async () => {
    expect((await post('list', { parent: 'no-such-session' })).status).toBe(404)
  })

  it('缺少 parent:400', async () => {
    expect((await post('list', {})).status).toBe(400)
    expect((await post('create', { seed: 'x' })).status).toBe(400)
  })

  it('参谋会话本身也能被认领(forbidden 也走 404,不区分父/子)', async () => {
    // 参谋 = subagent 子会话,其归属经 sessionOwner 的父链回退判到 Alice。
    store.recordChildSession('alice-adviser-1', aliceSessionId)
    const reply = await post('list', { parent: 'alice-adviser-1' })
    expect(reply.status).toBe(200)
  })

  // ── 正常面 ──────────────────────────────────────────────────────────────
  it('list:本人 200 + no-store', async () => {
    const reply = await post('list', { parent: aliceSessionId })
    expect(reply.status).toBe(200)
    expect(reply.headers.some(([n, v]) => n === 'cache-control' && v === 'no-store')).toBe(true)
    expect(bodyOf(reply)).toEqual({ ok: true, advisers: [{ sessionId: 'a1', label: 'adviser', activity: 'inactive' }] })
  })

  it('create:成功 200 并出审计(不记开场正文)', async () => {
    const reply = await post('create', { parent: aliceSessionId, seed: '看看这个方案' })
    expect(reply.status).toBe(200)
    expect(bodyOf(reply)).toEqual({ ok: true, sessionId: 'a1', messageId: 'm1' })
    const created = auditEvents.find(e => e.kind === 'access.adviser.create')
    expect(created?.ok).toBe(true)
    expect(JSON.stringify(created)).not.toContain('看看这个方案')
  })

  it('create:缺少开场内容 400(不打到服务面)', async () => {
    let called = false
    face = { ...face!, create: async () => { called = true; return { ok: true, sessionId: 'a1', messageId: 'm1' } } }
    expect((await post('create', { parent: aliceSessionId, seed: '   ' })).status).toBe(400)
    expect(called).toBe(false)
  })

  it('deliver:inject / followup 分流透传到服务面', async () => {
    const injections: string[] = []
    face = {
      ...face!,
      deliver: async (_parent, _text, delivery) => {
        injections.push(delivery)
        return { ok: true, delivery, sessionId: _parent }
      },
    }
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'inject' })).status).toBe(200)
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'followup' })).status).toBe(200)
    expect(injections).toEqual(['inject', 'followup'])
  })

  it('deliver:非法 delivery 400;空正文 400', async () => {
    expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'wake' })).status).toBe(400)
    expect((await post('deliver', { parent: aliceSessionId, text: '  ', delivery: 'inject' })).status).toBe(400)
  })

  it('deliver:审计只记 delivery 与结果,不记正文', async () => {
    await post('deliver', { parent: aliceSessionId, text: '机密结论内容', delivery: 'followup' })
    const delivered = auditEvents.find(e => e.kind === 'access.adviser.deliver')
    expect(delivered?.ok).toBe(true)
    expect(JSON.stringify(delivered)).not.toContain('机密结论内容')
  })

  // ── 失败码映射(闭集)────────────────────────────────────────────────────
  it('失败码映射:limit/invalid→400、parent-missing/forbidden→404、preset-missing/unavailable→503', async () => {
    const cases: Array<[string, number]> = [
      ['limit', 400], ['invalid', 400],
      ['parent-missing', 404], ['forbidden', 404],
      ['preset-missing', 503], ['unavailable', 503],
      ['something-new', 500],
    ]
    for (const [code, status] of cases) {
      face = {
        ...face!,
        create: async (): Promise<AdviserCreateOutcome> => ({ ok: false, code, message: 'x' }),
        deliver: async (): Promise<AdviserDeliverOutcome> => ({ ok: false, code, message: 'x' }),
      }
      expect((await post('create', { parent: aliceSessionId, seed: 'x' })).status, `create ${code}`).toBe(status)
      expect((await post('deliver', { parent: aliceSessionId, text: 'x', delivery: 'inject' })).status, `deliver ${code}`).toBe(status)
    }
  })

  it('服务面抛异常:503 且不泄漏内部消息', async () => {
    face = { ...face!, list: async () => { throw new Error('内部堆栈: SELECT * FROM users') } }
    const reply = await post('list', { parent: aliceSessionId })
    expect(reply.status).toBe(503)
    expect(JSON.stringify(bodyOf(reply))).not.toContain('SELECT')
  })

  it('未知动作:404', async () => {
    expect((await post('drop-everything', { parent: aliceSessionId })).status).toBe(404)
  })

  // ── 路由分流 ────────────────────────────────────────────────────────────
  it('同步入口仍把 /access/api/adviser/* 当 404(异步面独立,不污染同步契约)', () => {
    const reply = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/adviser/list', cookie: adminCookie,
      origin: 'http://localhost:3210', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ parent: aliceSessionId })),
    }))
    expect(reply.status).toBe(404)
  })

  // ── 模型读写(2026-11-25 参谋模型解耦)──────────────────────────────────
  it('model/read 匿名 401;跨租户 404;缺 child 400', async () => {
    expect((await post('model/read', { parent: aliceSessionId, child: 'a1' }, '')).status).toBe(401)
    expect((await post('model/read', { parent: aliceSessionId, child: 'a1' }, userCookie)).status).toBe(404)
    expect((await post('model/read', { parent: aliceSessionId }, adminCookie)).status).toBe(400)
  })

  it('model/read:200 + no-store;选择缺席回 null', async () => {
    face = { ...face!, model: async () => ({ ok: true, selection: undefined }) }
    const reply = await post('model/read', { parent: aliceSessionId, child: 'a1' })
    expect(reply.status).toBe(200)
    expect(reply.headers.some(([n, v]) => n === 'cache-control' && v === 'no-store')).toBe(true)
    expect(bodyOf(reply)).toEqual({ ok: true, selection: null })
  })

  it('model/read:不写审计(与 list 同口径)', async () => {
    await post('model/read', { parent: aliceSessionId, child: 'a1' })
    expect(auditEvents.some(e => e.kind.startsWith('access.adviser.model'))).toBe(false)
  })

  it('model:成功 200、provider/model 去空白后透传,并出审计', async () => {
    const seen: unknown[] = []
    face = {
      ...face!,
      model: async (_parent, _child, selection) => { seen.push(selection); return { ok: true, selection } },
    }
    const reply = await post('model', {
      parent: aliceSessionId, child: 'a1', provider: ' route-a ', model: ' m-1 ', reasoningEffort: ' high ',
    })
    expect(reply.status).toBe(200)
    expect(seen).toEqual([{ provider: 'route-a', model: 'm-1', reasoningEffort: 'high' }])
    const audited = auditEvents.find(e => e.kind === 'access.adviser.model')
    expect(audited?.ok).toBe(true)
    expect(JSON.stringify(audited)).toContain('route-a')
  })

  it('model:缺 provider/model 400(不打到服务面)', async () => {
    let called = false
    face = { ...face!, model: async () => { called = true; return { ok: true, selection: undefined } } }
    expect((await post('model', { parent: aliceSessionId, child: 'a1', model: 'm' })).status).toBe(400)
    expect((await post('model', { parent: aliceSessionId, child: 'a1', provider: 'p' })).status).toBe(400)
    expect(called).toBe(false)
  })

  it('model:失败码映射 forbidden→404、invalid→400、unavailable→503,且审计记 ok=false', async () => {
    const cases: Array<[string, number]> = [['forbidden', 404], ['invalid', 400], ['unavailable', 503]]
    for (const [code, status] of cases) {
      face = {
        ...face!,
        model: async () => ({ ok: false, code, message: 'x' }),
      }
      const reply = await post('model', { parent: aliceSessionId, child: 'a1', provider: 'p', model: 'm' })
      expect(reply.status, code).toBe(status)
    }
    const audited = auditEvents.filter(e => e.kind === 'access.adviser.model')
    expect(audited.every(e => e.ok === false)).toBe(true)
  })
})
