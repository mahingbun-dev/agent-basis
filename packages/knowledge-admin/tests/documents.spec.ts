/**
 * 文档 CRUD 往返 / propose→review→deprecate / 分页 / 审计 / 成员(验收第 2-5 项)。
 *
 * 关键事实钉住:
 * - `saveDoc` 缺省发布 → 文件**真的**落盘且**立刻**可检索(过审 = review='reviewed'/trust='verified');
 * - `saveDoc(publish=false)` → 只落 pending 提案,**磁盘上没有任何文件**、检索查不到;
 * - `reviewProposal(approve)` 才让 pending 变可见;`discardProposal` 让 pending 消失;
 * - `deprecateDoc` → frontmatter 归档 + 检索逻辑不可见,但 `readDoc` 仍可读(带警示),并返回 undo_token;
 * - 分页 `total`/`has_more`/越界截断口径一致。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { KnowledgeAdminService } from '../src/service.ts'
import { createRig, fixedClock, userCaller } from './rig.ts'

describe('文档 CRUD 往返', () => {
  it('saveDoc → 落盘 + 可检索 + readDoc 回读一致', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const saved = await service.saveDoc(userCaller('alice'), {
        title: '部署前置检查',
        body: '# 部署前置检查\n\n先跑 `pnpm verify`,再评估预算是否超阈值 5%。',
        tags: ['部署', '流程'],
        origin: 'ops/playbook.md',
        path: 'ops/preflight.md',
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.state).toBe('approved')
      expect(saved.value.published?.doc_id).toBe('ops/preflight')

      const abs = join(rig.tenantRoot, 'alice', 'knowledge.wiki', 'ops', 'preflight.md')
      expect(existsSync(abs)).toBe(true)
      const raw = readFileSync(abs, 'utf8')
      expect(raw).toContain('title: 部署前置检查')
      expect(raw).toContain('status: active')
      expect(raw).toContain('## Changelog')

      const read = await service.readDoc(userCaller('alice'), { doc_id: 'ops/preflight' })
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.value.title).toBe('部署前置检查')
      expect(read.value.tags).toEqual(['部署', '流程'])
      expect(read.value.provenance.status).toBe('active')
      expect(read.value.provenance.trust).toBe('verified')
      expect(read.value.provenance.review).toBe('reviewed')
      expect(read.value.provenance.origin).toBe('ops/playbook.md')
      expect(read.value.body).toContain('pnpm verify')
      expect(read.value.citation.length).toBeGreaterThan(0)

      // 注意:@eterna/knowledge 的 FTS5 是 trigram 分词,超长中文串整串当 token 匹配不到;
      // 检索面口径以既有 print("预算")/短词 LIKE 回退为准(此处按后端真实行为断言,不粉饰)。
      const search = await service.search(userCaller('alice'), { query: '预算', include_sources: false })
      expect(search.ok).toBe(true)
      if (search.ok) {
        expect(search.value.hits.map(hit => hit.ref.doc_id)).toContain('ops/preflight')
        expect(search.value.contributed).toContain('wiki-local')
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('saveDoc(publish=false) 只落 pending:磁盘无文件、检索查不到', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const saved = await service.saveDoc(userCaller('alice'), {
        title: '待审草稿',
        body: '这是一段尚未评审的草稿,不应出现在检索结果里。',
        path: 'drafts/pending.md',
        publish: false,
      })
      expect(saved.ok).toBe(true)
      if (!saved.ok) return
      expect(saved.value.state).toBe('pending')
      expect(saved.value.proposal_id.length).toBeGreaterThan(0)

      const wikiDir = join(rig.tenantRoot, 'alice', 'knowledge.wiki')
      const files = existsSync(wikiDir)
        ? readdirSync(wikiDir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        : []
      expect(files).toEqual([])

      const search = await service.search(userCaller('alice'), { query: '尚未评审的草稿', include_sources: false })
      expect(search.ok).toBe(true)
      if (search.ok) expect(search.value.hits).toEqual([])

      const listed = await service.listProposals(userCaller('alice'), { state: ['pending'] })
      expect(listed.ok).toBe(true)
      if (listed.ok) {
        expect(listed.value.items).toHaveLength(1)
        expect(listed.value.items[0]?.title).toBe('待审草稿')
        expect(listed.value.items[0]?.state).toBe('pending')
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('编辑已有文档(同 doc_id)走 propose→review,changelog 追加且保留原路径', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '基线页', body: '第一版正文', path: 'kb/base.md' })
      const edited = await service.saveDoc(userCaller('alice'), {
        doc_id: 'kb/base', title: '基线页', body: '第二版正文', changelog_note: '补充预算口径',
      })
      expect(edited.ok).toBe(true)
      if (!edited.ok) return
      expect(edited.value.state).toBe('approved')
      expect(edited.value.published?.doc_id).toBe('kb/base')

      const read = await service.readDoc(userCaller('alice'), { doc_id: 'kb/base' })
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.value.body).toContain('第二版正文')
      expect(read.value.changelog.length).toBeGreaterThan(0)
      expect(read.value.changelog.map(entry => entry.note).join('|')).toContain('补充预算口径')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('propose → review → deprecate', () => {
  it('pending → approve 变可见;reject 留 note 且不可见', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const a = await service.saveDoc(userCaller('alice'), { title: '甲页', body: '甲页正文 APPROVED', publish: false })
      const b = await service.saveDoc(userCaller('alice'), { title: '乙页', body: '乙页正文 REJECTED', publish: false })
      expect(a.ok && b.ok).toBe(true)
      if (!a.ok || !b.ok) return

      const approved = await service.reviewProposal(userCaller('alice'), { proposal_id: a.value.proposal_id, decision: 'approve' })
      expect(approved.ok).toBe(true)
      if (approved.ok) {
        expect(approved.value.state).toBe('approved')
        expect(approved.value.published?.doc_id).toBeDefined()
      }
      const rejected = await service.reviewProposal(userCaller('alice'), {
        proposal_id: b.value.proposal_id, decision: 'reject', reason: '口径与预算红线不符',
      })
      expect(rejected.ok).toBe(true)
      if (rejected.ok) {
        expect(rejected.value.state).toBe('rejected')
        expect(rejected.value.note).toContain('预算红线')
      }

      const search = await service.search(userCaller('alice'), { query: '甲页', include_sources: false })
      if (search.ok) expect(search.value.hits.some(hit => hit.title === '甲页')).toBe(true)
      const listed = await service.listProposals(userCaller('alice'), { state: ['rejected'] })
      if (listed.ok) expect(listed.value.items.map(item => item.title)).toEqual(['乙页'])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('discardProposal 撤销 pending;重复撤销与评审不存在的提案 → not_found/state', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const created = await service.saveDoc(userCaller('alice'), { title: '将被撤销', body: '正文', publish: false })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      const discarded = await service.discardProposal(userCaller('alice'), { proposal_id: created.value.proposal_id })
      expect(discarded.ok).toBe(true)

      const again = await service.discardProposal(userCaller('alice'), { proposal_id: created.value.proposal_id })
      expect(again.ok).toBe(false)
      if (!again.ok) expect(['not_found', 'state']).toContain(again.code)

      const missing = await service.reviewProposal(userCaller('alice'), {
        proposal_id: created.value.proposal_id, decision: 'approve',
      })
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.code).toBe('not_found')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('deprecateDoc:归档后检索不可见,readDoc 仍可读,undo_token 可撤销', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '旧流程', body: '旧流程正文 OBSOLETE', path: 'kb/old.md' })
      await service.saveDoc(userCaller('alice'), { title: '新流程', body: '新流程正文 CURRENT', path: 'kb/new.md' })

      const deprecated = await service.deprecateDoc(userCaller('alice'), {
        doc_id: 'kb/old', reason: '被新流程取代', superseded_by: 'kb/new',
      })
      expect(deprecated.ok).toBe(true)
      if (!deprecated.ok) return
      expect(deprecated.value.deprecated).toBe(true)
      expect(deprecated.value.undo_available).toBe(true)
      expect(deprecated.value.undo_hint).toContain('30 分钟')

      const search = await service.search(userCaller('alice'), { query: '旧流程 OBSOLETE', include_sources: false })
      if (search.ok) expect(search.value.hits.map(hit => hit.ref.doc_id)).not.toContain('kb/old')

      const read = await service.readDoc(userCaller('alice'), { doc_id: 'kb/old' })
      expect(read.ok).toBe(true)
      if (read.ok) {
        expect(read.value.provenance.status).toBe('deprecated')
        expect(read.value.provenance.superseded_by).toBe('kb/new')
        expect(read.value.citation).toContain('废弃')
      }

      const undone = await service.undoDeprecate(userCaller('alice'), { undo_token: deprecated.value.undo_token })
      expect(undone.ok).toBe(true)
      const restored = await service.readDoc(userCaller('alice'), { doc_id: 'kb/old' })
      if (restored.ok) expect(restored.value.provenance.status).toBe('active')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('deprecate 缺 superseded_by 且原页无值 → 后端拒绝并如实回传(invalid)', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '孤页', body: '孤页正文', path: 'kb/lonely.md' })
      const result = await service.deprecateDoc(userCaller('alice'), { doc_id: 'kb/lonely', reason: '无替代' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('invalid')
        expect(result.message).toContain('superseded_by')
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('分页', () => {
  it('listDocs total/has_more/越界截断一致;limit 上限 200', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      for (let index = 0; index < 7; index += 1) {
        await service.saveDoc(userCaller('alice'), { title: `页 ${index}`, body: `正文 ${index}`, path: `kb/p-${index}.md` })
      }
      const first = await service.listDocs(userCaller('alice'), { limit: 3, offset: 0 })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.value.items).toHaveLength(3)
      expect(first.value.total).toBe(7)
      expect(first.value.has_more).toBe(true)
      expect(first.value.limit).toBe(3)

      const last = await service.listDocs(userCaller('alice'), { limit: 3, offset: 6 })
      expect(last.ok).toBe(true)
      if (!last.ok) return
      expect(last.value.items).toHaveLength(1)
      expect(last.value.has_more).toBe(false)

      const beyond = await service.listDocs(userCaller('alice'), { limit: 3, offset: 99 })
      if (beyond.ok) {
        expect(beyond.value.items).toEqual([])
        expect(beyond.value.total).toBe(7)
        expect(beyond.value.has_more).toBe(false)
      }

      const capped = await service.listDocs(userCaller('alice'), { limit: 1000 })
      if (capped.ok) expect(capped.value.limit).toBe(200)

      const filtered = await service.listDocs(userCaller('alice'), { query: 'p-3' })
      if (filtered.ok) expect(filtered.value.items.map(item => item.doc_id)).toEqual(['kb/p-3'])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('审计 & 成员', () => {
  it('写操作写本地 jsonl;listAudit 按 action/since/limit 过滤', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '审计页', body: '正文', path: 'kb/audit.md' })
      const created = await service.saveDoc(userCaller('alice'), { title: '审计页2', body: '正文2', publish: false })
      if (created.ok) await service.discardProposal(userCaller('alice'), { proposal_id: created.value.proposal_id })
      clock.advance(1000)

      const all = await service.listAudit(userCaller('alice'), {})
      expect(all.ok).toBe(true)
      if (!all.ok) return
      const actions = all.value.items.map(entry => entry.action)
      expect(actions).toContain('knowledgeAdmin.publish')
      expect(actions).toContain('knowledgeAdmin.discardProposal')
      expect(all.value.items.every(entry => entry.account === 'alice')).toBe(true)
      expect(existsSync(join(rig.adminHome, 'knowledge-audit.jsonl'))).toBe(true)

      const publishOnly = await service.listAudit(userCaller('alice'), { action: 'knowledgeAdmin.publish' })
      expect(publishOnly.ok).toBe(true)
      if (publishOnly.ok) {
        expect(publishOnly.value.items.length).toBeGreaterThan(0)
        expect(publishOnly.value.items.every(entry => entry.action === 'knowledgeAdmin.publish')).toBe(true)
      }

      const future = await service.listAudit(userCaller('alice'), { since: '2030-01-01T00:00:00.000Z' })
      if (future.ok) expect(future.value.items).toEqual([])

      const limited = await service.listAudit(userCaller('alice'), { limit: 1 })
      if (limited.ok) {
        expect(limited.value.items).toHaveLength(1)
        expect(limited.value.total).toBeGreaterThan(1)
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('setMember upsert 去重(同 (account,userId) 只留一行),remove 后消失', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      await service.setMember(userCaller('alice'), { member_user_id: 42, level: 'editor' })
      clock.advance(5000)
      const second = await service.setMember(userCaller('alice'), { member_user_id: 42, level: 'owner' })
      expect(second.ok).toBe(true)
      if (second.ok) expect(second.value.member?.level).toBe('owner')

      const listed = await service.listMembers(userCaller('alice'), {})
      expect(listed.ok).toBe(true)
      if (listed.ok) {
        expect(listed.value.members).toHaveLength(1)
        expect(listed.value.members[0]?.member_user_id).toBe(42)
        expect(listed.value.members[0]?.level).toBe('owner')
        expect(listed.value.members[0]?.updated_at).toBe(clock.now().toISOString())
      }

      const removed = await service.setMember(userCaller('alice'), { member_user_id: 42, level: 'remove' })
      expect(removed.ok).toBe(true)
      if (removed.ok) expect(removed.value.removed).toBe(true)
      const after = await service.listMembers(userCaller('alice'), {})
      if (after.ok) expect(after.value.members).toEqual([])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('setMember 拒绝非法 userId', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const bad = await service.setMember(userCaller('alice'), { member_user_id: -1, level: 'viewer' })
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.code).toBe('invalid')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})
