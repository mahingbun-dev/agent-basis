/**
 * 服务编排单测:端口注入 → 快照。锁住三条状态语义:
 * - 会话不在内存(端口 undefined)→ `not_loaded`(不是空分);
 * - 会话在内存但零事件 → `empty`;
 * - 有事件 → `ok`,且快照字段与投影/规则层逐项一致。
 */
import { describe, expect, it } from 'vitest'
import { SessionEvalService } from '../src/service.ts'
import type { SessionEventLike } from '../src/types.ts'
import { FIXTURE_EVENTS } from './fixture.ts'

/** 固定端口:sessionId → 事件数组(未命中的 id 恒 undefined). */
function portsOf(table: Readonly<Record<string, readonly SessionEventLike[]>>) {
  const seen: string[] = []
  return {
    seen,
    readEvents(sessionId: string) {
      seen.push(sessionId)
      return table[sessionId]
    },
  }
}

describe('SessionEvalService.snapshot', () => {
  it('会话未加载 → not_loaded(结构完整,不给假分数)', async () => {
    const service = new SessionEvalService(portsOf({}))
    const snapshot = await service.snapshot('missing', 1_700_000_000_000)
    expect(snapshot.state).toBe('not_loaded')
    expect(snapshot.sessionId).toBe('missing')
    expect(snapshot.generatedAt).toBe(1_700_000_000_000)
    expect(snapshot.metrics).toEqual([])
    expect(snapshot.verdict.level).toBe('unrated')
    expect(snapshot.verdict.label).toContain('未加载')
  })

  it('会话在内存但零事件 → empty', async () => {
    const service = new SessionEvalService(portsOf({ 's-empty': [] }))
    const snapshot = await service.snapshot('s-empty', 1)
    expect(snapshot.state).toBe('empty')
    expect(snapshot.verdict.label).toContain('尚无内容')
    expect(snapshot.usage.billed).toBe(0)
    expect(snapshot.cacheHitRate).toBeNull()
  })

  it('有事件 → ok,字段与投影/规则层一致(手算)', async () => {
    const service = new SessionEvalService(portsOf({ 's-ok': FIXTURE_EVENTS }))
    const snapshot = await service.snapshot('s-ok', 5)
    expect(snapshot.state).toBe('ok')
    expect(snapshot.turns).toBe(2)
    expect(snapshot.steps).toBe(2)
    expect(snapshot.lastTurn).toBe(2)
    expect(snapshot.durationMs).toBe(14_000) // firstTime 1000 → lastTime 15000
    expect(snapshot.usage).toEqual({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, reasoning: 0, billed: 4200 })
    expect(snapshot.cacheHitRate).toBeCloseTo(0.75, 10)
    expect(snapshot.costUsd).toBeCloseTo(0.0007, 9)
    expect(snapshot.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(snapshot.metrics.length).toBeGreaterThan(0)
    expect(snapshot.verdict.level).toBe('warn')
    expect(snapshot.issues.length).toBe(7)
    expect(snapshot.pending).toHaveLength(3)
  })

  it('会话 id 非法(空/超长)→ not_loaded,且不触碰端口', async () => {
    const ports = portsOf({})
    const service = new SessionEvalService(ports)
    expect((await service.snapshot('', 1)).state).toBe('not_loaded')
    expect((await service.snapshot('x'.repeat(201), 1)).state).toBe('not_loaded')
    expect(ports.seen).toEqual([])
  })

  it('同一事件数组重复读取结果完全相同(纯投影)', async () => {
    const service = new SessionEvalService(portsOf({ 's-ok': FIXTURE_EVENTS }))
    const first = await service.snapshot('s-ok', 1)
    const second = await service.snapshot('s-ok', 2)
    expect({ ...first, generatedAt: 0 }).toEqual({ ...second, generatedAt: 0 })
  })
})
