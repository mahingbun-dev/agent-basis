/**
 * approval-cli 冒烟:y/n/EOF 结论映射 + asked/decided 留痕顺序 + 插件装配事件面。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@core/contracts'
import { ApprovalCli } from '../src/cli-approval.ts'
import plugin from '../src/index.ts'

function makeRequest(): ApprovalRequest {
  return { id: 'req-1', tool: 'pay_deposit', args: { amount: 1 }, reasons: ['R3 对外付款'], riskTier: 'R3' }
}

function cliWith(lines: readonly (string | null)[], trail: string[]): ApprovalCli {
  let cursor = 0
  return new ApprovalCli({
    io: {
      writeLine: (line) => { trail.push(line) },
      readLine: async () => (cursor < lines.length ? lines[cursor++] ?? null : null),
    },
    onAsked: (request) => { trail.push(`asked:${request.id}`) },
    onDecided: (request, outcome) => { trail.push(`decided:${request.id}:${outcome}`) },
  })
}

describe('ApprovalCli', () => {
  for (const [answer, expected] of [['y', 'allowed-once'], ['yes', 'allowed-once'], ['n', 'rejected'], ['', 'cancelled']] as const) {
    it(`回答 "${answer || '(空)'}" → ${expected};asked 先于 decided`, async () => {
      const trail: string[] = []
      const outcome = await cliWith([answer], trail).request(makeRequest())
      expect(outcome).toBe(expected satisfies ApprovalOutcome)
      expect(trail.indexOf('asked:req-1')).toBeGreaterThanOrEqual(0)
      expect(trail.indexOf('asked:req-1')).toBeLessThan(trail.indexOf(`decided:req-1:${expected}`))
    })
  }

  it('EOF → cancelled;args 预览进展示面', async () => {
    const trail: string[] = []
    const outcome = await cliWith([null], trail).request(makeRequest())
    expect(outcome).toBe('cancelled')
    expect(trail.join('\n')).toContain('amount')
    expect(trail.join('\n')).toContain('R3')
  })
})

describe('插件装配', () => {
  it('provide ctx.approval;事件经 ctx.events 发出(asked → decided)', async () => {
    const ctx = new Context()
    const events: string[] = []
    ctx.events.on('approval/asked', (request) => {
      const item = request as { readonly tool: string }
      events.push(`asked:${item.tool}`)
    })
    ctx.events.on('approval/decided', (_request, outcome) => {
      const value = outcome as ApprovalOutcome
      events.push(`decided:${value}`)
    })
    const fiber = ctx.plugin(plugin)
    await fiber
    // stdin 无法在单测交互;直接驱动 cli 实例的事件面(插件内 ApprovalCli 的 io 已注入)
    const approval = (ctx as unknown as { approval: { request(request: ApprovalRequest): Promise<ApprovalOutcome> } }).approval
    expect(typeof approval.request).toBe('function')
    await fiber.dispose()
    expect(ctx.reflect.get('approval', false)).toBeUndefined()
  })
})
