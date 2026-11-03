import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { summarize } from '../src/events.ts'
import { assertFinalState } from '../src/finalState.ts'
import type { FinalStateAssert, SessionEventLike } from '../src/types.ts'

let workspace = ''

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evals-fs-'))
  await fs.writeFile(path.join(workspace, 'plan.md'), '# 方案\n含备用场地清单\n', 'utf8')
})

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('file_assert', () => {
  it('存在 + contains + not_contains 全过', async () => {
    const failures = await assertFinalState(
      [{ file_assert: { path: 'plan.md', contains: '备用场地清单', not_contains: '机密' } }],
      summarize([]),
      workspace,
    )
    expect(failures).toEqual([])
  })

  it('文件缺失 → 失败', async () => {
    const failures = await assertFinalState([{ file_assert: { path: 'nope.md' } }], summarize([]), workspace)
    expect(failures[0]?.category).toBe('final_state')
    expect(failures[0]?.message).toContain('文件不存在')
  })

  it('exists:false 时存在即失败', async () => {
    const failures = await assertFinalState([{ file_assert: { path: 'plan.md', exists: false } }], summarize([]), workspace)
    expect(failures[0]?.message).toContain('不应存在')
  })

  it('contains 未命中 → 失败', async () => {
    const failures = await assertFinalState([{ file_assert: { path: 'plan.md', contains: '不存在的词' } }], summarize([]), workspace)
    expect(failures[0]?.message).toContain('未包含期望文本')
  })
})

describe('script', () => {
  it('exit 0 + stdout_contains 通过', async () => {
    const failures = await assertFinalState(
      [{ script: { command: 'printf "总人数 42"', stdout_contains: '42' } }],
      summarize([]),
      workspace,
    )
    expect(failures).toEqual([])
  })

  it('非零退出码失败', async () => {
    const failures = await assertFinalState([{ script: { command: 'exit 7' } }], summarize([]), workspace)
    expect(failures[0]?.message).toContain('退出码 7')
  })

  it('stdout 不含期望文本失败', async () => {
    const failures = await assertFinalState([{ script: { command: 'echo hello', stdout_contains: 'goodbye' } }], summarize([]), workspace)
    expect(failures[0]?.message).toContain('stdout 未包含')
  })
})

describe('http_assert(mock 重放)', () => {
  const httpEvents: SessionEventLike[] = [
    {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1, step: 1, callId: 'c1', name: 'http_request',
        arguments: JSON.stringify({ method: 'POST', url: 'http://registrations.internal/api/v1/entries?src=agent', body: '{"attendee":"zhangsan"}' }),
      },
    },
  ]

  it('证据命中 + mock 真实往返 + status/body 断言通过', async () => {
    const spec: FinalStateAssert[] = [{
      http_assert: {
        request: { tool: 'http_request', method: 'POST', path: '/api/v1/entries', body_contains: 'zhangsan' },
        respond: { status: 201, body: '{"ok":true}' },
        assert: { status: 201, body_contains: '"ok":true' },
      },
    }]
    const failures = await assertFinalState(spec, summarize(httpEvents), workspace)
    expect(failures).toEqual([])
  })

  it('证据缺失(方法不符)→ 失败并列出已见请求', async () => {
    const spec: FinalStateAssert[] = [{
      http_assert: { request: { tool: 'http_request', method: 'DELETE', path: '/api/v1/entries' } },
    }]
    const failures = await assertFinalState(spec, summarize(httpEvents), workspace)
    expect(failures[0]?.message).toContain('找不到匹配的 http_request 调用')
    expect(failures[0]?.message).toContain('POST http://registrations.internal')
  })

  it('mock 响应 status 不符 → 失败', async () => {
    const spec: FinalStateAssert[] = [{
      http_assert: { request: { path: '/api/v1/entries' }, respond: { status: 200 }, assert: { status: 500 } },
    }]
    const failures = await assertFinalState(spec, summarize(httpEvents), workspace)
    expect(failures[0]?.message).toContain('status 200 != 期望 500')
  })

  it('缺省断言 = respond.status(默认 200)', async () => {
    const spec: FinalStateAssert[] = [{
      http_assert: { request: { path: '/api/v1/entries' }, respond: { body: 'plain ok' } },
    }]
    const failures = await assertFinalState(spec, summarize(httpEvents), workspace)
    expect(failures).toEqual([])
  })

  it('url 查询串在改写到本地 mock 后保留', async () => {
    const spec: FinalStateAssert[] = [{
      http_assert: {
        request: { path: '/api/v1/entries?src=agent' },
        respond: { status: 200, body: 'echo' },
      },
    }]
    const failures = await assertFinalState(spec, summarize(httpEvents), workspace)
    expect(failures).toEqual([])
  })
})
