/**
 * effect 行重启重派与 notice 去重(35 号 A12;34 号 §4-C queue 行 → effects-resume)。
 *
 * 语义承接 SA tests/queue.spec.ts 可独立于 runtime 的部分(SA 该 spec 深度绑定
 * schema-10 迁移与 runtime 胶水,本仓 v1 无迁移史、passes/notices 不整体移植——
 * 34 号 §2.6「机制并入」):
 * - 重启(关库重开 + 新 Effects 实例)后 effect 行照旧重派、按 seq 保序;
 * - notice 去重机制 = enqueue 的 UPSERT 合并:同 kind+key 只留最新载荷、attempts 归零,
 *   重启后只投递一次;
 * - 失败计数跨重启保留(退避不重头)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Effects, HealthBoard, Store } from '../src/index.ts'

const REALM = 'alice'
let directory: string
let store: Store
let clock: number
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tasks-resume-'))
  store = new Store(REALM, { tenantRoot: directory })
  clock = Date.parse('2026-09-09T00:00:00Z')
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
/** 某条 effect 行的累计失败次数(直读持久层,跨「重启」对账)。 */
const attemptsOf = (kind: string, key: string): number | undefined =>
  (store.db.prepare('SELECT attempts FROM effect WHERE kind = ? AND key = ?').get(kind, key) as { attempts: number } | undefined)?.attempts

it('重启后 effect 行重派:等待行与在跑被截断的行都在新实例上按 seq 照跑', async () => {
  // 第一个进程:一个在跑行被关停截断(完成后不再改行),另留一条等待行。
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = new Effects(store, new HealthBoard(), () => clock)
  const stuck = vi.fn(async () => { await gate; throw new Error('aborted') })
  first.handle('launch', stuck, { ordered: true })
  first.start()
  first.enqueue('launch', 'cut', { ticketId: 't1', assignmentId: 'cut' })
  await vi.waitFor(() => { expect(stuck).toHaveBeenCalledOnce() })
  const drained = first.drain()
  first.enqueue('launch', 'waited', { ticketId: 't2', assignmentId: 'waited' })
  release()
  await drained
  // 真重启:关库重开(持久层落下全部行),装配新 Effects。
  store.close()
  store = new Store(REALM, { tenantRoot: directory })
  const next = new Effects(store, new HealthBoard(), () => clock)
  const run = vi.fn(async (_payload: { ticketId: string; assignmentId: string }, _key: string) => {})
  next.handle('launch', run, { ordered: true })
  next.start()
  await next.idle()
  expect(run.mock.calls.map(([, key]) => key)).toEqual(['cut', 'waited'])
})

it('notice 去重:同 kind+key 的 UPSERT 合并只留最新载荷,重启后只投递一次', async () => {
  // 排队期间(未 start)两次保存产生两条 notice:队列里只有最新载荷。
  const dormant = new Effects(store, new HealthBoard(), () => clock)
  dormant.enqueue('notice', 'settings:pause', { value: { settings_saved: 1 }, summary: 'saved 1' })
  dormant.enqueue('notice', 'settings:pause', { value: { settings_saved: 2 }, summary: 'saved 2' })
  const rows = store.db.prepare("SELECT key, value FROM effect WHERE kind = 'notice'").all() as Array<{ key: string; value: string }>
  expect(rows).toHaveLength(1)
  expect(JSON.parse(rows[0]!.value)).toEqual({ value: { settings_saved: 2 }, summary: 'saved 2' })
  // 重启后投递:一次、且是最新载荷。
  store.close()
  store = new Store(REALM, { tenantRoot: directory })
  const next = new Effects(store, new HealthBoard(), () => clock)
  const run = vi.fn(async (_payload: { value: Record<string, unknown>; summary: string }, _key: string) => {})
  next.handle('notice', run)
  next.start()
  await next.idle()
  expect(run.mock.calls).toHaveLength(1)
  expect(run.mock.calls[0]![0].value).toEqual({ settings_saved: 2 })
  expect(next.pending('notice')).toBe(false)
})

it('失败计数跨重启保留:attempts 不归零,退避继续加深', async () => {
  const failing = new Effects(store, new HealthBoard(), () => clock)
  failing.handle('relay', async () => { throw new Error('offline') }, { retry: [1000, 60_000] })
  failing.start()
  failing.enqueue('relay', 'k', { text: 'a' })
  await failing.idle()
  clock += 1000; await failing.idle()
  // 两次失败后「重启」:attempts=2 落库;第二次失败的 due = (base+1000)+2000 = base+3000。
  expect(attemptsOf('relay', 'k')).toBe(2)
  store.close()
  store = new Store(REALM, { tenantRoot: directory })
  const next = new Effects(store, new HealthBoard(), () => clock)
  next.handle('relay', async () => { throw new Error('still offline') }, { retry: [1000, 60_000] })
  next.start()
  clock += 1999; await next.idle()
  // 未到 due(base+2999 < base+3000):没有第三次尝试,attempts 保持 2。
  expect(attemptsOf('relay', 'k')).toBe(2)
  clock += 1; await next.idle()
  expect(attemptsOf('relay', 'k')).toBe(3)
})
