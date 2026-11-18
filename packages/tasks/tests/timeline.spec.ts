/**
 * 线程时间线:分页、邻位与时间戳归一(35 号 A11 验收门禁;34 号 §4-C timeline 行)。
 *
 * 被测面 = src/store/reads.ts 只读视图(35 号 A11 门禁原文)。语义自 SA
 * tests/timeline.spec.ts 移植;SA 经 Engine.receive 驱动的入库面,本仓等价地经
 * `isoTime` 归一后落库(intake.ts:29 落库前同款归一——被测的是 reads 的排序与
 * 分页,不需要完整 Engine 装配)。SA 的 threadDetail 视图函数不移植(34 号 §2.6
 * views 不搬),分页游标直接以 reads.threadTriggers 的 before/through 参数驱动。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store, isoTime, type Trigger } from '../src/index.ts'

const REALM = 'alice'
let directory: string
let store: Store
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-timeline-')); store = new Store(REALM, { tenantRoot: directory }) })
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

const comment = (id: string, at: string): Trigger => ({ id, source: 'git', threads: [{ source: 'git', id: '7' }], actor: { source: 'git', id: 'alice' },
  human: true, at, text: `comment ${id}`, meta: {} })
/** 落库前归一时间戳(intake.ts:29 同款:Source 的整秒/+08:00 等形态统一为毫秒 ISO)。 */
const save = (trigger: Trigger): void => { store.triggers.save({ ...trigger, at: isoTime(trigger.at) }) }

it('先按时间、再按 id 分页:与某页最老一条同秒的 trigger 落在下一页', () => {
  for (const item of [comment('a', '2026-10-01T00:00:00.000Z'), comment('b', '2026-10-01T00:00:01.000Z'), comment('c', '2026-10-01T00:00:01.000Z')]) save(item)
  const first = store.read.threadTriggers('git:7', 1)
  expect(first.map(trigger => trigger.id)).toEqual(['c'])
  const firstPlace = { at: first[0]!.at, id: first[0]!.id }
  const second = store.read.threadTriggers('git:7', 1, firstPlace)
  expect(second.map(trigger => trigger.id)).toEqual(['b'])
  const secondPlace = { at: second[0]!.at, id: second[0]!.id }
  const third = store.read.threadTriggers('git:7', 1, secondPlace)
  expect([third.map(trigger => trigger.id), third.length]).toEqual([['a'], 1])
  // 含边界(through):同位游标再取一次含本条。
  const thirdPlace = { at: third[0]!.at, id: third[0]!.id }
  expect(store.read.threadTriggers('git:7', 5, thirdPlace, true).map(trigger => trigger.id)).toEqual(['a'])
  // 越界游标:空页。
  expect(store.read.threadTriggers('git:7', 1, { at: '2026-09-01T00:00:00.000Z', id: '' })).toEqual([])
})

it('offset 分页(threadPage)与时间线全序一致', () => {
  for (const item of [comment('a', '2026-10-01T00:00:00.000Z'), comment('b', '2026-10-01T00:00:01.000Z'), comment('c', '2026-10-01T00:00:02.000Z')]) save(item)
  expect(store.read.threadPage('git:7', 0, 2).map(trigger => trigger.id)).toEqual(['c', 'b'])
  expect(store.read.threadPage('git:7', 2, 2).map(trigger => trigger.id)).toEqual(['a'])
})

it('同一时刻的 trigger 之间按 id 找邻位', () => {
  for (const item of [comment('a', '2026-10-01T00:00:01.000Z'), comment('b', '2026-10-01T00:00:01.000Z'), comment('c', '2026-10-01T00:00:01.000Z')]) save(item)
  const around = store.read.neighbours('git:7', '2026-10-01T00:00:01.000Z', 'b')
  expect([around.before?.id, around.after?.id]).toEqual(['a', 'c'])
})

it('时间戳归一(isoTime):整秒与 +08:00 形态统一为毫秒 ISO,字典序即时间序', () => {
  expect(isoTime('2026-10-01T00:00:00Z')).toBe('2026-10-01T00:00:00.000Z')
  expect(isoTime('2026-10-01T08:00:00+08:00')).toBe('2026-10-01T00:00:00.000Z')
  // 无法解析的值原样返回(落库时间戳守卫不炸穿)。
  expect(isoTime('not-a-time')).toBe('not-a-time')
  // 整秒写法(如 GitHub)若不归一,字典序会排在 .001 之后——归一后时间线正确排序。
  save(comment('old', '2026-10-01T00:00:00Z'))
  save(comment('new', '2026-10-01T00:00:00.500Z'))
  save(comment('newest', '2026-10-01T00:00:01Z'))
  const line = store.read.threadTriggers('git:7', 50)
  expect(line.map(trigger => trigger.id)).toEqual(['old', 'new', 'newest'])
  expect(line.map(trigger => trigger.at)).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.500Z', '2026-10-01T00:00:01.000Z'])
  // trigger_thread 索引行与 trigger 行同刻(分页与邻位的 (at, id) 复合键不漂)。
  const raw = store.db.prepare('SELECT at FROM trigger_thread WHERE id = ?').get('old') as { at: string }
  expect(raw.at).toBe('2026-10-01T00:00:00.000Z')
})
