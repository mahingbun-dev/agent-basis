/**
 * B19 首屏品牌浮层合约测试（54 §4.6 T33 / 50 §3.8+§5.6 / 47 §2.14+B19）。
 *
 * 纪律：测的是**出厂的 lib/client.js**（装载形态、slot 注册、组件返回的
 * 元素树）；样式表从 src 直读（HERO_CSS 是同一份字符串被塞进 bundle）。
 *
 * 覆盖：
 * - `conversation.hero.frame`（hoc，自有 id + order）与
 *   `conversation.hero.brand.mark`（single）都注册；
 * - `hero=false` 直返 children（零 DOM 增量，不新增包裹元素）；
 * - `hero=true` 外层 display:contents，品牌层
 *   `position:absolute; inset:0; z-index:-1; pointer-events:none`，children 原样；
 * - 品牌标按 owner props `{size, className?}` 渲染，size 缺省 24（侧栏席位不回归）；
 * - 样式只用 `--et-*` 令牌、断点仅 1100/760/640、reduced-motion 静态、深色降透明；
 * - disposer 撤销两个 slot 注册。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { BRAND_BOLT_PATH } from '@eterna/ui/icon-data'
import { HERO_CSS, injectHeroStyles } from '../src/client/styles.ts'

const root = join(import.meta.dirname, '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/** 伪 React 元素（vm 内 createElement 的产物；只断言形状，不渲染）。 */
interface VNode {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/** 伪 React：只实现本包用到的 createElement。 */
const fakeReact = {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): VNode {
    return { type, props: { ...(props ?? {}), children }, children }
  },
}

/** 伪样式/元素节点。 */
interface FakeNode {
  tag: string
  id: string
  textContent: string
  attrs: Record<string, string>
  rel?: string
  type?: string
  href?: string
  setAttribute(name: string, value: string): void
  remove(): void
}

/** 伪 document（覆盖 apply 全链：title/favicon/观察器/令牌与 hero 样式注入）。 */
class FakeDocument {
  readonly head: { append(node: FakeNode): void }
  readonly body: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
  readonly documentElement = {}
  title = 'EternaAgent'
  readonly nodes: FakeNode[] = []

  constructor() {
    this.head = { append: (node) => { this.nodes.push(node) } }
    this.body = { setAttribute: () => undefined, removeAttribute: () => undefined }
  }

  querySelector(selector: string): FakeNode | null {
    if (selector === 'title') return null
    if (selector.startsWith('#')) return this.nodes.find(node => node.id === selector.slice(1)) ?? null
    const attr = /^style\[([a-z-]+)\]$/u.exec(selector)
    if (attr !== null) return this.nodes.find(node => node.attrs[attr[1] as string] !== undefined) ?? null
    return null
  }

  querySelectorAll(): FakeNode[] {
    return []
  }

  createElement(tag: string): FakeNode {
    const node: FakeNode = {
      tag,
      id: '',
      textContent: '',
      attrs: {},
      setAttribute(name, value) { node.attrs[name] = value },
      remove: () => {
        const index = this.nodes.indexOf(node)
        if (index >= 0) this.nodes.splice(index, 1)
      },
    }
    return node
  }

  createTreeWalker(): { nextNode(): null } {
    return { nextNode: () => null }
  }
}

interface SlotRegistration {
  options: { name?: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

interface Harness {
  document: FakeDocument
  injected: string[]
  registrations: SlotRegistration[]
  disposed: string[]
  dispose(): void
}

/** 在 vm 里装载出厂 bundle 并驱动 apply（捕获 slot 注册与样式节点）。 */
function loadAndApply(): Harness {
  const loaded: { id: string; exports: unknown }[] = []
  const document = new FakeDocument()
  const injected: string[] = []
  const registrations: SlotRegistration[] = []
  const disposed: string[] = []
  const sandbox: Record<string, unknown> = {
    window: {
      __ModuleLoader__: {
        load: (spec: { id: string; factory: (require: (name: string) => unknown) => unknown }) => {
          loaded.push({ id: spec.id, exports: spec.factory((name: string) => name === 'react' ? fakeReact : undefined) })
        },
      },
    },
    document,
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    NodeFilter: { SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    CSS: { escape: (value: string) => value },
    Element: function ElementStub() {},
  }
  vm.runInContext(bundle, vm.createContext(sandbox))
  expect(loaded).toHaveLength(1)
  expect(loaded[0]?.id).toBe('@eterna/brand')
  const exports = loaded[0]?.exports as Record<string, unknown>
  expect(typeof exports['apply']).toBe('function')

  const ctx = {
    slots: {
      inject(name: string, contribute: () => unknown): () => void {
        injected.push(name)
        const dispose = contribute()
        return typeof dispose === 'function' ? dispose as () => void : () => undefined
      },
      register(options: SlotRegistration['options'], component: SlotRegistration['component']): () => void {
        registrations.push({ options, component })
        return () => { disposed.push(options.name ?? '') }
      },
    },
  }
  const dispose = (exports['apply'] as (context: unknown) => () => void)(ctx)
  expect(typeof dispose).toBe('function')
  return { document, injected, registrations, disposed, dispose }
}

/** 取已注册的组件（槽位名 → 占用方）。 */
function componentOf(h: Harness, name: string): (props: Record<string, unknown>) => unknown {
  const component = h.registrations.find(registration => registration.options.name === name)?.component
  expect(component, `未注册 ${name}`).toBeDefined()
  return component as (props: Record<string, unknown>) => unknown
}

describe('slot 注册（出厂 bundle）', () => {
  it('注册 hero.frame（hoc，自有 id/order）与 hero.brand.mark（single），并注入令牌 + hero 样式', () => {
    const h = loadAndApply()
    expect(h.injected).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.frame',
      'conversation.hero.brand.mark',
    ])

    const frame = h.registrations.find(registration => registration.options.name === 'conversation.hero.frame')
    const mark = h.registrations.find(registration => registration.options.name === 'conversation.hero.brand.mark')
    // hoc 层必须自带 id（新 id 追加一层；复用上游 'pixel-whale' 会替换官方鲸鱼层）。
    expect(frame?.options.id).toBe('eterna-hero-skin')
    expect(frame?.options.order).toBe(0)
    // single 槽位不带 id。
    expect(mark?.options.id).toBeUndefined()
    expect(typeof frame?.component).toBe('function')
    expect(typeof mark?.component).toBe('function')

    const tokens = h.document.nodes.find(node => node.id === 'eterna-ui-tokens')
    const hero = h.document.nodes.find(node => node.attrs['data-eterna-hero-styles'] !== undefined)
    expect(tokens).toBeDefined()
    expect(tokens?.textContent).toContain('--et-accent')
    expect(hero).toBeDefined()
    expect(hero?.textContent).toBe(HERO_CSS)
  })

  it('disposer 撤销两个 hero slot 注册（连同侧栏两个席位）', () => {
    const h = loadAndApply()
    h.dispose()
    expect(h.disposed).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.frame',
      'conversation.hero.brand.mark',
    ])
  })
})

describe('HeroFrame HOC 元素树（hero=false 零增量 / hero=true 布局中性）', () => {
  it('hero=false 直返 children：同一个引用，不新增任何元素', () => {
    const HeroFrame = componentOf(loadAndApply(), 'conversation.hero.frame')
    const children = { marker: 'scroll-body' }
    expect(HeroFrame({ hero: false, children })).toBe(children)
    expect(HeroFrame({ hero: false, children: undefined })).toBeUndefined()
  })

  it('hero=true：外层 display:contents，品牌层绝对定位负 z-index 且不接指针，children 只渲染一次', () => {
    const HeroFrame = componentOf(loadAndApply(), 'conversation.hero.frame')
    const children = { marker: 'scroll-body' }
    const frame = HeroFrame({ hero: true, children }) as VNode

    expect(frame.type).toBe('div')
    expect(frame.props['data-eterna-hero-frame']).toBe('')
    expect(frame.props['style']).toEqual({ display: 'contents' })
    // children 顺序 = [品牌层, 宿主滚动体]；滚动体只出现一次且原样。
    expect(frame.children).toHaveLength(2)
    expect(frame.children[1]).toBe(children)

    const layer = frame.children[0] as VNode
    expect(layer.type).toBe('div')
    expect(layer.props['data-eterna-hero-layer']).toBe('')
    expect(layer.props['aria-hidden']).toBe('true')
    // 不挂任何事件监听（点击/键盘穿透到输入卡）。
    expect(layer.props['onClick']).toBeUndefined()
    expect(layer.props['onPointerDown']).toBeUndefined()
    expect(layer.props['onKeyDown']).toBeUndefined()
    // 装饰内容：玉晕 + 双玉环 + 恒灵标水印。
    const kinds = (layer.children as VNode[]).map(child => Object.keys(child.props)[0])
    expect(kinds).toEqual([
      'data-eterna-hero-glow',
      'data-eterna-hero-ring',
      'data-eterna-hero-ring',
      'data-eterna-hero-mark',
    ])
    const mark = layer.children[3] as VNode
    expect(mark.type).toBe('svg')
    expect(mark.props['viewBox']).toBe('0 0 24 24')
    expect(mark.props['aria-hidden']).toBe('true')
    expect(mark.props['focusable']).toBe('false')
    expect((mark.children[0] as VNode).props['d']).toBe(BRAND_BOLT_PATH)
    expect((mark.children[0] as VNode).props['fill']).toBe('currentColor')
  })
})

describe('conversation.hero.brand.mark 占用方（BrandMark 复用）', () => {
  it('按 owner props size=34 + className 渲染恒灵标（单色 currentColor，装饰性 aria-hidden）', () => {
    const h = loadAndApply()
    const hero = componentOf(h, 'conversation.hero.brand.mark')
    const svg = hero({ size: 34, className: 'hero-fish' }) as VNode
    expect(svg.type).toBe('svg')
    expect(svg.props['width']).toBe(34)
    expect(svg.props['height']).toBe(34)
    expect(svg.props['viewBox']).toBe('0 0 24 24')
    expect(svg.props['className']).toBe('hero-fish')
    expect(svg.props['fill']).toBe('none')
    expect(svg.props['aria-hidden']).toBe(true)
    expect(svg.props['focusable']).toBe('false')
    const path = svg.children[0] as VNode
    expect(path.type).toBe('path')
    expect(path.props['d']).toBe(BRAND_BOLT_PATH)
    expect(path.props['fill']).toBe('currentColor')
  })

  it('侧栏与 hero 复用同一组件；size 缺省 24（侧栏席位不回归）', () => {
    const h = loadAndApply()
    const hero = componentOf(h, 'conversation.hero.brand.mark')
    const sidebar = componentOf(h, 'sidebar.brand.mark')
    expect(hero).toBe(sidebar)
    const svg = sidebar({}) as VNode
    expect(svg.props['width']).toBe(24)
    expect(svg.props['height']).toBe(24)
    expect(svg.props['className']).toBeUndefined()
  })
})

describe('HERO_CSS 令牌/断点/动效纪律', () => {
  /** 取某选择器块（首个匹配）的声明体。 */
  function block(selector: string): string {
    const start = HERO_CSS.indexOf(selector)
    expect(start, `缺失选择器 ${selector}`).toBeGreaterThanOrEqual(0)
    const open = HERO_CSS.indexOf('{', start)
    const close = HERO_CSS.indexOf('}', open)
    return HERO_CSS.slice(open, close)
  }

  it('品牌层：position:absolute / inset:0 / z-index:-1 / pointer-events:none（H13 输入面）', () => {
    const layer = block('[data-eterna-hero-layer]')
    for (const declaration of ['position: absolute;', 'inset: 0;', 'z-index: -1;', 'pointer-events: none;']) {
      expect(layer, `品牌层缺 ${declaration}`).toContain(declaration)
    }
    // 禁止全屏遮罩。
    expect(HERO_CSS).not.toContain('position: fixed')
    expect(HERO_CSS).not.toContain('position:fixed')
    // 外框布局中性。
    expect(block('[data-eterna-hero-frame]')).toContain('display: contents;')
  })

  it('零字面色值、零上游令牌名，全部 var() 指向 --et-*', () => {
    expect(HERO_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    expect(HERO_CSS).not.toMatch(/\b(rgba?|hsla?)\(/u)
    expect(HERO_CSS).not.toContain('--dsw-')
    const vars = [...HERO_CSS.matchAll(/var\((--[a-z0-9-]+)/gu)].map(match => match[1] as string)
    expect(vars.length).toBeGreaterThan(0)
    for (const name of vars) expect(name.startsWith('--et-')).toBe(true)
  })

  it('断点只用 1100/760/640（只收缩形态；<760 隐藏侧向装饰、gutter 16）', () => {
    const widths = [...HERO_CSS.matchAll(/\((?:max|min)-width:\s*([0-9]+)px\)/gu)].map(match => Number(match[1]))
    expect(new Set(widths)).toEqual(new Set([1100, 760, 640]))
    const compact = HERO_CSS.slice(HERO_CSS.indexOf('@media (max-width: 760px)'))
    expect(compact).toContain('[data-eterna-hero-ring] { display: none; }')
    expect(compact).toContain('--et-hero-gutter: 16px;')
  })

  it('reduced-motion 静态；深色主题降低装饰透明度', () => {
    const reduced = HERO_CSS.slice(HERO_CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('[data-eterna-hero-glow] { animation: none; }')
    const dark = block('body[data-ds-dark-theme] [data-eterna-hero-layer]')
    expect(dark).toContain('--et-hero-glow-opacity: 0.7;')
    expect(dark).toContain('--et-hero-mark-opacity: 0.03;')
  })

  it('injectHeroStyles 幂等（同文档重复装载复用既有节点）', () => {
    const document = new FakeDocument()
    const doc = document as unknown as Document
    injectHeroStyles(doc)
    injectHeroStyles(doc)
    const heroNodes = document.nodes.filter(node => node.attrs['data-eterna-hero-styles'] !== undefined)
    expect(heroNodes).toHaveLength(1)
    expect(heroNodes[0]?.textContent).toBe(HERO_CSS)
    const tokenNodes = document.nodes.filter(node => node.id === 'eterna-ui-tokens')
    expect(tokenNodes).toHaveLength(1)
  })
})
