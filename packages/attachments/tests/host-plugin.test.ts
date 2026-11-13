/**
 * Host 半边插件测试:idle 装载载具形态(DSH bundle loader 契约)。
 */
import { describe, expect, it } from 'vitest'
import plugin from '../src/index.ts'

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('是 { name, apply } 插件对象', () => {
    expect(plugin.name).toBe('eterna-attachments')
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply 是 idle 载具:无需真实 ctx 即可装载,返回 disposer', () => {
    const dispose = plugin.apply({} as never)
    expect(typeof dispose).toBe('function')
    expect(() => { dispose() }).not.toThrow()
  })
})
