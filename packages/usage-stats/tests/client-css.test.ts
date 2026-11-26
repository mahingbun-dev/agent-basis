/**
 * 客户端 CSS 选择器卫生(2026-11-26 生产实测回归)。
 *
 * 事故:`[data-eterna-usage-stats] /* … *\/` 这样把注释接在裸选择器片段后,再换行写
 * `[data-eterna-usage-stats] .us-value {…}`,CSS 解析器会把注释两侧拼成一个自嵌套
 * 后代选择器 `A A .us-value` —— 永不匹配,大数字一直静默退回继承字号(15px),
 * 页面其余卡片样式正常,所以肉眼难辨。
 *
 * 本测试读构建产物(verify 链先跑 build:client),钉两件事:
 * 1. 不存在自嵌套的根选择器(悬空片段的指纹);
 * 2. `.us-value` 规则真实存在且取 h1 档字号(修好之后的行为)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')

describe('用量统计客户端 CSS 选择器卫生', () => {
  it('无自嵌套根选择器(注释前的悬空片段曾把 .us-value 规则拼成永不匹配)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).not.toMatch(/\[data-eterna-usage-stats\]\s*\[data-eterna-usage-stats\]/u)
  })

  it('大数字走 h1 档:`.us-value` 规则存在且引用 --et-text-h1', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('.us-value')
    expect(code).toMatch(/\[data-eterna-usage-stats\]\s*\.us-value\s*\{[^}]*--et-text-h1/u)
  })
})
