/**
 * Outbox 回执投递(35 号 A13 验收门禁;34 号 §4-C outbox 行)。
 *
 * 目标判据:回执幂等(同 id 不二发)、paused 挂起、同会话 behind 排队、
 * channelIgnored/channelGone 落 dropped——投递端换 channels 桩(34 号 §4-C 原文)。
 * 语义自 SA src/app/outbox.ts 行为移植;SA 经 SourceRegistry/Commands 的面,
 * 本仓换 ChannelsDelivery 端口桩(A13「投递端换 channels」)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Effects, HealthBoard, Store } from '../src/index.ts'
import { Outbox } from '../src/effects/outbox.ts'
import type { ChannelsDelivery } from '../src/index.ts'
import type { OutboundMessage } from '../src/index.ts'

const REALM = 'alice'
let directory: string
let store: Store
let effects: Effects
let outbox: Outbox
let clock: number
const state = { paused: false, available: true, allowed: true, fail: new Set<string>(), result: 'sent' as 'sent' | 'gone' | 'waiting' }
const delivered: string[] = []
const channel = { source: 'chat', thread: 't1', address: {} }
const message = (id: string, overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id, channel, text: `text of ${id}`, kind: 'reply', ticketId: 'T1', ...overrides,
})

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tasks-outbox-'))
  store = new Store(REALM, { tenantRoot: directory })
  clock = Date.parse('2026-09-09T00:00:00Z')
  const board = new HealthBoard()
  effects = new Effects(store, board, () => clock)
  effects.start()
  state.paused = false; state.available = true; state.allowed = true; state.fail.clear(); state.result = 'sent'
  delivered.length = 0
  const channels: ChannelsDelivery = {
    available: source => state.available && source === 'chat',
    channelAllowed: () => state.allowed,
    send: async (receipt) => {
      if (state.fail.has(receipt.id)) throw new Error('offline')
      if (state.result === 'sent') delivered.push(receipt.id)
      return state.result
    },
  }
  outbox = new Outbox({ store, effects, channels, paused: () => state.paused })
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

it('回执幂等:同 id 只记录第一条、只投递一次;送达后 status=sent', async () => {
  outbox.send(message('m1'))
  outbox.send(message('m1', { text: 'changed' }))
  await outbox.sent()
  expect(delivered).toEqual(['m1'])
  expect(outbox.status('m1')).toBe('sent')
  expect(store.receipts.get('m1')).toMatchObject({ text: 'text of m1', status: 'sent' })
  // 已 sent 的 id 再入队:回执保留原状,不再投递。
  outbox.send(message('m1'))
  await outbox.sent()
  expect(delivered).toEqual(['m1'])
})

it('paused 挂起:暂停期全部压住,恢复后照发', async () => {
  state.paused = true
  outbox.send(message('held'))
  await outbox.sent()
  expect([outbox.status('held'), delivered]).toEqual(['pending', []])
  state.paused = false
  await outbox.sent()
  expect([outbox.status('held'), delivered]).toEqual(['sent', ['held']])
})

it('渠道不可用(waiting/uninstalled)以 Later 等待,不计失败', async () => {
  state.available = false
  outbox.send(message('wait'))
  await outbox.sent()
  expect([outbox.status('wait'), delivered]).toEqual(['pending', []])
  state.available = true
  clock += 5000; await outbox.sent()
  expect([outbox.status('wait'), delivered]).toEqual(['sent', ['wait']])
})

it('同会话 behind 排队:更早消息反复失败时压住后续;失败达阈值后放行,恢复后补发', async () => {
  state.fail.add('a')
  outbox.send(message('a'))
  outbox.send(message('b'))
  await outbox.sent()
  // a 首败(attempts=1<3):b 被 behind 压住;失败痕迹在 reads.failingReplies 可查。
  expect([outbox.status('a'), outbox.status('b'), delivered]).toEqual(['pending', 'pending', []])
  const failing = store.read.failingReplies()
  expect(failing.map(item => [item.id, item.attempts])).toEqual([['a', 1]])
  expect(failing[0]!.error).toContain('offline')
  // reply 退避:初值 5000。逐轮推进——a 第二、三次失败;b 在 a 失败达阈值后放行。
  for (let round = 0; round < 3; round++) { clock += 5000; await outbox.sent() }
  expect([outbox.status('b'), delivered]).toEqual(['sent', ['b']])
  expect(outbox.status('a')).toBe('pending')
  // a 恢复后补发(第三次失败后 due = now + 5000×2²)。
  state.fail.delete('a')
  clock += 20_000; await outbox.sent()
  expect([outbox.status('a'), delivered]).toEqual(['sent', ['b', 'a']])
})

it('channelIgnored:渠道会话不再被监听 → 落 dropped,不留 effect 行', async () => {
  state.allowed = false
  outbox.send(message('ignored'))
  await outbox.sent()
  expect(outbox.status('ignored')).toBe('dropped')
  expect(store.receipts.get('ignored')).toMatchObject({ dropped: { reason: 'channelIgnored' } })
  expect(effects.pending('reply', 'ignored')).toBe(false)
})

it('channelGone:目标永久不可达 → 落 dropped(回执防其后重试)', async () => {
  state.result = 'gone'
  outbox.send(message('gone'))
  await outbox.sent()
  expect(outbox.status('gone')).toBe('dropped')
  expect(store.receipts.get('gone')).toMatchObject({ dropped: { reason: 'channelGone' } })
  expect(delivered).toEqual([])
})

it('withdraw:撤回未发出的消息,不再投递;同 id 重发为新回执', async () => {
  state.paused = true
  outbox.send(message('w'))
  outbox.withdraw('w')
  expect(outbox.status('w')).toBeUndefined()
  state.paused = false
  await outbox.sent()
  expect(delivered).toEqual([])
  state.paused = true
  outbox.send(message('w', { text: 'again' }))
  state.paused = false
  await outbox.sent()
  expect([outbox.status('w'), delivered, store.receipts.get('w')?.text]).toEqual(['sent', ['w'], 'again'])
})
