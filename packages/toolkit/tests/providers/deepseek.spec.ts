/**
 * K2.1 deepseek 适配器·对话侧单测(36 号 §3 表验收门禁):
 * - SSE fixture 回放(照 chat-demo 事件形态构造:message_start、content_block 全族、
 *   message_delta、message_stop,含 ping 与注释行)→ 规范化块断言(server_tool_use、
 *   web_search_tool_result、web_fetch_tool_result、citations_delta 归并,reply.ts applyEvent 范式);
 * - WebSearchToolResultError 6 值枚举映射(R4-③;每个 error_code → search_step status='error'+detail);
 * - encrypted_content 不出块(29 §2.1;guards 白名单/禁入键零命中 + 序列化串无该字段);
 * - 组装防呆:同工具两次/tool_choice 指定服务端工具/与第三类服务端工具混传(R4 web_tools 行);
 * - signature 只存在于适配器内部(web_fetch_tool_result 多轮回传保留),出块即剥离;
 * - 流终结:message_stop 截止、error 帧收进 state、无 message_stop 即 interrupted(chat-demo 纪律)。
 */
import { describe, expect, it } from 'vitest'
import {
  DeepseekRequestError,
  applyMessageEvent,
  assertNoServerToolConflicts,
  assertToolChoiceAllowed,
  buildMessagesRequest,
  buildServerTools,
  consumeSseFrames,
  createMessageAccumulator,
  parseMessageStreamFromSse,
  runMessageStream,
  toAttachmentRefBlocks,
  toNormalizedBlocks,
  toReadUrlUserMessage,
  toWebSearchUserMessage,
} from '../../src/adapters/deepseek/index.ts'
import type { MessageStreamEvent, MessageUsage, WebSearchResult, WebSearchToolResultError } from '../../src/adapters/deepseek/index.ts'
import type { FilePurpose, StopReason, ThinkingType } from '../../src/adapters/deepseek/types.ts'
import { WEB_SEARCH_TOOL_RESULT_ERROR_CODES } from '../../src/adapters/deepseek/index.ts'
import { ServerSentEventDecoder, decodeSseText } from '../../src/adapters/deepseek/index.ts'
import { findBlockLeaks } from '../../src/blocks/index.ts'

// ---------------------------------------------------------------------------
// fixture 构造(照 chat-demo 事件形态;36 号 §1.9:fixture 回放为门禁主体)
// ---------------------------------------------------------------------------

const messageStart = (): MessageStreamEvent => ({
  type: 'message_start',
  message: { id: '8f2a9c31-1e44-4c62-9d3a-2f71c8e0b5a7', model: 'deepseek-flash', usage: { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } },
})

const searchUseStart = (index: number, id: string, queries: readonly string[]): MessageStreamEvent => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'server_tool_use', id, name: 'deepseek_web_search', input: { action: 'search', queries }, caller: { type: 'direct' }, kind: 'search' },
})

const searchResultStart = (
  index: number,
  toolUseId: string,
  content: readonly (WebSearchResult | WebSearchToolResultError)[],
): MessageStreamEvent => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'web_search_tool_result', tool_use_id: toolUseId, content, kind: 'search' },
})

type WebSearchResultOver = Partial<{
  title: string
  url: string
  snippet: string
  page_age: string | null
  site_name: string | null
  site_icon: string | null
  encrypted_content: string
}>

const webSearchResult = (over: WebSearchResultOver = {}): WebSearchResult => ({
  type: 'web_search_result',
  title: over.title !== undefined ? over.title : '场地选址指南',
  url: over.url !== undefined ? over.url : 'https://example.com/venue-guide',
  snippet: over.snippet !== undefined ? over.snippet : '活动策划中的场地选址要素与档期核对清单。',
  site_icon: over.site_icon !== undefined ? over.site_icon : 'https://example.com/favicon.ico',
  site_name: over.site_name !== undefined ? over.site_name : 'example.com',
  encrypted_content: over.encrypted_content !== undefined ? over.encrypted_content : 'JWE-encrypted-blob',
  page_age: over.page_age !== undefined ? over.page_age : '2026-10-12T08:00:00Z',
})

const textStart = (index: number): MessageStreamEvent => ({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
const textDelta = (index: number, text: string): MessageStreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
const citationDelta = (index: number, url: string): MessageStreamEvent => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url, title: '场地选址指南', cited_text: '推荐参考', encrypted_index: '' } },
})
const blockStop = (index: number): MessageStreamEvent => ({ type: 'content_block_stop', index })
const messageDelta = (usage?: MessageUsage): MessageStreamEvent => ({
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  ...(usage !== undefined ? { usage } : {}),
})
const messageStop = (): MessageStreamEvent => ({ type: 'message_stop' })

/** SSE 文本组装(event: 行 + data: 行 + 空行;含注释保活行——chat-demo sse.ts 消费形态)。 */
function toSseText(events: readonly MessageStreamEvent[], extras: readonly string[] = []): string {
  const frames = [
    ...events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
    ...extras.map(extra => `${extra}\n\n`),
  ]
  return `: keep-alive\n\n${frames.join('')}`
}

describe('组装侧:serverTools 翻译 + R4 静态防呆(29 §2.2)', () => {
  it('按能力开关组装 type 声明(不发 name——服务端不校验,29a R4)', () => {
    expect(buildServerTools(['read_url'])).toEqual([{ type: 'deepseek_read_url' }])
    expect(buildServerTools(['web_search'])).toEqual([{ type: 'deepseek_web_search' }])
    expect(buildServerTools(['web_search', 'read_url'])).toEqual([{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }])
    expect(buildServerTools([])).toEqual([])
  })

  it('同一工具声明两次 → 静态拒绝(服务端 400,R4)', () => {
    expect(() => buildServerTools(['web_search', 'web_search'])).toThrow(DeepseekRequestError)
    expect(() => buildServerTools(['read_url', 'read_url'])).toThrow(/deepseek_read_url 声明两次/)
  })

  it('与第三类服务端工具(web_search_2025*)混传 → 静态拒绝(R4:不能与其他服务端工具同传)', () => {
    const mixed = [{ type: 'deepseek_web_search' } as const, { type: 'web_search_20250305', name: 'web_search' } as const]
    expect(() => { assertNoServerToolConflicts(mixed) }).toThrow(DeepseekRequestError)
    expect(() => { assertNoServerToolConflicts([{ type: 'web_search_20260209', name: 'web_search' }]) }).not.toThrow()
  })

  it('tool_choice 指定服务端工具 → 静态拒绝(R4:tool_choice 不能指定它们)', () => {
    const tools = buildServerTools(['web_search', 'read_url'])
    expect(() => { assertToolChoiceAllowed(tools, { type: 'function', function: { name: 'deepseek_web_search' } }) }).toThrow(DeepseekRequestError)
    expect(() => { assertToolChoiceAllowed(tools, { type: 'function', function: { name: 'deepseek_read_url' } }) }).toThrow(/tool_choice 不能指定服务端工具/)
    // 指定其他(客户端)工具名与通用值不拦——R4 仅禁「指定它们」。
    expect(() => { assertToolChoiceAllowed(tools, { type: 'function', function: { name: 'my_tool' } }) }).not.toThrow()
    expect(() => { assertToolChoiceAllowed(tools, 'auto') }).not.toThrow()
    expect(() => { assertToolChoiceAllowed(tools, undefined) }).not.toThrow()
  })

  it('buildMessagesRequest:chat-demo 请求形态(stream 恒 true;扩展模式不带 safety_check/title)', () => {
    const request = buildMessagesRequest({
      model: 'deepseek-flash',
      system: '该助手为 DeepSeek。',
      messages: [{ role: 'user', content: '场地选址建议' }],
      thinking: { type: 'enabled' },
      capabilities: ['web_search'],
    })
    expect(request).toEqual({
      model: 'deepseek-flash',
      system: '该助手为 DeepSeek。',
      messages: [{ role: 'user', content: '场地选址建议' }],
      thinking: { type: 'enabled' },
      tools: [{ type: 'deepseek_web_search' }],
      stream: true,
    })
    expect('safety_check' in request).toBe(false)
    expect('title' in request).toBe(false)
  })

  it('契约参数 → 用户消息形态:query/url 入消息;无对位参数如实丢弃', () => {
    expect(toWebSearchUserMessage({ query: '场地 档期' })).toEqual({ role: 'user', content: '场地 档期' })
    expect(toReadUrlUserMessage({ url: 'https://example.com/a', timeout: 20, returnFormat: 'markdown' })).toEqual({ role: 'user', content: 'https://example.com/a' })
  })

  it('files 引用翻译:file_id + filename → attachment_ref 块(K2.2 上传侧之外的最小引用形态)', () => {
    expect(toAttachmentRefBlocks([{ fileId: 'file-api-9f2c', filename: '选址手册.pdf' }])).toEqual([
      { type: 'attachment_ref', fileId: 'file-api-9f2c', name: '选址手册.pdf' },
    ])
  })
})

describe('SSE 解码(WHATWG;chat-demo sse.ts 翻译)', () => {
  it('event/data 帧解析 + 注释行忽略 + CRLF/LF 切行', () => {
    const events = decodeSseText('event: ping\r\ndata: {}\r\n\r\nevent: message\ndata: {"x":1}\n\n')
    expect(events).toEqual([
      { event: 'ping', data: '{}', lastEventId: '' },
      { event: 'message', data: '{"x":1}', lastEventId: '' },
    ])
  })

  it('多行 data 以 \\n 连接;跨段输入缓冲到完整行再派发', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: a')).toEqual([])
    expect(decoder.push('b\n\ndata: c\n\n')).toEqual([
      { event: 'message', data: 'ab', lastEventId: '' },
      { event: 'message', data: 'c', lastEventId: '' },
    ])
    expect(decoder.end()).toEqual([])
  })

  it('未以空行结尾的尾帧按规范丢弃(end 只回收结尾 CR;chat-demo sse.ts end 纪律)', () => {
    expect(decodeSseText('data: partial')).toEqual([])
    expect(decodeSseText('data: partial\r')).toEqual([])
    expect(decodeSseText('data: a\n\ndata: dropped')).toEqual([{ event: 'message', data: 'a', lastEventId: '' }])
  })
})

describe('SSE fixture 回放 → 归并 → 规范化块(applyEvent 范式;门禁主体)', () => {
  it('web_search 全链:server_tool_use + web_search_tool_result + citations → 步骤/来源/角标', () => {
    const events: MessageStreamEvent[] = [
      messageStart(),
      searchUseStart(0, 'srvtoolu_s_1_2b', ['场地', '档期']),
      blockStop(0),
      searchResultStart(1, 'srvtoolu_s_1_2b', [
        webSearchResult(),
        webSearchResult({ title: '活动档期表', url: 'https://example.com/schedule', snippet: '年度档期速查。', page_age: null, site_name: null, site_icon: null }),
      ]),
      blockStop(1),
      textStart(2),
      textDelta(2, '推荐参考'),
      citationDelta(2, 'https://example.com/venue-guide'),
      blockStop(2),
      messageDelta({
        input_tokens: 12,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 2048,
        server_tool_use: { web_search_requests: 1, tool_search: 2 },
      }),
      messageStop(),
    ]
    const state = parseMessageStreamFromSse(toSseText(events))
    expect(state.status).toBe('done')
    expect(state.stopReason).toBe('end_turn')
    expect(state.usage?.server_tool_use).toEqual({ web_search_requests: 1, tool_search: 2 })
    expect(toNormalizedBlocks(state)).toEqual([
      { type: 'search_step', step: 1, action: 'search', query: '场地 档期', status: 'ok' },
      {
        type: 'source',
        title: '场地选址指南',
        url: 'https://example.com/venue-guide',
        summary: '活动策划中的场地选址要素与档期核对清单。',
        publishTime: '2026-10-12T08:00:00.000Z',
        siteName: 'example.com',
        icon: 'https://example.com/favicon.ico',
      },
      {
        type: 'source',
        title: '活动档期表',
        url: 'https://example.com/schedule',
        summary: '年度档期速查。',
        publishTime: null,
      },
      { type: 'citation', index: 1, sourceIndex: 0 },
    ])
  })

  it('read_link 全链:server_tool_use(read_link) + web_fetch_tool_result → open_page 步骤 + 来源', () => {
    const events: MessageStreamEvent[] = [
      messageStart(),
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_rl_1_4f', name: 'deepseek_read_url', input: { action: 'read_link', url: 'https://example.com/venue-guide' }, caller: { type: 'direct' }, kind: 'read_link' } },
      blockStop(0),
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_fetch_tool_result',
          tool_use_id: 'srvtoolu_rl_1_4f',
          kind: 'read_link',
          content: { type: 'web_fetch_result', url: 'https://example.com/venue-guide', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '' }, title: '场地选址指南' }, published_at: 'Tue, 03 Nov 2026 09:00:00 GMT' },
          signature: 'read-link-page-signature',
        },
      },
      blockStop(1),
      textStart(2),
      textDelta(2, '该页面指出…'),
      blockStop(2),
      messageDelta(),
      messageStop(),
    ]
    const state = parseMessageStreamFromSse(toSseText(events))
    expect(state.status).toBe('done')
    const blocks = toNormalizedBlocks(state)
    expect(blocks).toEqual([
      { type: 'search_step', step: 1, action: 'open_page', url: 'https://example.com/venue-guide', status: 'ok' },
      { type: 'source', title: '场地选址指南', url: 'https://example.com/venue-guide', summary: '', publishTime: '2026-11-03T09:00:00.000Z' },
    ])
    // signature 只存在于适配器内部(state 原样保留供多轮回传),出块即剥离。
    expect(JSON.stringify(blocks)).not.toContain('signature')
    expect(JSON.stringify(state.blocks)).toContain('read-link-page-signature')
  })

  it('深度搜索步骤形态:open_page/find_in_page 动作如实入时间线', () => {
    const events: MessageStreamEvent[] = [
      searchUseStart(0, 'srvtoolu_ds_1_11', ['场地']),
      blockStop(0),
      { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_ds_2_22', name: 'deepseek_web_search', input: { action: 'open_page', url: 'https://example.com/a' }, caller: { type: 'direct' }, kind: 'deep_search' } },
      blockStop(1),
      { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'srvtoolu_ds_3_33', name: 'deepseek_web_search', input: { action: 'find_in_page', url: 'https://example.com/a', pattern: '档期' }, caller: { type: 'direct' }, kind: 'deep_search' } },
      blockStop(2),
      messageDelta(),
      messageStop(),
    ]
    const state = parseMessageStreamFromSse(toSseText(events))
    expect(toNormalizedBlocks(state)).toEqual([
      { type: 'search_step', step: 1, action: 'search', query: '场地', status: 'ok' },
      { type: 'search_step', step: 2, action: 'open_page', url: 'https://example.com/a', status: 'ok' },
      { type: 'search_step', step: 3, action: 'find_in_page', url: 'https://example.com/a', query: '档期', status: 'ok' },
    ])
  })

  it('text/thinking 增量归并:citations_delta 流式累积 + signature_delta 拼接', () => {
    const acc = applyMessageEvent(
      applyMessageEvent(
        applyMessageEvent(
          applyMessageEvent(
            applyMessageEvent(
              applyMessageEvent(createMessageAccumulator(), {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', thinking: '', signature: '' },
              }),
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先查' } },
            ),
            { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '档期' } },
          ),
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-part-1' } },
        ),
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-part-2' } },
      ),
      blockStop(0),
    )
    expect(acc.state.blocks[0]).toEqual({ type: 'thinking', thinking: '先查档期', signature: 'sig-part-1sig-part-2' })

    const textAcc = applyMessageEvent(
      applyMessageEvent(
        applyMessageEvent(createMessageAccumulator(), textStart(0)),
        citationDelta(0, 'https://example.com/venue-guide'),
      ),
      citationDelta(0, 'https://example.com/schedule'),
    )
    expect((textAcc.state.blocks[0] as { citations?: unknown[] }).citations).toHaveLength(2)
  })

  it('引用 url 匹配不到来源卡 → 跳过该角标(角标必须有来源卡支撑)', () => {
    const events: MessageStreamEvent[] = [
      textStart(0),
      citationDelta(0, 'https://example.com/never-returned'),
      blockStop(0),
      messageDelta(),
      messageStop(),
    ]
    expect(toNormalizedBlocks(parseMessageStreamFromSse(toSseText(events)))).toEqual([])
  })
})

describe('WebSearchToolResultError 6 值枚举映射(R4-③ 门禁)', () => {
  it('枚举恰为 6 值(29a R4 对照行)', () => {
    expect([...WEB_SEARCH_TOOL_RESULT_ERROR_CODES]).toEqual([
      'invalid_tool_input',
      'unavailable',
      'max_uses_exceeded',
      'too_many_requests',
      'query_too_long',
      'request_too_large',
    ])
  })

  it.each([...WEB_SEARCH_TOOL_RESULT_ERROR_CODES])('error_code=%s → search_step{status:"error", detail}', (errorCode) => {
    const events: MessageStreamEvent[] = [
      searchUseStart(0, 'srvtoolu_s_1_ab', ['场地']),
      blockStop(0),
      searchResultStart(1, 'srvtoolu_s_1_ab', [{ type: 'web_search_tool_result_error', error_code: errorCode }]),
      blockStop(1),
      messageDelta(),
      messageStop(),
    ]
    const blocks = toNormalizedBlocks(parseMessageStreamFromSse(toSseText(events)))
    expect(blocks).toEqual([{ type: 'search_step', step: 1, action: 'search', query: '场地', status: 'error', detail: errorCode }])
  })

  it('web_fetch 3 值错误码 → 步骤 error(read_url 降级路径)', () => {
    for (const errorCode of ['url_not_accessible', 'url_not_allowed', 'unavailable'] as const) {
      const events: MessageStreamEvent[] = [
        { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_rl_1_9c', name: 'deepseek_read_url', input: { action: 'read_link', url: 'https://example.com/x' }, caller: { type: 'direct' }, kind: 'read_link' } },
        blockStop(0),
        { type: 'content_block_start', index: 1, content_block: { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_rl_1_9c', kind: 'read_link', content: { type: 'web_fetch_tool_result_error', error_code: errorCode } } },
        blockStop(1),
        messageDelta(),
        messageStop(),
      ]
      expect(toNormalizedBlocks(parseMessageStreamFromSse(toSseText(events)))).toEqual([
        { type: 'search_step', step: 1, action: 'open_page', url: 'https://example.com/x', status: 'error', detail: errorCode },
      ])
    }
  })
})

describe('提供方字段禁透传(29 §2.1 门禁:encrypted_content 不出块)', () => {
  it('encrypted_content/site_icon/snippet 全字段流 → 块序列零泄漏 + 串内无 encrypted_content', () => {
    const events: MessageStreamEvent[] = [
      searchUseStart(0, 'srvtoolu_s_1_ff', ['场地']),
      blockStop(0),
      searchResultStart(1, 'srvtoolu_s_1_ff', [webSearchResult({ encrypted_content: 'SECRET-JWE-BLOB' })]),
      blockStop(1),
      messageDelta(),
      messageStop(),
    ]
    const blocks = toNormalizedBlocks(parseMessageStreamFromSse(toSseText(events)))
    expect(JSON.stringify(blocks)).not.toContain('encrypted_content')
    expect(JSON.stringify(blocks)).not.toContain('SECRET-JWE-BLOB')
    expect(findBlockLeaks(blocks)).toEqual([])
  })

  it('cited_text/encrypted_index(deepseek 引用特有字段)不透传进角标块', () => {
    const events: MessageStreamEvent[] = [
      searchUseStart(0, 'srvtoolu_s_1_ei', ['场地']),
      blockStop(0),
      searchResultStart(1, 'srvtoolu_s_1_ei', [webSearchResult()]),
      blockStop(1),
      textStart(2),
      citationDelta(2, 'https://example.com/venue-guide'),
      blockStop(2),
      messageDelta(),
      messageStop(),
    ]
    const blocks = toNormalizedBlocks(parseMessageStreamFromSse(toSseText(events)))
    expect(blocks.at(-1)).toEqual({ type: 'citation', index: 1, sourceIndex: 0 })
    expect(JSON.stringify(blocks)).not.toContain('cited_text')
    expect(JSON.stringify(blocks)).not.toContain('encrypted_index')
  })
})

describe('流终结纪律(chat-demo client.ts streamMessage 翻译)', () => {
  it('message_stop 后的冗余帧忽略;ping/未知事件/[DONE] 帧静默丢弃', () => {
    const events: MessageStreamEvent[] = [
      messageStart(),
      messageStop(),
      messageStart(), // message_stop 之后的冗余帧
    ]
    const outcome = consumeSseFrames([
      { event: 'ping', data: '{}', lastEventId: '' },
      { event: 'message', data: JSON.stringify(events[0]), lastEventId: '' },
      { event: 'message', data: JSON.stringify(events[1]), lastEventId: '' },
      { event: 'message', data: JSON.stringify(events[2]), lastEventId: '' },
      { event: 'message', data: '[DONE]', lastEventId: '' }, // deepseek 不发;出现则按非 JSON 丢弃
    ])
    expect(outcome.events).toEqual([events[0], events[1]])
    expect(outcome.streamError).toBeUndefined()
  })

  it('流中 error 帧(如等待生成超时)→ state stream-error,已收块保留', () => {
    const text = [
      `event: message_start\ndata: ${JSON.stringify(messageStart())}\n\n`,
      'event: error\ndata: {"error":{"message":"等待生成超时","type":"timeout_error"}}\n\n',
    ].join('')
    const state = parseMessageStreamFromSse(text)
    expect(state.status).toBe('stream-error')
    expect(state.errorMessage).toBe('等待生成超时')
  })

  it('无 message_stop 即断流 → interrupted;错误内容保持为空,不推测断流原因', () => {
    const state = parseMessageStreamFromSse(toSseText([messageStart(), textStart(0), textDelta(0, '部分正文')]))
    expect(state.status).toBe('interrupted')
    expect(state.errorMessage).toBe('')
    expect(state.blocks).toHaveLength(1)
  })

  it('runMessageStream:message_stop 即 done(不再消费后续事件)', () => {
    const state = runMessageStream([messageStart(), messageStop(), messageStart()])
    expect(state.status).toBe('done')
  })

  it('未知事件类型静默丢弃(readMessageEvent 容错纪律)', () => {
    const events = consumeSseFrames([{ event: 'message', data: '{"type":"mystery_event","x":1}', lastEventId: '' }, { event: 'message', data: JSON.stringify(messageStop()), lastEventId: '' }])
    expect(events.events).toEqual([{ type: 'message_stop' }])
  })
})

describe('R4 缺口类型登记(29a R4 对照行 7 项)', () => {
  it('thinking 三值 + stop_sequence + 镜像形态登记位(R4-①④⑤⑦)', async () => {
    const typesModule = await import('../../src/adapters/deepseek/types.ts')
    // R4-④:thinking.type 第三值 adaptive。
    const thinking: { type: ThinkingType } = { type: 'adaptive' }
    expect(thinking.type).toBe('adaptive')
    // R4-⑤:StopReason 含 stop_sequence。
    const stopReason: StopReason = 'stop_sequence'
    expect(stopReason).toBe('stop_sequence')
    // R4-⑦:镜像形态登记三名字(本批仅登记,通道只做 Messages 形态)。
    expect([...typesModule.MIRRORED_SERVER_TOOL_SHAPES]).toEqual(['server_tool_calls', 'server_tool_event', 'web_search_call'])
    // R4-①:FilePurpose 三值制。
    const purposes: readonly FilePurpose[] = ['user_data', 'text_recognition', 'rich_layout_recognition']
    expect(purposes).toHaveLength(3)
  })
})
