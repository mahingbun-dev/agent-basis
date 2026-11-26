/**
 * 客户端 bundle 工件测试(T6.2 插件页全员可见只读,2026-11-24)。
 *
 * 两层断言:
 * 1. **工件形态**:闭包工厂包装(window.__ModuleLoader__.load),基线外部模块以
 *    require 引用而非内联(panel/memory 同款配方)。
 * 2. **装载冒烟(vm)**:以伪 ctx 跑 apply,锁住本次改动的三件可见契约——
 *    ① plugins.tab 对 admin 与非 admin **都**注册两枚页签(我的插件 + 恒灵插件);
 *    ② /access/api/me 的角色落到 `<html data-eterna-access-role>`;
 *    ③ 非 admin 装只读捕获守卫(click/keydown),admin 不装。
 * 3. **只读守卫单测**:选择器面(写控件拦、「刷新」不拦)与幂等卸载。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  applyPluginPageRole,
  installReadOnlyGuard,
  isWriteControl,
  ROLE_ATTRIBUTE,
} from '../src/client/plugin-page-guard.ts'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/access", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/access"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联(react 不打进包)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('require("react")')
    expect(code).toContain('require("react/jsx-runtime")')
    expect(code).not.toContain('function createElement') // react 未被打进包
  })

  it('只读守卫与角色标记已进包(样式与拦截同源,不漏装)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('data-eterna-access-role')
    // 选择器面(ASCII 部分;中文 aria-label 前缀在产物里是 \u 转义,断言转义形)
    expect(code).toContain('[data-plugin-panel] button[role="switch"]')
    expect(code).toContain('button[aria-label^="\\u9009\\u62E9\\u6DFB\\u52A0\\u63D2\\u4EF6\\u65B9\\u5F0F"]')
  })
})

// ── 伪 DOM(apply 只用到 createElement/head/body/documentElement/监听/查询) ──

interface FakeElement {
  attributes: Map<string, string>
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  getAttribute(name: string): string | null
  appendChild(child: unknown): void
  append(child: unknown): void
  remove(): void
  textContent: string
  id: string
  style: Record<string, string>
}

function fakeElement(): FakeElement {
  const attributes = new Map<string, string>()
  return {
    attributes,
    setAttribute: (name, value) => { attributes.set(name, value) },
    removeAttribute: (name) => { attributes.delete(name) },
    getAttribute: name => attributes.get(name) ?? null,
    appendChild: () => undefined,
    append: () => undefined,
    remove: () => undefined,
    textContent: '',
    id: '',
    style: {},
  }
}

interface FakeDocument {
  documentElement: FakeElement
  head: { append(child: unknown): void; appendChild(child: unknown): void }
  body: FakeElement & { appendChild(child: unknown): void }
  listeners: { type: string; capture: boolean }[]
  createElement(): FakeElement
  getElementById(): null
  querySelector(): null
  querySelectorAll(): unknown[]
  addEventListener(type: string, _fn: unknown, capture?: boolean): void
  removeEventListener(type: string, _fn: unknown, capture?: boolean): void
}

function fakeDocument(): FakeDocument {
  const listeners: { type: string; capture: boolean }[] = []
  const body = Object.assign(fakeElement(), { appendChild: () => undefined })
  return {
    documentElement: fakeElement(),
    head: { append: () => undefined, appendChild: () => undefined },
    body,
    listeners,
    createElement: fakeElement,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, _fn, capture) => { listeners.push({ type, capture: capture === true }) },
    removeEventListener: (type, _fn, capture) => {
      const at = listeners.findIndex(entry => entry.type === type && entry.capture === (capture === true))
      if (at >= 0) listeners.splice(at, 1)
    },
  }
}

interface RegisteredSlot {
  slot: string
  options: Record<string, unknown>
}

interface Harness {
  doc: FakeDocument
  slots: RegisteredSlot[]
  exports: Record<string, unknown>
  dispose(): void
}

/** 装载 bundle 并以伪 ctx 跑 apply。role 决定 /access/api/me 的应答(undefined=未登录)。 */
async function loadBundle(role: string | undefined): Promise<Harness> {
  const code = readFileSync(bundlePath, 'utf8')
  const doc = fakeDocument()
  type Factory = (require: (specifier: string) => unknown) => Record<string, unknown>
  const registrations: { id: string; factory: Factory }[] = []
  const sandboxWindow: Record<string, unknown> = {
    __ModuleLoader__: { load: (registration: { id: string; factory: Factory }) => { registrations.push(registration) } },
    location: { href: '' },
  }
  const requireStub = (specifier: string): unknown => {
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return nodeRequire(specifier)
    if (specifier === 'react-dom/client') {
      return { createRoot: () => ({ render: () => undefined, unmount: () => undefined }) }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }
  const fetchStub = (): Promise<unknown> => Promise.resolve({
    ok: role !== undefined,
    status: role !== undefined ? 200 : 401,
    json: () => Promise.resolve(role !== undefined ? { role } : {}),
  })
  class MutationObserverStub {
    observe(): void { /* 伪观测:attach 已同步跑过一次 */ }
  }
  vm.runInNewContext(code, {
    window: sandboxWindow,
    document: doc,
    require: requireStub,
    fetch: fetchStub,
    MutationObserver: MutationObserverStub,
    setTimeout,
    clearTimeout,
    console,
  })
  expect(registrations).toHaveLength(1)
  expect(registrations[0]?.id).toBe('@eterna/access')

  const slots: RegisteredSlot[] = []
  const fakeCtx = {
    slots: {
      // inject 的 contribute 回调由壳在席位声明出现时调用;冒烟立即触发以断言注册面。
      inject: (_slot: string, contribute: () => unknown) => { contribute(); return () => undefined },
      register: (options: Record<string, unknown>) => {
        slots.push({ slot: options.name as string, options })
        return () => undefined
      },
      entries: () => [],
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh', locales: [] }),
      setLocale: () => undefined,
    },
    theme: { getTheme: () => ({ preference: 'system' }), setTheme: () => undefined },
    layout: { selectMainPanel: () => undefined },
    uiWorkspace: undefined,
    sessions: undefined,
    configForms: undefined,
  }
  const exports = registrations[0]!.factory(requireStub)
  const dispose = (exports.apply as (ctx: unknown) => () => void)(fakeCtx)
  // 角色链是 two-then 微任务,等它落定(不依赖定时器精度)
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
  return { doc, slots, exports, dispose }
}

const idsIn = (harness: Harness, slot: string): string[] =>
  harness.slots.filter(entry => entry.slot === slot).map(entry => entry.options.id as string)

/** main 是 keyed 槽:身份在 options.key 而不是 id。 */
const keysIn = (harness: Harness, slot: string): string[] =>
  harness.slots.filter(entry => entry.slot === slot).map(entry => entry.options.key as string)

describe('模块装载冒烟(vm)', () => {
  it('factory 暴露 apply 函数与 inject 服务表', async () => {
    const harness = await loadBundle('user')
    expect(typeof harness.exports.apply).toBe('function')
    expect(harness.exports.inject).toEqual(['slots', 'locale', 'theme', 'layout', 'uiWorkspace', 'sessions', 'configForms'])
    harness.dispose()
  })

  it('非 admin:plugins.tab 两枚页签都在位(我的插件可操作 + 恒灵插件只读)', async () => {
    const harness = await loadBundle('user')
    const tabs = idsIn(harness, 'plugins.tab')
    // 子集断言:main 侧可能继续追加页签(如后续的共享/统计页签),此处只锁本任务两枚
    expect(tabs).toContain('eterna-access.manage')
    expect(tabs).toContain('eterna-access.my-plugins')
    const manage = harness.slots.find(entry => entry.options.id === 'eterna-access.manage')
    expect(manage?.options.order).toBe(20)
    // readOnly 由角色现查注入(inject 是函数,壳每次注册时调用)
    const injectOf = manage?.options.inject as (() => { readOnly: boolean }) | undefined
    expect(injectOf?.()).toEqual({ readOnly: true })
    // 管理面页签(用户管理/审批队列)仍只给 admin
    expect(idsIn(harness, 'settings.section')).not.toContain('eterna-access.users')
    expect(idsIn(harness, 'settings.section')).not.toContain('eterna-access.approval-queue')
    // 「更新记录」全员可见只读(55 号);shell.overlay 席位常驻(不弹时零尺寸根)
    expect(idsIn(harness, 'settings.section')).toContain('eterna-access.release-notes')
    expect(idsIn(harness, 'shell.overlay')).toContain('eterna-access.release-notes')
    harness.dispose()
  })

  it('技能/MCP 走左侧入口:main 页 + sidebar 入口两种角色都在位,设置分区不再重复', async () => {
    for (const role of ['user', 'admin']) {
      const harness = await loadBundle(role)
      expect(keysIn(harness, 'main')).toEqual(expect.arrayContaining(['eterna-access.skills', 'eterna-access.mcp-servers']))
      expect(idsIn(harness, 'sidebar.panellist')).toEqual(expect.arrayContaining(['eterna-access.skills', 'eterna-access.mcp-servers']))
      expect(idsIn(harness, 'settings.section')).not.toContain('eterna-access.skills')
      expect(idsIn(harness, 'settings.section')).not.toContain('eterna-access.mcp-servers')
      harness.dispose()
    }
  })

  it('admin:plugins.tab 两枚页签都在位,恒灵插件可写', async () => {
    const harness = await loadBundle('admin')
    const tabs = idsIn(harness, 'plugins.tab')
    expect(tabs).toContain('eterna-access.manage')
    expect(tabs).toContain('eterna-access.my-plugins')
    const manage = harness.slots.find(entry => entry.options.id === 'eterna-access.manage')
    const injectOf = manage?.options.inject as (() => { readOnly: boolean }) | undefined
    expect(injectOf?.()).toEqual({ readOnly: false })
    // admin 专属页签在位(其余全员分区不逐项列举——main 会追加,子集断言更稳)
    const sections = idsIn(harness, 'settings.section')
    for (const id of [
      'eterna-access.account', 'eterna-access.users', 'eterna-access.approval-queue',
      'eterna-access.release-notes',
    ]) {
      expect(sections, id).toContain(id)
    }
    harness.dispose()
  })

  it('角色落到 <html data-eterna-access-role>:非 admin=member 并装只读守卫,admin=admin 不装', async () => {
    const member = await loadBundle('user')
    expect(member.doc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBe('member')
    expect(member.doc.listeners).toEqual([
      { type: 'click', capture: true },
      { type: 'keydown', capture: true },
    ])
    member.dispose()
    // disposer 收全:标记与监听都不留全局残留
    expect(member.doc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBeNull()
    expect(member.doc.listeners).toEqual([])

    const admin = await loadBundle('admin')
    expect(admin.doc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBe('admin')
    expect(admin.doc.listeners).toEqual([])
    admin.dispose()
    expect(admin.doc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBeNull()
  })

  it('未登录(401):不注册任何角色分区,也不写角色标记(登录页场景)', async () => {
    const harness = await loadBundle(undefined)
    // 角色无关的无条件席位照常(账户菜单/动作条反馈/会话探针在壳内独立生效)
    expect(idsIn(harness, 'settings.section')).toEqual([])
    expect(idsIn(harness, 'plugins.tab')).toEqual([])
    expect(harness.doc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBeNull()
    expect(harness.doc.listeners).toEqual([])
    harness.dispose()
  })
})

// ── 只读守卫单测(选择器面与拦截语义) ──

/** 目标元素桩:closest 命中给定选择器之一即返回自身(EventTarget 形状由断言侧转换)。 */
const targetClosest = (...matched: string[]): EventTarget => ({
  closest: (selector: string) => (matched.includes(selector) ? {} : null),
}) as unknown as EventTarget

/** 一次文档事件的最小面(preventDefault / stopImmediatePropagation 可观测)。 */
const fakeEvent = (target: EventTarget) => {
  const preventDefault = vi.fn()
  const stopImmediatePropagation = vi.fn()
  return { event: { target, preventDefault, stopImmediatePropagation }, preventDefault, stopImmediatePropagation }
}

describe('只读守卫(plugin-page-guard)', () => {
  it('写控件与读控件区分:开关/添加/卸载/更新命中,刷新不命中', () => {
    // role=switch(启停开关)
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[role="switch"]'))).toBe(true)
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[aria-label^="添加插件"]'))).toBe(true)
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[aria-label^="选择添加插件方式"]'))).toBe(true)
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[aria-label^="卸载 "]'))).toBe(true)
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[aria-label^="更新 "]'))).toBe(true)
    // 「刷新」是读操作,必须保持可点
    expect(isWriteControl(targetClosest('[data-plugin-panel] button[aria-label="刷新"]'))).toBe(false)
    // 面板外的同类 role=switch(设置弹窗自绘开关)不误伤
    expect(isWriteControl(targetClosest('button[role="switch"]'))).toBe(false)
    // 非元素目标/null 一律放行
    expect(isWriteControl(null)).toBe(false)
    expect(isWriteControl({} as never)).toBe(false)
  })

  it('捕获阶段拦下写控件的 click 与 Enter/Space,读控件与其它键不拦', () => {
    const doc = fakeDocument()
    type Handler = (event: unknown) => void
    const handlers = new Map<string, Handler>()
    const recordDoc = {
      addEventListener: (type: string, fn: Handler) => { handlers.set(type, fn) },
      removeEventListener: (type: string) => { handlers.delete(type) },
    } as unknown as Document
    const dispose = installReadOnlyGuard(recordDoc)
    const click = handlers.get('click')!
    const keydown = handlers.get('keydown')!
    void doc

    const writeClick = fakeEvent(targetClosest('[data-plugin-panel] button[role="switch"]'))
    click(writeClick.event)
    expect(writeClick.preventDefault).toHaveBeenCalledTimes(1)
    expect(writeClick.stopImmediatePropagation).toHaveBeenCalledTimes(1)

    const refreshClick = fakeEvent(targetClosest('[data-plugin-panel] button[aria-label="刷新"]'))
    click(refreshClick.event)
    expect(refreshClick.preventDefault).not.toHaveBeenCalled()
    expect(refreshClick.stopImmediatePropagation).not.toHaveBeenCalled()

    for (const key of ['Enter', ' ']) {
      const writeKey = fakeEvent(targetClosest('[data-plugin-panel] button[aria-label^="卸载 "]'))
      keydown({ ...writeKey.event, key })
      expect(writeKey.preventDefault, key).toHaveBeenCalledTimes(1)
      expect(writeKey.stopImmediatePropagation, key).toHaveBeenCalledTimes(1)
    }
    // Tab 焦点遍历不受影响(无障碍)
    const tab = fakeEvent(targetClosest('[data-plugin-panel] button[role="switch"]'))
    keydown({ ...tab.event, key: 'Tab' })
    expect(tab.preventDefault).not.toHaveBeenCalled()

    dispose()
    expect(handlers.size).toBe(0)
  })

  it('applyPluginPageRole:member 双管齐下、admin 只写标记,两者卸载都清干净', () => {
    const memberDoc = fakeDocument()
    const disposeMember = applyPluginPageRole('user', memberDoc as unknown as Document)
    expect(memberDoc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBe('member')
    expect(memberDoc.listeners.map(entry => entry.type).sort()).toEqual(['click', 'keydown'])
    disposeMember()
    expect(memberDoc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBeNull()
    expect(memberDoc.listeners).toEqual([])

    const adminDoc = fakeDocument()
    const disposeAdmin = applyPluginPageRole('admin', adminDoc as unknown as Document)
    expect(adminDoc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBe('admin')
    expect(adminDoc.listeners).toEqual([])
    disposeAdmin()
    expect(adminDoc.documentElement.getAttribute(ROLE_ATTRIBUTE)).toBeNull()
  })
})
