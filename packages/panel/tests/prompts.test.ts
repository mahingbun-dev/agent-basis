/**
 * 操作指南数据测试:任务口径覆盖面(memory 写/搜/忘、knowledge 检索/提案、
 * 预算计算、付款审批红线)+ 字段完整性。
 */
import { describe, expect, it } from 'vitest'
import { GUIDE_PROMPTS } from '../src/prompts.ts'

describe('GUIDE_PROMPTS 覆盖面', () => {
  it('七条能力示例齐备且 id 唯一', () => {
    const ids = GUIDE_PROMPTS.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const required of ['memory-write', 'memory-search', 'memory-forget', 'knowledge-search', 'knowledge-propose', 'budget-calc', 'pay-deposit-redline']) {
      expect(ids).toContain(required)
    }
  })

  it('每条 prompt 非空且含触发词(工具名/动词)', () => {
    for (const entry of GUIDE_PROMPTS) {
      expect(entry.prompt.length).toBeGreaterThan(10)
      expect(entry.title.length).toBeGreaterThan(0)
      expect(['memory', 'knowledge', 'event']).toContain(entry.capability)
    }
    expect(GUIDE_PROMPTS.find(entry => entry.id === 'memory-search')?.prompt).toContain('memory_search')
    expect(GUIDE_PROMPTS.find(entry => entry.id === 'pay-deposit-redline')?.prompt).toContain('pay_deposit')
    expect(GUIDE_PROMPTS.find(entry => entry.id === 'pay-deposit-redline')?.note).toContain('R3')
  })

  it('示例工具名与 @event 工具清单一致(不出现未注册工具)', () => {
    const registered = new Set(['budget_calc', 'schedule_conflict_check', 'template_search', 'venue_search', 'budget_change', 'pay_deposit', 'send_email', 'transfer_money', 'sign_contract', 'vendor_award'])
    const mentioned = GUIDE_PROMPTS.flatMap(entry => entry.prompt.match(/[a-z]+_[a-z_]+/g) ?? [])
    for (const token of mentioned) {
      if (token.startsWith('memory_') || token.startsWith('knowledge_')) continue
      expect(registered.has(token)).toBe(true)
    }
  })
})
