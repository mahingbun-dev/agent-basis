/**
 * 客户端 bundle 工件测试(对齐 packages/panel/tests/client-bundle.test.ts 配方):
 * - lib/client.js 文本形态:闭包工厂 banner/footer、id 与 Loader 行 name 一致;
 * - vm 冒烟:伪 window/require 装载,断言导出面(apply/inject)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

describe('bundle 工件形态', () => {
  it('闭包工厂形态 + id 对齐', () => {
    expect(bundle.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(bundle).toContain('id: "@basis/llm-doctor"')
    expect(bundle.trimEnd().endsWith('});')).toBe(true)
    expect(bundle).toContain('return module.exports;')
  })
})

describe('vm 冒烟装载', () => {
  it('伪 window/require 装载,导出 apply/inject', async () => {
    const fakeReact = { useState: (init: unknown) => [init, () => undefined], useCallback: (fn: unknown) => fn, useEffect: () => undefined }
    const sandbox = {
      window: {
        __ModuleLoader__: {
          loaded: {} as Record<string, unknown>,
          load: (spec: { id: string; factory: (require: (name: string) => unknown) => unknown }) => {
            sandbox.window.__ModuleLoader__.loaded[spec.id] = spec.factory((name: string) => {
              if (name === 'react' || name === 'react/jsx-runtime') return fakeReact
              if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: () => null }
              throw new Error(`unexpected require: ${name}`)
            })
          },
        },
      },
    }
    vm.createContext(sandbox)
    vm.runInContext(bundle, sandbox)
    const exports = sandbox.window.__ModuleLoader__.loaded['@basis/llm-doctor'] as { apply?: unknown; inject?: string[] }
    expect(exports).toBeTypeOf('object')
    expect(typeof exports.apply).toBe('function')
    expect(Array.isArray(exports.inject)).toBe(true)
  })
})
