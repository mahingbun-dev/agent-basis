/**
 * T2(2026-11-11):mux 租户策略绑定——账本为唯一事实源。
 * alice 2 会话+1 工作区 → 1 GLOBAL + 2 session + 1 workspace 绑定;bob 0 资源 → 仅 GLOBAL。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { bindingsFor, GLOBAL_STREAM_ACTIONS, GLOBAL_UNARY_ACTIONS, SESSION_STREAM_ACTIONS, SESSION_UNARY_ACTIONS, WORKSPACE_STREAM_ACTIONS, WORKSPACE_UNARY_ACTIONS } from '../src/mux.ts'

describe('T2:mux 策略绑定', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let bobId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mux-policy-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('mux-secret-mux-secret-000000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    store.recordSession('s-a1', aliceId, null)
    store.recordSession('s-a2', aliceId, null)
    store.recordWorkspace('w-a1', aliceId, join(dir, 'workspaces', 'alice'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('alice:GLOBAL+2 session+1 workspace,动作清单完整', () => {
    const deps = { store, session }
    const bindings = bindingsFor(deps, aliceId)
    expect(bindings).toHaveLength(4)
    const global = bindings.filter(b => b.resource.kind === 'global')
    expect(global).toHaveLength(1)
    expect(global[0]?.role.actions).toEqual([...GLOBAL_STREAM_ACTIONS, ...GLOBAL_UNARY_ACTIONS])
    const sessions = bindings.filter(b => b.resource.kind === 'session')
    expect(sessions.map(b => (b.resource as { id: string }).id).sort()).toEqual(['s-a1', 's-a2'])
    // 会话角色含 workspace/follow(workspace 视图 sessionIds 逐项 allows 用,见 mux.ts 注释)
    expect(sessions[0]?.role.actions).toEqual([...SESSION_STREAM_ACTIONS, ...WORKSPACE_STREAM_ACTIONS, ...SESSION_UNARY_ACTIONS])
    const workspaces = bindings.filter(b => b.resource.kind === 'workspace')
    expect(workspaces.map(b => (b.resource as { id: string }).id)).toEqual(['w-a1'])
    expect(workspaces[0]?.role.actions).toEqual([...WORKSPACE_STREAM_ACTIONS, ...WORKSPACE_UNARY_ACTIONS])
  })

  it('bob:零资源 → 仅 GLOBAL(其余资源默认 deny)', () => {
    const deps = { store, session }
    const bindings = bindingsFor(deps, bobId)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.resource.kind).toBe('global')
  })

  it('归属变更后重读即反映(账本实时,无缓存漂移)', () => {
    const deps = { store, session }
    expect(bindingsFor(deps, aliceId).filter(b => b.resource.kind === 'session')).toHaveLength(2)
    store.recordSession('s-a3', aliceId, null)
    expect(bindingsFor(deps, aliceId).filter(b => b.resource.kind === 'session')).toHaveLength(3)
  })
})
