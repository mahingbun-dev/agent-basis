/**
 * generic 兜底适配器——OpenAI 兼容 function calling 客户端工具循环
 * (36 号 K2.3「loop.ts(function calling 工具循环,R3 八条裁剪)」)。
 *
 * R3 八条裁剪逐字实现(29a R3 结论表,协议环节 × 标准形态):
 * 【发送 4】
 *  1. `tools[]` 四件套 `{type:'function',function:{name,description,parameters}}`
 *     (构造经 router/translate.ts toGenericFunctionTool);
 *  2. name 保守约束 `^[a-zA-Z0-9_-]+$` 且 ≤64(契约命名规范,contract/naming.ts);
 *  3. parameters 朴素 JSON Schema 子集(type/properties/required/enum/description/嵌套 object);
 *  4. 不发 `strict`/`custom`/`allowed_tools`/`namespace`/`defer_loading`/已废弃 `functions`/
 *     `function_call`——请求构造白名单收窄 + 禁入键深检双保险(29a R3 禁入清单)。
 * 【接收 2】
 *  5. `tool_calls[].function.arguments` 是 JSON 字符串且可能非法(官方明示)——容错解析,
 *     解析失败**不执行工具**、回灌错误字符串(parseToolCallArguments);
 *  6. `finish_reason==='tool_calls'` 判工具轮;一次响应 0/1/N 个 tool_calls。
 * 【回灌 2】
 *  7. 先 push 原样 `tool_calls` 的 assistant 消息,再**每 tool_call 一条**
 *     `{role:'tool',tool_call_id, content:string}`;失败/降级也显式回灌**非空**字符串
 *     (29 号 §5 降级语义「显式表达」;空串统一 coerce 为占位文案);
 *  8. 带同一 `tools` 声明再次请求,循环直至 `finish_reason!=='tool_calls'`;
 *     `parallel_tool_calls` 显式声明(GENERIC_TOOL_CALL_FLAGS,官方默认 true,显式发避免供应商默认差异)。
 * 【流式】delta.tool_calls[i].index 归并(index 唯一必填,id/name 首帧携带,arguments 增量累加);
 * 三种终结都处理:① 字面帧 `data: [DONE]` ② 含 error 字段的 JSON 帧 ③ 无任何标记的中断。
 *
 * tool_call id 无格式契约(29a R3 unresolved-②:示例 call_ 前缀非协议,不得依赖前缀识别)。
 * 轨道锚定 Chat Completions(29a R3 轨道选择行);Responses 全家不进公共子集(禁入清单)。
 */
import { assertNoForbiddenKeys } from '../../contract/forbidden.ts'
import { assertValidToolName } from '../../contract/naming.ts'
import type { ToolChoice } from '../../contract/capabilities.ts'
import { normalizeToolChoice } from '../../contract/capabilities.ts'
import { GENERIC_TOOL_CALL_FLAGS } from '../../router/translate.ts'
import type { GenericFunctionTool } from '../../router/translate.ts'

// ---------------------------------------------------------------------------
// 协议形态(Chat Completions 子集;朴素收窄,不给 OpenAI 特有字段留位)
// ---------------------------------------------------------------------------

/** 模型发起的工具调用(接收侧原样形态;id 回灌作 tool_call_id)。 */
export interface GenericToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/** 回灌消息(Chat 子集:system/user/assistant/tool;assistant 带 tool_calls、tool 带 tool_call_id)。 */
export interface GenericChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content?: string | null
  /** assistant 消息的原样 tool_calls(回灌序列第 7 条:原样 push)。 */
  readonly tool_calls?: readonly GenericToolCall[]
  /** tool 消息的 tool_call_id。 */
  readonly tool_call_id?: string
}

/** 请求构造输出(白名单字段;禁入键深检后才是合法请求)。 */
export interface GenericChatRequest {
  readonly model?: string
  readonly messages: readonly GenericChatMessage[]
  readonly tools?: readonly GenericFunctionTool[]
  readonly tool_choice?: ToolChoice
  readonly parallel_tool_calls?: boolean
  readonly stream?: boolean
}

export interface GenericChatResponseChoice {
  readonly message?: {
    readonly role?: string
    readonly content?: string | null
    readonly tool_calls?: readonly GenericToolCall[]
  }
  readonly finish_reason?: string | null
}

/** 非流式响应(choices[0] 消费;顶层 error 字段为显式失败形态)。 */
export interface GenericChatResponse {
  readonly choices?: readonly GenericChatResponseChoice[]
  readonly error?: { readonly message?: string; readonly code?: string } & Record<string, unknown>
}

/** 非流式传输面(注入;宿主接 llm-openai 传输层或测试 mock)。 */
export type GenericChatTransport = (request: GenericChatRequest, signal?: AbortSignal) => Promise<GenericChatResponse>

/** 流式传输面:产出原始 SSE 行(含 `data: …`/`data: [DONE]`;同步生成器或其 Promise 均可;驱动见 collectChatStream)。 */
export type GenericChatStreamTransport = (
  request: GenericChatRequest,
  signal?: AbortSignal,
) => AsyncIterable<string> | Promise<AsyncIterable<string>>

/** 工具循环错误(传输 error 帧/轮数上限;显式抛出,绝不静默吞)。 */
export class GenericLoopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenericLoopError'
  }
}

// ---------------------------------------------------------------------------
// 接收侧:arguments 容错解析(第 5 条)
// ---------------------------------------------------------------------------

/** 容错解析结果:ok=合法 JSON(空串/纯空白视作空对象——「省略=空参数」的保守读法)。 */
export type ParsedToolArguments = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }

export function parseToolCallArguments(raw: string): ParsedToolArguments {
  const text = raw.trim()
  if (text.length === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    return {
      ok: false,
      error: `arguments 非合法 JSON(29a R3:官方明示可能非法/幻觉参数,执行前必须校验): ${(error as Error).message}`,
    }
  }
}

/** 工具结果回灌内容(第 7 条:恒非空字符串;空串 coerce 为占位文案——失败/降级也显式回灌)。 */
export const EMPTY_TOOL_RESULT_PLACEHOLDER = '(工具无输出——显式回灌占位,29a R3 回灌序列)'

export function toToolResultContent(content: string): string {
  return content.length > 0 ? content : EMPTY_TOOL_RESULT_PLACEHOLDER
}

// ---------------------------------------------------------------------------
// 发送侧:请求构造(第 1–4 条 + parallel_tool_calls 显式)
// ---------------------------------------------------------------------------

/**
 * 构造工具轮请求:白名单字段收窄(model/messages/tools/tool_choice/parallel_tool_calls/stream),
 * 过禁入键深检(strict/custom/allowed_tools/namespace/defer_loading/functions/function_call 等
 * 任何深度命中即抛,29a R3 禁入清单),工具名过契约命名规范,tool_choice 过契约校验。
 */
export function buildGenericChatRequest(input: {
  readonly messages: readonly GenericChatMessage[]
  readonly tools?: readonly GenericFunctionTool[]
  readonly model?: string
  readonly toolChoice?: unknown
  readonly stream?: boolean
}): GenericChatRequest {
  if (input.tools !== undefined) {
    for (const tool of input.tools) {
      assertValidToolName(tool.function.name)
    }
  }
  const request: GenericChatRequest = {
    ...(input.model !== undefined ? { model: input.model } : {}),
    messages: input.messages,
    ...(input.tools !== undefined && input.tools.length > 0
      ? { tools: input.tools, tool_choice: input.toolChoice === undefined ? 'auto' : normalizeToolChoice(input.toolChoice), parallel_tool_calls: GENERIC_TOOL_CALL_FLAGS.parallel_tool_calls }
      : {}),
    ...(input.stream === true ? { stream: true } : {}),
  }
  assertNoForbiddenKeys(request)
  return request
}

// ---------------------------------------------------------------------------
// 流式:SSE 帧解析 + tool_calls 按 index 归并 + 三终结
// ---------------------------------------------------------------------------

/** SSE 单帧解析结果。 */
export type SseFrame =
  | { readonly kind: 'data'; readonly payload: unknown }
  | { readonly kind: 'done' } // 字面帧 data: [DONE](非 JSON、无 event 字段)
  | { readonly kind: 'empty' } // 空行/注释行(: keep-alive)

export function parseSseLine(line: string): SseFrame {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith(':')) return { kind: 'empty' }
  if (!trimmed.startsWith('data:')) return { kind: 'empty' }
  const data = trimmed.slice('data:'.length).trim()
  if (data === '[DONE]') return { kind: 'done' }
  try {
    return { kind: 'data', payload: JSON.parse(data) as unknown }
  } catch {
    // 非 JSON 的 data 行:按错误帧证据保留(不静默吞;归入 interrupted 证据由调用方处理)。
    return { kind: 'data', payload: { parse_error: `非 JSON data 帧: ${data.slice(0, 120)}` } }
  }
}

/** 流终结三态(29a R3 tool_calls 流式行:① [DONE] ② error 帧 ③ 无标记中断)。 */
export type StreamTermination = 'done' | 'error' | 'interrupted'

/** 流式收集产物:归并后消息级结果 + 终结形态。 */
export interface CollectedChatStream {
  readonly message: { readonly role: string; readonly content: string | null; readonly tool_calls: readonly GenericToolCall[] }
  readonly finishReason: string | null
  readonly termination: StreamTermination
  /** termination='error' 时的错误帧原文。 */
  readonly error?: unknown
}

/** 增量归并器:delta.tool_calls[i].index 归并(id/name/type 首帧携带,arguments 分片累加)。 */
export class ToolCallStreamMerger {
  readonly #entries = new Map<number, { id: string; name: string; arguments: string }>()
  #sawAnyToolCall = false

  /** 喂入一个 chat chunk(取 choices[0].delta)。 */
  push(chunk: unknown): void {
    const delta = readPath(chunk, ['choices', 0, 'delta']) as Record<string, unknown> | undefined
    if (typeof delta !== 'object') return
    const content = (delta as { content?: unknown }).content
    if (typeof content === 'string') this.#content += content
    const toolCallDeltas = (delta as { tool_calls?: unknown }).tool_calls
    if (!Array.isArray(toolCallDeltas)) return
    this.#sawAnyToolCall = true
    for (const item of toolCallDeltas) {
      if (item === null || typeof item !== 'object') continue
      const entry = item as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      // index 是唯一必填(29a R3):缺 index 的分片无法归并,丢弃并留证。
      if (typeof entry.index !== 'number') continue
      const existing = this.#entries.get(entry.index)
      const fn = entry.function ?? {}
      const id = typeof entry.id === 'string' ? entry.id : existing?.id ?? ''
      const name = typeof fn.name === 'string' && fn.name.length > 0 ? fn.name : existing?.name ?? ''
      const args = typeof fn.arguments === 'string' ? (existing?.arguments ?? '') + fn.arguments : existing?.arguments ?? ''
      this.#entries.set(entry.index, { id, name, arguments: args })
    }
  }

  #content = ''

  get content(): string {
    return this.#content
  }

  get sawToolCalls(): boolean {
    return this.#sawAnyToolCall
  }

  /** 归并产物:按 index 升序的 tool_calls(id 空时以 `index-<n>` 占位——id 无格式契约但字段必填)。 */
  toolCalls(): readonly GenericToolCall[] {
    return [...this.#entries.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, entry]) => ({
        id: entry.id.length > 0 ? entry.id : `index-${index}`,
        type: 'function' as const,
        function: { name: entry.name, arguments: entry.arguments },
      }))
  }
}

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[String(key)]
  }
  return current
}

/**
 * 驱动一条 SSE 行流至终结(三终结都处理):
 * ① `data: [DONE]` 字面帧 → done;② 含 error 字段的 JSON 帧 → error(保留原文,继续读完流);
 * ③ 流耗尽仍无任何标记 → interrupted(规格明文「An interrupted stream may end without the marker」)。
 */
export async function collectChatStream(lines: AsyncIterable<string>): Promise<CollectedChatStream> {
  const merger = new ToolCallStreamMerger()
  let finishReason: string | null = null
  let termination: StreamTermination | undefined
  let errorFrame: unknown
  let role = 'assistant'
  for await (const line of lines) {
    const frame = parseSseLine(line)
    if (frame.kind === 'empty') continue
    if (frame.kind === 'done') {
      termination = 'done'
      continue
    }
    const payload = frame.payload
    if (payload !== null && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)) {
      termination = 'error'
      errorFrame = (payload as Record<string, unknown>).error
      continue
    }
    merger.push(payload)
    const chunkRole = readPath(payload, ['choices', 0, 'delta', 'role'])
    if (typeof chunkRole === 'string') role = chunkRole
    const chunkFinish = readPath(payload, ['choices', 0, 'finish_reason'])
    if (typeof chunkFinish === 'string') finishReason = chunkFinish
  }
  return {
    message: { role, content: merger.content.length > 0 ? merger.content : null, tool_calls: merger.toolCalls() },
    finishReason,
    termination: termination ?? 'interrupted',
    ...(errorFrame !== undefined ? { error: errorFrame } : {}),
  }
}

// ---------------------------------------------------------------------------
// 工具循环(第 6–8 条)
// ---------------------------------------------------------------------------

/** 单个工具调用的执行委托(返回回灌字符串;抛错由循环捕获并显式回灌错误文案)。 */
export type ToolExecutor = (call: { readonly id: string; readonly name: string; readonly arguments: unknown }) => Promise<string> | string

/** 一轮传输交互的留痕(工具轮含执行明细;收尾轮 toolCalls 为空——完整日志语义,审计/调试面)。 */
export interface ToolRoundTrace {
  readonly round: number
  readonly toolCalls: readonly {
    readonly id: string
    readonly name: string
    /** 容错解析后的入参(非法 JSON 时为 undefined + parseError)。 */
    readonly arguments?: unknown
    readonly parseError?: string
    /** 回灌内容(恒非空;第 7 条)。 */
    readonly result: string
    readonly status: 'ok' | 'error'
  }[]
  readonly assistantContent: string | null
}

export interface ToolLoopResult {
  /** 完整消息日志(含每轮 assistant/tool 回灌;第 7 条序列证据)。 */
  readonly messages: readonly GenericChatMessage[]
  /** 终轮正文(finish_reason!=='tool_calls' 的收尾;流式 interrupted 时可能为 null)。 */
  readonly finalContent: string | null
  readonly finishReason: string | null
  readonly rounds: readonly ToolRoundTrace[]
  /** 传输面终结形态(非流式恒 done;流式三终结如实透传)。 */
  readonly termination: StreamTermination
}

export interface ToolLoopOptions {
  /** 非流式传输面(与 streamTransport 二选一,必填其一)。 */
  readonly transport?: GenericChatTransport
  /** 流式传输面(三终结处理;工具轮判定/回灌序列与非流式完全一致)。 */
  readonly streamTransport?: GenericChatStreamTransport
  readonly messages: readonly GenericChatMessage[]
  /** 工具定义四件套(第 8 条:循环期间同一 tools 声明原样重发)。 */
  readonly tools: readonly GenericFunctionTool[]
  readonly model?: string
  readonly toolChoice?: unknown
  readonly execute: ToolExecutor
  readonly signal?: AbortSignal
  /**
   * 工具轮上限(实现护栏,**非 29a 行为**:R3 只说「循环直至 finish_reason!=='tool_calls'」,
   * 恒 tool_calls 的模型会死循环;调用方按部署预算设定,缺省 16)。达到上限显式抛
   * GenericLoopError——显式失败,不静默截断。
   */
  readonly maxRounds?: number
}

interface RoundOutcome {
  readonly assistantMessage: GenericChatMessage
  readonly toolMessages: readonly GenericChatMessage[]
  readonly trace: ToolRoundTrace
  readonly isToolRound: boolean
  readonly finalContent: string | null
  readonly finishReason: string | null
  readonly termination: StreamTermination
}

function firstChoice(response: GenericChatResponse): GenericChatResponseChoice | undefined {
  return response.choices?.[0]
}

async function runRound(options: ToolLoopOptions, messages: readonly GenericChatMessage[]): Promise<RoundOutcome> {
  const request = buildGenericChatRequest({
    messages,
    tools: options.tools,
    ...(options.model !== undefined ? { model: options.model } : {}),
    toolChoice: options.toolChoice,
    ...(options.streamTransport !== undefined ? { stream: true } : {}),
  })
  let message: { role: string; content: string | null; tool_calls: readonly GenericToolCall[] }
  let finishReason: string | null
  let termination: StreamTermination = 'done'
  if (options.streamTransport !== undefined) {
    const stream = await options.streamTransport(request, options.signal)
    const collected = await collectChatStream(stream)
    message = collected.message
    finishReason = collected.finishReason
    termination = collected.termination
    if (termination === 'error') {
      throw new GenericLoopError(`流式响应含 error 帧(29a R3 三终结之二): ${JSON.stringify(collected.error)}`)
    }
  } else if (options.transport !== undefined) {
    const response = await options.transport(request, options.signal)
    if (response.error !== undefined) {
      throw new GenericLoopError(`chat 响应顶层 error: ${JSON.stringify(response.error)}`)
    }
    const choice = firstChoice(response)
    message = {
      role: choice?.message?.role ?? 'assistant',
      content: choice?.message?.content ?? null,
      tool_calls: choice?.message?.tool_calls ?? [],
    }
    finishReason = choice?.finish_reason ?? null
  } else {
    throw new GenericLoopError('runToolLoop 需要 transport 或 streamTransport 之一(36 号 K2.3)')
  }

  const toolCalls = message.tool_calls
  // 第 6 条:finish_reason==='tool_calls' 判工具轮;退化形(标记为工具轮但 0 调用)按非工具轮收尾,
  // 防同形请求无限重放(留痕于 trace 空数组)。
  const isToolRound = finishReason === 'tool_calls' && toolCalls.length > 0
  const toolMessages: GenericChatMessage[] = []
  const traceCalls: {
    id: string
    name: string
    arguments?: unknown
    parseError?: string
    result: string
    status: 'ok' | 'error'
  }[] = []
  if (isToolRound) {
    for (const call of toolCalls) {
      const parsed = parseToolCallArguments(call.function.arguments)
      let result: string
      let status: 'ok' | 'error'
      let parseError: string | undefined
      let parsedArgs: unknown
      if (parsed.ok) {
        parsedArgs = parsed.value
        try {
          result = toToolResultContent(await options.execute({ id: call.id, name: call.function.name, arguments: parsed.value }))
          status = 'ok'
        } catch (error) {
          result = toToolResultContent(`工具执行失败(显式回灌,29 号 §5 降级语义): ${(error as Error).message}`)
          status = 'error'
        }
      } else {
        // 第 5 条:非法 arguments 不执行工具,回灌错误字符串。
        parseError = parsed.error
        result = toToolResultContent(parsed.error)
        status = 'error'
      }
      traceCalls.push({
        id: call.id,
        name: call.function.name,
        ...(parseError === undefined ? { arguments: parsedArgs } : { parseError }),
        result,
        status,
      })
      // 第 7 条:每个 tool_call 恰一条 tool 消息(成功/解析失败/执行失败一律显式回灌非空字符串)。
      toolMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }
  const assistantMessage: GenericChatMessage = {
    role: 'assistant',
    ...(message.content !== null ? { content: message.content } : { content: null }),
    ...(isToolRound ? { tool_calls: toolCalls } : {}), // 第 7 条:原样 tool_calls
  }
  return {
    assistantMessage,
    toolMessages,
    trace: { round: 0, toolCalls: traceCalls, assistantContent: message.content },
    isToolRound,
    finalContent: isToolRound ? null : message.content,
    finishReason,
    termination,
  }
}

/**
 * function calling 客户端循环(36 号 K2.3 主交付):
 * 模型发 tool_calls → 容错解析 → 客户端执行 → 原样 assistant + 逐调用 tool 消息回灌 →
 * 同一 tools 声明重发,直至 finish_reason!=='tool_calls'(R3 八条之 6/7/8)。
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxRounds = options.maxRounds ?? 16
  const messages: GenericChatMessage[] = [...options.messages]
  const rounds: ToolRoundTrace[] = []
  let round = 0
  while (true) {
    if (round >= maxRounds) {
      throw new GenericLoopError(`工具轮达到上限 ${maxRounds}(实现护栏;R3 循环条件为 finish_reason!=='tool_calls',恒工具轮的模型须显式失败而非死循环)`)
    }
    round += 1
    const outcome = await runRound(options, messages)
    rounds.push({ ...outcome.trace, round })
    messages.push(outcome.assistantMessage)
    messages.push(...outcome.toolMessages)
    if (!outcome.isToolRound) {
      return {
        messages,
        finalContent: outcome.finalContent,
        finishReason: outcome.finishReason,
        rounds,
        termination: outcome.termination,
      }
    }
  }
}
