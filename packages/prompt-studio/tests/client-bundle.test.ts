/**
 * 客户端 bundle 工件测试(T7.2):闭包工厂形态(对齐 dsh 客户端包 lib/client.js)
 * 与模块装载冒烟(vm 内伪 window/require)。require 只允许基线外部模块
 * (web 壳 PLATFORM_MODULES 种子表子集,scripts/build-client.mjs 的 external 清单);
 * 出现清单外 require 即失败——dsh.client.inject 声明与实际消费漂移的机器证据。
 * 依赖 verify 链先跑 build:client(pnpm run verify 顺序保证)。
 *
 * T1.5 全景改版扩展(ps-v2-test-plan §3 T1.5(b)):①令牌铁律逐文件扩展到全部
 * 客户端源文件(分组导航/条目详情/diff 等新组件文件自动纳入,枚举目录而非点名);
 * ②styles.ts 令牌数量只增不减(基线 136 处 --dsw-alias-*);③新视图锚点
 * data-ps-group-nav / data-ps-entry-detail / data-ps-diff-view / data-ps-entry-save
 * 在 bundle 中。
 * T2.3 扩展:会话快照查看视图锚点(data-ps-snapshot-*)与「不可回放/运行时构建」
 * 降级文案锚点在 bundle 中(测试计划 §4 T2.3(b) 前端断言,同 T1.5 模式;
 * 2026-11-11 用户裁定后「上游生成」文案随行锚点只读型移除)。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = join(import.meta.dirname, '..', 'lib', 'client.js')
const clientSrcDir = join(import.meta.dirname, '..', 'src', 'client')

/** 颜色声明抽取(与既有 styles.ts 断言同一正则口径,复用 :41 既有形态)。 */
function colorDeclarationsOf(code: string): string[] {
  return [...code.matchAll(/(?:color|background(?:-color)?|border(?:-left)?-color):\s*([^;]+);/gu)]
    .map(match => match[1]?.trim() ?? '')
}

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

  it('设计令牌:样式只经 --et-*/--dsw-alias-* 变量,无字面色值(硬性规范第 6 条)', () => {
    const code = readFileSync(join(import.meta.dirname, '..', 'src', 'client', 'styles.ts'), 'utf8')
    // 拼接进 CSS 模板串的颜色声明必须全部引用 var(--et-…)/var(--dsw-alias-…)/transparent。
    const colorDecls = [...code.matchAll(/(?:color|background(?:-color)?|border(?:-left)?-color):\s*([^;]+);/gu)]
      .map(match => match[1]?.trim() ?? '')
    expect(colorDecls.length).toBeGreaterThan(10)
    const aliasVar = /^var\(--(?:et|dsw-alias)-[a-z0-9-]+(?:\s*,\s*[^)]+)?\)$/u
    const aliasMix = /^color-mix\(in (?:srgb|oklab), var\(--(?:et|dsw-alias)-[a-z0-9-]+\)(?:\s+[\d.]+%)?(\s*,\s*transparent(?:\s+[\d.]+%)?)?\)$/u
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

describe('T1.5 全景改版工件', () => {
  it('令牌铁律(逐文件):全部客户端源文件的颜色声明只经 --et-*/--dsw-alias-*/color-mix/transparent', () => {
    // 逐文件断言(测试计划 §3 T1.5(b)①):枚举 src/client 全部源文件——新增/改版
    // 组件(分组导航、条目详情、diff 视图等)自动纳入,无需点名清单。
    const files = readdirSync(clientSrcDir).filter(file => /\.(ts|tsx)$/u.test(file)).sort()
    expect(files.length).toBeGreaterThanOrEqual(8)
    const aliasVar = /^var\(--(?:et|dsw-alias)-[a-z0-9-]+(?:\s*,\s*[^)]+)?\)$/u
    const aliasMix = /^color-mix\(in (?:srgb|oklab), var\(--(?:et|dsw-alias)-[a-z0-9-]+\)(?:\s+[\d.]+%)?(\s*,\s*transparent(?:\s+[\d.]+%)?)?\)$/u
    let filesWithDecls = 0
    for (const file of files) {
      const code = readFileSync(join(clientSrcDir, file), 'utf8')
      const declarations = colorDeclarationsOf(code)
      if (declarations.length > 0) filesWithDecls += 1
      for (const decl of declarations) {
        const ok = aliasVar.test(decl) || aliasMix.test(decl) || decl === 'transparent' || decl === 'none'
        expect(ok, `${file} 内非官方语义令牌的颜色声明: ${decl}`).toBe(true)
      }
    }
    // 有颜色声明的文件应≥1(styles.ts 承载全部 CSS;组件文件为 0 也被逐文件覆盖)。
    expect(filesWithDecls).toBeGreaterThanOrEqual(1)
  })

  it('令牌数量只增:styles.ts 的 --et-*/--dsw-alias-* 出现次数 ≥ 基线 136(§6.4 只增不减)', () => {
    const code = readFileSync(join(clientSrcDir, 'styles.ts'), 'utf8')
    const count = [...code.matchAll(/--(?:et|dsw-alias)-[a-z0-9-]+/gu)].length
    expect(count).toBeGreaterThanOrEqual(136)
  })

  it('T1.5 工件:全景分组导航/条目详情/diff/保存锚点在 bundle 中', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 测试计划 §3 T1.5(b)② 的四个锚点 + 改版新增的结构面锚点。
    for (const anchor of [
      'data-ps-group-nav', 'data-ps-entry-detail', 'data-ps-diff-view', 'data-ps-entry-save',
      'data-ps-entry-row', 'data-ps-layer-group', 'data-ps-entry-risks',
      'data-ps-entry-runtime',
    ]) {
      expect(code, `缺少 T1.5 锚点 ${anchor}`).toContain(anchor)
    }
  })

  it('T2.2 工件:生效条件区锚点在 bundle 中;radius 三枚举标签文案在场(不热生效条目 UI 明示)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 测试计划 §3 T1.5(b)② 的四个锚点 + 改版新增的结构面锚点。
    for (const anchor of ['data-ps-entry-effect', 'data-ps-effect-radius', 'data-ps-effect-badge', 'data-ps-entry-effect-note']) {
      expect(code, `缺少 T2.2 生效条件锚点 ${anchor}`).toContain(anchor)
    }
    // bundle 经 esbuild ASCII 转义(大写 hex \uXXXX),中文文案按转义形态断言:
    // 「生效条件」标题 + 三枚举标签文案(即时/不进入任何会话/不可编辑)。
    // (2026-11-11 用户裁定后 radius 闭合为三枚举:readonly-upstream 随 time-context
    // 不登记移除。)
    const escaped = (text: string): string => text.split('')
      .map(ch => (ch.charCodeAt(0) <= 0x7e ? ch : `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))
      .join('')
    expect(code, '「生效条件」标题文案应在 bundle').toContain(escaped('生效条件'))
    expect(code, '即时生效标签文案应在 bundle').toContain(escaped('即时生效'))
    expect(code, '不进入任何会话标签文案应在 bundle').toContain(escaped('不进入任何会话'))
    expect(code, '不可编辑标签文案应在 bundle').toContain(escaped('不可编辑'))
    // radius 字典键全部接线(StudioPage 经 t(`studio.effect.${radius}`) 消费)。
    for (const radius of ['immediate-new-session', 'not-composed-anywhere', 'runtime-rebuilt']) {
      expect(code, `radius 字典键 studio.effect.${radius} 应在 bundle`).toContain(`studio.effect.${radius}`)
    }
  })

  it('T1.5 按条目读侧接线:StudioPage 经 prompt-versions {entryId} 拉取条目链', () => {
    const source = readFileSync(join(clientSrcDir, 'StudioPage.tsx'), 'utf8')
    expect(source).toContain('ENDPOINTS.promptVersions, { input: { entryId } }')
    // 写链路两段式载荷复述面含 entryId(宿主 ApprovalGate confirm 校验一致)。
    expect(source).toContain('entryId: selected.id')
    expect(source).toContain('entryId: version.entryId')
  })

  it('T3.2 工件:AI 润色区/diff 预览/提案提交/降级锚点在 bundle 中', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 测试计划 §5 T3.2(b):diff 视图按 §5.1 对照既有组件形态——锚点随 T1.5 模式。
    for (const anchor of [
      'data-ps-ai-polish', 'data-ps-ai-status', 'data-ps-ai-instruction', 'data-ps-ai-polish-btn',
      'data-ps-ai-draft-card', 'data-ps-ai-draft', 'data-ps-ai-diff', 'data-ps-ai-propose-btn',
      'data-ps-ai-discard-btn', 'data-ps-ai-unavailable',
    ]) {
      expect(code, `缺少 T3.2 AI 润色流锚点 ${anchor}`).toContain(anchor)
    }
  })

  it('T3.2 接线:AI 三端点(可用性/润色/提案)进 bundle;降级与提案文案在场(中文按转义形态断言)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('loopPrompt/ai-status')
    expect(code).toContain('loopPrompt/ai-polish')
    expect(code).toContain('loopPrompt/ai-proposal')
    // bundle 经 esbuild ASCII 转义(大写 hex \uXXXX),中文文案按转义形态断言。
    const escaped = (text: string): string => text.split('')
      .map(ch => (ch.charCodeAt(0) <= 0x7e ? ch : `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))
      .join('')
    expect(code, '「AI 能力不可用」降级文案应在 bundle').toContain(escaped('AI 能力不可用'))
    expect(code, '「作为提案提交」主操作文案应在 bundle').toContain(escaped('作为提案提交'))
    expect(code, '「永不直接生效」纪律文案应在 bundle').toContain(escaped('不直接生效'))
  })

  it('T3.2 diff 预览复用 diff.ts:AiDraftDiff 与 DiffView 消费同一 lineDiffOps 导出(同源不另造实现)', () => {
    const source = readFileSync(join(clientSrcDir, 'StudioPage.tsx'), 'utf8')
    expect(source).toContain("import { diffLines, lineDiffOps } from '../diff.ts'")
    expect(source).toContain('const ops: readonly LineDiffOp[] = lineDiffOps(base, draft)')
    expect(source).toContain('const ops: readonly LineDiffOp[] = lineDiffOps(pair.a.content, pair.b.content)')
    // 提案两段式载荷复述面含 aiMeta(第二段审计 aiSource 同源)。
    expect(source).toContain('aiMeta: {')
    expect(source).toContain('endpoint: ENDPOINTS.aiProposal')
  })

  it('T3.3 工件:AI 审核报告卡锚点在 bundle 中(问题清单两来源+建议列表+关闭报告)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 测试计划 §5 T3.3(b)③:报告卡前端锚点——本地区块([data-ps-ai-review-rulefinding])
    // 与模型区块([data-ps-ai-review-finding] + severity 徽标 + [data-ps-ai-review-suggestion])
    // 双来源呈现,建议列表即 suggestion 字段。
    for (const anchor of [
      'data-ps-ai-review', 'data-ps-ai-review-btn', 'data-ps-ai-review-card',
      'data-ps-ai-review-rulefinding', 'data-ps-ai-review-finding', 'data-ps-ai-review-suggestion',
      'data-ps-ai-review-severity', 'data-ps-ai-review-loading', 'data-ps-ai-review-error',
    ]) {
      expect(code, `缺少 T3.3 审核报告卡锚点 ${anchor}`).toContain(anchor)
    }
  })

  it('T3.3 接线与纪律文案:ai-review 端点进 bundle;「仅展示/不拦截」文案在场(中文按转义形态断言)', () => {
    const code = readFileSync(bundlePath, 'utf8')
    expect(code).toContain('loopPrompt/ai-review')
    // bundle 经 esbuild ASCII 转义(大写 hex \uXXXX),中文文案按转义形态断言。
    const escaped = (text: string): string => text.split('')
      .map(ch => (ch.charCodeAt(0) <= 0x7e ? ch : `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))
      .join('')
    expect(code, '「问题清单」标题文案应在 bundle').toContain(escaped('问题清单'))
    expect(code, '「仅展示」纪律文案应在 bundle').toContain(escaped('仅展示'))
    expect(code, '「不拦截」纪律文案应在 bundle').toContain(escaped('不拦截'))
    // 本地校验器区块的规则同源提示在场(报告仅展示;规则与保存门禁同源的 UI 表达)。
    expect(code, '「与保存同一套规则」同源提示文案应在 bundle').toContain(escaped('与保存同一套规则'))
  })

  it('T3.3 竞态守卫与过期标识(评审 2026-11-11):done/ok 态携带 entryId,在途响应跨条目丢弃,受审稿过期明示', () => {
    const source = readFileSync(join(clientSrcDir, 'StudioPage.tsx'), 'utf8')
    // 选中条目最新引用:切条目即时更新,异步延续读最新值(防 setState 无条件落位
    // 覆盖 selectEntry 的 idle 重置——旧条目报告贴新条目的竞态)。
    expect(source).toContain('selectedIdRef.current')
    expect(source).toContain('selectedIdRef.current = entryId')
    // 在途响应守卫:润色/审核 await 返回后条目已切换即丢弃(两处同款)。
    expect(source.match(/if \(selectedIdRef\.current !== entryIdAtStart\) return/gu)?.length).toBe(2)
    // 渲染面条目归属过滤:ok/done 态 entryId 与选中条目失配即按 idle 处理。
    expect(source).toContain('aiPolish.entryId !== selected?.id')
    expect(source).toContain('aiReview.entryId !== selected?.id')
    // 提案提交载荷级双保险:entryId 取建议稿归属条目,且与选中条目不符即不发起。
    expect(source).toContain('aiPolish.entryId !== selected.id')
    expect(source).toContain('entryId: aiPolish.entryId')
    // 受审稿过期标识:done 态记录受审全文,与当前草稿失配即明示(锚点+文案进 bundle)。
    const code = readFileSync(bundlePath, 'utf8')
    expect(code, '受审稿过期标识锚点应在 bundle').toContain('data-ps-ai-review-stale')
    const escaped = (text: string): string => text.split('')
      .map(ch => (ch.charCodeAt(0) <= 0x7e ? ch : `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))
      .join('')
    expect(code, '「受审文本」过期文案应在 bundle').toContain(escaped('受审文本'))
  })

  it('T2.3 工件:会话快照查看视图锚点在 bundle 中;运行时注入型「不可回放」降级文案在场', () => {
    const code = readFileSync(bundlePath, 'utf8')
    // 测试计划 §4 T2.3(b):快照查看视图锚点(随 T1.5 模式)。
    for (const anchor of [
      'data-ps-session-snapshot', 'data-ps-snapshot-session-row', 'data-ps-snapshot-detail',
      'data-ps-snapshot-entry', 'data-ps-snapshot-entry-text', 'data-ps-snapshot-pointer',
    ]) {
      expect(code, `缺少 T2.3 快照视图锚点 ${anchor}`).toContain(anchor)
    }
    // 降级标注文案锚点(无版本链条目明示,不造可回放假象)。bundle 经 esbuild
    // ASCII 转义(大写 hex \uXXXX),中文文案按转义形态断言。
    // (2026-11-11 用户裁定后「上游生成」文案随行锚点只读型移除,改为断言
    // 运行时注入型的「运行时构建」降级文案。)
    const escaped = (text: string): string => text.split('')
      .map(ch => (ch.charCodeAt(0) <= 0x7e ? ch : `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))
      .join('')
    expect(code, '「不可回放」降级文案应在 bundle').toContain(escaped('不可回放'))
    expect(code, '「运行时构建」降级文案应在 bundle').toContain(escaped('运行时构建'))
    expect(code, '「会话快照」区段标题文案应在 bundle').toContain(escaped('会话快照'))
    // 快照端点接线(session-snapshot 列表/详情两形态)。
    expect(code).toContain('loopPrompt/session-snapshot')
  })

  it('T1.5 DEFAULT_ENTRY_ID 交叉钉住:客户端本地常量 ≡ 服务端 registry 导出(同值)', () => {
    // 客户端不 import 服务端 registry(node:fs 传递依赖不可入 bundle),字面量复刻
    // 必须被钉住:两处任一改名即红,否则初始选中条目 find 不到、详情区静默空白。
    const client = readFileSync(join(clientSrcDir, 'StudioPage.tsx'), 'utf8')
    const server = readFileSync(join(import.meta.dirname, '..', 'src', 'registry.ts'), 'utf8')
    const clientId = /DEFAULT_ENTRY_ID = '([^']+)'/.exec(client)?.[1]
    const serverId = /export const DEFAULT_ENTRY_ID = '([^']+)'/.exec(server)?.[1]
    expect(clientId).toBe(serverId)
    expect(clientId).toBe('preset.standard.persona')
  })

  it('T1.5 零硬编码色补口:全部客户端源文件无任何字面 hex 色(覆盖 outline/box-shadow/fill 等正则盲区)', () => {
    // 既有按属性名(declaration 值白名单)的断言只覆盖 color/background/border-color,
    // 不含 outline/box-shadow/fill 等复合值属性;本条按「无字面 hex」补口——任何属性
    // 上出现 #rgb/#rrggbb/#rrggbbaa 即红(令牌铁律的属性无关表达)。
    const files = readdirSync(clientSrcDir).filter(file => /\.(ts|tsx)$/u.test(file)).sort()
    for (const file of files) {
      const code = readFileSync(join(clientSrcDir, file), 'utf8')
      const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.exec(code)
      expect(hex === null, `${file} 内出现字面 hex 色: ${hex?.[0] ?? ''}`).toBe(true)
    }
  })
})

describe('模块装载冒烟(vm)', () => {
  /** 伪 require:基线模块返回桩;清单外 specifier 即失败(消费面漂移的证据)。 */
  function makeRequire(seen: string[]): (specifier: string) => unknown {
    const stubs: Record<string, unknown> = {
      'react': { useState: () => [undefined, () => undefined], useMemo: () => undefined, useCallback: () => undefined },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'fragment' },
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
