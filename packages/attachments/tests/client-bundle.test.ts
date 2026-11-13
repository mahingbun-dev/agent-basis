/**
 * 客户端 bundle 工件测试:闭包工厂形态(对齐 dsh 客户端包 lib/client.js)与
 * 模块装载冒烟(vm 内伪 window/require,导出面 apply/inject 可用、slot 注册
 * 走官方席位 conversation.input.left)。
 * 依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/attachments", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/attachments"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react")')
    expect(code).not.toContain('function createElement') // react 未被打进包
  })

  it('回形针图标数据随 @eterna/ui 打进 bundle(无上游图标引用)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('paperclip')
    expect(code).not.toContain('dsw-alias-paperclip')
  })
})

describe('模块装载冒烟(vm)', () => {
  function loadBundle(): Record<string, unknown> {
    const code = readFileSync(bundlePath, 'utf8')
    const registrations: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }[] = []
    const sandboxWindow: { __ModuleLoader__?: unknown } = {
      __ModuleLoader__: { load: (registration: never) => { registrations.push(registration) } },
    }
    // 伪 document:apply 内的样式注入(injectDesignTokens/injectAttachStyles)
    // 只需要 querySelector(首次装载恒 null)/createElement/head.append 三个面。
    const documentStub = {
      querySelector: (): null => null,
      createElement: (): { id?: string; textContent: string; setAttribute: () => void; remove: () => void } =>
        ({ textContent: '', setAttribute: () => {}, remove: () => {} }),
      head: { append: (el: { id?: string }) => { void el } },
    }
    const requireStub = (specifier: string): unknown => {
      if (specifier === 'react' || specifier === 'react/jsx-runtime') {
        return nodeRequire(specifier)
      }
      throw new Error(`unexpected require: ${specifier}`)
    }
    vm.runInNewContext(code, { window: sandboxWindow, require: requireStub, document: documentStub })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe('@eterna/attachments')
    return registrations[0]!.factory(requireStub)
  }

  it('导出面:inject 声明 + apply 可装载撤销', () => {
    const exports = loadBundle()
    expect(exports.inject).toEqual(['slots', 'locale', 'conversation'])
    expect(typeof exports.apply).toBe('function')

    // 伪服务面:locale 字典注册 + slots 注入/注册面捕获。
    const dictionaries: Record<string, unknown> = {}
    const injections: { slot: string; register: unknown }[] = []
    const registrations: { options: { name: string; id: string }; component: unknown }[] = []
    const ctx = {
      locale: {
        register: (ns: string, dicts: Record<string, unknown>) => { dictionaries[ns] = dicts; return () => {} },
        bind: (ns: string) => (key: string) => `${ns}:${key}`,
      },
      slots: {
        inject: (slot: string, contribute: () => unknown) => {
          const register = contribute()
          injections.push({ slot, register })
          return () => {}
        },
        register: (options: { name: string; id: string }, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      conversation: { createDrafts: () => [] },
    }
    const apply = exports.apply as (ctx: unknown) => () => void
    const dispose = apply(ctx)
    expect(typeof dispose).toBe('function')
    expect(dictionaries.eternaAttachments).toBeDefined()
    expect(injections.map(i => i.slot)).toEqual(['conversation.input.left'])
    // 注册面:官方席位 + list 槽必备 id + 组件为 AttachButton。
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.options.name).toBe('conversation.input.left')
    expect(registrations[0]?.options.id).toBe('eterna-attachments-trigger')
    expect(typeof registrations[0]?.component).toBe('function')
  })
})
