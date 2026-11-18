/**
 * 组件健康面(35 号 A16/A27 具名门禁 tests/health.spec.ts;34 §4-G「health.spec.ts /
 * retry-health.spec.ts → tests/health.spec.ts(合并)」判据:组件健康错误态与恢复、瞬时错误
 * (transient 正则,SA dsh.ts:44-55)退避重试)。
 *
 * 合并承接说明(34 §2.6 第二行「健康面并入装配与 effects」):
 * - SA tests/health.spec.ts(relay/reply/notice 三 kind:三败置 error、成功恢复转 ready、
 *   quiet kind 不置)→ 本仓 src/effects/effects.ts 的 HealthBoard 认领制 + Effects per-kind
 *   上报;relay/reply/notice 的 runtime 装配级驱动经 Effects 假 handler 直驱等价承接
 *   (effects.spec.ts 已全量断言同一机制,本文件聚焦健康面的门禁判据)。
 * - SA tests/retry-health.spec.ts → 其瞬时判定机制面 = src/executor/dsh.ts `transient()`
 *   (PASSING 正则 + status/code 判定,重试面 retries()/resumeAfter() 指数退避已随
 *   effects.spec.ts 退避断言覆盖);SA RetryHealth 的 llm/retry 事件投影属面板消费面,
 *   不承接(30 号 workbench,34 §4-H 同理)。
 * - 装配级健康面(tasks 条目/关停注销)见 plugin-boot.spec.ts,不在此重复。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effects, FAILURES_BEFORE_ERROR, HealthBoard, Store, transient, type Health } from '../src/index.ts'

describe('HealthBoard 认领制(单写者组件健康注册表;SA infra/health.ts 机制面最小移植)', () => {
  it('claim/set/get:认领后单写者上报,all 视图为稳定引用(捕获一次即见后续变更)', () => {
    const board = new HealthBoard()
    const view = board.all
    const entry = board.claim('tasks', { state: 'starting', detail: '装配中' })
    expect(view.tasks).toMatchObject({ state: 'starting' })
    entry.set({ state: 'ready', detail: 'realm 就绪', at: '2026-11-18T00:00:00.000Z' })
    expect(entry.get()).toMatchObject({ state: 'ready', detail: 'realm 就绪' })
    expect(view.tasks).toMatchObject({ state: 'ready' })
    expect(board.all.tasks).toMatchObject({ state: 'ready' })
  })
  it('release 注销:set 随之失效、条目从视图缺席(同 SA delete 后缺席语义);同名可重认领', () => {
    const board = new HealthBoard()
    const entry = board.claim('tasks', { state: 'ready', detail: '' })
    entry.release()
    expect(board.all.tasks).toBeUndefined()
    entry.set({ state: 'error', detail: '迟到的上报' })
    expect(entry.get()).toBeUndefined()
    // 注销后可重新认领(装配重启语义)。
    const again = board.claim('tasks', { state: 'starting', detail: '重启' })
    expect(again.get()).toMatchObject({ state: 'starting' })
  })
  it('重复 claim 同名拒绝(单写者不变量);release 二次调用幂等', () => {
    const board = new HealthBoard()
    const entry = board.claim('reply', { state: 'ready', detail: '' })
    expect(() => board.claim('reply', { state: 'ready', detail: '' })).toThrow('已由其他部件上报')
    entry.release()
    expect(() => { entry.release() }).not.toThrow()
  })
})

describe('Effects per-kind 健康错误态与恢复(SA health.spec「三败置 error、恢复转 ready」)', () => {
  let directory: string
  let store: Store
  let clock: number
  let board: HealthBoard
  let health: Readonly<Record<string, Health | undefined>>
  let effects: Effects
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tasks-health-'))
    store = new Store('alice', { tenantRoot: directory })
    clock = Date.parse('2026-09-09T00:00:00Z')
    board = new HealthBoard()
    health = board.all
    effects = new Effects(store, board, () => clock)
    effects.start()
  })
  afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

  it(`连续 ${FAILURES_BEFORE_ERROR} 次失败后该 kind 置 error(带末次失败),恢复后转 ready;runtime 就绪态不被单 kind 污染`, async () => {
    let fail = true
    const run = vi.fn(async () => { if (fail) throw new Error('session busy') })
    effects.handle('relay', run, { retry: [1000, 3000] })
    effects.enqueue('relay', 'r1', { text: 'follow up' })
    await effects.idle()
    // 首败:ready(等待中),未达阈值。
    expect(health.relay).toMatchObject({ state: 'ready', detail: '1 waiting since 2026-09-09T00:00:00.000Z' })
    // 二败、三败(attempts 递增到阈值)→ error,detail 携带末次失败原因。
    for (const wait of [1000, 2000]) {
      clock += wait; await effects.idle()
    }
    expect(run).toHaveBeenCalledTimes(FAILURES_BEFORE_ERROR)
    const detail = expect.stringContaining('1 waiting since 2026-09-09T00:00:00.000Z; the last failure: Error: session busy') as string
    expect(health.relay).toMatchObject({ state: 'error', detail })
    // 恢复:下一次派发成功即转 ready、无等待;其他 kind 的条目不受影响(独立认领)。
    fail = false
    clock += 3000; await effects.idle()
    expect(health.relay).toMatchObject({ state: 'ready', detail: 'Nothing waiting' })
  })
  it('quiet kind 的失败不置 error(健康面如实反映;SA notice/relay 独立恢复语义)', async () => {
    const run = vi.fn(async () => { throw new Error('session busy') })
    effects.handle('delivery', run, { quiet: true, retry: [1000, 1000] })
    effects.enqueue('delivery', 'd1', { ticketId: 'T-1' })
    for (let attempt = 0; attempt < FAILURES_BEFORE_ERROR; attempt++) {
      clock += 1000; await effects.idle()
    }
    expect(run).toHaveBeenCalledTimes(FAILURES_BEFORE_ERROR)
    expect(health.delivery).toMatchObject({ state: 'ready' })
  })
})

describe('transient 判定(SA retry-health.spec 瞬时正则机制面;dsh.ts PASSING + status/code)', () => {
  it.each([
    ['Error: ECONNRESET', new Error('read ECONNRESET')],
    ['Error: ETIMEDOUT', new Error('connect ETIMEDOUT 1.2.3.4:443')],
    ['Error: ECONNREFUSED', new Error('connect ECONNREFUSED')],
    ['socket hang up', new Error('socket hang up')],
    ['fetch failed', new Error('fetch failed')],
    ['overloaded', new Error('provider overloaded')],
    ['rate limit', new Error('rate limit exceeded')],
    ['HTTP 502 in message', new Error('upstream said 502')],
    ['status 429', Object.assign(new Error('Too Many Requests'), { status: 429 })],
    ['status 500', Object.assign(new Error('Internal'), { status: 500 })],
    ['status 408', Object.assign(new Error('Timeout'), { status: 408 })],
    ['code EAI_AGAIN', Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' })],
  ])('可重试(一次性网络/供应商失败):%s', (_label, error) => {
    expect(transient(error)).toBe(true)
  })
  it.each([
    ['budget_exceeded(400)', new Error('OpenAI API error (400): {"type":"budget_exceeded","message":"Budget has been exceeded!"}')],
    ['status 400', Object.assign(new Error('Bad Request'), { status: 400 })],
    ['status 401', Object.assign(new Error('Unauthorized'), { status: 401 })],
    ['status 404', Object.assign(new Error('Not Found'), { status: 404 })],
    ['status 200', Object.assign(new Error('ok'), { status: 200 })],
    ['普通错误', new Error('boom')],
    ['非 Error 任意值', 'just a string'],
  ])('不可重试(确定性失败不进退避):%s', (_label, error) => {
    expect(transient(error)).toBe(false)
  })
  it('判定读 status 与 code 字段,不揭示消息内容以外的引用(纯函数面)', () => {
    // status 数字优先于正则:status 200 即使消息含网络字样也不可重试。
    expect(transient(Object.assign(new Error('rate limit'), { status: 200 }))).toBe(false)
    // 非 Error 的字符串值走 String() 正则面。
    expect(transient('ECONNRESET while fetching')).toBe(true)
  })
})
