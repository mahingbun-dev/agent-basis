/**
 * 候选卡可读化单测(2026-11-19 用户反馈「多了一个触发排队」):
 * 候选 JSON 识别/解析、规则整段匹配与 from 边界;渲染组件抛给宿主,无 DOM。
 */
import { describe, expect, it } from 'vitest'
import { candidateCardRule, parseCandidateCard } from '../src/client/candidate-card.tsx'

const CANDIDATE = JSON.stringify({
  kind: 'candidate',
  trigger_id: '33508c3c53bed5b01102eddf8d184ff2',
  from: 'Mr.Ma',
  at: '2026-11-19T09:36:24.503Z',
  thread: 'webchat:thread-1',
  strength: 'candidate',
  mode: 'auto',
  batch: [{ trigger_id: 't-2', from: 'Mr.Ma' }],
  next_action: 'assess it with orchestrator_eval',
})

describe('parseCandidateCard', () => {
  it('识别候选卡并只提取展示字段', () => {
    expect(parseCandidateCard(CANDIDATE)).toEqual({
      triggerId: '33508c3c53bed5b01102eddf8d184ff2',
      from: 'Mr.Ma',
      at: '2026-11-19T09:36:24.503Z',
      strength: 'candidate',
    })
  })

  it('首尾空白不影响识别', () => {
    expect(parseCandidateCard(`\n  ${CANDIDATE}\n`)).toMatchObject({ from: 'Mr.Ma' })
  })

  it('普通文本/非候选 JSON/损坏 JSON/非对象 JSON 一律回落原文', () => {
    expect(parseCandidateCard('帮我调研本产品所有插件的作用')).toBeUndefined()
    expect(parseCandidateCard('{"kind":"worker_report","ticket_id":"T-1"}')).toBeUndefined()
    expect(parseCandidateCard('{"kind":"candidate"')).toBeUndefined()
    expect(parseCandidateCard('[{"kind":"candidate"}]')).toBeUndefined()
    expect(parseCandidateCard('')).toBeUndefined()
  })

  it('缺可选字段时不伪造', () => {
    expect(parseCandidateCard('{"kind":"candidate","trigger_id":"t-1"}')).toEqual({ triggerId: 't-1' })
  })
})

describe('candidateCardRule', () => {
  it('from=0 时整段命中:节点 id/区间与数据都按规则产物', () => {
    const match = candidateCardRule.match(CANDIDATE, 0, { read: () => undefined })
    expect(match).toMatchObject({ id: 'candidate', start: 0, end: CANDIDATE.length })
    expect(match?.data).toMatchObject({ from: 'Mr.Ma' })
  })

  it('from>0 不重复匹配(宿主会从节点末尾继续)', () => {
    expect(candidateCardRule.match(CANDIDATE, 1, { read: () => undefined })).toBeUndefined()
  })

  it('普通文本不命中,交给其余规则', () => {
    expect(candidateCardRule.match('普通讨论', 0, { read: () => undefined })).toBeUndefined()
  })

  it('规则元数据固定(id=候选节点 key,order 先于引用/空白规则)', () => {
    expect(candidateCardRule.id).toBe('candidate')
    expect(candidateCardRule.order).toBe(5)
  })
})
