/**
 * 思考强度启发式评分器:信号表逐条 + 取档映射(不同档位集)。
 * 信号语义见 src/thinking-score.ts 头注;阈值改动会直接反映在这些断言上——
 * 调参即改测试,保持「文档=代码=测试」三者同源。
 */
import { describe, expect, it } from 'vitest'
import { decayBias, pickEffort, scoreMessage } from '../src/thinking-score.ts'

describe('scoreMessage 信号表', () => {
  it('空输入=0;钳位在 [0,1]', () => {
    expect(scoreMessage({ text: '', hasAttachment: false })).toBe(0)
    const hugeDeep = scoreMessage({ text: `分析架构 设计 方案 排查 根因 优化 性能 ${'长'.repeat(3000)}`.repeat(20), hasAttachment: true })
    expect(hugeDeep).toBeLessThanOrEqual(1)
    expect(hugeDeep).toBeGreaterThan(0.5)
  })

  it('显式指令一锤定音:深入思考=0.85,简短回答=0.1', () => {
    expect(scoreMessage({ text: '请深入思考这个问题', hasAttachment: false })).toBe(0.85)
    expect(scoreMessage({ text: 'Think step by step and explain.', hasAttachment: false })).toBe(0.85)
    expect(scoreMessage({ text: '简短回答：1+1=?', hasAttachment: false })).toBe(0.1)
    expect(scoreMessage({ text: 'answer briefly please', hasAttachment: false })).toBe(0.1)
  })

  it('寒暄钳制:仅整句口头语(≤32 字符)落到 0.15;长句中的口头语不钳', () => {
    expect(scoreMessage({ text: '你好', hasAttachment: false })).toBe(0.15)
    expect(scoreMessage({ text: '收到', hasAttachment: false })).toBe(0.15)
    expect(scoreMessage({ text: 'OK!', hasAttachment: false })).toBe(0.15)
    // 超长:口头语只是开头,按正文走基线-长度信号
    expect(scoreMessage({ text: `好的。${'请帮我分析这个架构方案并排查性能瓶颈。'.repeat(5)}`, hasAttachment: false })).toBeGreaterThan(0.2)
  })

  it('代码块/堆栈 +0.2;多问句 +0.1;编号列表 +0.1(可叠加)', () => {
    const plain = scoreMessage({ text: '帮我看看这段逻辑怎么改', hasAttachment: false })
    const code = scoreMessage({ text: '帮我看看这段逻辑怎么改\n```\nconst a = 1\n```', hasAttachment: false })
    expect(code - plain).toBeCloseTo(0.2)
    const twoQuestions = scoreMessage({ text: '为什么超时?怎么排查?', hasAttachment: false })
    // 两个问号 +0.1;「排查」「为什么」命中深度词(基线 0.2-0.1+0.1+0.15+0.15)
    expect(twoQuestions).toBeCloseTo(0.2 - 0.1 + 0.1 + 0.15 + 0.15)
    const listed = scoreMessage({ text: '帮我对比两个方案：\n1. 方案 A\n2. 方案 B', hasAttachment: false })
    expect(listed).toBeCloseTo(0.2 + 0.15 + 0.15) // 对比/方案 两个深度词(未封顶)
  })

  it('深度词累计封顶 +0.3;长度三档(<40 降、>500 升、>2000 再升);附件 +0.15', () => {
    const manyDeep = scoreMessage({ text: '分析架构设计 方案 排查诊断 评估权衡', hasAttachment: false })
    // 基线 0.2 - 0.1(<40 字符) + 0.3(封顶) = 0.4
    expect(manyDeep).toBeCloseTo(0.4)
    const long = scoreMessage({ text: `${'背景材料。'.repeat(120)}帮我评估下`, hasAttachment: false })
    expect(long).toBeCloseTo(0.2 + 0.1 + 0.15) // >500:0.3+深度词
    const huge = scoreMessage({ text: `${'背景材料。'.repeat(500)}帮我评估下`, hasAttachment: false })
    expect(huge).toBeCloseTo(0.2 + 0.1 + 0.1 + 0.15) // >2000 叠加
    const attachment = scoreMessage({ text: '', hasAttachment: true })
    expect(attachment).toBeCloseTo(0.2 - 0.1 + 0.15)
  })
})

/** V2 信号默认值:全零(只测某一条时逐项覆盖)。 */
const ZERO_SIGNALS = {
  toolFailureStreak: 0,
  sameToolFailureStreak: 0,
  followUpOverlap: 0,
  followUpGapMinutes: Number.POSITIVE_INFINITY,
  windowEvents: 0,
  recentChars: 0,
  bias: 0,
} as const

describe('scoreMessage 会话上下文信号(V2)', () => {
  // 基线文本:'帮我看看这段逻辑怎么改' = 0.2 - 0.1(短句) = 0.1
  const base = { text: '帮我看看这段逻辑怎么改', hasAttachment: false } as const

  it('signals 缺省=V1 逐条不变(回放基线)', () => {
    expect(scoreMessage(base)).toBeCloseTo(0.1)
    expect(scoreMessage({ text: '请深入思考这个问题', hasAttachment: false })).toBe(0.85)
    expect(scoreMessage({ text: '你好', hasAttachment: false })).toBe(0.15)
  })

  it('工具失败 +0.15/次、封顶 +0.3;同工具连续失败再加 +0.15', () => {
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, toolFailureStreak: 1 } })).toBeCloseTo(0.25)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, toolFailureStreak: 2 } })).toBeCloseTo(0.4)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, toolFailureStreak: 5 } })).toBeCloseTo(0.4)
    expect(scoreMessage({
      ...base,
      signals: { ...ZERO_SIGNALS, toolFailureStreak: 2, sameToolFailureStreak: 2 },
    })).toBeCloseTo(0.55)
  })

  it('同题追问:重叠 ≥0.6 且间隔 ≤10 分钟才 +0.15', () => {
    const hit = { ...ZERO_SIGNALS, followUpOverlap: 0.8, followUpGapMinutes: 3 }
    expect(scoreMessage({ ...base, signals: hit })).toBeCloseTo(0.25)
    expect(scoreMessage({ ...base, signals: { ...hit, followUpOverlap: 0.5 } })).toBeCloseTo(0.1)
    expect(scoreMessage({ ...base, signals: { ...hit, followUpGapMinutes: 11 } })).toBeCloseTo(0.1)
  })

  it('上下文规模:事件 ≥200 与文本 ≥20000 各 +0.1', () => {
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, windowEvents: 200 } })).toBeCloseTo(0.2)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, recentChars: 20_000 } })).toBeCloseTo(0.2)
    expect(scoreMessage({
      ...base,
      signals: { ...ZERO_SIGNALS, windowEvents: 200, recentChars: 20_000 },
    })).toBeCloseTo(0.3)
  })

  it('上轮档位弱先验 ±0.05(归一中点 0.5)', () => {
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, previousEffortRank: 1 } })).toBeCloseTo(0.15)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, previousEffortRank: 0 } })).toBeCloseTo(0.05)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, previousEffortRank: 0.5 } })).toBeCloseTo(0.1)
  })

  it('偏置最后叠加并钳位;显式指令优先于偏置', () => {
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, bias: 0.2 } })).toBeCloseTo(0.3)
    expect(scoreMessage({ ...base, signals: { ...ZERO_SIGNALS, bias: -0.5 } })).toBeCloseTo(0)
    // 用户当轮点名简答:历史"想深点"偏置不得翻案
    expect(scoreMessage({ text: '简短回答：1+1=?', hasAttachment: false, signals: { ...ZERO_SIGNALS, bias: 0.5 } })).toBe(0.1)
    expect(scoreMessage({ text: '请深入思考这个问题', hasAttachment: false, signals: { ...ZERO_SIGNALS, bias: -0.5 } })).toBe(0.85)
  })

  it('失败/追问在场时寒暄不再钳到 0.15("继续"是工作指令)', () => {
    expect(scoreMessage({ text: '继续', hasAttachment: false, signals: { ...ZERO_SIGNALS, toolFailureStreak: 1 } }))
      .toBeCloseTo(0.25)
    // 无工作信号时维持 V1 寒暄钳制
    expect(scoreMessage({ text: '继续', hasAttachment: false, signals: ZERO_SIGNALS })).toBe(0.15)
  })
})

describe('decayBias', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z')
  const day = 24 * 60 * 60 * 1000

  it('从未反馈=0;24h 半衰;死区内归零;钳位 ±0.5', () => {
    expect(decayBias(0.4, 0, now)).toBe(0)
    expect(decayBias(0.4, now, now)).toBeCloseTo(0.4)
    expect(decayBias(0.4, now - day, now)).toBeCloseTo(0.2)
    expect(decayBias(0.4, now - 2 * day, now)).toBeCloseTo(0.1)
    expect(decayBias(-0.4, now - day, now)).toBeCloseTo(-0.2)
    expect(decayBias(0.9, now, now)).toBeCloseTo(0.5)
    expect(decayBias(0.015, now - 2 * day, now)).toBe(0)
  })
})

describe('pickEffort 档位映射', () => {
  const three = [{ id: 'low' }, { id: 'medium' }, { id: 'high' }]
  const two = [{ id: 'low' }, { id: 'high' }]
  const five = [{ id: 'minimal' }, { id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }]

  it('round(score*(n-1)) 落在声明档位内,边界齐整', () => {
    expect(pickEffort(0, three)?.id).toBe('low')
    expect(pickEffort(0.5, three)?.id).toBe('medium')
    expect(pickEffort(1, three)?.id).toBe('high')
    expect(pickEffort(0.15, three)?.id).toBe('low')
    expect(pickEffort(0.85, three)?.id).toBe('high')
  })

  it('两档模型(low/high)与五档模型同分不同档——映射随目录自适应', () => {
    expect(pickEffort(0.4, two)?.id).toBe('low')
    expect(pickEffort(0.6, two)?.id).toBe('high')
    expect(pickEffort(0.2, five)?.id).toBe('low')
    expect(pickEffort(0.55, five)?.id).toBe('medium')
    expect(pickEffort(0.95, five)?.id).toBe('xhigh')
  })

  it('空档位表返回 undefined(路由器视为无可选档,跳过改选)', () => {
    const picked = pickEffort<{ id: string }>(0.5, [])
    expect(picked).toBeUndefined()
  })
})
