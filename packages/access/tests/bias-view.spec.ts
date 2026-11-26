/**
 * 偏置显示口径与会话桥(纯逻辑):可见阈值必须与判档死区同值,桥只做「最近渲染会话」。
 * 复核 F2/F1 的回归钉:0.01–0.04 的偏置仍在参与判档,界面必须显示且可重置;
 * 桥在空值时不覆盖、在切换时覆盖。
 */
import { describe, expect, it } from 'vitest'
import { biasLabel, biasVisible, BIAS_VISIBLE_MIN } from '../src/client/bias-view.ts'
import {
  activeSessionId, bindActiveSessionId, isSubagentSession, shouldBindActiveSession,
} from '../src/client/session-bridge.ts'

describe('bias-view', () => {
  it('可见阈值与判档死区同值(0.01):死区内的偏置仍显示', () => {
    expect(BIAS_VISIBLE_MIN).toBe(0.01)
    expect(biasVisible(0.009)).toBe(false)
    expect(biasVisible(0.01)).toBe(true)
    expect(biasVisible(-0.01)).toBe(true)
    expect(biasVisible(0.04)).toBe(true)
    expect(biasVisible(null)).toBe(false)
    expect(biasVisible(undefined)).toBe(false)
    expect(biasVisible(Number.NaN)).toBe(false)
  })

  it('文案两位小数、带方向;0/不可见值不误标为「已调深」', () => {
    expect(biasLabel(0.2)).toEqual({ text: '已调深 +0.20', direction: 'up' })
    expect(biasLabel(0.04)).toEqual({ text: '已调深 +0.04', direction: 'up' })
    expect(biasLabel(-0.2)).toEqual({ text: '已调浅 0.20', direction: 'down' })
    expect(biasLabel(0)).toEqual({ text: '已调浅 0.00', direction: 'down' })
    expect(biasLabel(Number.NaN)).toEqual({ text: '已调浅 0.00', direction: 'down' })
  })
})

describe('session-bridge', () => {
  it('空值不覆盖;赋值后读到最新;切换覆盖', () => {
    bindActiveSessionId('s-a')
    expect(activeSessionId()).toBe('s-a')
    bindActiveSessionId(undefined)
    bindActiveSessionId('')
    expect(activeSessionId()).toBe('s-a')
    bindActiveSessionId('s-b')
    expect(activeSessionId()).toBe('s-b')
  })

  it('subagent 子会话(参谋)不覆盖主会话 id', () => {
    // 参谋面板在右栏渲染子会话的完整 conversation,同一个 overlay 探针会拿到
    // `<父>--adviser-N`。若照单写入,主会话模型菜单的 selectModel 会被宿主
    // 以 session/agent-busy(owned by subagent routing)拒绝。
    expect(shouldBindActiveSession('p--adviser-2', true)).toBe(false)
    expect(shouldBindActiveSession('p--adviser-2', undefined)).toBe(true)
    expect(shouldBindActiveSession(undefined, false)).toBe(false)
    expect(shouldBindActiveSession('', false)).toBe(false)
  })
})

describe('isSubagentSession:与上游模型选择器同源的门', () => {
  const sessions = { subagentAddress: (id: string) => (id.includes('--adviser-') ? { parentSessionId: 'p' } : undefined) }

  it('子会话地址可解析=true;普通会话=false', () => {
    expect(isSubagentSession(sessions, 'p--adviser-2')).toBe(true)
    expect(isSubagentSession(sessions, 'p')).toBe(false)
  })

  it('服务/方法/id 缺席=false(旧壳保持原行为,不误伤)', () => {
    expect(isSubagentSession(undefined, 'p--adviser-2')).toBe(false)
    expect(isSubagentSession({}, 'p--adviser-2')).toBe(false)
    expect(isSubagentSession(sessions, undefined)).toBe(false)
    expect(isSubagentSession(sessions, '')).toBe(false)
  })

  it('解析抛错=false(渲染路径上的探针不得把主对话拖垮)', () => {
    const broken = { subagentAddress: () => { throw new Error('closed') } }
    expect(isSubagentSession(broken, 'p--adviser-2')).toBe(false)
  })
})
