/**
 * K4.2 逐能力探活测试(36 号 §3 表验收门禁 = 33 号 G2-B4 doctor 半):
 * 各路径最小请求构造与三态判定(ok/fail/unprobed)——fetch 注入 mock,断言实际发出的
 * URL/方法/头/体(真凭据探活为部署期行为,不在测试内发真请求)。
 * 借用链覆盖(29 §2.4):borrow 路径探活出借方 wire 路由,lender 凭据/baseURL 生效。
 * GLM 流式 web_search 回流观测(29a R1 unresolved-①):SSE mock 断言三形态。
 * 网关端点 probe-capability:与 probeModel 同源的 configEditor 路由解析 + 委派。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { ENDPOINTS, LlmDoctorGateway, PI_AI_ENTRY_ID, probeCapability } from '../src/index.ts'
import type { CapabilityProbePath, CapabilityProbeResult } from '../src/index.ts'
import type { ConfigEditorFace } from '../src/index.ts'
import { joinEndpoint } from '../src/capability-probe.ts'
import type { CapabilityProbeDeps, CapabilityProbeInput } from '../src/capability-probe.ts'
import type { FetchLike, ProviderRouteConfig } from '../src/doctor.ts'

// ---------------------------------------------------------------------------
// mock 基建(记录请求 + 按 URL 回放响应)
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

function makeDeps(
  handler: (url: string) => { status: number; body: string },
  env: Record<string, string> = { DEEPSEEK_KEY: 'ds-secret', GLM_KEY: 'glm-secret', MIMO_KEY: 'mimo-secret', TAVILY_KEY: 'tvly-secret' },
): { deps: CapabilityProbeDeps; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
    })
    const canned = handler(url)
    return new Response(canned.body, { status: canned.status, headers: { 'content-type': 'application/json' } })
  }
  return { deps: { fetchImpl, resolveApiKey: name => (name === undefined ? undefined : env[name]) }, calls }
}

const ROUTES: Record<string, ProviderRouteConfig> = {
  deepseek: { api: 'openai-completions', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_KEY', models: [{ id: 'deepseek-flash' }] },
  glm: { api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'GLM_KEY', models: [{ id: 'glm-4.6' }] },
  mimo: { api: 'openai-completions', baseURL: 'https://api.xiaomimimo.com/v1', apiKeyEnv: 'MIMO_KEY', models: [{ id: 'mimo-v2.6-pro' }] },
  generic: { api: 'openai-completions', baseURL: 'https://gw.example/v1', apiKeyEnv: 'GENERIC_KEY', models: [{ id: 'third-party-chat' }] },
}

function input(path: CapabilityProbePath, overrides: Partial<CapabilityProbeInput> = {}): CapabilityProbeInput {
  return { path, routes: ROUTES, ...overrides }
}

// ---------------------------------------------------------------------------
// 端点 URL 拼接(chat baseURL 惯例 × 独立端点根相对路径)
// ---------------------------------------------------------------------------

describe('joinEndpoint(baseURL 惯例归并)', () => {
  it('deepseek:带 /v1 的 chat base + /v1/tools/search 不重复 /v1', () => {
    expect(joinEndpoint('https://api.deepseek.com/v1', '/v1/tools/search')).toBe('https://api.deepseek.com/v1/tools/search')
  })
  it('deepseek:不带 /v1 的 base 原样拼根相对端点', () => {
    expect(joinEndpoint('https://api.deepseek.com', '/v1/tools/search')).toBe('https://api.deepseek.com/v1/tools/search')
  })
  it('glm:带 /paas/v4 的 chat base + /paas/v4/web_search 不重复 /paas/v4', () => {
    expect(joinEndpoint('https://open.bigmodel.cn/api/paas/v4', '/paas/v4/web_search')).toBe('https://open.bigmodel.cn/api/paas/v4/web_search')
  })
  it('glm:server 根 base(/api)原样拼', () => {
    expect(joinEndpoint('https://open.bigmodel.cn/api', '/paas/v4/web_search')).toBe('https://open.bigmodel.cn/api/paas/v4/web_search')
  })
  it('无重叠时直接拼接;尾斜杠规范化', () => {
    expect(joinEndpoint('http://gw:4000/', '/v1/tools/fetch')).toBe('http://gw:4000/v1/tools/fetch')
  })
})

// ---------------------------------------------------------------------------
// 三态判定基线
// ---------------------------------------------------------------------------

describe('三态判定基线', () => {
  it('unavailable 路径 → unprobed(无路径不假装探活;reason 透传)', async () => {
    const { deps } = makeDeps(() => ({ status: 200, body: '{}' }))
    const result = await probeCapability(input({
      capability: 'web_search', route: 'unavailable', adapter: 'none',
      reason: '未配置 Tavily 且无原生/借用 web_search 可用——显式降级(29 §7-1)',
    }), deps)
    expect(result.verdict).toBe('unprobed')
    expect(result.detail).toContain('29 §7-1')
    expect(result.latencyMs).toBe(0)
  })

  it('未拍板探活形态的适配器 → unprobed,不发明行为', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{}' }))
    const result = await probeCapability(input({ capability: 'files', route: 'native', adapter: 'deepseek-files-api', provider: 'deepseek', model: 'deepseek-flash' }), deps)
    expect(result.verdict).toBe('unprobed')
    expect(calls).toHaveLength(0)
  })

  it('网络错误(fetch 抛错)→ fail 而非 unprobed(路径已配置,验证失败)', async () => {
    const deps: CapabilityProbeDeps = {
      fetchImpl: async () => { throw new Error('network down') },
      resolveApiKey: () => 'k',
    }
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'deepseek-server-tools', provider: 'deepseek', model: 'deepseek-flash' }), deps)
    expect(result.verdict).toBe('fail')
    expect(result.detail).toContain('network down')
  })
})

// ---------------------------------------------------------------------------
// deepseek 端点族:web_search→/v1/tools/search、read_url→/v1/tools/fetch(R4)
// ---------------------------------------------------------------------------

describe('deepseek 路径最小请求(R4)', () => {
  it('原生 web_search:POST /v1/tools/search 体 {query},Bearer 出借方/本方凭据,2xx=ok', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"results":[]}' }))
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'deepseek-server-tools', provider: 'deepseek', model: 'deepseek-flash' }), deps)
    expect(result.verdict).toBe('ok')
    expect(result.request).toMatchObject({ method: 'POST', url: 'https://api.deepseek.com/v1/tools/search' })
    expect(result.request?.body).toBe(JSON.stringify({ query: 'ping' }))
    expect(calls[0]?.headers['authorization']).toBe('Bearer ds-secret')
  })

  it('原生 read_url:POST /v1/tools/fetch 体 {url}(官方 api/fetch 页:仅 url 必填)', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"title":"t","content":"c"}' }))
    const result = await probeCapability(input({ capability: 'read_url', route: 'native', adapter: 'deepseek-server-tools', provider: 'deepseek', model: 'deepseek-flash' }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/tools/fetch')
    expect(calls[0]?.body).toEqual({ url: 'https://example.com' })
  })

  it('非 2xx(401)→ fail 且 detail 含响应摘录', async () => {
    const { deps } = makeDeps(() => ({ status: 401, body: '{"error":{"code":"invalid_api_key","message":"Invalid API key"}}' }))
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'deepseek-tools-api', provider: 'deepseek' }), deps)
    expect(result.verdict).toBe('fail')
    expect(result.detail).toContain('Invalid API key')
  })
})

// ---------------------------------------------------------------------------
// 借用链覆盖(29 §2.4:borrow 路径探活出借方 wire 路由)
// ---------------------------------------------------------------------------

describe('借用链探活(29 §2.4「覆盖整条借用链」)', () => {
  it('档 A 借用(deepseek-tools-api,lender=deepseek):对出借方端点发最小请求,凭据=出借方', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"results":[]}' }))
    const result = await probeCapability(input({
      capability: 'web_search', route: 'borrow', adapter: 'deepseek-tools-api',
      lender: 'deepseek', borrowMode: 'direct-endpoint', endpoint: '/v1/tools/search',
    }), deps)
    expect(result.verdict).toBe('ok')
    expect(result.lender).toBe('deepseek')
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(calls[0]?.headers['authorization']).toBe('Bearer ds-secret')
  })

  it('档 B 借用(mimo-chat-web-search,lender=mimo):最小 chat 用矩阵解析出的出借方模型', async () => {
    const { deps, calls } = makeDeps(() => ({
      status: 200,
      body: '{"choices":[{"message":{"role":"assistant","content":"ok","annotations":[]}}]}',
    }))
    const result = await probeCapability(input({
      capability: 'web_search', route: 'borrow', adapter: 'mimo-chat-web-search',
      lender: 'mimo', borrowMode: 'minimal-chat', model: 'mimo-v2.6-pro',
    }), deps)
    expect(result.verdict).toBe('ok')
    expect(result.lender).toBe('mimo')
    expect(calls[0]?.url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(calls[0]?.body).toMatchObject({ model: 'mimo-v2.6-pro', tool_choice: 'auto' })
    expect((calls[0]?.body as { tools: unknown[] }).tools).toEqual([{ type: 'web_search' }])
    expect(calls[0]?.headers['authorization']).toBe('Bearer mimo-secret')
  })

  it('glm 借用(glm-web-search-api):/paas/v4/web_search 三必填体,出借方凭据', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"search_result":[]}' }))
    const result = await probeCapability(input({
      capability: 'web_search', route: 'borrow', adapter: 'glm-web-search-api',
      lender: 'glm', borrowMode: 'direct-endpoint', endpoint: '/paas/v4/web_search',
    }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/web_search')
    expect(calls[0]?.body).toEqual({ search_query: 'ping', search_engine: 'search_std', search_intent: false })
    expect(calls[0]?.headers['authorization']).toBe('Bearer glm-secret')
  })

  it('出借方 wire 路由缺席 → unprobed(无法构造请求,如实标注)', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{}' }))
    const result = await probeCapability({
      path: { capability: 'web_search', route: 'borrow', adapter: 'glm-web-search-api', lender: 'glm', borrowMode: 'direct-endpoint' },
      routes: { deepseek: ROUTES['deepseek']! },
    }, deps)
    expect(result.verdict).toBe('unprobed')
    expect(result.detail).toContain('glm')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// glm 原生:独立端点最小请求 + 流式回流观测(29a R1 unresolved-①)
// ---------------------------------------------------------------------------

describe('glm 原生 web_search(R1 + unresolved-① 流式观测)', () => {
  const SSE_FOUND = [
    'data: {"id":"c1","choices":[{"delta":{"content":"a"}}]}',
    'data: {"id":"c1","web_search":[{"title":"t","link":"https://example.com","refer":"ref_1"}],"choices":[{"delta":{}}]}',
    'data: [DONE]',
  ].join('\n')
  const SSE_NOT_FOUND = [
    'data: {"id":"c2","choices":[{"delta":{"content":"b"}}]}',
    'data: [DONE]',
  ].join('\n')

  it('主探活=/paas/v4/web_search 三必填体;附一次流式真调,chunk 顶层含 web_search → 观测到', async () => {
    const { deps, calls } = makeDeps(url =>
      url.endsWith('/paas/v4/web_search') ? { status: 200, body: '{"search_result":[]}' } : { status: 200, body: SSE_FOUND },
    )
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'glm-chat-web-search', provider: 'glm', model: 'glm-4.6' }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/web_search')
    expect(calls[1]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(calls[1]?.body).toMatchObject({ model: 'glm-4.6', stream: true, tool_choice: 'auto' })
    expect(result.glmStreamBackflow).toMatchObject({ observed: 'top-level-web-search-in-chunk', chunkCount: 2 })
  })

  it('流式完成但无 web_search 字段 → no-web-search-in-chunks(维持「chunk 无该字段」设计)', async () => {
    const { deps } = makeDeps(url =>
      url.endsWith('/paas/v4/web_search') ? { status: 200, body: '{"search_result":[]}' } : { status: 200, body: SSE_NOT_FOUND },
    )
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'glm-chat-web-search', provider: 'glm', model: 'glm-4.6' }), deps)
    expect(result.verdict).toBe('ok')
    expect(result.glmStreamBackflow?.observed).toBe('no-web-search-in-chunks')
    expect(result.glmStreamBackflow?.chunkCount).toBe(1)
  })

  it('流式调用失败(500)→ stream-failed,不影响主探活结论(独立端点 200=ok)', async () => {
    const { deps } = makeDeps(url =>
      url.endsWith('/paas/v4/web_search') ? { status: 200, body: '{"search_result":[]}' } : { status: 500, body: '{"error":{"code":"1702","message":"no engine"}}' },
    )
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'glm-chat-web-search', provider: 'glm', model: 'glm-4.6' }), deps)
    expect(result.verdict).toBe('ok')
    expect(result.glmStreamBackflow?.observed).toBe('stream-failed')
  })

  it('glm-reader 原生:POST /paas/v4/reader 体 {url}(R1:读网只能走此端点)', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"reader_result":{"content":"x"}}' }))
    const result = await probeCapability(input({ capability: 'read_url', route: 'native', adapter: 'glm-reader', provider: 'glm', model: 'glm-4.6' }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/reader')
    expect(calls[0]?.body).toEqual({ url: 'https://example.com' })
  })
})

// ---------------------------------------------------------------------------
// MiMo 路径(R2:tool_choice 降级 auto;web_search 仅 OpenAI Chat 协议)
// ---------------------------------------------------------------------------

describe('MiMo 路径最小请求(R2)', () => {
  it('原生 web_search:单轮 + web_search 声明 + tool_choice=auto,合法响应=ok', async () => {
    const { deps, calls } = makeDeps(() => ({
      status: 200,
      body: '{"choices":[{"message":{"role":"assistant","content":"ok","annotations":[{"type":"url_citation","url":"https://example.com"}]}}]}',
    }))
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'mimo-chat-web-search', provider: 'mimo', model: 'mimo-v2.6-flash' }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.body).toMatchObject({ model: 'mimo-v2.6-flash', tool_choice: 'auto' })
  })

  it('message.error_message 承载链路错误(R2)→ fail', async () => {
    const { deps } = makeDeps(() => ({
      status: 200,
      body: '{"choices":[{"message":{"role":"assistant","content":"","error_message":"plugin not enabled"}}]}',
    }))
    const result = await probeCapability(input({ capability: 'web_search', route: 'native', adapter: 'mimo-chat-web-search', provider: 'mimo', model: 'mimo-v2.6-flash' }), deps)
    expect(result.verdict).toBe('fail')
    expect(result.detail).toContain('plugin not enabled')
  })

  it('路由协议非 openai-completions → unprobed(web_search 仅 OpenAI Chat 协议,R2)', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{}' }))
    const result = await probeCapability({
      path: { capability: 'web_search', route: 'native', adapter: 'mimo-chat-web-search', provider: 'mimo', model: 'mimo-v2.6-flash' },
      routes: { mimo: { api: 'anthropic-messages', baseURL: 'https://api.xiaomimimo.com/anthropic', models: [{ id: 'mimo-v2.6-flash' }] } },
    }, deps)
    expect(result.verdict).toBe('unprobed')
    expect(result.detail).toContain('OpenAI Chat')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// generic/兼容供应商路径(R3:1 function 工具 + tool_choice:"required" + 单轮)
// ---------------------------------------------------------------------------

describe('generic function calling 冒烟(R3 三段:声明/解析/回灌)', () => {
  const TOOL_CALLS_BODY = JSON.stringify({
    choices: [{ message: { role: 'assistant', content: '', tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'probe_capability_ping', arguments: '{"query":"ping"}' } },
    ] } }],
  })

  /** generic 探活请求体断言面。 */
  interface GenericProbeBody {
    readonly model: string
    readonly tool_choice: string
    readonly messages: readonly unknown[]
    readonly tools: readonly {
      readonly type: string
      readonly function: { readonly name: string }
    }[]
  }

  it('files 兜底路径:单轮 + 1 个 function 工具 + tool_choice=required,收到合法 tool_calls=ok', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: TOOL_CALLS_BODY }))
    const result = await probeCapability(input({ capability: 'files', route: 'fallback', adapter: 'generic-function-loop', provider: 'generic' }), deps)
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://gw.example/v1/chat/completions')
    const body = calls[0]?.body as GenericProbeBody
    expect(body.tool_choice).toBe('required')
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0]?.type).toBe('function')
    expect(body.tools[0]?.function.name).toBe('probe_capability_ping')
    expect(body.messages).toHaveLength(1)
    // path.model 缺省时取 generic 路由首个模型。
    expect(body.model).toBe('third-party-chat')
  })

  it('2xx 但无 tool_calls(模型直答)→ fail(声明/解析冒烟未通过)', async () => {
    const { deps } = makeDeps(() => ({ status: 200, body: '{"choices":[{"message":{"role":"assistant","content":"直接回答"}}]}' }))
    const result = await probeCapability(input({ capability: 'files', route: 'fallback', adapter: 'generic-function-loop', provider: 'generic', model: 'third-party-chat' }), deps)
    expect(result.verdict).toBe('fail')
    expect(result.detail).toContain('tool_calls')
  })

  it('genericRouteKey 指定实际承载路由(缺省 generic 键缺席时显式指名)', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: TOOL_CALLS_BODY }))
    const result = await probeCapability(
      input({ capability: 'files', route: 'fallback', adapter: 'generic-function-loop', provider: 'generic' }, { genericRouteKey: 'mimo' }),
      deps,
    )
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
  })
})

// ---------------------------------------------------------------------------
// Tavily 兜底:验证其配置(GET /usage,R6)
// ---------------------------------------------------------------------------

describe('Tavily 兜底配置验证(R6)', () => {
  it('GET /usage + Bearer tvly- 前缀补全;2xx=ok', async () => {
    const { deps, calls } = makeDeps(() => ({ status: 200, body: '{"key":{"usage":12}}' }))
    const result = await probeCapability(
      input({ capability: 'web_search', route: 'fallback', adapter: 'tavily-search', provider: 'tavily' }, { tavily: { apiKeyEnv: 'TAVILY_KEY' } }),
      deps,
    )
    expect(result.verdict).toBe('ok')
    expect(calls[0]?.url).toBe('https://api.tavily.com/usage')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers['authorization']).toBe('Bearer tvly-secret')
  })

  it('tavily-extract(read_url 兜底)同验证其配置(同一 key/账号)', async () => {
    const { deps } = makeDeps(() => ({ status: 200, body: '{}' }))
    const result = await probeCapability(
      input({ capability: 'read_url', route: 'fallback', adapter: 'tavily-extract', provider: 'tavily' }, { tavily: { apiKeyEnv: 'TAVILY_KEY' } }),
      deps,
    )
    expect(result.verdict).toBe('ok')
  })

  it('兜底配置缺席 → unprobed;key 环境变量缺席 → fail(配置验证失败)', async () => {
    const absent = makeDeps(() => ({ status: 200, body: '{}' }))
    const noTavily = await probeCapability(input({ capability: 'web_search', route: 'fallback', adapter: 'tavily-search', provider: 'tavily' }), absent.deps)
    expect(noTavily.verdict).toBe('unprobed')
    const badKey = makeDeps(() => ({ status: 200, body: '{}' }), { TAVILY_KEY: '' })
    const keyFail = await probeCapability(
      input({ capability: 'web_search', route: 'fallback', adapter: 'tavily-search', provider: 'tavily' }, { tavily: { apiKeyEnv: 'TAVILY_KEY' } }),
      badKey.deps,
    )
    expect(keyFail.verdict).toBe('fail')
    expect(keyFail.detail).toContain('TAVILY_KEY')
  })

  it('401(无效 key)→ fail 且 detail 含错误体摘录', async () => {
    const { deps } = makeDeps(() => ({ status: 401, body: '{"detail":"Invalid API key"}' }))
    const result = await probeCapability(
      input({ capability: 'web_search', route: 'fallback', adapter: 'tavily-search', provider: 'tavily' }, { tavily: { apiKeyEnv: 'TAVILY_KEY' } }),
      deps,
    )
    expect(result.verdict).toBe('fail')
    expect(result.detail).toContain('Invalid API key')
  })
})

// ---------------------------------------------------------------------------
// 网关端点:llmDoctor/probe-capability(SRC;与 probeModel 同源路由解析)
// ---------------------------------------------------------------------------

describe('网关端点 probe-capability', () => {
  function editorWithProviders(providers: Record<string, ProviderRouteConfig>): ConfigEditorFace {
    const rows = [{ id: PI_AI_ENTRY_ID, override: { providers } }]
    const entries = rows.map(row => ({ options: { id: row.id } }))
    return {
      entries: () => entries,
      configuration: () => rows.map((row, index) => ({ entry: entries[index], override: row.override })),
      edit: async () => { throw new Error('探活不写回') },
    }
  }

  it('ENDPOINTS 字符串与 SRC marker 注册', () => {
    const context = new Context()
    const gateway = new LlmDoctorGateway(context)
    const names = remoteMethods(gateway).map(method => method.exportName ?? method.method)
    expect(names).toContain('probe-capability')
    expect(ENDPOINTS.probeCapability).toBe('llmDoctor/probe-capability')
  })

  it('委派纯判定层:borrow 路径经承载行路由探活出借方,凭据按 apiKeyEnv 解析', async () => {
    const context = new Context()
    context.provide('configEditor', editorWithProviders(ROUTES))
    const gateway = new LlmDoctorGateway(context)
    gateway.fetchImpl = async () => new Response('{"results":[]}', { status: 200 })
    const result: CapabilityProbeResult = await gateway.probeCapabilityPath({
      path: { capability: 'web_search', route: 'borrow', adapter: 'deepseek-tools-api', lender: 'deepseek', borrowMode: 'direct-endpoint', endpoint: '/v1/tools/search' },
    })
    expect(result.verdict).toBe('ok')
    expect(result.lender).toBe('deepseek')
    expect(result.request?.url).toBe('https://api.deepseek.com/v1/tools/search')
  })

  it('结构化失败分支:path 缺席 / configEditor 缺席 → unprobed 带 detail', async () => {
    const context = new Context()
    const gateway = new LlmDoctorGateway(context)
    const missingPath = await gateway.probeCapabilityPath({})
    expect(missingPath.verdict).toBe('unprobed')
    expect(missingPath.detail).toContain('input.path')
    const missingEditor = await gateway.probeCapabilityPath({
      path: { capability: 'web_search', route: 'native', adapter: 'glm-chat-web-search', provider: 'glm', model: 'glm-4.6' },
    })
    expect(missingEditor.verdict).toBe('unprobed')
    expect(missingEditor.detail).toContain('configEditor')
  })
})
