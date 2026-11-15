/**
 * 多租户路由测试(23 号 M-T1):池 LRU/目录解析失败/双账号互不可见(隔离 E2E
 * 的库级形态)/Denied fail-closed/工具路由(exec 会话→账号库)。
 */
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  createDeniedMemory, createMemory, defineMemoryTools,
  isMemoryAccountDeniedError, MEMORY_TOOL_NAMES, MemoryAccountRouter, MemoryAccountDeniedError,
} from '../src/index.ts'
import type { Memory, MemorySessionResolver } from '../src/index.ts'

const T0 = 1_793_760_000_000

describe('MemoryAccountRouter(池)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-memory-router-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const makeRouter = (over: { maxInstances?: number; idleMs?: number; now?: () => number } = {}) =>
    new MemoryAccountRouter({
      dirOf: account => (existsSync(join(dir, account)) ? join(dir, account) : undefined),
      create: subdir => createMemory({ workspaceDir: join(subdir, 'NOTES'), dbPath: join(subdir, '.eterna', 'memory.sqlite3'), now: () => T0 }),
      ...over,
    })

  const seedAccount = (account: string): string => {
    const subdir = join(dir, account)
    mkdirSync(join(subdir, '.eterna'), { recursive: true })
    return subdir
  }

  it('同账号复用同实例;不同账号不同实例且互不可见(隔离 E2E 库级)', async () => {
    const alice = seedAccount('alice')
    const bob = seedAccount('bob')
    const router = makeRouter()
    const m1 = router.forAccount('alice')
    const m2 = router.forAccount('alice')
    expect(m1).toBe(m2)
    const b1 = router.forAccount('bob')
    expect(b1).not.toBe(m1)
    // 双账号互不可见:alice 写入,bob 检索不到
    m1?.writeEntity({ subject: 'user', key: 'secret-alice', content: 'Alice 的私有偏好', kind: 'semantic', scope: 'user', source: 'explicit' })
    expect((await b1?.search('私有偏好', { scope: 'user' }))?.length ?? 0).toBe(0)
    expect((await m1?.search('私有偏好', { scope: 'user' }))?.length).toBe(1)
    // 物理分库:两库文件在不同目录
    expect(existsSync(join(alice, '.eterna', 'memory.sqlite3'))).toBe(true)
    expect(existsSync(join(bob, '.eterna', 'memory.sqlite3'))).toBe(true)
    router.dispose()
  })

  it('目录不存在 → undefined(fail-closed,不隐式建)', () => {
    const router = makeRouter()
    expect(router.forAccount('ghost')).toBeUndefined()
    expect(existsSync(join(dir, 'ghost'))).toBe(false)
  })

  it('LRU:池满逐出最久未用实例(close 出池);重访重建', () => {
    for (const a of ['a1', 'a2', 'a3']) seedAccount(a)
    const now = { v: T0 }
    const router = makeRouter({ maxInstances: 2, now: () => now.v })
    const r1 = router.forAccount('a1')
    now.v += 1000
    router.forAccount('a2')
    now.v += 1000
    router.forAccount('a3') // 逐出 a1
    expect(router.size).toBe(2)
    const again = router.forAccount('a1') // 重建(非原实例)
    expect(again).not.toBe(r1)
  })

  it('闲置回收:idleMs 超时后实例 close 出池', () => {
    seedAccount('idle')
    const now = { v: T0 }
    const router = makeRouter({ idleMs: 60_000, now: () => now.v })
    expect(router.forAccount('idle')).not.toBeNull()
    now.v += 61_000
    router.forAccount('idle') // 触发 reap;idle 超时 → 重建
    // size=1(重建后的新实例),旧实例已被 dispose
    expect(router.size).toBe(1)
  })

  it('dispose 全关;dispose 后 forAccount 返回 undefined', () => {
    seedAccount('x')
    const router = makeRouter()
    expect(router.forAccount('x')).not.toBeNull()
    router.dispose()
    expect(router.forAccount('x')).toBeUndefined()
  })
})

describe('Denied memory(fail-closed)', () => {
  it('写抛 MemoryAccountDeniedError;读空;索引只有行为头+提示', async () => {
    const denied = createDeniedMemory()
    expect(() => denied.writeEntity({ subject: 'user', key: 'k', content: 'c', kind: 'semantic', scope: 'user' })).toThrow(MemoryAccountDeniedError)
    expect(isMemoryAccountDeniedError(new MemoryAccountDeniedError())).toBe(true)
    expect(denied.readEntity('user', 'k')).toBeNull()
    expect((await denied.search('任何词')).length).toBe(0)
    const index = denied.buildIndex()
    expect(index.text).toContain('记忆归属不可用')
    expect(index.total).toBe(0)
    expect(denied.metrics().reviews.acceptanceRate).toBeNull()
    expect(denied.listForReview('pending')).toEqual([])
  })
})

describe('工具路由(exec 会话 → 账号库)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-memory-tools-route-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const makeRoutedTools = (sessions: Record<string, string>) => {
    for (const account of Object.values(sessions)) {
      mkdirSync(join(dir, account, '.eterna'), { recursive: true })
    }
    const base = createMemory({ workspaceDir: join(dir, 'NOTES'), dbPath: join(dir, 'global.db'), now: () => T0 })
    const accounts = new Map<string, Memory>()
    const resolver: MemorySessionResolver = {
      forSession(sessionId: string | undefined): Memory | undefined {
        const account = sessionId === undefined ? undefined : sessions[sessionId]
        if (account === undefined) return undefined
        let m = accounts.get(account)
        if (m === undefined) {
          m = createMemory({ workspaceDir: join(dir, account, 'NOTES'), dbPath: join(dir, account, '.eterna', 'memory.sqlite3'), now: () => T0 })
          accounts.set(account, m)
        }
        return m
      },
    }
    const tools = defineMemoryTools(base, undefined, undefined, undefined, resolver)
    const execOf = (sessionId: string | undefined): ToolRunContext =>
      ({ name: 'memory_write', callId: 'c1', signal: new AbortController().signal, agent: sessionId === undefined ? undefined : { session: { id: sessionId } } }) as unknown as ToolRunContext
    const tool = (name: string): ToolDefinition => {
      const found = tools.find(d => d.name === name)
      if (found === undefined) throw new Error(`工具不存在:${name}`)
      return found
    }
    return { tool, execOf, base }
  }

  it('双会话写同名键 → 各落各账号库,互不可见;检索按会话隔离', async () => {
    const { tool, execOf } = makeRoutedTools({ 'sess-alice': 'alice', 'sess-bob': 'bob' })
    const write = tool('memory_write')
    await write?.execute({ subject: 'user', key: 'shared-key', content: 'Alice 的记忆内容', kind: 'semantic', explicit: true }, execOf('sess-alice'))
    await write?.execute({ subject: 'user', key: 'shared-key', content: 'Bob 的记忆内容', kind: 'semantic', explicit: true }, execOf('sess-bob'))
    const search = tool('memory_search')
    const aliceView = await search?.execute({ query: '记忆内容', scope: 'user' }, execOf('sess-alice'))
    const bobView = await search?.execute({ query: '记忆内容', scope: 'user' }, execOf('sess-bob'))
    expect(JSON.stringify(aliceView)).toContain('Alice')
    expect(JSON.stringify(aliceView)).not.toContain('Bob 的')
    expect(JSON.stringify(bobView)).toContain('Bob')
    expect(JSON.stringify(bobView)).not.toContain('Alice 的记忆')
  })

  it('会话不可解析 → fail-closed:写被拒(blocked=account),读返回未命中,绝不落 base', async () => {
    const { tool, execOf, base } = makeRoutedTools({ 'sess-alice': 'alice' })
    const write = tool('memory_write')
    const denied = await write.execute({ subject: 'user', key: 'ghost', content: '匿名内容', kind: 'semantic' }, execOf(undefined))
    expect(denied).toMatchObject({ ok: false, blocked: 'account' })
    const read = tool('memory_read')
    const view = await read.execute({ subject: 'user', key: 'ghost' }, execOf(undefined))
    expect(view).toMatchObject({ ok: true, found: false })
    // base(全局库)零写入:count=0
    expect(base.entities.count()).toBe(0)
  })

  it('resolver 缺席 → 单库形态(base 照旧,行为不变)', async () => {
    const base = createMemory({ workspaceDir: join(dir, 'NOTES'), dbPath: join(dir, 'global.db'), now: () => T0 })
    const tools = defineMemoryTools(base)
    const write = tools.find(d => d.name === 'memory_write')
    await write?.execute({ subject: 'user', key: 'k1', content: '落 base', kind: 'semantic' }, { name: 't', signal: new AbortController().signal } as unknown as ToolRunContext)
    expect(base.entities.count()).toBe(1)
  })

  it('四工具名单不变(路由不改变工具面)', () => {
    const base = createMemory({ workspaceDir: join(dir, 'NOTES'), dbPath: join(dir, 'g.db'), now: () => T0 })
    const tools = defineMemoryTools(base, undefined, undefined, undefined, { forSession: () => createDeniedMemory() })
    expect(tools.map(d => d.name)).toEqual([...MEMORY_TOOL_NAMES])
  })
})
