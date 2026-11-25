/**
 * 面板格式化纯函数单测(数字不跳动、空值不乱码)。
 */
import { describe, expect, it } from 'vitest'
import { formatClock, formatCost, formatDuration, formatInt, formatPercent } from '../src/format.ts'

describe('formatInt', () => {
  it('千分位与四舍五入', () => {
    expect(formatInt(0)).toBe('0')
    expect(formatInt(1234)).toBe('1,234')
    expect(formatInt(1_234_567)).toBe('1,234,567')
    expect(formatInt(999.6)).toBe('1,000')
  })
})

describe('formatPercent', () => {
  it('固定一位小数', () => {
    expect(formatPercent(50)).toBe('50.0%')
    expect(formatPercent(95.25)).toBe('95.3%')
    expect(formatPercent(0)).toBe('0.0%')
  })
})

describe('formatDuration', () => {
  it('秒与分秒两档', () => {
    expect(formatDuration(0)).toBe('0.0 秒')
    expect(formatDuration(6500)).toBe('6.5 秒')
    expect(formatDuration(59_900)).toBe('59.9 秒')
    expect(formatDuration(60_000)).toBe('1 分 00 秒')
    expect(formatDuration(125_000)).toBe('2 分 05 秒')
  })

  it('非法值显示占位符', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })
})

describe('formatCost', () => {
  it('按量级选小数位', () => {
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatCost(0.0007)).toBe('$0.000700')
    expect(formatCost(0.000001)).toBe('$0.000001')
    expect(formatCost(0)).toBe('$0.000000')
    expect(formatCost(Number.NaN)).toBe('—')
  })
})

describe('formatClock', () => {
  it('本地时间 HH:MM:SS', () => {
    const epoch = new Date(2026, 10, 25, 9, 5, 3).getTime()
    expect(formatClock(epoch)).toBe('09:05:03')
  })
})
