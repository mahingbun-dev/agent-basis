/**
 * 客户端 bundle 工件测试(P5 面板实现,2026-11-24)。
 *
 * 三层断言:
 * 1. **工件形态**:闭包工厂包装(`window.__ModuleLoader__.load`)、基线外部模块
 *    以 require 引用而非内联、require 白名单与 `dsh.client.inject` 声明一致。
 * 2. **装载冒烟(vm + 伪 ctx)**:跑 apply,锁住 P5 新增的三段注册——
 *    ① `ctx.resources.register` 注册 `adviserchat` 协议;
 *    ② tab 类型带 `patterns` + `canOpen` + `multiple`(资源型 + 可多开);
 *    ③ body 声明自己的会话子槽位(否则拿不到 SessionProvider 席)。
 * 3. **地址与模式单测**:地址往返、非法地址拒绝、tab contentId → 渲染模式。
 *
 * 依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  ADVISER_CHAT_ADDRESS, ADVISER_PROTOCOL, adviserChatAddress, parseAdviserChatAddress,
} from '../src/client/address.ts'
import { CONVERSATION_SLOT, panelMode } from '../src/client/AdviserPanel.tsx'
import {
  ADVISER_COMMAND_NAME, ADVISER_SELECTION_ID, ADVISER_SHORTCUT_CODE, ADVISER_TAB_KIND,
} from '../src/client/entries.ts'

/** P7 选区浮层所在的键控槽位(ui-chat 声明,key = 交互 id)。 */
const SELECTION_SLOT = 'conversation.chat.text-interaction'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const nodeRequire = createRequire(import.meta.url)

describe('lib/client.js 工件形态', () => {
  it('闭包工厂包装:window.__ModuleLoader__.load({ id: "@eterna/adviser", factory })', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{/u)
    expect(code).toContain('id: "@eterna/adviser"')
    expect(code).toContain('factory: (require) =>')
    expect(code.trimEnd().endsWith('});')).toBe(true)
  })

  it('基线外部模块以 require 引用而非内联', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // jsx: 'automatic' → React 运行时经 react/jsx-runtime 引入,不 import default react。
    expect(code).toContain('require("react/jsx-runtime")')
    expect(code).not.toContain('function createElement') // react 未被打进包
  })

  it('@eterna/ui 图标与令牌随包打入(无上游图标引用)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('comment')
    expect(code).not.toContain('dsw-alias-comment')
  })

  it('require 面只有基线外部模块(零 dsh 客户端包运行时依赖)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    const required = [...code.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1] as string)
    expect([...new Set(required)].sort()).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-slots',
      'react',
      'react/jsx-runtime',
    ].filter(spec => required.includes(spec)).sort())
  })
})

// ── 地址协议与渲染模式(纯函数)──────────────────────────────────────────────

describe('参谋资源地址', () => {
  it('往返:组装 → 解析得到同一对会话 id', () => {
    const address = adviserChatAddress('session-main', 'session-main--adviser-1')
    expect(address).toBe('dsh-resource://adviserchat/session/session-main--adviser-1?parent=session-main')
    expect(parseAdviserChatAddress(address)).toEqual({
      childSessionId: 'session-main--adviser-1',
      parentSessionId: 'session-main',
    })
  })

  it('含特殊字符的会话 id 经 encode 后仍可还原', () => {
    const child = 'a/b?c#d e'
    const parsed = parseAdviserChatAddress(adviserChatAddress('m', child))
    expect(parsed?.childSessionId).toBe(child)
  })

  it('非法地址一律 undefined(不抛)', () => {
    expect(parseAdviserChatAddress('')).toBeUndefined()
    expect(parseAdviserChatAddress('not-a-url')).toBeUndefined()
    expect(parseAdviserChatAddress('sidebar://adviser/abc')).toBeUndefined()
    // 别的协议(上游 subagentchat)不得被本插件认领。
    expect(parseAdviserChatAddress('dsh-resource://subagentchat/session/x?parent=m&mode=continuable')).toBeUndefined()
    // 段数不对 / 缺 parent / 空 child。
    expect(parseAdviserChatAddress('dsh-resource://adviserchat/x/y')).toBeUndefined()
    expect(parseAdviserChatAddress('dsh-resource://adviserchat/session/child')).toBeUndefined()
    expect(parseAdviserChatAddress('dsh-resource://adviserchat/session/?parent=m')).toBeUndefined()
    expect(parseAdviserChatAddress('dsh-resource://adviserchat/session/child?parent=')).toBeUndefined()
  })

  it('协议名与地址前缀自洽(patterns 声明从它派生)', () => {
    expect(ADVISER_PROTOCOL).toBe('adviserchat')
    expect(ADVISER_CHAT_ADDRESS.startsWith(`dsh-resource://${ADVISER_PROTOCOL}/`)).toBe(true)
  })
})

describe('tab contentId → 渲染模式', () => {
  it('参谋资源地址 → 会话模式', () => {
    const mode = panelMode(adviserChatAddress('main', 'child'))
    expect(mode.kind).toBe('conversation')
    if (mode.kind !== 'conversation') throw new Error('unreachable')
    expect(mode.parentSessionId).toBe('main')
    expect(mode.childSessionId).toBe('child')
  })

  it('页面地址与任何无法解析的 contentId → 选择模式', () => {
    expect(panelMode('sidebar://adviser').kind).toBe('picker')
    expect(panelMode('sidebar://adviser/9f1c').kind).toBe('picker')
    expect(panelMode('').kind).toBe('picker')
  })
})

// ── 模块装载冒烟(vm + 伪 ctx)──────────────────────────────────────────────

/** apply 需要的伪 DOM(样式注入只用到 querySelector/createElement/head)。 */
function makeDocumentStub(): unknown {
  interface ElementStub {
    id?: string
    textContent: string
    dataset: Record<string, string>
    setAttribute: () => void
    remove: () => void
  }
  return {
    querySelector: (): null => null,
    createElement: (): ElementStub =>
      ({ textContent: '', dataset: {}, setAttribute: () => {}, remove: () => {} }),
    head: {
      append: (el: { id?: string }) => { void el },
      appendChild: (el: { id?: string }) => { void el },
    },
  }
}

interface Recorded {
  readonly resources: { protocol: string; open: unknown }[]
  readonly tabTypes: {
    id: string
    kind: string
    patterns?: readonly string[]
    priority?: string
    multiple?: boolean
    keepMounted?: boolean
    canOpen?: (address: string) => boolean
    title: (address: string) => string
    guide?: readonly { id: string; order: number; title: () => string; description?: () => string }[]
  }[]
  readonly injections: string[]
  readonly slots: { options: { name: string; key?: string; children?: Record<string, unknown> }; component: unknown }[]
  readonly dictionaries: Record<string, unknown>
  /** P7:斜杠命令贡献。 */
  readonly commands: Record<string, unknown>[]
  /** P7:快捷键命令。 */
  readonly shortcuts: Record<string, unknown>[]
  /** P7:文字手势定义。 */
  readonly interactions: Record<string, unknown>[]
  /** P7:导航控制器收到的 openTab 调用(kind 序列)。 */
  readonly openedTabs: string[]
}

function loadBundle(): {
  exports: Record<string, unknown>
  recorded: Recorded
} {
  const code = readFileSync(bundlePath, 'utf8')
  const registrations: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }[] = []
  const sandboxWindow: { __ModuleLoader__?: unknown } = {
    __ModuleLoader__: { load: (registration: never) => { registrations.push(registration) } },
  }
  const requireStub = (specifier: string): unknown => {
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return nodeRequire(specifier)
    throw new Error(`unexpected require: ${specifier}`)
  }
  vm.runInNewContext(code, {
    window: sandboxWindow, require: requireStub, document: makeDocumentStub(),
    // vm 的新 context 只有 ECMAScript 内建,没有 web API;插件用 URL 解析资源地址,
    // 浏览器里它恒存在(vm 沙箱不补就会把「解析失败」误报成插件缺陷)。
    URL, URLSearchParams,
  })
  expect(registrations).toHaveLength(1)
  expect(registrations[0]?.id).toBe('@eterna/adviser')
  const recorded: Recorded = {
    resources: [], tabTypes: [], injections: [], slots: [], dictionaries: {},
    commands: [], shortcuts: [], interactions: [], openedTabs: [],
  }
  const ctx = {
    locale: {
      register: (ns: string, dicts: Record<string, unknown>) => { recorded.dictionaries[ns] = dicts; return () => {} },
      bind: (ns: string) => (key: string) => `${ns}:${key}`,
    },
    slots: {
      inject: (slot: string, contribute: () => unknown) => {
        void contribute()
        recorded.injections.push(slot)
        return () => {}
      },
      register: (options: Recorded['slots'][number]['options'], component: unknown) => {
        recorded.slots.push({ options, component })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition: Recorded['tabTypes'][number]) => {
        recorded.tabTypes.push(definition)
        return () => {}
      },
    },
    // P7:导航控制器(命令/快捷键/选区都只通过它开 tab)。屏幕会话默认有一个,
    // 无会话场景由调用方临时清空(见 openTab 相关的用例)。
    sidebarRight: {
      openTab: (kind: string) => { recorded.openedTabs.push(kind) },
      mounted: { getSnapshot: () => 'session-screen' },
    },
    resources: {
      register: (provider: { protocol: string; open: unknown }) => {
        recorded.resources.push(provider)
        return () => {}
      },
    },
    sessions: { retain: () => ({ sessionId: 'x', release: () => {} }), refreshProjections: async () => {} },
    commandUi: {
      register: (contribution: Record<string, unknown>) => {
        recorded.commands.push(contribution)
        return () => {}
      },
    },
    shortcuts: {
      register: (command: Record<string, unknown>) => {
        recorded.shortcuts.push(command)
        return () => {}
      },
    },
    uiConversation: {
      interactions: {
        register: (definition: Record<string, unknown>) => {
          recorded.interactions.push(definition)
          return () => {}
        },
      },
    },
  }
  const exports = registrations[0]!.factory(requireStub)
  const apply = exports.apply as (ctx: unknown) => () => void
  const dispose = apply(ctx)
  expect(typeof dispose).toBe('function')
  // 撤销不应抛(资源/槽位/类型/字典/命令/快捷键/交互七层都要能干净卸载)。
  expect(() => { dispose() }).not.toThrow()
  return { exports, recorded }
}

describe('模块装载冒烟(vm)', () => {
  it('导出面:inject 九项 + 字典注册', () => {
    const { exports, recorded } = loadBundle()
    expect(exports.inject).toEqual([
      'slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'resources',
      'commandUi', 'shortcuts', 'uiConversation',
    ])
    expect(recorded.dictionaries['eterna-adviser']).toBeDefined()
  })

  it('资源提供者:注册 adviserchat 协议(刷新后恢复会话的唯一入口)', () => {
    const { recorded } = loadBundle()
    expect(recorded.resources).toHaveLength(1)
    expect(recorded.resources[0]?.protocol).toBe('adviserchat')
    expect(typeof recorded.resources[0]?.open).toBe('function')
  })

  it('tab 类型:资源地址 patterns + canOpen 只认参谋地址 + multiple 多开', () => {
    const { recorded } = loadBundle()
    expect(recorded.tabTypes).toHaveLength(1)
    const definition = recorded.tabTypes[0]!
    expect(definition.kind).toBe('adviser')
    expect(definition.id).toBe('@eterna/adviser/panel')
    expect(definition.priority).toBe('extension')
    expect(definition.multiple).toBe(true)
    expect(definition.keepMounted).toBe(true)
    expect(definition.patterns).toEqual([`${ADVISER_CHAT_ADDRESS}**`])
    expect(definition.canOpen?.(adviserChatAddress('m', 'c'))).toBe(true)
    expect(definition.canOpen?.('dsh-resource://subagentchat/session/c?parent=m&mode=continuable')).toBe(false)
    expect(definition.canOpen?.('sidebar://adviser')).toBe(false)
  })

  it('导引页入口:资源型类型必须声明 guide,否则用户无从打开参谋', () => {
    const { recorded } = loadBundle()
    const guide = recorded.tabTypes[0]?.guide
    expect(guide).toBeDefined()
    expect(guide).toHaveLength(1)
    expect(guide?.[0]?.id).toBe('open')
    // 标题/说明走字典(中文字面来自 locales,此处的 bind 是 ns:key 形态)。
    expect(guide?.[0]?.title()).toBe('eterna-adviser:guide.title')
    expect(guide?.[0]?.description?.()).toBe('eterna-adviser:guide.description')
  })

  it('body 与子槽位:body 在自己的 children 里声明会话子槽位', () => {
    const { recorded } = loadBundle()
    // 三个注入点:tab body 的席位、自己声明的会话子槽位、以及 P7 的选区浮层槽位。
    expect(recorded.injections).toEqual(['sidebar.right.pane.tab', CONVERSATION_SLOT, SELECTION_SLOT])
    const body = recorded.slots.find(slot => slot.options.name === 'sidebar.right.pane.tab')
    expect(body?.options.key).toBe('@eterna/adviser/panel')
    // 关键:声明 is 拿到 SessionProvider 席的唯一途径(ui-renderer standardKit)。
    expect(body?.options.children).toEqual({ [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } })
    expect(typeof body?.component).toBe('function')
    const conversation = recorded.slots.find(slot => slot.options.name === CONVERSATION_SLOT)
    expect(typeof conversation?.component).toBe('function')
  })

  it('全量 hooks 在装载期不抛(纯声明,无运行时依赖)', () => {
    // loadBundle 内部已调 apply + dispose;此处只需确认可重复装载两次不冲突
    // (两个独立的插件实例各自持有自己的资源/槽位记录)。
    expect(() => { loadBundle() }).not.toThrow()
    expect(() => { loadBundle() }).not.toThrow()
  })
})

// ── P7 三入口 ──────────────────────────────────────────────────────────────

describe('P7 三入口注册面', () => {
  it('斜杠命令:名字私有、action 变体、有屏幕会话才出现', () => {
    const { recorded } = loadBundle()
    expect(recorded.commands).toHaveLength(1)
    const command = recorded.commands[0] as {
      name: string
      available: (session: { sessionId: string }) => boolean
      ui: { kind: string; run: (session: { sessionId: string }) => void }
      label: () => string
      description: () => string
    }
    // 命令名不能与宿主命令重名(上游在候选合成阶段显式抛错),故用私有名。
    expect(command.name).toBe(ADVISER_COMMAND_NAME)
    expect(command.name).toBe('adviser')
    expect(command.ui.kind).toBe('action')
    expect(command.label()).toBe('eterna-adviser:command.label')
    expect(command.description()).toBe('eterna-adviser:command.description')
    // 当前屏幕会话在 → 菜单出现。
    expect(command.available({ sessionId: 's1' })).toBe(true)
  })

  it('斜杠命令执行 → 按 kind 打开参谋面板 tab', () => {
    const { recorded } = loadBundle()
    const command = recorded.commands[0] as {
      ui: { run: (session: { sessionId: string }) => void }
    }
    command.ui.run({ sessionId: 'session-screen' })
    expect(recorded.openedTabs).toEqual([ADVISER_TAB_KIND])
    expect(ADVISER_TAB_KIND).toBe('adviser')
  })

  it('快捷键:⌥⌘J 六平台默认、输入框内也生效、run 才开 tab', () => {
    const { recorded } = loadBundle()
    expect(recorded.shortcuts).toHaveLength(1)
    const shortcut = recorded.shortcuts[0] as {
      id: string
      defaults: Record<string, { code: string; modifiers: readonly string[] }>
      regions: readonly string[]
      resolve: (context: { region: string; target: null }) => { status: string; reason?: string; run?: () => void }
      label: () => string
    }
    expect(shortcut.id).toBe('@eterna/adviser/open')
    expect(shortcut.label()).toBe('eterna-adviser:shortcut.label')
    // 六个 profile 都要有默认绑定(desktop/web × macos/windows/linux)。
    expect(Object.keys(shortcut.defaults).sort()).toEqual([
      'desktop:linux', 'desktop:macos', 'desktop:windows',
      'web:linux', 'web:macos', 'web:windows',
    ])
    for (const binding of Object.values(shortcut.defaults)) {
      expect(binding.code).toBe(ADVISER_SHORTCUT_CODE)
      expect(binding.modifiers).toEqual(['primary', 'alt'])
    }
    // 输入框内也要能唤起(用户常常正打着字才想到要问参谋)。
    expect(shortcut.regions).toContain('editable')
    expect(shortcut.regions).toContain('page')
    // 有会话 → handled,且 run 才真正开 tab(解析必须同步,副作用放 run)。
    const resolved = shortcut.resolve({ region: 'page', target: null })
    expect(resolved.status).toBe('handled')
    resolved.run?.()
    expect(recorded.openedTabs).toEqual([ADVISER_TAB_KIND])
  })

  it('选中文字:交互 id 与浮层槽位 key 一致(否则 open() 渲染不出东西)', () => {
    const { recorded } = loadBundle()
    expect(recorded.interactions).toHaveLength(1)
    expect((recorded.interactions[0] as { id: string }).id).toBe(ADVISER_SELECTION_ID)
    const selection = recorded.slots.find(slot => slot.options.name === SELECTION_SLOT)
    // 上游按 id 选键控条目:两者不一致就等于注册了一个永不渲染的表面。
    expect(selection?.options.key).toBe(ADVISER_SELECTION_ID)
    expect(typeof selection?.component).toBe('function')
  })

  it('选中文字:只认 selection 触发且有选区,命中才 open()', () => {
    const { recorded } = loadBundle()
    const interaction = recorded.interactions[0] as {
      onInteraction: (request: {
        trigger: string
        hasSelection: boolean
        sessionId: string
        readText: () => string | null
        open: () => void
      }) => void
    }
    const calls: string[] = []
    const base = { sessionId: 'session-screen', readText: () => 'x', open: () => { calls.push('open') } }
    // 右键菜单不是本功能的语义。
    interaction.onInteraction({ ...base, trigger: 'contextmenu', hasSelection: true })
    // 空选区不弹。
    interaction.onInteraction({ ...base, trigger: 'selection', hasSelection: false })
    expect(calls).toEqual([])
    interaction.onInteraction({ ...base, trigger: 'selection', hasSelection: true })
    expect(calls).toEqual(['open'])
  })
})

// ── 选区到首条上下文(纯逻辑)─────────────────────────────────────────────────

describe('待用选区(模块级一次性通道)', () => {
  it('记住后取一次即清(下次开参谋不带旧选区)', async () => {
    const { rememberSelection, takePendingSelection } = await import('../src/client/entries.ts')
    rememberSelection('这段文字')
    expect(takePendingSelection()).toBe('这段文字')
    expect(takePendingSelection()).toBeUndefined()
  })

  it('空白文本视为没有选区', async () => {
    const { rememberSelection, takePendingSelection } = await import('../src/client/entries.ts')
    rememberSelection('   \n  ')
    expect(takePendingSelection()).toBeUndefined()
    rememberSelection(undefined)
    expect(takePendingSelection()).toBeUndefined()
  })

  it('两端裁空白(选区边界常带换行)', async () => {
    const { rememberSelection, takePendingSelection } = await import('../src/client/entries.ts')
    rememberSelection('\n  要点一\n  ')
    expect(takePendingSelection()).toBe('要点一')
  })
})
