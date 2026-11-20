/**
 * 内核冒烟:锁 vendored cordis 的最小能力面(改造后必须仍然成立):
 * - Context 代理 + provide/inject 依赖解析(服务未就绪不装载,就绪即触发)
 * - effect 配逆(disposer LIFO,卸载零残留)
 * - 事件 on/emit/bail/waterfall(经 ctx.events 服务,类型面无需 Events 增强)
 * - 对象插件装卸:apply 返回 disposer,dispose 后逆闭包回卷
 */
import { describe, expect, it } from 'vitest'
import { Context, LoggerLevel } from '../src/index.ts'
import type { Context as Ctx, Plugin } from '../src/index.ts'

type Greeting = { hello(): string }

describe('@core/cordis vendor smoke', () => {
  it('provide/inject:依赖服务就绪后插件才装载', async () => {
    const ctx = new Context() as Ctx & { greeting?: Greeting }
    const states: string[] = []

    const consumer = ctx.inject({ greeting: true }, (inner: Ctx & { greeting?: Greeting }) => {
      states.push(inner.greeting!.hello())
    })

    // 服务未提供:插件等待,不装载
    await Promise.resolve()
    expect(states).toEqual([])

    const dispose = ctx.provide('greeting', { hello: () => 'hi' })
    await consumer
    expect(states).toEqual(['hi'])

    // 撤销提供:依赖方回卷(此处插件无自身 disposer,仅验证不抛)
    dispose()
    await Promise.resolve()
  })

  it('effect 配逆:disposer LIFO 回卷', async () => {
    const ctx = new Context()
    const trail: string[] = []
    const fiber = ctx.plugin({
      name: 'effects',
      apply(inner: Ctx) {
        inner.effect(() => { trail.push('a'); return () => trail.push('a-') })
        inner.effect(() => { trail.push('b'); return () => trail.push('b-') })
      },
    })
    await fiber
    expect(trail).toEqual(['a', 'b'])
    await fiber.dispose()
    expect(trail).toEqual(['a', 'b', 'b-', 'a-'])
  })

  it('事件:on/emit/bail/waterfall', () => {
    const ctx = new Context()
    const seen: number[] = []
    ctx.events.on('basis/num', (n: number) => { seen.push(n) })
    ctx.events.emit('basis/num', 1)
    ctx.events.emit('basis/num', 2)
    expect(seen).toEqual([1, 2])

    const off = ctx.events.on('basis/num', () => 42)
    off()
    expect(ctx.events.bail('basis/num', 3)).toBeUndefined()

    // waterfall:最后一个参数是内层 next(内建行为),监听器依次包裹
    ctx.events.on('basis/pipe', (value: string, next: () => string) => value.toUpperCase() + '!' + next())
    const piped = ctx.events.waterfall('basis/pipe', 'x', () => '')
    expect(piped).toBe('X!')
  })

  it('对象插件:inject 声明 + apply disposer 配逆', async () => {
    const bus: Record<string, ((v: number) => void) | undefined> = {}
    const ctx = new Context() as Ctx & { bus?: typeof bus }
    ctx.provide('bus', bus)
    await Promise.resolve()

    const seen: number[] = []
    const fiber = ctx.plugin({
      name: 'sink',
      inject: { bus: true } as never,
      apply(inner: Ctx): () => void {
        const host = (inner as typeof ctx).bus!
        host.kick = (v: number) => { seen.push(v) }
        return () => { delete host.kick }
      },
    })
    await fiber
    ctx.bus!.kick?.(7)
    expect(seen).toEqual([7])
    await fiber.dispose()
    expect(ctx.bus!.kick).toBeUndefined()
  })

  it('4.1.0 语义:LoggerLevel 数值序 + raw/effectiveConfig 分工', async () => {
    // 4.1.0 显式反转级别数值(4.0.6 为 INFO=1/WARN=2);消费方不得按旧序硬编码
    expect(LoggerLevel.WARN).toBe(1)
    expect(LoggerLevel.INFO).toBe(2)

    const ctx = new Context()
    const fiber = ctx.plugin({ name: 'cfg', apply() {} } as Plugin, { round: 1 })
    await fiber
    expect(fiber.effectiveConfig).toEqual({ round: 1 })

    // 只改 raw 输入:不校验、不重启,运行实例仍读旧 effectiveConfig
    fiber.rawConfig = { round: 2 }
    expect(fiber.rawConfig).toEqual({ round: 2 })
    expect(fiber.effectiveConfig).toEqual({ round: 1 })

    // update():raw 与 effective 在重启完成后同步发布
    await fiber.update({ round: 3 })
    expect(fiber.rawConfig).toEqual({ round: 3 })
    expect(fiber.effectiveConfig).toEqual({ round: 3 })
    await fiber.dispose()
  })
})
