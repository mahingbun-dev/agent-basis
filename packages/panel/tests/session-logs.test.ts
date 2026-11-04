/**
 * session 日志投影测试:用 node:zlib 造多帧 zstd 容器(对齐宿主持久化层的
 * 「每批次一个独立完整帧」写入口径),钉住帧扫描、usage 折叠与命中率口径。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cacheHitRate, decodeZstdLog, foldSessionEvents, readRecentSessionUsage, scanZstdFrames } from '../src/session-logs.ts'

let home = ''

function frame(lines: string[]): Buffer {
  return zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'))
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'basis-panel-logs-'))
  const area = join(home, 'sessions', '--tmp-basis-ws--')
  mkdirSync(join(area, 'session-alpha'), { recursive: true })
  mkdirSync(join(area, 'session-beta'), { recursive: true })
  mkdirSync(join(area, 'session-locked-only'), { recursive: true })

  // alpha:两帧(两个追加批次),3 轮,usage 三条
  const alphaFrame1 = frame([
    JSON.stringify({ type: 'session', seq: 0, time: 1000, data: {} }),
    JSON.stringify({ type: 'turn/end', seq: 5, time: 1500, data: { turn: 1 } }),
    JSON.stringify({
      type: 'assistant/message', seq: 6, time: 1600,
      data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 6320, cacheReadTokens: 5120 } },
    }),
  ])
  const alphaFrame2 = frame([
    JSON.stringify({ type: 'turn/end', seq: 9, time: 2500, data: { turn: 2 } }),
    JSON.stringify({
      type: 'assistant/message', seq: 10, time: 2600,
      data: { turn: 2, step: 2, usage: { inputTokens: 500, outputTokens: 300, totalTokens: 2000, cacheReadTokens: 1200 } },
    }),
    JSON.stringify({ type: 'turn/end', seq: 11, time: 2700, data: { turn: 3 } }),
  ])
  writeFileSync(join(area, 'session-alpha', 'session.v4.jsonl.zstd'), Buffer.concat([alphaFrame1, alphaFrame2]))

  // beta:单帧,1 轮,无缓存读(命中率 null 分支)
  writeFileSync(
    join(area, 'session-beta', 'session.v4.jsonl.zstd'),
    frame([
      JSON.stringify({ type: 'turn/end', seq: 3, time: 900, data: { turn: 1 } }),
      JSON.stringify({
        type: 'assistant/message', seq: 4, time: 950,
        data: { turn: 1, step: 1, usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } },
      }),
    ]),
  )

  // locked-only:无日志文件(仅 session.lock)——应被跳过不炸
  writeFileSync(join(area, 'session-locked-only', 'session.lock'), '')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('scanZstdFrames', () => {
  it('多帧容器逐帧识别,单帧输入得一段', () => {
    const two = Buffer.concat([frame(['a']), frame(['b'])])
    const ranges = scanZstdFrames(two)
    expect(ranges).toHaveLength(2)
    expect(two.subarray(ranges[0]!.start, ranges[0]!.end).equals(frame(['a']))).toBe(true)
    expect(scanZstdFrames(frame(['a']))).toHaveLength(1)
  })

  it('尾部截断(torn 帧)只保留完整帧', () => {
    const whole = frame(['{"type":"session"}'])
    const cut = Buffer.concat([whole, whole.subarray(0, 4)])
    expect(scanZstdFrames(cut)).toHaveLength(1)
  })
})

describe('decodeZstdLog / foldSessionEvents', () => {
  it('多帧解码拼接后 usage 求和、轮次计数、取最近时间', () => {
    const two = Buffer.concat([frame(['{"type":"turn/end","time":100}']), frame(['{"type":"assistant/message","time":300,"data":{"usage":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":25}}}'])])
    const text = decodeZstdLog(two)
    const fold = foldSessionEvents(text.split('\n'))
    expect(fold.turns).toBe(1)
    expect(fold.inputTokens).toBe(10)
    expect(fold.outputTokens).toBe(5)
    expect(fold.cacheReadTokens).toBe(25)
    expect(fold.lastAt).toBe(300)
  })

  it('坏 JSON 行与非事件行被忽略', () => {
    const fold = foldSessionEvents(['not-json', '', JSON.stringify({ type: 'other', data: { usage: { inputTokens: 999 } } })])
    expect(fold.inputTokens).toBe(0)
  })
})

describe('cacheHitRate', () => {
  it('命中率 = cacheRead / (input + cacheRead),四位置精度', () => {
    expect(cacheHitRate(1000, 5120)).toBeCloseTo(0.8366, 3)
    expect(cacheHitRate(0, 0)).toBeNull()
  })
})

describe('readRecentSessionUsage', () => {
  it('聚合最近会话(mtime 序),缺日志目录跳过', () => {
    const cards = readRecentSessionUsage(join(home, 'sessions'))
    expect(cards).toHaveLength(2)
    const alpha = cards.find(card => card.id === 'session-alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.turns).toBe(3)
    expect(alpha?.inputTokens).toBe(1500)
    expect(alpha?.outputTokens).toBe(500)
    expect(alpha?.cacheReadTokens).toBe(6320)
    expect(alpha?.cacheHitRate).toBeCloseTo(6320 / (1500 + 6320), 4)
    expect(alpha?.area).toBe('--tmp-basis-ws--')
    const beta = cards.find(card => card.id === 'session-beta')
    expect(beta?.cacheHitRate).toBe(0) // input>0 且 cacheRead=0 → 命中率 0(仅零输入才是 null)
  })

  it('根目录不存在返回空数组', () => {
    expect(readRecentSessionUsage(join(home, 'nope'))).toEqual([])
  })
})
