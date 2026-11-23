/**
 * 历史首屏窗口钳制:预算收敛规则 + 运行时包装语义。
 *
 * 覆盖点(与 history-window.ts 头注结论一一对应):
 * - 缺省收敛到 30 条,显式更小预算原样保留(只降不升);
 * - `turnWindow` 与上限冲突时收敛/丢弃,避免上游 `gateway/bad-request`;
 * - 轮次跳转页(minMessages≥200 且带 beforeSeq)原样放行,不拆成上百次 RPC;
 * - 包装只动三个入口、保 this、`follow` 的 AsyncIterable 原样返回、可完整还原;
 * - 上游形态不符/服务缺席/属性不可写时静默降级,不上抛。
 */
import { describe, expect, it } from 'vitest'
import {
  CLAMPED_SESSION_METHODS, DEFAULT_PAGE_MESSAGES, clampHistoryWindow,
  installHistoryWindowClamp, resolvedPageMessages,
} from '../src/history-window.ts'

describe('resolvedPageMessages', () => {
  it('缺省 30 条', () => {
    expect(resolvedPageMessages(undefined)).toBe(DEFAULT_PAGE_MESSAGES)
    expect(DEFAULT_PAGE_MESSAGES).toBe(30)
  })

  it('空串与非法值(0/负数/小数/非数字)回落缺省', () => {
    for (const raw of ['', '   ', '0', '-5', '1.5', 'abc', 'NaN', 'Infinity']) {
      expect(resolvedPageMessages(raw)).toBe(DEFAULT_PAGE_MESSAGES)
    }
  })

  it('合法正整数覆盖缺省', () => {
    expect(resolvedPageMessages('80')).toBe(80)
    expect(resolvedPageMessages(' 80 ')).toBe(80)
  })
})

describe('clampHistoryWindow', () => {
  it('缺预算字段:收敛到 30 条', () => {
    expect(clampHistoryWindow({})).toEqual({ maxMessages: 30 })
  })

  it('上游首屏形态(500 条 + minTurns 2):上限压到 30,turnWindow 因冲突丢弃', () => {
    const upstream = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }
    expect(clampHistoryWindow(upstream)).toEqual({ maxMessages: 30 })
  })

  it('minMessages 未超新预算时保留 turnWindow(只收敛上限)', () => {
    const request = { maxMessages: 500, turnWindow: { minMessages: 10, minTurns: 3 } }
    expect(clampHistoryWindow(request)).toEqual({
      maxMessages: 30,
      turnWindow: { minMessages: 10, minTurns: 3 },
    })
  })

  it('只降不升:显式更小预算原样保留', () => {
    expect(clampHistoryWindow({ maxMessages: 10 })).toEqual({ maxMessages: 10 })
    expect(clampHistoryWindow({ maxMessages: 10, turnWindow: { minMessages: 4, minTurns: 1 } }))
      .toEqual({ maxMessages: 10, turnWindow: { minMessages: 4, minTurns: 1 } })
  })

  it('游标与其余字段原样透传', () => {
    const request = { beforeSeq: 120, throughSeq: 5000, maxMessages: 500, address: { kind: 'session' } }
    expect(clampHistoryWindow(request)).toMatchObject({
      beforeSeq: 120, throughSeq: 5000, maxMessages: 30, address: { kind: 'session' },
    })
  })

  it('轮次跳转页(minMessages≥200 且带 beforeSeq):原样放行', () => {
    const jump = { beforeSeq: 900, maxMessages: 500, turnWindow: { minMessages: 200, minTurns: 2 } }
    expect(clampHistoryWindow(jump)).toBe(jump)
  })

  it('无 beforeSeq 的高 minMessages 不是跳转页(首屏形态):照常收敛', () => {
    const request = { maxMessages: 500, turnWindow: { minMessages: 200, minTurns: 2 } }
    expect(clampHistoryWindow(request)).toEqual({ maxMessages: 30 })
  })

  it('pageMessages 可配置:按指定预算收敛', () => {
    expect(clampHistoryWindow({ maxMessages: 500 }, 80)).toEqual({ maxMessages: 80 })
    expect(clampHistoryWindow({ maxMessages: 50 }, 80)).toEqual({ maxMessages: 50 })
  })

  it('不改动入参对象', () => {
    const request = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }
    clampHistoryWindow(request)
    expect(request).toEqual({ maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } })
  })

  it('非对象/数组等畸形入参交给调用方原样透传(只测对象分支不抛)', () => {
    expect(() => clampHistoryWindow({ maxMessages: Number.NaN })).not.toThrow()
    expect(clampHistoryWindow({ maxMessages: Number.NaN })).toEqual({ maxMessages: 30 })
  })
})

describe('installHistoryWindowClamp', () => {
  /** 上游形态:三个入口都在实例属性上,依赖调用方 this。 */
  class FakeController {
    readonly calls: { method: string; request: unknown }[] = []
    events(request: unknown): Promise<unknown> {
      this.calls.push({ method: 'events', request })
      return Promise.resolve('events-result')
    }

    page(request: unknown): Promise<unknown> {
      this.calls.push({ method: 'page', request })
      return Promise.resolve('page-result')
    }

    async *follow(request: unknown): AsyncIterable<{ readonly type: string }> {
      this.calls.push({ method: 'follow', request })
      yield { type: 'snapshot' }
    }
  }

  it('包装三个入口并收敛预算', async () => {
    const controller = new FakeController()
    const install = installHistoryWindowClamp(controller)
    expect(install?.clamped).toEqual([...CLAMPED_SESSION_METHODS])

    await controller.events({ maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } })
    await controller.page({ beforeSeq: 10, maxMessages: 500 })
    const frames: unknown[] = []
    for await (const frame of controller.follow({ maxMessages: 500 })) frames.push(frame)

    expect(controller.calls).toEqual([
      { method: 'events', request: { maxMessages: 30 } },
      { method: 'page', request: { beforeSeq: 10, maxMessages: 30 } },
      { method: 'follow', request: { maxMessages: 30 } },
    ])
    expect(frames).toEqual([{ type: 'snapshot' }])
  })

  it('保 this:包装后仍访问到原实例状态', async () => {
    const controller = new FakeController()
    installHistoryWindowClamp(controller)
    await controller.events({})
    expect(controller.calls).toHaveLength(1)
  })

  it('follow 保持 AsyncIterable 语义(不是被拉平为 Promise)', () => {
    const controller = new FakeController()
    installHistoryWindowClamp(controller)
    const result = controller.follow({}) as AsyncIterable<unknown>
    expect(typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]).toBe('function')
    expect(typeof (result as { then?: unknown }).then).toBe('undefined')
  })

  it('还原后回到原行为', async () => {
    const controller = new FakeController()
    const install = installHistoryWindowClamp(controller)
    install?.dispose()
    await controller.events({ maxMessages: 500 })
    expect(controller.calls[0]).toEqual({ method: 'events', request: { maxMessages: 500 } })
  })

  it('还原幂等', () => {
    const controller = new FakeController()
    const install = installHistoryWindowClamp(controller)
    install?.dispose()
    expect(() => install?.dispose()).not.toThrow()
  })

  it('服务缺席:返回 undefined,不抛', () => {
    expect(installHistoryWindowClamp(undefined)).toBeUndefined()
  })

  it('上游形态不符(三入口全缺):返回 undefined', () => {
    expect(installHistoryWindowClamp({})).toBeUndefined()
    const foreign: Record<string, unknown> = { somethingElse: () => undefined }
    expect(installHistoryWindowClamp(foreign as never)).toBeUndefined()
  })

  it('部分入口缺席:只包装存在的,其余不报错', async () => {
    const seen: unknown[] = []
    const service = { events: (request: unknown) => { seen.push(request); return Promise.resolve('ok') } }
    const install = installHistoryWindowClamp(service)
    expect(install?.clamped).toEqual(['events'])
    await service.events({ maxMessages: 500 })
    expect(seen).toEqual([{ maxMessages: 30 }])
  })

  it('属性不可写(冻结):跳过该入口并返回 undefined', () => {
    const frozen = Object.freeze({ events: () => Promise.resolve('ok') })
    expect(installHistoryWindowClamp(frozen)).toBeUndefined()
  })

  it('畸形请求(非对象)原样透传,不抛', async () => {
    const controller = new FakeController()
    installHistoryWindowClamp(controller)
    await expect(controller.events(undefined)).resolves.toBe('events-result')
    expect(controller.calls[0]).toEqual({ method: 'events', request: undefined })
  })
})
