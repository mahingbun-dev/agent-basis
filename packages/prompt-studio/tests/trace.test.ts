/**
 * 循环轨迹投影单测(T7.4 管线):
 * - 事件折叠(turn 配对/耗时/token/工具配对/审批事件配对/推理摘要);
 * - 容错(坏行 skipped;字段缺失降级;未识别事件与容器头行不计;坏帧/坏文件降级);
 * - zstd 多帧容器解码(真实帧 + 魔数重同步 + torn 尾巴 + 坏帧跳过);
 * - 大文件防御(尾部 N MB 窗口:窗口切进帧中间仍可重同步投影);
 * - T7.0 真实日志脱敏 fixture(tests/fixtures/t7-session-fa97514a-sanitized.jsonl,
 *   由 scripts/gen-trace-fixture.mjs 生成)投影快照——逐字段钉死口径;
 * - 会话列表(目录约定/标题/usage 折叠/mtime 排序/limit)。
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rmRetry } from './rm-retry.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decodeZstdLog, listTraceSessions, projectSessionTrace, readSessionTrace, scanZstdFrames,
  TRACE_ARGS_PREVIEW_LIMIT, TRACE_MAX_LOG_BYTES, TRACE_REASONING_PREVIEW_LIMIT,
} from '../src/trace.ts'

/** fixture 路径(T7.0 spike 真实日志脱敏产物;生成器 scripts/gen-trace-fixture.mjs)。 */
const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 't7-session-fa97514a-sanitized.jsonl')

function eventLine(type: string, time: number, data: Record<string, unknown>): string {
  return JSON.stringify({ type, time, data })
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** T7.0 真实日志脱敏 fixture 行(生成器 scripts/gen-trace-fixture.mjs)。 */
const fixtureLines = readFileSync(FIXTURE_PATH, 'utf8').split('\n').filter(l => l.trim().length > 0)

function goodSessionLines(): string[] {
  return [
    eventLine('turn/start', 1000, { turn: 1 }),
    eventLine('tool/call', 1100, { turn: 1, step: 1, callId: 'c1', name: 'budget_calc', arguments: '{"budget":100}' }),
    eventLine('tool/result', 1250, { turn: 1, message: { toolCallId: 'c1' } }),
    eventLine('tool/call', 1300, { turn: 1, step: 2, callId: 'c2', name: 'ask_user_question', arguments: '{"q":"是否继续"}' }),
    eventLine('tool/result', 1800, { turn: 1, message: { toolCallId: 'c2', isError: true }, error: { name: 'RejectedError' } }),
    eventLine('assistant/message', 1900, { turn: 1, usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } }),
    eventLine('turn/end', 2000, { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('projectSessionTrace(事件折叠)', () => {
  it('turn 配对:起止/耗时/结束原因/usage/工具配对(ask_user_question 是普通工具,不产生审批点)', () => {
    const trace = projectSessionTrace('session-x', goodSessionLines())
    expect(trace.sessionId).toBe('session-x')
    expect(trace.turns).toHaveLength(1)
    const turn = trace.turns[0]
    expect(turn?.turn).toBe(1)
    expect(turn?.startedAt).toBe(iso(1000))
    expect(turn?.endedAt).toBe(iso(2000))
    expect(turn?.durationMs).toBe(1000)
    expect(turn?.endReason).toBe('completed')
    expect(turn?.usage).toEqual({ inputTokens: 100, outputTokens: 40, totalTokens: 140 })
    expect(turn?.reasoningPreview).toBeNull()
    expect(turn?.tools).toHaveLength(2)
    const c1 = turn?.tools.find(tool => tool.callId === 'c1')
    expect(c1?.durationMs).toBe(150)
    expect(c1?.isError).toBe(false)
    const c2 = turn?.tools.find(tool => tool.callId === 'c2')
    expect(c2?.isError).toBe(true)
    expect(c2?.errorName).toBe('RejectedError')
    expect(c2?.argsPreview).toContain('是否继续')
    // T7.4 口径:审批点来自 approval/asked 审计事件,不是审批类工具名
    expect(turn?.approvalPoints).toEqual([])
    expect(trace.events).toEqual({ total: 7, projected: 7, skipped: 0 })
  })

  it('审批事件:approval/asked(callId 归轮)+ approval/decided 同 id 配对(outcome/decidedAt)', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('tool/call', 1100, { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }),
      // asked 带 callId → 归到该工具所在轮;decided 与 asked 同 id 配对
      eventLine('approval/asked', 1150, { id: 'ap-1', toolName: 'bash', callId: 'call-1', reason: 'sandbox 提权' }),
      eventLine('approval/decided', 1400, { id: 'ap-1', outcome: 'allowed-once' }),
      eventLine('tool/result', 1500, { turn: 1, message: { toolCallId: 'call-1' } }),
      eventLine('turn/end', 1600, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('s-ap', lines)
    expect(trace.turns[0]?.approvalPoints).toEqual([
      { callId: 'call-1', name: 'bash', at: iso(1150), outcome: 'allowed-once', decidedAt: iso(1400) },
    ])
    expect(trace.events).toEqual({ total: 6, projected: 6, skipped: 0 })
  })

  it('审批事件:asked 无 callId 归最近轮;拒绝结果标记 outcome=rejected;decided 未配对不计 projected', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 3 }),
      eventLine('approval/asked', 1100, { id: 'ap-2', toolName: 'write' }), // 无 callId → currentTurn
      eventLine('approval/decided', 1300, { id: 'ap-2', outcome: 'rejected' }),
      eventLine('approval/decided', 1400, { id: 'ap-unknown', outcome: 'cancelled' }), // 配不上:不计
      eventLine('turn/end', 1500, { turn: 3, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('s-reject', lines)
    expect(trace.turns[0]?.approvalPoints).toEqual([
      { callId: '', name: 'write', at: iso(1100), outcome: 'rejected', decidedAt: iso(1300) },
    ])
    expect(trace.events).toEqual({ total: 5, projected: 4, skipped: 0 })
  })

  it('推理摘要:assistant 消息 reasoning 块拼接截断;最后一条胜出;无 reasoning 块为 null', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('assistant/message', 1100, {
        turn: 1,
        message: { role: 'assistant', content: [
          { type: 'reasoning', text: '第一步推理。' },
          { type: 'text', text: '可见回复' },
        ] },
      }),
      eventLine('assistant/message', 1200, {
        turn: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '只有文本' }] },
      }),
      eventLine('assistant/message', 1300, {
        turn: 1,
        message: { role: 'assistant', content: [{ type: 'reasoning', text: '终局推理' }] },
      }),
      eventLine('turn/end', 1400, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('s-reason', lines)
    expect(trace.turns[0]?.reasoningPreview).toBe('终局推理')
    // 推理超长截断(上限 + 省略号)
    const long = 'x'.repeat(TRACE_REASONING_PREVIEW_LIMIT + 50)
    const trace2 = projectSessionTrace('s-reason2', [
      eventLine('assistant/message', 1, { turn: 9, message: { role: 'assistant', content: [{ type: 'reasoning', text: long }] } }),
    ])
    expect(trace2.turns[0]?.reasoningPreview?.length).toBe(TRACE_REASONING_PREVIEW_LIMIT + 1)
    expect(trace2.turns[0]?.reasoningPreview?.endsWith('…')).toBe(true)
  })

  it('容错:坏 JSON 行计 skipped,未识别事件与容器头行不计,缺 turn 落 0 号未知节点', () => {
    const lines = [
      'not-json-at-all',
      JSON.stringify({ type: 'mystery/event', time: 1, data: {} }),
      JSON.stringify({ type: 'session', version: 4, id: 'session-z', createdAt: 1 }), // 容器头行
      eventLine('turn/start', 10, { turn: 2 }),
      eventLine('turn/end', 20, {}), // 无 turn 字段 → 0 号桶,不炸
      '{"type":', // 坏行
    ]
    const trace = projectSessionTrace('session-y', lines)
    expect(trace.events.total).toBe(6)
    expect(trace.events.skipped).toBe(2)
    expect(trace.turns.map(turn => turn.turn).sort((a, b) => a - b)).toEqual([0, 2])
    expect(trace.turns.find(turn => turn.turn === 0)?.endReason).toBeNull()
  })

  it('argsPreview 超长截断(200 上限)', () => {
    const long = `{"k":"${'x'.repeat(500)}"}`
    const trace = projectSessionTrace('s', [eventLine('tool/call', 1, { turn: 1, callId: 'c', name: 't', arguments: long })])
    expect(trace.turns[0]?.tools[0]?.argsPreview.length).toBe(TRACE_ARGS_PREVIEW_LIMIT + 1)
    expect(trace.turns[0]?.tools[0]?.argsPreview.endsWith('…')).toBe(true)
  })

  it('空事件流 → 空轮次树', () => {
    const trace = projectSessionTrace('empty', [])
    expect(trace.turns).toEqual([])
    expect(trace.events).toEqual({ total: 0, projected: 0, skipped: 0 })
  })
})

describe('zstd 多帧容器解码', () => {
  it('scanZstdFrames/decodeZstdLog:多帧拼接 + torn 尾巴忽略', () => {
    const frame1 = zstdCompressSync(Buffer.from('{"type":"turn/start","time":1,"data":{"turn":1}}\n', 'utf8'))
    const frame2 = zstdCompressSync(Buffer.from('{"type":"turn/end","time":2,"data":{"turn":1,"reason":{"kind":"completed"}}}\n', 'utf8'))
    const torn = frame1.subarray(0, 3) // 魔数不完整的尾巴(不足一帧头)
    const buffer = Buffer.concat([frame1, frame2, torn])
    expect(scanZstdFrames(buffer)).toHaveLength(2)
    const text = decodeZstdLog(buffer)
    const trace = projectSessionTrace('z', text.split('\n'))
    expect(trace.turns).toHaveLength(1)
    expect(trace.turns[0]?.durationMs).toBe(1)
  })

  it('魔数重同步:垃圾前缀/窗口切进帧中间,扫描仍找到后续整帧', () => {
    const payload = Array.from({ length: 50 }, (_, i) => eventLine('turn/end', i, { turn: i + 1 })).join('\n')
    const frame = zstdCompressSync(Buffer.from(`${payload}\n`, 'utf8'))
    const small = zstdCompressSync(Buffer.from(`${eventLine('turn/end', 999, { turn: 99 })}\n`, 'utf8'))
    // 前缀垃圾 + 完整大帧:扫描起点落在垃圾里 → 重同步后仍解出大帧
    const withGarbage = Buffer.concat([Buffer.from('GARBAGE-NOT-A-FRAME', 'utf8'), frame])
    expect(scanZstdFrames(withGarbage)).toHaveLength(1)
    const trace = projectSessionTrace('z-resync', decodeZstdLog(withGarbage).split('\n'))
    expect(trace.events.total).toBe(50)
    // 大帧中间切开:窗口只含大帧尾部碎片 + 小帧 → 重同步只解出小帧
    const cut = Buffer.concat([frame.subarray(frame.length - 100), small])
    const frames = scanZstdFrames(cut)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.start).toBe(100) // 重同步点=小帧魔数
  })

  it('坏帧跳过(decodeZstdLog 解析失败降级):伪魔数帧不影响相邻真帧', () => {
    const good = zstdCompressSync(Buffer.from(`${eventLine('turn/start', 1, { turn: 1 })}\n`, 'utf8'))
    // 伪魔数:魔数后跟非法帧头(descriptor 保留位非 0)
    const fake = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from([0xff, 0x00, 0x11, 0x22, 0x33])])
    const buffer = Buffer.concat([fake, good])
    const text = decodeZstdLog(buffer)
    expect(text).toBe(`${eventLine('turn/start', 1, { turn: 1 })}\n`)
  })
})

describe('T7.0 真实日志脱敏 fixture:投影快照(字段口径钉死)', () => {
  it('fixture 与源会话同构:29 行,含双标题与两轮 usage(防生成器漂移)', () => {
    expect(fixtureLines).toHaveLength(29)
    expect(JSON.parse(fixtureLines[0] ?? '')).toMatchObject({ type: 'session', id: 'session-fa97514a-b440-4e70-ac92-b2542283ca26' })
    const types = fixtureLines.map(l => String((JSON.parse(l) as { type: unknown }).type))
    expect(types.filter(t => t === 'turn/start')).toHaveLength(2)
    expect(types.filter(t => t === 'turn/end')).toHaveLength(2)
    expect(types.filter(t => t === 'assistant/message')).toHaveLength(2)
    expect(types.filter(t => t === 'session/title')).toHaveLength(2)
    expect(types.filter(t => t === 'tool/call')).toHaveLength(0)
  })

  it('projectSessionTrace 快照:两轮逐字段钉死(起止/耗时/endReason/usage/空工具/空审批/计数)', () => {
    const trace = projectSessionTrace('session-fa97514a-b440-4e70-ac92-b2542283ca26', fixtureLines)
    expect(trace.sessionId).toBe('session-fa97514a-b440-4e70-ac92-b2542283ca26')
    // projected 从 6 升到 19:T8 起额外折叠 step/start|end、request/header|context、
    // user/message、session/title(T7.4 只折叠 4 类 + 审批 2 类)。
    expect(trace.events).toEqual({ total: 29, projected: 19, skipped: 0 })
    expect(trace.turns).toHaveLength(2)

    const [first, second] = trace.turns
    expect(first).toMatchObject({
      turn: 1,
      startedAt: iso(1793986073587),
      endedAt: iso(1793986074345),
      durationMs: 758,
      endReason: 'completed',
      usage: { inputTokens: 10070, outputTokens: 2, totalTokens: 18520 },
      reasoningPreview: null,
      tools: [],
      approvalPoints: [],
    })
    expect(second).toMatchObject({
      turn: 2,
      startedAt: iso(1793986083686),
      endedAt: iso(1793986084541),
      durationMs: 855,
      endReason: 'completed',
      usage: { inputTokens: 10082, outputTokens: 2, totalTokens: 19940 },
      reasoningPreview: null,
      tools: [],
      approvalPoints: [],
    })

    // —— step 级归因(本轮唯一一步)——
    expect(first?.steps).toHaveLength(1)
    expect(first?.steps[0]).toMatchObject({
      step: 1,
      startedAt: iso(1793986073628),
      endedAt: iso(1793986074344),
      wallMs: 716,
      // TTFT 口径 = 官方首 token 语义(不是 stream[0].time)
      ttftMs: 696,
      genMs: 17,
      toolMs: 0,
      otherMs: 3,
      toolCalls: 0,
      toolErrors: 0,
      toolNames: [],
    })
    // 关键口径:promptTokens = input + cacheRead + cacheWrite,不是 usage.inputTokens。
    // fixture 里 input=10070、cacheRead=8448 → 真实送进模型的上下文是 18518。
    expect(first?.steps[0]?.promptTokens).toBe(18518)
    expect(first?.steps[0]?.tokens).toEqual({
      input: 10070, output: 2, cacheRead: 8448, cacheWrite: 0, billed: 18520,
    })

    // 轮级聚合 = 各 step 求和;墙钟来自 turn/start→turn/end(与 step 墙钟不必相等)。
    expect(first?.time).toEqual({
      wallMs: 758, ttftMs: 696, genMs: 17, toolMs: 0, otherMs: 3, observedSteps: 1,
    })
    expect(first?.tokens).toEqual({
      input: 10070, output: 2, cacheRead: 8448, cacheWrite: 0, billed: 18520,
    })
    expect(second?.time).toEqual({
      wallMs: 855, ttftMs: 809, genMs: 20, toolMs: 0, otherMs: 2, observedSteps: 1,
    })

    // —— 会话分析面 ——
    expect(trace.analysis.session).toEqual({
      createdAt: iso(1793986073570),
      cwd: '/tmp/t7-spike-ws-48637',
      preset: 'standard',
      origin: null,
      delegationDepth: 0,
    })
    expect(trace.analysis.title).toBe('要求仅回复在线二字')
    expect(trace.analysis.route).toBe('eterna/deepseek-flash')
    // fixture 无 request/context 事件 → 窗口未知,必须是 null 而不是编一个数。
    expect(trace.analysis.contextWindow).toBeNull()
    expect(trace.analysis.tokens).toEqual({
      input: 20152, output: 4, cacheRead: 18304, cacheWrite: 0, billed: 38460,
    })
    expect(trace.analysis.counts).toEqual({
      turns: 2, steps: 2, modelCalls: 2, toolCalls: 0, userMessages: 5,
    })
    expect(trace.analysis.time).toEqual({
      wallMs: 1613, ttftMs: 1505, genMs: 37, toolMs: 0, otherMs: 5, observedSteps: 2,
    })
    expect(trace.analysis.pressure).toEqual([
      { turn: 1, step: 1, promptTokens: 18518 },
      { turn: 2, step: 1, promptTokens: 19938 },
    ])
    expect(trace.analysis.pressurePeak).toBe(19938)
    expect(trace.analysis.repeats).toEqual([])
    expect(trace.analysis.tools).toEqual([])
    expect(trace.analysis.attempts).toEqual([])
    expect(trace.analysis.compaction).toEqual({ events: 0, prunedTokens: 0, failures: 0 })
    expect(trace.analysis.approvals).toEqual({ asked: 0, decided: 0 })
    // 命中率 = cacheRead / (input+cacheRead+cacheWrite),分母是全部 prompt token。
    expect(trace.analysis.cacheHitRate).toBeCloseTo(18304 / 38456, 10)
  })

  it('真实容器路径:fixture 重建多帧 zstd 容器(+torn 尾巴)→ 解码投影结果一致', () => {
    const frame = (chunk: string[]) => zstdCompressSync(Buffer.from(`${chunk.join('\n')}\n`, 'utf8'))
    const container = Buffer.concat([
      frame(fixtureLines.slice(0, 10)),
      frame(fixtureLines.slice(10, 20)),
      frame(fixtureLines.slice(20)),
      zstdCompressSync(Buffer.from('x', 'utf8')).subarray(0, 3), // torn 尾巴
    ])
    const text = decodeZstdLog(container)
    const trace = projectSessionTrace('session-fa97514a-b440-4e70-ac92-b2542283ca26', text.split('\n'))
    expect(trace.turns).toHaveLength(2)
    expect(trace.events).toEqual({ total: 29, projected: 19, skipped: 0 })
    expect(trace.turns[0]?.usage).toEqual({ inputTokens: 10070, outputTokens: 2, totalTokens: 18520 })
    expect(trace.analysis.pressurePeak).toBe(19938)
  })
})

describe('会话列表与指定会话投影', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-trace-'))
  })

  afterEach(async () => {
    await rmRetry(root)
  })

  function seedSession(area: string, sessionId: string, lines: readonly string[]): string {
    const dir = join(root, area, sessionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8')))
    return dir
  }

  it('listTraceSessions:目录约定 + usage/标题折叠 + 无日志目录跳过(T7.0 fixture 会话卡)', () => {
    seedSession('area-a', 'session-aaa', goodSessionLines())
    seedSession('area-b', 'session-bbb', fixtureLines) // 真实 fixture 形态
    mkdirSync(join(root, 'area-c', 'session-empty'), { recursive: true }) // 无日志文件
    const cards = listTraceSessions(root, 10)
    expect(cards).toHaveLength(2)
    const aaa = cards.find(card => card.sessionId === 'session-aaa')
    expect(aaa?.turns).toBe(1)
    expect(aaa?.inputTokens).toBe(100)
    expect(aaa?.cacheReadTokens).toBe(0)
    expect(aaa?.lastAt).toBe(iso(2000))
    expect(aaa?.title).toBe('')
    const bbb = cards.find(card => card.sessionId === 'session-bbb')
    // 标题 = 最后一条 session/title(provider 精修标题胜出)
    expect(bbb?.title).toBe('要求仅回复在线二字')
    expect(bbb?.turns).toBe(2)
    expect(bbb?.inputTokens).toBe(10070 + 10082)
    expect(bbb?.outputTokens).toBe(4)
    expect(bbb?.cacheReadTokens).toBe(8448 + 9856)
    expect(bbb?.lastAt).toBe(iso(1793986084541))
  })

  it('limit 截断(mtime 新→旧)', async () => {
    seedSession('a', 'session-old', [eventLine('turn/end', 1, { turn: 1 })])
    // 等待 mtime 区分
    await new Promise(resolve => setTimeout(resolve, 20))
    seedSession('a', 'session-new', [eventLine('turn/end', 2, { turn: 1 })])
    const cards = listTraceSessions(root, 1)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.sessionId).toBe('session-new')
  })

  it('readSessionTrace:按 id(含/不含 session- 前缀)取轮次树;缺失返回 null', () => {
    seedSession('a', 'session-abc', goodSessionLines())
    expect(readSessionTrace(root, 'session-abc')?.turns).toHaveLength(1)
    expect(readSessionTrace(root, 'abc')?.turns).toHaveLength(1)
    expect(readSessionTrace(root, 'session-none')).toBeNull()
  })

  it('大文件防御:只读尾部窗口;窗口切进帧中间时重同步只投影窗口内整帧(不抛错)', () => {
    // 40 帧 × 40 行(20 轮),每行掺随机噪声(防 zstd 压缩掉,逼真超窗)
    const linesPerFrame = 40
    const frameCount = 40
    const frames: Buffer[] = []
    for (let f = 0; f < frameCount; f++) {
      const chunk: string[] = []
      for (let i = 0; i < linesPerFrame; i++) {
        const turn = f * (linesPerFrame / 2) + Math.floor(i / 2) + 1
        const type = i % 2 === 0 ? 'turn/start' : 'turn/end'
        const noise = randomBytes(1024).toString('base64')
        chunk.push(eventLine(type, 1000 + turn * 10, { turn, noise }))
      }
      frames.push(zstdCompressSync(Buffer.from(`${chunk.join('\n')}\n`, 'utf8')))
    }
    const container = Buffer.concat(frames)
    const dir = join(root, 'a', 'session-big')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'session.v4.jsonl.zstd')
    writeFileSync(path, container)
    expect(readFileSync(path).length).toBeGreaterThan(1024 * 1024) // sanity:文件确实超窗
    expect(readFileSync(path).length).toBeLessThan(TRACE_MAX_LOG_BYTES) // sanity:默认窗口内可全读
    // 全量读:800 轮全投影(1600 行)
    const full = readSessionTrace(root, 'session-big')
    expect(full?.turns).toHaveLength(800)
    expect(full?.events).toEqual({ total: 1600, projected: 1600, skipped: 0 })
    // 窗口=1MB:窗口起点切进某帧中间 → 重同步;只投影窗口内整帧(计数反映窗口)
    const windowed = readSessionTrace(root, 'session-big', { maxLogBytes: 1024 * 1024 })
    expect(windowed).not.toBeNull()
    expect(windowed!.events.total).toBeLessThan(1600)
    expect(windowed!.events.total).toBeGreaterThan(0)
    expect(windowed!.events.skipped).toBe(0)
    expect(windowed!.events.total % (linesPerFrame / 2 * 2)).toBe(0) // 整帧粒度
    // 列表模式同样吃窗口选项(不抛错、计数=窗口投影)
    const cards = listTraceSessions(root, 10, { maxLogBytes: 1024 * 1024 })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.turns).toBe(windowed!.events.total / 2)
  })

  it('不可解码日志:列表跳过该文件;详情返回 null(容错降级,不抛错)', () => {
    const dir = join(root, 'a', 'session-broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.from('not-a-zstd-container', 'utf8'))
    seedSession('a', 'session-ok', goodSessionLines())
    expect(listTraceSessions(root, 10).map(c => c.sessionId)).toEqual(['session-ok'])
    expect(readSessionTrace(root, 'session-broken')).toBeNull()
  })

  it('根目录不存在 → 空列表(容错)', () => {
    expect(listTraceSessions(join(root, 'nope'), 5)).toEqual([])
  })
})

/**
 * T8 分析面:计时归因与聚合的语义钉死。
 *
 * 这一组测试的存在理由:每条断言背后都是一个真实踩过的归因错误,列出来供复核
 * ——(a) 用 stream[0].time 当首 token 会偏(首记录是 block-start);
 * (b) 压缩重放会让同一 callId 出现两条 result,用 Map.get 回填会把毫秒级调用
 * 算成数小时;(c) 未收尾轮次没有墙钟,把分量之和冒充墙钟会造出 >100% 的占比;
 * (d) 键序不同的同逻辑调用不是重复;(e) input 是未缓存输入,上下文量要加缓存桶。
 */
describe('T8 分析面:计时归因与聚合', () => {
  /** 构造一条计时流:block-start 在前(真实日志 100% 如此),首个 token delta 在后。 */
  function streamWithGap(startTime: number, firstTokenDelay: number, genDuration: number): unknown[] {
    return [
      { type: 'chunk', time: startTime, chunk: { type: 'block-start', block: { type: 'text' } } },
      { type: 'chunk', time: startTime + firstTokenDelay, chunk: { type: 'text-delta', text: 'a' } },
      { type: 'text-chunks', time0: startTime + firstTokenDelay + 1, index: 0, dt: [genDuration], texts: ['b'] },
    ]
  }

  it('TTFT 取官方首 token 语义(跳过 block-start),不是 stream[0].time', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 2000, { turn: 1, step: 1 }),
      eventLine('assistant/message', 5000, {
        turn: 1, step: 1,
        // block-start 在 2000(step 起点后就到),真正的首 token 在 2600。
        stream: streamWithGap(2000, 600, 100),
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
      eventLine('step/end', 6000, { turn: 1, step: 1 }),
      eventLine('turn/end', 6500, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const step = projectSessionTrace('session-x', lines).turns[0]?.steps[0]
    // stream[0].time - stepStart = 0;官方首 token - stepStart = 600。必须是后者。
    expect(step?.ttftMs).toBe(600)
    expect(step?.genMs).toBe(101)
    expect(step?.wallMs).toBe(4000)
    expect(step?.otherMs).toBe(4000 - 600 - 101)
  })

  it('压缩重放:同一 callId 的第二条 tool/result 不得覆盖第一次的耗时', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1000, { turn: 1, step: 1 }),
      eventLine('tool/call', 1100, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }),
      eventLine('tool/result', 1131, { turn: 1, step: 1, message: { toolCallId: 'c1' } }),
      eventLine('step/end', 1200, { turn: 1, step: 1 }),
      // 压缩:prune 后把被裁剪的 result 重新追加一遍(时间戳是重放时刻)。
      eventLine('compaction/prune', 5000000, { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 120 }),
      eventLine('tool/result', 5000001, { turn: 1, step: 1, message: { toolCallId: 'c1' } }),
      eventLine('turn/end', 5000100, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('session-x', lines)
    const tool = trace.turns[0]?.tools[0]
    // 真值 31ms;若被重放覆盖会变成 4,998,901ms(约 83 分钟)。
    expect(tool?.durationMs).toBe(31)
    expect(trace.turns[0]?.steps[0]?.toolMs).toBe(31)
    // 工具排行/会话合计同口径,不能被重放污染。
    expect(trace.analysis.tools).toEqual([
      { name: 'bash', calls: 1, errors: 0, totalMs: 31, avgMs: 31, p95Ms: 31, maxMs: 31 },
    ])
    expect(trace.analysis.time.toolMs).toBe(31)
    // prune 计数照实累加。
    expect(trace.analysis.compaction).toEqual({ events: 0, prunedTokens: 120, failures: 0 })
  })

  it('未收尾轮次:墙钟 null 而分量有值,会话级墙钟也随之 null(不冒充总量)', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1000, { turn: 1, step: 1 }),
      eventLine('assistant/message', 3000, {
        turn: 1, step: 1, stream: streamWithGap(1000, 500, 200), usage: { inputTokens: 5, outputTokens: 5 },
      }),
      eventLine('step/end', 3500, { turn: 1, step: 1 }),
      // 缺 turn/end(会话被中断,日志到此为止)。
    ]
    const trace = projectSessionTrace('session-x', lines)
    expect(trace.turns[0]?.durationMs).toBeNull()
    expect(trace.turns[0]?.time.wallMs).toBeNull()
    // 分量仍然可观测:700 = 500 等首字 + 201 生成 + 其他(3500-1000-500-201=1799)
    expect(trace.turns[0]?.time.ttftMs).toBe(500)
    expect(trace.turns[0]?.time.genMs).toBe(201)
    // 该 step 墙钟 = 3500-1000 = 2500,减等首字 500、生成 201 → 其他 1799
    expect(trace.turns[0]?.steps[0]?.otherMs).toBe(2500 - 500 - 201)
    expect(trace.turns[0]?.time.otherMs).toBe(2500 - 500 - 201)
    // 会话级:任一轮未收尾 → 总墙钟 null(不能把部分之和当总量)。
    expect(trace.analysis.time.wallMs).toBeNull()
  })

  it('重复调用:工具名 + 完整参数逐字节相等才算;键序不同不算', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1000, { turn: 1, step: 1 }),
      eventLine('tool/call', 1100, { turn: 1, step: 1, callId: 'c1', name: 'plugin', arguments: '{"id":"a","v":1}' }),
      eventLine('tool/result', 1200, { turn: 1, step: 1, message: { toolCallId: 'c1' } }),
      eventLine('step/end', 1300, { turn: 1, step: 1 }),
      eventLine('step/start', 1400, { turn: 1, step: 2 }),
      // 逐字节相同 → 计入重复
      eventLine('tool/call', 1500, { turn: 1, step: 2, callId: 'c2', name: 'plugin', arguments: '{"id":"a","v":1}' }),
      eventLine('tool/result', 1600, { turn: 1, step: 2, message: { toolCallId: 'c2' } }),
      // 键序不同 → 不算重复(是另一次决策,不是复读)
      eventLine('tool/call', 1700, { turn: 1, step: 2, callId: 'c3', name: 'plugin', arguments: '{"v":1,"id":"a"}' }),
      eventLine('tool/result', 1800, { turn: 1, step: 2, message: { toolCallId: 'c3' } }),
      eventLine('step/end', 1900, { turn: 1, step: 2 }),
      eventLine('turn/end', 2000, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const repeats = projectSessionTrace('session-x', lines).analysis.repeats
    expect(repeats).toHaveLength(1)
    expect(repeats[0]).toMatchObject({ name: 'plugin', times: 2, at: ['1.1', '1.2'], totalMs: 200 })
  })

  it('上下文水位与命中率:promptTokens 含缓存桶,命中率分母是全部 prompt token', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('request/context', 1050, { provider: 'p', model: 'm', contextWindow: 300000 }),
      eventLine('step/start', 1100, { turn: 1, step: 1 }),
      eventLine('assistant/message', 2000, {
        turn: 1, step: 1,
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 9000, cacheWriteTokens: 200 },
      }),
      eventLine('step/end', 2100, { turn: 1, step: 1 }),
      eventLine('turn/end', 2200, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const analysis = projectSessionTrace('session-x', lines).analysis
    // 上下文量 = 1000 + 9000 + 200 = 10200(不是 inputTokens 的 1000)
    expect(analysis.pressure).toEqual([{ turn: 1, step: 1, promptTokens: 10200 }])
    expect(analysis.pressurePeak).toBe(10200)
    expect(analysis.contextWindow).toBe(300000)
    expect(analysis.tokens).toEqual({ input: 1000, output: 500, cacheRead: 9000, cacheWrite: 200, billed: 10700 })
    expect(analysis.cacheHitRate).toBeCloseTo(9000 / 10200, 10)
    // 路由取自 request/context
    expect(analysis.route).toBe('p/m')
  })

  it('缓存桶从未上报 → 命中率 null(未知),不伪报 0', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1100, { turn: 1, step: 1 }),
      eventLine('assistant/message', 2000, { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500 } }),
      eventLine('step/end', 2100, { turn: 1, step: 1 }),
      eventLine('turn/end', 2200, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const analysis = projectSessionTrace('session-x', lines).analysis
    expect(analysis.cacheHitRate).toBeNull()
    expect(analysis.contextWindow).toBeNull()
  })

  it('失败尝试(assistant/attempt)单独归档,不干扰本步正式计时', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1000, { turn: 1, step: 1 }),
      // 第一次尝试失败(未提交可见消息)
      eventLine('assistant/attempt', 4000, { turn: 1, step: 1, stream: streamWithGap(1000, 900, 100) }),
      // 重试成功
      eventLine('assistant/message', 8000, {
        turn: 1, step: 1, stream: streamWithGap(4000, 700, 300), usage: { inputTokens: 10, outputTokens: 10 },
      }),
      eventLine('step/end', 9000, { turn: 1, step: 1 }),
      eventLine('turn/end', 9500, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('session-x', lines)
    expect(trace.analysis.attempts).toHaveLength(1)
    expect(trace.analysis.attempts[0]).toMatchObject({ turn: 1, step: 1, ttftMs: 900, streamMs: 101 })
    // 本步的正式计时来自 assistant/message,不被 attempt 的流覆盖。
    // TTFT 从 step/start 起算:700(等首字)是 message 流的首个 token 距 step 起点
    // 的距离,即 8000+700-4000=4700? 不是——首 token 绝对时刻 = 4000+700 = 4700,
    // 距 step 起点(1000)是 3700。这也是为什么「含重试的 step」的等首字会偏大:
    // 用户确实多等了失败的那一次。失败尝试的独立时序在 attempts 里。
    expect(trace.turns[0]?.steps[0]?.ttftMs).toBe(3700)
    expect(trace.turns[0]?.steps[0]?.genMs).toBe(301)
  })

  it('压缩失败计数:compaction/end 带 error 计入 failures', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('compaction/start', 1100, { compactionId: 'k1', turn: 1 }),
      eventLine('compaction/end', 1200, { compactionId: 'k1', turn: 1, error: 'invalid-summary: missing section' }),
      eventLine('compaction/start', 1300, { compactionId: 'k2', turn: 1 }),
      eventLine('compaction/end', 1400, { compactionId: 'k2', turn: 1 }),
      eventLine('turn/end', 1500, { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(projectSessionTrace('session-x', lines).analysis.compaction).toEqual({
      events: 2, prunedTokens: 0, failures: 1,
    })
  })

  it('工具排队:未配对调用的耗时为 null 且不计入任何排行', () => {
    const lines = [
      eventLine('turn/start', 1000, { turn: 1 }),
      eventLine('step/start', 1000, { turn: 1, step: 1 }),
      eventLine('tool/call', 1100, { turn: 1, step: 1, callId: 'c1', name: 'slow', arguments: '{}' }),
      eventLine('step/end', 1200, { turn: 1, step: 1 }),
      eventLine('turn/end', 1300, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = projectSessionTrace('session-x', lines)
    expect(trace.turns[0]?.tools[0]?.durationMs).toBeNull()
    // 计数照实记(调用发生了),但耗时排行/重复组只认配对成功者。
    expect(trace.turns[0]?.steps[0]?.toolCalls).toBe(1)
    expect(trace.analysis.counts.toolCalls).toBe(0)
    expect(trace.analysis.tools).toEqual([])
    expect(trace.analysis.time.toolMs).toBe(0)
  })

  it('p95 用最近秩法(升序第 ceil(0.95n) 个,不插值)', () => {
    const lines = [eventLine('turn/start', 0, { turn: 1 })]
    // 20 次调用,耗时 1..20 → ceil(0.95*20)=19 → 第 19 个 = 19
    for (let i = 1; i <= 20; i += 1) {
      lines.push(eventLine('step/start', i * 100, { turn: 1, step: i }))
      lines.push(eventLine('tool/call', i * 100 + 10, { turn: 1, step: i, callId: `c${i}`, name: 't', arguments: '{}' }))
      lines.push(eventLine('tool/result', i * 100 + 10 + i, { turn: 1, step: i, message: { toolCallId: `c${i}` } }))
      lines.push(eventLine('step/end', i * 100 + 50 + i, { turn: 1, step: i }))
    }
    const stat = projectSessionTrace('session-x', lines).analysis.tools[0]
    expect(stat?.calls).toBe(20)
    expect(stat?.maxMs).toBe(20)
    expect(stat?.p95Ms).toBe(19)
    expect(stat?.totalMs).toBe(210)
  })
})
