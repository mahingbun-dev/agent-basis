/**
 * session 冒烟:append 序列/查询过滤/落盘/session-event 采集点/审批事件落盘接线。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@core/cordis'
import { SessionStoreImpl } from '../src/store.ts'
import plugin from '../src/index.ts'

describe('SessionStoreImpl', () => {
  it('append 分配单调 seq/time;query 按 type 与 seq 边界过滤', () => {
    let clock = 1000
    const store = new SessionStoreImpl({ now: () => { clock += 5; return clock } })
    store.append('turn/start', { turn: 1 })
    store.append('tool/call', { name: 'a' })
    store.append('turn/end', { turn: 1 })
    expect(store.size()).toBe(3)
    expect(store.query().map(event => event.seq)).toEqual([1, 2, 3])
    expect(store.query({ type: 'tool/call' }).length).toBe(1)
    expect(store.query({ sinceSeq: 2, untilSeq: 3 }).map(event => event.type)).toEqual(['tool/call', 'turn/end'])
    expect(store.query()[0]?.time).toBe(1005)
  })

  it('file 落盘:JSONL 逐行追加', () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-session-'))
    const file = join(dir, 'sub', 'session.jsonl')
    const store = new SessionStoreImpl({ file })
    store.append('turn/start', { turn: 1 })
    store.append('turn/end', { turn: 1 })
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!) as { type: string }).toMatchObject({ type: 'turn/start', seq: 1 })
  })

  it('onEvent 采集点每事件触发', () => {
    const seen: string[] = []
    const store = new SessionStoreImpl({ onEvent: (event) => { seen.push(event.type) } })
    store.append('a', {})
    store.append('b', {})
    expect(seen).toEqual(['a', 'b'])
  })
})

describe('插件装配', () => {
  it('provide ctx.session + approval 事件落盘 + session/event 采集点', async () => {
    const ctx = new Context()
    const sessionEvents: string[] = []
    ctx.events.on('session/event', (event) => {
      const record = event as { readonly type: string }
      sessionEvents.push(record.type)
    })
    const fiber = ctx.plugin(plugin)
    await fiber
    const store = (ctx as unknown as { session: SessionStoreImpl }).session
    expect(typeof store.append).toBe('function')

    // 模拟 approval 插件发事件 → session 订阅落盘
    ctx.events.emit('approval/asked', { id: 'r1', tool: 'pay_deposit', reasons: ['R3'] })
    ctx.events.emit('approval/decided', { id: 'r1', outcome: 'rejected' })
    const types = store.query().map(event => event.type)
    expect(types).toEqual(['approval/asked', 'approval/decided'])
    expect(sessionEvents).toEqual(['approval/asked', 'approval/decided'])

    await fiber.dispose()
    expect(ctx.reflect.get('session', false)).toBeUndefined()
  })
})
