/**
 * 技能市场端点:登录门、普通用户不可维护来源、shared 安装仅 admin、
 * 安装落到 SkillStore(origin=market)并失效 provider、审计不含正文。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { SessionService } from '../src/session.ts'
import { installSkillsFetchRoutes, type SkillsDeps } from '../src/skills-routes.ts'
import { SkillMarket } from '../src/skill-market.ts'
import { SkillStore } from '../src/skills-store.ts'
import { UserStore } from '../src/store.ts'
import { zipOf } from './zip-fixture.ts'

interface RpcFrame {
  readonly ok: boolean
  readonly value?: Record<string, unknown>
  readonly error?: { readonly code?: string; readonly message?: string }
}

const ZIP = zipOf([
  { path: 'market-skill/SKILL.md', data: '---\nname: market-skill\ndescription: 市场技能\n---\n\nSECRET-BODY-market\n' },
  { path: 'market-skill/references/notes.md', data: '资源\n' },
])
const MARKDOWN = '---\nname: md-market-skill\ndescription: 市场 md\n---\n\nSECRET-BODY-md\n'

describe('技能市场 RPC', () => {
  let dir: string
  let users: UserStore
  let session: SessionService
  let skills: SkillStore
  let market: SkillMarket
  let routes: Map<string, (request: Request) => Promise<Response>>
  let dispose: () => void
  let auditEvents: AccessAuditEvent[]
  let invalidations: number
  let userCookie: string
  let adminCookie: string
  let downloads: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-skill-market-routes-'))
    users = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('skill-market-route-secret-000000'))
    skills = new SkillStore({ tenantRoot: join(dir, 'tenant'), accessDir: join(dir, 'access') })
    const alice = users.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const admin = users.createUserWithSuffix({ account: 'admin', password: 'password8', role: 'admin' })
    const cookie = (userId: number): string => `eterna_session=${session.issue({
      userId, passwordVersion: users.getUserById(userId)?.passwordVersion ?? 1,
    })}`
    userCookie = cookie(alice.user.id)
    adminCookie = cookie(admin.user.id)
    auditEvents = []
    invalidations = 0
    downloads = 0
    // 市场适配器:skillhub 搜索返回一条;下载返回 zip 或 md(zip 走 installZip)。
    market = new SkillMarket({
      accessDir: join(dir, 'access'),
      fetchImpl: (input) => {
        const url = input as string
        if (url.includes('/api/v1/download')) {
          downloads += 1
          return Promise.resolve(new Response(new Uint8Array(ZIP), { status: 200 }))
        }
        if (url.includes('/api/v1/search') || url.includes('/api/v1/showcase')) {
          return Promise.resolve(new Response(JSON.stringify({
            results: [{
              slug: 'market-skill', displayName: '市场技能', summary: '演示', version: '1.0.0',
              namespace: { handle: 'demo' },
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return Promise.resolve(new Response(MARKDOWN, { status: 200 }))
      },
    })
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
      market,
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

  async function call(path: string, cookie: string | undefined, args: Record<string, unknown> = {}): Promise<RpcFrame> {
    const route = routes.get(path)
    expect(route, `route missing: ${path}`).toBeDefined()
    const response = await route!(new Request(`http://local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ type: 'client-request', rpcId: `r-${Math.random().toString(36).slice(2)}`, payload: { args } }),
    }))
    expect(response.status).toBe(200)
    return (await response.json() as { result: RpcFrame }).result
  }

  it('未登录 tenant/unauthenticated(市场端点同门)', async () => {
    const frame = await call('/api/skills-manage/market/list', undefined)
    expect(frame.ok).toBe(false)
    expect(frame.error?.code).toBe('tenant/unauthenticated')
  })

  it('来源:全员可列;普通用户不可增删;admin 增删生效且 builtin 不可删', async () => {
    const list = await call('/api/skills-manage/market/list', userCookie)
    expect(list.ok).toBe(true)
    expect((list.value?.sources as Array<{ id: string }>).map(source => source.id)).toStrictEqual(['skillhub'])

    const denied = await call('/api/skills-manage/market/source-add', userCookie, { name: 'x', url: 'https://example.com/a.json' })
    expect(denied.ok).toBe(false)
    expect(denied.error?.code).toBe('skills/denied')

    const added = await call('/api/skills-manage/market/source-add', adminCookie, { name: 'x', url: 'https://example.com/a.json' })
    expect(added.ok).toBe(true)
    const id = (added.value?.source as { id: string }).id

    const removed = await call('/api/skills-manage/market/source-remove', adminCookie, { id })
    expect(removed.ok).toBe(true)
    const removeBuiltin = await call('/api/skills-manage/market/source-remove', adminCookie, { id: 'skillhub' })
    expect(removeBuiltin.ok).toBe(false)
    expect(removeBuiltin.error?.message).toMatch(/内置/)
  })

  it('搜索:全员可用,返回归一化条目', async () => {
    const frame = await call('/api/skills-manage/market/search', userCookie, { sourceId: 'skillhub', query: 'demo' })
    expect(frame.ok).toBe(true)
    const entries = frame.value?.entries as Array<{ slug: string; name: string; namespace?: string }>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ slug: 'market-skill', name: '市场技能', namespace: 'demo' })
  })

  it('安装:个人可装(zip 落 store,origin=market)、共享仅 admin、审计不含正文', async () => {
    const personal = await call('/api/skills-manage/market/install', userCookie, {
      scope: 'personal', sourceId: 'skillhub', slug: 'market-skill', version: '1.0.0',
    })
    expect(personal.ok).toBe(true)
    expect(invalidations).toBe(1)
    const item = personal.value?.item as { name: string; origin: string; scope: string }
    expect(item).toMatchObject({ name: 'market-skill', origin: 'market', scope: 'personal' })
    expect(downloads).toBe(1)
    // 落盘内容(含 references)在个人根下
    const read = await call('/api/skills-manage/read', userCookie, { scope: 'personal', name: 'market-skill' })
    expect((read.value?.markdown as string)).toContain('SECRET-BODY-market')

    const sharedByUser = await call('/api/skills-manage/market/install', userCookie, {
      scope: 'shared', sourceId: 'skillhub', slug: 'market-skill',
    })
    expect(sharedByUser.ok).toBe(false)
    expect(sharedByUser.error?.code).toBe('skills/denied')

    const sharedByAdmin = await call('/api/skills-manage/market/install', adminCookie, {
      scope: 'shared', sourceId: 'skillhub', slug: 'market-skill',
    })
    expect(sharedByAdmin.ok).toBe(true)
    expect((sharedByAdmin.value?.item as { scope: string }).scope).toBe('shared')

    // 审计只记元数据
    const serialized = JSON.stringify(auditEvents)
    expect(serialized).not.toContain('SECRET-BODY')
    const installEvents = auditEvents.filter(event => event.detail?.action === 'install' && event.ok)
    expect(installEvents.length).toBe(2)
    expect(installEvents[0]?.detail).toMatchObject({ slug: 'market-skill', kind: 'zip' })
  })

  it('安装:参数缺失/来源不存在/重复安装有稳定错误码', async () => {
    const noScope = await call('/api/skills-manage/market/install', userCookie, { sourceId: 'skillhub', slug: 'market-skill' })
    expect(noScope.ok).toBe(false)

    const unknownSource = await call('/api/skills-manage/market/search', userCookie, { sourceId: 'nope' })
    expect(unknownSource.ok).toBe(false)
    expect(unknownSource.error?.code).toBe('skills/market-not-found')

    await call('/api/skills-manage/market/install', userCookie, { scope: 'personal', sourceId: 'skillhub', slug: 'market-skill' })
    const again = await call('/api/skills-manage/market/install', userCookie, { scope: 'personal', sourceId: 'skillhub', slug: 'market-skill' })
    expect(again.ok).toBe(false)
    expect(again.error?.code).toBe('skills/conflict')
    expect(again.error?.message).toMatch(/已存在/)
  })
})
