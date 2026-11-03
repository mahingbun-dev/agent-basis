/**
 * KnowledgeService 组合层测试:注册表可交换(Cordis provide)、出口级可见性复滤(纵深防御)、
 * dual 模式 RRF 融合骨架(wiki-local 真库 + WeKnora mock)、fail-soft、无后端 propose 报错。
 */
import * as nodeFs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_SERVICE_ID, WeKnoraBackend, WikiLocalBackend, createKnowledgeService, createNodeFsAdapter,
} from '../src/index.ts'
import { makeSampleWiki } from './helpers.ts'
import type { SampleWiki } from './helpers.ts'
import type { BackendStatusReport, KnowledgeBackend, KnowledgeHit } from '../src/index.ts'

let wiki: SampleWiki

beforeEach(() => {
  wiki = makeSampleWiki()
})

afterEach(() => {
  wiki.cleanup()
})

function makeWikiBackend(): WikiLocalBackend {
  return new WikiLocalBackend({
    wikiDir: wiki.wikiDir,
    fs: createNodeFsAdapter(nodeFs),
    now: () => new Date('2026-11-03T08:00:00.000Z'),
  })
}

function makeWeKnoraMock(hits: readonly KnowledgeHit[]): WeKnoraBackend {
  return new WeKnoraBackend({
    enabled: true,
    baseUrl: 'http://nas:8888',
    token: 't',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: hits.map(h => ({ knowledge_id: h.ref.doc_id, document_name: h.title, content: h.snippet })),
      }),
    }),
  })
}

/** 构造后端无关的命中(供 mock/纵深防御用例)。 */
function rawHit(backend: string, docId: string, overrides?: Partial<KnowledgeHit>): KnowledgeHit {
  return {
    ref: { doc_id: docId, source_uri: `x://${docId}`, backend },
    title: docId,
    snippet: '',
    score: 0.9,
    provenance: { origin: 't', status: 'active', trust: 'official', review: 'reviewed' },
    ...overrides,
  }
}

describe('注册表(provide 可交换 + 唯一 ID)', () => {
  it('service.id = KNOWLEDGE_SERVICE_ID;registerBackend 返回 disposer', async () => {
    const service = createKnowledgeService()
    expect(service.id).toBe(KNOWLEDGE_SERVICE_ID)
    const backend = makeWikiBackend()
    await backend.reindexAll()
    const dispose = service.registerBackend(backend)
    expect(service.listBackends().map(b => b.id)).toEqual(['wiki-local'])
    dispose()
    expect(service.listBackends()).toEqual([])
    backend.dispose()
    service.dispose()
  })

  it('同 ID 重复注册先配逆旧的(可交换)', async () => {
    const service = createKnowledgeService()
    const disposed: string[] = []
    const mk = (docCount: number): KnowledgeBackend => ({
      id: 'fake',
      capabilities: { write: false, deprecate: false, graph: false },
      search: async () => [],
      read: async () => {
        throw new Error('unused')
      },
      health: async () => ({ ok: true, doc_count: docCount }),
      dispose: () => disposed.push(`fake-${docCount}`),
    })
    const first = mk(1)
    service.registerBackend(first)
    service.registerBackend(mk(2)) // 重复 ID:先配逆 first
    expect(disposed).toEqual(['fake-1'])
    const reports: readonly BackendStatusReport[] = await service.status()
    expect(reports[0]!.doc_count).toBe(2)
    service.dispose()
    expect(disposed).toEqual(['fake-1', 'fake-2'])
  })
})

describe('出口级可见性复滤(纵深防御:不信单一后端)', () => {
  it('后端返回 deprecated/superseded/未过审命中,service 出口仍过滤', async () => {
    const evil: KnowledgeBackend = {
      id: 'evil',
      capabilities: { write: false, deprecate: false, graph: false },
      search: async () => [
        rawHit('evil', 'a'),
        rawHit('evil', 'b', { provenance: { origin: 't', status: 'deprecated', trust: 'official', review: 'reviewed' } }),
        rawHit('evil', 'c', { provenance: { origin: 't', status: 'active', superseded_by: 'x', trust: 'official', review: 'reviewed' } }),
        rawHit('evil', 'd', { provenance: { origin: 't', status: 'active', trust: 'agent_drafted', review: 'pending' } }),
      ],
      read: async () => {
        throw new Error('unused')
      },
      health: async () => ({ ok: true, doc_count: 4 }),
    }
    const service = createKnowledgeService({ backends: [evil] })
    const result = await service.search({ query: 'x' })
    expect(result.hits.map(h => h.ref.doc_id)).toEqual(['a'])
    service.dispose()
  })
})

describe('dual 模式 RRF 融合骨架(wiki-local + weknora)', () => {
  it('两后端命中融合;双路同 doc_id 各自保留;weknora 优先级在前', async () => {
    const wikiBackend = makeWikiBackend()
    await wikiBackend.reindexAll()
    // weknora mock:一条与 wiki 撞 doc_id 的平台文档 + 一条平台独有
    const weknora = makeWeKnoraMock([
      rawHit('weknora', 'domains/venue-selection', { title: '场地选址(平台版)' }),
      rawHit('weknora', 'kb-platform-only', { title: '平台独有的场地应急预案' }),
    ])
    const service = createKnowledgeService({ backends: [wikiBackend, weknora] })
    try {
      const result = await service.search({ query: '场地' })
      expect(result.contributed).toEqual(['weknora', 'wiki-local']) // weknora 权威优先
      const ids = result.hits.map(h => h.ref.doc_id)
      expect(ids).toContain('domains/venue-selection') // wiki 路
      expect(ids).toContain('kb-platform-only') // weknora 独有
      // 双路同名文档代表取 weknora 版(优先级列表在前)
      const venue = result.hits.find(h => h.ref.doc_id === 'domains/venue-selection')!
      expect(venue.ref.backend).toBe('weknora')
      // wiki 侧过期/未过审页依旧不可见
      expect(ids).not.toContain('procedures/old-checkin')
      expect(ids).not.toContain('domains/tax-rule-draft')
    } finally {
      service.dispose()
    }
  })

  it('单后端抛错 fail-soft:degraded 记录,另一后端结果照常返回', async () => {
    const wikiBackend = makeWikiBackend()
    await wikiBackend.reindexAll()
    const broken: KnowledgeBackend = {
      id: 'broken',
      capabilities: { write: false, deprecate: false, graph: false },
      search: async () => {
        throw new Error('backend down')
      },
      read: async () => {
        throw new Error('unused')
      },
      health: async () => ({ ok: false, doc_count: 0, reason: 'backend down' }),
    }
    const service = createKnowledgeService({ backends: [wikiBackend, broken] })
    try {
      const result = await service.search({ query: '场地' })
      expect(result.contributed).toEqual(['wiki-local'])
      expect(result.degraded).toEqual([{ backend: 'broken', reason: 'Error: backend down' }])
      expect(result.hits.length).toBeGreaterThan(0)
    } finally {
      service.dispose()
    }
  })

  it('status 汇总:wiki ok + weknora 未启用 not-configured', async () => {
    const wikiBackend = makeWikiBackend()
    await wikiBackend.reindexAll()
    const service = createKnowledgeService({ backends: [wikiBackend, new WeKnoraBackend()] })
    try {
      const reports = await service.status()
      const weknoraReport = reports.find(r => r.id === 'weknora')!
      const wikiReport = reports.find(r => r.id === 'wiki-local')!
      expect(weknoraReport.ok).toBe(false)
      expect(weknoraReport.reason).toBe('not-configured')
      expect(weknoraReport.capabilities.write).toBe(false)
      expect(wikiReport.ok).toBe(true)
      expect(wikiReport.doc_count).toBe(8)
    } finally {
      service.dispose()
    }
  })
})

describe('统一写入口路由', () => {
  it('propose 路由到 wiki-local;无后端时明确报错', async () => {
    const empty = createKnowledgeService()
    await expect(empty.propose({ title: 't', body: 'b' })).rejects.toThrow(/无可写后端/)
    empty.dispose()

    const wikiBackend = makeWikiBackend()
    await wikiBackend.reindexAll()
    const service = createKnowledgeService({ backends: [new WeKnoraBackend(), wikiBackend] })
    try {
      const routed = await service.propose({ title: '服务层提案', body: '内容' })
      expect(routed.backend).toBe('wiki-local')
      expect(wikiBackend.getProposal(routed.proposal_id)!.state).toBe('pending')
    } finally {
      service.dispose()
    }
  })
})
