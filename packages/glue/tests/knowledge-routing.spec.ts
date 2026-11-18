/**
 * knowledge 插件多租户分库路由集成测(2026-11-17,memory-routing.spec 同构):
 * 真实 access 库(users/sessions 表与生产同构)+ routing per-account + accessDbPath
 * 注入(身份解析读文件证据,S-6/S-7 先例)——
 * 1. 普通账号提案各落各账号分库(workspaces/<账号>/.eterna/knowledge.sqlite3),
 *    全局库零写入;
 * 2. admin 角色路由全局库(与面板 admin 看全局一致);
 * 3. 无法归属会话/账号目录缺席 → fail-closed(提案抛错,不隐式建目录);
 * 4. auto 模式 + access 库缺席(本地 TUI)→ 全局单库,行为不变;
 * 5. 账号状态面('eterna-knowledge-accounts')只读计数与账号解析可用。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { KnowledgeAccountDeniedError } from '@eterna/knowledge'
import {
  ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID, defineKnowledgePlugin,
} from '../src/plugins/knowledge-plugin.ts'
import { makeFakeContext } from './fake-context.ts'

interface Harness {
  readonly fake: ReturnType<typeof makeFakeContext>['fake'] & Record<string, unknown>
  readonly toolDefs: Map<string, ToolDefinition>
  readonly dispose: () => void
}

describe('knowledge 插件多租户路由(config.routing)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-glue-knowledge-routing-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** 伪 access 库(users[id,account,role] + sessions[session_id,owner_id],与生产同构)。 */
  function seedAccess(): void {
    mkdirSync(join(dir, 'access'), { recursive: true })
    for (const account of ['alice', 'bob']) mkdirSync(join(dir, 'workspaces', account), { recursive: true })
    const access = new DatabaseSync(join(dir, 'access', 'users.db'))
    access.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, account TEXT, role TEXT); CREATE TABLE sessions (session_id TEXT, owner_id INTEGER)')
    access.prepare('INSERT INTO users VALUES (1, ?, ?)').run('alice', 'user')
    access.prepare('INSERT INTO users VALUES (2, ?, ?)').run('bob', 'user')
    access.prepare('INSERT INTO users VALUES (3, ?, ?)').run('root', 'admin')
    access.prepare('INSERT INTO users VALUES (4, ?, ?)').run('carol', 'user') // 无 workspace 目录(未开通)
    access.prepare('INSERT INTO sessions VALUES (?, 1)').run('sess-alice')
    access.prepare('INSERT INTO sessions VALUES (?, 2)').run('sess-bob')
    access.prepare('INSERT INTO sessions VALUES (?, 3)').run('sess-root')
    access.prepare('INSERT INTO sessions VALUES (?, 4)').run('sess-carol')
    access.close()
  }

  function applyPlugin(mode: 'auto' | 'per-account' = 'per-account', accessDbPath?: string): Harness {
    mkdirSync(join(dir, 'global', '.eterna'), { recursive: true })
    const harness = makeFakeContext()
    const toolDefs = new Map<string, ToolDefinition>()
    const fake = harness.fake as unknown as Record<string, unknown>
    fake.tools = {
      register: (definition: ToolDefinition): (() => void) => {
        toolDefs.set(definition.name, definition)
        return () => { toolDefs.delete(definition.name) }
      },
    }
    const dispose = defineKnowledgePlugin({
      wikiDir: join(dir, 'global', 'knowledge.wiki'),
      dbPath: join(dir, 'global', '.eterna', 'knowledge.sqlite3'),
      routing: {
        mode,
        tenantRoot: join(dir, 'workspaces'),
        accessDbPath: accessDbPath ?? join(dir, 'access', 'users.db'),
      },
    }).apply(harness.fake as unknown as Context)
    return { fake: harness.fake as Harness['fake'], toolDefs, dispose }
  }

  function execOf(sessionId: string | undefined): ToolRunContext {
    return {
      name: 'knowledge_propose',
      callId: 'call-routing',
      signal: new AbortController().signal,
      ...(sessionId !== undefined && { agent: { session: { id: sessionId } } }),
    } as unknown as ToolRunContext
  }

  function proposalCount(dbFile: string): number {
    if (!existsSync(dbFile)) return -1
    const db = new DatabaseSync(dbFile, { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM proposals').get() as { c: number }
      return row.c
    } finally {
      db.close()
    }
  }

  async function propose(harness: Harness, sessionId: string | undefined, title: string): Promise<unknown> {
    const definition = harness.toolDefs.get('knowledge_propose')
    if (definition === undefined) throw new Error('knowledge_propose 未注册')
    return await definition.execute({ title, body: `正文-${title}` }, execOf(sessionId))
  }

  it('普通账号提案各落各账号分库;全局库零写入;跨账号互不可见', async () => {
    seedAccess()
    const harness = applyPlugin()
    try {
      await propose(harness, 'sess-alice', 'Alice 知识一')
      await propose(harness, 'sess-alice', 'Alice 知识二')
      await propose(harness, 'sess-bob', 'Bob 知识一')
      expect(proposalCount(join(dir, 'workspaces', 'alice', '.eterna', 'knowledge.sqlite3'))).toBe(2)
      expect(proposalCount(join(dir, 'workspaces', 'bob', '.eterna', 'knowledge.sqlite3'))).toBe(1)
      expect(proposalCount(join(dir, 'global', '.eterna', 'knowledge.sqlite3'))).toBeLessThanOrEqual(0)
      // 账号状态面(panel 非 admin 视图):只读计数按账号,不串库
      const face = harness.fake[ETERNA_KNOWLEDGE_ACCOUNTS_SERVICE_ID] as {
        accountOfUser(id: number): string | undefined
        statusForAccount(account: string): { available: boolean; proposalCount: number } | undefined
      }
      expect(face.accountOfUser(1)).toBe('alice')
      expect(face.statusForAccount('alice')).toMatchObject({ available: true, proposalCount: 2 })
      expect(face.statusForAccount('bob')).toMatchObject({ available: true, proposalCount: 1 })
      expect(face.statusForAccount('ghost')).toBeUndefined()
    } finally {
      harness.dispose()
    }
  })

  it('admin 角色(会话归属 root)→ 全局库;普通账号分库不受影响', async () => {
    seedAccess()
    const harness = applyPlugin()
    try {
      await propose(harness, 'sess-root', 'Admin 全局知识')
      await propose(harness, 'sess-alice', 'Alice 知识一')
      expect(proposalCount(join(dir, 'global', '.eterna', 'knowledge.sqlite3'))).toBe(1)
      expect(proposalCount(join(dir, 'workspaces', 'alice', '.eterna', 'knowledge.sqlite3'))).toBe(1)
      expect(proposalCount(join(dir, 'workspaces', 'root', '.eterna', 'knowledge.sqlite3'))).toBe(-1)
    } finally {
      harness.dispose()
    }
  })

  it('无法归属会话 / 账号目录缺席(未开通)→ fail-closed:提案被拒,不落任何库、不建目录', async () => {
    seedAccess()
    const harness = applyPlugin()
    try {
      await expect(propose(harness, 'sess-unknown', 't')).rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
      await expect(propose(harness, undefined, 't')).rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
      await expect(propose(harness, 'sess-carol', 't')).rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
      expect(existsSync(join(dir, 'workspaces', 'carol', '.eterna'))).toBe(false)
      expect(proposalCount(join(dir, 'global', '.eterna', 'knowledge.sqlite3'))).toBeLessThanOrEqual(0)
      // 检索侧同门:空结果 + degraded 原因(模型可见为何没有结果)
      const search = harness.toolDefs.get('knowledge_search')
      const outcome = await search?.execute({ query: 't' }, execOf('sess-unknown')) as { hits: unknown[]; degraded: unknown[] }
      expect(outcome.hits).toHaveLength(0)
      expect(outcome.degraded).toHaveLength(1)
    } finally {
      harness.dispose()
    }
  })

  it('auto 模式 + access 库缺席(本地 TUI)→ 全局单库,行为不变', async () => {
    const harness = applyPlugin('auto', join(dir, 'access', 'missing.db'))
    try {
      await propose(harness, 'sess-alice', '本地知识')
      expect(proposalCount(join(dir, 'global', '.eterna', 'knowledge.sqlite3'))).toBe(1)
    } finally {
      harness.dispose()
    }
  })
})

describe('knowledge 插件全新卷目录自建(装载告警回归,eterna-tp-t6 2026-11-18)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-glue-knowledge-fresh-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // 复现 t6 全新卷形态:库里父目录缺席(cwd/.eterna 未建)→ node:sqlite 开库即炸
  // (「2 entries did not activate」)。修复口径:createService 开库前自建父目录,
  // 装载零告警——本用例不预建任何目录,apply 即视为装载成功。
  it('库父目录缺席:apply 即自建目录并装载四工具', () => {
    const harness = makeFakeContext()
    const toolDefs = new Map<string, ToolDefinition>()
    const fake = harness.fake as unknown as Record<string, unknown>
    fake.tools = {
      register: (definition: ToolDefinition): (() => void) => {
        toolDefs.set(definition.name, definition)
        return () => { toolDefs.delete(definition.name) }
      },
    }
    const dbPath = join(dir, 'fresh', '.eterna', 'knowledge.sqlite3')
    const dispose = defineKnowledgePlugin({
      wikiDir: join(dir, 'fresh', 'knowledge.wiki'),
      dbPath,
    }).apply(harness.fake as unknown as Context)
    try {
      // 开库成功即落 SCHEMA(库文件在场 = 父目录自建 + DatabaseSync 构造通过)
      expect(existsSync(dbPath)).toBe(true)
      for (const name of ['knowledge_search', 'knowledge_read', 'knowledge_status', 'knowledge_propose']) {
        expect(toolDefs.has(name)).toBe(true)
      }
    } finally {
      dispose()
    }
  })
})
