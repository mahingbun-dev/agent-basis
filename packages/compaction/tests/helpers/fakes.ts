/**
 * C1 测试基建:压缩纯逻辑单测的确定性 fake 面。
 *
 * - `makeSession` 系列:直接用真实 `@deepseek-ai/dsh-session` 的 detached
 *   Session(勘察 S'-1 结论:`Session.create(id)` 是公开可测构造面,append
 *   运行时无需注册, KNOWN_SESSION_EVENT_TYPES 只守持久化读路径),不用 stub。
 * - `createFakeMeter`:包装 `@deepseek-ai/dsh-token-meter/estimate` 纯函数,按
 *   surface 逐节点估价(测试负载全为文本,heuristic 与 route 两价一致)。
 * - `fakeSummarizer`:按脚本逐次出牌(字符串=成功摘要,Error=抛错),实现
 *   region.ts `RegionDependencies.summarize` 的结构签名。
 * - `makeFakeAgent` / `makeFakeEngineContext`:引擎监听器与 compactPressure
 *   测试的 agent / ctx 结构面(ctx 不依赖真实 cordis 运行时)。
 *
 * deprecated 事件读法(eventAt)按勘察 S'-1 处理:上游允许测试调用,本仓机制是
 * .oxlintrc.json 的 typescript/no-deprecated=error + 行内 disable 注释豁免。
 *
 * @module tests/helpers/fakes
 */

import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { EpochHeader, SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { resolveConfig } from '../../src/basic/config.ts'
import type { SummarizationInput, SummaryResult } from '../../src/basic/summarizer.ts'
import type { BasicCompactionConfig, ResolvedConfig } from '../../src/basic/types.ts'
import { BasicCompactionEngine } from '../../src/basic/index.ts'

/** 单文本块快捷构造。 */
export function text(text: string): ContentBlock {
  return { type: 'text', text }
}

/** 供测试计算期望价:与 fakeMeter/引擎估价同源的纯函数。 */
export function priceText(message: Message): number {
  return estimateMessage(message)
}

// ---------------------------------------------------------------------------
// Session 构造(真实 dsh-session detached 实例)
// ---------------------------------------------------------------------------

/** 空白 detached Session。 */
export function makeSession(id = 'compaction-test'): Session {
  return Session.create(SessionId(id))
}

/** 落一条 request/header(压缩压力与摘要路由的读取源)。 */
export function appendRequestHeader(
  session: Session,
  provider = 'p',
  model = 'm',
  maxTokens?: number,
): SessionSeqType {
  const config = maxTokens === undefined ? { provider, model } : { provider, model, maxTokens }
  const event = session.append('request/header', { header: { config }, reason: 'initial' })
  return event.seq
}

/** 开一个 turn(region 事务的 owner='current-turn' 依赖开 turn)。 */
export function appendTurnStart(session: Session, turn = 1): SessionSeqType {
  return session.append('turn/start', { turn }).seq
}

/** 落一条 system/message(surface node 0 的系统头)。 */
export function appendSystemMessage(session: Session, turn = 1, step = 0, prompt = 'system prompt'): SessionSeqType {
  const event = session.append('system/message', { turn, step, message: createSystemMessage(prompt) }, {
    surfaceOp: 'append',
  })
  return event.seq
}

/** 落一条 user/message(user/message 事件负载即消息本身,无 turn/step 字段)。 */
export function appendUserMessage(session: Session, body: string): SessionSeqType {
  const event = session.append('user/message', createUserMessage({
    content: [text(body)],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return event.seq
}

/** 落一条带单个 tool-call 块的 assistant/message(tool 配对面)。 */
export function appendAssistantToolCall(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  name = 'read',
): SessionSeqType {
  const message = createAssistantMessage({
    content: [{ type: 'tool-call', id: ToolCallId(callId), name, arguments: '{}' }],
    source: { provider: 'p', model: 'm' },
  })
  const event = session.append('assistant/message', { turn, step, message, stream: [] }, { surfaceOp: 'append' })
  return event.seq
}

/** 落一条 tool/result。 */
export function appendToolResult(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  body: string,
  isError = false,
): SessionSeqType {
  const event = session.append('tool/result', {
    turn,
    step,
    message: createToolResultMessage({ callId: ToolCallId(callId), content: [text(body)], isError }),
  }, { surfaceOp: 'append' })
  return event.seq
}

/**
 * 压力/收敛测试的标准会话:开 turn + request/header + 两条大文本 user(无 system
 * 头,firstIdx=0)。大文本保证 framed checkpoint(约百余 token)小于被遮蔽价。
 * @returns 两条 user 的 seq(遮蔽区间)。
 */
export function makePressureSession(body = 'x'.repeat(800)): { session: Session; seqs: [SessionSeqType, SessionSeqType] } {
  const session = makeSession()
  appendTurnStart(session)
  appendRequestHeader(session)
  const first = appendUserMessage(session, body)
  const second = appendUserMessage(session, body)
  return { session, seqs: [first, second] }
}

// ---------------------------------------------------------------------------
// fakeMeter(estimate 纯函数包装)
// ---------------------------------------------------------------------------

/** fakeMeter 的结构面(消费侧以 `as unknown as TokenMeter` 收窄)。 */
export interface FakeMeterFace {
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement
  estimateMessage(message: Message): number
}

/**
 * 确定性 meter:每个 surface 节点按 `estimateMessage` 纯函数估价,且 heuristic
 * 与 route 两价相同(测试负载全为文本,不触达 image 的 route 定价分支)。
 */
export function createFakeMeter(): FakeMeterFace {
  return {
    estimateMessage: message => estimateMessage(message),
    measure: (session, _requestHeader) => {
      const nodes = session.surface.nodes.map((seq) => {
        // surface 节点都是现行日志 seq,事件必存在。
        // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
        const message = session.deriveEventMessage(session.eventAt(seq)!)
        const tokens = message === null ? 0 : estimateMessage(message)
        return { seq, tokens, heuristicTokens: tokens }
      })
      const totalTokens = nodes.reduce((sum, node) => sum + node.tokens, 0)
      return {
        logRevision: session.seq,
        baseline: { kind: 'none', tokens: 0 },
        surfaceDeltaTokens: totalTokens,
        totalTokens,
        surfaceTokens: totalTokens,
        nodes,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// fakeSummarizer(脚本式 RegionDependencies.summarize 替身)
// ---------------------------------------------------------------------------

/**
 * C3 结构合法的最小摘要:8 段标题齐备、关键两段各有正文、其余六段 (none)
 * (宽容边界内)。C3 起 region 在 shrink 校验前拒绝无结构摘要,溢出恢复/收敛等
 * 引擎桩的 fake 摘要用此常量(与真实摘要输出同构,非断言放水)。
 */
export const MINIMAL_VALID_SUMMARY = [
  '## Primary Request and Intent',
  '- x',
  '## Key Technical Concepts',
  '(none)',
  '## Files and Code',
  '(none)',
  '## Errors and Fixes',
  '(none)',
  '## Pending Jobs',
  '(none)',
  '## Current Work',
  '- y',
  '## Next Step',
  '(none)',
  '## Critical Context',
  '(none)',
].join('\n')

/** fakeSummarizer 的结构面:可调用 + 调用输入记录。 */
export interface FakeSummarizerFace {
  (input: SummarizationInput, agent: Agent, signal?: AbortSignal): Promise<SummaryResult>
  readonly calls: readonly SummarizationInput[]
}

/**
 * 脚本式 summarizer 替身:每次调用依次消费脚本一项;字符串=以该文本成功返回,
 * Error=原样抛出;脚本耗尽即失败(测试必须显式给足步骤,不隐式复用)。
 * 返回 SummaryResult 的非 llmStreamCall 变体(结构兼容 region 事务)。
 */
export function fakeSummarizer(script: ReadonlyArray<string | Error>): FakeSummarizerFace {
  const calls: SummarizationInput[] = []
  const face = ((input: SummarizationInput): Promise<SummaryResult> => {
    calls.push(input)
    const step = script[calls.length - 1]
    if (step === undefined) {
      return Promise.reject(new Error(`fake summarizer: script exhausted after ${calls.length - 1} call(s)`))
    }
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve({
      summary: [text(step)],
      provider: 'fake',
      model: 'fake-summarizer',
    })
  }) as unknown as FakeSummarizerFace
  Object.defineProperty(face, 'calls', { value: calls, enumerable: true })
  return face
}

// ---------------------------------------------------------------------------
// fakeAgent / fakeEngineContext(引擎监听器与 compactPressure 测试面)
// ---------------------------------------------------------------------------

/** 结构兼容引擎读法的最小 agent 面(session/options 是 compactPressure 全部触点)。 */
export function makeFakeAgent(session: Session, provider = 'p', model = 'm'): Agent {
  return {
    id: session.id,
    session,
    options: { provider, model },
  } as unknown as Agent
}

/** fake pruner 的结构面(overflow 恢复链的 spy 用)。 */
export interface FakePrunerFace {
  pruneSession(session: Session): unknown
}

/** fake ctx 可配置的模型信息(resolveModelInfo 的返回)。 */
export interface FakeModelInfo {
  contextWindow?: number
  defaultMaxTokens?: number
}

export interface FakeEngineContextHarness {
  /** 传给引擎实例的 ctx(测试里 as unknown as Context)。 */
  readonly ctx: unknown
  /** 按注册序取某事件监听器(测试显式派发)。 */
  listenersOf(event: string): Array<(...args: never[]) => unknown>
  /** logger.warn 收集。 */
  readonly warns: string[]
  /** logger.info 收集。 */
  readonly infos: string[]
  /** 配置 ctx.get('toolResultPruner') 的返回(undefined=可选消费缺席)。 */
  setPruner(pruner: FakePrunerFace | undefined): void
  /** 配置 resolveModelInfo 的返回(undefined=抛错,模拟无容量路由)。 */
  setModelInfo(info: FakeModelInfo | undefined): void
  /** 配置 ctx.waterfall('compaction/summary-error') 的返回(true=有 recover 监听者接住)。 */
  setWaterfallResult(result: boolean): void
}

/**
 * 引擎级单测的 ctx 结构面:声明 `_registerAutomaticCompaction` 与
 * `compactPressure`/`regionDependencies` 触达的全部读法(on/logger/get/
 * tokenMeter/llm.resolveModelInfo/waterfall/sessions.flush),不依赖真实 cordis。
 */
export function makeFakeEngineContext(meter: FakeMeterFace = createFakeMeter()): FakeEngineContextHarness {
  const listeners = new Map<string, Array<(...args: never[]) => unknown>>()
  const warns: string[] = []
  const infos: string[] = []
  let pruner: FakePrunerFace | undefined
  let modelInfo: FakeModelInfo | undefined
  let waterfallResult = false
  const ctx = {
    on: (event: string, listener: (...args: never[]) => unknown) => {
      const set = listeners.get(event) ?? []
      set.push(listener)
      listeners.set(event, set)
      return () => {
        listeners.set(event, set.filter(registered => registered !== listener))
      }
    },
    logger: {
      info: (message: string) => { infos.push(message) },
      warn: (message: string) => { warns.push(message) },
    },
    get: (name: string) => (name === 'toolResultPruner' ? pruner : undefined),
    tokenMeter: meter,
    llm: {
      resolveModelInfo: async (_provider: string, _model: string, _signal?: AbortSignal) => {
        if (modelInfo === undefined) throw new Error('fake llm: no model info configured')
        return {
          provider: _provider,
          model: _model,
          ...modelInfo.contextWindow === undefined ? {} : { context: { contextWindow: modelInfo.contextWindow } },
          ...modelInfo.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: modelInfo.defaultMaxTokens },
        }
      },
    },
    waterfall: (_event: string, _payload: unknown, _fallback: () => boolean) => waterfallResult,
    sessions: { flush: async () => {} },
  }
  return {
    ctx,
    listenersOf: event => [...(listeners.get(event) ?? [])],
    warns,
    infos,
    setPruner: (value) => { pruner = value },
    setModelInfo: (value) => { modelInfo = value },
    setWaterfallResult: (value) => { waterfallResult = value },
  }
}

// ---------------------------------------------------------------------------
// 引擎实例构造(Object.create 绕开构造器的文件/监听器副作用)
// ---------------------------------------------------------------------------

/** 引擎私有字段的写入面(2026-11-12 fork 的字段表,见 basic/index.ts:140-147)。 */
export interface EngineInternals {
  baselineConfig: BasicCompactionConfig
  config: ResolvedConfig
  appliedOverridesMtimeMs: number
  warnedPressureConfigTargets: Set<string>
  overflowRetries: WeakMap<Agent, number>
  overflowAgents: WeakMap<Session, Agent>
  ctx: unknown
}

/** 取引擎实例的私有字段面(测试只写不读原型方法之外的封装)。 */
export function engineInternals(engine: BasicCompactionEngine): EngineInternals {
  return engine as unknown as EngineInternals
}

/**
 * 不经构造器构造引擎实例:铺齐私有字段(config 解析与构造器同源),不落状态
 * 文件、不注册监听器、不读 overrides——需要哪个副作用由测试显式调用。
 */
export function makeEngine(ctx: unknown, baselineConfig: BasicCompactionConfig = {}): BasicCompactionEngine {
  const engine = Object.create(BasicCompactionEngine.prototype) as BasicCompactionEngine
  const internals = engineInternals(engine)
  internals.baselineConfig = baselineConfig
  internals.config = resolveConfig(baselineConfig)
  internals.appliedOverridesMtimeMs = -1
  internals.warnedPressureConfigTargets = new Set()
  internals.overflowRetries = new WeakMap()
  internals.overflowAgents = new WeakMap()
  internals.ctx = ctx
  return engine
}

/** 显式注册引擎的五个常驻监听器(私有方法,经结构面调用)。 */
export function registerAutomaticCompaction(engine: BasicCompactionEngine): void {
  const internals = engine as unknown as { _registerAutomaticCompaction(): void }
  internals._registerAutomaticCompaction()
}

/** 调用引擎私有 `_applyOverridesFromFile`(hotreload 面入口)。 */
export function applyOverridesFromFile(engine: BasicCompactionEngine, force = false): void {
  const internals = engine as unknown as { _applyOverridesFromFile(force?: boolean): void }
  internals._applyOverridesFromFile(force)
}

/** 调用引擎私有 `compactPressure`(convergence/压力循环入口)。 */
export function callCompactPressure(
  engine: BasicCompactionEngine,
  agent: Agent,
  header: EpochHeader,
  signal: AbortSignal,
  requireBelowThreshold: boolean,
): Promise<CompactionResult | null> {
  const internals = engine as unknown as {
    compactPressure(
      agent: Agent,
      header: EpochHeader,
      signal: AbortSignal,
      requireBelowThreshold: boolean,
    ): Promise<CompactionResult | null>
  }
  return internals.compactPressure(agent, header, signal, requireBelowThreshold)
}
