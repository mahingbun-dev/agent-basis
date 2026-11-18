/**
 * 偏置显示口径与会话桥(纯逻辑):可见阈值必须与判档死区同值,桥只做「最近渲染会话」。
 * 复核 F2/F1 的回归钉:0.01–0.04 的偏置仍在参与判档,界面必须显示且可重置;
 * 桥在空值时不覆盖、在切换时覆盖。
 */
import { describe, expect, it } from 'vitest'
import { biasLabel, biasVisible, BIAS_VISIBLE_MIN } from '../src/client/bias-view.ts'
import { activeSessionId, bindActiveSessionId } from '../src/client/session-bridge.ts'

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
})
