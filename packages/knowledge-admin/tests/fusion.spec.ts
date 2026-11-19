/**
 * 融合后的核心不变量(知识底座 = 知识库管理面单一宿主):
 * 1. human 门禁:Agent/网关通道写入一律 pending、审批 forbidden;真人面板可直接发布;
 * 2. 管理员缺省目标 = 全局库 `*`(不再是"本人账号");
 * 3. 会话路由:auto/per-account/global 三模式与 glue 时代逐条对齐,fail-closed 不回退全局;
 * 4. 账号只读面(panel 契约)沿用,数据源自同一路径解析;
 * 5. 库层四工具经薄门面复用同一 service/pool —— `dispose()` 不得关共享池。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { KnowledgeAdminService } from '../src/service.ts'
import { buildAdminKnowledgeTools, createAdminKnowledgeFacade } from '../src/tools-base.ts'
import { createAccessDirectory, resolveAccessDbPath } from '../src/access-db.ts'
import { createKnowledgeCallerRouter } from '../src/routing.ts'
import { agentCaller, createRig, fixedClock, userCaller } from './rig.ts'

/** 建最小 users.db(sessions/users 两表;access 插件的落盘形态)。 */
function seedAccessDb(
  path: string,
  users: readonly { id: number; account: string; role: string }[],
  sessions: readonly { id: string; owner: number }[],
): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, account TEXT NOT NULL, role TEXT NOT NULL)')
    db.exec('CREATE TABLE sessions (session_id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL)')
    const insertUser = db.prepare('INSERT INTO users (id, account, role) VALUES (?, ?, ?)')
    for (const user of users) insertUser.run(user.id, user.account, user.role)
    const insertSession = db.prepare('INSERT INTO sessions (session_id, owner_id) VALUES (?, ?)')
    for (const session of sessions) insertSession.run(session.id, session.owner)
  } finally {
    db.close()
  }
}

describe('human 写入门禁', () => {
  it('Agent 通道 saveDoc(publish:true) 仍落 pending;reviewProposal forbidden', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const saved = await service.saveDoc(agentCaller('alice'), {
        title: 'Agent 提案', body: 'Agent 正文', path: 'agent/p.md', publish: true,
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.state).toBe('pending')
      expect(saved.value.note).toContain('非人工通道不直接发布')

      const reviewed = await service.reviewProposal(agentCaller('alice'), {
        proposal_id: saved.value.proposal_id, decision: 'approve',
      })
      expect(reviewed.ok).toBe(false)
      if (!reviewed.ok) expect(reviewed.code).toBe('forbidden')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('真人面板 saveDoc 直接发布;审批也只认 human:true', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const saved = await service.saveDoc(userCaller('alice'), { title: '人写页', body: '人写正文', path: 'kb/h.md' })
      expect(saved.ok).toBe(true)
      if (saved.ok) expect(saved.value.state).toBe('approved')

      const pending = await service.saveDoc(userCaller('alice'), { title: '待审', body: '待审正文', publish: false })
      expect(pending.ok).toBe(true)
      if (!pending.ok) return
      // 管理员真人也必须 human:true 才能审批(网关/Agent 的 admin 不足以代签)
      const approved = await service.reviewProposal(userCaller('alice'), { proposal_id: pending.value.proposal_id, decision: 'approve' })
      expect(approved.ok).toBe(true)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('管理员缺省目标 = 全局库 *', () => {
  it('overview/listDocs 缺省落在全局库;显式账号才进分库', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const globalSaved = await service.saveDoc(
        { account: 'root', admin: true, userId: 1, human: true },
        { title: '全局页', body: '全局正文', path: 'global.md' },
      )
      expect(globalSaved.ok).toBe(true)

      const overview = await service.overview({ account: 'root', admin: true, userId: 1 }, {})
      expect(overview.ok).toBe(true)
      if (overview.ok) {
        expect(overview.value.account.account).toBe('*')
        expect(overview.value.account.global).toBe(true)
        expect(overview.value.doc_count).toBeGreaterThanOrEqual(1)
      }

      const docs = await service.listDocs({ account: 'root', admin: true, userId: 1 }, {})
      if (docs.ok) expect(docs.value.items.map(item => item.doc_id)).toContain('global')

      const accountDocs = await service.listDocs({ account: 'root', admin: true, userId: 1 }, { account: 'alice' })
      if (accountDocs.ok) expect(accountDocs.value.items).toEqual([])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('普通账号缺省仍只看本人(越权面不变)', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const forbidden = await service.listDocs(userCaller('alice'), { account: 'bob' })
      expect(forbidden.ok).toBe(false)
      if (!forbidden.ok) expect(forbidden.code).toBe('forbidden')

      const self = await service.listDocs(userCaller('alice'), {})
      expect(self.ok).toBe(true)
      if (self.ok) expect(self.value.items).toEqual([])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('会话路由(glue 口径迁入)', () => {
  it('auto:users.db 缺席 → 全局;在场按会话解析(admin→固定账号 admin:true)', () => {
    const rig = createRig()
    try {
      const absent = createKnowledgeCallerRouter({ access: createAccessDirectory(join(rig.root, 'no.db')) })
      const global = absent.resolveSession('s1')
      expect(global).toMatchObject({ account: '*', admin: true, human: false })

      const accessPath = join(rig.root, 'access', 'users.db')
      seedAccessDb(accessPath, [
        { id: 1, account: 'root', role: 'admin' },
        { id: 2, account: 'alice', role: 'user' },
      ], [
        { id: 's-admin', owner: 1 },
        { id: 's-alice', owner: 2 },
      ])
      const router = createKnowledgeCallerRouter({ access: createAccessDirectory(accessPath) })
      expect(router.resolveSession('s-admin')).toMatchObject({ account: 'root', admin: true, human: false })
      expect(router.resolveSession('s-alice')).toMatchObject({ account: 'alice', admin: false, human: false })
      expect(router.resolveSession('unknown')).toBeUndefined()
      expect(router.accountOfUser(2)).toBe('alice')
    } finally {
      rig.cleanup()
    }
  })

  it('per-account:无会话/未知会话 fail-closed(绝不退回全局);global:恒全局', () => {
    const rig = createRig()
    try {
      const accessPath = join(rig.root, 'access', 'users.db')
      seedAccessDb(accessPath, [{ id: 2, account: 'alice', role: 'user' }], [{ id: 's-alice', owner: 2 }])
      const perAccount = createKnowledgeCallerRouter({ mode: 'per-account', access: createAccessDirectory(accessPath) })
      expect(perAccount.resolveSession(undefined)).toBeUndefined()
      expect(perAccount.resolveSession('unknown')).toBeUndefined()
      expect(perAccount.resolveSession('s-alice')).toMatchObject({ account: 'alice' })

      const global = createKnowledgeCallerRouter({ mode: 'global', access: createAccessDirectory(accessPath) })
      expect(global.resolveSession('s-alice')).toMatchObject({ account: '*', admin: true })
    } finally {
      rig.cleanup()
    }
  })

  it('resolveAccessDbPath 与 access 落盘位置同源', () => {
    expect(resolveAccessDbPath({ DSH_HOME: '/data/dsh' }, '/cwd')).toBe('/data/dsh/access/users.db')
    expect(resolveAccessDbPath({}, '/cwd')).toBe('/cwd/access/users.db')
  })
})

describe('账号只读面(panel 契约)', () => {
  it('账号目录缺席 → undefined;发布后可读计数;全局 * 恒可用', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      expect(service.accounts.statusForAccount('alice')).toBeUndefined()
      expect(service.accounts.statusForAccount('*')).toBeDefined()

      await service.saveDoc(userCaller('alice'), { title: '计数页', body: '计数正文', path: 'kb/c.md' })
      const status = service.accounts.statusForAccount('alice')
      expect(status).toBeDefined()
      expect(status?.available).toBe(true)
      expect(status?.wikiDocCount).toBeGreaterThanOrEqual(1)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('四工具门面复用同一 service', () => {
  it('工具集 = knowledge_search/read/status/propose;propose 落 pending,审批后才可见', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const tools = buildAdminKnowledgeTools(service, service.router)
      expect(tools.map(tool => tool.name)).toEqual(['knowledge_search', 'knowledge_read', 'knowledge_status', 'knowledge_propose'])
      const exec = {
        agent: { session: { id: 's-alice' } },
        signal: new AbortController().signal,
      } as never
      const propose = tools.find(tool => tool.name === 'knowledge_propose')
      const search = tools.find(tool => tool.name === 'knowledge_search')
      const status = tools.find(tool => tool.name === 'knowledge_status')
      if (propose === undefined || search === undefined || status === undefined) throw new Error('工具缺失')

      // auto + 无 users.db → 全局身份,提案进全局库 pending
      const proposed = await propose.execute({ title: '提案页', body: '提案正文' }, exec)
      expect((proposed as { ok: boolean }).ok).toBe(true)
      const hidden = await search.execute({ query: '提案正文' }, exec) as { hits: readonly unknown[] }
      expect(hidden.hits).toHaveLength(0)

      const statusValue = await status.execute({}, exec) as { backends: readonly { id: string }[] }
      expect(statusValue.backends.map(item => item.id)).toContain('wiki-local')

      // 门面 dispose 是 no-op:共享池仍可用
      createAdminKnowledgeFacade(service, agentCaller('alice')).dispose()
      const after = await service.listDocs(userCaller('alice'), {})
      expect(after.ok).toBe(true)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})
