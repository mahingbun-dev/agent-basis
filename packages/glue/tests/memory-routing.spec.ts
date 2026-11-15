/**
 * 多租户分库路由集成测(23 号 M-T1,glue 挂载面):伪 access store
 * (eternaAccessStore:sessionOwner/getUserById)+ routing per-account——
 * 两个会话(agent session id 不同)各经 memory_write 写同名键,断言:
 * 1. 各落各账号库(workspaces/<账号>/.eterna/memory.sqlite3 物理分文件);
 * 2. 全局库零写入(fail-closed 不退回);
 * 3. 无法归属会话 → blocked:'account';
 * 4. 账号路由面('eterna-memory-accounts')在provide 且 principal 账号可取。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineMemoryPlugin } from '../src/plugins/memory-plugin.ts'
import { makePluginHarness } from './memory-plugin-harness.ts'



describe('memory 插件多租户路由(config.routing per-account)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-glue-memory-routing-'))
  })
  afterEach(async () => {
    await rmSync(dir, { recursive: true, force: true })
  })

  /** 伪 access store:两个账号映射(目录由测试预建——登录开通的产物)。 */
  function seedAccess(harness: ReturnType<typeof makePluginHarness>): void {
    for (const account of ['alice', 'bob']) mkdirSync(join(dir, 'workspaces', account, '.eterna'), { recursive: true })
    harness.fake.provide('eternaAccessStore', {
      sessionOwner: (sessionId: string): number | undefined => ({ 'sess-alice': 1, 'sess-bob': 2 })[sessionId],
      getUserById: (id: number): { account: string } | undefined => ({ 1: { account: 'alice' }, 2: { account: 'bob' } })[id],
    })
  }

  function applyPlugin(harness: ReturnType<typeof makePluginHarness>): () => void {
    const plugin = defineMemoryPlugin({
      notesDir: join(dir, 'NOTES'),
      dbPath: join(dir, 'global.sqlite3'),
      consolidation: { enabled: false },
      routing: { mode: 'per-account', tenantRoot: join(dir, 'workspaces') },
    })
    return plugin.apply(harness.fake as unknown as Context)
  }

  function writeTool(harness: ReturnType<typeof makePluginHarness>): ToolDefinition {
    const definition = harness.toolDefs.get('memory_write') as ToolDefinition | undefined
    if (definition === undefined) throw new Error('memory_write 未注册')
    return definition
  }

  function searchTool(harness: ReturnType<typeof makePluginHarness>): ToolDefinition {
    const definition = harness.toolDefs.get('memory_search') as ToolDefinition | undefined
    if (definition === undefined) throw new Error('memory_search 未注册')
    return definition
  }

  function execOf(sessionId: string | undefined): ToolRunContext {
    return {
      name: 'memory_write',
      callId: 'call-routing',
      signal: new AbortController().signal,
      ...(sessionId !== undefined && { agent: { session: { id: sessionId } } }),
    } as unknown as ToolRunContext
  }

  function rowCount(dbFile: string): number {
    if (!existsSync(dbFile)) return -1
    const db = new DatabaseSync(dbFile, { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM memory_entity').get() as { c: number }
      return row.c
    } finally {
      db.close()
    }
  }

  it('双账号写同名键:各落各账号库;全局库零写入;跨账号检索互不可见', async () => {
    const harness = makePluginHarness()
    seedAccess(harness)
    const dispose = applyPlugin(harness)
    try {
      const write = writeTool(harness)
      await write.execute(
        { subject: 'user', key: 'shared-key', content: 'Alice 的私有偏好', kind: 'semantic', explicit: true },
        execOf('sess-alice'),
      )
      await write.execute(
        { subject: 'user', key: 'shared-key', content: 'Bob 的私有偏好', kind: 'semantic', explicit: true },
        execOf('sess-bob'),
      )
      // 物理分库:每账号库恰 1 行(自己的),全局库不存在(fail-closed 不落)
      expect(rowCount(join(dir, 'workspaces', 'alice', '.eterna', 'memory.sqlite3'))).toBe(1)
      expect(rowCount(join(dir, 'workspaces', 'bob', '.eterna', 'memory.sqlite3'))).toBe(1)
      expect(rowCount(join(dir, 'global.sqlite3'))).toBeLessThanOrEqual(0)
      // 跨账号检索互不可见
      const search = searchTool(harness)
      const aliceView = await search.execute({ query: '私有偏好', scope: 'user' }, execOf('sess-alice'))
      expect(JSON.stringify(aliceView)).toContain('Alice')
      expect(JSON.stringify(aliceView)).not.toContain('Bob')
    } finally {
      dispose()
    }
  })

  it('无法归属会话:写被拒(blocked=account),不落任何库', async () => {
    const harness = makePluginHarness()
    seedAccess(harness)
    const dispose = applyPlugin(harness)
    try {
      const write = writeTool(harness)
      const outcome = await write.execute(
        { subject: 'user', key: 'ghost-key', content: '匿名内容', kind: 'semantic' },
        execOf('sess-unknown'),
      )
      expect(outcome).toMatchObject({ ok: false, blocked: 'account' })
      expect(rowCount(join(dir, 'global.sqlite3'))).toBeLessThanOrEqual(0)
      expect(existsSync(join(dir, 'workspaces', 'alice', '.eterna', 'memory.sqlite3'))).toBe(false)
    } finally {
      dispose()
    }
  })

  it('账号路由面在provide:principal 账号可取、库路径与 memory 面可用', () => {
    const harness = makePluginHarness()
    seedAccess(harness)
    const dispose = applyPlugin(harness)
    try {
      const face = harness.service('eterna-memory-accounts') as
        | { accountOfUser(id: number): string | undefined; memoryForAccount(account: string): unknown; dbPathForAccount(account: string): string | undefined }
        | undefined
      expect(face).toBeDefined()
      expect(face?.accountOfUser(1)).toBe('alice')
      expect(face?.dbPathForAccount('alice')).toBe(join(dir, 'workspaces', 'alice', '.eterna', 'memory.sqlite3'))
      expect(face?.memoryForAccount('alice')).not.toBeNull()
    } finally {
      dispose()
    }
  })
})
