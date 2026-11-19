/**
 * system-prompt 冒烟:唯一 name / 排序 / 插值 / disposer 配逆 / 插件装载。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import { PromptRegistryImpl, interpolateText } from '../src/registry.ts'
import plugin from '../src/index.ts'

describe('PromptRegistryImpl', () => {
  it('order 升序拼接;同 order 按名序', () => {
    const registry = new PromptRegistryImpl()
    registry.section({ name: 'b', order: 1, text: 'B' })
    registry.section({ name: 'a', order: 1, text: 'A' })
    registry.section({ name: 'z', order: 0, text: 'Z' })
    expect(registry.assemble()).toBe('Z\n\nA\n\nB')
  })

  it('同名重复注册抛错;disposer 后可复用', () => {
    const registry = new PromptRegistryImpl()
    const off = registry.section({ name: 'x', order: 0, text: 'X' })
    expect(() => registry.section({ name: 'x', order: 0, text: 'Y' })).toThrow(/已注册/)
    off()
    expect(() => registry.section({ name: 'x', order: 0, text: 'Y' })).not.toThrow()
  })

  it('text provider 每次装配求值;interpolate=false 保真', () => {
    const registry = new PromptRegistryImpl()
    let calls = 0
    registry.section({ name: 'dyn', order: 0, text: () => { calls += 1; return `call-${calls}` } })
    registry.section({ name: 'lit', order: 1, text: '{{secret}}', interpolate: false })
    registry.section({ name: 'var', order: 2, text: 'hello {{who}}' })
    const context = { variables: { who: 'basis', secret: 'nope' } }
    expect(registry.assemble(context)).toBe('call-1\n\n{{secret}}\n\nhello basis')
    expect(registry.assemble(context)).toContain('call-2')
  })

  it('interpolateText:缺失变量保留原样', () => {
    expect(interpolateText('{{a}} {{missing}}', { a: '1' })).toBe('1 {{missing}}')
  })
})

describe('插件装载', () => {
  it('provide ctx.systemPrompt;dispose 后服务撤销', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(plugin)
    await fiber
    const off = (ctx as unknown as { systemPrompt: PromptRegistryImpl }).systemPrompt
    expect(typeof off.assemble).toBe('function')
    await fiber.dispose()
    expect(ctx.reflect.get('systemPrompt', false)).toBeUndefined()
  })
})
