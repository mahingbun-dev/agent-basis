/**
 * M-C4 公告行纯函数(announcement.tsx):归组/累计/发布/选择闸。
 * 事件载荷形态对齐 dsh-compaction types(compaction/start 带 turn,
 * compaction/summary 带 shadowedTokenCount/provider/model)。
 */
import { describe, expect, it } from 'vitest'
import {
  COMPACTION_ANNOUNCEMENT_DATA_KEY,
  compactionAnnouncementBuildLocationData, compactionAnnouncementDefinition,
  compactionAnnouncementMatch, compactionAnnouncementStart, compactionAnnouncementUpdate,
  selectCompactionAnnouncement,
} from '../src/client/announcement.tsx'

const START = { type: 'compaction/start', data: { compactionId: 'c1', turn: 7 } }
const SUMMARY_A = { type: 'compaction/summary', data: { compactionId: 'c1', shadowedTokenCount: 5137, provider: 'deepseek', model: 'deepseek-flash' } }
const SUMMARY_B = { type: 'compaction/summary', data: { compactionId: 'c1', shadowedTokenCount: 1444, provider: 'deepseek', model: 'deepseek-flash' } }
const IDLE_START = { type: 'compaction/start', data: { compactionId: 'c2', turn: null } }
const FAILED_SUMMARY = { type: 'compaction/summary', data: { compactionId: 'c9', shadowedTokenCount: 0, provider: 'p', model: 'm' } }

describe('compactionAnnouncementMatch', () => {
  it('compaction/start 带 turn → start 组;turn=null(idle 手动)→ 保守跳过', () => {
    expect(compactionAnnouncementMatch(START)).toEqual({ id: 'c1', role: 'start' })
    expect(compactionAnnouncementMatch(IDLE_START)).toBeNull()
  })

  it('compaction/summary 带正释放量 → update;零释放(异常形态)→ 跳过', () => {
    expect(compactionAnnouncementMatch(SUMMARY_A)).toEqual({ id: 'c1', role: 'update' })
    expect(compactionAnnouncementMatch(FAILED_SUMMARY)).toBeNull()
  })

  it('无关事件 → null', () => {
    expect(compactionAnnouncementMatch({ type: 'turn/start', data: { turn: 1 } })).toBeNull()
    expect(compactionAnnouncementMatch({ type: 'compaction/prune', data: {} })).toBeNull()
  })
})

describe('start/update/buildLocationData 累计链', () => {
  it('start 建 turn 态;两次 summary 累计释放量且模型去重;turn 相位发布', () => {
    const matchA = compactionAnnouncementMatch(START)
    expect(matchA).not.toBeNull()
    let state = compactionAnnouncementStart({ key: 'k', kind: 'compaction-announcements', id: 'c1' }, { event: START })
    expect(state).toEqual({ turn: 7, count: 0, savedTokens: 0, models: [] })
    state = compactionAnnouncementUpdate({ state }, { event: SUMMARY_A })
    state = compactionAnnouncementUpdate({ state }, { event: SUMMARY_B })
    expect(state).toEqual({ turn: 7, count: 2, savedTokens: 6581, models: ['deepseek/deepseek-flash'] })

    const published = compactionAnnouncementBuildLocationData({ state }, 'turn', null)
    expect(published).toEqual({
      kind: 'turn', turn: 7, key: COMPACTION_ANNOUNCEMENT_DATA_KEY,
      value: { count: 2, savedTokens: 6581, models: ['deepseek/deepseek-flash'] },
    })
    // step 相位不发布;值不变时返回 previous(交付量同款)。
    expect(compactionAnnouncementBuildLocationData({ state }, 'step', null)).toBeNull()
    expect(compactionAnnouncementBuildLocationData({ state }, 'turn', published)).toBe(published)
  })

  it('definition 形态完整(apply 注册面)', () => {
    expect(compactionAnnouncementDefinition.kind).toBe(COMPACTION_ANNOUNCEMENT_DATA_KEY)
    expect(typeof compactionAnnouncementDefinition.match).toBe('function')
    expect(typeof compactionAnnouncementDefinition.start).toBe('function')
    expect(typeof compactionAnnouncementDefinition.update).toBe('function')
    expect(typeof compactionAnnouncementDefinition.buildLocationData).toBe('function')
  })
})

describe('selectCompactionAnnouncement(turnTail 闸)', () => {
  it('data 有公告 → 返回值;无数据/零次数 → null 不挂载', () => {
    const owner = { turn: 7, data: { get: (key: string) => key === COMPACTION_ANNOUNCEMENT_DATA_KEY
      ? { count: 1, savedTokens: 5137, models: ['p/m'] }
      : undefined } }
    expect(selectCompactionAnnouncement(owner)).toEqual({ count: 1, savedTokens: 5137, models: ['p/m'] })
    expect(selectCompactionAnnouncement({ turn: 8, data: { get: () => undefined } })).toBeNull()
    expect(selectCompactionAnnouncement({ turn: 9, data: { get: () => ({ count: 0, savedTokens: 0, models: [] }) } })).toBeNull()
  })
})
