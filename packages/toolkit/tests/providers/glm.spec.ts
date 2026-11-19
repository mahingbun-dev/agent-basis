/**
 * K3.1 glm 适配器单测(36 号 §3 表验收门禁;字段级依据 29a R1,fixture 回放为门禁主体,
 * 36 §1.9——真调验证挂 K4.2 doctor 探活):
 * - 非流式**顶层** `web_search[]` 回流 → source/citation 映射(`refer=ref_1` ↔ 正文 `[来源：ref_1]`
 *   角标;不在 choices[].message——message 仅 role/content/reasoning_content/audio/tool_calls);
 * - 流式 chunk 无 web_search 字段路径(ChatCompletionChunk 规范无该字段,R1 修正行):
 *   显式降级(webSearch.status='absent')、不虚构来源块;三终结([DONE]/error 帧/无标记中断);
 *   真流偏离规范携带该字段 → unexpected-present 留证不映射(unresolved-①);
 * - 契约参数 1:1 翻译快照(toGlmWebSearchTool/buildGlmChatRequest:tools[].web_search 子字段);
 * - tool_choice 仅 "auto"(R1;契约 required/嵌套指定形降级);
 * - read_url:POST /paas/v4/reader(url/timeout 默认 20/return_format 默认 markdown)→ 来源卡;
 * - 提供方字段禁透传(29 §2.1:media/refer/description 不出块;guards 白名单零泄漏);
 * - 计费常数进矩阵数据(§2.4 口径表:search_std 0.01/search_pro 0.03/sogou、quark 各 0.05)。
 */
import { describe, expect, it } from 'vitest'
import {
  GLM_STREAM_WEB_SEARCH_ABSENT_REASON,
  buildGlmChatRequest,
  collectGlmStream,
  parseGlmChatResponse,
  toGlmNormalizedBlocks,
  toGlmStreamBlocks,
} from '../../src/adapters/glm/chat.ts'
import type { GlmChatResponse, GlmWebSearchEntry } from '../../src/adapters/glm/chat.ts'
import { GlmHttpError, GlmReaderError, GlmToolClient, toGlmReaderSourceBlock } from '../../src/adapters/glm/reader.ts'
import type { GlmFetch, GlmRequestInit } from '../../src/adapters/glm/reader.ts'
import { ToolChoiceError } from '../../src/contract/capabilities.ts'
import { findBlockLeaks } from '../../src/blocks/index.ts'
import { GLM_WEB_SEARCH_YUAN_PER_CALL, PROVIDER_TABLE } from '../../src/router/router.ts'
import { toGlmWebSearchTool } from '../../src/router/translate.ts'

// ---------------------------------------------------------------------------
// fixture 构造(照 29a R1 回流行字段形态:icon/title/link/media/publish_date/content/refer)
// ---------------------------------------------------------------------------

const entry = (over: Partial<GlmWebSearchEntry> = {}): GlmWebSearchEntry => ({
  icon: over.icon !== undefined ? over.icon : 'https://example.com/favicon.ico',
  title: over.title !== undefined ? over.title : '场地选址指南',
  link: over.link !== undefined ? over.link : 'https://example.com/venue-guide',
  media: over.media !== undefined ? over.media : '站点甲',
  publish_date: over.publish_date !== undefined ? over.publish_date : '2026-10-12',
  content: over.content !== undefined ? over.content : '活动策划中的场地选址要素与档期核对清单。',
  refer: over.refer !== undefined ? over.refer : 'ref_1',
})

/** SSE 行流构造(deepseek/generic 同款 fixture 消费形态)。 */
async function* sse(...lines: readonly string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('组装侧:tools[].web_search 声明 1:1 + tool_choice 仅 auto(29a R1 web_search 行)', () => {
  it('契约参数 → GLM 工具声明 1:1 翻译快照(缺省值:search_std/count 10/noLimit/medium)', () => {
    expect(toGlmWebSearchTool({ query: '场地 档期' })).toEqual({
      tools: [{
        type: 'web_search',
        web_search: {
          search_query: '场地 档期', // 强制触发位
          search_engine: 'search_std',
          count: 10,
          search_recency_filter: 'noLimit',
          content_size: 'medium',
        },
      }],
      tool_choice: 'auto',
    })
    // 无 domainFilter 时不得出现该键(additionalProperties:false 的外层声明形,如实省略)。
    expect('search_domain_filter' in toGlmWebSearchTool({ query: 'x' }).tools[0].web_search).toBe(false)
  })

  it('契约参数全量 → 四引擎/条数/域名/时效/摘要长度逐字段对位', () => {
    expect(toGlmWebSearchTool({
      query: '档期',
      engine: 'search_pro_sogou',
      count: 30,
      domainFilter: ['example.com', 'example.org'],
      recency: 'oneWeek',
      contentSize: 'high',
    })).toEqual({
      tools: [{
        type: 'web_search',
        web_search: {
          search_query: '档期',
          search_engine: 'search_pro_sogou',
          count: 30,
          search_domain_filter: ['example.com', 'example.org'],
          search_recency_filter: 'oneWeek',
          content_size: 'high',
        },
      }],
      tool_choice: 'auto',
    })
  })

  it('buildGlmChatRequest:tools 数组 {type:"web_search", web_search:{…}}(外层 required type+web_search)', () => {
    const request = buildGlmChatRequest({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: '帮我核对场地档期' }],
      params: { query: '场地 档期', engine: 'search_pro', count: 5 },
    })
    expect(request).toEqual({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: '帮我核对场地档期' }],
      tools: [{ type: 'web_search', web_search: { search_query: '场地 档期', search_engine: 'search_pro', count: 5, search_recency_filter: 'noLimit', content_size: 'medium' } }],
      tool_choice: 'auto',
    })
    const streamed = buildGlmChatRequest({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'q' }],
      params: { query: 'q' },
      stream: true,
    })
    expect(streamed.stream).toBe(true)
  })

  it('tool_choice 仅 "auto":契约 required/嵌套指定形一律降级(R1;TOOL_CHOICE_DOWNGRADES.glm)', () => {
    for (const toolChoice of ['auto', 'required', { type: 'function', function: { name: 'my_tool' } }] as const) {
      const request = buildGlmChatRequest({ model: 'glm-4.6', messages: [{ role: 'user', content: 'q' }], params: { query: 'q' }, toolChoice })
      expect(request.tool_choice).toBe('auto')
    }
    // 非法契约形态静态拒绝(契约层纪律,glm 分支不接自由拼装)。
    expect(() => buildGlmChatRequest({ model: 'glm-4.6', messages: [{ role: 'user', content: 'q' }], params: { query: 'q' }, toolChoice: 'banana' })).toThrow(ToolChoiceError)
    // 翻译白名单纪律:契约参数外的多余键(如 OpenAI 特有 strict)不进请求(toGlmWebSearchTool 逐字段取值)。
    const request = buildGlmChatRequest({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'q' }],
      params: { query: 'q', ...{ strict: true } },
    })
    expect('strict' in request.tools[0].web_search).toBe(false)
  })
})

describe('回流解析(核心一):非流式顶层 web_search[] → source/citation(29a R1 回流行)', () => {
  it('顶层数组条目 → SourceBlock;refer=ref_N ↔ 正文 [来源：ref_N] 角标', () => {
    const response: GlmChatResponse = {
      id: 'cmpl-glm-1',
      choices: [{
        message: { role: 'assistant', content: '推荐参考[来源：ref_1],另见[来源：ref_2]。' },
        finish_reason: 'stop',
      }],
      web_search: [
        entry(),
        entry({ icon: 'https://example.com/schedule.ico', title: '活动档期表', link: 'https://example.com/schedule', media: '站点乙', publish_date: '', content: '年度档期速查。', refer: 'ref_2' }),
        { title: '无角标来源', link: 'https://example.com/no-mark', content: '该条无角标。' },
      ],
    }
    const result = parseGlmChatResponse(response)
    // 正文角标文本与 refer 对应关系(R1):content 原样保留 [来源：ref_N] 标注。
    expect(result.content).toContain('[来源：ref_1]')
    expect(result.content).toContain('[来源：ref_2]')
    expect(toGlmNormalizedBlocks(result)).toEqual([
      {
        type: 'source',
        title: '场地选址指南',
        url: 'https://example.com/venue-guide',
        summary: '活动策划中的场地选址要素与档期核对清单。',
        publishTime: '2026-10-12T00:00:00.000Z',
        icon: 'https://example.com/favicon.ico',
      },
      {
        type: 'source',
        title: '活动档期表',
        url: 'https://example.com/schedule',
        summary: '年度档期速查。',
        publishTime: null, // 空串 → null(publishTime 必须可空,29a R6 修正)
        icon: 'https://example.com/schedule.ico',
      },
      {
        type: 'source',
        title: '无角标来源',
        url: 'https://example.com/no-mark',
        summary: '该条无角标。',
        publishTime: null,
        // icon 缺省 → 省略键(GLM site_name 无字段同省略;§2.3 映射)
      },
      { type: 'citation', index: 1, sourceIndex: 0 }, // refer=ref_1 → 角标序号 1 + 来源下标 0
      { type: 'citation', index: 2, sourceIndex: 1 }, // refer=ref_2 → 角标序号 2 + 来源下标 1
      // 第三条无 refer → 不虚构角标
    ])
  })

  it('web_search 只在响应顶层——message(role/content/reasoning_content/audio/tool_calls)无内嵌搜索字段', () => {
    const response: GlmChatResponse = {
      choices: [{ message: { role: 'assistant', content: '正文', reasoning_content: '先查档期' }, finish_reason: 'stop' }],
      // 无顶层 web_search → 本轮无来源(空数组,不虚构)
    }
    const result = parseGlmChatResponse(response)
    expect(result.webSearch).toEqual([])
    expect(result.reasoningContent).toBe('先查档期')
    expect(toGlmNormalizedBlocks(result)).toEqual([])
  })

  it('refer 非 ref_N 形态 → 该来源不产角标(不虚构序号;R1 只定义 ref_N 形)', () => {
    const result = parseGlmChatResponse({
      choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
      web_search: [entry({ refer: 'citation-1', link: 'https://example.com/odd' })],
    })
    const blocks = toGlmNormalizedBlocks(result)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('source')
  })

  it('错误体统一 error 形态透传(R1 鉴权与通用约定行;显式失败不静默)', () => {
    const result = parseGlmChatResponse({ error: { code: '1113', message: '余额不足' } })
    expect(result.error).toEqual({ code: '1113', message: '余额不足' })
  })
})

describe('提供方字段禁透传(29 §2.1:media/refer 不出块)', () => {
  it('全字段流 → 块序列零泄漏(guards 白名单)+ 串内无 media/refer', () => {
    const result = parseGlmChatResponse({
      choices: [{ message: { role: 'assistant', content: '正文[来源：ref_1]' }, finish_reason: 'stop' }],
      web_search: [entry({ media: '敏感媒介名' })],
    })
    const blocks = toGlmNormalizedBlocks(result)
    expect(findBlockLeaks(blocks)).toEqual([])
    expect(JSON.stringify(blocks)).not.toContain('media')
    expect(JSON.stringify(blocks)).not.toContain('"refer"')
    expect(JSON.stringify(blocks)).not.toContain('敏感媒介名')
  })
})

describe('流式(核心二):chunk 无 web_search 字段的降级处理(29a R1 修正行 + unresolved-①)', () => {
  it('规范形态:chunk 无该字段 → 显式降级 absent,不虚构来源块;正文/reasoning 增量归并', async () => {
    const result = await collectGlmStream(sse(
      ': keep-alive',
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"推荐"}}]}',
      'data: {"choices":[{"delta":{"content":"参考","reasoning_content":"先查档期"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ))
    expect(result.termination).toBe('done')
    expect(result.content).toBe('推荐参考')
    expect(result.reasoningContent).toBe('先查档期')
    expect(result.finishReason).toBe('stop')
    // 降级位:显式 absent + 理由(29 §1 ⑤「不假装可用」),而非静默缺字段。
    expect(result.webSearch).toEqual({ status: 'absent', reason: GLM_STREAM_WEB_SEARCH_ABSENT_REASON })
    // 不虚构来源:流式结果恒产空块序列(降级显式可测,非隐式约定)。
    expect(toGlmStreamBlocks(result)).toEqual([])
  })

  it('error 帧(统一 error 体)→ termination=error,原文保留', async () => {
    const result = await collectGlmStream(sse(
      'data: {"choices":[{"delta":{"content":"部分"}}]}',
      'data: {"error":{"code":"1301","message":"内容安全审查未通过"}}',
    ))
    expect(result.termination).toBe('error')
    expect(result.error).toEqual({ code: '1301', message: '内容安全审查未通过' })
    expect(result.content).toBe('部分') // 已收增量保留
    expect(result.webSearch.status).toBe('absent')
  })

  it('无任何标记的中断 → interrupted(R3 三终结之三同款)', async () => {
    const result = await collectGlmStream(sse('data: {"choices":[{"delta":{"content":"半句"}}]}'))
    expect(result.termination).toBe('interrupted')
    expect(result.webSearch.status).toBe('absent')
  })

  it('真流偏离规范携带顶层 web_search 字段 → unexpected-present 留证,不猜语义不映射(unresolved-①)', async () => {
    const oddFrame = { choices: [{ delta: { content: 'x' } }], web_search: [{ title: 't', link: 'https://example.com/x' }] }
    const result = await collectGlmStream(sse(
      `data: ${JSON.stringify(oddFrame)}`,
      'data: [DONE]',
    ))
    expect(result.webSearch).toEqual({ status: 'unexpected-present', frames: [oddFrame] })
    // 该帧已知语义的 delta.content 仍归并(证据与正文两不误);web_search 语义未裁决
    // (真实回流位置属 R1 unresolved-①,处置=K4.2 doctor 探活):不映射进块。
    expect(result.content).toBe('x')
    expect(toGlmStreamBlocks(result)).toEqual([])
  })
})

describe('read_url:POST /paas/v4/reader(29a R1 read_url 行)', () => {
  const captured: { url: string; init: GlmRequestInit }[] = []
  const fetchMock: GlmFetch = async (url, init) => {
    captured.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'rdr-1',
        created: 1760000000,
        request_id: 'req-abcdef',
        model: 'reader',
        reader_result: {
          content: '# 场地选址指南\n\n正文抽取文本。',
          description: '页面描述',
          title: '场地选址指南',
          url: 'https://example.com/venue-guide',
          external: false,
          metadata: { lang: 'zh' },
        },
      }),
    }
  }

  it('请求形态:Bearer 鉴权 + url/timeout 默认 20/return_format 默认 markdown', async () => {
    const client = new GlmToolClient({ apiKey: 'glm-key', fetchImpl: fetchMock })
    await client.read({ url: 'https://example.com/venue-guide' })
    expect(captured.at(-1)?.url).toBe('https://open.bigmodel.cn/api/paas/v4/reader')
    expect(captured.at(-1)?.init.headers.Authorization).toBe('Bearer glm-key')
    expect(JSON.parse(captured.at(-1)?.init.body ?? '{}')).toEqual({
      url: 'https://example.com/venue-guide',
      timeout: 20,
      return_format: 'markdown',
    })
    // 覆盖契约参数:timeout/returnFormat 对位翻译。
    await client.read({ url: 'https://example.com/a', timeout: 35, returnFormat: 'html' })
    expect(JSON.parse(captured.at(-1)?.init.body ?? '{}')).toEqual({ url: 'https://example.com/a', timeout: 35, return_format: 'html' })
  })

  it('响应 → 来源卡:summary←content、publishTime=null 如实;description/metadata/external 不透传', () => {
    const source = toGlmReaderSourceBlock({
      reader_result: { content: '# 正文', description: '描述', title: '标题', url: 'https://example.com/x', external: true, metadata: { a: 1 } },
    })
    expect(source).toEqual({ type: 'source', title: '标题', url: 'https://example.com/x', summary: '# 正文', publishTime: null })
    expect(findBlockLeaks([source])).toEqual([])
    expect(JSON.stringify(source)).not.toContain('description')
    expect(JSON.stringify(source)).not.toContain('metadata')
  })

  it('2xx 但缺 reader_result / 缺 url → 显式失败(GlmReaderError,不虚构来源卡)', () => {
    expect(() => toGlmReaderSourceBlock({ id: 'rdr-2' })).toThrow(GlmReaderError)
    expect(() => toGlmReaderSourceBlock({ reader_result: { content: 'x', title: 't' } })).toThrow(/url 缺失/)
  })

  it('非 2xx → GlmHttpError(统一错误体 {"error":{code,message}} 原样保留,R1)', async () => {
    const client = new GlmToolClient({
      apiKey: 'glm-key',
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: '1302', message: '并发上限' } }) }),
    })
    await expect(client.read({ url: 'https://example.com/x' })).rejects.toMatchObject({
      name: 'GlmHttpError',
      status: 429,
      detail: { error: { code: '1302', message: '并发上限' } },
    })
    expect(() => {
      throw new GlmHttpError(429, { error: { code: '1302' } })
    }).toThrow(GlmHttpError)
  })
})

describe('计费常数进矩阵数据(36 号 K3.1;§2.4 口径表 ← 29a R1 web_search 回流行)', () => {
  it('glm 行携带引擎四档单价(元/次)', () => {
    expect(GLM_WEB_SEARCH_YUAN_PER_CALL).toEqual({
      search_std: 0.01,
      search_pro: 0.03,
      search_pro_sogou: 0.05,
      search_pro_quark: 0.05,
    })
    const glmRow = PROVIDER_TABLE.find(row => row.provider === 'glm')
    expect(glmRow?.billing?.webSearchYuanPerCall).toEqual(GLM_WEB_SEARCH_YUAN_PER_CALL)
  })
})
