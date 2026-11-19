/**
 * 工作台面板挂载测试(38 号 T3/G2-D6:keyed main panel 注册 + sidebar 入口,
 * 照 packages/panel/src/client/index.ts 先例)。M4 实接(T15/G2-D11):客户端
 * 数据面 = 真源 SSE(access 登记的同源端点);mock 流降为测试 fixture,
 * 无 window 覆写开关。stub ctx 断言注入面与撤销面。
 */
import { describe, expect, it } from 'vitest'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'
import { NS, en, zh } from '../src/client/locales.ts'
import { DEFAULT_LIVE_STREAM_PATH, resolveLiveStreamUrl } from '../src/client/live-stream.ts'
import type { SlotComponent, SlotsFace, WorkbenchClientContext } from '../src/client/client-types.ts'

interface Captured {
  slot: string
  options: Record<string, unknown>
  component: SlotComponent
}

function stubContext(): {
  ctx: WorkbenchClientContext
  captures: Captured[]
  localeDisposeCount: () => number
  opened: string[]
} {
  const captures: Captured[] = []
  const opened: string[] = []
  let localeDisposes = 0
  const slots: SlotsFace = {
    inject(slot, contribute) {
      void slot
      const dispose = contribute()
      return () => {
        if (typeof dispose === 'function') dispose()
        else for (const disposeOne of dispose) disposeOne()
      }
    },
    register(options, component) {
      const record: Captured = { slot: options.name, options: options as unknown as Record<string, unknown>, component }
      captures.push(record)
      return () => {
        const index = captures.indexOf(record)
        if (index >= 0) captures.splice(index, 1)
      }
    },
  }
  const ctx: WorkbenchClientContext = {
    slots,
    locale: {
      register: () => { localeDisposes += 1; return () => { localeDisposes -= 1 } },
      bind: () => (key: string) => zh[key as keyof typeof zh] ?? key,
    },
    uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId) } },
  }
  return { ctx, captures, localeDisposeCount: () => localeDisposes, opened }
}

describe('keyed main panel 注册(B1 先例同构)', () => {
  it('inject 服务面 = slots + locale + uiWorkspace(主会话入口导航面)', () => {
    expect(inject).toEqual(['slots', 'locale', 'uiWorkspace'])
  })

  it('apply:main keyed slot(key=eterna-workbench,occupant=WorkbenchPage)+ sidebar.panellist 入口 + 字典注册', () => {
    const { ctx, captures } = stubContext()
    const dispose = apply(ctx)
    try {
      const main = captures.find(captured => captured.options.key === PANEL_ID)
      expect(main).toBeDefined()
      expect(main!.options.name).toBe('main')
      expect(main!.options.locale).toBe(NS)
      expect(main!.component.name).toBe('WorkbenchPage')
      const injected = (main!.options.inject as () => Record<string, unknown>)()
      expect(typeof (injected.hooks as { snapshot: unknown }).snapshot).toBe('object')
      expect(typeof injected.retry).toBe('function')
      expect(typeof injected.t).toBe('function')
      expect(typeof injected.openMaster).toBe('function')

      const sidebar = captures.find(captured => captured.options.id === PANEL_ID)
      expect(sidebar).toBeDefined()
      expect(sidebar!.options.name).toBe('sidebar.panellist')
      expect(sidebar!.options.order).toBe(21)
      expect((sidebar!.options.label as () => string)()).toBe('工作台')
      expect(sidebar!.component.name).toBe('WorkbenchIcon')
      expect(captures).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  it('「主会话」入口:注入面 openMaster 经 uiWorkspace.openSession 导航', () => {
    const { ctx, captures, opened } = stubContext()
    const dispose = apply(ctx)
    try {
      const main = captures.find(captured => captured.options.key === PANEL_ID)
      const injected = (main!.options.inject as () => Record<string, unknown>)()
      const openMaster = injected.openMaster as (sessionId: string) => void
      openMaster('orchestrator-Mr.Ma')
      expect(opened).toEqual(['orchestrator-Mr.Ma'])
    } finally {
      dispose()
    }
  })

  it('撤销面:disposer 停流并撤销字典注册(slot 贡献随插件 fiber 自撤)', () => {
    const { ctx, localeDisposeCount } = stubContext()
    const dispose = apply(ctx)
    expect(localeDisposeCount()).toBe(1)
    dispose()
    expect(localeDisposeCount()).toBe(0)
  })
})

describe('真源流地址(T15/G2-D11:M4 实接,mock 开关已拆除)', () => {
  it('缺省 = access 登记的同源端点(38 号 O-5/G2-C4);无 window 覆写开关(mock 残留为 0)', () => {
    expect(DEFAULT_LIVE_STREAM_PATH).toBe('/workbench/api/stream')
    expect(resolveLiveStreamUrl()).toBe(DEFAULT_LIVE_STREAM_PATH)
    // fixture 面:mock 流仍可直连(仅测试/开发工具),但不在客户端装载路径
    // (client/index.ts 只 import live-stream;mock-stream.ts 不再导出覆写键)
    expect('__ETERNA_WORKBENCH_MOCK_STREAM__' in globalThis).toBe(false)
  })
})

describe('字典完整性(G-5:中文为主,en 可用)', () => {
  it('zh/en 键面一致且 zh 全中文', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const value of Object.values(zh)) expect(value).toMatch(/\p{Script=Han}/u)
    expect(zh.panel).toBe('工作台')
    expect(zh['state.ready']).toBe('实时连接正常')
  })
})
