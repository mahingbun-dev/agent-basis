/**
 * Skill 管理端点:登录门、个人隔离、共享 admin 写门、停用共享对非 admin 不可见、
 * 信封校验、no-store、审计不含正文。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { SessionService } from '../src/session.ts'
import { installSkillsFetchRoutes, type SkillsDeps } from '../src/skills-routes.ts'
import { SkillStore } from '../src/skills-store.ts'
import { UserStore } from '../src/store.ts'

interface RpcFrame {
  readonly ok: boolean
  readonly value?: Record<string, unknown>
  readonly error?: { readonly code?: string; readonly message?: string }
}

function markdown(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nSECRET-BODY-${name}\n`
}

describe('Skill 管理 RPC', () => {
  let dir: string
  let users: UserStore
  let session: SessionService
  let skills: SkillStore
  let routes: Map<string, (request: Request) => Promise<Response>>
  let dispose: () => void
  let auditEvents: AccessAuditEvent[]
  let invalidations: number
  let aliceCookie: string
  let bobCookie: string
  let adminCookie: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-skills-routes-'))
    users = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('skills-route-test-secret-000000'))
    skills = new SkillStore({ tenantRoot: join(dir, 'tenant'), accessDir: join(dir, 'access') })
    const alice = users.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = users.createUserWithSuffix({ account: 'bob', password: 'password8' })
    const admin = users.createUserWithSuffix({ account: 'admin', password: 'password8', role: 'admin' })
    const cookie = (userId: number): string => `eterna_session=${session.issue({
      userId, passwordVersion: users.getUserById(userId)?.passwordVersion ?? 1,
    })}`
    aliceCookie = cookie(alice.user.id)
    bobCookie = cookie(bob.user.id)
    adminCookie = cookie(admin.user.id)
    auditEvents = []
    invalidations = 0
    routes = new Map()
    const deps: SkillsDeps = {
      skills,
      session,
      audit: event => auditEvents.push(event),
      runtime: { invalidate: () => { invalidations += 1 } },
      userOf: (userId) => {
        const user = users.getUserById(userId)
        return user === undefined ? undefined : { account: user.account, role: user.role }
      },
      passwordVersionOf: userId => users.getUserById(userId)?.passwordVersion,
    }
    dispose = installSkillsFetchRoutes(deps, {
      fetch: {
        register: (route) => {
          routes.set(route.path, route.fetch)
          return () => { routes.delete(route.path) }
        },
      },
    })
  })

  afterEach(() => {
    dispose()
    users.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function rawCall(path: string, cookie: string | undefined, body: unknown): Promise<Response> {
    const route = routes.get(path)
    expect(route, `route missing: ${path}`).toBeDefined()
    return route!(new Request(`http://local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }))
  }

  async function call(path: string, cookie: string | undefined, args: Record<string, unknown> = {}): Promise<RpcFrame> {
    const response = await rawCall(path, cookie, {
      type: 'client-request', rpcId: `r-${Math.random().toString(36).slice(2)}`, payload: { args },
    })
    expect(response.status).toBe(200)
    return (await response.json() as { result: RpcFrame }).result
  }

  it('未登录一律 tenant/unauthenticated;坏信封 400', async () => {
    const result = await call('/api/skills-manage/list', undefined)
    expect(result.error?.code).toBe('tenant/unauthenticated')
    const response = await rawCall('/api/skills-manage/list', aliceCookie, { nope: true })
    expect(response.status).toBe(400)
  })

  it('个人技能仅本人可见可写,他人读删与不存在同响应', async () => {
    const created = await call('/api/skills-manage/save', aliceCookie, {
      scope: 'personal', markdown: markdown('alice-skill', '爱丽丝私有'),
    })
    expect(created.ok).toBe(true)
    const aliceList = await call('/api/skills-manage/list', aliceCookie)
    expect((aliceList.value?.items as Array<{ name: string; scope: string }>).map(row => `${row.scope}/${row.name}`))
      .toEqual(['personal/alice-skill'])
    const bobList = await call('/api/skills-manage/list', bobCookie)
    expect(bobList.value?.items).toEqual([])
    const bobRead = await call('/api/skills-manage/read', bobCookie, { scope: 'personal', name: 'alice-skill' })
    expect(bobRead.ok).toBe(false)
    expect(bobRead.error?.code).toBe('skills/not-found')
    const bobDelete = await call('/api/skills-manage/delete', bobCookie, { scope: 'personal', name: 'alice-skill' })
    expect(bobDelete.ok).toBe(false)
    expect(bobDelete.error?.code).toBe('skills/not-found')
  })

  it('共享技能普通用户只读,admin 可写;停用项对普通用户不可见', async () => {
    const denied = await call('/api/skills-manage/save', bobCookie, {
      scope: 'shared', markdown: markdown('team-skill', '团队'),
    })
    expect(denied.ok).toBe(false)
    expect(denied.error?.message).toMatch(/管理员/)

    const created = await call('/api/skills-manage/save', adminCookie, {
      scope: 'shared', markdown: markdown('team-skill', '团队技能'),
    })
    expect(created.ok).toBe(true)
    const bobList = await call('/api/skills-manage/list', bobCookie)
    expect((bobList.value?.items as Array<{ name: string }>).map(row => row.name)).toEqual(['team-skill'])
    expect(bobList.value?.sharedReadOnly).toBe(true)

    await call('/api/skills-manage/toggle', adminCookie, { scope: 'shared', name: 'team-skill', enabled: false })
    const bobHidden = await call('/api/skills-manage/list', bobCookie)
    expect(bobHidden.value?.items).toEqual([])
    const bobReadDisabled = await call('/api/skills-manage/read', bobCookie, { scope: 'shared', name: 'team-skill' })
    expect(bobReadDisabled.error?.code).toBe('skills/denied')
    const adminList = await call('/api/skills-manage/list', adminCookie)
    expect(adminList.value?.sharedReadOnly).toBeUndefined()
  })

  it('响应 no-store 且审计不含正文/frontmatter', async () => {
    const response = await rawCall('/api/skills-manage/save', aliceCookie, {
      type: 'client-request', rpcId: 'r-audit', payload: { args: {
        scope: 'personal', markdown: markdown('audit-skill', '审计用'),
      } },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = JSON.stringify(auditEvents)
    expect(payload).not.toContain('SECRET-BODY')
    expect(payload).not.toContain('审计用')
    expect(auditEvents.some(event => event.detail?.action === 'create')).toBe(true)
    expect(invalidations).toBe(1)
  })

  it('install-md 与 install-zip 走同一写门,错误码稳定', async () => {
    const md = await call('/api/skills-manage/install-md', aliceCookie, {
      scope: 'personal', content: markdown('md-skill', 'md'),
    })
    expect(md.ok).toBe(true)
    expect((md.value?.item as { origin?: string }).origin).toBe('upload-md')
    const badBase64 = await call('/api/skills-manage/install-zip', aliceCookie, {
      scope: 'personal', dataBase64: 'not-base64!',
    })
    expect(badBase64.error?.message).toMatch(/base64/)
  })

  it('参数缺失/非法 scope 被拒', async () => {
    const badScope = await call('/api/skills-manage/save', aliceCookie, {
      scope: 'root', markdown: markdown('x-skill', 'x'),
    })
    expect(badScope.error?.message).toMatch(/scope/)
    const missing = await call('/api/skills-manage/read', aliceCookie, { scope: 'personal' })
    expect(missing.error?.code).toBe('skills/denied')
    expect((await call('/api/skills-manage/read', aliceCookie, { scope: 'personal', name: 'nope' })).error?.code)
      .toBe('skills/not-found')
  })
})
