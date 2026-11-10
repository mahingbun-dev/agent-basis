/**
 * 登录开通(问题4)门禁:零工作区用户登录开通根工作区+首开空会话;
 * 已有工作区不重复开通;控制器缺席/异常不阻断(吞异常+审计留痕)。
 * provisionTenantWorkspace 现为导出函数,reflect 用记录器替身(与 tenant.spec 同构)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { provisionTenantWorkspace } from '../src/plugin.ts'
import { UserStore } from '../src/store.ts'

describe('登录开通 provisionTenantWorkspace', () => {
  let dir: string
  let store: UserStore
  let auditEvents: AccessAuditEvent[]
  let calls: Array<{ service: string; method: string; params: unknown[] }>
  let root: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-plugin-'))
    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    calls = []
    root = join(dir, 'workspaces')
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  type Services = Record<string, Record<string, (...args: unknown[]) => unknown>>

  function depsWith(services: Services): Parameters<typeof provisionTenantWorkspace>[0] {
    return {
      store,
      reflect: { get: (key: string): unknown => services[key] },
      tenantRoot: root,
      audit: event => auditEvents.push(event),
    }
  }

  it('首开:建根工作区+首开空会话,双双记账,审计带 firstSessionId', async () => {
    const user = store.createUserWithSuffix({ account: 'newbie', password: 'password8' }).user
    const deps = depsWith({
      workspaceController: {
        create: (requestRaw: unknown) => {
          calls.push({ service: 'workspaceController', method: 'create', params: [requestRaw] })
          return { workspace: { workspaceId: 'w-home', path: (requestRaw as { path: string }).path }, created: true }
        },
      },
      sessionController: {
        create: (request: unknown) => {
          calls.push({ service: 'sessionController', method: 'create', params: [request] })
          return { sessionId: 's-first' }
        },
      },
    })
    await provisionTenantWorkspace(deps, { id: user.id, account: user.account })
    expect(calls[0]).toMatchObject({ service: 'workspaceController', method: 'create' })
    expect((calls[0]?.params[0] as { path: string }).path).toBe(join(root, 'newbie'))
    expect(calls[1]).toMatchObject({ service: 'sessionController', method: 'create' })
    expect(calls[1]?.params[0]).toEqual({ workspaceId: 'w-home' })
    expect(store.workspaceOwner('w-home')).toBe(user.id)
    expect(store.sessionOwner('s-first')).toBe(user.id)
    expect(auditEvents.at(-1)?.detail).toMatchObject({ action: 'workspace.provision', workspaceId: 'w-home', firstSessionId: 's-first' })
  })

  it('已有工作区:零调用零审计(不重复开通,首开空会话不堆积)', async () => {
    const user = store.createUserWithSuffix({ account: 'legacy', password: 'password8' }).user
    store.recordWorkspace('w-legacy', user.id, join(root, 'legacy'))
    const deps = depsWith({})
    await provisionTenantWorkspace(deps, { id: user.id, account: user.account })
    expect(calls).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('控制器未就绪:静默返回,不抛错不误报审计(登录不被阻断)', async () => {
    const user = store.createUserWithSuffix({ account: 'early', password: 'password8' }).user
    const deps = depsWith({})
    await expect(provisionTenantWorkspace(deps, { id: user.id, account: user.account })).resolves.toBeUndefined()
    expect(auditEvents).toHaveLength(0)
  })

  it('控制器异常:吞异常落容器日志,审计带 error 明细', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = store.createUserWithSuffix({ account: 'boom', password: 'password8' }).user
    const deps = depsWith({
      workspaceController: {
        create: () => { throw new Error('db locked') },
      },
    })
    await expect(provisionTenantWorkspace(deps, { id: user.id, account: user.account })).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(auditEvents.at(-1)?.detail).toMatchObject({ action: 'workspace.provision', error: 'db locked' })
  })
})
