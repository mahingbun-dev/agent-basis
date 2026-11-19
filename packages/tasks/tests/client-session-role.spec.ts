/**
 * 会话角色徽标单测(2026-11-19 会话级 super 标记):
 * sessionRoleOf 精确匹配(主会话 id 优先于 worker 集,普通会话 undefined);
 * 徽标渲染抛给宿主运行时,这里只钉角色判定与缓存重置面(无 DOM)。
 */
import { describe, expect, it } from 'vitest'
import { resetSessionRolesCache, sessionRoleOf } from '../src/client/session-role.tsx'
import type { TasksSessionRoles } from '../src/client/api.ts'

const roles: TasksSessionRoles = {
  masterId: 'orchestrator-alice',
  masterTitle: 'eterna-tasks orchestrator',
  workerSessionIds: ['worker-t-1', 'worker-t-2'],
}

describe('sessionRoleOf', () => {
  it('主会话 id 命中 → orchestrator', () => {
    expect(sessionRoleOf('orchestrator-alice', roles)).toBe('orchestrator')
  })

  it('worker session id 命中 → worker', () => {
    expect(sessionRoleOf('worker-t-2', roles)).toBe('worker')
  })

  it('普通会话/前缀近似 id 不命中', () => {
    expect(sessionRoleOf('sess-abc', roles)).toBeUndefined()
    expect(sessionRoleOf('worker-t-1-extra', roles)).toBeUndefined()
    expect(sessionRoleOf('orchestrator-alice-2', roles)).toBeUndefined()
  })

  it('角色面缺席 → 不渲染(fail-closed)', () => {
    expect(sessionRoleOf('orchestrator-alice', undefined)).toBeUndefined()
  })

  it('主会话未引导(masterId undefined)时 worker 判定不受影响', () => {
    expect(sessionRoleOf('worker-t-1', { masterId: undefined, masterTitle: 'x', workerSessionIds: ['worker-t-1'] })).toBe('worker')
  })

  it('同一 id 同时出现在主会话与 worker 集 → 主控优先', () => {
    expect(sessionRoleOf('orchestrator-alice', { ...roles, workerSessionIds: ['orchestrator-alice'] })).toBe('orchestrator')
  })
})

describe('resetSessionRolesCache', () => {
  it('可重复调用(测试/登出场景)', () => {
    expect(() => { resetSessionRolesCache(); resetSessionRolesCache() }).not.toThrow()
  })
})
