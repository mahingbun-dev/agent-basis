/**
 * basic/config 单测:resolveConfig 默认与校验、modelPolicies 路由、
 * resolveCompactSpec 阈值公式三分支与 TargetPressureConfigError 抛出条件。
 */
import { describe, expect, it } from 'vitest'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy, TargetPressureConfigError } from '../src/basic/config.ts'
import type { BasicCompactionConfig } from '../src/basic/types.ts'

describe('resolveConfig 默认值', () => {
  it('无配置时给 0.8/0.16/65536/1/1/auto=true 的全套默认', () => {
    const config = resolveConfig()
    expect(config.thresholdRatio).toBe(0.8)
    expect(config.retainRatio).toBe(0.16)
    expect(config.retainTokens).toBeUndefined()
    expect(config.headroomTokens).toBe(65_536)
    expect(config.compactionRetries).toBe(1)
    expect(config.maxOverflowRetries).toBe(1)
    expect(config.auto).toBe(true)
  })

  it('默认 maxTokens 推导自 headroomTokens,摘要路由默认空串', () => {
    const config = resolveConfig()
    expect(config.maxTokens).toBe(65_536)
    expect(config.summarizationProvider).toBe('')
    expect(config.summarizationModel).toBe('')
    expect(config.modelPolicies).toEqual([])
  })
})

describe('resolveConfig 显式覆盖', () => {
  it('显式键逐一生效,retention 以 retainTokens 形式落地', () => {
    const config = resolveConfig({
      thresholdRatio: 0.9,
      retainTokens: 4_000,
      headroomTokens: 8_192,
      maxTokens: 2_048,
      compactionRetries: 3,
      maxOverflowRetries: 2,
      auto: false,
      summarizationProvider: 'prov',
      summarizationModel: 'mod',
    })
    expect(config.thresholdRatio).toBe(0.9)
    expect(config.retainTokens).toBe(4_000)
    expect(config.retainRatio).toBeUndefined()
    expect(config.headroomTokens).toBe(8_192)
    expect(config.maxTokens).toBe(2_048)
    expect(config.compactionRetries).toBe(3)
    expect(config.maxOverflowRetries).toBe(2)
    expect(config.auto).toBe(false)
    expect(config.summarizationProvider).toBe('prov')
    expect(config.summarizationModel).toBe('mod')
  })
})

describe('modelPolicies 精确匹配与回退', () => {
  const config = resolveConfig({
    thresholdRatio: 0.8,
    modelPolicies: [{ provider: 'prov', model: 'fast', thresholdRatio: 0.5, maxTokens: 1_024 }],
  })

  it('provider/model 精确命中的策略字段覆盖默认', () => {
    const policy = resolveTargetPolicy(config, { provider: 'prov', model: 'fast' })
    expect(policy.thresholdRatio).toBe(0.5)
    expect(policy.maxTokens).toBe(1_024)
    expect(policy.target).toEqual({ provider: 'prov', model: 'fast' })
  })

  it('未命中路由回退顶层默认', () => {
    const policy = resolveTargetPolicy(config, { provider: 'prov', model: 'other' })
    expect(policy.thresholdRatio).toBe(0.8)
    expect(policy.maxTokens).toBe(65_536)
  })
})

describe('headroomTokens→maxTokens 推导', () => {
  it('顶层缺 maxTokens 时按 headroomTokens 推导', () => {
    const config = resolveConfig({ headroomTokens: 4_096 })
    expect(config.maxTokens).toBe(4_096)
  })

  it('顶层与策略均缺 maxTokens 时,策略级 headroomTokens 推导策略 maxTokens', () => {
    const config = resolveConfig({
      headroomTokens: 8_192,
      modelPolicies: [{ provider: 'prov', model: 'm', headroomTokens: 1_024 }],
    })
    expect(config.maxTokens).toBe(8_192)
    expect(config.modelPolicies[0]?.maxTokens).toBe(1_024)
  })
})

describe('非法配置拒绝', () => {
  it('非法 ratio(0、>1、非有限)被拒绝', () => {
    expect(() => resolveConfig({ thresholdRatio: 0 })).toThrow(/thresholdRatio/)
    expect(() => resolveConfig({ thresholdRatio: 1.5 })).toThrow(/thresholdRatio/)
    expect(() => resolveConfig({ thresholdRatio: Number.NaN })).toThrow(/thresholdRatio/)
    expect(() => resolveConfig({ retainRatio: -0.1 })).toThrow(/retainRatio/)
  })

  it('负数/非整数容量键被拒绝', () => {
    expect(() => resolveConfig({ headroomTokens: -1 })).toThrow(/headroomTokens/)
    expect(() => resolveConfig({ maxTokens: 0 })).toThrow(/maxTokens/)
    expect(() => resolveConfig({ compactionRetries: 1.5 })).toThrow(/compactionRetries/)
    expect(() => resolveConfig({ maxOverflowRetries: -2 })).toThrow(/maxOverflowRetries/)
  })

  it('未知键、重复策略路由与互斥 retention 被拒绝', () => {
    expect(() => resolveConfig({ bogus: true } as unknown as BasicCompactionConfig)).toThrow(/unknown key/)
    expect(() => resolveConfig({
      modelPolicies: [
        { provider: 'p', model: 'm' },
        { provider: 'p', model: 'm' },
      ],
    })).toThrow(/duplicate model policy/)
    expect(() => resolveConfig({ retainRatio: 0.1, retainTokens: 100 })).toThrow(/mutually exclusive/)
  })

  it('retainRatio ≥ thresholdRatio 在载入期被拒绝', () => {
    expect(() => resolveConfig({ thresholdRatio: 0.5, retainRatio: 0.5 })).toThrow(/retainRatio/)
  })
})

describe('resolveCompactSpec 阈值公式 floor(min(W×r, W−O−B))', () => {
  const policyOf = (thresholdRatio: number, headroomTokens: number) => resolveTargetPolicy(
    resolveConfig({ thresholdRatio, headroomTokens, retainRatio: 0.16 }),
    { provider: 'prov', model: 'm' },
  )

  it('ratio 占优:W×r 低于预留后预算时取 W×r', () => {
    // W=10000, O=1000, B=2000 → pressureBudget=7000;W×0.5=5000 → 5000。
    const spec = resolveCompactSpec(policyOf(0.5, 2_000), 10_000, 1_000)
    expect(spec.thresholdTokens).toBe(5_000)
    expect(spec.retainTokens).toBe(Math.floor((10_000 - 1_000) * 0.16))
  })

  it('预留占优:W−O−B 低于 W×r 时取预留后预算', () => {
    // W×0.95=9500 vs 7000 → 7000。
    const spec = resolveCompactSpec(policyOf(0.95, 2_000), 10_000, 1_000)
    expect(spec.thresholdTokens).toBe(7_000)
  })

  it('相等分支:两约束相等时取同一值', () => {
    // W×0.7=7000 = W−O−B=7000 → 7000。
    const spec = resolveCompactSpec(policyOf(0.7, 2_000), 10_000, 1_000)
    expect(spec.thresholdTokens).toBe(7_000)
  })

  it('显式 retainTokens 绕过 ratio 推导', () => {
    const config = resolveConfig({ retainTokens: 500, headroomTokens: 2_000 })
    const policy = resolveTargetPolicy(config, { provider: 'prov', model: 'm' })
    const spec = resolveCompactSpec(policy, 10_000, 1_000)
    expect(spec.retainTokens).toBe(500)
  })
})

describe('TargetPressureConfigError 抛出条件', () => {
  const policy = resolveTargetPolicy(resolveConfig({ retainRatio: 0.16 }), { provider: 'prov', model: 'm' })

  it('contextWindow 非正整数抛出并携带路由键', () => {
    for (const contextWindow of [0, -5, 1.5]) {
      expect(() => resolveCompactSpec(policy, contextWindow, 1_000))
        .toThrow(TargetPressureConfigError)
    }
    try {
      resolveCompactSpec(policy, 0, 1_000)
      expect.unreachable()
    } catch (error) {
      expect((error as TargetPressureConfigError).targetKey).toBe('prov/m')
      expect((error as Error).message).toContain('contextWindow')
    }
  })

  it('reservedCompletionTokens 为负抛出', () => {
    expect(() => resolveCompactSpec(policy, 10_000, -1)).toThrow(TargetPressureConfigError)
  })

  it('预留吃满消息预算(no message budget)抛出', () => {
    expect(() => resolveCompactSpec(policy, 1_000, 1_000)).toThrow(/no message budget/)
  })

  it('预留加 headroom 吃满压力预算(no pressure budget)抛出', () => {
    // W=10000, O=1000, B=9000 → pressureBudget=10000−1000−9000=0。
    const greedy = resolveTargetPolicy(resolveConfig({ headroomTokens: 9_000, retainRatio: 0.16 }), {
      provider: 'prov',
      model: 'm',
    })
    expect(() => resolveCompactSpec(greedy, 10_000, 1_000)).toThrow(/no pressure budget/)
  })

  it('retainTokens ≥ thresholdTokens 抛出', () => {
    // W=100000, O=1000, B=2000 → threshold=min(100000×0.8, 97000)=80000;
    // retainTokens 85000 ≥ 80000 → 抛出(载入期只查 ratio,容量压线在此兜底)。
    const config = resolveConfig({ retainTokens: 85_000, headroomTokens: 2_000 })
    const roomy = resolveTargetPolicy(config, { provider: 'prov', model: 'm' })
    try {
      resolveCompactSpec(roomy, 100_000, 1_000)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(TargetPressureConfigError)
      expect((error as Error).message).toContain('retainTokens')
      expect((error as Error).message).toContain('85000')
      expect((error as Error).message).toContain('80000')
    }
  })
})
