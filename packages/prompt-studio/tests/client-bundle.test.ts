/**
 * 客户端 bundle 工件测试(T7.2):闭包工厂形态(对齐 dsh 客户端包 lib/client.js)
 * 与模块装载冒烟(vm 内伪 window/require)。require 只允许基线外部模块
 * (web 壳 PLATFORM_MODULES 种子表子集,scripts/build-client.mjs 的 external 清单);
 * 出现清单外 require 即失败——dsh.client.inject 声明与实际消费漂移的机器证据。
 * 依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')

/** 与 scripts/build-client.mjs 的 BASELINE_EXTERNALS 同源(漂移即测试失败)。 */
const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-api-gateway',
  '@tanstack/react-virtual',
] as const

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/prompt-studio", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/prompt-studio"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('官方语义令牌:样式只经 --dsw-alias-* 变量,无字面色值(硬性规范第 6 条)', () => {
    const code = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'styles.ts'), 'utf8')
    // 拼接进 CSS 模板串的颜色声明必须全部引用 var(--dsw-alias-…)/transparent。
    const colorDecls = [...code.matchAll(/(?:color|background(?:-color)?|border(?:-left)?-color):\s*([^;]+);/gu)]
      .map(match => match[1]?.trim() ?? '')
    expect(colorDecls.length).toBeGreaterThan(10)
    const aliasVar = /^var\(--dsw-alias-[a-z0-9-]+(?:\s*,\s*[^)]+)?\)$/u
    const aliasMix = /^color-mix\(in srgb, var\(--dsw-alias-[a-z0-9-]+\)(?:\s+[\d.]+%)?(\s*,\s*transparent)?\)$/u
    for (const decl of colorDecls) {
      const ok = aliasVar.test(decl) || aliasMix.test(decl) || decl === 'transparent' || decl === 'none'
      expect(ok, `非官方语义令牌的颜色声明: ${decl}`).toBe(true)
    }
  })

  it('T7.3 工件:diff 对比/导出/导入锚点在 bundle 中', () => {
    const code = readFileSync(bundlePath, 'utf8')
    for (const anchor of ['data-t7-diff', 'data-t7-diff-btn', 'data-t7-diff-close', 'data-t7-export-btn', 'data-t7-export-latest', 'data-t7-import-input', 'data-t7-import-btn']) {
      expect(code, `缺少 T7.3 锚点 ${anchor}`).toContain(anchor)
    }
    // 三端点都经客户端调用(导出/导入为 T7.3 新接线;prompt-import 两段式)。
    expect(code).toContain('loopPrompt/prompt-export')
    expect(code).toContain('loopPrompt/prompt-import')
  })

  it('T7.3 不可删:bundle 无任何删除操作入口(版本只增不删的 UI 侧证据)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 无删除端点调用、无删除锚点、无删除处理器命名、无「删除版本」类文案。
    expect(code).not.toMatch(/prompt-delete|prompt-remove/u)
    expect(code).not.toMatch(/data-t7-delete|data-t7-remove/u)
    expect(code).not.toMatch(/deleteVersion|removeVersion|dropVersion|purgeVersion/u)
    expect(code).not.toContain('删除版本')
  })
})

describe('模块装载冒烟(vm)', () => {
  /** 伪 require:基线模块返回桩;清单外 specifier 即失败(消费面漂移的证据)。 */
  function makeRequire(seen: string[]): (specifier: string) => unknown {
    const stubs: Record<string, unknown> = {
      'react': { useState: () => [undefined, () => undefined], useMemo: () => undefined, useCallback: () => undefined },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'fragment' },
      '@deepseek-ai/dsh-client-ui-primitives': {
        IconListPenOutlineRegular: () => null,
        IconWorkspaceTreeOutlineRegular: () => null,
      },
    }
    return (specifier: string) => {
      seen.push(specifier)
      if (!(specifier in stubs)) {
        throw new Error(`bundle require 了基线清单外的模块「${specifier}」——请同步 scripts/build-client.mjs 与 dsh.client.inject`)
      }
      return stubs[specifier]
    }
  }

  function loadBundle(seen: string[]): Record<string, unknown> {
    const code = readFileSync(bundlePath, 'utf8')
    const registrations: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }[] = []
    const sandboxWindow: { __ModuleLoader__?: unknown } = {
      __ModuleLoader__: { load: (registration: never) => { registrations.push(registration) } },
    }
    // styles.ts 的 injectStudioStyles 触到 document(format.ts 顶层用 TextEncoder);
    // vm 新上下文只有 JS 内建,web 全局给最小桩。
    const documentStub = {
      querySelector: () => null,
      head: { append: () => undefined },
      createElement: () => ({ setAttribute: () => undefined, remove: () => undefined }),
    }
    vm.runInNewContext(code, {
      window: sandboxWindow,
      document: documentStub,
      TextEncoder,
      require: makeRequire(seen),
    })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe('@eterna/prompt-studio')
    return registrations[0]!.factory(makeRequire(seen))
  }

  it('factory 暴露 apply 与 inject 服务表(slots/locale/connection)', () => {
    const seen: string[] = []
    const exports = loadBundle(seen)
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'connection'])
    for (const specifier of seen) expect(BASELINE_EXTERNALS).toContain(specifier)
  })

  function fakeCtx(): {
    ctx: {
      slots: {
        inject: (name: string, contribute: () => unknown) => () => void
        register: (options: Record<string, unknown>, component: unknown) => () => void
      }
      locale: { register: (ns: string, dicts: unknown) => () => void; bind: (ns: string) => (key: string) => string }
      connection: {
        rpc: {
          call: (channel: string, endpoint: string, payload: unknown) => Promise<{ ok: false; error: { code: string } }>
        }
      }
    }
    injected: string[]
    registered: { name: string; id?: string; key?: string }[]
  } {
    const injected: string[] = []
    const registered: { name: string; id?: string; key?: string }[] = []
    return {
      injected,
      registered,
      ctx: {
        slots: {
          inject: (name, contribute) => {
            injected.push(name)
            void contribute()
            return () => undefined
          },
          register: (options, _component) => {
            registered.push({
              name: String(options.name),
              ...(typeof options.id === 'string' && { id: options.id }),
              ...(typeof options.key === 'string' && { key: options.key }),
            })
            return () => undefined
          },
        },
        locale: {
          register: () => () => undefined,
          bind: () => (key: string) => key,
        },
        connection: {
          rpc: { call: async () => ({ ok: false as const, error: { code: 'vm-test' } }) },
        },
      },
    }
  }

  it('apply 注册两个 main keyed 面板与两个侧栏入口(id=key 对齐)', () => {
    const seen: string[] = []
    const exports = loadBundle(seen)
    const { ctx, injected, registered } = fakeCtx()
    const dispose = (exports.apply as (context: unknown) => () => void)(ctx)
    expect(typeof dispose).toBe('function')
    dispose()
    // 两个 main keyed 槽占位 + 两个 sidebar.panellist 条目
    expect(injected.filter(name => name === 'main')).toHaveLength(2)
    expect(injected.filter(name => name === 'sidebar.panellist')).toHaveLength(2)
    const mains = registered.filter(entry => entry.name === 'main')
    const panels = registered.filter(entry => entry.name === 'sidebar.panellist')
    expect(mains.map(entry => entry.key).sort()).toEqual(['eterna-loop-trace', 'eterna-prompt-studio'])
    expect(panels.map(entry => entry.id).sort()).toEqual(['eterna-loop-trace', 'eterna-prompt-studio'])
    // 初始拉数(刷新函数立即执行):connection rpc 已被调用(loopPrompt/*)
    expect(seen.every(specifier => BASELINE_EXTERNALS.includes(specifier as (typeof BASELINE_EXTERNALS)[number]))).toBe(true)
  })
})
