/**
 * 评分库:幂等 upsert(重评覆盖不堆历史)、按会话列出、按天用量累加。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JudgeScoreStore, openJudgeStore, type StoredJudgeScore } from '../src/score-store.ts'

function row(overrides: Partial<StoredJudgeScore> = {}): StoredJudgeScore {
  return {
    sessionId: 's1',
    metricKey: 'judge.task_completion',
    metricName: '任务完成度',
    category: 'outcome',
    scope: 'session',
    targetTurn: null,
    status: 'ok',
    value: true,
    rationale: '完成',
    provider: 'deepseek',
    model: 'deepseek-chat',
    latencyMs: 800,
    tokens: 120,
    gating: null,
    metricVersion: null,
    createdAt: 1000,
    ...overrides,
  }
}

describe('JudgeScoreStore', () => {
  let dir: string
  let store: JudgeScoreStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-judge-store-'))
    store = openJudgeStore(join(dir, 'nested', 'scores.db'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('open 懒建父目录(node:sqlite 不建父目录的实测教训)', () => {
    expect(store.list('s1')).toEqual([])
  })

  it('upsert 后可列出,字段原样往返', () => {
    store.upsert(row())
    expect(store.list('s1')).toEqual([row()])
    expect(store.list('s2')).toEqual([])
  })

  it('同 (session, metric, target) 覆盖而非堆历史', () => {
    store.upsert(row({ value: true, createdAt: 1000 }))
    store.upsert(row({ value: false, rationale: '重评后未过', createdAt: 2000 }))
    const rows = store.list('s1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: false, rationale: '重评后未过', createdAt: 2000 })
  })

  it('过程类按轮次分行(不同 targetTurn 互不覆盖)', () => {
    store.upsert(row({ metricKey: 'judge.tool_selection', metricName: '工具选择', category: 'process', scope: 'turn', targetTurn: 1 }))
    store.upsert(row({ metricKey: 'judge.tool_selection', metricName: '工具选择', category: 'process', scope: 'turn', targetTurn: 2 }))
    expect(store.list('s1').map(item => item.targetTurn)).toEqual([1, 2])
  })

  it('用量按天累加(非正数忽略)', () => {
    expect(store.usage('2026-11-25')).toBe(0)
    store.addUsage('2026-11-25', 120)
    store.addUsage('2026-11-25', 80)
    store.addUsage('2026-11-25', 0)
    store.addUsage('2026-11-25', -5)
    expect(store.usage('2026-11-25')).toBe(200)
    expect(store.usage('2026-11-26')).toBe(0)
  })
})
