/**
 * 客户端 bundle 工件测试:闭包工厂形态(对齐 dsh 客户端包 lib/client.js)与
 * 模块装载冒烟(vm 内伪 window/require,导出面 apply/inject 可用)。
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
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/panel", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/panel"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react")')
    expect(code).not.toContain('function createElement') // react 未被打进包
  })
})

describe('模块装载冒烟(vm)', () => {
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
    vm.runInNewContext(code, { window: sandboxWindow, require: requireStub })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe('@eterna/panel')
    return registrations[0]!.factory(requireStub)
  }

  it('factory 暴露 apply 函数与 inject 服务表', () => {
    const exports = loadBundle()
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'layout', 'connection'])
  })
})
