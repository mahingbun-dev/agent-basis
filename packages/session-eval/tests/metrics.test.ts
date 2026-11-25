/**
 * 规则指标单测:期望值全部手算(56 号 §5.7 P0「指标手算对账」)。
 *
 * 两个样本:
 * - FIXTURE(同 trajectory.test):2 轮 / 4 调用 / 1 拒绝 / 1 异常轮 → 6 项硬规则异常;
 * - 空轨迹:所有比率 must be not_applicable(不伪报 0),结论 unrated。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { describe, expect, it } from 'vitest'
import { evaluateRules, ISSUE_LIMIT, RULE_METRIC_KEYS } from '../src/metrics.ts'
import { projectTrajectory } from '../src/trajectory.ts'
import type { MetricScore } from '../src/types.ts'
import { FIXTURE_EVENTS } from './fixture.ts'

/** 指标键 → 分数(测试读值用). */
function byKey(metrics: readonly MetricScore[]): Map<string, MetricScore> {
  return new Map(metrics.map(metric => [metric.key, metric]))
}

const fixture = (() => {
  const aggregate = aggregateSessionMetrics(FIXTURE_EVENTS)
  const trajectory = projectTrajectory('session-eval-fixture', FIXTURE_EVENTS)
  return evaluateRules({ aggregate, trajectory })
})()

const fixtures = byKey(fixture.metrics)

describe('evaluateRules(手算对账)', () => {
  it('指标键序完整且无重复(面板展示序 = RULE_METRIC_KEYS)', () => {
    expect(fixture.metrics.map(metric => metric.key)).toEqual(RULE_METRIC_KEYS)
    expect(new Set(RULE_METRIC_KEYS).size).toBe(RULE_METRIC_KEYS.length)
  })

  it('轮/步/调用:2 轮 / 2 步 / 4 次调用', () => {
    expect(fixtures.get('process.turns')?.value).toBe(2)
    expect(fixtures.get('process.steps')?.value).toBe(2)
    expect(fixtures.get('process.tool_calls')?.value).toBe(4)
  })

  it('工具成功率 50%(2/4 失败);参数合法率 75%;失败 2 次', () => {
    expect(fixtures.get('process.tool_success_rate')?.value).toBe(50)
    expect(fixtures.get('process.tool_success_rate')?.display).toBe('50.0%')
    expect(fixtures.get('process.arg_valid_rate')?.value).toBe(75)
    expect(fixtures.get('process.tool_failures')?.value).toBe(2)
  })

  it('硬规则异常:未知工具 1 / 重复 1 / 审批拒绝 1 / 异常轮 1 / 参数非法 1', () => {
    expect(fixtures.get('process.unknown_tool_calls')?.value).toBe(1)
    expect(fixtures.get('process.repeat_calls')?.value).toBe(1)
    expect(fixtures.get('process.approval_denied')?.value).toBe(1)
    expect(fixtures.get('process.error_turns')?.value).toBe(1)
    expect(fixtures.get('process.invalid_args')?.value).toBe(1)
    const failing = fixture.metrics.filter(metric => metric.pass === false).map(metric => metric.key)
    expect(failing.sort()).toEqual([
      'process.approval_denied',
      'process.error_turns',
      'process.invalid_args',
      'process.repeat_calls',
      'process.tool_failures',
      'process.unknown_tool_calls',
    ])
  })

  it('轮耗时均值 (8000+5000)/2 = 6.5 秒', () => {
    expect(fixtures.get('process.turn_latency')?.value).toBe(6500)
    expect(fixtures.get('process.turn_latency')?.display).toBe('6.5 秒')
  })

  it('用量:4200 tokens;缓存命中率 75%;成本 $0.0007(手算 270+210+220 微美元)', () => {
    expect(fixtures.get('process.tokens')?.value).toBe(4200)
    expect(fixtures.get('process.cache_hit_rate')?.value).toBe(75)
    expect(fixture.costUsd).not.toBeNull()
    // (1000×0.27 + 3000×0.07 + 200×1.1) / 1e6 = 700e-6 = 0.0007
    expect(fixture.costUsd).toBeCloseTo(0.0007, 9)
    expect(fixtures.get('process.cost_usd')?.display).toBe('$0.000700')
  })

  it('结论:warn,理由逐条 = 6 项异常的名字与值', () => {
    expect(fixture.verdict.level).toBe('warn')
    expect(fixture.verdict.label).toBe('确定性检查：6 项异常（结果类未评）')
    expect(fixture.verdict.reasons).toContain('工具失败: 2 次')
    expect(fixture.verdict.reasons).toContain('审批拒绝: 1 次')
  })

  it('结论永不把过程指标当整体通过:pass 文案明写「结果类未评」', () => {
    const clean = evaluateRules({
      aggregate: aggregateSessionMetrics([{ type: 'turn/start', seq: 1, data: { turn: 1 } }]),
      trajectory: projectTrajectory('s', [{ type: 'turn/start', seq: 1, data: { turn: 1 } }]),
    })
    expect(clean.verdict.level).toBe('pass')
    expect(clean.verdict.label).toContain('结果类未评')
  })

  it('问题定位:7 条,按轮次升序,拒绝归属排在未归属之后', () => {
    expect(fixture.issues).toHaveLength(7)
    expect(fixture.issues.map(issue => issue.kind)).toEqual([
      'tool_error', 'arg_invalid', // turn 1: c2 失败 + 参数非法
      'tool_error', 'tool_unknown', 'repeat', 'turn_error', // turn 2: c3 失败/未知, c4 重复, 轮异常
      'approval_denied', // 无轮次归属 → 最后
    ])
    expect(fixture.issues.map(issue => issue.turn)).toEqual([1, 1, 2, 2, 2, 2, 0])
  })

  it('未评说明常驻三条(结果类/阈值校准/pass^k)', () => {
    expect(fixture.pending).toHaveLength(3)
    expect(fixture.pending[0]).toContain('P1')
    expect(fixture.pending[2]).toContain('pass^k')
  })
})

describe('空轨迹:没数据就说没数据', () => {
  const empty = evaluateRules({
    aggregate: aggregateSessionMetrics([]),
    trajectory: projectTrajectory('s', []),
  })
  const metrics = byKey(empty.metrics)

  it('分母为 0 的比率全部 not_applicable,值不上报', () => {
    for (const key of ['process.tool_success_rate', 'process.arg_valid_rate', 'process.invalid_args', 'process.unknown_tool_calls', 'process.turn_latency']) {
      expect(metrics.get(key)?.status).toBe('not_applicable')
      expect(metrics.get(key)?.value).toBeNull()
      expect(metrics.get(key)?.display).toBe('不适用')
    }
    expect(metrics.get('process.cache_hit_rate')?.status).toBe('not_applicable')
    expect(metrics.get('process.cost_usd')?.status).toBe('not_applicable')
    expect(empty.costUsd).toBeNull()
  })

  it('计数类指标仍是 0(有真实分母),pass 按 0 判通过', () => {
    expect(metrics.get('process.turns')?.value).toBe(0)
    expect(metrics.get('process.tool_failures')?.value).toBe(0)
    expect(metrics.get('process.tool_failures')?.pass).toBe(true)
    expect(metrics.get('process.approval_denied')?.pass).toBe(true)
  })

  it('结论 unrated(空会话不叫通过)', () => {
    expect(empty.verdict.level).toBe('unrated')
    expect(empty.issues).toEqual([])
  })

  it('问题列表上限常量可读(截断由面板负责)', () => {
    expect(ISSUE_LIMIT).toBe(50)
  })
})
