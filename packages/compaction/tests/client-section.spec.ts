/**
 * C9(22 号 §4)client 设置分区扩展单测(纯逻辑面;组件渲染需 react-dom,
 * 由 dsh web 壳运行时提供,本包依赖图不可达——渲染级验收见 deviations):
 * - THRESHOLD_TIERS 三档映射与 resolveThresholdTier 浮点同档判定;
 * - toRetainPercent 与滑杆 8–24% 边界常量;
 * - isPolicyDirty 合并保存脏检查(未选档=阈值无待存变更);
 * - CSS 令牌合规(零字面色值,AGENTS.md §2);
 * - 中文文案键面(新增控件键齐备)。
 */
import { describe, expect, it } from 'vitest'
import {
  CSS,
  LOCALES,
  RETAIN_MAX_PERCENT,
  RETAIN_MIN_PERCENT,
  SECTION_ID,
  STATE_ENDPOINT,
  THRESHOLD_TIERS,
  UPDATE_ENDPOINT,
  isPolicyDirty,
  resolveThresholdTier,
  toRetainPercent,
} from '../src/client/index.tsx'

describe('三档触发阈值映射(22 号 §4-C9)', () => {
  it('三档常量即 0.7/0.8/0.9', () => {
    expect([...THRESHOLD_TIERS]).toEqual([0.7, 0.8, 0.9])
  })

  it('resolveThresholdTier:三档精确命中(含浮点漂移),档外返回 null', () => {
    expect(resolveThresholdTier(0.7)).toBe(0.7)
    expect(resolveThresholdTier(0.8)).toBe(0.8)
    expect(resolveThresholdTier(0.9)).toBe(0.9)
    expect(resolveThresholdTier(0.8 + 1e-12)).toBe(0.8)
    expect(resolveThresholdTier(0.85)).toBeNull()
    expect(resolveThresholdTier(0.799)).toBeNull()
    expect(resolveThresholdTier(1)).toBeNull()
  })
})

describe('retain 滑杆换算(8–24%)', () => {
  it('toRetainPercent:ratio → 整数百分位', () => {
    expect(toRetainPercent(0.16)).toBe(16)
    expect(toRetainPercent(0.08)).toBe(8)
    expect(toRetainPercent(0.24)).toBe(24)
    expect(toRetainPercent(0.157)).toBe(16)
  })

  it('边界常量为 8 与 24(21 号 C3 表规格)', () => {
    expect(RETAIN_MIN_PERCENT).toBe(8)
    expect(RETAIN_MAX_PERCENT).toBe(24)
    expect(RETAIN_MIN_PERCENT).toBeLessThan(RETAIN_MAX_PERCENT)
  })

  it('超范围存量值保留真值(供脏检查与提示,渲染层钳制显示)', () => {
    expect(toRetainPercent(0.3)).toBe(30)
  })
})

describe('合并保存脏检查(AGENTS.md §3)', () => {
  const loaded = { auto: true, thresholdRatio: 0.8, retainRatio: 0.16 }

  it('三键全同 → 不脏', () => {
    expect(isPolicyDirty(loaded, { auto: true, thresholdTier: 0.8, retainPercent: 16 })).toBe(false)
  })

  it('auto/threshold/retain 任一变化 → 脏', () => {
    expect(isPolicyDirty(loaded, { auto: false, thresholdTier: 0.8, retainPercent: 16 })).toBe(true)
    expect(isPolicyDirty(loaded, { auto: true, thresholdTier: 0.9, retainPercent: 16 })).toBe(true)
    expect(isPolicyDirty(loaded, { auto: true, thresholdTier: 0.8, retainPercent: 20 })).toBe(true)
  })

  it('未选档 = 阈值无待存变更(存量非档位值不被误判为脏)', () => {
    const custom = { auto: true, thresholdRatio: 0.85, retainRatio: 0.16 }
    expect(isPolicyDirty(custom, { auto: true, thresholdTier: null, retainPercent: 16 })).toBe(false)
    // 一旦选定档位即视为待存变更。
    expect(isPolicyDirty(custom, { auto: true, thresholdTier: 0.7, retainPercent: 16 })).toBe(true)
  })

  it('retain 百分位按四舍五入比对(0.157 存量 vs 16 表单不脏)', () => {
    const drifted = { auto: true, thresholdRatio: 0.8, retainRatio: 0.157 }
    expect(isPolicyDirty(drifted, { auto: true, thresholdTier: 0.8, retainPercent: 16 })).toBe(false)
  })
})

describe('端点与 CSS 令牌合规', () => {
  it('端点常量不变(读写契约)', () => {
    expect(SECTION_ID).toBe('eterna-compaction.settings')
    expect(STATE_ENDPOINT).toBe('eternaCompaction/state')
    expect(UPDATE_ENDPOINT).toBe('eternaCompaction/updateConfig')
  })

  it('CSS 零字面色值:无 #hex、无 rgb()/hsl() 字面量(AGENTS.md §2)', () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    // 全部颜色消费走 --et-* 语义令牌。
    expect(CSS).toContain('var(--et-')
  })
})

describe('中文文案键面', () => {
  const zh: Record<string, string> = LOCALES.zh

  it('新增控件键齐备且为中文', () => {
    for (const key of [
      'tier70', 'tier80', 'tier90',
      'pickTier', 'fieldSummaryModel', 'summaryModelFollow', 'observeLine', 'retainCustom',
    ]) {
      expect(zh[key], `zh.${key} 缺失`).toBeTruthy()
      expect(zh[key], `zh.${key} 应为中文`).toMatch(/\p{Script=Han}/u)
    }
  })

  it('observeLine 占位符与 fill 变量对齐', () => {
    for (const key of ['invalid', 'stale', 'staleSaved', 'refill']) {
      expect(zh.observeLine).toContain(`{${key}}`)
    }
  })
})
