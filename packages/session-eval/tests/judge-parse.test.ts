/**
 * 裁判输出严格校验:只在完全符合契约时给分;任何含糊(多余字段/枚举越界)都抛错,
 * 由编排层落 error 状态而不是猜。
 */
import { describe, expect, it } from 'vitest'
import { JudgeOutputError, parseJudgeOutput, verdictToScore } from '../src/judge-parse.ts'

describe('parseJudgeOutput', () => {
  it('合法三态各自解析', () => {
    expect(parseJudgeOutput('{"verdict":"pass","rationale":"满足要求"}')).toEqual({ verdict: 'pass', rationale: '满足要求' })
    expect(parseJudgeOutput('{"verdict":"fail","rationale":"缺少迁移脚本"}').verdict).toBe('fail')
    expect(parseJudgeOutput('{"verdict":"na","rationale":"轨迹不足"}').verdict).toBe('na')
  })

  it('允许一层代码块围栏(只剥围栏,不修内容)', () => {
    expect(parseJudgeOutput('```json\n{"verdict":"pass","rationale":"ok"}\n```').verdict).toBe('pass')
    expect(parseJudgeOutput('```\n{"verdict":"fail","rationale":"no"}\n```').verdict).toBe('fail')
  })

  it('多余字段一律拒绝(不吞模型的自创字段)', () => {
    expect(() => parseJudgeOutput('{"verdict":"pass","rationale":"ok","score":1}')).toThrow(JudgeOutputError)
  })

  it('缺字段/空理由/枚举越界/非 JSON/空输出都抛错', () => {
    expect(() => parseJudgeOutput('{"verdict":"pass"}')).toThrow(JudgeOutputError)
    expect(() => parseJudgeOutput('{"verdict":"pass","rationale":"   "}')).toThrow(JudgeOutputError)
    expect(() => parseJudgeOutput('{"verdict":"yes","rationale":"ok"}')).toThrow(JudgeOutputError)
    expect(() => parseJudgeOutput('pass')).toThrow(JudgeOutputError)
    expect(() => parseJudgeOutput('   ')).toThrow(JudgeOutputError)
    expect(() => parseJudgeOutput('[{"verdict":"pass"}]')).toThrow(JudgeOutputError)
  })

  it('理由超过 200 字拒绝', () => {
    expect(() => parseJudgeOutput(JSON.stringify({ verdict: 'pass', rationale: '字'.repeat(201) }))).toThrow(JudgeOutputError)
    expect(parseJudgeOutput(JSON.stringify({ verdict: 'pass', rationale: '字'.repeat(200) })).rationale).toHaveLength(200)
  })
})

describe('verdictToScore', () => {
  it('pass/fail → ok + 布尔值;na → not_applicable + null(不进分母)', () => {
    expect(verdictToScore('pass')).toEqual({ status: 'ok', value: true })
    expect(verdictToScore('fail')).toEqual({ status: 'ok', value: false })
    expect(verdictToScore('na')).toEqual({ status: 'not_applicable', value: null })
  })
})
