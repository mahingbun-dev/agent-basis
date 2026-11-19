/**
 * 任务设置分区路由门禁(2026-11-19):/access/api/tasks/{session-roles,settings}。
 *
 * 契约:
 * - roles:登录即可(会话头徽标数据源;不含设置内容);
 * - settings GET/POST:admin;内核缺席 503;save 结果 union → conflict 409 / invalid 400;
 * - 成功保存审计只记块与结果(不记设置值);GET/POST 响应 no-store(修订即 CAS 基准)。
 * 数据面用假件(face 三键),不涉真实 tasks 内核——语义面由 tasks/tests/settings-face.spec 覆盖。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import type { AccessReply, AccessRequest } from '../src/http.ts'
import { handleAccessRequest, type AccessDeps, type TasksSettingsFace } from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'

const VIEW = {
  realm: 'Mr.Ma',
  masterId: 'orchestrator-Mr.Ma' as string | undefined,
  masterTitle: 'eterna-tasks orchestrator',
  paused: false,
  policyVersion: 'pv-1',
  settings: { paused: false, eval: { mode: 'auto' } },
  revisions: { pause: 0, policy: 2, eval: 3, executor: 0, budget: 0, gates: 0 },
  workerSessionIds: ['worker-T-1'],
  health: { state: 'ready' },
  stats: { tickets: { open: 1 } },
}
const ROLES = { masterId: 'orchestrator-Mr.Ma' as string | undefined, masterTitle: 'eterna-tasks orchestrator', workerSessionIds: ['worker-T-1'] }

describe('任务设置路由(access)', () => {
  let dir: string
  let store: UserStore
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let adminCookie: string
  let userCookie: string
  let face: TasksSettingsFace | undefined
  let saveResult: ReturnType<TasksSettingsFace['save']>
  let savedBlocks: Array<{ block: string; revision: number; value: unknown }>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-tasks-'))
    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    savedBlocks = []
    const session = new SessionService(Buffer.from('test-secret-test-secret-test-s'))
    store.createUserWithSuffix({ account: 'Mr.Ma', password: 'MqbSunny0702', role: 'admin' })
    store.createUserWithSuffix({ account: 'worker1', password: 'MqbSunny0703', role: 'user' })
    saveResult = { ok: true, saved: true, changed: false, revision: 3, policyVersion: 'pv-2', settings: { paused: false } }
    face = {
      read: () => VIEW,
      roles: () => ROLES,
      save: (block, value, revision) => {
        savedBlocks.push({ block, revision, value })
        return saveResult
      },
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
      tasksSettings: () => face,
    }
    adminCookie = login('Mr.Ma', 'MqbSunny0702')
    userCookie = login('worker1', 'MqbSunny0703')
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
  function post(body: unknown, cookie = adminCookie): AccessReply {
    return handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/tasks/settings', cookie, origin: 'http://localhost:3210',
      contentType: 'application/json', body: Buffer.from(JSON.stringify(body)),
    }))
  }

  it('匿名:roles 与 settings 都 401', () => {
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/tasks/session-roles' })).status).toBe(401)
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/tasks/settings' })).status).toBe(401)
  })

  it('普通用户:roles 200(徽标可用),settings 读写 403', () => {
    const roles = handleAccessRequest(deps, req({ pathname: '/access/api/tasks/session-roles', cookie: userCookie }))
    expect(roles.status).toBe(200)
    expect(bodyOf(roles)).toEqual({ ok: true, ...ROLES })
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/tasks/settings', cookie: userCookie })).status).toBe(403)
    expect(post({ block: 'pause', revision: 0, value: {} }, userCookie).status).toBe(403)
  })

  it('内核缺席(tasks 未装载):503 fail-closed,不返回假设置', () => {
    face = undefined
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/tasks/session-roles', cookie: adminCookie })).status).toBe(503)
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/tasks/settings', cookie: adminCookie })).status).toBe(503)
    expect(post({ block: 'pause', revision: 0, value: {} }).status).toBe(503)
  })

  it('admin GET:返回设置视图 + no-store;roles 同样 no-store', () => {
    const reply = handleAccessRequest(deps, req({ pathname: '/access/api/tasks/settings', cookie: adminCookie }))
    expect(reply.status).toBe(200)
    expect(reply.headers.find(([name]) => name === 'cache-control')?.[1]).toBe('no-store')
    const body = bodyOf(reply)
    expect(body['ok']).toBe(true)
    expect(body['policyVersion']).toBe('pv-1')
    expect(body['revisions']).toEqual(VIEW.revisions)
    const roles = handleAccessRequest(deps, req({ pathname: '/access/api/tasks/session-roles', cookie: adminCookie }))
    expect(roles.headers.find(([name]) => name === 'cache-control')?.[1]).toBe('no-store')
  })

  it('POST 参数校验:缺 value / 非法 block / 非整数 revision → 400,不调数据面', () => {
    const before = savedBlocks.length
    expect(post({ block: 'pause', revision: 0 }).status).toBe(400)
    expect(post({ block: 'shell', revision: 0, value: {} }).status).toBe(400)
    expect(post({ block: 'source:Bad_Name', revision: 0, value: {} }).status).toBe(400)
    expect(post({ block: 'pause', revision: 1.5, value: {} }).status).toBe(400)
    expect(post({ block: 'pause', revision: -1, value: {} }).status).toBe(400)
    expect(savedBlocks.length).toBe(before)
  })

  it('POST 成功:透传块/修订/value,响应含修订与版本,审计只记块与结果', () => {
    auditEvents.length = 0
    const value = { paused: true }
    const reply = post({ block: 'source:webchat', revision: 4, value })
    expect(reply.status).toBe(200)
    expect(savedBlocks).toEqual([{ block: 'source:webchat', revision: 4, value }])
    expect(bodyOf(reply)).toMatchObject({ ok: true, saved: true, changed: false, revision: 3, policyVersion: 'pv-2' })
    expect(auditEvents).toHaveLength(1)
    const event = auditEvents[0]
    expect(event?.kind).toBe('access.tasks.settings')
    expect(event?.account).toBe('Mr.Ma')
    expect(event?.ip).toBeTypeOf('string')
    expect(event?.ok).toBe(true)
    expect(event?.detail).toEqual({ block: 'source:webchat', saved: true, changed: false })
  })

  it('POST 冲突 → 409;非法设置 → 400(数据面 message 原样,审计 ok:false 带 code)', () => {
    saveResult = { ok: false, code: 'conflict', message: '设置已被其他保存更新，请重新加载' }
    const conflict = post({ block: 'pause', revision: 1, value: {} })
    expect(conflict.status).toBe(409)
    expect(bodyOf(conflict)['error']).toBe('设置已被其他保存更新，请重新加载')
    saveResult = { ok: false, code: 'invalid', message: '设置不合法（eval.timeoutSeconds）：...' }
    const invalid = post({ block: 'eval', revision: 1, value: {} })
    expect(invalid.status).toBe(400)
    const taskAudits = auditEvents.filter(event => event.kind === 'access.tasks.settings')
    expect(taskAudits.map(event => event.ok)).toEqual([false, false])
    expect(taskAudits.map(event => event.detail?.['code'])).toEqual(['conflict', 'invalid'])
  })

  it('POST 跨源拒绝(全局闸先于数据面)', () => {
    const before = savedBlocks.length
    const reply = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/tasks/settings', cookie: adminCookie,
      origin: 'http://evil.example', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ block: 'pause', revision: 0, value: {} })),
    }))
    expect(reply.status).toBe(403)
    expect(savedBlocks.length).toBe(before)
  })
})
