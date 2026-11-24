/**
 * Host 半边插件测试:默认导出的装载载具形态(DSH bundle loader 契约),
 * 以及服务面(AdviserService)不自行注册路由的结构约束(铁律 T2)。
 */
import { describe, expect, it } from 'vitest'
import plugin from '../src/index.ts'

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('是 { name, apply } 插件对象', () => {
    expect(plugin.name).toBe('eterna-adviser')
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply 返回 disposer 且不注册任何 Web/connection 路由(铁律 T2)', () => {
    const registered: string[] = []
    const ctx = {
      webServer: { register: () => { registered.push('webServer'); return () => {} } },
      connection: { register: () => { registered.push('connection'); return () => {} } },
      web: { register: () => { registered.push('web'); return () => {} } },
    }
    const dispose = plugin.apply(ctx as never)
    expect(typeof dispose).toBe('function')
    expect(registered).toEqual([])
    expect(() => { dispose() }).not.toThrow()
  })
})

describe('服务面导出面', () => {
  it('导出 AdviserService 与关键常量', async () => {
    const mod = await import('../src/service.ts')
    expect(typeof mod.AdviserService).toBe('function')
    expect(mod.ADVISER_LABEL).toBe('adviser')
    expect(mod.ADVISER_PRESET_ID).toBe('eterna-adviser')
    expect(mod.ADVISER_MAX_PER_PARENT).toBe(3)
  })

  it('mintAdviserSessionId 确定性可复算', async () => {
    const { mintAdviserSessionId } = await import('../src/service.ts')
    expect(mintAdviserSessionId('p1', 1)).toBe('p1--adviser-1')
    expect(mintAdviserSessionId('p1', 2)).toBe('p1--adviser-2')
    expect(mintAdviserSessionId('p1', 1)).toBe(mintAdviserSessionId('p1', 1))
  })
})
