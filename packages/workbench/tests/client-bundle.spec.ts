/**
 * 客户端 bundle 工件测试(照 packages/panel/tests/client-bundle.test.ts 先例):
 * 闭包工厂形态(对齐 dsh 客户端包 lib/client.js)与模块装载冒烟(vm 内伪
 * window/require,导出面 apply/inject 可用)。依赖 verify 链先跑 build:client
 * (pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/workbench", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(code).toContain('id: "@eterna/workbench"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联(react 未被打进包)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react")')
    expect(code).not.toContain('function createElement')
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
    expect(registrations[0]!.id).toBe('@eterna/workbench')
    return registrations[0]!.factory(requireStub)
  }

  it('factory 暴露 apply 函数与 inject 服务表 + PANEL_ID 锚点', () => {
    const exports = loadBundle()
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'uiWorkspace'])
    expect(exports.PANEL_ID).toBe('eterna-workbench')
  })

  it('T6/T7 会话侧组件随工件分发(TaskSidebar/TicketTimeline/AttentionBanner 导出面;M4 换挂会话内表面,32 号 §3)', () => {
    const exports = loadBundle()
    expect(typeof exports.TaskSidebar).toBe('function')
    expect(typeof exports.TicketTimeline).toBe('function')
    expect(typeof exports.AttentionBanner).toBe('function')
  })

  it('governance PII 过滤器进 bundle(展示层 redact 路径随客户端工件分发)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('[PII:')
    expect(code).toContain('cn-mobile')
  })

  it('Attention 横幅渲染面随工件分发(T7;payload 由 Host 经 project/attention.ts 构造——A-1 走 card.ts 管线在投影层,客户端 bundle 只渲染快照载荷,card.ts 被 tree-shake 不随工件)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('attn-banner')
    expect(code).toContain('countdown')
    expect(code).toContain('attn-escalate')
  })
})
