/**
 * 客户端 bundle 工件与装载冒烟(P0 面板 + P1 设置分区)。
 *
 * 两层断言:
 * 1. **工件形态**:闭包工厂包装(`window.__ModuleLoader__.load`)、react 基线外部模块
 *    以 require 引用而非内联、id 与本包名一致。
 * 2. **装载冒烟(vm + 伪 ctx)**:跑 apply,锁住三段注册——
 *    ① `sidebarRightTabs.register` 声明页面型 tab(kind eval + 导引卡);
 *    ② `sidebar.right.pane.tab` 键控 body 注册在类型 id 下;
 *    ③ `settings.section` 设置分区(id/order 48/label「评测」)。
 *
 * 依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

/** 样式注入所需的最小 document 桩(createElement/head.appendChild/remove). */
function makeDocumentStub(): unknown {
  interface ElementStub {
    textContent: string
    dataset: Record<string, string>
    setAttribute: () => void
    remove: () => void
  }
  return {
    querySelector: (): null => null,
    createElement: (): ElementStub =>
      ({ textContent: '', dataset: {}, setAttribute: () => {}, remove: () => {} }),
    head: { append: () => {}, appendChild: () => {} },
  }
}

interface Recorded {
  readonly tabTypes: Record<string, unknown>[]
  readonly injections: string[]
  readonly slots: { options: Record<string, unknown>; component: unknown }[]
}

/** 在 vm 里跑 bundle,返回 exports 与注册记录. */
function loadBundle(): { exports: Record<string, unknown>; recorded: Recorded } {
  const code = readFileSync(bundlePath, 'utf8')
  const registrations: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }[] = []
  const sandboxWindow: { __ModuleLoader__?: unknown } = {
    __ModuleLoader__: { load: (registration: never) => { registrations.push(registration) } },
  }
  const requireStub = (specifier: string): unknown => {
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return nodeRequire(specifier)
    throw new Error(`unexpected require: ${specifier}`)
  }
  vm.runInNewContext(code, { window: sandboxWindow, require: requireStub, document: makeDocumentStub() })
  expect(registrations).toHaveLength(1)
  expect(registrations[0]?.id).toBe('@eterna/session-eval')

  const recorded: Recorded = { tabTypes: [], injections: [], slots: [] }
  const ctx = {
    slots: {
      inject: (slot: string, contribute: () => unknown) => {
        void contribute()
        recorded.injections.push(slot)
        return () => {}
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        recorded.slots.push({ options, component })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition: Record<string, unknown>) => {
        recorded.tabTypes.push(definition)
        return () => {}
      },
    },
  }
  const exports = registrations[0]!.factory(requireStub)
  const dispose = (exports.apply as (ctx: unknown) => () => void)(ctx)
  expect(typeof dispose).toBe('function')
  expect(() => { dispose() }).not.toThrow()
  return { exports, recorded }
}

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/session-eval", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/session-eval"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('react 以 require 引用而非内联(jsx automatic)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react/jsx-runtime")')
    expect(code).not.toContain('function createElement')
  })

  it('@eterna/ui 图标与令牌随包打入(无上游图标引用)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('gauge')
    expect(code).not.toContain('dsw-alias-gauge')
  })

  it('require 面只有基线外部模块(零 dsh 客户端包运行时依赖)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    const required = [...code.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1] as string)
    expect([...new Set(required)].sort()).toEqual([
      '@deepseek-ai/cordis',
      'react',
      'react/jsx-runtime',
    ].filter(spec => required.includes(spec)).sort())
  })
})

describe('模块装载冒烟(vm)', () => {
  it('导出面:inject 两项(slots + sidebarRightTabs)', () => {
    const { exports } = loadBundle()
    expect(exports.inject).toEqual(['slots', 'sidebarRightTabs'])
  })

  it('tab 类型:页面型(kind eval)、extension 带、keepMounted、带导引卡', () => {
    const { recorded } = loadBundle()
    expect(recorded.tabTypes).toHaveLength(1)
    const definition = recorded.tabTypes[0] as {
      id: string
      kind: string
      priority?: string
      keepMounted?: boolean
      multiple?: boolean
      patterns?: readonly string[]
      title(address: string): string
      guide?: readonly { id: string; order: number; title(): string; description?(): string }[]
    }
    expect(definition.id).toBe('@eterna/session-eval/panel')
    expect(definition.kind).toBe('eval')
    expect(definition.priority).toBe('extension')
    expect(definition.keepMounted).toBe(true)
    expect(definition.multiple).toBeUndefined()
    expect(definition.patterns).toBeUndefined()
    expect(definition.title('sidebar://eval')).toBe('评测')
    const guide = definition.guide ?? []
    expect(guide).toHaveLength(1)
    expect(guide[0]?.id).toBe('open')
    expect(guide[0]?.order).toBe(41)
    expect(guide[0]?.title()).toBe('评测')
    expect(guide[0]?.description?.()).toContain('确定性评分')
  })

  it('body:sidebar.right.pane.tab 的键控注册挂在类型 id 下', () => {
    const { recorded } = loadBundle()
    expect(recorded.injections).toEqual(['sidebar.right.pane.tab', 'settings.section'])
    const body = recorded.slots.find(slot => slot.options.name === 'sidebar.right.pane.tab')
    expect(body?.options.key).toBe('@eterna/session-eval/panel')
    expect(typeof body?.component).toBe('function')
  })

  it('设置分区:settings.section(id/order 48/label 评测,组件可渲染)', () => {
    const { recorded } = loadBundle()
    const section = recorded.slots.find(slot => slot.options.name === 'settings.section')
    expect(section?.options.id).toBe('@eterna/session-eval/settings')
    expect(section?.options.order).toBe(48)
    expect((section?.options.label as (() => string) | undefined)?.()).toBe('评测')
    expect(typeof section?.component).toBe('function')
  })

  it('重复装载不冲突(两个独立实例各自持有注册记录)', () => {
    expect(() => { loadBundle() }).not.toThrow()
    expect(() => { loadBundle() }).not.toThrow()
  })
})
