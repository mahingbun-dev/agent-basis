/** WeKnora 适配器测试:未启用 not-configured、HTTP 调用层形态、响应映射、fail-soft。真连后置(blockers)。 */
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
  it('标准载荷映射:content/score/来源定位', () => {
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
