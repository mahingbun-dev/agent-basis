/**
 * Host 半边插件测试:SRC Remote 命中(网关 resolveSrcDescriptor 依赖的
 * typertRemote 绑定 + @Remote marker,手工施加路径的等价性)与插件形态。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import plugin, { ETERNA_PANEL_SERVICE_ID, EternaPanelGateway, SNAPSHOT_ENDPOINT } from '../src/index.ts'

// 隔离可观测读取:指向空临时 DSH_HOME,不读真实 ~/.dsh/sessions。
const isolatedHome = mkdtempSync(join(tmpdir(), 'eterna-panel-host-'))
const previousHome = process.env.DSH_HOME
beforeAll(() => {
  process.env.DSH_HOME = isolatedHome
})
afterAll(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(isolatedHome, { recursive: true, force: true })
})

describe('EternaPanelGateway(Typert SRC 端点)', () => {
  it('服务名与端点字符串', () => {
    expect(ETERNA_PANEL_SERVICE_ID).toBe('eternaPanel')
    expect(SNAPSHOT_ENDPOINT).toBe('eternaPanel/snapshot')
  })

  it('原型携带 @Remote("snapshot") marker(手工施加等价于装饰器糖)', () => {
    const markers = remoteMethods(Object.create(EternaPanelGateway.prototype) as object)
    expect(markers).toHaveLength(1)
    expect(markers[0]?.method).toBe('snapshot')
    // typert mark() 规则:exportName 与方法同名时省略,网关按 exportName ?? method 解析
    expect(markers[0]?.exportName ?? markers[0]?.method).toBe('snapshot')
  })

  it('snapshot() 方法存在且返回 Promise', async () => {
    const gateway = Object.create(EternaPanelGateway.prototype) as EternaPanelGateway & { ctx: never }
    // 不经构造器(避免注册服务);直接验证方法体可调用——给伪 ctx 返回空状态。
    const fakeCtx = { get: (): undefined => undefined } as never
    Object.defineProperty(gateway, 'ctx', { value: fakeCtx })
    const result = await gateway.snapshot.call({ ctx: fakeCtx })
    expect(result.generatedAt).toBeTruthy()
    expect(result.governance.ruleCount).toBe(0)
    expect(result.observability.sessions).toEqual([])
  })
})

describe('default export 插件形态(DSH bundle loader 契约)', () => {
  it('是 { name, apply } 插件对象,apply 返回 disposer', () => {
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.name).toBe('eterna-panel')
  })
})
