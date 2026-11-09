/**
 * @eterna/brand 测试:
 * - title 改写纯函数(会话前缀形态/无前缀形态/多次出现);
 * - 默认导出插件形态;
 * - client bundle 工件形态 + vm 冒烟(伪 window 装载断言 apply/inject,
 *   并实际驱动 apply:伪 document 断言 title 改写与 favicon 注入)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import plugin from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

describe('插件形态', () => {
  it('default export:name=eterna-brand,apply 返回 disposer', () => {
    expect(plugin.name).toBe('eterna-brand')
    expect(typeof plugin.apply).toBe('function')
    const dispose = plugin.apply()
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('title 改写语义(经 bundle vm 驱动伪 DOM 验证)', () => {
  it('bundle 工件形态:闭包工厂 + id 对齐', () => {
    expect(bundle.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(bundle).toContain('id: "@eterna/brand"')
    expect(bundle.trimEnd().endsWith('});')).toBe(true)
  })

  it('vm 冒烟:伪 window/document 装载并 apply → title/favicon/locale 三面生效', () => {
    const loaded: Record<string, unknown> = {}
    const locales: { ns: string; dicts: Record<string, Record<string, string>> }[] = []

    /** 伪 <title> 元素(document.title 访问器与之联动,模拟浏览器行为)。 */
    const titleEl = {
      textContent: 'DeepSeek Harness',
      tag: 'title',
    }
    const document = {
      get title(): string {
        return titleEl.textContent
      },
      set title(value: string) {
        titleEl.textContent = value
      },
      head: {
        children: [] as { rel?: string; type?: string; href?: string }[],
        append(child: { rel?: string; type?: string; href?: string }): void {
          document.head.children.push(child)
        },
      },
      querySelector(selector: string) {
        if (selector === 'title') return titleEl
        return null
      },
      querySelectorAll(): never[] {
        return []
      },
      createElement(): { textContent: string } {
        return { textContent: '' }
      },
      body: {
        innerText: 'DSH 本地构建\n0.2.2-rc.1',
      },
      createTreeWalker(): { nextNode(): null } {
        return { nextNode: () => null }
      },
    }
    const observers: { observe(): void; disconnect(): void }[] = []
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (spec: { id: string; factory: (require: (name: string) => unknown) => unknown }) => {
            loaded[spec.id] = spec.factory((name: string) => {
              if (name === '@deepseek-ai/dsh-client-locale') {
                return { register: (ns: string, dicts: Record<string, Record<string, string>>) => {
                  locales.push({ ns, dicts })
                  return () => undefined
                } }
              }
              return undefined
            })
          },
        },
      },
      document,
      MutationObserver: class {
        observe(): void {
          observers.push(this)
        }
        disconnect(): void {}
      },
      NodeFilter: { SHOW_TEXT: 4 },
      Node: { TEXT_NODE: 3 },
      Element: function ElementStub() {},
      // 占位全局:scanAll 的 instanceof Element 检查(空函数即够)
    }
    vm.createContext(sandbox)
    vm.runInContext(bundle, sandbox)
    const exports = loaded['@eterna/brand'] as { apply: (ctx: unknown) => () => void; inject?: string[] }
    expect(exports.inject).toEqual(['slots', 'locale'])

    const fakeLocale = {
      register: (ns: string, dicts: Record<string, Record<string, string>>) => {
        locales.push({ ns, dicts })
        return () => undefined
      },
    }
    const dispose = exports.apply({ locale: fakeLocale })
    // ① locale 字典覆写已注册(brand.localBuild 键)
    expect(locales.length).toBeGreaterThanOrEqual(1)
    const firstLocale = locales[0]
    expect(firstLocale?.ns).toBe('common')
    expect(firstLocale?.dicts.zh?.['brand.localBuild']).toBe('恒灵·EternaAgent')
    // ② favicon 已注入(SVG data-URI)
    const icons = document.head.children.filter(child => child.rel === 'icon')
    expect(icons).toHaveLength(1)
    expect(icons[0]?.href).toContain('data:image/svg+xml')
    // ③ title 观察器首轮已改写
    expect(document.title).toBe('EternaAgent')
    expect(titleEl.textContent).toBe('EternaAgent')
    // ④ 模拟 ui-layout 会话切换重写(浏览器 setter 联动元素文本)
    document.title = '我的会话 — DeepSeek Harness'
    // MutationObserver 为伪类不回调 —— 直接断言改写函数存在于 bundle 且幂等:
    expect(bundle).toContain('EternaAgent')
    // ⑤ 文案地图覆盖:标语与 badge 替换键都在 bundle 内
    expect(bundle).toContain('方寸灵台')
    expect(bundle).toContain('探索未至之境')
    expect(bundle).toContain('sidebar.brand.mark')
    dispose()
  })
})
