/** WeKnora 适配器测试:未启用 not-configured、HTTP 调用层形态、响应映射、fail-soft、真实载荷校准(2026-11-04 真连采样)。 */
import { describe, expect, it } from 'vitest'
import { WeKnoraBackend, mapSearchResponse } from '../src/index.ts'
import type { WeKnoraConfig, WeKnoraRequestInit, WeKnoraResponse } from '../src/index.ts'

function jsonResponse(payload: unknown): WeKnoraResponse {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  }
}

describe('手动启用开关', () => {
  it('缺省未启用:health=not-configured,search 返回空', async () => {
    const backend = new WeKnoraBackend()
    expect(backend.isConfigured()).toBe(false)
    await expect(backend.search({ query: '场地' })).resolves.toEqual([])
    const health = await backend.health()
    expect(health.ok).toBe(false)
    expect(health.reason).toBe('not-configured')
  })

  it('enabled 但缺 baseUrl/凭据:同样 not-configured', async () => {
    expect(new WeKnoraBackend({ enabled: true }).isConfigured()).toBe(false)
    expect(new WeKnoraBackend({ enabled: true, baseUrl: 'http://nas:8888' }).isConfigured()).toBe(false)
  })

  it('tokenRef 无解析器 = 凭据不可用(fail-soft 空结果 + health 报错)', async () => {
    const backend = new WeKnoraBackend({ enabled: true, baseUrl: 'http://nas:8888', tokenRef: 'vault:weknora' })
    expect(backend.isConfigured()).toBe(true)
    await expect(backend.search({ query: 'x' })).resolves.toEqual([])
    expect((await backend.health()).reason).toContain('凭据不可用')
  })
})

describe('HTTP 调用层(官方 /api/v1/knowledge-search 形态)', () => {
  it('POST JSON:Bearer 凭据 + query/knowledge_base_ids/match_count/rerank', async () => {
    const seen: { url: string; init: WeKnoraRequestInit }[] = []
    const config: WeKnoraConfig = {
      enabled: true,
      baseUrl: 'http://nas:8888',
      token: 'secret-token',
      knowledgeBaseIds: ['kb-01', 'kb-02'],
      fetchImpl: async (url, init) => {
        seen.push({ url, init })
        return jsonResponse({ success: true, data: [] })
      },
    }
    const backend = new WeKnoraBackend(config)
    const hits = await backend.search({ query: '场地选址', top_k: 5 })
    expect(hits).toEqual([])
    expect(seen.length).toBe(1)
    expect(seen[0]!.url).toBe('http://nas:8888/api/v1/knowledge-search')
    expect(seen[0]!.init.method).toBe('POST')
    expect(seen[0]!.init.headers.authorization).toBe('Bearer secret-token')
    expect(seen[0]!.init.headers['content-type']).toBe('application/json')
    const body = JSON.parse(seen[0]!.init.body) as Record<string, unknown>
    expect(body.query).toBe('场地选址')
    expect(body.knowledge_base_ids).toEqual(['kb-01', 'kb-02'])
    expect(body.match_count).toBe(5)
    expect(body.rerank).toEqual({ enabled: true })
    expect((await backend.health()).ok).toBe(true)
  })

  it('tokenRef 经 resolveCredential 解析(凭据不进配置)', async () => {
    let asked = ''
    const backend = new WeKnoraBackend({
      enabled: true,
      baseUrl: 'http://nas:8888',
      tokenRef: 'vault:weknora',
      resolveCredential: (ref) => {
        asked = ref
        return 'resolved-token'
      },
      fetchImpl: async (_url, init) => {
        expect(init.headers.authorization).toBe('Bearer resolved-token')
        return jsonResponse({ success: true, data: [] })
      },
    })
    await backend.search({ query: 'x' })
    expect(asked).toBe('vault:weknora')
  })

  it('HTTP 非 2xx:fail-soft 空结果 + health 记录原因', async () => {
    const backend = new WeKnoraBackend({
      enabled: true,
      baseUrl: 'http://nas:8888',
      token: 't',
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    })
    await expect(backend.search({ query: 'x' })).resolves.toEqual([])
    expect((await backend.health()).reason).toBe('HTTP 503')
  })

  it('transport 抛错:fail-soft 空结果', async () => {
    const backend = new WeKnoraBackend({
      enabled: true,
      baseUrl: 'http://nas:8888',
      token: 't',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    await expect(backend.search({ query: 'x' })).resolves.toEqual([])
    expect((await backend.health()).ok).toBe(false)
  })
})

describe('SearchResult → KnowledgeHit 映射(provenance 填全)', () => {
  it('文档形态(官方文档字段 document_name/source_locators,防御式保留)', () => {
    const hits = mapSearchResponse({
      success: true,
      data: [
        {
          knowledge_id: 'k-001',
          document_name: '2026 春季发布会手册',
          content: '会场场地要求:层高不低于 6 米,承重每平米 500 公斤。',
          metadata: { base_score: 0.87, model_score: 0.91 },
          source_locators: [{ type: 'page', page: 12, quote: '场地要求' }],
        },
      ],
    }, 8)
    expect(hits.length).toBe(1)
    const hit = hits[0]!
    expect(hit.ref).toEqual({ doc_id: 'k-001', source_uri: 'weknora://k-001', backend: 'weknora' })
    expect(hit.title).toBe('2026 春季发布会手册')
    expect(hit.snippet).toContain('层高')
    expect(hit.score).toBe(0.87)
    expect(hit.provenance.origin).toContain('2026 春季发布会手册')
    expect(hit.provenance.origin).toContain('场地要求')
    expect(hit.provenance.trust).toBe('official')
    expect(hit.provenance.review).toBe('reviewed')
    expect(hit.provenance.status).toBe('active')
  })

  it('防御式:success=false / data 非数组 / 无 id 条目跳过,不猜值', () => {
    expect(mapSearchResponse({ success: false, data: [] }, 8)).toEqual([])
    expect(mapSearchResponse({ success: true, data: 'oops' }, 8)).toEqual([])
    expect(mapSearchResponse({ success: true, data: [{ content: 'no id' }] }, 8)).toEqual([])
    expect(mapSearchResponse('not even an object', 8)).toEqual([])
  })

  it('无相似度字段时按名次倒数给分;top_k 截断', () => {
    const hits = mapSearchResponse({
      success: true,
      data: [
        { knowledge_id: 'a', content: 'x' },
        { knowledge_id: 'b', content: 'y' },
        { knowledge_id: 'c', content: 'z' },
      ],
    }, 2)
    expect(hits.length).toBe(2)
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
    expect(hits[0]!.score).toBeLessThanOrEqual(1)
  })
})

/** 2026-11-04 真连采样(http://MaNas:8080,bge-m3 local embedding,event-kb-smoke 检索「预算」首命中,原样拷贝)。 */
const REAL_SEARCH_PAYLOAD = {
  data: [
    {
      id: '88a11ab5-21b7-4218-b3fd-715f5a4042e9',
      content: '活动预算管理规范\n\n年度发布会预算总额不超过 50 万元,其中场地租赁预算占 30%,餐饮预算占 20%。预算变更超过 10% 需走审批流程。\n',
      knowledge_id: 'd2cf162b-ae1a-41a3-82c0-4747b273e59a',
      chunk_index: 0,
      knowledge_title: 'event-budget.md',
      start_at: 0,
      end_at: 72,
      seq: 0,
      score: 0.016393442622950817,
      match_type: 0,
      sub_chunk_id: null,
      metadata: {},
      chunk_type: 'text',
      parent_chunk_id: '',
      image_info: '',
      knowledge_filename: 'event-budget.md',
      knowledge_source: '',
      knowledge_channel: 'web',
      matched_content: 'event-budget.md\n活动预算管理规范\n\n年度发布会预算总额不超过 50 万元,其中场地租赁预算占 30%,餐饮预算占 20%。预算变更超过 10% 需走审批流程。',
      knowledge_base_id: 'f835dc14-2f58-4235-bbc0-0b4d85ec3d71',
    },
  ],
  success: true,
}

describe('真实载荷校准(2026-11-04 MaNas:8080 真连采样)', () => {
  it('真实命中形态:标题取 knowledge_title,doc_id 取 knowledge_id(非 chunk id),score 直读', () => {
    const hits = mapSearchResponse(REAL_SEARCH_PAYLOAD, 8)
    expect(hits.length).toBe(1)
    const hit = hits[0]!
    expect(hit.ref.doc_id).toBe('d2cf162b-ae1a-41a3-82c0-4747b273e59a')
    expect(hit.ref.source_uri).toBe('weknora://d2cf162b-ae1a-41a3-82c0-4747b273e59a')
    expect(hit.title).toBe('event-budget.md')
    expect(hit.snippet).toContain('预算总额不超过 50 万元')
    expect(hit.score).toBeCloseTo(0.016393442622950817, 15)
    expect(hit.provenance.origin).toContain('event-budget.md')
    expect(hit.provenance.trust).toBe('official')
  })

  it('真实载荷经 HTTP 层贯通:请求体形态与真实服务端兼容(真连已验)', async () => {
    const seen: { url: string; body: string }[] = []
    const backend = new WeKnoraBackend({
      enabled: true,
      baseUrl: 'http://MaNas:8080',
      token: 'real-run-token',
      knowledgeBaseIds: ['f835dc14-2f58-4235-bbc0-0b4d85ec3d71'],
      fetchImpl: async (url, init) => {
        seen.push({ url, body: init.body })
        return jsonResponse(REAL_SEARCH_PAYLOAD)
      },
    })
    const hits = await backend.search({ query: '预算', top_k: 8 })
    expect(seen[0]!.url).toBe('http://MaNas:8080/api/v1/knowledge-search')
    const body = JSON.parse(seen[0]!.body) as Record<string, unknown>
    expect(body).toEqual({
      query: '预算',
      knowledge_base_ids: ['f835dc14-2f58-4235-bbc0-0b4d85ec3d71'],
      match_count: 8,
      rerank: { enabled: true },
    })
    expect(hits.length).toBe(1)
    expect(hits[0]!.title).toBe('event-budget.md')
    expect((await backend.health()).ok).toBe(true)
  })
})
