import { describe, expect, it } from 'vitest'
import { SlidingWindow } from '../src/ratelimit.ts'

describe('SlidingWindow 滑动窗限速', () => {
  it('窗口内达到上限后拒绝,窗口滑过后恢复', () => {
    let now = 1_000_000
    const window = new SlidingWindow(3, 60_000, () => now)
    expect(window.hit('k')).toBe(true)
    expect(window.hit('k')).toBe(true)
    expect(window.hit('k')).toBe(true)
    expect(window.hit('k')).toBe(false)
    now += 60_001
    expect(window.hit('k')).toBe(true)
  })

  it('不同 key 相互独立', () => {
    const now = 1_000_000
    const window = new SlidingWindow(2, 60_000, () => now)
    expect(window.hit('a')).toBe(true)
    expect(window.hit('a')).toBe(true)
    expect(window.hit('b')).toBe(true)
    expect(window.hit('a')).toBe(false)
    expect(window.hit('b')).toBe(true)
  })

  it('部分过期只滑出旧命中', () => {
    let now = 1_000_000
    const window = new SlidingWindow(2, 60_000, () => now)
    expect(window.hit('k')).toBe(true)
    now += 30_000
    expect(window.hit('k')).toBe(true)
    expect(window.hit('k')).toBe(false)
    now += 31_000
    expect(window.hit('k')).toBe(true)
  })
})
