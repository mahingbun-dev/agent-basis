/**
 * evolve_signal 存储单测:CRUD、(kind, ref) 去重幂等、trajectory_hash 聚类、
 * tag 查询(json_each)、approval 负信号桥、close 幂等、坏 payload 拒绝、文件库持久化。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { enqueueApprovalSignal, SignalDecodeError, SignalStore, trajectoryHashOf } from '../src/index.ts'
import type { EvolveSignal, SignalInput } from '../src/index.ts'

const CLEANUP: (() => void)[] = []

function memoryStore(): SignalStore {
  const store = new SignalStore(':memory:')
  CLEANUP.push(() => {
    store.close()
  })
  return store
}

function fileStore(): { store: SignalStore; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-observe-'))
  const path = join(dir, 'signals.sqlite')
  const store = new SignalStore(path)
  CLEANUP.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir, path }
}

afterEach(() => {
  for (const fn of CLEANUP.splice(0)) fn()
})

function signal(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    packId: '@event/pack',
    kind: 'feedback_low',
    ref: 'feedback:s1:m1',
    payload: {
      summary: '低分反馈:方案漏了预算约束',
      tags: ['feedback', 'rating:negative'],
      trajectoryHash: trajectoryHashOf('s1'),
    },
    ...overrides,
  }
}

describe('SignalStore 入队与读取', () => {
  it('enqueue → get/list 回读一致(payload/tags/trajectoryHash 往返)', () => {
    const store = memoryStore()
    const { signal: queued } = store.enqueue(signal())
    expect(queued).toBeDefined()
    expect(queued?.id).toBeGreaterThan(0)
    expect(queued?.ts).toBeGreaterThan(0)
    const got = store.get(queued!.id) as EvolveSignal
    expect(got.kind).toBe('feedback_low')
    expect(got.ref).toBe('feedback:s1:m1')
    expect(got.packId).toBe('@event/pack')
    expect(got.sessionId).toBeUndefined()
    expect(got.payload.summary).toBe('低分反馈:方案漏了预算约束')
    expect(got.payload.tags).toEqual(['feedback', 'rating:negative'])
    expect(got.payload.trajectoryHash).toBe(trajectoryHashOf('s1'))
  })

  it('payload 自由扩展字段(rating/category/score)原样透传', () => {
    const store = memoryStore()
    const { signal: queued } = store.enqueue(
      signal({ payload: { ...signal().payload, rating: 'negative', category: 'task-result' } }),
    )
    expect(queued?.payload['rating']).toBe('negative')
    expect(queued?.payload['category']).toBe('task-result')
  })

  it('kind 受 CHECK 约束:非法 kind 由类型系统拒绝(编译期);五种任务 kind 均可入队', () => {
    const store = memoryStore()
    const kinds = ['feedback_low', 'approval_modified', 'approval_rejected', 'eval_fail', 'drift'] as const
    for (const [index, kind] of kinds.entries()) {
      const result = store.enqueue(signal({ kind, ref: `ref-${kind}` }))
      expect(result.reason).toBe('enqueued')
      expect(result.signal?.kind).toBe(kind)
      expect(result.signal?.id).toBe(index + 1)
    }
    expect(store.count()).toBe(5)
  })

  it('坏 payload 拒绝:summary 空 / tags 非字符串 → 抛错且不落库', () => {
    const store = memoryStore()
    expect(() => store.enqueue(signal({ payload: { summary: '', tags: [] } }))).toThrow(TypeError)
    expect(() => store.enqueue(signal({ payload: { summary: 'x', tags: ['a', 1 as unknown as string] } }))).toThrow(TypeError)
    expect(store.count()).toBe(0)
  })
})

describe('(kind, ref) 去重 —— 重放幂等', () => {
  it('同 kind+ref 二次入队 → duplicate,不新增行,返回既有信号', () => {
    const store = memoryStore()
    const first = store.enqueue(signal({ ts: 1_000 }))
    const second = store.enqueue(signal({ ts: 9_000, payload: { summary: '重放的同一条', tags: ['feedback'] } }))
    expect(first.reason).toBe('enqueued')
    expect(second.reason).toBe('duplicate')
    expect(second.signal?.id).toBe(first.signal?.id)
    expect(second.signal?.ts).toBe(1_000)
    expect(store.count()).toBe(1)
    // 库里仍是首条内容(重放不覆盖)
    expect(store.list()[0]?.payload.summary).toBe('低分反馈:方案漏了预算约束')
  })

  it('同 ref 不同 kind → 两条独立信号(kind 参与去重键)', () => {
    const store = memoryStore()
    store.enqueue(signal({ kind: 'eval_fail', ref: 'aievo:task-1' }))
    const second = store.enqueue(signal({ kind: 'drift', ref: 'aievo:task-1' }))
    expect(second.reason).toBe('enqueued')
    expect(store.count()).toBe(2)
  })

  it('同 kind 不同 ref → 两条独立信号', () => {
    const store = memoryStore()
    store.enqueue(signal({ ref: 'feedback:s1:m1' }))
    const second = store.enqueue(signal({ ref: 'feedback:s1:m2' }))
    expect(second.reason).toBe('enqueued')
    expect(store.count()).toBe(2)
  })
})

describe('查询:kind/packId/sessionId/tag/trajectoryHash/since', () => {
  it('按 kind 与 tag(json_each)过滤', () => {
    const store = memoryStore()
    store.enqueue(signal({ ref: 'r1', payload: { summary: 'a', tags: ['feedback', 'rating:negative'] } }))
    store.enqueue(signal({
      ref: 'r2',
      kind: 'eval_fail',
      payload: { summary: 'b', tags: ['eval', 'golden:case-3'] },
    }))
    store.enqueue(signal({ ref: 'r3', kind: 'drift', payload: { summary: 'c', tags: ['drift'] } }))
    expect(store.count({ kind: 'feedback_low' })).toBe(1)
    expect(store.list({ tag: 'eval' }).map(each => each.ref)).toEqual(['r2'])
    expect(store.list({ tag: 'feedback' }).map(each => each.ref)).toEqual(['r1'])
    expect(store.list({ tag: 'nope' })).toEqual([])
  })

  it('按 packId/sessionId/trajectoryHash/since 过滤 + limit', () => {
    const store = memoryStore()
    const hashS1 = trajectoryHashOf('s1')
    const hashS2 = trajectoryHashOf('s2')
    store.enqueue(signal({ ts: 100, sessionId: 's1', ref: 'a', payload: { summary: 'a', tags: [], trajectoryHash: hashS1 } }))
    store.enqueue(signal({ ts: 200, sessionId: 's1', ref: 'b', payload: { summary: 'b', tags: [], trajectoryHash: hashS1 } }))
    store.enqueue(signal({ ts: 300, sessionId: 's2', ref: 'c', payload: { summary: 'c', tags: [], trajectoryHash: hashS2 } }))
    expect(store.list({ sessionId: 's1' })).toHaveLength(2)
    expect(store.list({ packId: '@event/pack' })).toHaveLength(3)
    expect(store.list({ packId: '@other/pack' })).toHaveLength(0)
    expect(store.list({ trajectoryHash: hashS1 })).toHaveLength(2)
    expect(store.list({ since: 250 })).toHaveLength(1)
    expect(store.list({ limit: 2 })).toHaveLength(2)
  })
})

describe('trajectory_hash 聚类 —— reflector「同一错误 ≥N 次」', () => {
  it('clusterByTrajectory 按簇计数,降序;minCount 过滤', () => {
    const store = memoryStore()
    const hashA = 'aaaa1111aaaa1111'
    const hashB = 'bbbb2222bbbb2222'
    const tags = ['feedback']
    store.enqueue(signal({ ts: 100, ref: 'f1', payload: { summary: '1', tags, trajectoryHash: hashA } }))
    store.enqueue(signal({ ts: 200, ref: 'f2', payload: { summary: '2', tags, trajectoryHash: hashA } }))
    store.enqueue(signal({ ts: 300, ref: 'f3', kind: 'eval_fail', payload: { summary: '3', tags, trajectoryHash: hashA } }))
    store.enqueue(signal({ ts: 250, ref: 'e1', kind: 'eval_fail', payload: { summary: '5', tags, trajectoryHash: hashB } }))
    store.enqueue(signal({ ts: 400, ref: 'd1', kind: 'drift', payload: { summary: '4', tags: ['drift'] } }))
    const clusters = store.clusterByTrajectory()
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({ trajectoryHash: hashA, count: 3, firstTs: 100, lastTs: 300 })
    expect(clusters[0]?.refs).toEqual(['f1', 'f2', 'f3'])
    expect(new Set(clusters[0]?.kinds)).toEqual(new Set(['feedback_low', 'eval_fail']))
    expect(clusters[1]).toMatchObject({ trajectoryHash: hashB, count: 1 })
    // repeatThreshold=3(同一错误 ≥3 次才立项)→ 只剩 A 簇
    expect(store.clusterByTrajectory({ minCount: 3 }).map(cluster => cluster.trajectoryHash)).toEqual([hashA])
    // since 窗口内
    expect(store.clusterByTrajectory({ since: 250, minCount: 1 })).toHaveLength(2)
  })

  it('无 trajectoryHash 的信号(drift)不进聚类', () => {
    const store = memoryStore()
    store.enqueue(signal({ kind: 'drift', ref: 'drift:snapshot-1', payload: { summary: 'd', tags: ['drift'] } }))
    expect(store.clusterByTrajectory()).toEqual([])
  })
})

describe('持久化与生命周期', () => {
  it('文件库:重开保留信号(append-only 审计语义)', () => {
    const { store, path } = fileStore()
    store.enqueue(signal())
    store.close()
    const reopened = new SignalStore(path)
    CLEANUP.push(() => {
      reopened.close()
    })
    expect(reopened.count()).toBe(1)
    expect(reopened.list()[0]?.ref).toBe('feedback:s1:m1')
    // 重开后继续去重(跨实例幂等)
    const again = reopened.enqueue(signal({ ts: 99_999 }))
    expect(again.reason).toBe('duplicate')
  })

  it('close 幂等;close 后操作抛错', () => {
    const store = memoryStore()
    store.close()
    store.close()
    expect(store.closed).toBe(true)
    expect(() => store.enqueue(signal())).toThrow(/已 close/)
    expect(() => store.list()).toThrow(/已 close/)
  })

  it('构造可注入时钟(ts 缺省取 now())', () => {
    let fake = 1_234_567
    const store = new SignalStore(':memory:', { now: () => fake })
    CLEANUP.push(() => {
      store.close()
    })
    const first = store.enqueue(signal())
    fake = 7_654_321
    const second = store.enqueue(signal({ ref: 'other' }))
    expect(first.signal?.ts).toBe(1_234_567)
    expect(second.signal?.ts).toBe(7_654_321)
  })

  it('外部写坏 payload → 读路径抛 SignalDecodeError(不静默)', () => {
    const { store, path } = fileStore()
    store.enqueue(signal())
    store.close()
    const raw = new DatabaseSync(path)
    raw.exec("UPDATE evolve_signal SET payload = '{bad json'")
    raw.close()
    const reopened = new SignalStore(path)
    CLEANUP.push(() => {
      reopened.close()
    })
    expect(() => reopened.list()).toThrow(SignalDecodeError)
  })
})

describe('approval 负信号桥(approval/decided outcome=rejected)', () => {
  it('rejected → approval_rejected 信号;重复事件 → duplicate', () => {
    const store = memoryStore()
    const first = enqueueApprovalSignal(
      store,
      { type: 'approval/decided', data: { id: 'ap-1', outcome: 'rejected' } },
      '@event/pack',
    )
    expect(first.reason).toBe('enqueued')
    expect(first.signal?.kind).toBe('approval_rejected')
    expect(first.signal?.ref).toBe('approval:ap-1')
    const again = enqueueApprovalSignal(
      store,
      { type: 'approval/decided', data: { id: 'ap-1', outcome: 'rejected' } },
      '@event/pack',
    )
    expect(again.reason).toBe('duplicate')
  })

  it('allowed-once / cancelled / unavailable / 非 approval 事件 → ignored', () => {
    const store = memoryStore()
    for (const outcome of ['allowed-once', 'cancelled', 'unavailable'] as const) {
      expect(
        enqueueApprovalSignal(store, { type: 'approval/decided', data: { id: 'ap-2', outcome } }, '@event/pack').reason,
      ).toBe('ignored')
    }
    expect(
      enqueueApprovalSignal(store, { type: 'approval/asked', data: { id: 'ap-3', toolName: 'fs.write' } }, '@event/pack').reason,
    ).toBe('ignored')
    expect(store.count()).toBe(0)
  })
})
