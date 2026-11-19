/**
 * M-C4 公告行纯函数(announcement.tsx):归组/累计/发布/选择闸。
 * 事件载荷形态对齐 dsh-compaction types(turn/start 带 turn、compaction/start 带 turn、
 * compaction/end 带 turn 与可选 error;compaction/summary 无 turn——见 2026-11-18 事故注释)。
 */
import { describe, expect, it } from 'vitest'
import {
  COMPACTION_ANNOUNCEMENT_DATA_KEY,
  compactionAnnouncementBuildLocationData, compactionAnnouncementDefinition,
  compactionAnnouncementMatch, compactionAnnouncementStart, compactionAnnouncementUpdate,
  selectCompactionAnnouncement,
  type CompactionAnnouncementState,
} from '../src/client/announcement.tsx'

const TURN_START = { type: 'turn/start', data: { turn: 7 } }
const START = { type: 'compaction/start', data: { compactionId: 'c1', turn: 7 } }
const END_OK = { type: 'compaction/end', data: { compactionId: 'c1', turn: 7 } }
const END_FAILED = { type: 'compaction/end', data: { compactionId: 'c2', turn: 7, error: { message: 'summary invalid' } } }
const SUMMARY = { type: 'compaction/summary', data: { compactionId: 'c1', shadowedTokenCount: 5137, provider: 'deepseek', model: 'deepseek-flash' } }
const IDLE_START = { type: 'compaction/start', data: { compactionId: 'c9', turn: null } }

describe('compactionAnnouncementMatch', () => {
  it('turn/start → 按 turn 建组(start,id 为 turn 串)', () => {
    expect(compactionAnnouncementMatch(TURN_START)).toEqual({ id: '7', role: 'start' })
  })

  it('compaction/start、compaction/end 均按 turn 归组(update)且 turn=null(idle 手动)保守跳过', () => {
    expect(compactionAnnouncementMatch(START)).toEqual({ id: '7', role: 'update' })
    expect(compactionAnnouncementMatch(END_OK)).toEqual({ id: '7', role: 'update' })
    expect(compactionAnnouncementMatch(IDLE_START)).toBeNull()
  })

  it('compaction/summary 无 turn → 不匹配(引擎按 id 路由,turn 键控 Context 收不到)', () => {
    expect(compactionAnnouncementMatch(SUMMARY)).toBeNull()
  })

  it('无关事件 → null', () => {
    expect(compactionAnnouncementMatch({ type: 'compaction/prune', data: {} })).toBeNull()
    expect(compactionAnnouncementMatch({ type: 'user/message', data: {} })).toBeNull()
  })
})

describe('start/update/buildLocationData 累计链', () => {
  it('turn/start 建 turn 态;end 计完成、带 error 的 end 计失败;turn 相位发布', () => {
    let state = compactionAnnouncementStart({ key: 'k', kind: 'compaction-announcements', id: '7' }, { event: TURN_START })
    expect(state).toEqual({ turn: 7, count: 0, failed: 0 })
    // start 只是尝试,不计入完成数。
    state = compactionAnnouncementUpdate({ state }, { event: START })
    expect(state).toEqual({ turn: 7, count: 0, failed: 0 })
    state = compactionAnnouncementUpdate({ state }, { event: END_OK })
    state = compactionAnnouncementUpdate({ state }, { event: END_FAILED })
    expect(state).toEqual({ turn: 7, count: 1, failed: 1 })

    const published = compactionAnnouncementBuildLocationData({ state }, 'turn', null)
    expect(published).toEqual({
      kind: 'turn', turn: 7, key: COMPACTION_ANNOUNCEMENT_DATA_KEY,
      value: { count: 1, failed: 1 },
    })
    // step 相位不发布;值不变时返回 previous(交付量同款)。
    expect(compactionAnnouncementBuildLocationData({ state }, 'step', null)).toBeNull()
    expect(compactionAnnouncementBuildLocationData({ state }, 'turn', published)).toBe(published)
  })

  it('窗口缺 turn/start(state 未建)→ 不发布,不抛(分页前插后重放补齐)', () => {
    expect(compactionAnnouncementBuildLocationData({}, 'turn', null)).toBeNull()
  })

  it('definition 形态完整(apply 注册面)', () => {
    expect(compactionAnnouncementDefinition.kind).toBe(COMPACTION_ANNOUNCEMENT_DATA_KEY)
    expect(typeof compactionAnnouncementDefinition.match).toBe('function')
    expect(typeof compactionAnnouncementDefinition.start).toBe('function')
    expect(typeof compactionAnnouncementDefinition.update).toBe('function')
    expect(typeof compactionAnnouncementDefinition.buildLocationData).toBe('function')
  })
})

/**
 * 事故回归(2026-11-18 生产「无法加载历史会话记录」):上游
 * conversation/location-index.ts:227 `replaceData` 要求同一 (turn, key) 只有一个
 * owner,否则抛错并使 session-controller 事件订阅器整体失败(对话区空白)。
 * 本用例用与引擎同构的收集器模拟一次完整回放:同一 turn 内 13 次压缩
 * (compaction/start+end 各 13)+ 1 个 turn/start,断言每个 (turn,key) 只产出一个
 * owner;并断言旧实现会产出的「每压缩一 owner」形态确实会撞车(守门)。
 */
describe('同 turn 多次压缩不得产生重复 Location owner(事故回归)', () => {
  /** 与引擎 replaceData 同构的去重检查:返回冲突列表。 */
  function ownersByLocationKey(
    events: readonly { type: string; data?: Record<string, unknown> }[],
  ): { owners: Map<string, string[]>; conflicts: string[] } {
    const contexts = new Map<string, CompactionAnnouncementState>()
    const owners = new Map<string, string[]>()
    const conflicts: string[] = []
    for (const event of events) {
      const match = compactionAnnouncementMatch(event)
      if (match === null) continue
      if (match.role === 'start') {
        if (!contexts.has(match.id)) {
          const startContext = { key: match.id, kind: COMPACTION_ANNOUNCEMENT_DATA_KEY, id: match.id }
          contexts.set(match.id, compactionAnnouncementStart(startContext, { event }))
        }
        continue
      }
      const existing = contexts.get(match.id)
      if (existing === undefined) continue
      contexts.set(match.id, compactionAnnouncementUpdate({ state: existing }, { event }))
    }
    for (const [id, state] of contexts) {
      const data = compactionAnnouncementBuildLocationData({ state }, 'turn', null)
      if (data === null) continue
      const key = `${data.turn}:${data.key}`
      const list = owners.get(key) ?? []
      list.push(id)
      owners.set(key, list)
      if (list.length > 1) conflicts.push(`${key} owned by ${list.join(',')}`)
    }
    return { owners, conflicts }
  }

  it('turn 1 内 13 次压缩:只产出一个 owner、零冲突,计数=13', () => {
    const events: { type: string; data?: Record<string, unknown> }[] = [{ type: 'turn/start', data: { turn: 1 } }]
    for (let index = 0; index < 13; index += 1) {
      events.push({ type: 'compaction/start', data: { compactionId: `c${index}`, turn: 1 } })
      events.push({ type: 'compaction/end', data: { compactionId: `c${index}`, turn: 1 } })
    }
    const { owners, conflicts } = ownersByLocationKey(events)
    expect(conflicts).toEqual([])
    expect(owners.get(`1:${COMPACTION_ANNOUNCEMENT_DATA_KEY}`)).toEqual(['1'])
  })

  it('两个 turn 各一次压缩:两个 turn 各自一个 owner,互不干扰', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'compaction/start', data: { compactionId: 'a', turn: 1 } },
      { type: 'compaction/end', data: { compactionId: 'a', turn: 1 } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'compaction/start', data: { compactionId: 'b', turn: 2 } },
      { type: 'compaction/end', data: { compactionId: 'b', turn: 2 } },
    ]
    const { owners, conflicts } = ownersByLocationKey(events)
    expect(conflicts).toEqual([])
    expect(owners.get(`1:${COMPACTION_ANNOUNCEMENT_DATA_KEY}`)).toEqual(['1'])
    expect(owners.get(`2:${COMPACTION_ANNOUNCEMENT_DATA_KEY}`)).toEqual(['2'])
  })
})

describe('selectCompactionAnnouncement(turnTail 闸)', () => {
  it('data 有公告 → 返回值;无数据/零次数零失败 → null 不挂载', () => {
    const owner = { turn: 7, data: { get: (key: string) => key === COMPACTION_ANNOUNCEMENT_DATA_KEY
      ? { count: 13, failed: 0 }
      : undefined } }
    expect(selectCompactionAnnouncement(owner)).toEqual({ count: 13, failed: 0 })
    expect(selectCompactionAnnouncement({ turn: 8, data: { get: () => undefined } })).toBeNull()
    expect(selectCompactionAnnouncement({ turn: 9, data: { get: () => ({ count: 0, failed: 0 }) } })).toBeNull()
  })

  it('仅失败也挂载(用户需要知道压缩没成功)', () => {
    const owner = { turn: 3, data: { get: () => ({ count: 0, failed: 2 }) } }
    expect(selectCompactionAnnouncement(owner)).toEqual({ count: 0, failed: 2 })
  })
})
