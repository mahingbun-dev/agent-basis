/**
 * wiki-local 端到端检索测试(任务验收四用例之三在此):
 * ① 样例 wiki 建索引后检索命中(FTS5 trigram ≥3 字符路径 + 短词 LIKE 回退路径);
 * ② 过期页不出现(deprecated + superseded);
 * ③ 未过审不出现(agent_drafted pending);
 * 另含坏页跳过、中文双词混合查询、top_k 截断。
 */
import * as nodeFs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WikiLocalBackend, createNodeFsAdapter } from '../src/index.ts'
import { HIDDEN_DOC_IDS, VISIBLE_DOC_IDS, makeSampleWiki } from './helpers.ts'
import type { SampleWiki } from './helpers.ts'

let wiki: SampleWiki
let backend: WikiLocalBackend

beforeEach(async () => {
  wiki = makeSampleWiki()
  backend = new WikiLocalBackend({
    wikiDir: wiki.wikiDir,
    fs: createNodeFsAdapter(nodeFs),
    now: () => new Date('2026-11-03T08:00:00.000Z'),
  })
  const result = await backend.reindexAll()
  // 9 页样例,坏页 1 页跳过
  expect(result.indexed).toBe(8)
  expect(result.skipped).toEqual(['bad/broken-page.md'])
})

afterEach(() => {
  backend.dispose()
  wiki.cleanup()
})

describe('样例 wiki 建索引与检索命中', () => {
  it('中文长词(≥3字符)走 FTS5 trigram 命中', async () => {
    const hits = await backend.search({ query: '场地选址' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.ref.doc_id).toBe('domains/venue-selection')
    expect(hits[0]!.provenance.origin).toBe('《活动策划手册 v3.2》第4章')
    expect(hits[0]!.score).toBeGreaterThan(0)
    expect(hits[0]!.score).toBeLessThanOrEqual(1)
  })

  it('中文短词(<3字符,如"预算")回退 LIKE 命中', async () => {
    const hits = await backend.search({ query: '预算' })
    expect(hits.map(h => h.ref.doc_id)).toContain('procedures/budget-plan')
  })

  it('英文词命中(发票)', async () => {
    const hits = await backend.search({ query: '发票 报销' })
    expect(hits.map(h => h.ref.doc_id)).toContain('procedures/budget-plan')
  })

  it('混合长短板查询(场地 + 签到)双路融合命中', async () => {
    const hits = await backend.search({ query: '场地 签到' })
    const ids = hits.map(h => h.ref.doc_id)
    expect(ids).toContain('domains/venue-selection') // 场地(FTS 路)
    expect(ids).toContain('procedures/new-checkin') // 签到(LIKE 路)
    // 旧签到流程(deprecated)即使在 LIKE 路命中也被过滤
    expect(ids).not.toContain('procedures/old-checkin')
  })

  it('top_k 截断与 health/count(物理留档含被过滤页)', async () => {
    const hits = await backend.search({ query: '场地', top_k: 1 })
    expect(hits.length).toBeLessThanOrEqual(1)
    const health = await backend.health()
    expect(health.ok).toBe(true)
    expect(health.doc_count).toBe(8) // 含 deprecated/superseded/未过审(物理留档)
  })
})

describe('过期页不出现(检索统一过滤)', () => {
  it('status=deprecated 页永不出现(即使查询词精确命中其标题)', async () => {
    const hits = await backend.search({ query: '纸质名单 胸牌' })
    expect(hits.map(h => h.ref.doc_id)).not.toContain('procedures/old-checkin')
  })

  it('superseded_by 非空(即使 status 未到 deprecated)同样不可见', async () => {
    const hits = await backend.search({ query: '全额退费' })
    expect(hits.map(h => h.ref.doc_id)).not.toContain('archive/refund-policy-v1')
  })

  it('全可见域 = VISIBLE_DOC_IDS(硬过滤的完备断言)', async () => {
    const hits = await backend.search({ query: '场地 场馆 预算 签到 退费 税点 复盘 发票', top_k: 50 })
    const ids = new Set(hits.map(h => h.ref.doc_id))
    for (const id of VISIBLE_DOC_IDS) expect(ids.has(id)).toBe(true)
    for (const id of HIDDEN_DOC_IDS) expect(ids.has(id)).toBe(false)
  })
})

describe('未过审不出现(agent 投毒防线)', () => {
  it('agent_drafted + pending 页即使内容精确匹配也不出现', async () => {
    const hits = await backend.search({ query: '大额发票税点', top_k: 50 })
    expect(hits.map(h => h.ref.doc_id)).not.toContain('domains/tax-rule-draft')
  })

  it('agent_drafted 但 review=reviewed 的页可见(过审草稿)', async () => {
    const hits = await backend.search({ query: '复盘' })
    expect(hits.map(h => h.ref.doc_id)).toContain('domains/agent-review-notes')
    expect(hits[0]!.provenance.trust).toBe('agent_drafted')
    expect(hits[0]!.provenance.review).toBe('reviewed')
  })

  it('filters.trust 追加过滤(如只要 official)', async () => {
    const hits = await backend.search({ query: '场地 复盘', filters: { trust: ['official'] } })
    for (const hit of hits) expect(hit.provenance.trust).toBe('official')
  })

  it('filters.exclude_stale 生效(此处无 stale 可见页,断言不炸即可)', async () => {
    const hits = await backend.search({ query: '场地', filters: { exclude_stale: true } })
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('混合检索向量位留位(SemanticSearchProvider 注入)', () => {
  it('注入 fake 向量提供方后 hybrid 模式 RRF 融合(keywords 优先列表)', async () => {
    const semanticBackend = new WikiLocalBackend({
      wikiDir: wiki.wikiDir,
      fs: createNodeFsAdapter(nodeFs),
      now: () => new Date('2026-11-03T08:00:00.000Z'),
      semantic: {
        id: 'fake-embed',
        async search(query, topK) {
          expect(query).toBe('场地')
          expect(topK).toBeGreaterThan(0)
          // 向量路只召回场馆名录,且把未过审页也"召回"——出口必须再滤
          return [
            { doc_id: 'entities/venue-list', score: 0.99 },
            { doc_id: 'domains/tax-rule-draft', score: 0.9 },
          ]
        },
      },
    })
    await semanticBackend.reindexAll()
    try {
      const hits = await semanticBackend.search({ query: '场地', mode: 'hybrid', top_k: 10 })
      const ids = hits.map(h => h.ref.doc_id)
      expect(ids).toContain('domains/venue-selection') // 关键词路
      expect(ids).toContain('entities/venue-list') // 向量路
      expect(ids).not.toContain('domains/tax-rule-draft') // 向量路召回的未过审页被出口过滤
      // 融合分:双路命中的场馆名录应高于单路
      const venue = hits.find(h => h.ref.doc_id === 'entities/venue-list')!
      const single = hits.find(h => h.ref.doc_id === 'domains/venue-selection')!
      expect(venue.score).toBeGreaterThan(single.score)
    } finally {
      semanticBackend.dispose()
    }
  })

  it('semantic 模式无提供方时降级 keyword(不空转)', async () => {
    const hits = await backend.search({ query: '场地选址', mode: 'semantic' })
    expect(hits.map(h => h.ref.doc_id)).toContain('domains/venue-selection')
  })

  it('keyword 模式即使有提供方也不走向量', async () => {
    const onlySemantic = new WikiLocalBackend({
      wikiDir: wiki.wikiDir,
      fs: createNodeFsAdapter(nodeFs),
      now: () => new Date('2026-11-03T08:00:00.000Z'),
      semantic: { id: 'fake', search: async () => { throw new Error('不应被调用') } },
    })
    await onlySemantic.reindexAll()
    try {
      const hits = await onlySemantic.search({ query: '场地', mode: 'keyword' })
      expect(hits.length).toBeGreaterThan(0)
    } finally {
      onlySemantic.dispose()
    }
  })
})

describe('read(显式 ref 可读归档页,引用自带警示)', () => {
  it('读 deprecated 页返回全文 + changelog + 警示 citation', async () => {
    const doc = await backend.read({ doc_id: 'procedures/old-checkin', source_uri: '', backend: 'wiki-local' })
    expect(doc.title).toContain('旧流程')
    expect(doc.provenance.status).toBe('deprecated')
    expect(doc.provenance.superseded_by).toBe('procedures/new-checkin')
    expect(doc.citation).toContain('已废弃')
    expect(doc.changelog.length).toBeGreaterThan(0)
    expect(doc.wikilinks).toEqual([])
  })

  it('读不存在的 doc_id 抛 KnowledgeNotFoundError', async () => {
    await expect(backend.read({ doc_id: 'nope', source_uri: '', backend: 'wiki-local' })).rejects.toThrow(/无此文档/)
  })
})
