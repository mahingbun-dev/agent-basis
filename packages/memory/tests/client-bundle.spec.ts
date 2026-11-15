/**
 * 客户端 bundle 工件测试(panel 同款):闭包工厂形态(对齐 dsh 客户端包
 * lib/client.js)与模块装载冒烟(vm 内伪 window/require,导出面 apply/inject
 * 可用)。依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/memory", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/memory"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联(react 不打进包)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react")')
    expect(code).not.toContain('function createElement') // react 未被打进包
  })
})

describe('模块装载冒烟(vm)', () => {
  /** document 最小 stub(apply 的样式注入路径;与真 DOM 只交互 getElementById/createElement/head/querySelector)。 */
  function fakeDocument(): Record<string, unknown> {
    const styleStore: { id?: string; textContent?: string } = {}
    return {
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => styleStore,
      head: { append: () => undefined },
    }
  }

  function loadBundle(): Record<string, unknown> {
    const code = readFileSync(bundlePath, 'utf8')
    const registrations: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }[] = []
    const sandboxWindow: { __ModuleLoader__?: unknown } = {
      __ModuleLoader__: { load: (registration: never) => { registrations.push(registration) } },
    }
    const requireStub = (specifier: string): unknown => {
      if (specifier === 'react' || specifier === 'react/jsx-runtime') {
        return nodeRequire(specifier)
      }
      throw new Error(`unexpected require: ${specifier}`)
    }
    vm.runInNewContext(code, { window: sandboxWindow, document: fakeDocument(), require: requireStub })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe('@eterna/memory')
    return registrations[0]!.factory(requireStub)
  }

  it('factory 暴露 apply 函数与 inject 服务表(五服务:三件套+layout+uiConversation)', () => {
    const exports = loadBundle()
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'connection', 'layout', 'uiConversation'])
  })

  it('三个 slot 贡献与事件累计器注册(apply 装配冒烟:伪 ctx 全挂)', () => {
    const exports = loadBundle()
    const contributes: Record<string, () => unknown> = {}
    const registered: { slot: string; id: string | undefined }[] = []
    const eventDefinitions: string[] = []
    const fakeCtx = {
      slots: {
        // inject 的 contribute 回调由壳在席位声明出现时调用;冒烟测试立即触发以断言注册面。
        inject: (slot: string, contribute: () => unknown) => {
          contributes[slot] = contribute
          return () => undefined
        },
        register: (options: { name: string; id?: string }) => {
          registered.push({ slot: options.name, id: options.id })
          return () => undefined
        },
      },
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key,
      },
      connection: { rpc: { call: async () => ({ ok: false }) } },
      layout: { selectMainPanel: () => undefined },
      uiConversation: {
        events: {
          register: (definition: { kind: string }) => {
            eventDefinitions.push(definition.kind)
            return () => undefined
          },
        },
      },
    }
    const dispose = (exports.apply as (ctx: unknown) => () => void)(fakeCtx)
    expect(typeof dispose).toBe('function')
    // ① settings.section + ③ conversation.input.right + ④ conversation.chat.turnTail(声明等待面)
    expect(Object.keys(contributes).sort()).toEqual([
      'conversation.chat.turnTail', 'conversation.input.right', 'settings.section',
    ])
    // 席位就位 → contribute 触发 register(三贡献 id)
    for (const contribute of Object.values(contributes)) contribute()
    expect(registered.map(entry => entry.id).sort()).toEqual([
      'eterna-memory.domain-chip', 'eterna-memory.settings', 'eterna-memory.sources',
    ])
    // ④ 事件累计器以 kind='memory-sources' 注册(Location data 键一致)
    expect(eventDefinitions).toEqual(['memory-sources'])
  })
})
