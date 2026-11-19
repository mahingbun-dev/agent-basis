/**
 * K3.3 MiMo 适配器单测(36 号 §3 表验收门禁;字段级依据 29a R2):
 * - annotations→source/citation 映射:url/title/summary/site_name/publish_time(归一化)/
 *   logo_url→icon 全字段 + 同 URL 去重 + 未知 annotation type 跳过;
 * - 契约 tool_choice required/嵌套指定/none → 降级 auto(29a R2 修正行:全协议仅 auto);
 * - reasoning_content 保存与多轮回灌往返断言(缺失回传即 400 场景防回归——thinking 硬约束);
 * - message.error_message 承载链路错误;usage.web_search_usage 记账(禁入键不进块,G2-B3 联动);
 * - 流式:首包返回全部搜索来源(29a R2)、reasoning_content 与 content 分别累计、
 *   三终结([DONE]/error 帧/无标记中断,R3 OpenAI 兼容面同规);
 * - 开关 5 分钟缓存与「联网服务插件」开通前置等部署事实常量(K4.2 探活消费)。
 */
import { describe, expect, it } from 'vitest'
import {
  MIMO_DEFAULT_THINKING,
  MIMO_THINKING_SAMPLING,
  MIMO_WEB_SEARCH_MODELS,
  MIMO_WEB_SEARCH_PREREQUISITE,
  MIMO_WEB_SEARCH_SWITCH_CACHE_MS,
  MimoRequestError,
  MimoResponseError,
  assertMimoReasoningRoundTrip,
  buildMimoChatRequest,
  collectMimoChatStream,
  createMimoConversation,
  mimoAnnotationsToBlocks,
  parseMimoChatResponse,
  toMimoUserMessage,
  toMimoWebSearchTool,
} from '../../src/adapters/mimo/chat.ts'
import type { MimoChatMessage, MimoChatResponse, MimoUrlCitation } from '../../src/adapters/mimo/chat.ts'
import type { GenericFunctionTool } from '../../src/router/translate.ts'
import { findBlockLeaks, serializeBlocks } from '../../src/blocks/index.ts'

// ---------------------------------------------------------------------------
// fixture 构造(照 29a R2 结论表字段形态;36 §1.9:fixture 回放为门禁主体)
// ---------------------------------------------------------------------------

/** fixture 覆盖位(显式 undefined=字段缺省;exactOptionalPropertyTypes 兼容)。 */
type CitationOver = {
  readonly url?: string | null | undefined
  readonly title?: string | null | undefined
  readonly summary?: string | null | undefined
  readonly site_name?: string | null | undefined
  readonly publish_time?: string | null | undefined
  readonly logo_url?: string | null | undefined
}

const citation = (over: CitationOver = {}): MimoUrlCitation => ({
  type: 'url_citation',
  url: over.url !== undefined && over.url !== null ? over.url : 'https://example.com/venue-guide',
  title: over.title === undefined ? '场地选址指南' : over.title,
  summary: over.summary === undefined ? '活动策划中的场地选址要素与档期核对清单。' : over.summary,
  site_name: over.site_name === undefined ? 'example.com' : over.site_name,
  publish_time: over.publish_time === undefined ? '2026-10-12T08:00:00Z' : over.publish_time,
  logo_url: over.logo_url === undefined ? 'https://example.com/logo.png' : over.logo_url,
})

const functionTool = (name = 'knowledge_search'): GenericFunctionTool => ({
  type: 'function',
  function: { name, description: '内部知识检索', parameters: { type: 'object', properties: {} } },
})

const webSearchResponse = (over: {
  annotations?: readonly MimoUrlCitation[]
  errorMessage?: string | null
  webSearchUsage?: { tool_usage?: number; page_usage?: number }
  toolCalls?: MimoChatMessage['tool_calls']
} = {}): MimoChatResponse => ({
  choices: [{
    message: {
      role: 'assistant',
      content: '推荐参考以下来源。',
      reasoning_content: '用户要场地指南,先搜索再归纳。',
      ...(over.toolCalls !== undefined ? { tool_calls: over.toolCalls } : {}),
      ...(over.annotations !== undefined ? { annotations: over.annotations } : {}),
      ...(over.errorMessage !== undefined ? { error_message: over.errorMessage } : {}),
    },
    finish_reason: 'stop',
  }],
  ...(over.webSearchUsage !== undefined
    ? { usage: { web_search_usage: over.webSearchUsage } }
    : {}),
})

describe('组装侧:web_search 声明与 tool_choice 降级(29a R2)', () => {
  it('契约参数 → {type:"web_search"} 声明:count→limit(待实测);engine/domainFilter/recency/contentSize 无对位如实丢弃', () => {
    expect(toMimoWebSearchTool({ query: '场地选址' })).toEqual({ type: 'web_search' })
    expect(toMimoWebSearchTool({ query: '场地选址', count: 5 })).toEqual({ type: 'web_search', limit: 5 })
    // count 缺省不虚构默认 limit(29a R2 unresolved-③/O-12:limit 语义与默认值待实测/探活回填)。
    const translated = toMimoWebSearchTool({
      query: '场地选址',
      engine: 'search_pro',
      domainFilter: ['example.com'],
      recency: 'oneWeek',
      contentSize: 'high',
      count: 8,
    })
    expect(translated).toEqual({ type: 'web_search', limit: 8 })
    expect(JSON.stringify(translated)).not.toContain('search_engine')
    expect(JSON.stringify(translated)).not.toContain('search_domain_filter')
  })

  it('query 进本轮用户消息(搜索由服务端按对话自主触发,29a R2)', () => {
    expect(toMimoUserMessage({ query: '场地选址' })).toEqual({ role: 'user', content: '场地选址' })
  })

  it('tool_choice required/嵌套指定/none → 一律降级 auto(全协议仅 auto;非 auto 值被后端移除)', () => {
    for (const toolChoice of [
      'auto',
      'required',
      'none',
      { type: 'function', function: { name: 'knowledge_search' } },
    ]) {
      const request = buildMimoChatRequest({
        model: 'mimo-v2.6-pro',
        messages: [{ role: 'user', content: '场地选址' }],
        webSearch: { query: '场地选址' },
        toolChoice,
      })
      expect(request.tool_choice, `tool_choice=${JSON.stringify(toolChoice)} 须降级 auto`).toBe('auto')
      expect(request.tools).toEqual([{ type: 'web_search' }])
    }
  })

  it('web_search 与 function 工具可同传;未声明 tools 则不带 tool_choice;function 名过命名规范', () => {
    const request = buildMimoChatRequest({
      model: 'mimo-v2.6-flash',
      messages: [{ role: 'user', content: '查内部知识并联网核对' }],
      webSearch: { query: '核对' },
      functionTools: [functionTool()],
    })
    expect(request.tools).toEqual([{ type: 'web_search' }, functionTool()])
    const bare = buildMimoChatRequest({ model: 'mimo-v2.6-flash', messages: [{ role: 'user', content: '你好' }] })
    expect(bare.tools).toBeUndefined()
    expect(bare.tool_choice).toBeUndefined()
    expect(() =>
      buildMimoChatRequest({
        model: 'mimo-v2.6-flash',
        messages: [{ role: 'user', content: '你好' }],
        functionTools: [functionTool('bad name!')],
      }),
    ).toThrow(/命名规范/)
  })

  it('thinking 仅显式传入才发送(V2.6 服务端默认 enabled,29a R2)', () => {
    expect(buildMimoChatRequest({ model: 'mimo-v2.6-pro', messages: [{ role: 'user', content: '你好' }] }).thinking).toBeUndefined()
    expect(
      buildMimoChatRequest({
        model: 'mimo-v2.6-pro',
        messages: [{ role: 'user', content: '你好' }],
        thinking: { type: 'disabled' },
      }).thinking,
    ).toEqual({ type: 'disabled' })
  })

  it('请求禁入键深检(function parameters 内 strict 命中即拒,29a R3/R2)', () => {
    const strictTool: GenericFunctionTool = {
      type: 'function',
      function: { name: 't', description: 'd', parameters: { type: 'object', properties: {}, strict: true } },
    }
    expect(() =>
      buildMimoChatRequest({
        model: 'mimo-v2.6-pro',
        messages: [{ role: 'user', content: '你好' }],
        functionTools: [strictTool],
      }),
    ).toThrow(/禁入键/)
  })
})

describe('回流解析:annotations[].url_citation → source/citation(29a R2 修正行——不是 tool_calls)', () => {
  it('全字段映射:url/title/summary/site_name/publish_time(归一化)/logo_url→icon', () => {
    const result = parseMimoChatResponse(webSearchResponse({
      annotations: [citation()],
      webSearchUsage: { tool_usage: 2, page_usage: 8 },
    }))
    expect(result.blocks).toEqual([
      {
        type: 'source',
        title: '场地选址指南',
        url: 'https://example.com/venue-guide',
        summary: '活动策划中的场地选址要素与档期核对清单。',
        publishTime: '2026-10-12T08:00:00.000Z',
        siteName: 'example.com',
        icon: 'https://example.com/logo.png',
      },
      { type: 'citation', index: 1, sourceIndex: 0 },
    ])
    // 结果不是 tool_calls:annotations 回流位与 function 调用互不影响(29a R2)。
    expect(result.toolCalls).toEqual([])
    expect(result.content).toBe('推荐参考以下来源。')
    expect(result.reasoningContent).toBe('用户要场地指南,先搜索再归纳。')
  })

  it('可选字段缺失不虚构:site_name/logo_url 省略、publish_time 缺省为 null、title 缺省以 url 占位', () => {
    const bare: MimoUrlCitation = {
      type: 'url_citation',
      url: 'https://example.com/venue-guide',
      summary: '活动策划中的场地选址要素与档期核对清单。',
    }
    const blocks = mimoAnnotationsToBlocks([bare])
    expect(blocks).toEqual([
      {
        type: 'source',
        title: 'https://example.com/venue-guide',
        url: 'https://example.com/venue-guide',
        summary: '活动策划中的场地选址要素与档期核对清单。',
        publishTime: null,
      },
      { type: 'citation', index: 1, sourceIndex: 0 },
    ])
  })

  it('同 URL 去重:两条角标 → 一张来源卡,两个角标同指 sourceIndex(角标序号=来源序号)', () => {
    const blocks = mimoAnnotationsToBlocks([
      citation(),
      citation({ summary: '同源第二次引用。' }),
      citation({ url: 'https://example.com/backup', title: '备选场地' }),
    ])
    expect(blocks.filter(block => block.type === 'source')).toHaveLength(2)
    expect(blocks.filter(block => block.type === 'citation')).toEqual([
      { type: 'citation', index: 1, sourceIndex: 0 },
      { type: 'citation', index: 1, sourceIndex: 0 },
      { type: 'citation', index: 2, sourceIndex: 1 },
    ])
  })

  it('未知 annotation type 与缺 url 的条目跳过(不虚构映射)', () => {
    const blocks = mimoAnnotationsToBlocks([
      { type: 'other_citation', url: 'https://example.com/x' } as unknown as MimoUrlCitation,
      citation({ url: '' }),
      citation(),
    ])
    expect(blocks).toEqual([
      expect.objectContaining({ type: 'source', url: 'https://example.com/venue-guide' }),
      { type: 'citation', index: 1, sourceIndex: 0 },
    ])
  })

  it('message.error_message 承载链路错误 → webSearchError(显式承载,不静默)', () => {
    const result = parseMimoChatResponse(webSearchResponse({ annotations: [citation()], errorMessage: '联网搜索链路失败' }))
    expect(result.webSearchError).toBe('联网搜索链路失败')
    expect(result.blocks).toHaveLength(2) // 搜索来源仍按回流如实产出
  })

  it('usage.web_search_usage → searchUsage 记账(适配器内部消耗;禁入键不进块)', () => {
    const result = parseMimoChatResponse(webSearchResponse({
      annotations: [citation()],
      webSearchUsage: { tool_usage: 3, page_usage: 11 },
    }))
    expect(result.searchUsage).toEqual({ toolUsage: 3, pageUsage: 11 })
    expect(findBlockLeaks(result.blocks)).toEqual([])
    expect(() => serializeBlocks(result.blocks)).not.toThrow()
    expect(JSON.stringify(result.blocks)).not.toContain('web_search_usage')
  })

  it('顶层 error → MimoResponseError(显式抛出,绝不静默)', () => {
    expect(() => parseMimoChatResponse({ error: { message: 'invalid request' } })).toThrow(MimoResponseError)
  })
})

describe('thinking 硬约束:reasoning_content 另存与多轮回灌(29a R2 thinking 行+修正行)', () => {
  const toolCall = { id: 'call-1', type: 'function' as const, function: { name: 'knowledge_search', arguments: '{"query":"场地"}' } }

  it('会话存储:保存每轮 reasoning_content,回灌序列对含 tool_calls 的 assistant 消息原样携带', () => {
    const conversation = createMimoConversation()
    conversation.pushUser('场地选址')
    conversation.pushAssistant({ content: null, reasoningContent: '先查内部知识。', toolCalls: [toolCall] })
    conversation.pushToolResult('call-1', '{"hits":2}')
    const messages = conversation.messages()
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [toolCall],
      reasoning_content: '先查内部知识。',
    })
    // 往返断言:保存的消息序列可直接组装请求(400 防回归面)。
    expect(() =>
      buildMimoChatRequest({ model: 'mimo-v2.6-pro', messages, webSearch: { query: '场地' } }),
    ).not.toThrow()
  })

  it('无 tool_calls 的 assistant 回合不携带 reasoning_content(规则以 tool_calls 为条件,不发明额外行为)', () => {
    const conversation = createMimoConversation()
    conversation.pushAssistant({ content: '答案', reasoningContent: '推理' })
    expect(conversation.messages()).toEqual([{ role: 'assistant', content: '答案' }])
  })

  it('含 tool_calls 的 assistant 消息缺 reasoning_content → 静态拒绝(V2.6 默认 enabled,缺失回传即 400 防回归)', () => {
    const messages: readonly MimoChatMessage[] = [
      { role: 'user', content: '场地选址' },
      { role: 'assistant', content: null, tool_calls: [toolCall] },
    ]
    expect(() => { assertMimoReasoningRoundTrip(messages) }).toThrow(MimoRequestError)
    expect(() => { assertMimoReasoningRoundTrip(messages) }).toThrow(/reasoning_content/)
    expect(() =>
      buildMimoChatRequest({ model: 'mimo-v2.6-pro', messages, webSearch: { query: '场地' } }),
    ).toThrow(MimoRequestError)
  })

  it('thinking 显式 disabled 时该规则前提(深度思考)不成立,不强制', () => {
    const messages: readonly MimoChatMessage[] = [
      { role: 'assistant', content: null, tool_calls: [toolCall] },
    ]
    expect(() => { assertMimoReasoningRoundTrip(messages, { type: 'disabled' }) }).not.toThrow()
    expect(() =>
      buildMimoChatRequest({
        model: 'mimo-v2.6-pro',
        messages,
        thinking: { type: 'disabled' },
      }),
    ).not.toThrow()
  })

  it('响应产物可直接喂回会话存储(parseMimoChatResponse → pushAssistant)', () => {
    const result = parseMimoChatResponse(webSearchResponse({ toolCalls: [toolCall] }))
    const conversation = createMimoConversation()
    conversation.pushUser('场地选址')
    conversation.pushAssistant({
      content: result.content,
      reasoningContent: result.reasoningContent,
      toolCalls: result.toolCalls,
    })
    expect(() =>
      buildMimoChatRequest({ model: 'mimo-v2.6-pro', messages: conversation.messages(), webSearch: { query: '场地' } }),
    ).not.toThrow()
  })
})

describe('流式:首包返回全部搜索来源 + reasoning_content 先于 content + 三终结(29a R2/R3)', () => {
  const sseLine = (payload: unknown): string => `data: ${JSON.stringify(payload)}`

  async function* toLines(lines: readonly string[]): AsyncIterable<string> {
    for (const line of lines) {
      yield line
    }
  }

  it('首包 annotations 携带全部来源;reasoning_content 与 content 分别累计;[DONE] 终结', async () => {
    const collected = await collectMimoChatStream(toLines([
      sseLine({
        choices: [{
          delta: {
            role: 'assistant',
            annotations: [citation(), citation({ url: 'https://example.com/backup', title: '备选场地' })],
          },
        }],
      }),
      sseLine({ choices: [{ delta: { reasoning_content: '先思考。' } }] }),
      sseLine({ choices: [{ delta: { reasoning_content: '再搜索。' } }] }),
      sseLine({ choices: [{ delta: { content: '推荐参考' } }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]',
    ]))
    expect(collected.termination).toBe('done')
    expect(collected.finishReason).toBe('stop')
    expect(collected.message.content).toBe('推荐参考')
    expect(collected.message.reasoningContent).toBe('先思考。再搜索。')
    expect(collected.blocks).toEqual([
      expect.objectContaining({ type: 'source', url: 'https://example.com/venue-guide' }),
      expect.objectContaining({ type: 'source', url: 'https://example.com/backup' }),
      { type: 'citation', index: 1, sourceIndex: 0 },
      { type: 'citation', index: 2, sourceIndex: 1 },
    ])
    expect(findBlockLeaks(collected.blocks)).toEqual([])
  })

  it('error 帧终结:保留错误原文与此前已收来源(显式失败,不静默)', async () => {
    const collected = await collectMimoChatStream(toLines([
      sseLine({ choices: [{ delta: { annotations: [citation()] } }] }),
      sseLine({ error: { message: 'rate limited' } }),
    ]))
    expect(collected.termination).toBe('error')
    expect(collected.streamError).toEqual({ message: 'rate limited' })
    expect(collected.blocks).toHaveLength(2) // 首包来源仍如实保留
  })

  it('无任何标记的中断 → interrupted(规格明文流可能无标记结束)', async () => {
    const collected = await collectMimoChatStream(toLines([
      sseLine({ choices: [{ delta: { content: '部分' } }] }),
    ]))
    expect(collected.termination).toBe('interrupted')
    expect(collected.message.content).toBe('部分')
  })

  it('流式 tool_calls 按 index 归并(arguments 增量累加;消费方须校验后执行,29a R2)', async () => {
    const collected = await collectMimoChatStream(toLines([
      sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-9', type: 'function', function: { name: 'knowledge_search', arguments: '{"que' } }] } }] }),
      sseLine({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"场地"}' } }] } }] }),
      'data: [DONE]',
    ]))
    expect(collected.message.toolCalls).toEqual([
      { id: 'call-9', type: 'function', function: { name: 'knowledge_search', arguments: '{"query":"场地"}' } },
    ])
  })
})

describe('部署事实常量(K4.2 doctor 探活消费;29a R2)', () => {
  it('web_search 支持模型= v2.6 三系(仅 OpenAI Chat 协议)', () => {
    expect([...MIMO_WEB_SEARCH_MODELS]).toEqual(['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'])
  })

  it('开关 5 分钟缓存——探活结论须考虑缓存(29a R2)', () => {
    expect(MIMO_WEB_SEARCH_SWITCH_CACHE_MS).toBe(300_000)
  })

  it('开通前置:控制台开通「联网服务插件」(未开通的探活失败形态进 K4.2 判定表)', () => {
    expect(MIMO_WEB_SEARCH_PREREQUISITE).toContain('联网服务插件')
  })

  it('thinking 默认 enabled;思考模式服务端强制采样参数记录(透传侧)', () => {
    expect(MIMO_DEFAULT_THINKING).toEqual({ type: 'enabled' })
    expect(MIMO_THINKING_SAMPLING).toEqual({ temperature: 1.0, topP: 0.95 })
  })
})
