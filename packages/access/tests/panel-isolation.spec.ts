/**
 * 面板账号隔离守卫(2026-11-17,PR#84 部署复验补丁):unary SRC 通道 principal 恒
 * owner(mux 换血只作用流通道),后端隔离必须落在 access 守卫层(身份=cookie):
 * - /api/eternaPanel/snapshot:按登录身份组装(admin 全局;普通账号本人记忆/知识库/
 *   会话),堵住登录后直调拿全局快照的旁路;
 * - /api/eternaPanel/{review,reviewForAccount,trackCorrection}:裸网关直调 admin-only
 *   (客户端走 /api/eternaMemory/* 守卫端);
 * - /api/loopPrompt/*(13 端点):非 admin 一律 tenant/denied,admin 直调网关方法
 *   (args.input 语义与网关 SRC 派发一致)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

const LOOP_PROMPT_ENDPOINTS = [
  'snapshot', 'trace', 'prompt-get', 'prompt-save', 'prompt-versions', 'prompt-rollback',
  'prompt-export', 'prompt-import', 'session-snapshot', 'ai-status', 'ai-polish', 'ai-review', 'ai-proposal',
] as const

describe('面板/工坊账号隔离守卫(unary 通道身份在 cookie)', () => {
  let dir = ''
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let adminId = 0
  let userId = 0
  const snapshotIdentities: Array<{ account: string; admin: boolean; ownedSessionIds: readonly string[] }> = []
  const loopCalls: Array<{ method: string; arg: unknown }> = []
  const panelCalls: Array<{ method: string; arg: unknown }> = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-panel-guard-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('panel-guard-secret-panel-guard-0'))
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' })
    const user = store.createUserWithSuffix({ account: 'alice', password: 'password8', role: 'user' })
    adminId = admin.user.id
    userId = user.user.id
    store.recordSession('s-alice-1', userId, null)
    snapshotIdentities.length = 0
    loopCalls.length = 0
    panelCalls.length = 0
    const services: Record<string, Record<string, (...args: never[]) => unknown>> = {
      'eterna-panel-accounts': {
        snapshotForUser: (identity: never) => {
          snapshotIdentities.push(identity)
          return { generatedAt: 'x', memory: {}, knowledge: {}, observability: {}, governance: {}, tools: [], workspace: '/w' }
        },
      },
      'loopPrompt': {
        snapshot: (...args: never[]) => { loopCalls.push({ method: 'snapshot', arg: args[0] }); return { entries: [] } },
        promptGet: (...args: never[]) => { loopCalls.push({ method: 'promptGet', arg: args[0] }); return { persona: {} } },
        trace: (...args: never[]) => { loopCalls.push({ method: 'trace', arg: args[0] }); return { sessions: [] } },
      },
      'eternaPanel': {
        review: (...args: never[]) => { panelCalls.push({ method: 'review', arg: args[0] }); return { ok: true } },
      },
    }
    const reflect = { get: (key: string): unknown => services[key] }
    routes = new Map()
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: join(dir, 'workspaces'), audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function cookieFor(userIdFor: number): string {
    const user = store.getUserById(userIdFor)
    return `eterna_session=${session.issue({ userId: userIdFor, passwordVersion: user?.passwordVersion ?? 1 })}`
  }

  async function call(path: string, actor: 'admin' | 'user' | undefined, payloadArgs: Record<string, unknown>) {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`route not registered: ${path}`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (actor !== undefined) headers.cookie = cookieFor(actor === 'admin' ? adminId : userId)
    const response = await handler.fetch(new Request(`http://app.local${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'client-request', rpcId: 'g1', method: path.slice(5), payload: { args: payloadArgs } }),
    }))
    const result = JSON.parse(await response.text()) as { result?: Record<string, unknown> }
    return result.result as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
  }

  it('/api/eternaPanel/snapshot:普通账号按 cookie 身份组装(本人会话集),admin 全局', async () => {
    const userOutcome = await call('/api/eternaPanel/snapshot', 'user', {})
    expect(userOutcome.ok).toBe(true)
    expect(snapshotIdentities.at(-1)).toEqual({ account: 'alice', admin: false, ownedSessionIds: ['s-alice-1'] })
    const adminOutcome = await call('/api/eternaPanel/snapshot', 'admin', {})
    expect(adminOutcome.ok).toBe(true)
    expect(snapshotIdentities.at(-1)).toEqual({ account: 'root', admin: true, ownedSessionIds: [] })
    // 未登录 → 统一未认证帧
    const anonymous = await call('/api/eternaPanel/snapshot', undefined, {})
    expect(anonymous.error?.code).toBe('tenant/unauthenticated')
  })

  it('提示词工坊 13 端点:普通账号一律 tenant/denied 且零直调;admin 直调网关(args.input)', async () => {
    for (const endpoint of LOOP_PROMPT_ENDPOINTS) {
      const outcome = await call(`/api/loopPrompt/${endpoint}`, 'user', { input: {} })
      expect(outcome.ok, endpoint).toBe(false)
      expect(outcome.error?.code, endpoint).toBe('tenant/denied')
      expect(outcome.error?.message, endpoint).toContain('提示词工坊仅管理员可用')
    }
    expect(loopCalls).toHaveLength(0)
    // admin 直调:参数按方法名从 args.input 取(带参端点);无参端点 input 缺席即 undefined
    const adminSnapshot = await call('/api/loopPrompt/snapshot', 'admin', {})
    expect(adminSnapshot).toEqual({ ok: true, value: { entries: [] } })
    const adminGet = await call('/api/loopPrompt/prompt-get', 'admin', { input: { entryId: 'preset.standard.persona' } })
    expect(adminGet.ok).toBe(true)
    expect(loopCalls).toEqual([
      { method: 'snapshot', arg: undefined },
      { method: 'promptGet', arg: { entryId: 'preset.standard.persona' } },
    ])
  })

  it('面板写端点裸网关直调:普通账号 denied,admin 透传 gateway(payload 语义)', async () => {
    const denied = await call('/api/eternaPanel/review', 'user', { payload: { id: 1, decision: 'approved' } })
    expect(denied.error?.code).toBe('tenant/denied')
    expect(panelCalls).toHaveLength(0)
    const allowed = await call('/api/eternaPanel/review', 'admin', { payload: { id: 1, decision: 'approved' } })
    expect(allowed.ok).toBe(true)
    expect(panelCalls).toEqual([{ method: 'review', arg: { id: 1, decision: 'approved' } }])
  })
})
