/**
 * 模型面四工具测试:knowledge_search / knowledge_read / knowledge_status / knowledge_propose。
 * 在真实样例 wiki + service(dual:wiki 真库 + weknora 未启用)上执行,断言规范 JSON 出口。
 */
import * as nodeFs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WeKnoraBackend, WikiLocalBackend, buildKnowledgeTools, createKnowledgeService, createNodeFsAdapter } from '../src/index.ts'
import { makeSampleWiki } from './helpers.ts'
import type { SampleWiki } from './helpers.ts'

let wiki: SampleWiki
let service: ReturnType<typeof createKnowledgeService>
let tools: ReturnType<typeof buildKnowledgeTools>

beforeEach(async () => {
  wiki = makeSampleWiki()
  const backend = new WikiLocalBackend({
    wikiDir: wiki.wikiDir,
    fs: createNodeFsAdapter(nodeFs),
    now: () => new Date('2026-11-03T08:00:00.000Z'),
    gate: () => ({ kind: 'approve' }),
  })
  await backend.reindexAll()
  service = createKnowledgeService({ backends: [backend, new WeKnoraBackend()] })
  tools = buildKnowledgeTools(service)
})

afterEach(() => {
  service.dispose()
  wiki.cleanup()
})

describe('knowledge_search', () => {
  it('样例 wiki 建索引检索命中:KnowledgeHit 统一 schema + 统一引用格式', async () => {
    const result = await tools.search.execute({ query: '场地选址' }) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.contributed).toEqual(['wiki-local'])
    const hits = result.hits as Array<Record<string, unknown>>
    expect(hits.length).toBeGreaterThan(0)
    const hit = hits[0]!
    const ref = hit.ref as Record<string, string>
    expect(ref.doc_id).toBe('domains/venue-selection')
    expect(ref.backend).toBe('wiki-local')
    expect(ref.source_uri).toContain('file://')
    const provenance = hit.provenance as Record<string, unknown>
    expect(provenance.origin).toBe('《活动策划手册 v3.2》第4章')
    expect(provenance.status).toBe('active')
    expect(provenance.trust).toBe('official')
    expect(hit.citation).toBe(`[《场地选址指南》](file://${wiki.wikiDir}/domains/venue-selection.md)(更新于 2026-10-12;生效中)`)
  })

  it('过期页/未过审页不在工具出口(检索统一过滤)', async () => {
    const result = await tools.search.execute({ query: '纸质名单 胸牌 大额发票税点 全额退费' }) as Record<string, unknown>
    const ids = (result.hits as Array<Record<string, Record<string, string>>>).map(h => h.ref!.doc_id)
    expect(ids).not.toContain('procedures/old-checkin')
    expect(ids).not.toContain('archive/refund-policy-v1')
    expect(ids).not.toContain('domains/tax-rule-draft')
  })

  it('短词 LIKE 回退与 top_k', async () => {
    const result = await tools.search.execute({ query: '预算', top_k: 2 }) as Record<string, unknown>
    expect((result.hits as unknown[]).length).toBeLessThanOrEqual(2)
    expect((result.hits as Array<Record<string, Record<string, string>>>).map(h => h.ref!.doc_id))
      .toContain('procedures/budget-plan')
  })

  it('非法参数抛 ToolArgError(query 缺失 / top_k 非整数 / mode 非法)', async () => {
    await expect(tools.search.execute({})).rejects.toThrow(/query/)
    await expect(tools.search.execute({ query: 'x', top_k: 1.5 })).rejects.toThrow(/top_k/)
    await expect(tools.search.execute({ query: 'x', mode: 'vector' })).rejects.toThrow(/mode/)
  })
})

describe('knowledge_read', () => {
  it('读文档:含 changelog 与 provenance,citation 自带警示', async () => {
    const result = await tools.read.execute({ doc_id: 'procedures/old-checkin' }) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const doc = result.doc as Record<string, unknown>
    expect(doc.title).toContain('旧流程')
    expect(Array.isArray(doc.changelog)).toBe(true)
    expect(String(doc.citation)).toContain('已废弃')
    expect(String(doc.citation)).toContain('procedures/new-checkin')
  })

  it('backend 缺省 wiki-local;不存在的 doc 报错', async () => {
    await expect(tools.read.execute({ doc_id: 'missing' })).rejects.toThrow()
  })
})

describe('knowledge_status', () => {
  it('两后端状态:wiki ok(8 页)+ weknora not-configured', async () => {
    const result = await tools.status.execute({}) as Record<string, unknown>
    expect(result.ok).toBe(true)
    const backends = result.backends as Array<Record<string, unknown>>
    expect(backends.length).toBe(2)
    const wikiReport = backends.find(b => b.id === 'wiki-local')!
    const weknoraReport = backends.find(b => b.id === 'weknora')!
    expect(wikiReport.ok).toBe(true)
    expect(wikiReport.doc_count).toBe(8)
    expect(weknoraReport.ok).toBe(false)
    expect(weknoraReport.reason).toBe('not-configured')
  })
})

describe('knowledge_propose(统一写入口:只产生提案)', () => {
  it('propose 返回 pending 提案;检索不可见;门禁通过后可见', async () => {
    const proposed = await tools.propose.execute({
      title: '临时座位安排规范',
      body: '临时加座不得超过核定容量的 10%,且不得占用消防通道。',
      origin: '《大型活动安全规范》§12',
    }) as Record<string, unknown>
    expect(proposed.ok).toBe(true)
    expect(proposed.state).toBe('pending')
    expect(proposed.backend).toBe('wiki-local')
    expect(String(proposed.note)).toContain('未过审内容不会出现在检索结果中')
    const proposalId = proposed.proposal_id as string

    // 未过审:检索不可见
    const before = await tools.search.execute({ query: '消防通道', top_k: 50 }) as Record<string, unknown>
    expect((before.hits as unknown[]).length).toBe(0)

    // 门禁通过(后端 gate=approve;经宿主面 reviewProposal 流转)→ 可见
    const wikiBackend = service.listBackends().find(b => b.id === 'wiki-local') as WikiLocalBackend
    const outcome = await wikiBackend.reviewProposal(proposalId, 'test-reviewer')
    expect(outcome.proposal.state).toBe('approved')

    const after = await tools.search.execute({ query: '消防通道', top_k: 50 }) as Record<string, unknown>
    const hits = after.hits as Array<Record<string, unknown>>
    expect(hits.length).toBe(1)
    const provenance = hits[0]!.provenance as Record<string, unknown>
    expect(provenance.trust).toBe('verified')
    expect(provenance.review).toBe('reviewed')
  })

  it('propose 非法参数拒绝(title/body 必填)', async () => {
    await expect(tools.propose.execute({ title: 'x' })).rejects.toThrow(/body/)
    await expect(tools.propose.execute({ body: 'x' })).rejects.toThrow(/title/)
  })
})

describe('工具规格完备性(模型面契约)', () => {
  it('四工具名与描述齐备,参数 schema 为对象', () => {
    const all = [tools.search, tools.read, tools.status, tools.propose]
    expect(all.map(spec => spec.name).sort()).toEqual(['knowledge_propose', 'knowledge_read', 'knowledge_search', 'knowledge_status'])
    for (const spec of all) {
      expect(spec.description.length).toBeGreaterThan(20)
      expect(spec.parameters.type).toBe('object')
    }
  })
})
