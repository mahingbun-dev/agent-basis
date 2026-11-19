/**
 * 知识库管理守卫(@eterna/knowledge-admin,2026-11-18;2026-11-19 融合后 18 端点):
 * 沿 tenant-guard-matrix 基座(真实 UserStore+SessionService+reflect 记录替身),
 * 断言真实 registerTenantGuards 注册出的路由(不是片段复刻):
 *  A. 未登录 → tenant/unauthenticated(cookie 认证来源正确);
 *  B. 非管理员显式指向他人账号 → tenant/denied + 审计,零直调服务面(守卫兜底);
 *  C. 本人/管理员放行,服务面收到 {account,admin,userId,human:true} 与原始 args;
 *  D. 服务面缺席 → failureFrame「知识库管理服务未挂载」(不静默降级不回退全局库);
 *  E. 写类 8 方法:成功 ok=true / 失败 ok=false+error 摘要,各落一条 access 审计;
 *  F. 白名单外端点不注册(清单即唯一注册源)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards } from '../src/tenant.ts'
import type { AccessAuditEvent } from '../src/audit.ts'

/** @eterna/knowledge-admin 契约表(与 tenant.ts 白名单逐字同步;漂移即红)。 */
const KNOWLEDGE_ADMIN_METHODS = [
  'listAccounts', 'overview', 'listDocs', 'readDoc', 'listProposals',
  'search', 'ask', 'listMembers', 'listAudit', 'testSource',
  'saveDoc', 'deprecateDoc', 'undoDeprecate', 'reviewProposal', 'discardProposal',
  'importMarkdown', 'importRepo', 'setMember',
] as const

interface RecordedCall {
  readonly method: string
  readonly params: unknown[]
}

describe('knowledgeAdmin 守卫:18 端点 × 身份/跨账号/审计/白名单', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let calls: RecordedCall[]
  let audits: AccessAuditEvent[]
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let adminId: number
  let aliceId: number
  let bobId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-kadmin-guard-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('kadmin-secret-kadmin-secret-000'))
    calls = []
    audits = []
    routes = new Map()
    adminId = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' }).user.id
    aliceId = store.createUserWithSuffix({ account: 'alice', password: 'password8' }).user.id
    bobId = store.createUserWithSuffix({ account: 'bob', password: 'password8' }).user.id

    // 服务面桩:记录 caller 与 args;saveDoc 固定抛错(失败审计分支)
    const face: Record<string, (caller: unknown, args: unknown) => unknown> = {}
    for (const m of KNOWLEDGE_ADMIN_METHODS) {
      face[m] = (caller, args) => {
        calls.push({ method: m, params: [caller, args] })
        if (m === 'saveDoc') throw new Error('duplicate doc id')
        return { method: m, account: (caller as { account?: string }).account }
      }
    }
    const reflect = { get: (key: string): unknown => (key === 'eterna-knowledge-admin' ? face : undefined) }
    const registry = {
      register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => {
        routes.set(route.path, route)
        return () => Promise.resolve()
      },
    }
    registerTenantGuards(
      { store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: (e: AccessAuditEvent) => { audits.push(e) } },
      { fetch: registry },
    )
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function cookieFor(userId: number): string {
    const user = store.getUserById(userId)
    return `eterna_session=${session.issue({ userId, passwordVersion: user?.passwordVersion ?? 1 })}`
  }

  async function call(method: string, userId: number | undefined, args: Record<string, unknown>) {
    const handler = routes.get(`/api/knowledgeAdmin/${method}`)
    if (handler === undefined) throw new Error(`route not registered: ${method}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (userId !== undefined) headers.cookie = cookieFor(userId)
    const response = await handler.fetch(new Request(`http://app.local/api/knowledgeAdmin/${method}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method, payload: { args } }),
    }))
    return JSON.parse(await response.text()) as { result: Record<string, unknown> }
  }

  const errOf = (r: { result: Record<string, unknown> }) =>
    (r.result as { error?: { code?: string; message?: string } })?.error
  const auditActions = () => audits.map(a => (a.detail as { action?: string }).action)

  it('A. 未登录 → tenant/unauthenticated', async () => {
    const r = await call('overview', undefined, {})
    expect(errOf(r)?.code).toBe('tenant/unauthenticated')
    expect(calls).toHaveLength(0)
  })

  it('B. 非管理员指向他人账号 → tenant/denied + 审计,零直调服务面', async () => {
    const r = await call('listDocs', bobId, { account: 'alice' })
    expect(errOf(r)?.code).toBe('tenant/denied')
    expect(calls).toHaveLength(0)
    expect(auditActions()).toContain('knowledgeAdmin.listDocs.denied')
    // targetAccount/accountId 键同样兜住
    const r2 = await call('readDoc', bobId, { targetAccount: 'alice', id: 'd1' })
    expect(errOf(r2)?.code).toBe('tenant/denied')
    // 本人显式带 account 不误拒
    const own = await call('listDocs', bobId, { account: 'bob' })
    expect(own.result).toMatchObject({ ok: true })
  })

  it('C. 本人/管理员放行,服务面收到 {account,admin,userId,human} 与原始 args', async () => {
    const own = await call('overview', aliceId, { page: 1 })
    expect(own.result).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params[0]).toEqual({ account: 'alice', admin: false, userId: aliceId, human: true })
    expect(calls[0]?.params[1]).toEqual({ page: 1 })

    calls = []
    const cross = await call('listDocs', adminId, { account: 'alice' })
    expect(cross.result).toMatchObject({ ok: true })
    expect(calls[0]?.params[0]).toEqual({ account: 'root', admin: true, userId: adminId, human: true })
  })

  it('D. 服务面缺席 → failureFrame「知识库管理服务未挂载」,不静默降级', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'eterna-kadmin-absent-'))
    const store2 = new UserStore(join(dir2, 'users.db'))
    try {
      const uid = store2.createUserWithSuffix({ account: 'carol', password: 'password8' }).user.id
      const routes2 = new Map<string, { fetch: (r: Request) => Promise<Response> }>()
      const registry2 = {
        register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => {
          routes2.set(route.path, route)
          return () => Promise.resolve()
        },
      }
      registerTenantGuards(
        { store: store2, session, reflect: { get: () => undefined }, tenantRoot: join(dir2, 'w'), audit: () => {} },
        { fetch: registry2 },
      )
      const h = routes2.get('/api/knowledgeAdmin/overview')
      expect(h).toBeDefined()
      const user = store2.getUserById(uid)
      const res = await h?.fetch(new Request('http://app.local/api/knowledgeAdmin/overview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `eterna_session=${session.issue({ userId: uid, passwordVersion: user?.passwordVersion ?? 1 })}` },
        body: JSON.stringify({ type: 'client-request', rpcId: 'r2', payload: { args: {} } }),
      }))
      const body = JSON.parse(await res?.text() ?? '{}') as { result: { error?: { code?: string; message?: string } } }
      expect(body.result.error?.code).toBe('gateway/internal')
      expect(body.result.error?.message).toContain('知识库管理服务未挂载')
    } finally {
      store2.close()
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('E. 写类成功/失败各落一条 access 审计;读类不落', async () => {
    const okWrite = await call('setMember', aliceId, { account: 'alice', level: 'edit' })
    expect(okWrite.result).toMatchObject({ ok: true })
    const failed = await call('saveDoc', adminId, { account: 'alice', id: 'x' })
    expect(errOf(failed)?.code).toBe('gateway/internal')
    await call('listAccounts', adminId, {}) // 读类:不落审计
    const writeActions = auditActions().filter(a => a?.startsWith('knowledgeAdmin.setMember') || a?.startsWith('knowledgeAdmin.saveDoc'))
    expect(writeActions).toHaveLength(2)
    const rows = audits.filter(a => (a.detail as { action?: string }).action?.startsWith('knowledgeAdmin.'))
    expect(rows.every(a => a.kind === 'access.tenant')).toBe(true)
    expect(rows.some(a => (a.detail as { ok?: boolean }).ok === true)).toBe(true)
    const bad = rows.find(a => (a.detail as { ok?: boolean }).ok === false)
    expect((bad?.detail as { error?: string }).error).toContain('duplicate doc id')
    expect(auditActions().some(a => a === 'knowledgeAdmin.listAccounts')).toBe(false)
  })

  it('F. 白名单外端点不注册(清单即唯一注册源)', () => {
    expect(routes.has('/api/knowledgeAdmin/dropTable')).toBe(false)
    expect(routes.has('/api/eternaKnowledgeAdmin/listAccounts')).toBe(false) // 裸网关面不透传
    for (const m of KNOWLEDGE_ADMIN_METHODS) {
      expect(routes.has(`/api/knowledgeAdmin/${m}`)).toBe(true)
    }
  })
})
