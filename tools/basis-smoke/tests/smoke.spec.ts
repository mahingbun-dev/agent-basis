import { afterEach, describe, expect, it } from 'vitest'
import { lookupEffect, provideEffect, resetRegistry, sum } from '../src/index.ts'

afterEach(() => {
  resetRegistry()
})

describe('toolchain smoke', () => {
  it('vitest 真实断言生效', () => {
    expect(sum([1, 2, 3])).toBe(6)
    expect(sum([])).toBe(0)
  })

  it('noUncheckedIndexedAccess 下访问越界得到 undefined 而非崩溃', () => {
    const values: readonly number[] = [1, 2, 3]
    expect(values[5]).toBeUndefined()
  })
})

describe('registry + reversible effect 约定样例', () => {
  it('同 ID 重复 provide 时旧 effect 被配逆(可交换接口)', () => {
    const undone: string[] = []
    provideEffect('demo', { applied: true, undo: () => undone.push('first') })
    provideEffect('demo', { applied: true, undo: () => undone.push('second') })

    expect(undone).toEqual(['first'])
    expect(lookupEffect('demo')?.applied).toBe(true)
  })

  it('resetRegistry 配逆所有 applied 态 effect 并清空', () => {
    const undone: string[] = []
    provideEffect('a', { applied: true, undo: () => undone.push('a') })
    provideEffect('b', { applied: false, undo: () => undone.push('b') })

    resetRegistry()

    expect(undone).toEqual(['a'])
    expect(lookupEffect('a')).toBeUndefined()
  })

  it('lookupEffect 对未知 ID 返回 undefined', () => {
    expect(lookupEffect('missing')).toBeUndefined()
  })
})
