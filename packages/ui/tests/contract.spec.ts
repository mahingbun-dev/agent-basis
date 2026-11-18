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
    const { frontend } = upstreamPackages()
    const covered = new Set([...DSH_BRIDGE_CSS.matchAll(/--dsw-alias-([a-z0-9-]+)\s*:/gu)].map(m => m[1]!))
    const assets = frontendAssets(frontend)
    const used = new Set<string>()
    for (const file of readdirSync(assets)) {
      if (!file.endsWith('.css')) continue
      for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/var\(--dsw-alias-([a-z0-9-]+)/gu)) {
        used.add(match[1]!)
      }
    }
    const missing = [...used].filter(name => !covered.has(name))
    expect(missing, `宿主在用但未覆盖的别名: ${missing.join(', ')}`).toEqual([])
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

describe('规范约束：不新建 toast 系统', () => {
  it('组件层不导出 Toast（应用内一律走宿主原子）', async () => {
    const index = await import('../src/index.ts')
    expect('Toast' in index).toBe(false)
  })

  it('组件 CSS 不含 toast 相关类', () => {
    expect(COMPONENT_CSS).not.toMatch(/\.et-toast/u)
  })
})
