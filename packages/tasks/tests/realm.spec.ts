/**
 * TasksRealmRouter——realm → Store 的 LRU 池(35 号 A11 验收门禁;=33 号 G2-A7)。
 *
 * 设计依据:34 号 §2.3 realm 行(23 号 §3.1 方案 C 同构,MemoryAccountRouter 先例):
 * - 一租户一 SQLite:两 realm 数据互不可见(物理分库,隔离不靠查询纪律);
 * - 库路径派生自 workspaces/<账号>/.eterna/(tenant-scan 级断言,34 §4-C);
 * - fail-closed:账号目录解析失败不开库、不隐式建目录;
 * - LRU:池上限逐出最久未用并 close、闲置超时回收、dispose 全关、配逆幂等。
 * (realm 标注落库断言的内核半边在 core-engine.spec.ts「realm 首参路由」组,35 号 A5。)
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store, TasksRealmRouter } from '../src/index.ts'
import type { Assignment, Ticket } from '../src/index.ts'

let directory: string
/** 账号目录由 access 登录开通创建(router 只消费,不隐式建——23 号 §3.1)。 */
const provision = (account: string): string => {
  const dir = join(directory, account)
  mkdirSync(dir, { recursive: true })
  return dir
}
const dirOf = (realm: string): string | undefined => (existsSync(join(directory, realm)) ? join(directory, realm) : undefined)
const routerOf = (): TasksRealmRouter => new TasksRealmRouter({ dirOf })

const ticket = (id: string): Ticket => ({
  id, title: id, decisionId: '', realm: id === 't-a' ? 'alice' : 'bob',
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'x', id: '' }, scope: '', realm: id === 't-a' ? 'alice' : 'bob' },
  channels: [], assignments: [] as Assignment[], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: '', triggerIds: [] } })

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-realm-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

it('一租户一 SQLite:两 realm 各自开库,数据互不可见;库路径派生自 workspaces/<账号>', () => {
  provision('alice'); provision('bob')
  const router = routerOf()
  const alice = router.forRealm('alice')
  const bob = router.forRealm('bob')
  expect([alice, bob].every(store => store instanceof Store)).toBe(true)
  expect(alice!.path).toBe(join(directory, 'alice', '.eterna', 'tasks.sqlite3'))
  expect(bob!.path).toBe(join(directory, 'bob', '.eterna', 'tasks.sqlite3'))
  alice!.tickets.save(ticket('t-a'))
  bob!.tickets.save(ticket('t-b'))
  expect(alice!.tickets.list().map(item => item.id)).toEqual(['t-a'])
  expect(bob!.tickets.list().map(item => item.id)).toEqual(['t-b'])
  router.dispose()
})

it('同 realm 复用同一实例(LRU 命中不重开)', () => {
  provision('alice')
  const router = routerOf()
  expect(router.forRealm('alice')).toBe(router.forRealm('alice'))
  expect(router.size).toBe(1)
  router.dispose()
})

it('fail-closed:目录解析失败不开库、不隐式建目录;dispose 后同样拒绝', () => {
  provision('alice')
  const router = routerOf()
  expect(router.forRealm('ghost')).toBeUndefined()
  expect(existsSync(join(directory, 'ghost'))).toBe(false)
  router.dispose()
  expect(router.forRealm('alice')).toBeUndefined()
  // dispose 幂等。
  router.dispose()
})

it('LRU:池满逐出最久未用并 close,被逐 realm 下次调用重建', () => {
  for (const account of ['a', 'b', 'c']) provision(account)
  const router = new TasksRealmRouter({ dirOf, maxInstances: 2 })
  const first = router.forRealm('a')
  router.forRealm('b')
  expect(router.size).toBe(2)
  router.forRealm('c')
  expect(router.size).toBe(2)
  // a 已被逐出:重建为新实例(旧句柄已 close)。
  const reopened = router.forRealm('a')
  expect(reopened).not.toBe(first)
  expect(router.size).toBe(2)
  router.dispose()
})

it('闲置超时惰性回收:下次调用先 close 出池;时钟注入驱动', () => {
  provision('alice')
  let clock = 1_000_000
  const router = new TasksRealmRouter({ dirOf, idleMs: 600_000, now: () => clock })
  router.forRealm('alice')
  clock += 600_001
  provision('bob')
  router.forRealm('bob')
  expect(router.size).toBe(1)
  // alice 已回收:再取是重开的新实例。
  expect(router.forRealm('alice')).toBeInstanceOf(Store)
  expect(router.size).toBe(2)
  router.dispose()
})

it('注入工厂:glue 以 create(dir, realm) 装配(report 等选项随闭包注入)', () => {
  provision('alice')
  const reports: unknown[] = []
  const router = new TasksRealmRouter({
    dirOf,
    create: (dir, realm) => new Store(realm, { workspaceDir: dir, report: (error) => { reports.push(error) } }),
  })
  const store = router.forRealm('alice')!
  expect(store.path).toBe(join(directory, 'alice', '.eterna', 'tasks.sqlite3'))
  store.atomic(() => {
    store.set('probe', 1)
    store.afterCommit(() => { throw new Error('x') })
  })
  expect(reports).toHaveLength(1)
  router.dispose()
})
