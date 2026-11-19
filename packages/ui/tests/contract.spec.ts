/**
 * v4 设计系统契约测试。
 *
 * 这里守的是「机器可判」的四条，人工视觉自查见 42 号 §11：
 * 1. 桥接引用的每个 `--dsw-alias-*` 必须真实存在于上游（宿主 CSS 引用 ∪
 *    主题插件定义）。v3 曾出现 9 个上游不存在的名字，界面静默跑在兜底色。
 * 2. 组件 CSS 引用的每个 `--et-*` 必须在桥接模式下有定义——否则取不到值，
 *    阴影/软底会退回浏览器默认或另一主题的值（实测撞到过）。
 * 3. 圆角只允许阶梯值；z-index 只允许 1–40 局部层与 100/200/1000/1100/1500。
 * 4. 品牌层与桥接层不得互相污染：别名覆盖只能落在 body，插件面只做映射
 *    （否则深色主题下插件面自持浅色）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSH_BRIDGE_CSS, WEBFLOW_TOKENS_CSS } from '../src/tokens.ts'
import { COMPONENT_CSS } from '../src/components-css.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const pnpmDir = join(repoRoot, 'node_modules/.pnpm')
const tokensSource = readFileSync(join(here, '../src/tokens.ts'), 'utf8')

/** 桥接模式实际下发的全部 CSS（注入器拼的三段：SHARED + 桥接 + 基础件）。 */
const BRIDGE_MODE_CSS = `${tokensSource.slice(tokensSource.indexOf('const SHARED = `'))}\n${DSH_BRIDGE_CSS}\n${COMPONENT_CSS}`

/**
 * pnpm 的目录名用 `+` 作作用域分隔符
 * （`@deepseek-ai+dsh-client-ui-theme@0.2.2-rc.1_...`），不是 `@scope/name` 的 `/`。
 * 写错分隔符会让 `startsWith` 永远不命中，函数静默少半张表——本次实测就是
 * 这样丢了主题插件的 114 个别名，只剩宿主 CSS 的 56 个。
 */
const FRONTEND_PKG = '@deepseek-ai+dsh-web-frontend@'
const THEME_PKG = '@deepseek-ai+dsh-client-ui-theme@'

/** 断言两个上游包都在（缺失时显式失败，不许静默降级成"表变小但通过"）。 */
function upstreamPackages(): { frontend: string; theme: string } {
  const entries = readdirSync(pnpmDir)
  const frontend = entries.find(name => name.startsWith(FRONTEND_PKG))
  const theme = entries.find(name => name.startsWith(THEME_PKG))
  if (frontend === undefined || theme === undefined) {
    throw new Error(`pnpm 目录里缺少上游包（${pnpmDir}，共 ${entries.length} 个条目；`
      + `frontend=${frontend === undefined ? '缺失' : 'ok'}, theme=${theme === undefined ? '缺失' : 'ok'}）`)
  }
  return { frontend, theme }
}

function frontendAssets(frontend: string): string {
  return join(pnpmDir, frontend, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
}

/** 上游真实存在的 `--dsw-alias-*` 名字（去掉前缀）：宿主 CSS 引用 ∪ 主题插件定义。 */
function upstreamAliases(): Set<string> {
  const { frontend, theme } = upstreamPackages()
  const names = new Set<string>()

  const assets = frontendAssets(frontend)
  for (const file of readdirSync(assets)) {
    if (!file.endsWith('.css')) continue
    for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/--dsw-alias-([a-z0-9-]+)/gu)) {
      names.add(match[1]!)
    }
  }

  const themeSource = readFileSync(
    join(pnpmDir, theme, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
  for (const match of themeSource.matchAll(/--dsw-alias-([a-z0-9-]+)\s*:/gu)) names.add(match[1]!)

  return names
}

/** 在指定 CSS 文本里出现过的 `--et-*` 名字。 */
function definedEtTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/--et-[a-z0-9-]+/gu)].map(match => match[0]))
}

describe('桥接层：上游别名必须真实存在', () => {
  it('引用的每个 --dsw-alias-* 都能在上游找到', () => {
    const upstream = upstreamAliases()
    // 主题插件 114 + 宿主独有 2；低于 100 说明某一来源没读到
    expect(upstream.size, 'upstream 别名表过小：某一来源未读到').toBeGreaterThan(100)

    const referenced = [...DSH_BRIDGE_CSS.matchAll(/--dsw-alias-([a-z0-9-]+)/gu)].map(m => m[1]!)
    const invalid = [...new Set(referenced)].filter(name => !upstream.has(name))
    expect(invalid, `上游不存在的别名: ${invalid.join(', ')}`).toEqual([])
  })

  it('宿主实际使用的别名全部被覆盖（否则壳仍残留旧色）', () => {
    const { frontend, theme } = upstreamPackages()
    const covered = new Set([...DSH_BRIDGE_CSS.matchAll(/--dsw-alias-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
    const used = new Set<string>()
    const assets = frontendAssets(frontend)
    for (const file of readdirSync(assets)) {
      if (!file.endsWith('.css')) continue
      for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/var\(--dsw-alias-([a-z0-9-]+)/gu)) {
        used.add(match[1]!)
      }
    }
    // 主题插件把一批别名定义在 client.js 里（不在 CSS 资产），宿主组件照样按名取值：
    // 漏了 --dsw-alias-button-info-fill 的后果是发/送按钮一直是电光蓝（2026-11-19 生产实测）。
    const themeSource = readFileSync(
      join(pnpmDir, theme, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
    for (const match of themeSource.matchAll(/var\(--dsw-alias-([a-z0-9-]+)/gu)) used.add(match[1]!)
    for (const match of themeSource.matchAll(/--dsw-alias-([a-z0-9-]+)\s*:/gu)) used.add(match[1]!)

    const missing = [...used].filter(name => !covered.has(name))
    expect(missing, `宿主在用但未覆盖的别名: ${missing.join(', ')}`).toEqual([])
  })

  it('静态色板被整体重映射（未来新增别名也不会漏出冷白/电光蓝）', () => {
    // 别名只是指针，真颜色在 --dsw-static-*。上游色板里任何一处纯白/纯黑/
    // 高饱和蓝漏进暖玉界面，都是肉眼可见的破面。
    const { theme } = upstreamPackages()
    const themeSource = readFileSync(
      join(pnpmDir, theme, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')

    const upstreamStatic = new Set([...themeSource.matchAll(/--dsw-static-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
    expect(upstreamStatic.size, '上游 --dsw-static-* 表过小：主题插件源未读到').toBeGreaterThan(50)

    const remapped = new Set([...DSH_BRIDGE_CSS.matchAll(/--dsw-static-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
    const missing = [...upstreamStatic].filter(name => !remapped.has(name))
    expect(missing, `未重映射的静态色板: ${missing.join(', ')}`).toEqual([])

    // 重映射后的值不得再是纯白/纯黑或上游那支电光蓝。
    const blocks = [...DSH_BRIDGE_CSS.matchAll(/--dsw-static-([a-z0-9-]+)\s*:\s*([^;]+);/gu)]
    const forbidden = blocks.filter(([, value]) => {
      const v = value!.trim().toLowerCase()
      if (v === '#fff' || v === '#ffffff' || v === '#000' || v === '#000000') return true
      // 上游电光蓝族（deepseek-500 系）与纯浏览器蓝
      return /^(#4176e6|#3b82f6|#2563eb|#60a5fa)$/u.test(v)
    })
    expect(forbidden.map(([n, v]) => `${n}=${v}`), '静态色板里仍有纯白/纯黑/电光蓝').toEqual([])
  })

  it('静态色板只映射一次，深浅共用（不得在深色块里再翻一遍）', () => {
    // 实测(2026-11-19 生产 0.1.37)：宿主 ui-theme 的 82 个 --dsw-static-* 在
    // 浅色块与 body[data-ds-dark-theme] 块里**取值完全相同**——它是固定色板，
    // 主题差异全在语义层（比如 sidebar-fill 浅色指 bluish-50、深色指 bluish-900）。
    // 所以在深色块里再写一套"反向阶梯"是错的：它把 bluish-900（深色侧栏底）
    // 翻成亮色，侧栏白底亮字，深色界面直接塌掉。
    const blocks = [...DSH_BRIDGE_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .filter(([, , body]) => /--dsw-static-[a-z0-9-]+\s*:/u.test(body!))
    expect(blocks.length, '静态色板被分散到多个块：应当只映射一次').toBe(1)

    const selector = blocks[0]![1]!.replace(/\/\*[\s\S]*?\*\//gu, '').trim()
    expect(/^html body$/u.test(selector), `静态色板落在了非浅色根选择器: ${selector}`).toBe(true)
  })

  it('--dsw-specific-* 专用令牌全部被覆盖（侧栏/气泡/菜单不漏冷白）', () => {
    // 侧栏读 --dsw-specific-sidebar-fill，气泡读 --dsw-specific-bubble；
    // 这族不在 --dsw-alias-* 里，只补别名会漏掉整个侧栏（2026-11-19 生产实测：
    // 深色下侧栏仍是 rgb(236,238,233) 亮底，亮字压亮底不可读）。
    const { theme } = upstreamPackages()
    const themeSource = readFileSync(
      join(pnpmDir, theme, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')

    const upstreamSpecific = new Set(
      [...themeSource.matchAll(/--dsw-specific-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
    expect(upstreamSpecific.size, '上游 --dsw-specific-* 表过小：主题插件源未读到')
      .toBeGreaterThan(5)

    // 深浅两侧都要覆盖面；只覆盖浅色会在深色下退回宿主冷白/亮底。
    const lightBlock = DSH_BRIDGE_CSS.slice(0, DSH_BRIDGE_CSS.indexOf("[data-eterna-theme='dark']"))
    const darkStart = DSH_BRIDGE_CSS.indexOf('body[data-ds-dark-theme]')
    const darkBlock = DSH_BRIDGE_CSS.slice(darkStart)

    for (const [label, block] of [['浅色', lightBlock], ['深色', darkBlock]] as const) {
      const covered = new Set([...block.matchAll(/--dsw-specific-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
      const missing = [...upstreamSpecific].filter(name => !covered.has(name))
      expect(missing, `${label}侧未覆盖的 --dsw-specific-*: ${missing.join(', ')}`).toEqual([])
    }
  })
})

describe('组件 CSS：令牌引用必须可解析', () => {
  it('COMPONENT_CSS 只引用桥接模式下有定义的 --et-*', () => {
    const defined = definedEtTokens(BRIDGE_MODE_CSS)
    const referenced = [...COMPONENT_CSS.matchAll(/var\((--et-[a-z0-9-]+)/gu)].map(m => m[1]!)
    const missing = [...new Set(referenced)].filter(name => !defined.has(name))
    expect(missing, `桥接模式下未定义的令牌: ${missing.join(', ')}`).toEqual([])
  })

  it('COMPONENT_CSS 内不出现字面色值与字面圆角', () => {
    expect(COMPONENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    expect(COMPONENT_CSS).not.toMatch(/\b(rgba?|hsla?)\(/u)
  })
})

describe('容器组件必须自带文字基线', () => {
  // 深色下实测：决策卡未声明 color 时标题继承浏览器默认纯黑，在墨玉底上不可读。
  const CONTAINERS = ['et-card', 'et-decision-card', 'et-row'] as const
  for (const cls of CONTAINERS) {
    it(`.${cls} 声明 color / font-size / 行高`, () => {
      const index = COMPONENT_CSS.indexOf(`.${cls} {`)
      expect(index, `找不到 .${cls} 的规则`).toBeGreaterThan(-1)
      const rule = COMPONENT_CSS.slice(index, COMPONENT_CSS.indexOf('}', index))
      expect(rule, `.${cls} 缺 color`).toContain('color: var(--et-fg)')
      expect(rule, `.${cls} 缺字号`).toContain('font-size: var(--et-text-body)')
      expect(rule, `.${cls} 缺行高`).toContain('line-height: var(--et-leading-body)')
    })
  }

  it('文字基线用令牌，不写死具体颜色', () => {
    for (const cls of CONTAINERS) {
      const index = COMPONENT_CSS.indexOf(`.${cls} {`)
      const rule = COMPONENT_CSS.slice(index, COMPONENT_CSS.indexOf('}', index))
      expect(rule).not.toMatch(/color:\s*#[0-9a-fA-F]/u)
    }
  })
})

describe('圆角与层级：只允许阶梯值', () => {
  const LADDER = new Set([0, 8, 12, 16, 22, 28, 36, 9999])
  const Z_PAGE = new Set([100, 200, 1000, 1100, 1500])

  it('COMPONENT_CSS 的 border-radius 取阶梯值', () => {
    const values = [...COMPONENT_CSS.matchAll(/border-radius:\s*([0-9]+)px/gu)].map(m => Number(m[1]))
    expect(values.filter(v => !LADDER.has(v))).toEqual([])
  })

  it('COMPONENT_CSS 的 z-index 只在 1–40 或页级白名单', () => {
    const values = [...COMPONENT_CSS.matchAll(/z-index:\s*([0-9]+)/gu)].map(m => Number(m[1]))
    expect(values.filter(v => v > 40 && !Z_PAGE.has(v))).toEqual([])
  })

  it('决策层固定在 200（贴输入卡，低于宿主 toast 1100）', () => {
    const layer = COMPONENT_CSS.slice(COMPONENT_CSS.indexOf('.et-decision-layer'))
    expect(layer.slice(0, 200)).toContain('z-index: 200')
  })
})

describe('品牌层与桥接层互不污染', () => {
  it('别名覆盖只落在 body，不挂到插件面元素', () => {
    // 一旦把 --dsw-alias-* 定义到 [data-eterna-ui]，插件面会自持浅色别名；深色主题失效。
    const aliasBlocks = [...DSH_BRIDGE_CSS.matchAll(/([^{}]+)\{[^{}]*--dsw-alias-[a-z0-9-]+\s*:/gu)]
      .map(m => m[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').trim())
    expect(aliasBlocks.length).toBeGreaterThan(0)
    for (const selector of aliasBlocks) {
      for (const part of selector.split(',')) {
        expect(part.includes('body'), `别名覆盖落到了非 body 选择器: ${selector}`).toBe(true)
        // 宿主主题插件也在 body 上定义同一批别名且后注入——必须比它重一档。
        // 只写 body 会被冲成宿主冷白（2026-11-19 生产实测 #fff）。
        expect(/^html body/u.test(part.trim()), `别名覆盖权重不足，会被宿主覆盖: ${part}`).toBe(true)
      }
    }
  })

  it('插件面映射块（--et-*）带浅色兜底，独立挂载也能显示', () => {
    const mappingBlock = DSH_BRIDGE_CSS.slice(DSH_BRIDGE_CSS.indexOf('/* 品牌层映射'))
    expect(mappingBlock).toContain('var(--dsw-alias-bg-base, #f4f2ec)')
  })

  it('品牌层深色只在 data-eterna-theme 或系统偏好下生效（不污染产品壳）', () => {
    expect(WEBFLOW_TOKENS_CSS).toContain("[data-eterna-theme='dark']")
    expect(WEBFLOW_TOKENS_CSS).toContain(":root:not([data-eterna-theme='light'])")
  })
})

describe('共享基础件必须在应用内真实生效', () => {
  // 实测事故：COMPONENT_CSS 的 .et-* 全部限定在 [data-eterna-ui]，但全仓没有
  // 任何组件设置该属性——生产环境玉环渲染成 SVG 默认黑盘、按钮/决策卡零样式。
  // 探针页手动加了属性才「验证通过」，是假绿。注入器必须自己落标记。
  const source = readFileSync(join(here, '../src/tokens.ts'), 'utf8')

  it('桥接模式在 body 上落下作用域标识，并在 disposer 里移除', () => {
    expect(source).toContain("body.setAttribute('data-eterna-ui', '')")
    expect(source).toContain("body.removeAttribute('data-eterna-ui')")
    expect(source).toMatch(/options\.bridge === true/u)
  })

  it('作用域标识只在应用内（桥接模式）设置，独立页不受影响', () => {
    const anchor = source.indexOf("body.setAttribute('data-eterna-ui'")
    const setter = source.slice(anchor, anchor + 200)
    expect(setter).not.toContain('WEBFLOW')
  })

  it('把组件类限定在作用域内是有意为之：根节点必须能承接该标识', () => {
    // 组件的选择器前缀统一，才能被 body 上的单一标识覆盖。
    // 跳过 @media/@keyframes 容器与 keyframes 内的百分比步骤选择器。
    const selectors: string[] = []
    let inAtRule = 0
    for (const match of COMPONENT_CSS.matchAll(/([^{}]+)\{/gu)) {
      const selector = match[1]!.trim()
      if (selector.startsWith('@')) { inAtRule += 1; continue }
      if (inAtRule > 0 && /^[0-9]+(%|\b)/u.test(selector)) continue
      selectors.push(selector)
    }
    const unscoped = selectors.filter(selector => selector !== '' && !selector.includes('[data-eterna-ui]'))
    expect(unscoped, `未限定作用域的组件规则: ${unscoped.slice(0, 5).join(' | ')}`).toEqual([])
  })
})

describe('入口分层：根入口必须服务端安全', () => {
  // 实测事故：根 index.ts 导出 .tsx（components/decision-layer）后，
  // @eterna/access 在服务端 import 阶段抛 ERR_UNKNOWN_FILE_EXTENSION
  // （宿主 Loader 是 strip-only TS），整行 enabled/no-fiber，G1-1 门禁红。
  const indexPath = join(here, '../src/index.ts')
  const indexSource = readFileSync(indexPath, 'utf8')

  it('根入口只引用 .ts，不得出现 .tsx', () => {
    const imports = [...indexSource.matchAll(/from '(\.[^']+)'/gu)].map(m => m[1]!)
    expect(imports.length).toBeGreaterThan(0)
    const tsx = imports.filter(path => path.endsWith('.tsx'))
    expect(tsx, `根入口引入了 .tsx：${tsx.join(', ')}`).toEqual([])
  })

  it('React 基础件从 /react 子路径导出（不是根入口）', () => {
    const reactSource = readFileSync(join(here, '../src/react.ts'), 'utf8')
    expect(reactSource).toContain("from './components.tsx'")
    expect(reactSource).toContain("from './decision-layer.tsx'")
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { exports: Record<string, string> }
    expect(pkg.exports['./react']).toBe('./src/react.ts')
    // 服务端也可以只取令牌（SSR 页面不必拖上整个根面）
    expect(pkg.exports['./tokens']).toBe('./src/tokens.ts')
    expect(pkg.exports['.']).toBe('./src/index.ts')
  })

  it('根入口仍导出服务端需要的令牌与注入器', () => {
    for (const name of ['WEBFLOW_TOKENS_CSS', 'DSH_BRIDGE_CSS', 'injectDesignTokens', 'COMPONENT_CSS']) {
      expect(indexSource).toContain(name)
    }
  })
})

describe('规范约束：不新建 toast 系统', () => {
  it('组件层不导出 Toast（应用内一律走宿主原子）', async () => {
    const reactEntry = await import('../src/react.ts')
    expect('Toast' in reactEntry).toBe(false)
  })

  it('组件 CSS 不含 toast 相关类', () => {
    expect(COMPONENT_CSS).not.toMatch(/\.et-toast/u)
  })
})
