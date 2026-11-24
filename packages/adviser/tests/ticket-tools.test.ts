/**
 * 工单概览工具的契约单测(P4 收尾)。
 *
 * 钉的产品承诺:
 *
 * 1. **只读**:工具面只有 `adviser_tickets` 一个名字,且只读 `snapshot()`
 *    ——不给模型任意 SQL 面(`query(sql)` 即使有 SELECT 白名单也不暴露)。
 * 2. **优雅缺席**:`tasks` 服务不在(base 形态)时**不注册**工具。这比「注册了但
 *    每次调用必失败」好——模型不会反复重试一个坏工具。
 * 3. **按会话钉住**:注册时带 `when` 谓词,同一 preset 的其它会话看不到。
 * 4. **阶段归纳不把卡点报成正常**:blocked/failed/待答/投递失败必须显式标成卡点。
 * 5. **输出是纯 JSON 且字段可控**:不把内部字段泄给模型。
 * 6. **Tier1 不 import Tier2**:源码不得出现 `@eterna/tasks` 的 import。
 * 7. **宿主半边注册**:预设 scope 是 isolate 的,预设内读不到宿主 tasks
 *    (实机定谳)——本模块只被 host.ts 调用。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ADVISER_TICKETS_TOOL_NAME, readTasksSnapshot, registerTicketTool } from '../src/ticket-tools.ts'

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 被测工具的最小形状(与 ticket-tools 注册的定义对应)。 */
interface RegisteredTool {
  name: string
  description?: string
  parameters?: unknown
  execute?: (args: unknown) => Promise<unknown>
}

/** 造一个宿主工具注册面假件。 */
function fakeTools() {
  const registered: RegisteredTool[] = []
  const options: unknown[] = []
  const disposers: string[] = []
  return {
    registered,
    options,
    disposers,
    tools: {
      register: (definition: RegisteredTool, opts?: unknown) => {
        registered.push(definition)
        options.push(opts)
        return () => { disposers.push(definition.name) }
      },
    },
  }
}

/** 造一个带 `snapshot()` 的 tasks 假件(结构面)。 */
function fakeTasks(snapshotValue: unknown) {
  return { snapshot: () => snapshotValue }
}

/** 造一个宿主 ctx(reflect 读 tasks)。 */
function hostCtxWith(tasksValue: unknown) {
  return { reflect: { get: () => tasksValue } } as never
}

/** 一条最小工单假件。 */
function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1', title: '修登录页', createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T01:00:00Z',
    assignments: [{ state: 'running', report: { state: 'waiting', summary: '等确认' } }],
    ...overrides,
  }
}

/** 注册并取出执行函数。 */
function mountAndExecute(snapshotValue: unknown): (args: unknown) => Promise<unknown> {
  const fake = fakeTools()
  registerTicketTool(
    hostCtxWith(fakeTasks(snapshotValue)),
    { tools: fake.tools } as never,
    { id: 'adviser-1' },
  )
  const tool = fake.registered[0]
  if (tool?.execute === undefined) throw new Error('未注册工具(测试前置不满足)')
  return tool.execute
}

describe('优雅缺席', () => {
  it('tasks 服务不在(base 形态)时不注册任何工具', () => {
    const fake = fakeTools()
    const dispose = registerTicketTool(hostCtxWith(undefined), { tools: fake.tools } as never, { id: 'a' })
    expect(fake.registered).toHaveLength(0)
    expect(() => { dispose() }).not.toThrow()
  })

  it('tasks 形状不对(无 snapshot 方法)时不注册', () => {
    const fake = fakeTools()
    registerTicketTool(hostCtxWith({ health: () => ({}) }), { tools: fake.tools } as never, { id: 'a' })
    expect(fake.registered).toHaveLength(0)
  })

  it('agent ctx 无 tools 时返回空 disposer,不抛', () => {
    expect(() => registerTicketTool(hostCtxWith(fakeTasks({ tickets: [] })), {} as never, { id: 'a' })).not.toThrow()
  })
})

describe('注册面', () => {
  it('tasks 在场时注册一个只读工具,名字是 adviser_tickets', () => {
    const fake = fakeTools()
    registerTicketTool(hostCtxWith(fakeTasks({ realm: 'admin', tickets: [] })), { tools: fake.tools } as never, { id: 'a' })
    expect(fake.registered).toHaveLength(1)
    expect(fake.registered[0]?.name).toBe(ADVISER_TICKETS_TOOL_NAME)
  })

  it('带 when 谓词按 agent id 钉住(同一 preset 的其它会话看不到)', () => {
    const fake = fakeTools()
    registerTicketTool(hostCtxWith(fakeTasks({ tickets: [] })), { tools: fake.tools } as never, { id: 'adviser-7' })
    const options = fake.options[0] as { when?: (activation: { agent: { id: string } }) => boolean } | undefined
    expect(options?.when).toBeTypeOf('function')
    expect(options!.when!({ agent: { id: 'adviser-7' } })).toBe(true)
    expect(options!.when!({ agent: { id: 'adviser-8' } })).toBe(false)
  })

  it('disposer 注销已注册的工具', () => {
    const fake = fakeTools()
    const dispose = registerTicketTool(hostCtxWith(fakeTasks({ tickets: [] })), { tools: fake.tools } as never, { id: 'a' })
    dispose()
    expect(fake.disposers).toContain(ADVISER_TICKETS_TOOL_NAME)
  })

  it('工具描述说明「只读概览」,并指向 orchestrator_read 作完整语法', () => {
    const fake = fakeTools()
    registerTicketTool(hostCtxWith(fakeTasks({ tickets: [] })), { tools: fake.tools } as never, { id: 'a' })
    const description = fake.registered[0]?.description ?? ''
    expect(description).toContain('只读')
    expect(description).toContain('orchestrator_read')
  })
})

describe('readTasksSnapshot', () => {
  it('tasks 在场时返回 snapshot 结果', () => {
    expect(readTasksSnapshot(hostCtxWith(fakeTasks({ realm: 'admin', tickets: [] })))).toEqual({ realm: 'admin', tickets: [] })
  })

  it('reflect 抛错时返回 undefined(不炸)', () => {
    const ctx = { reflect: { get: () => { throw new Error('no such service') } } } as never
    expect(readTasksSnapshot(ctx)).toBeUndefined()
  })

  it('reflect 缺席时返回 undefined', () => {
    expect(readTasksSnapshot({} as never)).toBeUndefined()
  })
})

describe('阶段归纳:卡点必须显式标出', () => {
  it('blocked 报告 → 卡点:blocked(不报成工作中)', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ assignments: [{ state: 'running', report: { state: 'blocked', summary: '缺凭据' } }] })],
    })
    const result = await execute({}) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toContain('卡点')
    expect(result.tickets[0]?.stage).toContain('blocked')
  })

  it('failed 报告 → 卡点:failed', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ assignments: [{ state: 'running', report: { state: 'failed', summary: '测试挂' } }] })],
    })
    const result = await execute({}) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toContain('卡点')
  })

  it('attention(待答问题)→ 卡点:等待回答', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ attention: { question: '用哪个库?' }, assignments: [{ state: 'running' }] })],
    })
    const result = await execute({}) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toContain('卡点')
  })

  it('delivery 失败 → 卡点:投递失败', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ delivery: { error: 'worker 不在', at: '2026-11-24T02:00:00Z' }, assignments: [{ state: 'running' }] })],
    })
    const result = await execute({}) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toContain('卡点')
  })

  it('ready 报告 → 待审阅', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ assignments: [{ state: 'running', report: { state: 'ready', summary: '改完了' } }] })],
    })
    const result = await execute({}) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toBe('待审阅')
  })

  it('已结束工单带 outcome', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({ ended: { at: '2026-11-24T03:00:00Z', outcome: 'done' } })],
    })
    const result = await execute({ include_ended: true }) as { tickets: Array<{ stage: string }> }
    expect(result.tickets[0]?.stage).toContain('已结束')
    expect(result.tickets[0]?.stage).toContain('done')
  })
})

describe('筛选与上限', () => {
  it('默认不含已结束工单', async () => {
    const execute = mountAndExecute({
      tickets: [
        ticket({ id: 'open-1' }),
        ticket({ id: 'ended-1', ended: { at: '2026-11-24T03:00:00Z', outcome: 'done' } }),
      ],
    })
    const result = await execute({}) as { tickets: Array<{ id: string }>; total: number }
    expect(result.tickets.map(row => row.id)).toEqual(['open-1'])
    // total 报全部(含已结束),让参谋知道「还有几条历史」。
    expect(result.total).toBe(2)
  })

  it('include_ended 时含已结束', async () => {
    const execute = mountAndExecute({
      tickets: [
        ticket({ id: 'open-1' }),
        ticket({ id: 'ended-1', ended: { at: '2026-11-24T03:00:00Z', outcome: 'done' } }),
      ],
    })
    const result = await execute({ include_ended: true }) as { tickets: Array<{ id: string }> }
    expect(result.tickets.map(row => row.id).sort()).toEqual(['ended-1', 'open-1'])
  })

  it('limit 生效且被夹在 1..50', async () => {
    const execute = mountAndExecute({
      tickets: Array.from({ length: 60 }, (_, index) => ticket({ id: `t-${index}` })),
    })
    const limited = await execute({ limit: 3 }) as { count: number }
    expect(limited.count).toBe(3)
    const clamped = await execute({ limit: 999 }) as { count: number }
    expect(clamped.count).toBe(50)
    const floor = await execute({ limit: 0 }) as { count: number }
    expect(floor.count).toBe(1)
  })

  it('按 updatedAt 倒序(最近的在前)', async () => {
    const execute = mountAndExecute({
      tickets: [
        ticket({ id: 'old', updatedAt: '2026-11-20T00:00:00Z' }),
        ticket({ id: 'new', updatedAt: '2026-11-24T00:00:00Z' }),
      ],
    })
    const result = await execute({}) as { tickets: Array<{ id: string }> }
    expect(result.tickets.map(row => row.id)).toEqual(['new', 'old'])
  })
})

describe('输出纪律', () => {
  it('不泄露内部字段(decisionId/mandate/channels/origin/inputs)', async () => {
    const execute = mountAndExecute({
      tickets: [ticket({
        decisionId: 'd-secret', mandate: { text: '机密授权' }, channels: [{ kind: 'feishu' }],
        origin: { triggerId: 'trig-secret', triggerIds: ['trig-secret'] }, inputs: [{ id: 'in-1' }],
      })],
    })
    const serialized = JSON.stringify(await execute({}))
    expect(serialized).not.toContain('d-secret')
    expect(serialized).not.toContain('机密授权')
    expect(serialized).not.toContain('trig-secret')
  })

  it('返回纯 JSON(可 JSON.stringify 往返,无 undefined 属性)', async () => {
    const execute = mountAndExecute({ realm: 'admin', tickets: [ticket()] })
    const result = await execute({})
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    for (const row of (result as { tickets: Array<Record<string, unknown>> }).tickets) {
      expect(Object.values(row).every(value => value !== undefined)).toBe(true)
    }
  })

  it('运行期 tasks 消失时回 unavailable 而非抛', async () => {
    const fake = fakeTools()
    let available = true
    const hostCtx = {
      reflect: { get: () => (available ? fakeTasks({ tickets: [ticket()] }) : undefined) },
    } as never
    registerTicketTool(hostCtx, { tools: fake.tools } as never, { id: 'a' })
    const execute = fake.registered[0]!.execute!
    // 注册后 tasks 服务消失(宿主关停 / 卸载)。
    available = false
    const result = await execute({}) as { ok: boolean; count: number; reason?: string }
    expect(result.ok).toBe(false)
    expect(result.count).toBe(0)
    expect(result.reason).toBeTruthy()
  })

  it('报告摘要被截断到 400 字符(不把整篇报告灌进参谋上下文)', async () => {
    const longSummary = 'x'.repeat(2000)
    const execute = mountAndExecute({
      tickets: [ticket({ assignments: [{ state: 'running', report: { state: 'ready', summary: longSummary } }] })],
    })
    const result = await execute({}) as { tickets: Array<{ latest_report?: string }> }
    expect((result.tickets[0]?.latest_report ?? '').length).toBeLessThanOrEqual(401)
  })
})

describe('注册位置纪律(实机定谳:预设 scope 读不到宿主 tasks)', () => {
  it('ticket-tools.ts 不 import @eterna/tasks(Tier1 import 纪律)', () => {
    const source = readFileSync(join(sourceDir, 'ticket-tools.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"]@eterna\/tasks/)
    expect(source).not.toMatch(/import\s*\(\s*['"]@eterna\/tasks/)
  })

  it('preset 里不再挂 adviser-extras 行(工单改由宿主半边注册)', () => {
    const patch = readFileSync(join(sourceDir, '..', 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain('@eterna/adviser/extras')
    expect(patch).toContain('tool-guard')
  })

  it('host.ts 在 startActivation 里调用 registerTicketTool', () => {
    const source = readFileSync(join(sourceDir, 'host.ts'), 'utf8')
    expect(source).toContain('registerTicketTool')
  })
})
