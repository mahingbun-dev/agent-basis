/**
 * tasks↔access 归属桥插件单测(A2,2026-11-19;fake ctx 模式,interact-plugin.spec 同款)。
 *
 * 覆盖(A2 验收口径):
 * - 删归属行 → apply → 行自动登记(recordSession 落写,workspaceId=null);
 * - 行已在且归属正确 → 不再写(recordSession 调用计数 0,幂等);
 * - realm 账号缺席 access 用户表 → 不登记 + log(部署不对齐显式可见);
 * - 账本面缺 recordSession/userIdByAccount 任一键 → fail-closed 不登记(旧 access 包);
 * - ctx.tasks 缺席 / masterId 未引导 → 不猜主会话、不登记;
 * - 配逆不撤销归属行(行持久,卸载语义=不再补登记)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME, defineTasksAccessBridgePlugin,
} from '../src/plugins/tasks-access-bridge-plugin.ts'
import { makeFakeContext, type FakeContextHarness } from './fake-context.ts'

const ACCOUNT = 'admin'
const MASTER_ID = 'orchestrator-admin'
const USER_ID = 7

/** access 账本面的假件(Map 账本 + recordSession 调用计数;结构=AccessStoreBridgeFace)。 */
function makeFakeStore(options: {
  readonly sessions?: Record<string, number>
  readonly users?: Record<string, number>
} = {}) {
  const sessions = new Map(Object.entries(options.sessions ?? {}))
  const users: Record<string, number> = { ...options.users }
  const calls: Array<{ sessionId: string; ownerId: number; workspaceId: string | null }> = []
  return {
    calls,
    sessionOwner: (id: string): number | undefined => sessions.get(id),
    recordSession: (sessionId: string, ownerId: number, workspaceId: string | null): void => {
      calls.push({ sessionId, ownerId, workspaceId })
      sessions.set(sessionId, ownerId)
    },
    userIdByAccount: (account: string): number | undefined => users[account],
    /** 验收探针:删归属行(A2 复跑口径的「删 users.db sessions 行」等价物)。 */
    deleteSession: (id: string): void => { sessions.delete(id) },
  }
}

type FakeStore = ReturnType<typeof makeFakeStore>

/** 假 tasks 服务(TasksBridgeFace 结构子集;realm=部署账号名,masterId=约定派生)。 */
function makeFakeTasks(realm: string = ACCOUNT, masterId: string | undefined = MASTER_ID) {
  return { id: 'tasks', realm, masterId }
}

/** 挂载桥插件(服务由调用侧预置进 harness;静态 inject 在真宿主是就绪门,假件直 apply)。 */
function mount(harness: FakeContextHarness): () => void {
  return defineTasksAccessBridgePlugin().apply(harness.fake as unknown as Context)
}

/** 预置齐备的 harness(账本面 + tasks 服务)。 */
function mountWith(store: FakeStore, tasks: object = makeFakeTasks()): () => void {
  const harness = makeFakeContext()
  harness.provide('eternaAccessStore', store)
  harness.provide('tasks', tasks)
  return mount(harness)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tasks-access-bridge 插件:主会话归属登记(A2)', () => {
  it('插件锚:名/inject 面钉住(模板挂载行与就绪门的契约)', () => {
    expect(ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME).toBe('eterna-tasks-access-bridge')
    const plugin = defineTasksAccessBridgePlugin()
    expect(plugin.name).toBe(ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME)
    expect(plugin.inject).toEqual(['tasks'])
  })

  it('删归属行 → apply → 行自动登记(owner=realm 账号,workspaceId=null)', () => {
    const store = makeFakeStore({ users: { [ACCOUNT]: USER_ID } })
    const dispose = mountWith(store)
    expect(store.sessionOwner(MASTER_ID)).toBe(USER_ID)
    expect(store.calls).toEqual([{ sessionId: MASTER_ID, ownerId: USER_ID, workspaceId: null }])
    dispose()
    // 登记行持久:配逆不撤销(撤销=主会话失去归属,/api/session/prompt 即被守卫拒)
    expect(store.sessionOwner(MASTER_ID)).toBe(USER_ID)
  })

  it('行已在且归属正确 → 不再写(recordSession 调用计数 0,幂等)', () => {
    const store = makeFakeStore({ sessions: { [MASTER_ID]: USER_ID }, users: { [ACCOUNT]: USER_ID } })
    mountWith(store)
    expect(store.calls).toHaveLength(0)
    expect(store.sessionOwner(MASTER_ID)).toBe(USER_ID)
  })

  it('行在但归属他人 → 覆写为 realm 账号(recordSession upsert 改判语义)', () => {
    const store = makeFakeStore({ sessions: { [MASTER_ID]: 42 }, users: { [ACCOUNT]: USER_ID } })
    mountWith(store)
    expect(store.calls).toEqual([{ sessionId: MASTER_ID, ownerId: USER_ID, workspaceId: null }])
    expect(store.sessionOwner(MASTER_ID)).toBe(USER_ID)
  })
})

describe('tasks-access-bridge 插件:fail-closed(只 log,不猜不登记)', () => {
  it('realm 账号缺席 access 用户表 → 不登记 + log(部署不对齐显式可见)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeFakeStore({ users: {} })
    mountWith(store)
    expect(store.calls).toHaveLength(0)
    expect(store.sessionOwner(MASTER_ID)).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(ACCOUNT)
  })

  it('eternaAccessStore 缺 recordSession/userIdByAccount 面(旧 access 包)→ fail-closed 不登记', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const harness = makeFakeContext()
    const store = makeFakeStore({ users: { [ACCOUNT]: USER_ID } })
    // 只暴露旧只读面(A2 之前的 eternaAccessStore 形态)
    harness.provide('eternaAccessStore', {
      sessionOwner: store.sessionOwner,
      recordSession: undefined,
      userIdByAccount: undefined,
    })
    harness.provide('tasks', makeFakeTasks())
    mount(harness)
    expect(store.calls).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('ctx.tasks 缺席(reflect 兜底得 undefined)→ 不登记', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeFakeStore({ users: { [ACCOUNT]: USER_ID } })
    const harness = makeFakeContext()
    harness.provide('eternaAccessStore', store)
    mount(harness)
    expect(store.calls).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('masterId 未引导(裸宿主且无 config)→ 不猜主会话,不登记', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeFakeStore({ users: { [ACCOUNT]: USER_ID } })
    // 显式 masterId: undefined(不走缺省参数——undefined 实参会激活缺省值)
    mountWith(store, { id: 'tasks', realm: ACCOUNT, masterId: undefined })
    expect(store.calls).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
