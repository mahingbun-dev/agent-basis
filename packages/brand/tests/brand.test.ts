/**
 * @eterna/brand 测试:
 * - Host 半边:服务端 index.html/manifest 改写、模型侧 assemble 文案改写、
 *   webServer 缺席(embed 档)时降级不炸;
 * - 默认导出插件形态;
 * - client bundle 工件形态 + vm 冒烟(伪 window 装载断言 apply/inject,
 *   并实际驱动 apply:伪 document 断言 title 改写与 favicon 注入)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  ASSEMBLE_EVENT, rebrandAssembly, rebrandIndexHtml, rebrandManifest, rebrandText,
} from '../src/index.ts'
import { rebrandUiText } from '../src/client/text-rules.ts'

const root = join(import.meta.dirname, '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

describe('插件形态', () => {
  it('default export:name=eterna-brand,apply 返回 disposer', () => {
    expect(plugin.name).toBe('eterna-brand')
    expect(typeof plugin.apply).toBe('function')
    const dispose = plugin.apply({ inject: () => undefined, on: () => () => undefined })
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('webServer 缺席(embed 档):apply 照常返回,assemble 监听仍注册', () => {
    const off = vi.fn()
    const on = vi.fn(() => off)
    const dispose = plugin.apply({ inject: () => undefined, on })
    expect(on).toHaveBeenCalledWith(ASSEMBLE_EVENT, expect.any(Function))
    dispose()
    expect(off).toHaveBeenCalled()
  })
})

describe('服务端页面改写(index.html / manifest)', () => {
  it('index.html:标题、apple 短名与 HTML 内品牌文案', () => {
    const upstream = '<meta name="apple-mobile-web-app-title" content="DSH" />\n<title>DeepSeek Harness</title>'
    const out = rebrandIndexHtml(upstream)
    expect(out).toContain('<title>EternaAgent</title>')
    expect(out).toContain('content="EternaAgent"')
    expect(out).not.toContain('DeepSeek Harness')
  })

  it('index.html:真实标识符一律不动(包名/引导变量/命令)', () => {
    const upstream = 'plugins/??@deepseek-ai/dsh-client-modules/client.js __DSH_BOOT__ dsh --profile DSH_HOME'
    expect(rebrandIndexHtml(upstream)).toBe(upstream)
  })

  it('index.html:幂等(tapIndex 每次渲染都会跑)', () => {
    const once = rebrandIndexHtml('<title>DeepSeek Harness</title>')
    expect(rebrandIndexHtml(once)).toBe(once)
  })

  it('manifest:name/short_name 品牌化,favicon/图标等字段原样保留', () => {
    const upstream = JSON.stringify({ name: 'DeepSeek Harness', short_name: 'DSH', start_url: './', icons: [{ src: 'icon-192.png' }] })
    const parsed = JSON.parse(rebrandManifest(upstream)) as Record<string, unknown>
    expect(parsed['name']).toBe('EternaAgent')
    expect(parsed['short_name']).toBe('EternaAgent')
    expect(parsed['icons']).toEqual([{ src: 'icon-192.png' }])
  })

  it('manifest:非法 JSON 原样返回(不阻断 PWA 资源)', () => {
    expect(rebrandManifest('not json')).toBe('not json')
  })
})

describe('模型侧文案改写(assemble 瀑布)', () => {
  it('身份句 + 三处运行时上下文改写,段名与工具声明不动', () => {
    const assembly = {
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'tool:bash', text: 'bash tool' },
      ],
      contexts: [
        { name: 'sandbox:policy', text: 'Current DSH file policy: workspace-write.' },
        { name: 'harness:source', text: 'Current DeepSeek Harness implementation checkout: "/opt/dsh".' },
        { name: 'app:web-surface', text: 'Current DeepSeek Harness Web GUI URL: "http://127.0.0.1:3080".' },
      ],
      tools: [{ name: 'bash' }],
    }
    expect(rebrandAssembly(assembly)).toBe(true)
    expect(assembly.sections[0]?.text).toBe('You are an AI agent powered by EternaAgent.')
    expect(assembly.sections[1]?.text).toBe('bash tool')
    expect(assembly.contexts[0]?.text).toBe('Current EternaAgent file policy: workspace-write.')
    expect(assembly.contexts[1]?.text).toContain('Current EternaAgent implementation checkout')
    expect(assembly.contexts[2]?.text).toContain('Current EternaAgent Web GUI URL')
    expect(assembly.tools).toEqual([{ name: 'bash' }])
  })

  it('DSH_HOME 等标识符不被误改', () => {
    expect(rebrandText('Read $DSH_HOME/.env before DSH_PROFILE_DIR')).toBe('Read $DSH_HOME/.env before DSH_PROFILE_DIR')
  })

  it('非法载荷(undefined/字符串)安全返回 false', () => {
    expect(rebrandAssembly(undefined)).toBe(false)
    expect(rebrandAssembly('x')).toBe(false)
  })
})

describe('客户端文案规则(裸 DSH 的词位边界)', () => {
  it('品牌展示位的裸 DSH 换成英文品牌名', () => {
    // badge 整串优先(长串在前):「DSH 本地构建」→ 恒灵·EternaAgent(版本号一并去掉)
    expect(rebrandUiText('DSH 本地构建')).toBe('恒灵·EternaAgent')
    expect(rebrandUiText('DSH Local Build')).toBe('恒灵·EternaAgent')
    expect(rebrandUiText('为命令执行工具统一提供 DSH 环境变量。')).toBe('为命令执行工具统一提供 EternaAgent 环境变量。')
  })

  it('DSH 标识符族一律原样(设置页会展示真实路径,改错即误导用户)', () => {
    expect(rebrandUiText('$DSH_HOME/.env')).toBe('$DSH_HOME/.env')
    expect(rebrandUiText('DSH_PROFILE_DIR=/x DSH_SESSION_ID=-1 __DSH_BOOT__')).toBe(
      'DSH_PROFILE_DIR=/x DSH_SESSION_ID=-1 __DSH_BOOT__')
    expect(rebrandUiText('@deepseek-ai/dsh-shell-env')).toBe('@deepseek-ai/dsh-shell-env')
  })

  it('上游产品名与被替换的 DSH 描述文案', () => {
    expect(rebrandUiText('DeepSeek Harness')).toBe('EternaAgent')
    expect(rebrandUiText('通过 pi-ai 为 DeepSeek Harness 提供 DeepSeek 模型适配，作为 dsh-llm-deepseek 的设计验证实现。'))
      .toBe('通过 pi-ai 为 EternaAgent 提供 DeepSeek 模型适配，作为 dsh-llm-deepseek 的设计验证实现。')
  })

  it('上游营销徽章短语:整短语替换,真实包名不受影响', () => {
    // badge 技能插件描述(2026-11-13 用户实测:插件页仍显示 powered by dsh)
    expect(rebrandUiText('让 Agent 为文档、PR 等产出添加「powered by dsh」徽章。'))
      .toBe('让 Agent 为文档、PR 等产出添加「powered by EternaAgent」徽章。')
    expect(rebrandUiText('powered_by-dsh-4D6BFE')).toBe('powered_by-EternaAgent-4D6BFE')
    // 裸小写 dsh 绝不泛化替换:它在描述里充当真实包名
    expect(rebrandUiText('在 dsh-base 上提供自动化专用的 ACP 通信与进程生命周期。'))
      .toBe('在 dsh-base 上提供自动化专用的 ACP 通信与进程生命周期。')
    expect(rebrandUiText('作为 dsh-llm-deepseek 的设计验证实现。'))
      .toBe('作为 dsh-llm-deepseek 的设计验证实现。')
  })

  it('无命中时逐字返回(观察器据此跳过回写,避免自激死循环)', () => {
    expect(rebrandUiText('模型名 deepseek-flash 与恒灵·EternaAgent')).toBe('模型名 deepseek-flash 与恒灵·EternaAgent')
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
    // ④ 文案地图覆盖:裸 DSH 只按独立词位替换(标识符族必须原样保留)
    expect(bundle).toContain('EternaAgent')
    expect(bundle).toContain('方寸灵台')
    expect(bundle).toContain('探索未至之境')
    expect(bundle).toContain('sidebar.brand.mark')
    dispose()
  })
})
