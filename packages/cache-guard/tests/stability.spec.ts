/**
 * 前缀稳定性检查器核心测试(任务验收三条 + 边界):
 * ① 注入时间戳的序列必须告警;② 稳定序列不告警;③ 评分单调(失稳转移增多/断点提前均严格降分);
 * 另钉:随机 ID 归因、混合归因、不可归因改写、段序变动、尾部截断、末段追加不告警、
 * 非末段增长(平移)告警、空/单轮序列、纯追加尾部时间戳不告警。
 *
 * 期望值全部手算自 fixture 字面量(注释给出算式),不复读实现。
 */
import { describe, expect, it } from 'vitest'
import { analyzeStability, classifyVolatility, extractVolatileMatches, joinedText } from '../src/index.ts'
import type { PromptAssembly, PromptSegment, StabilityReport } from '../src/index.ts'

const SYS_HEAD = 'SYS You are an event planner. Current time: '
const MSG1 = 'user: 帮我排一场 30 人的发布会'
const MSG2 = 'assistant: 好的,先定场地'
const MSG3 = 'user: 预算 5 万以内'

function seg(source: string, text: string): PromptSegment {
  return { source, text }
}

function assembly(turn: number, segments: readonly PromptSegment[]): PromptAssembly {
  return { turn, segments }
}

/** append-only 会话的常规形态:sys 段 + 逐轮追加的消息段(source 按消息序号,跨轮稳定)。 */
function growingAssembly(turn: number, sysText: string, messageCount: number): PromptAssembly {
  const messages = [MSG1, MSG2, MSG3].slice(0, messageCount).map((text, idx) => seg(`msg:${idx + 1}`, text))
  return assembly(turn, [seg('system', sysText), ...messages])
}

describe('① 注入时间戳的序列必须告警', () => {
  it('sys 段时间戳逐轮变化:每个转移都产出 volatile-timestamp 告警,评分<1', () => {
    // 4 轮,sys 段时间戳 10:00→11:00→12:00→13:00,消息段 append-only。
    const stamps = ['10:00', '11:00', '12:00', '13:00']
    const assemblies = stamps.map((stamp, i) => growingAssembly(i + 1, SYS_HEAD + stamp, i + 1 === 1 ? 1 : i + 1))
    const report = analyzeStability(assemblies)

    // 3 个转移全部失稳,均为时间戳归因。
    expect(report.warnings).toHaveLength(3)
    for (const warning of report.warnings) {
      expect(warning.kind).toBe('volatile-timestamp')
      expect(warning.source).toBe('system')
    }
    // 转移定位:轮 1→2 / 2→3 / 3→4。
    expect(report.warnings.map(w => [w.fromTurn, w.toTurn])).toEqual([[1, 2], [2, 3], [3, 4]])
    // 命中模式含 time-only;证据为变动前后的时间戳值。
    const first = report.warnings[0]
    expect(first?.patterns).toContain('time-only')
    expect(first?.before).toBe('10:00')
    expect(first?.after).toBe('11:00')
    // 断点 = SYS_HEAD 长度 + 共同字符 '1'(分/时首位);手算:
    expect(first?.commonPrefixLength).toBe(SYS_HEAD.length + 1)
    expect(report.score).toBeLessThan(1)
  })

  it('epoch 毫秒时间戳逐轮变化同样告警(pattern=epoch-millis)', () => {
    const head = 'SYS context injected at '
    const assemblies = [
      assembly(1, [seg('system', head + '1762200000000'), seg('user', MSG1)]),
      assembly(2, [seg('system', head + '1762200060000'), seg('user', MSG1), seg('assistant', MSG2)]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('volatile-timestamp')
    expect(report.warnings[0]?.patterns).toEqual(['epoch-millis'])
  })

  it('纯文本单段 prompt(无段结构)注入 ISO 时间戳同样告警', () => {
    const head = 'SYS fixed prefix. now='
    const a1 = `${head}2026-11-03T10:00:00 Q1`
    const a2 = `${head}2026-11-03T11:00:00 Q1 A1 Q2`
    const report = analyzeStability([assembly(1, [seg('prompt', a1)]), assembly(2, [seg('prompt', a2)])])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('volatile-timestamp')
    expect(report.warnings[0]?.patterns).toEqual(['iso-datetime'])
    // 断点手算:head 长度 + '2026-11-03T1'(分叉在 '0' vs '1',第二位小时)。
    expect(report.warnings[0]?.commonPrefixLength).toBe(head.length + '2026-11-03T1'.length)
  })
})

describe('② 稳定序列不告警', () => {
  it('sys 段固定 + 消息 append-only:零告警,评分=1', () => {
    const assemblies = [
      growingAssembly(1, SYS_HEAD + '10:00', 1),
      growingAssembly(2, SYS_HEAD + '10:00', 2),
      growingAssembly(3, SYS_HEAD + '10:00', 3),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings).toHaveLength(0)
    expect(report.score).toBe(1)
    for (const retention of report.retentions) expect(retention.retention).toBe(1)
  })

  it('会话开头一次性烘焙的固定时间戳不告警(只写一次进前缀)', () => {
    const assemblies = [
      growingAssembly(1, 'SYS frozen at 2026-11-03. ', 1),
      growingAssembly(2, 'SYS frozen at 2026-11-03. ', 2),
    ]
    expect(analyzeStability(assemblies).warnings).toHaveLength(0)
  })

  it('新增尾部内容里带时间戳不告警(未动前缀)', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS stable.'), seg('user', MSG1)]),
      assembly(2, [seg('system', 'SYS stable.'), seg('user', MSG1), seg('user', '现在几点?2026-11-03T15:30:00')]),
    ]
    expect(analyzeStability(assemblies).warnings).toHaveLength(0)
  })

  it('末段尾部追加(生成中的最后一条消息)不告警', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS.'), seg('user', 'Q1 半')]),
      assembly(2, [seg('system', 'SYS.'), seg('user', 'Q1 半成品怎么处理'), seg('assistant', MSG2)]),
    ]
    expect(analyzeStability(assemblies).warnings).toHaveLength(0)
  })

  it('空序列与单轮序列:零转移零告警,评分=1', () => {
    const empty = analyzeStability([])
    expect(empty.assemblies).toBe(0)
    expect(empty.transitions).toBe(0)
    expect(empty.warnings).toHaveLength(0)
    expect(empty.score).toBe(1)
    const single = analyzeStability([growingAssembly(1, SYS_HEAD + '10:00', 1)])
    expect(single.transitions).toBe(0)
    expect(single.warnings).toHaveLength(0)
    expect(single.score).toBe(1)
  })
})

describe('③ 评分单调', () => {
  /** 5 轮序列:前 churnCount 个转移 sys 时间戳变化,其后冻结;msg 段 append-only。 */
  function churnFamily(churnCount: number): StabilityReport {
    const stamps = ['10:00', '11:00', '12:00', '13:00', '14:00']
    return analyzeStability(stamps.map((_, i) => {
      const effective = (i <= churnCount ? stamps[i] : stamps[churnCount]) ?? ''
      return growingAssembly(i + 1, SYS_HEAD + effective, Math.min(i + 1, 3))
    }))
  }

  it('失稳转移增多 → 评分严格单调下降,且稳定=1', () => {
    const s0 = churnFamily(0)
    const s1 = churnFamily(1)
    const s2 = churnFamily(2)
    const s3 = churnFamily(3)
    expect(s0.score).toBe(1)
    expect(s0.score).toBeGreaterThan(s1.score)
    expect(s1.score).toBeGreaterThan(s2.score)
    expect(s2.score).toBeGreaterThan(s3.score)
    expect(s3.warnings).toHaveLength(3)
  })

  it('断点越靠前(丢的前缀越多)→ 评分严格下降', () => {
    function offsetFamily(offset: number): StabilityReport {
      const pad = 'A'.repeat(offset)
      const assemblies = [
        assembly(1, [seg('system', pad + 'time: 10:00'), seg('user', MSG1)]),
        // 仅第 1 个转移失稳(时间戳 10:00→42:00),其后冻结在 42:00。
        assembly(2, [seg('system', pad + 'time: 42:00'), seg('user', MSG1), seg('assistant', MSG2)]),
        assembly(3, [seg('system', pad + 'time: 42:00'), seg('user', MSG1), seg('assistant', MSG2), seg('user', MSG3)]),
      ]
      return analyzeStability(assemblies)
    }
    const early = offsetFamily(0)
    const mid = offsetFamily(30)
    const late = offsetFamily(60)
    expect(early.warnings).toHaveLength(1)
    expect(mid.warnings).toHaveLength(1)
    expect(late.warnings).toHaveLength(1)
    expect(early.score).toBeLessThan(mid.score)
    expect(mid.score).toBeLessThan(late.score)
    expect(late.score).toBeLessThan(1)
  })

  it('全部转移在偏移 0 断开 → 评分=0(下确界)', () => {
    const assemblies = [
      assembly(1, [seg('system', 'AAAA')]),
      assembly(2, [seg('system', 'BBBB')]),
      assembly(3, [seg('system', 'CCCC')]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.score).toBe(0)
    expect(report.warnings).toHaveLength(2)
  })

  it('手算精确评分:score = Σ共同前缀 / Σ上轮长度', () => {
    // 单段序列,3 轮 2 个转移;a_k = head + stamp_k + 尾部追加;共同前缀均为 head.length+1('1')。
    const head = 'SYS. now='
    const a1 = `${head}10:00 Q1`
    const a2 = `${head}11:00 Q1 A1 Q2`
    const a3 = `${head}12:00 Q1 A1 Q2 A2 Q3`
    const report = analyzeStability([a1, a2, a3].map((text, i) => assembly(i + 1, [seg('prompt', text)])))
    const common = head.length + 1
    const expected = (common + common) / (a1.length + a2.length)
    expect(report.score).toBe(expected)
    expect(report.retentions.map(r => r.commonPrefixLength)).toEqual([common, common])
    expect(report.retentions.map(r => r.previousLength)).toEqual([a1.length, a2.length])
  })

  it('空 prompt 轮(长度 0)不计入分母,也不产生告警', () => {
    const report = analyzeStability([
      assembly(1, [seg('system', '')]),
      assembly(2, [seg('system', 'SYS now: 10:00'), seg('user', MSG1)]),
      assembly(3, [seg('system', 'SYS now: 11:00'), seg('user', MSG1), seg('user', MSG3)]),
    ])
    // 转移 1→2:上轮为空,不计;转移 2→3:唯一计入分母的转移,失稳。
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.fromTurn).toBe(2)
    // score = (SYS 到分叉的共同前缀) / (a2 全长)。
    expect(report.score).toBe('SYS now: 1'.length / ('SYS now: 10:00' + '\n' + MSG1).length)
  })
})

describe('随机 ID 与混合归因', () => {
  it('uuid 逐轮变化 → volatile-random-id(pattern=uuid)', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS run=550e8400-e29b-41d4-a716-446655440000'), seg('user', MSG1)]),
      assembly(2, [seg('system', 'SYS run=6f1c2ab0-e29b-41d4-a716-446655440000'), seg('user', MSG1), seg('user', MSG3)]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('volatile-random-id')
    // 跨模式重叠去重:uuid 整跨占位,其内 hex 尾段不再重复计数。
    expect(report.warnings[0]?.patterns).toEqual(['uuid'])
  })

  it('hex token 逐轮变化 → volatile-random-id(pattern=hex-token)', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS sid=3f2a9b8c1d2e4f5a'), seg('user', MSG1)]),
      assembly(2, [seg('system', 'SYS sid=9d8c7b6a5f4e3d2c'), seg('user', MSG1), seg('user', MSG3)]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings[0]?.kind).toBe('volatile-random-id')
    expect(report.warnings[0]?.patterns).toEqual(['hex-token'])
  })

  it('时间戳+随机 ID 同时变 → 归 volatile-timestamp 主类,patterns 双列', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS now=10:00 sid=3f2a9b8c1d2e4f5a'), seg('user', MSG1)]),
      assembly(2, [seg('system', 'SYS now=11:00 sid=9d8c7b6a5f4e3d2c'), seg('user', MSG1), seg('user', MSG3)]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('volatile-timestamp')
    expect(report.warnings[0]?.patterns).toContain('time-only')
    expect(report.warnings[0]?.patterns).toContain('hex-token')
  })

  it('不可归因改写(version 1→2)→ prefix-mutation,零 patterns', () => {
    const assemblies = [
      assembly(1, [seg('system', 'SYS style guide version 1'), seg('user', MSG1)]),
      assembly(2, [seg('system', 'SYS style guide version 2'), seg('user', MSG1), seg('user', MSG3)]),
    ]
    const report = analyzeStability(assemblies)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('prefix-mutation')
    expect(report.warnings[0]?.patterns).toBeUndefined()
  })
})

describe('段序变动与截断', () => {
  const sysSeg = seg('system', 'SYS stable.')
  const u1 = seg('user', MSG1)
  const u2 = seg('user', MSG3)

  it('中段插入新段 → structure-change(insert),共同前缀=已对齐段长', () => {
    const report = analyzeStability([
      assembly(1, [sysSeg, u1]),
      assembly(2, [sysSeg, seg('memory-index', 'NOTES: a, b'), u1, u2]),
    ])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('structure-change')
    // 共同前缀 = 已对齐的 sys 段 + 其后 1 个分隔符(拼接视图下 msg1 前的 '\n')。
    expect(report.warnings[0]?.commonPrefixLength).toBe(sysSeg.text.length + 1)
    expect(report.score).toBeLessThan(1)
  })

  it('相邻两段(不同 source)换序 → structure-change(reorder)', () => {
    const assistantSeg = seg('assistant', MSG2)
    const report = analyzeStability([
      assembly(1, [sysSeg, u1, assistantSeg]),
      assembly(2, [sysSeg, assistantSeg, u1]),
    ])
    expect(report.warnings[0]?.kind).toBe('structure-change')
    expect(report.warnings[0]?.message).toContain('reorder')
  })

  it('尾部截断(compaction 类)→ prefix-mutation,共同前缀=本轮全长', () => {
    const report = analyzeStability([
      assembly(1, [sysSeg, u1, u2]),
      assembly(2, [sysSeg]),
    ])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('prefix-mutation')
    expect(report.warnings[0]?.commonPrefixLength).toBe(sysSeg.text.length)
    expect(report.warnings[0]?.previousLength).toBe(joinedText([sysSeg, u1, u2]).length)
  })

  it('段内截短(上轮段长于本轮段)→ prefix-mutation', () => {
    const report = analyzeStability([
      assembly(1, [seg('system', 'SYS full policy text here'), u1]),
      assembly(2, [seg('system', 'SYS full'), u1, u2]),
    ])
    expect(report.warnings[0]?.kind).toBe('prefix-mutation')
    expect(report.warnings[0]?.commonPrefixLength).toBe('SYS full'.length)
  })

  it('非末段增长(平移后续段)→ 告警且断点在增长点', () => {
    const report = analyzeStability([
      assembly(1, [seg('system', 'SYS v1'), u1]),
      assembly(2, [seg('system', 'SYS v1 extra'), u1, u2]),
    ])
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]?.kind).toBe('prefix-mutation')
    // 断点 = 'SYS v1' 末尾(后续段整体平移)。
    expect(report.warnings[0]?.commonPrefixLength).toBe('SYS v1'.length)
  })
})

describe('易变模式库(volatile.ts 直测)', () => {
  it('extractVolatileMatches 按文本序命中且带模式 id;空格分隔的 ISO 整跨命中', () => {
    // '2026-11-03 10:00' 是合法 ISO 8601(空格分隔),整跨归 iso-datetime。
    const matches = extractVolatileMatches('at 1762200000 then 2026-11-03 10:00 uuid 550e8400-e29b-41d4-a716-446655440000')
    expect(matches.map(m => m.pattern)).toEqual(['epoch-seconds', 'iso-datetime', 'uuid'])
    // 日期与时间中间隔着文字时,date-only / time-only 分别命中。
    const split = extractVolatileMatches('on 2026-11-03 at 10:00')
    expect(split.map(m => m.pattern)).toEqual(['date-only', 'time-only'])
  })

  it('长词不误报 random-id(必须混合字母数字)', () => {
    expect(extractVolatileMatches('internationalization incomprehensibilities')).toHaveLength(0)
  })

  it('classifyVolatility:同值返回 null;纯时间戳差可归因;混合文本改写不可归因', () => {
    expect(classifyVolatility('now=10:00', 'now=10:00')).toBeNull()
    expect(classifyVolatility('now=10:00', 'now=11:00')?.kind).toBe('volatile-timestamp')
    expect(classifyVolatility('now=10:00 v=1', 'now=11:00 v=2')).toBeNull()
  })
})
