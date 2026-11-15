/**
 * C12 E2E 集成 + cache-guard 对照 + 基线采集（22 号 §5-C12）。
 *
 * 覆盖面（测试先行，全部走真实 detached Session + fake meter/summarizer）：
 *
 * 1. L3 长会话压缩：>20 个 surface 节点、多组 tool/result，低阈值注入经
 *    `agent/pre-step` 监听器真实触发 L3——断言 checkpoint 段落完整（8 标题 +
 *    C2 尾注 + C11 附件块并入同一条 user/message）、`compaction/start|end`
 *    配对、持久日志遮蔽段原文仍在（snapshotEvents 回读）、保留尾段逐字。
 * 2. stale 注入场景：先 L2 后 L3 顺序正确（占位符先落盘、摘要输入含占位符）、
 *    L2 后压力复测短路（清够 → 零摘要调用、无压缩事务、无熔断误报）。
 * 3. cache-guard 联测：以 `packages/cache-guard/src/prefix.ts` 的
 *    analyzeTransition 识别规则为断言基线——C6 的一次多节点 replace 与 C11 的
 *    单 replace 均呈现「一次前缀突变」（单转移、单边界、kind=prefix-mutation、
 *    段序不乱、后续转移全量保留 retention=1），而非碎片化（逐转移反复失稳）。
 *    段模型照 cache-guard 的 PromptSegment 语义（source=消息角色，text=内容文本）。
 * 4. 基线采集：压缩事务延迟（compaction/start→compaction/summary 事件 time 差 +
 *    挂钟耗时）、L2 回收量分布（三档负载 savedTokens）、rapid-refill 熔断频次
 *    （3 步窗口第 3 次连续触发跳闸）——`[c12-metrics]` console 输出汇总进
 *    `evals/reports/2026-11-14-c12-e2e-baseline.md`。
 *
 * 构造面（勘察 S'-1）：真实 `@deepseek-ai/dsh-session` detached Session；
 * `Session.create` 可携带 `SessionHeader.cwd`（绝对路径校验，dsh-session lib
 * validateSessionHeader）→ C11 附件 workspace 边界真实生效。deprecated 事件读法
 * 仅测试面回放一处 snapshotEvents（上游允许测试调用，行内豁免，stale.spec.ts:434
 * 先例）。cache-guard 为测试面相对路径结构导入（白名单限制不改 package.json，
 * 无运行时依赖——偏离说明见交付报告）。负载填充为纯字母/短词，不含 cache-guard
 * 易变模式 token（时间戳/uuid/hex），归因分类恒为 null → kind=prefix-mutation。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeTransition, commonChars, joinedText } from '../../cache-guard/src/prefix.ts'
import type { PromptAssembly } from '../../cache-guard/src/types.ts'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (start/summary/end event assertions).
import type {} from '@deepseek-ai/dsh-compaction'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  freezeMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/estimate'
import { STALE_PRUNE_MARKER } from '../src/stale/config.ts'
import { StaleToolResultPruner } from '../src/stale/index.ts'
import { REQUIRED_SUMMARY_TITLES } from '../src/basic/summarizer.ts'
import type { SummarizationInput } from '../src/basic/summarizer.ts'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy } from '../src/basic/config.ts'
import type { BasicCompactionConfig } from '../src/basic/types.ts'
import type { BasicCompactionEngine } from '../src/basic/index.ts'
import {
  appendRequestHeader,
  appendTurnStart,
  appendUserMessage,
  createFakeMeter,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  makePressureSession,
  MINIMAL_VALID_SUMMARY,
  registerAutomaticCompaction,
  text as textBlock,
} from './helpers/fakes.ts'
import type { FakeEngineContextHarness, FakeMeterFace, FakeSummarizerFace } from './helpers/fakes.ts'

// ---------------------------------------------------------------------------
// 基线配置与固定负载
// ---------------------------------------------------------------------------

/** 小 headroom 让测试窗口的阈值可触达（默认 headroom 65_536 会把压力预算打穿）。 */
const BASE_CONFIG: BasicCompactionConfig = { headroomTokens: 0, maxTokens: 4_096 }

/** C11 附件开启（22 号 §5-C11 默认预算 5/5000/50000 走 DEFAULT_ATTACHMENT_BUDGET）。 */
const L3_CONFIG: BasicCompactionConfig = { ...BASE_CONFIG, attachments: true }

/** 压力会话的固定负载（纯字母填充，不含 cache-guard 易变模式 token）。 */
const USER_PAD = 2_600

function pad(chars: number): string {
  return 'x'.repeat(chars)
}

function padded(prefix: string, chars: number): string {
  return `${prefix} ${pad(chars)}`
}

// ---------------------------------------------------------------------------
// 临时目录（DSH_HOME 状态文件 + C11 附件 workspace）
// ---------------------------------------------------------------------------

let homeDir = ''
const workspaceDirs: string[] = []

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'eterna-c12-home-'))
  process.env.DSH_HOME = homeDir
})

afterEach(async () => {
  delete process.env.DSH_HOME
  const cleanup = [rm(homeDir, { recursive: true, force: true })]
  for (const dir of workspaceDirs.splice(0)) {
    cleanup.push(rm(dir, { recursive: true, force: true }))
  }
  await Promise.all(cleanup)
})

/** C11 附件 workspace:两个真实文件（内容为断言锚点，纯字母无易变 token）。 */
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eterna-c12-ws-'))
  workspaceDirs.push(dir)
  await writeFile(
    join(dir, 'notes.md'),
    'venue booking confirmed for the grand hall\nstage rigging checklist attached to the contract\n',
    'utf8',
  )
  await writeFile(
    join(dir, 'brief.md'),
    'gala brief: two hundred guests, seated dinner, live quartet\n',
    'utf8',
  )
  return dir
}

function readState(): { rapidRefillCount?: number; lastRapidRefillAt?: string | null } {
  const path = join(homeDir, '.eterna', 'compaction.state.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, never>
}

// ---------------------------------------------------------------------------
// harness:ctx(含 Service 注册面) / 引擎 / 事件注入
// ---------------------------------------------------------------------------

/**
 * e2e 共用 fake ctx:makeFakeEngineContext 的结构面 + `reflect.provide`
 * (StaleToolResultPruner 的 Service 构造器注册面,stale.spec.ts:103 先例)。
 */
function makeE2eContext(meter: FakeMeterFace = createFakeMeter()): {
  harness: FakeEngineContextHarness
  ctx: Context
} {
  const harness = makeFakeEngineContext(meter)
  const ctx = { ...(harness.ctx as object), reflect: { provide: () => {} } }
  return { harness, ctx: ctx as unknown as Context }
}

/**
 * makeEngine 绕过构造器(不落状态文件),C7 私有字段必须显式铺齐
 * (basic-refill.spec.ts:111-118 先例——字段初始化器只在真构造器里跑)。
 */
function makeE2eEngine(ctx: Context, config: BasicCompactionConfig): BasicCompactionEngine {
  const engine = makeEngine(ctx, config)
  const seeded = engine as unknown as {
    refillStates: WeakMap<Agent, { stepsSinceCompaction: number; rapidStreak: number }>
    rapidRefillCount: number
    lastRapidRefillAt: string | null
  }
  seeded.refillStates = new WeakMap()
  seeded.rapidRefillCount = 0
  seeded.lastRapidRefillAt = null
  registerAutomaticCompaction(engine)
  return engine
}

type AppendFn = (type: string, data: unknown, ...opts: unknown[]) => SessionEvent

/**
 * 会话事件注入面:包装 append——每个事件(含 region/stale 内部落盘)同步推入
 * sink 并喂给全部 `session/event` 监听器(生产 post-commit append feed 语义,
 * stale tracker 与引擎重试清零都靠它)。必须在会话填充前安装。
 */
function instrumentSession(session: Session, harness: FakeEngineContextHarness): SessionEvent[] {
  const sink: SessionEvent[] = []
  const real = session.append.bind(session) as unknown as AppendFn
  ;(session as unknown as { append: AppendFn }).append = (type, data, ...opts) => {
    const event = real(type, data, ...opts)
    sink.push(event)
    for (const listener of harness.listenersOf('session/event')) {
      ;(listener as unknown as (target: Session, delivered: SessionEvent) => void)(session, event)
    }
    return event
  }
  return sink
}

type PreStepListener = (
  payload: { agent: Agent; signal: AbortSignal },
  next: () => Promise<unknown>,
) => Promise<unknown>

/** 按注册序派发全部 agent/pre-step 监听器(挂载序 = stale 先于 basic,22 号 §4-C6)。 */
async function dispatchPreStep(harness: FakeEngineContextHarness, agent: Agent): Promise<void> {
  const signal = new AbortController().signal
  for (const listener of harness.listenersOf('agent/pre-step')) {
    await (listener as unknown as PreStepListener)({ agent, signal }, async () => 'next-result')
  }
}

/** 影子化受保护 summarize(face.calls 记录;basic-overflow.spec.ts:44 先例)。 */
function stubSummarize(engine: BasicCompactionEngine, face: FakeSummarizerFace): void {
  ;(engine as unknown as { summarize: unknown }).summarize = face
}

function firstSummarizeCall(face: FakeSummarizerFace): SummarizationInput {
  const call = face.calls[0]
  if (call === undefined) throw new Error('expected at least one summarize call')
  return call
}

// ---------------------------------------------------------------------------
// 会话构造(带 SessionHeader.cwd 的真实 detached Session)
// ---------------------------------------------------------------------------

/** 带可选 cwd 的 detached Session(cwd 走 dsh-session 的绝对路径校验)。 */
function makeSessionWithCwd(id: string, cwd?: string): Session {
  if (cwd === undefined) return Session.create(SessionId(id))
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    cwd,
  }
  return Session.create(SessionId(id), undefined, header)
}

function putSystemMessage(session: Session, turn: number, body: string): void {
  session.append('system/message', { turn, step: 0, message: createSystemMessage(body) }, { surfaceOp: 'append' })
}

function putUserMessage(session: Session, body: string): void {
  session.append('user/message', createUserMessage({ content: [textBlock(body)], source: { kind: 'user' } }), { surfaceOp: 'append' })
}

function putAssistantToolCall(session: Session, turn: number, step: number, callId: string, name: string): void {
  const message = createAssistantMessage({
    content: [{ type: 'tool-call', id: ToolCallId(callId), name, arguments: '{}' }],
    source: { provider: 'p', model: 'm' },
  })
  session.append('assistant/message', { turn, step, message, stream: [] }, { surfaceOp: 'append' })
}

/** tool/call 是 log-only 事件(不上 surface,attachments.ts 头注)——附件清单提取源。 */
function putToolCallRecord(session: Session, turn: number, step: number, callId: string, name: string, argsJson: string): void {
  session.append('tool/call', { turn, step, callId: ToolCallId(callId), name, arguments: argsJson })
}

function putToolResult(session: Session, turn: number, step: number, callId: string, body: string): SessionEvent<'tool/result'> {
  return session.append('tool/result', {
    turn,
    step,
    message: createToolResultMessage({ callId: ToolCallId(callId), content: [textBlock(body)], isError: false }),
  }, { surfaceOp: 'append' })
}

function putAssistantText(session: Session, turn: number, step: number, body: string): void {
  const message = createAssistantMessage({
    content: [textBlock(body)],
    source: { provider: 'p', model: 'm' },
  })
  session.append('assistant/message', { turn, step, message, stream: [] }, { surfaceOp: 'append' })
}

/** 一次工具交互:assistant tool-call + tool/call 记录 + tool/result(返回结果事件)。 */
function putToolStep(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  name: string,
  argsJson: string,
  resultBody: string,
): SessionEvent<'tool/result'> {
  putAssistantToolCall(session, turn, step, callId, name)
  putToolCallRecord(session, turn, step, callId, name, argsJson)
  return putToolResult(session, turn, step, callId, resultBody)
}

// ---------------------------------------------------------------------------
// cache-guard 段模型:消息 → PromptSegment(source=角色,text=内容文本)
// ---------------------------------------------------------------------------

function messageText(message: Message): string {
  return message.content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool-call') return `→${block.name}`
    return `[${block.type}]`
  }).join('\n')
}

function assemblyOf(turn: number, messages: readonly Message[]): PromptAssembly {
  return { turn, segments: messages.map(message => ({ source: message.role, text: messageText(message) })) }
}

/** 汇合文本(段间单换行)上的字符级共同前缀——analyzeTransition 的对齐口径。 */
function joinedCommonPrefix(a: PromptAssembly, b: PromptAssembly): number {
  return commonChars(joinedText(a.segments), joinedText(b.segments))
}

/** L2 占位估价镜像(22 号 §4-C6 步骤 4 公式,stale.spec.ts:40 先例)。 */
function placeholderPrice(original: Message): number {
  if (original.role !== 'tool') throw new Error('expected a tool-result message')
  const placeholder = freezeMessage<ToolResultMessage>({ ...original, content: [textBlock(STALE_PRUNE_MARKER)] })
  return estimateMessage(placeholder)
}

/** L2 预计回收镜像:Σ(原文价 − 占位价);deriveEventMessage 为纯逐事件投影,与表面状态无关。 */
function expectedStaleSavings(session: Session, results: readonly SessionEvent<'tool/result'>[]): number {
  return results.reduce((sum, event) => {
    const original = session.deriveEventMessage(event)
    if (original === null) throw new Error('expected a derived message')
    return sum + estimateMessage(original) - placeholderPrice(original)
  }, 0)
}

/** 压力规格镜像(threshold = floor(min(W×ratio, W−O−B)),compactPressure 同源)。 */
function specOf(config: BasicCompactionConfig, contextWindow: number, reserved: number) {
  return resolveCompactSpec(resolveTargetPolicy(resolveConfig(config), { provider: 'p', model: 'm' }), contextWindow, reserved)
}

// ---------------------------------------------------------------------------
// 场景 1/2 共用:L3 长会话(23 个 surface 节点、8 组 tool/result)
// ---------------------------------------------------------------------------

const L3_WINDOW = 12_000
const L3_RESERVED = 1_000

const RESULT_PAD = 3_800
const TAIL_PAD = 2_800

/**
 * L3 长会话:turn1(系统头 + 3 组工具) → turn2(2 组) → turn3(2 组,其中 notes.md
 * 重复读取验证附件去重) + 文本回复。附件白名单只有 call-notes/call-brief/call-notes2
 * 三个 read;grep/search 均不在 ATTACHMENT_TOOL_NAMES(白名单过滤的现实对照)。
 * harness 注入须在填充前完成(stale/引擎的 session/event 监听器依赖 post-commit feed)。
 */
function buildLongSession(workspace: string, harness: FakeEngineContextHarness): {
  session: Session
  results: SessionEvent<'tool/result'>[]
  sink: SessionEvent[]
} {
  const session = makeSessionWithCwd('c12-l3', workspace)
  const sink = instrumentSession(session, harness)
  const results: SessionEvent<'tool/result'>[] = []
  appendTurnStart(session, 1)
  appendRequestHeader(session)
  putSystemMessage(session, 1, 'You are the gala planning assistant. Keep venue budgets consistent across files.')
  putUserMessage(session, padded('Plan the spring gala budget. Use the workspace files as the source of truth.', USER_PAD))
  results.push(putToolStep(session, 1, 1, 'call-notes', 'read', JSON.stringify({ path: join(workspace, 'notes.md') }), padded('Venue pricing notes from the booking contract.', RESULT_PAD)))
  results.push(putToolStep(session, 1, 2, 'call-brief', 'read', JSON.stringify({ path: join(workspace, 'brief.md') }), padded('Gala brief with guest counts and program outline.', RESULT_PAD)))
  results.push(putToolStep(session, 1, 3, 'call-grep', 'grep', JSON.stringify({ pattern: 'venue' }), padded('Grep matches across the planning folder.', RESULT_PAD)))
  putUserMessage(session, padded('Summarize the venue options against the budget cap.', USER_PAD))
  appendTurnStart(session, 2)
  putUserMessage(session, padded('Check the catering quotes next.', USER_PAD))
  results.push(putToolStep(session, 2, 1, 'call-catering', 'search', JSON.stringify({ query: 'catering' }), padded('Catering quotes retrieved from the vendor folder.', RESULT_PAD)))
  results.push(putToolStep(session, 2, 2, 'call-timeline', 'grep', JSON.stringify({ pattern: 'timeline' }), padded('Timeline matches from the planning notes.', RESULT_PAD)))
  putUserMessage(session, padded('Now cross-check the stage rigging requirements.', USER_PAD))
  appendTurnStart(session, 3)
  putUserMessage(session, padded('Pull the rigging checklist details.', USER_PAD))
  results.push(putToolStep(session, 3, 1, 'call-rigging', 'grep', JSON.stringify({ pattern: 'rigging' }), padded('Rigging requirements from the safety binder.', RESULT_PAD)))
  results.push(putToolStep(session, 3, 2, 'call-notes2', 'read', JSON.stringify({ path: join(workspace, 'notes.md') }), padded('Re-read of the venue pricing notes after the contract update.', RESULT_PAD)))
  putUserMessage(session, padded('Draft the committee summary now.', USER_PAD))
  putAssistantText(session, 3, 3, padded('Draft budget summary ready for the committee review meeting.', TAIL_PAD))
  putUserMessage(session, padded('Hold on, include the insurance line item too.', USER_PAD))
  return { session, results, sink }
}

/** checkpoint 派生消息的合文本(找不到即测试自身缺陷,直接失败)。 */
function checkpointTextOf(messages: readonly Message[]): { text: string; blocks: readonly ContentBlock[] } {
  const checkpoint = messages.find(message => message.role === 'user' && message.content.some(
    block => block.type === 'text' && block.text.includes('<compacted-summary>'),
  ))
  if (checkpoint === undefined) throw new Error('checkpoint message not found on the surface')
  const blocks = checkpoint.content
  return { text: blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n'), blocks }
}

// ---------------------------------------------------------------------------
// 场景 3/4/6 共用:L2 stale 会话(turn 1-2 老结果候选 + turn 3-4 保留组)
// ---------------------------------------------------------------------------

interface StaleSessionOptions {
  /** turn1-2 老结果负载(候选)。 */
  oldPadChars: number
  /** turn3-4 保留组用户消息负载。 */
  keepUserPadChars: number
  /** turn3-4 保留组结果负载。 */
  keepResultPadChars: number
}

interface StaleScenario {
  session: Session
  stale: StaleToolResultPruner
  oldResults: SessionEvent<'tool/result'>[]
  firstClearedText: string
  sink: SessionEvent[]
}

/**
 * stale 场景:turn1-2 的老 tool/result 全为文本大块(候选),turn3-4 为保留组;
 * request/header 必备(pre-step 触发链的 routedTarget 读法)。harness 注入在填充前
 * 安装(构造器注册的 session/event tracker 依赖 post-commit feed)。
 */
function buildStaleSession(
  harness: FakeEngineContextHarness,
  ctx: Context,
  options: StaleSessionOptions,
): StaleScenario {
  const stale = new StaleToolResultPruner(ctx, { keepGroups: 2, minSavingsTokens: 100, thresholdRatio: 0.5 })
  const session = Session.create(SessionId('c12-stale'))
  const sink = instrumentSession(session, harness)
  const oldResults: SessionEvent<'tool/result'>[] = []
  appendTurnStart(session, 1)
  putSystemMessage(session, 1, 'You are the gala planning assistant.')
  appendRequestHeader(session)
  putUserMessage(session, padded('Open the vendor folder and gather the quotes.', USER_PAD))
  oldResults.push(putToolStep(session, 1, 1, 'call-old-a', 'read', JSON.stringify({ path: 'quotes-a' }), pad(options.oldPadChars)))
  oldResults.push(putToolStep(session, 1, 2, 'call-old-b', 'grep', JSON.stringify({ pattern: 'quote' }), pad(options.oldPadChars)))
  appendTurnStart(session, 2)
  oldResults.push(putToolStep(session, 2, 1, 'call-old-c', 'read', JSON.stringify({ path: 'quotes-c' }), pad(options.oldPadChars)))
  oldResults.push(putToolStep(session, 2, 2, 'call-old-d', 'grep', JSON.stringify({ pattern: 'venue' }), pad(options.oldPadChars)))
  appendTurnStart(session, 3)
  putUserMessage(session, padded('Compare the two shortlisted venues side by side.', options.keepUserPadChars))
  putToolStep(session, 3, 1, 'call-kept-a', 'grep', JSON.stringify({ pattern: 'shortlist' }), pad(options.keepResultPadChars))
  appendTurnStart(session, 4)
  putUserMessage(session, padded('Write the recommendation memo for the committee.', options.keepUserPadChars))
  putToolStep(session, 4, 1, 'call-kept-b', 'grep', JSON.stringify({ pattern: 'memo' }), pad(options.keepResultPadChars))
  const firstEvent = oldResults[0]
  if (firstEvent === undefined) throw new Error('expected an old result event')
  const first = session.deriveEventMessage(firstEvent)
  if (first === null || first.role !== 'tool') throw new Error('expected a derived tool message')
  const firstBlock = first.content[0]
  const firstClearedText = firstBlock?.type === 'text' ? firstBlock.text : ''
  return { session, stale, oldResults, firstClearedText, sink }
}

// ---------------------------------------------------------------------------
// sink 断言小件
// ---------------------------------------------------------------------------

function sinkIndexOf(sink: readonly SessionEvent[], type: string): number {
  return sink.findIndex(event => event.type === type)
}

function isReplaceEvent(event: SessionEvent): boolean {
  const op = (event as unknown as { surfaceOp?: { op?: string } }).surfaceOp
  return op?.op === 'replace'
}

/** 原文锚点(结果文本首 30 字符)——持久日志/派生面双端核对。 */
function originalNeedle(event: SessionEvent<'tool/result'>): string {
  return messageText(event.data.message).slice(0, 30)
}

/** 占位符是否已在派生面上。 */
function staleMarkerLanded(session: Session): boolean {
  return session.deriveMessages().map(messageText).join('\n').includes('tool result cleared (stale)')
}

// ---------------------------------------------------------------------------
// 场景 1:L3 E2E(附件 + 持久日志 + 配对)
// ---------------------------------------------------------------------------

describe('C12 E2E:L3 长会话压缩(附件 + 持久日志)', () => {
  it('pre-step 触发 L3:checkpoint 8 标题+尾注+附件块并入单条 user/message,start|end 配对,遮蔽原文仍在持久日志,尾段逐字', async () => {
    const workspace = await makeWorkspace()
    const meter = createFakeMeter()
    const { harness, ctx } = makeE2eContext(meter)
    harness.setModelInfo({ contextWindow: L3_WINDOW, defaultMaxTokens: L3_RESERVED })
    const engine = makeE2eEngine(ctx, L3_CONFIG)
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    stubSummarize(engine, face)
    const { session, results, sink } = buildLongSession(workspace, harness)
    const agent = makeFakeAgent(session, 'p', 'm')

    // 前提:>20 节点;压力过阈值(负载失配在此显式失败,不让断言静默漂移)。
    expect(session.surface.nodes.length).toBeGreaterThan(20)
    const spec = specOf(L3_CONFIG, L3_WINDOW, L3_RESERVED)
    const totalBefore = meter.measure(session).totalTokens
    expect(totalBefore).toBeGreaterThanOrEqual(spec.thresholdTokens)
    const before = session.deriveMessages()

    const startedAt = performance.now()
    await dispatchPreStep(harness, agent)
    const elapsedMs = performance.now() - startedAt

    // 摘要恰好一次,无引擎告警(熔断零误报、TargetPressureConfigError 零抛出)。
    expect(face.calls.length).toBe(1)
    expect(harness.warns).toEqual([])

    // compaction/start|summary|checkpoint|end 事务序 + 配对 + 无 error。
    const startIdx = sinkIndexOf(sink, 'compaction/start')
    const summaryIdx = sinkIndexOf(sink, 'compaction/summary')
    const endIdx = sinkIndexOf(sink, 'compaction/end')
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(summaryIdx).toBeGreaterThan(startIdx)
    expect(endIdx).toBeGreaterThan(summaryIdx)
    const startEvent = sink[startIdx] as SessionEvent<'compaction/start'>
    const summaryEvent = sink[summaryIdx] as SessionEvent<'compaction/summary'>
    const endEvent = sink[endIdx] as SessionEvent<'compaction/end'>
    expect(summaryEvent.data.compactionId).toBe(startEvent.data.compactionId)
    expect(endEvent.data.compactionId).toBe(startEvent.data.compactionId)
    expect(endEvent.data.error).toBeUndefined()

    // checkpoint 段落完整:8 标题逐字 + C2 尾注 + C11 附件块(并入同一条 user/message)。
    const { text: checkpointText, blocks } = checkpointTextOf(session.deriveMessages())
    for (const title of REQUIRED_SUMMARY_TITLES) {
      expect(checkpointText).toContain(`## ${title}`)
    }
    expect(checkpointText).toContain('The messages following this checkpoint are the most recent ones')
    expect(checkpointText).toContain('## Attached Recent Files (re-read after compaction)')
    expect(checkpointText).toContain(`### ${join(workspace, 'notes.md')}`)
    expect(checkpointText).toContain(`### ${join(workspace, 'brief.md')}`)
    expect(checkpointText).toContain('venue booking confirmed for the grand hall')
    expect(checkpointText).toContain('gala brief: two hundred guests, seated dinner, live quartet')
    expect(blocks.length).toBe(4)
    const attachmentBlock = blocks[3]
    expect(attachmentBlock?.type === 'text' && attachmentBlock.text.includes('## Attached Recent Files')).toBe(true)

    // 持久日志:遮蔽段原文仍在(snapshotEvents 回读;测试面只读豁免)。
    // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
    const durableLog = session.snapshotEvents()
    for (const original of results) {
      const needle = originalNeedle(original)
      const replayed = durableLog.find(event => event.seq === original.seq)
      expect(replayed?.type).toBe('tool/result')
      const firstBlock = (replayed as SessionEvent<'tool/result'> | undefined)?.data.message.content[0]
      expect(firstBlock?.type === 'text' && firstBlock.text.startsWith(needle)).toBe(true)
      // 表面已遮蔽:节点不在 surface、派生消息无原文。
      expect(session.surface.nodes.includes(original.seq)).toBe(false)
      expect(session.deriveMessages().map(messageText).join('\n').includes(needle)).toBe(false)
    }

    // 保留尾段逐字:压缩后派生消息 = [system?, checkpoint, ...tail]。
    const after = session.deriveMessages()
    const systemCount = before.some(message => message.role === 'system') ? 1 : 0
    const tailCount = after.length - 1 - systemCount
    expect(after[systemCount]?.role).toBe('user')
    expect(after.slice(systemCount + 1)).toEqual(before.slice(before.length - tailCount))

    // 基线采集输出(汇总进 evals/reports)。
    const summaryTime = (summaryEvent as unknown as { time: number }).time
    const startTime = (startEvent as unknown as { time: number }).time
    console.log(
      '[c12-metrics] l3-transaction '
      + `surfaceNodes=${session.surface.nodes.length} shadowedSeqs=${summaryEvent.data.shadowedSeqs.length} `
      + `shadowedTokens=${summaryEvent.data.shadowedTokenCount} totalBefore=${totalBefore} `
      + `threshold=${spec.thresholdTokens} startToSummaryTimeDiffMs=${summaryTime - startTime} `
      + `wallClockMs=${elapsedMs.toFixed(3)}`,
    )
  })
})

// ---------------------------------------------------------------------------
// 场景 2:cache-guard 对照(L3 单 replace = 一次前缀突变)
// ---------------------------------------------------------------------------

describe('C12 cache-guard 对照:L3 单 replace', () => {
  it('一次前缀突变(单转移单边界,prefix-mutation),保留尾段段级逐字,后续轮次全量保留', async () => {
    const workspace = await makeWorkspace()
    const meter = createFakeMeter()
    const { harness, ctx } = makeE2eContext(meter)
    harness.setModelInfo({ contextWindow: L3_WINDOW, defaultMaxTokens: L3_RESERVED })
    const engine = makeE2eEngine(ctx, L3_CONFIG)
    stubSummarize(engine, fakeSummarizer([MINIMAL_VALID_SUMMARY]))
    const { session } = buildLongSession(workspace, harness)
    const agent = makeFakeAgent(session, 'p', 'm')
    const b1 = assemblyOf(1, session.deriveMessages())

    await dispatchPreStep(harness, agent)
    expect(harness.warns).toEqual([])

    const b2 = assemblyOf(2, session.deriveMessages())
    putUserMessage(session, padded('Continue with the venue shortlist for the committee.', 800))
    const b3 = assemblyOf(3, session.deriveMessages())

    // L3 转移:system 段保留,checkpoint 在第一 user 段位置改写 → 一次前缀突变。
    const t12 = analyzeTransition(b1, b2)
    expect(t12.divergence).not.toBeNull()
    expect(t12.divergence?.kind).toBe('prefix-mutation')
    expect(t12.divergence?.detail).toBe('segment-rewrite')
    expect(t12.divergence?.segmentIndex).toBe(1)
    expect(t12.commonPrefixLength).toBe(joinedCommonPrefix(b1, b2))
    expect(t12.commonPrefixLength).toBeGreaterThan(0)

    // 非碎片化核心:段序不乱——除 checkpoint 边界外,保留尾段段级逐字。
    expect(b2.segments.length).toBeLessThan(b1.segments.length)
    for (let index = 2; index < b2.segments.length; index += 1) {
      const tailIndex = b1.segments.length - (b2.segments.length - index)
      expect(b2.segments[index]).toEqual(b1.segments[tailIndex])
    }

    // 后续轮次纯追加:零失稳、全量保留(retention=1);全程恰一次突变。
    const t23 = analyzeTransition(b2, b3)
    expect(t23.divergence).toBeNull()
    expect(t23.commonPrefixLength).toBe(t23.previousLength)
    expect([t12, t23].filter(transition => transition.divergence !== null).length).toBe(1)
    console.log(
      '[c12-metrics] cache-guard-l3 '
      + `mutationAtSegment=${String(t12.divergence?.segmentIndex)} `
      + `commonPrefix=${t12.commonPrefixLength}/${t12.previousLength} `
      + `nextTransitionRetention=${t23.commonPrefixLength}/${t23.previousLength}`,
    )
  })
})

// ---------------------------------------------------------------------------
// 场景 3:L2→L3 联动(顺序正确 / 压力复测短路)
// ---------------------------------------------------------------------------

const L2_WINDOW = 11_000
const L2_RESERVED = 1_000
const STALE_THRESHOLD_RATIO = 0.5

describe('C12 E2E:L2→L3 联动', () => {
  function makeL2Harness(config: BasicCompactionConfig = BASE_CONFIG): {
    meter: FakeMeterFace
    harness: FakeEngineContextHarness
    ctx: Context
    spec: ReturnType<typeof specOf>
  } {
    const meter = createFakeMeter()
    const { harness, ctx } = makeE2eContext(meter)
    harness.setModelInfo({ contextWindow: L2_WINDOW, defaultMaxTokens: L2_RESERVED })
    return { meter, harness, ctx, spec: specOf(config, L2_WINDOW, L2_RESERVED) }
  }

  it('先 L2 后 L3:L2 占位先落盘,summarize 输入含占位符,start|end 配对且无熔断误报', async () => {
    const { meter, harness, ctx, spec } = makeL2Harness()
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    // 老结果小负载(回收后仍过引擎阈值)+ 保留组大负载 → L2 清不够,L3 必跑。
    // buildStaleSession 先注册 stale 的监听器;引擎必须后建——挂载序 = 派发序
    // (stale 行先于 compaction 组,22 号 §4-C6),否则 pre-step 会先跑 L3。
    const { session, oldResults, sink } = buildStaleSession(harness, ctx, {
      oldPadChars: 1_500,
      keepUserPadChars: 16_000,
      keepResultPadChars: 1_200,
    })
    const engine = makeE2eEngine(ctx, BASE_CONFIG)
    stubSummarize(engine, face)
    const agent = makeFakeAgent(session, 'p', 'm')

    const staleThreshold = Math.floor(L2_WINDOW * STALE_THRESHOLD_RATIO)
    const totalBefore = meter.measure(session).totalTokens
    const savings = expectedStaleSavings(session, oldResults)
    expect(totalBefore).toBeGreaterThanOrEqual(staleThreshold)
    expect(totalBefore - savings).toBeGreaterThanOrEqual(spec.thresholdTokens)

    await dispatchPreStep(harness, agent)

    // L2 落了占位符,且先于 L3 事务(注册序 = 挂载序:stale 先于 basic)。占位符
    // 落盘证明看持久 append 面(sink):L3 收敛后老节点被 checkpoint 遮蔽,派生
    // 面不再可见——短路面检查属短路场景(无 L3),此处不适用。
    const replaceEvents = sink.filter(event => event.type === 'tool/result' && isReplaceEvent(event))
    const firstReplaceIdx = sink.findIndex(event => event.type === 'tool/result' && isReplaceEvent(event))
    const firstStartIdx = sinkIndexOf(sink, 'compaction/start')
    expect(firstReplaceIdx).toBeGreaterThanOrEqual(0)
    expect(firstStartIdx).toBeGreaterThan(firstReplaceIdx)
    expect(replaceEvents.length).toBe(oldResults.length)
    expect(replaceEvents.every(event => (event as SessionEvent<'tool/result'>).data.message.content.some(
      block => block.type === 'text' && block.text === STALE_PRUNE_MARKER,
    ))).toBe(true)

    // L3 恰好一次;摘要输入(遮蔽区重放)包含 L2 占位符——顺序的输入级证明。
    expect(face.calls.length).toBe(1)
    const input = firstSummarizeCall(face)
    expect(input.messages.some(message => message.content.some(
      block => block.type === 'text' && block.text.includes('tool result cleared (stale)'),
    ))).toBe(true)

    // 事务配对 + 零告警(熔断零误报)。
    const summaryIdx = sinkIndexOf(sink, 'compaction/summary')
    const endIdx = sinkIndexOf(sink, 'compaction/end')
    expect(summaryIdx).toBeGreaterThan(firstStartIdx)
    expect(endIdx).toBeGreaterThan(summaryIdx)
    const endEvent = sink[endIdx] as SessionEvent<'compaction/end'>
    expect(endEvent.data.error).toBeUndefined()
    expect(harness.warns).toEqual([])
    expect(harness.warns.some(message => message.includes('rapid-refill breaker'))).toBe(false)

    const summaryEvent = sink[summaryIdx] as SessionEvent<'compaction/summary'>
    console.log(
      '[c12-metrics] l2-then-l3 '
      + `staleSavedTokens=${savings} totalBefore=${totalBefore} postL2=${totalBefore - savings} `
      + `threshold=${spec.thresholdTokens} shadowedTokens=${summaryEvent.data.shadowedTokenCount}`,
    )
  })

  it('L2 后压力复测短路:L2 清够 → 零摘要调用、无压缩事务、无熔断误报', async () => {
    const { meter, harness, ctx, spec } = makeL2Harness()
    const face = fakeSummarizer([])
    // 老结果大负载:L2 一次清够 → 复测低于阈值,不重复压缩。stale 先注册(挂载序)。
    const { session, oldResults, sink } = buildStaleSession(harness, ctx, {
      oldPadChars: 4_800,
      keepUserPadChars: 400,
      keepResultPadChars: 400,
    })
    const engine = makeE2eEngine(ctx, BASE_CONFIG)
    stubSummarize(engine, face)
    const agent = makeFakeAgent(session, 'p', 'm')

    const staleThreshold = Math.floor(L2_WINDOW * STALE_THRESHOLD_RATIO)
    const totalBefore = meter.measure(session).totalTokens
    const savings = expectedStaleSavings(session, oldResults)
    expect(totalBefore).toBeGreaterThanOrEqual(staleThreshold)
    expect(totalBefore - savings).toBeLessThan(spec.thresholdTokens)

    await dispatchPreStep(harness, agent)

    expect(staleMarkerLanded(session)).toBe(true)
    expect(face.calls.length).toBe(0)
    expect(sink.some(event => event.type === 'compaction/start')).toBe(false)
    expect(harness.warns).toEqual([])
    console.log(
      '[c12-metrics] l2-short-circuit '
      + `totalBefore=${totalBefore} staleSavedTokens=${savings} postL2=${totalBefore - savings} `
      + `threshold=${spec.thresholdTokens} summarizeCalls=0`,
    )
  })
})

// ---------------------------------------------------------------------------
// 场景 4:cache-guard 对照(L2 一次多节点 replace)
// ---------------------------------------------------------------------------

describe('C12 cache-guard 对照:L2 一次多节点 replace', () => {
  it('单转移单边界突变(prefix-mutation),段序不乱、恰好候选段文本变化,后续轮次全量保留', async () => {
    const meter = createFakeMeter()
    const { harness, ctx } = makeE2eContext(meter)
    const { session, stale, oldResults, firstClearedText, sink } = buildStaleSession(harness, ctx, {
      oldPadChars: 4_800,
      keepUserPadChars: 400,
      keepResultPadChars: 400,
    })

    const a1 = assemblyOf(1, session.deriveMessages())
    const totalBefore = meter.measure(session).totalTokens
    const mirrorSavings = expectedStaleSavings(session, oldResults)
    const result = stale.pruneStale(session, L2_WINDOW)
    expect(result).not.toBeNull()
    expect(result?.pruned.length).toBe(oldResults.length)
    expect(result?.savedTokens).toBe(mirrorSavings)

    const a2 = assemblyOf(2, session.deriveMessages())
    putUserMessage(session, padded('Proceed to the vendor outreach.', 800))
    const a3 = assemblyOf(3, session.deriveMessages())

    // 一次 pass 多节点落盘:sink 里候选数的 replace 事件,全部在本次调用内。
    const replaceEvents = sink.filter(event => event.type === 'tool/result' && isReplaceEvent(event))
    expect(replaceEvents.length).toBe(oldResults.length)

    // L2 转移:首个候选段原位改写 → 一次前缀突变,边界前缀保留。
    const t12 = analyzeTransition(a1, a2)
    expect(t12.divergence).not.toBeNull()
    expect(t12.divergence?.kind).toBe('prefix-mutation')
    expect(t12.divergence?.detail).toBe('segment-rewrite')
    expect(t12.divergence?.source).toBe('tool')
    const firstClearedIdx = a1.segments.findIndex(segment => segment.text === firstClearedText)
    expect(firstClearedIdx).toBeGreaterThan(0)
    expect(t12.divergence?.segmentIndex).toBe(firstClearedIdx)
    expect(t12.commonPrefixLength).toBe(joinedCommonPrefix(a1, a2))
    expect(t12.commonPrefixLength).toBeGreaterThan(0)

    // 非碎片化结构面:段数不变、source 逐位一致、恰好候选段文本变化(全部原地改写)。
    expect(a2.segments.length).toBe(a1.segments.length)
    expect(a2.segments.every((segment, index) => segment.source === a1.segments[index]?.source)).toBe(true)
    const changedIdx = a1.segments
      .map((segment, index) => (a2.segments[index]?.text !== segment.text ? index : -1))
      .filter(index => index >= 0)
    expect(changedIdx.length).toBe(oldResults.length)
    expect(changedIdx[0]).toBe(firstClearedIdx)

    // 后续轮次纯追加:零失稳、全量保留;全程恰一次突变。
    const t23 = analyzeTransition(a2, a3)
    expect(t23.divergence).toBeNull()
    expect(t23.commonPrefixLength).toBe(t23.previousLength)
    expect([t12, t23].filter(transition => transition.divergence !== null).length).toBe(1)
    expect(totalBefore).toBeGreaterThanOrEqual(Math.floor(L2_WINDOW * STALE_THRESHOLD_RATIO))
    console.log(
      '[c12-metrics] cache-guard-l2 '
      + `cleared=${String(result?.pruned.length)} savedTokens=${String(result?.savedTokens)} `
      + `mutationAtSegment=${String(t12.divergence?.segmentIndex)} `
      + `commonPrefix=${t12.commonPrefixLength}/${t12.previousLength} `
      + `nextTransitionRetention=${t23.commonPrefixLength}/${t23.previousLength}`,
    )
  })
})

// ---------------------------------------------------------------------------
// 场景 5/6:基线采集(rapid-refill 熔断频次 + L2 回收量分布)
// ---------------------------------------------------------------------------

describe('C12 基线采集', () => {
  it('rapid-refill 熔断频次:3 步窗口内第 3 次连续压力触发跳闸,state 计数落盘', async () => {
    const meter = createFakeMeter()
    const { harness, ctx } = makeE2eContext(meter)
    harness.setModelInfo({ contextWindow: 10_000, defaultMaxTokens: 1_000 })
    const engine = makeE2eEngine(ctx, BASE_CONFIG)
    stubSummarize(engine, fakeSummarizer([MINIMAL_VALID_SUMMARY, MINIMAL_VALID_SUMMARY, MINIMAL_VALID_SUMMARY]))
    const session = makePressureSession('x'.repeat(16_000)).session
    const agent = makeFakeAgent(session, 'p', 'm')
    const spec = specOf(BASE_CONFIG, 10_000, 1_000)
    const refill = (): void => {
      while (meter.measure(session).totalTokens < spec.thresholdTokens + 1_000) {
        appendUserMessage(session, 'x'.repeat(16_000))
      }
    }

    // 步 1、2 触发并压缩(零误报);步 3 连击达限 → 熔断跳过本次自动压缩。
    await dispatchPreStep(harness, agent)
    expect(harness.warns).toEqual([])
    refill()
    await dispatchPreStep(harness, agent)
    expect(harness.warns).toEqual([])
    refill()
    const generationBeforeTrip = session.surface.replaceGeneration
    await dispatchPreStep(harness, agent)
    expect(harness.warns.some(message => message.includes('rapid-refill breaker'))).toBe(true)
    expect(session.surface.replaceGeneration).toBe(generationBeforeTrip)
    const state = readState()
    expect(state.rapidRefillCount).toBe(1)
    expect(typeof state.lastRapidRefillAt).toBe('string')
    console.log(
      `[c12-metrics] rapid-refill window=3 limit=3 trips=1 thresholdTokens=${spec.thresholdTokens} `
      + `lastRapidRefillAt=${String(state.lastRapidRefillAt)}`,
    )
  })

  it('L2 回收量分布:三档负载 savedTokens 单调增长且与公式镜像一致', () => {
    const rows: Array<{ padChars: number; pruned: number; savedTokens: number }> = []
    for (const padChars of [2_000, 4_000, 8_000]) {
      const meter = createFakeMeter()
      const { harness, ctx } = makeE2eContext(meter)
      const stale = new StaleToolResultPruner(ctx, { keepGroups: 1, minSavingsTokens: 1, thresholdRatio: 0.5 })
      const session = Session.create(SessionId('c12-sweep'))
      instrumentSession(session, harness)
      appendTurnStart(session, 1)
      const oldResults = [
        putToolStep(session, 1, 1, 'call-s1', 'read', JSON.stringify({ path: 'a' }), pad(padChars)),
        putToolStep(session, 1, 2, 'call-s2', 'grep', JSON.stringify({ pattern: 'b' }), pad(padChars)),
        putToolStep(session, 1, 3, 'call-s3', 'read', JSON.stringify({ path: 'c' }), pad(padChars)),
        putToolStep(session, 1, 4, 'call-s4', 'grep', JSON.stringify({ pattern: 'd' }), pad(padChars)),
      ]
      appendTurnStart(session, 2)
      putToolStep(session, 2, 1, 'call-kept', 'grep', JSON.stringify({ pattern: 'keep' }), pad(400))
      const mirrorSavings = expectedStaleSavings(session, oldResults)
      const result = stale.pruneStale(session, 400)
      expect(result).not.toBeNull()
      expect(result?.pruned.length).toBe(oldResults.length)
      expect(result?.savedTokens).toBe(mirrorSavings)
      rows.push({ padChars, pruned: result?.pruned.length ?? 0, savedTokens: result?.savedTokens ?? 0 })
    }
    expect(rows[0]?.savedTokens ?? 0).toBeGreaterThan(0)
    expect(rows[1]?.savedTokens ?? 0).toBeGreaterThan(rows[0]?.savedTokens ?? 0)
    expect(rows[2]?.savedTokens ?? 0).toBeGreaterThan(rows[1]?.savedTokens ?? 0)
    console.log(`[c12-metrics] l2-savings-sweep ${rows.map(row => `${String(row.padChars)}c:${String(row.pruned)}nodes/${String(row.savedTokens)}tok`).join(' | ')}`)
  })
})
