/**
 * T6/T7 新增组件状态点 × --et-* 令牌对照断言(38 号 T14 深浅主题自查的机器半;
 * 与 G0-2 `node scripts/lint-ui-tokens.mjs` 同源——真值源为包根
 * theme-state-points.json,两处门禁不得各自为政)。
 *
 * 断言面:
 * 1. 清单卫生:期望令牌必须已在 packages/ui/src/tokens.ts 定义(清单自身禁猜令牌,
 *   design-tokens §2「新增桥接前必须先在上游确认令牌存在;禁止猜测名称」同款纪律);
 * 2. 状态点词汇表同源:T6 侧栏状态点沿用 T8 看板已落地的
 *   [data-eterna-workbench-dot='*'] 词汇表(styles.ts:132-140,原型 03 全原型
 *   统一词汇表),逐状态断言其 CSS 块取色与清单一致;
 * 3. 组件状态点核对:TaskSidebar/AttentionBanner 落地后,每个 enforce=true 状态点
 *   的期望令牌必须出现在其组件源码(文件级 ⊇ 状态级);未落地 → skip(pending,
 *   由 G0-2 报告可见),不伪造通过;
 * 4. 组件文件禁字面色值(frontend-style §1-1:十六进制只允许在 ui/src/tokens.ts);
 * 5. 横切项:DSH 桥接 / focus 光圈 / prefers-reduced-motion / 三断点。
 *
 * 人工半(逐状态点浅/深截图对照与断点自查)见
 * docs/design/reviews/2026-11-18-workbench-t6t7-theme-checklist.md。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_CSS } from '../src/client/styles.ts'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKENS_TS = readFileSync(join(PKG_ROOT, '../ui/src/tokens.ts'), 'utf8')

/** tokens.ts 中定义的 --et-* 令牌集合(与 G0-2 同口径:`--et-x:` 声明面)。 */
const definedTokens = new Set(
  [...TOKENS_TS.matchAll(/(--et-[a-z0-9-]+)\s*:/gu)].map(match => match[1]),
)

type StatePoint = {
  readonly id: string
  readonly label: string
  readonly prototypeClass?: string
  readonly expectedTokens: readonly string[]
  readonly selectorHints?: readonly string[]
  readonly anchorChecks?: readonly {
    readonly anchor: string
    readonly expectedTokens: readonly string[]
    readonly note?: string
  }[]
  readonly enforce?: boolean
  readonly note?: string
}
type ComponentSpec = {
  readonly id: string
  readonly label: string
  readonly prototype: string
  readonly files: readonly string[]
  readonly states: readonly StatePoint[]
}
type CrossCutting = {
  readonly id: string
  readonly label: string
  readonly expect: string
  readonly files?: readonly string[]
  readonly pattern?: string
  readonly patterns?: readonly string[]
  readonly enforce?: boolean
}
const manifest = JSON.parse(
  readFileSync(join(PKG_ROOT, 'theme-state-points.json'), 'utf8'),
) as {
  readonly meta: { readonly 依据: readonly string[] }
  readonly components: readonly ComponentSpec[]
  readonly crossCutting: readonly CrossCutting[]
}

/** 组件包内相对路径 → 绝对路径;存在才读(未落地走 pending)。 */
function componentSource(component: ComponentSpec): string | null {
  const paths = component.files.map(file => join(PKG_ROOT, file))
  if (paths.some(path => !exists(path))) return null
  return paths.map(path => readFileSync(path, 'utf8')).join('\n')
}
function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}
/** CSS 块令牌提取:按选择器全文找块体,取其中 var(--et-*) 引用。 */
function cssBlockTokens(css: string, selectorIncludes: string): Set<string> {
  const index = css.indexOf(selectorIncludes)
  if (index < 0) return new Set()
  const open = css.indexOf('{', index)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return new Set()
  return new Set([...css.slice(open, close).matchAll(/--et-[a-z0-9-]+/gu)].map(match => match[0]))
}
function tokensIn(source: string): Set<string> {
  return new Set([...source.matchAll(/--et-[a-z0-9-]+/gu)].map(match => match[0]))
}

describe('清单卫生(theme-state-points.json 自身)', () => {
  it('每个 enforce=true 状态点的期望令牌都在 tokens.ts 定义(禁猜令牌)', () => {
    for (const component of manifest.components) {
      for (const state of component.states) {
        if (state.enforce !== true) continue
        for (const token of state.expectedTokens) {
          expect(definedTokens.has(token), `${component.id}.${state.id} 期望 ${token}`).toBe(true)
        }
      }
    }
  })

  it('状态点 id 唯一、期望令牌非空(enforce=true 者必须给期望令牌)', () => {
    const ids: string[] = []
    for (const component of manifest.components) {
      for (const state of component.states) {
        ids.push(`${component.id}.${state.id}`)
        if (state.enforce === true) expect(state.expectedTokens.length).toBeGreaterThan(0)
        expect(component.files.length).toBeGreaterThan(0)
      }
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('横切项 enforce=true 者必须给核对面(pattern/patterns 与 files)', () => {
    for (const item of manifest.crossCutting) {
      if (item.enforce !== true) continue
      const patterns = item.patterns ?? (item.pattern === undefined ? [] : [item.pattern])
      expect(patterns.length, item.id).toBeGreaterThan(0)
      expect(item.files?.length, item.id).toBeGreaterThan(0)
    }
  })
})

describe('T6 状态点词汇表与 T8 看板同源(styles.ts 既有 dot 词汇表)', () => {
  const sidebar = manifest.components.find(component => component.id === 'task-sidebar')!
  const dotStates = sidebar.states.filter(state => state.id.startsWith('dot-') && state.id !== 'dot-pulse')

  it('六个状态点的 CSS 块都存在,块内取色 ⊆ 清单期望令牌(不得夹带字面色/外来令牌)', () => {
    for (const state of dotStates) {
      const anchor = `[data-eterna-workbench-dot='${state.id.slice('dot-'.length)}']`
      const blockTokens = cssBlockTokens(WORKBENCH_CSS, anchor)
      expect(blockTokens.size, anchor).toBeGreaterThan(0)
      for (const token of blockTokens) {
        expect(state.expectedTokens, `${anchor} 令牌 ${token}`).toContain(token)
      }
    }
  })

  it('等人状态点脉冲动效取色 = --et-warn 合成 + --et-ease(reduced-motion 全局降级)', () => {
    const pulse = sidebar.states.find(state => state.id === 'dot-pulse')!
    const anchor = "[data-eterna-workbench-dot][data-eterna-workbench-pulse='true']"
    const blockTokens = cssBlockTokens(WORKBENCH_CSS, anchor)
    const frames = cssBlockTokens(WORKBENCH_CSS, '@keyframes wb-dot-pulse')
    for (const token of pulse.expectedTokens) {
      expect(blockTokens.has(token) || frames.has(token), `dot-pulse 期望 ${token}`).toBe(true)
    }
  })
})

describe('T6/T7 组件状态点令牌核对(未落地 = skip pending,不伪造通过)', () => {
  for (const component of manifest.components) {
    it(`${component.id}(${component.label})enforce 状态点期望令牌全部在组件源码出现`, (ctx) => {
      const source = componentSource(component)
      if (source === null) {
        ctx.skip(true, `pending:${component.label} 组件文件未落地(${component.files.join(', ')}),G0-2 报告同记 pending`)
        return
      }
      const used = tokensIn(source)
      for (const state of component.states) {
        if (state.enforce !== true) continue
        for (const token of state.expectedTokens) {
          expect(used.has(token), `${component.id}.${state.id}(${state.label})期望 ${token}`).toBe(true)
        }
        // anchorChecks 选择器级精查:CSS 中含锚点子串的块必须携带期望令牌
        // (『实心/描边换用』类偏差文件级核对查不出,G0-2 与本 spec 同判)。
        for (const check of state.anchorChecks ?? []) {
          const blockTokens = cssBlockTokens(source, check.anchor)
          expect(
            blockTokens.size > 0,
            `${component.id}.${state.id} CSS 缺含「${check.anchor}」的规则(${check.note ?? ''})`,
          ).toBe(true)
          for (const token of check.expectedTokens) {
            expect(
              blockTokens.has(token),
              `${component.id}.${state.id} 锚点「${check.anchor}」块期望 ${token}`,
            ).toBe(true)
          }
        }
      }
    })

    it(`${component.id} 组件文件禁字面色值(frontend-style §1-1)`, (ctx) => {
      const sources = component.files.map(file => join(PKG_ROOT, file)).filter(exists)
      if (sources.length === 0) {
        ctx.skip(true, `pending:${component.id} 组件文件未落地`)
        return
      }
      for (const path of sources) {
        const code = readFileSync(path, 'utf8')
        expect(code.match(/#[0-9a-fA-F]{3,8}\b/gu) ?? [], path).toEqual([])
        expect(code.match(/\b(?:rgba?|hsla?)\(/gu) ?? [], path).toEqual([])
      }
    })
  }
})

describe('主题横切项(深浅双主题的自查基座)', () => {
  it('DSH 桥接:injectDesignTokens({ bridge: true })(frontend-style §1-2)', () => {
    const styles = readFileSync(join(PKG_ROOT, 'src/client/styles.ts'), 'utf8')
    expect(styles).toContain('bridge: true')
  })

  it('壳层:固定 header + 独立滚动 body;tab 条禁止 sticky(2026-11-19 内容穿出 tab 的回归门)', () => {
    const navKey = "[data-eterna-workbench='view-nav'] {"
    const navBlock = WORKBENCH_CSS.slice(WORKBENCH_CSS.indexOf(navKey), WORKBENCH_CSS.indexOf('}', WORKBENCH_CSS.indexOf(navKey)))
    expect(navBlock.length).toBeGreaterThan(0)
    expect(navBlock).not.toContain('position: sticky')
    expect(WORKBENCH_CSS).toContain("[data-eterna-workbench='header'] {")
    expect(WORKBENCH_CSS).toContain("[data-eterna-workbench='body'] {")
    const bodyBlock = WORKBENCH_CSS.slice(WORKBENCH_CSS.indexOf("[data-eterna-workbench='body'] {"), WORKBENCH_CSS.indexOf('}', WORKBENCH_CSS.indexOf("[data-eterna-workbench='body'] {")))
    expect(bodyBlock).toContain('overflow-y: auto')
  })

  for (const item of manifest.crossCutting) {
    if (item.enforce !== true) continue
    const patterns = item.patterns ?? (item.pattern === undefined ? [] : [item.pattern])
    it(`${item.label}(${item.expect})`, () => {
      const source = (item.files ?? []).map(file => readFileSync(join(PKG_ROOT, file), 'utf8')).join('\n')
      for (const pattern of patterns) {
        expect(source.includes(pattern), `${item.id} 缺 ${pattern}`).toBe(true)
      }
    })
  }
})
