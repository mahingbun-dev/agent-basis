/**
 * 裁判调用编排:三态映射、严格校验失败的 error 收敛、端口异常不外抛、用量透传。
 */
import { describe, expect, it } from 'vitest'
import { runJudge, type JudgeCallResponse, type JudgeLlmPort } from '../src/judge-call.ts'
import { findJudgeMetric } from '../src/judge-metrics.ts'
import { projectJudgeInput } from '../src/judge-input.ts'
import type { SessionEventLike } from '../src/types.ts'

const EVENTS: readonly SessionEventLike[] = [
  { type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '任务' }], source: { kind: 'user' } } },
  { type: 'turn/start', time: 2, data: { turn: 1 } },
  { type: 'assistant/message', time: 3, data: { turn: 1, message: { content: [{ type: 'text', text: '完成' }] } } },
  { type: 'turn/end', time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
]
const INPUT = projectJudgeInput(EVENTS)
const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }
const METRIC = findJudgeMetric('judge.task_completion')!

function llmOf(text: string | Error, extra: Partial<JudgeCallResponse> = {}): JudgeLlmPort {
  return {
    call: async () => {
      if (text instanceof Error) throw text
      return { text, ...extra }
    },
  }
}

describe('runJudge', () => {
  it('pass → ok/true,理由与用量/耗时透传', async () => {
    const result = await runJudge(METRIC, INPUT, ROUTE, llmOf(
      '{"verdict":"pass","rationale":"完成了任务"}', { tokens: 321, latencyMs: 900 },
    ))
    expect(result).toMatchObject({ status: 'ok', value: true, rationale: '完成了任务', tokens: 321, latencyMs: 900 })
  })

  it('fail → ok/false;na → not_applicable/null(不进分母)', async () => {
    expect(await runJudge(METRIC, INPUT, ROUTE, llmOf('{"verdict":"fail","rationale":"没做完"}'))).toMatchObject({ status: 'ok', value: false })
    expect(await runJudge(METRIC, INPUT, ROUTE, llmOf('{"verdict":"na","rationale":"看不清"}'))).toMatchObject({ status: 'not_applicable', value: null })
  })

  it('输出不合契约 → error(不猜分数、不重试)', async () => {
    const result = await runJudge(METRIC, INPUT, ROUTE, llmOf('{"verdict":"pass","rationale":"ok","score":9}'))
    expect(result.status).toBe('error')
    expect(result.value).toBeNull()
    expect(result.rationale).toContain('裁判输出不合契约')
  })

  it('端口抛错 → error,理由为错误摘要且限长(不泄漏调用栈)', async () => {
    const result = await runJudge(METRIC, INPUT, ROUTE, llmOf(new Error('rate limited\n  at stack line')))
    expect(result.status).toBe('error')
    expect(result.rationale).toBe('rate limited at stack line')
    expect(result.rationale.length).toBeLessThanOrEqual(200)
  })

  it('提示词含任务与轮次(裁判真的拿到了输入)', async () => {
    let seen: { system: string; user: string } | undefined
    const llm: JudgeLlmPort = {
      call: async (input) => {
        seen = { system: input.system, user: input.user }
        return { text: '{"verdict":"pass","rationale":"ok"}' }
      },
    }
    await runJudge(METRIC, INPUT, ROUTE, llm)
    expect(seen?.system).toContain('# 会话裁判：任务完成度')
    expect(seen?.user).toContain('任务')
    expect(seen?.user).toContain('### 第 1 轮')
  })
})
