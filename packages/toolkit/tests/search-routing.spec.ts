/**
 * K2.3 搜索路由降级单测【=G2-B5:未配置路径 fetch spy 零调用】(36 号 §3 表/§6 门禁总表)。
 *
 * 断言(29 §7-1 Q1 拍板):
 * - 供给链顺序:① knowledge_search 内部优先(先于任何 Web 层调用)→ ③ Tavily 兜底
 *   (②原生/借用由路由器裁决与 K3.4 承接,generic 执行器只在 fallback 段被调用);
 * - 未配置 Tavily 且无原生可用 → **不发任何网络请求**(global fetch 与注入 fetch 双 spy 零调用),
 *   显式降级(仅内部档)/显式不可用,绝不静默外发;
 * - 配置 Tavily → 请求形态:Bearer tvly- 认证、include_published_date 恒 true(R6 默认 false
 *   须显式开)、count→max_results 截断、recency→time_range、domainFilter→include_domains;
 * - publishTime 归一化:RFC1123 示例格式 → ISO;null 保留(R6 best-estimate 可 null);
 * - score 仅内部排序参考不进块:块序按 score 降序,SourceBlock 无 score 字段。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TavilyClient, executeWebSearch, resolveTavilyKeyFromEnv, tavilyResultsToSourceBlocks } from '../src/index.ts'
import type { TavilyFetchResponse } from '../src/index.ts'
import { createCapabilityRequest } from '../src/index.ts'
import { runGenericCapability } from '../src/index.ts'
import type { DeploymentConfig } from '../src/index.ts'
import { routeCapability } from '../src/index.ts'

/** 调用留痕(顺序断言:internal 必须先于 tavily fetch)。 */
interface CallTrace {
  readonly kind: 'internal' | 'tavily-fetch'
  readonly detail: string
}

function jsonResponse(body: unknown, status = 200): TavilyFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

const TAVILY_SEARCH_OK = {
  query: 'glc',
  results: [
    { title: '结果甲', url: 'https://a.example.com/doc', content: '摘要甲', published_date: 'Tue, 11 Mar 2025 17:00:00 GMT', score: 0.88, favicon: 'https://a.example.com/favicon.ico' },
    { title: '结果乙', url: 'https://b.example.com/page', content: '摘要乙', published_date: null, score: 0.95 },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('G2-B5 · 未配置路径零网络请求', () => {
  it('未配置 Tavily 且无原生可用:路由裁决 unavailable,执行器零网络请求、显式降级(仅内部档)', async () => {
    const EMPTY_CONFIG: DeploymentConfig = { providers: {} }
    const decision = routeCapability(EMPTY_CONFIG, { provider: 'generic', model: 'third-party-chat' }, 'web_search')
    expect(decision.route).toBe('unavailable')
    expect(decision.reason).toContain('绝不静默外发')

    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', globalFetch)
    const trace: CallTrace[] = []
    const execution = await executeWebSearch(
      { query: '内部优先验证' },
      {
        internal: async (query) => {
          trace.push({ kind: 'internal', detail: query })
          return { ok: true, payload: { count: 1, hits: [{ title: '内部命中' }] } }
        },
        // tavily 未注入 = 部署未配置兜底(29 §7-1 ③「按部署配置」)。
      },
    )
    expect(globalFetch).not.toHaveBeenCalled()
    expect(trace).toEqual([{ kind: 'internal', detail: '内部优先验证' }])
    expect(execution.status).toBe('degraded')
    expect(execution.layers).toEqual(['internal'])
    expect(execution.reason).toContain('仅内部')
    expect(JSON.parse(execution.toolResult)).toEqual({
      ok: false,
      degraded: true,
      layers: ['internal'],
      internal: { count: 1, hits: [{ title: '内部命中' }] },
      reason: expect.stringContaining('绝不静默外发') as unknown,
    })
  })

  it('无内部知识库且未配置 Tavily:显式 unavailable(仍零网络请求)', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', globalFetch)
    const execution = await executeWebSearch({ query: 'q' }, {})
    expect(globalFetch).not.toHaveBeenCalled()
    expect(execution.status).toBe('unavailable')
    expect(execution.layers).toEqual([])
    expect(execution.reason).toContain('绝不静默外发')
    // 降级块:错误步骤块承载错误文案(块协议四类内的显式表达,不静默消失)。
    expect(execution.blocks).toEqual([{ type: 'search_step', step: 1, action: 'search', query: 'q', status: 'error', detail: execution.reason }])
  })

  it('read_url 同构:未配置 Tavily 显式 unavailable、零网络请求', async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', globalFetch)
    const { executeReadUrl } = await import('../src/index.ts')
    const execution = await executeReadUrl({ url: 'https://example.com/a' }, {})
    expect(globalFetch).not.toHaveBeenCalled()
    expect(execution.status).toBe('unavailable')
    expect(execution.blocks[0]).toMatchObject({ type: 'search_step', action: 'open_page', status: 'error', url: 'https://example.com/a' })
  })
})

describe('Q1 供给链顺序与 Tavily 请求形态', () => {
  it('内部优先(① 先于 ③);Tavily 请求:Bearer tvly-、include_published_date 恒 true、字段翻译', async () => {
    const trace: CallTrace[] = []
    const captured: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = []
    const tavily = new TavilyClient({
      apiKey: 'test-key-123',
      fetchImpl: async (url, init) => {
        trace.push({ kind: 'tavily-fetch', detail: url })
        captured.push({ url, init: { method: init.method, headers: init.headers, body: init.body ?? '' } })
        return jsonResponse(TAVILY_SEARCH_OK)
      },
    })
    const execution = await executeWebSearch(
      { query: '智谱接入', count: 30, recency: 'oneWeek', domainFilter: ['docs.example.com'] },
      {
        internal: async (query) => {
          trace.push({ kind: 'internal', detail: query })
          return { ok: true, payload: { count: 0, hits: [] } }
        },
        tavily,
      },
    )
    // ① 先于 ③(29 §7-1 Q1「内部知识库优先」)。
    expect(trace.map(item => item.kind)).toEqual(['internal', 'tavily-fetch'])
    // 请求形态(R6)。
    expect(captured[0]?.url).toBe('https://api.tavily.com/search')
    expect(captured[0]?.init.method).toBe('POST')
    expect(captured[0]?.init.headers.Authorization).toBe('Bearer tvly-test-key-123')
    expect(JSON.parse(captured[0]?.init.body ?? '{}')).toEqual({
      query: '智谱接入',
      max_results: 20, // count 1–50 → Tavily 0–20,如实截断不放大
      include_domains: ['docs.example.com'],
      time_range: 'week',
      include_published_date: true,
    })
    expect(execution.status).toBe('ok')
    expect(execution.layers).toEqual(['internal', 'tavily'])
    // 块:步骤 + 来源卡(score 降序,publishTime 归一化/null 保留,score 不进块)。
    expect(execution.blocks).toEqual([
      { type: 'search_step', step: 1, action: 'search', query: '智谱接入', status: 'ok' },
      { type: 'source', title: '结果乙', url: 'https://b.example.com/page', summary: '摘要乙', publishTime: null },
      { type: 'source', title: '结果甲', url: 'https://a.example.com/doc', summary: '摘要甲', publishTime: '2025-03-11T17:00:00.000Z', icon: 'https://a.example.com/favicon.ico' },
    ])
  })

  it('key 解析:环境变量名形态(部署配置 apiKeyEnv → 值;缺失=未配置)', () => {
    expect(resolveTavilyKeyFromEnv('TAVILY_API_KEY', { TAVILY_API_KEY: 'tvly-abc' })).toBe('tvly-abc')
    expect(resolveTavilyKeyFromEnv('TAVILY_API_KEY', {})).toBeUndefined()
    expect(resolveTavilyKeyFromEnv(undefined, { TAVILY_API_KEY: 'x' })).toBeUndefined()
  })

  it('内部检索 fail-soft:①失败不阻断③,状态如实 degraded', async () => {
    const tavily = new TavilyClient({ apiKey: 'k', fetchImpl: async () => jsonResponse(TAVILY_SEARCH_OK) })
    const execution = await executeWebSearch(
      { query: 'q' },
      { internal: async () => ({ ok: false, payload: null }), tavily },
    )
    expect(execution.status).toBe('degraded')
    expect(execution.reason).toContain('内部知识库检索失败')
    expect(execution.blocks.some(block => block.type === 'source')).toBe(true)
  })

  it('Tavily HTTP 失败:兜底段显式降级(错误步骤块),不静默', async () => {
    const tavily = new TavilyClient({
      apiKey: 'k',
      fetchImpl: async () => jsonResponse({ detail: [{ msg: 'invalid api key' }] }, 401),
    })
    const execution = await executeWebSearch({ query: 'q' }, { tavily })
    expect(execution.status).toBe('degraded')
    expect(execution.reason).toContain('Tavily /search 失败')
    expect(execution.blocks).toEqual([
      { type: 'search_step', step: 1, action: 'search', query: 'q', status: 'error', detail: execution.reason },
    ])
  })

  it('能力级入口(直执行路径):request → 内部优先 + Tavily 聚合', async () => {
    const trace: CallTrace[] = []
    const tavily = new TavilyClient({
      apiKey: 'k',
      fetchImpl: async (url) => {
        trace.push({ kind: 'tavily-fetch', detail: url })
        return jsonResponse(TAVILY_SEARCH_OK)
      },
    })
    const request = createCapabilityRequest('web_search', { query: '契约参数路径' })
    const outcome = await runGenericCapability(request, {
      internal: async (query) => {
        trace.push({ kind: 'internal', detail: query })
        return { ok: true, payload: { count: 0 } }
      },
      tavily,
    })
    expect(trace.map(item => item.kind)).toEqual(['internal', 'tavily-fetch'])
    expect(outcome.status).toBe('ok')
    expect(outcome.blocks).toHaveLength(3) // 步骤 + 两来源卡
  })
})

describe('R6 · Tavily 归一化纯函数', () => {
  it('results → SourceBlocks:score 降序、published_date 归一化/null 保留、favicon→icon', () => {
    const blocks = tavilyResultsToSourceBlocks(TAVILY_SEARCH_OK.results ?? [])
    expect(blocks.map(block => block.title)).toEqual(['结果乙', '结果甲'])
    expect(blocks.every(block => !('score' in block))).toBe(true)
    expect(blocks[0]?.publishTime).toBeNull()
    expect(blocks[1]?.publishTime).toBe('2025-03-11T17:00:00.000Z')
  })
})
