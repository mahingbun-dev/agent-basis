/**
 * Effects 持久副作用队列:合并、per-kind 并发限、指数退避、Later、健康与关停
 * (35 号 A12 验收门禁;34 号 §4-C effects 行)。
 *
 * 语义自 SA tests/effects.spec.ts 移植(Store + HealthBoard 直驱,无 runtime 依赖):
 * UPSERT 合并保序、per-kind limit、指数退避(封顶)、Later 不计失败、drain 留行重试、
 * 健康上报(含 quiet 与队列自身失败)、ordered 保序、cancel+重排、seq 跨重启连续、
 * 事务内入队提交后跑/回滚不跑、二 handler 拒绝。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Effects, HealthBoard, Later, Store } from '../src/index.ts'

/** 手动放行的 Promise(SA tests/fixtures/async.ts 的 deferred 同构,测试内联)。 */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolve_) => { resolve = resolve_ })
  return { promise, resolve }
}

const REALM = 'alice'
let directory: string
let store: Store
let clock: number
let board: HealthBoard
let health: Readonly<Record<string, unknown>>
let effects: Effects
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tasks-effects-'))
  store = new Store(REALM, { tenantRoot: directory })
  clock = Date.parse('2026-09-09T00:00:00Z')
  board = new HealthBoard()
  health = board.all
  effects = new Effects(store, board, () => clock)
  effects.start()
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
const relay = (text: string) => ({ text })

it('事务内入队的 effect 提交后跑一次;回滚的事务一个都不跑', async () => {
  const run = vi.fn(async () => {})
  effects.handle('relay', run)
  store.atomic(() => { effects.enqueue('relay', 'kept', relay('a')) })
  const rolledBack = (): void => {
    store.atomic(() => { effects.enqueue('relay', 'dropped', relay('b')); throw new Error('rolled back') })
  }
  expect(rolledBack).toThrow('rolled back')
  await effects.idle()
  expect(run.mock.calls).toEqual([[relay('a'), 'kept']])
  expect(effects.pending('relay')).toBe(false)
})

it('同 key 只留一行、载荷取最新;运行中来新载荷会在其后再跑一次', async () => {
  const hold = deferred()
  const run = vi.fn(async (payload: { text: string }) => { if (payload.text === 'first') await hold.promise })
  effects.handle('relay', run)
  effects.enqueue('relay', 'k', relay('first'))
  await vi.waitFor(() => { expect(run).toHaveBeenCalledTimes(1) })
  effects.enqueue('relay', 'k', relay('second')); effects.enqueue('relay', 'k', relay('third'))
  hold.resolve()
  await effects.idle()
  expect(run.mock.calls.map(([payload]) => payload.text)).toEqual(['first', 'third'])
})

it('kind 内最老先行、同时跑满 limit;limit 0 扣住整个 kind', async () => {
  const holds = new Map<string, { promise: Promise<void>; release: () => void }>()
  let limit = 2
  const run = vi.fn(async (_payload: unknown, key: string) => {
    const hold = deferred()
    holds.set(key, { promise: hold.promise, release: () => { hold.resolve() } })
    await hold.promise
  })
  effects.handle('launch', run, { limit: () => limit })
  for (const key of ['a', 'b', 'c']) effects.enqueue('launch', key, { ticketId: key, assignmentId: key })
  await vi.waitFor(() => { expect(run.mock.calls.map(([, key]) => key)).toEqual(['a', 'b']) })
  limit = 0
  holds.get('a')!.release()
  await vi.waitFor(() => { expect(effects.pending('launch', 'a')).toBe(false) })
  effects.kick(); await Promise.resolve()
  expect(run).toHaveBeenCalledTimes(2)
  limit = 2
  holds.get('b')!.release()
  await vi.waitFor(() => { expect(run.mock.calls.map(([, key]) => key)).toEqual(['a', 'b', 'c']) })
  holds.get('c')!.release()
  await effects.idle()
})

it('同 key 换新载荷重排保原队列位', async () => {
  const run = vi.fn(async (_payload: { ticketId: string; assignmentId: string }, _key: string) => {})
  let room = 0
  effects.handle('launch', run, { limit: () => room })
  store.atomic(() => {
    effects.enqueue('launch', 'first', { ticketId: 't1', assignmentId: 'a1' })
    effects.enqueue('launch', 'second', { ticketId: 't2', assignmentId: 'a2' })
    effects.enqueue('launch', 'first', { ticketId: 't1', assignmentId: 'a1' })
  })
  await effects.idle()
  room = 1
  await effects.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['first', 'second'])
})

it('失败按倍增延迟重试、封顶;连续三次失败后该 kind 上报 error', async () => {
  let fail = true
  const run = vi.fn(async () => { if (fail) throw new Error('session busy') })
  effects.handle('notice', run, { retry: [1000, 3000] })
  effects.enqueue('notice', 'prompts', { value: { prompt_config_saved: 2 }, summary: 'Prompt configuration saved' })
  await effects.idle()
  expect(health.notice).toMatchObject({ state: 'ready', detail: '1 waiting since 2026-09-09T00:00:00.000Z' })
  for (const wait of [1000, 2000, 3000, 3000]) {
    clock += wait - 1; await effects.idle()
    const calls = run.mock.calls.length
    clock += 1; await effects.idle()
    expect(run).toHaveBeenCalledTimes(calls + 1)
    if (wait === 2000) {
      const detail = expect.stringContaining('1 waiting since 2026-09-09T00:00:00.000Z; the last failure: Error: session busy') as string
      expect(health.notice).toMatchObject({ state: 'error', detail })
    }
  }
  fail = false
  clock += 3000; await effects.idle()
  expect(health.notice).toMatchObject({ state: 'ready', detail: 'Nothing waiting' })
  expect(effects.pending('notice')).toBe(false)
})

it('drain 后不再启动新 effect;等待行与被关停截断的行保留,下次 start 后照跑', async () => {
  const hold = deferred()
  effects.handle('relay', async () => { await hold.promise; throw new Error('aborted') })
  effects.enqueue('relay', 'cut', relay('a'))
  await vi.waitFor(() => { expect(effects.pending('relay', 'cut')).toBe(true) })
  await Promise.resolve()
  const drained = effects.drain()
  effects.enqueue('relay', 'later', relay('b'))
  hold.resolve(); await drained
  const next = new Effects(store, new HealthBoard(), () => clock)
  next.start()
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  next.handle('relay', run)
  await next.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['cut', 'later'])
})

it('Later 只顺延不计失败:到首个重试延迟后的下一次派发再跑', async () => {
  let later = true
  const run = vi.fn(async () => { if (later) throw new Later('paused') })
  effects.handle('launch', run, { retry: [5000, 60_000] })
  effects.enqueue('launch', 'a', { ticketId: 't', assignmentId: 'a' })
  await effects.idle()
  expect(health.launch).toMatchObject({ state: 'ready', detail: '1 waiting since 2026-09-09T00:00:00.000Z' })
  later = false
  clock += 4999; await effects.idle()
  expect(run).toHaveBeenCalledOnce()
  clock += 1; await effects.idle()
  expect(run).toHaveBeenCalledTimes(2)
  expect(effects.pending('launch')).toBe(false)
})

it('ordered kind 按入队序一次一个;前面的行失败时压住后面的行', async () => {
  const failing = new Set(['first'])
  const run = vi.fn(async (_payload: { text: string }, key: string) => { if (failing.has(key)) throw new Error('offline') })
  effects.handle('relay', run, { ordered: true, limit: () => 4, retry: [1000, 1000] })
  effects.enqueue('relay', 'first', relay('a')); effects.enqueue('relay', 'second', relay('b'))
  await effects.idle()
  clock += 1000; await effects.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['first', 'first'])
  failing.clear()
  clock += 1000; await effects.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['first', 'first', 'first', 'second'])
})

it('quiet kind 的失败不进健康;无就绪行时不询问 limit', async () => {
  const limit = vi.fn(() => 4)
  effects.handle('delivery', async () => { throw new Error('Session gone') }, { quiet: true, limit, retry: [1000, 1000] })
  effects.kick(); await effects.idle()
  expect(limit).not.toHaveBeenCalled()
  effects.enqueue('delivery', 't', { ticketId: 't' })
  for (let attempt = 0; attempt < 4; attempt++) { await effects.idle(); clock += 1000 }
  expect(health.delivery).toMatchObject({ state: 'ready', detail: '1 waiting since 2026-09-09T00:00:00.000Z' })
})

it('运行中 cancel 并重排:第一次运行照常结束,不终结重排后的行', async () => {
  const hold = deferred()
  const run = vi.fn(async (_payload: { text: string }, _key: string) => { if (run.mock.calls.length === 1) await hold.promise })
  effects.handle('relay', run)
  effects.enqueue('relay', 'k', relay('first'))
  await vi.waitFor(() => { expect(run).toHaveBeenCalledOnce() })
  effects.cancel('relay', 'k')
  effects.enqueue('relay', 'k', relay('second'))
  hold.resolve()
  await effects.idle()
  expect(run.mock.calls.map(([payload]) => payload.text)).toEqual(['first', 'second'])
  expect(effects.pending('relay')).toBe(false)
})

it('重启后排入的 effect 落在既有等待行之后(ordered kind,seq 跨重启连续)', async () => {
  const hold = deferred()
  effects.handle('relay', async () => { await hold.promise; throw new Error('aborted') }, { ordered: true })
  effects.enqueue('relay', 'first', relay('a'))
  effects.enqueue('relay', 'second', relay('b'))
  await vi.waitFor(() => { expect(effects.pending('relay', 'first')).toBe(true) })
  const drained = effects.drain()
  hold.resolve(); await drained
  // seq 跨重启连续:新排的 effect 在既有等待行之后跑。
  const next = new Effects(store, new HealthBoard(), () => clock)
  next.enqueue('relay', 'third', relay('c'))
  next.start()
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  next.handle('relay', run, { ordered: true })
  await next.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['first', 'second', 'third'])
})

it('队列自身的失败上报在该 kind 名下,直到该 kind 再次派发成功', async () => {
  let broken = true
  effects.handle('relay', async () => {}, { limit: () => { if (broken) throw new Error('database is locked'); return 1 } })
  effects.enqueue('relay', 'k', relay('a'))
  await effects.idle()
  expect(health.relay).toMatchObject({ state: 'error', detail: 'effect 队列失败:Error: database is locked' })
  broken = false
  effects.kick()
  await effects.idle()
  expect(health.relay).toMatchObject({ state: 'ready', detail: 'Nothing waiting' })
})

it('同一 kind 拒绝第二个 handler', () => {
  effects.handle('relay', async () => {})
  const again = (): void => { effects.handle('relay', async () => {}) }
  expect(again).toThrow('relay effects 已有 handler')
})
