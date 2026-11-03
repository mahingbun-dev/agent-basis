/**
 * propose 流转测试(任务验收用例④):提案 → governance 门禁 → 发布/拒绝 的完整状态机。
 *
 * 铁律:trust=agent_drafted 未过审永不进检索结果——propose 只产生提案,pending 阶段内容不落 pages/fts;
 * approve 才落盘(trust 转 verified/reviewed)并可检索;reject/门禁异常(fail-closed)永不出现。
 */
import * as nodeFs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KnowledgeNotFoundError, KnowledgeStateError, WikiLocalBackend, createNodeFsAdapter } from '../src/index.ts'
import { makeSampleWiki } from './helpers.ts'
import type { SampleWiki } from './helpers.ts'
import type { GateDecision, GovernanceGate } from '../src/index.ts'

const NOW = (): Date => new Date('2026-11-03T08:00:00.000Z')

let wiki: SampleWiki

beforeEach(() => {
  wiki = makeSampleWiki()
})

afterEach(() => {
  wiki.cleanup()
})

function makeBackend(gate?: GovernanceGate): WikiLocalBackend {
  return new WikiLocalBackend({
    wikiDir: wiki.wikiDir,
    fs: createNodeFsAdapter(nodeFs),
    now: NOW,
    ...(gate !== undefined ? { gate } : {}),
  })
}

const PATCH = {
  title: '临时座位安排规范',
  body: '临时加座不得超过核定容量的 10%,且不得占用消防通道。',
  tags: ['安全'],
  origin: '《大型活动安全规范》§12',
} as const

describe('propose 只产生提案', () => {
  it('propose 后:提案 pending、文件未落盘、检索不可见', async () => {
    const backend = makeBackend(() => ({ kind: 'approve' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      expect(id).toMatch(/^prop-/)
      const proposal = backend.getProposal(id)!
      expect(proposal.state).toBe('pending')
      expect(proposal.patch.title).toBe(PATCH.title)
      // 未落盘
      await expect(backend.read({ doc_id: 'agent-drafts/临时座位安排规范', source_uri: '', backend: 'wiki-local' }))
        .rejects.toThrow(KnowledgeNotFoundError)
      // 检索不可见(即使查的是提案正文关键词)
      const hits = await backend.search({ query: '消防通道', top_k: 50 })
      expect(hits.map(h => h.ref.doc_id)).not.toContain('agent-drafts/临时座位安排规范')
      expect((await backend.health()).doc_count).toBe(8) // 索引页数不变
    } finally {
      backend.dispose()
    }
  })

  it('空 title/body 拒绝(propose 入口校验,同步抛出)', () => {
    const backend = makeBackend()
    try {
      expect(() => backend.propose({ title: ' ', body: 'x' })).toThrow(KnowledgeStateError)
      expect(() => backend.propose({ title: 'x', body: '' })).toThrow(KnowledgeStateError)
    } finally {
      backend.dispose()
    }
  })

  it('discardProposal 配逆 propose(未决可撤,已决不可撤)', async () => {
    const backend = makeBackend()
    try {
      const id = await backend.propose(PATCH)
      await backend.discardProposal(id)
      expect(backend.getProposal(id)).toBeUndefined()
      const id2 = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id2, 'test-reviewer')
      expect(outcome.proposal.state).toBe('rejected') // 未配置门禁 → fail-closed 默认拒绝
      expect(() => backend.discardProposal(id2)).toThrow(KnowledgeStateError)
    } finally {
      backend.dispose()
    }
  })
})

describe('门禁 approve → 发布 → 可检索', () => {
  it('过审后落盘:trust=verified、review=reviewed、changelog 追加、检索命中', async () => {
    const backend = makeBackend(() => ({ kind: 'approve' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id, 'human-1')
      expect(outcome.proposal.state).toBe('approved')
      expect(outcome.published?.doc_id).toBe('agent-drafts/临时座位安排规范')
      const doc = await backend.read({ doc_id: 'agent-drafts/临时座位安排规范', source_uri: '', backend: 'wiki-local' })
      expect(doc.provenance.trust).toBe('verified')
      expect(doc.provenance.review).toBe('reviewed')
      expect(doc.provenance.status).toBe('active')
      expect(doc.provenance.origin).toBe('《大型活动安全规范》§12')
      expect(doc.changelog.at(-1)?.note).toContain('governance 门禁')
      // 发布前不可见 → 发布后可检索
      const hits = await backend.search({ query: '消防通道' })
      expect(hits.map(h => h.ref.doc_id)).toContain('agent-drafts/临时座位安排规范')
    } finally {
      backend.dispose()
    }
  })

  it('门禁可指定 trust=official 过审', async () => {
    const backend = makeBackend((): GateDecision => ({ kind: 'approve', trust: 'official' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      await backend.reviewProposal(id)
      const hits = await backend.search({ query: '消防通道' })
      expect(hits[0]!.provenance.trust).toBe('official')
    } finally {
      backend.dispose()
    }
  })

  it('approve 决策即使写 agent_drafted 也转正为 verified(过审语义)', async () => {
    const backend = makeBackend((): GateDecision => ({ kind: 'approve', trust: 'agent_drafted' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id)
      expect(outcome.proposal.state).toBe('approved')
      const hits = await backend.search({ query: '消防通道' })
      expect(hits[0]!.provenance.trust).toBe('verified')
      expect(hits[0]!.provenance.review).toBe('reviewed')
    } finally {
      backend.dispose()
    }
  })

  it('undo 配逆发布:删文件 + 删索引 + 提案回 pending(真删,非打标)', async () => {
    const backend = makeBackend(() => ({ kind: 'approve' }))
    await backend.reindexAll()
    try {
      const before = (await backend.health()).doc_count
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id)
      expect((await backend.health()).doc_count).toBe(before + 1)
      await outcome.undo()
      expect((await backend.health()).doc_count).toBe(before)
      expect(backend.getProposal(id)!.state).toBe('pending')
      const hits = await backend.search({ query: '消防通道', top_k: 50 })
      expect(hits.map(h => h.ref.doc_id)).not.toContain('agent-drafts/临时座位安排规范')
      await expect(backend.read({ doc_id: 'agent-drafts/临时座位安排规范', source_uri: '', backend: 'wiki-local' }))
        .rejects.toThrow(KnowledgeNotFoundError)
    } finally {
      backend.dispose()
    }
  })
})

describe('门禁 reject / fail-closed', () => {
  it('显式 reject:提案拒绝、内容永不落盘', async () => {
    const backend = makeBackend(() => ({ kind: 'reject', reason: '来源不可信' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id)
      expect(outcome.proposal.state).toBe('rejected')
      expect(outcome.proposal.note).toBe('来源不可信')
      expect(outcome.published).toBeUndefined()
      const hits = await backend.search({ query: '消防通道', top_k: 50 })
      expect(hits).toHaveLength(0)
      expect((await backend.health()).doc_count).toBe(8)
    } finally {
      backend.dispose()
    }
  })

  it('门禁抛错按 reject 处理(fail-closed)', async () => {
    const backend = makeBackend(() => {
      throw new Error('governance 服务不可用')
    })
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id)
      expect(outcome.proposal.state).toBe('rejected')
      expect(outcome.proposal.note).toContain('fail-closed')
      expect((await backend.search({ query: '消防通道', top_k: 50 })).length).toBe(0)
    } finally {
      backend.dispose()
    }
  })

  it('未配置门禁 = 默认拒绝(无人评审则不发布)', async () => {
    const backend = makeBackend()
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      const outcome = await backend.reviewProposal(id)
      expect(outcome.proposal.state).toBe('rejected')
      expect(outcome.proposal.note).toContain('fail-closed')
    } finally {
      backend.dispose()
    }
  })

  it('已决提案不可重复评审(状态机单向)', async () => {
    const backend = makeBackend(() => ({ kind: 'approve' }))
    await backend.reindexAll()
    try {
      const id = await backend.propose(PATCH)
      await backend.reviewProposal(id)
      await expect(backend.reviewProposal(id)).rejects.toThrow(KnowledgeStateError)
    } finally {
      backend.dispose()
    }
  })
})

describe('deprecate(废弃/取代,与 RSI deprecate 共用语义)', () => {
  it('deprecate 后检索不可见;changelog 追加;undo 恢复', async () => {
    const backend = makeBackend()
    await backend.reindexAll()
    try {
      const before = await backend.search({ query: '场馆 清单', top_k: 50 })
      expect(before.map(h => h.ref.doc_id)).toContain('entities/venue-list')
      const effect = await backend.deprecate('entities/venue-list', '名录迁入新台账', 'entities/venue-list-v2')
      const after = await backend.search({ query: '场馆 清单', top_k: 50 })
      expect(after.map(h => h.ref.doc_id)).not.toContain('entities/venue-list')
      // 物理留档:read 仍可读,provenance 带取代信息
      const doc = await backend.read({ doc_id: 'entities/venue-list', source_uri: '', backend: 'wiki-local' })
      expect(doc.provenance.status).toBe('deprecated')
      expect(doc.provenance.superseded_by).toBe('entities/venue-list-v2')
      expect(doc.changelog.at(-1)?.note).toContain('名录迁入新台账')
      // 配逆
      await effect.undo()
      const restored = await backend.search({ query: '场馆 清单', top_k: 50 })
      expect(restored.map(h => h.ref.doc_id)).toContain('entities/venue-list')
    } finally {
      backend.dispose()
    }
  })

  it('deprecate 必须提供 superseded_by(废弃必填)', async () => {
    const backend = makeBackend()
    await backend.reindexAll()
    try {
      await expect(backend.deprecate('domains/venue-selection', 'no successor')).rejects.toThrow(KnowledgeStateError)
    } finally {
      backend.dispose()
    }
  })

  it('重复 deprecate 抛错', async () => {
    const backend = makeBackend()
    await backend.reindexAll()
    try {
      await expect(backend.deprecate('procedures/old-checkin', 'again', 'x')).rejects.toThrow(/已是 deprecated/)
    } finally {
      backend.dispose()
    }
  })
})
