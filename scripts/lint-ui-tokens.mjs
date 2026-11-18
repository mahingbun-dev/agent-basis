/**
 * UI 令牌卫生检查(CI/本地可跑,G0-2;33 号 §3「verify 链首步」):
 * 1. 除令牌/品牌资产文件外,禁止硬编码十六进制色值与 rgb()/hsl() 色值;
 * 2. 禁止使用 13/13.5/15/18/28px 等规范外字号,以及 900/960px 等规范外断点;
 * 3. 禁止引用未在 packages/ui/src/tokens.ts 定义的 --et-* 令牌;
 * 4. 禁止引用上游 dsh-web-frontend 不存在的 --dsw-alias-* 令牌;
 * 5. T6/T7 状态点令牌对照(packages/workbench/theme-state-points.json):
 *    每个状态点的期望令牌必须在其组件文件出现(38 号 T14 主题自查的机器半;
 *    组件文件未落地记 pending 不计失败,人工半见 docs/design/reviews 的主题对照检查清单)。
 *
 * 用法:node scripts/lint-ui-tokens.mjs [--report <path>]
 *   --report <path>  额外落盘 JSON 令牌使用报告(逐文件令牌计数 + 状态点核对结果),
 *                    默认只打控制台;退出码语义不变(0 通过 / 1 有违例)。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_DIRS = [
  'packages/panel/src',
  'packages/prompt-studio/src/client',
  'packages/access/src',
  'packages/usage-stats/src',
  'packages/compaction/src',
  'packages/memory/src',
  'packages/llm-doctor/src',
  'packages/workbench/src',
  'packages/ui/src',
  'packages/brand/src',
  'packages/extension-companion/src',
]

/** 允许出现字面色值的文件(令牌源 / 品牌插画 / 独立扩展页的令牌块 / 画布令牌兜位)。 */
const HEX_ALLOWED = new Set([
  'packages/ui/src/tokens.ts',
  'packages/brand/src/client/index.ts',
  'packages/extension-companion/src/options.html',
  // 信息流 Canvas 的令牌兜位值(= tokens.ts Webflow 浅色缺省;30 号 §7-1② 画布
  // 不吃 CSS、getComputedStyle 不可求值形态回落兜位,38 号 §9 风险对策)。rgba()
  // 为 tint 合成函数名而非字面色;绘制取色纪律由 tests/canvas-theme.spec.ts 断言。
  'packages/workbench/src/client/FlowCanvas.tsx',
])

const TOKENS_FILE = join(root, 'packages/ui/src/tokens.ts')
const HTTP_STYLE = /\/\*[\s\S]*?\*\//gu
const LINE_COMMENT = /(^|[^:])\/\/.*$/gmu

/** T6/T7 状态点清单真值源(packages/workbench 包内相对路径写法)。 */
const STATE_POINT_MANIFESTS = ['packages/workbench/theme-state-points.json']

const argv = process.argv.slice(2)
const reportIndex = argv.indexOf('--report')
const reportPath = reportIndex >= 0 && argv[reportIndex + 1] !== undefined ? resolve(root, argv[reportIndex + 1]) : null
if (reportIndex >= 0 && reportPath === null) {
  console.error('用法:node scripts/lint-ui-tokens.mjs [--report <path>]')
  process.exit(2)
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|html)$/u.test(name)) out.push(path)
  }
  return out
}

function stripComments(code) {
  return code.replace(HTTP_STYLE, '').replace(LINE_COMMENT, '$1')
}

function upstreamTokens() {
  const pnpm = join(root, 'node_modules/.pnpm')
  let entry
  try {
    entry = readdirSync(pnpm).find(name => name.startsWith('@deepseek-ai+dsh-web-frontend@'))
  } catch {
    return null
  }
  if (entry === undefined) return null
  const assets = join(pnpm, entry, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  const tokens = new Set()
  try {
    for (const file of readdirSync(assets)) {
      if (!file.endsWith('.css')) continue
      for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/--dsw-alias-[a-z0-9-]+/gu)) {
        tokens.add(match[0])
      }
    }
  } catch {
    return null
  }
  return tokens.size > 0 ? tokens : null
}

const definedTokens = new Set(
  [...readFileSync(TOKENS_FILE, 'utf8').matchAll(/(--et-[a-z0-9-]+)\s*:/gu)].map(match => match[1]),
)
const upstream = upstreamTokens()
const fallbackUpstream = new Set([
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l2',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
])

const issues = []
/** 令牌使用报告:逐文件 --et-* 令牌计数(报告半;门禁半在 issues)。 */
const tokenUsage = {}
let filesScanned = 0
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file)
    const raw = readFileSync(file, 'utf8')
    const code = stripComments(raw)
    filesScanned += 1
    const usage = {}
    for (const match of code.matchAll(/--et-[a-z0-9-]+/gu)) {
      usage[match[0]] = (usage[match[0]] ?? 0) + 1
    }
    tokenUsage[rel] = usage
    if (!HEX_ALLOWED.has(rel)) {
      for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[0]}(请改用 --et-* 令牌)`)
      }
      for (const match of code.matchAll(/\b(?:rgba?|hsla?)\(/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[0]}(请改用 --et-* 令牌)`)
      }
    }
    for (const match of code.matchAll(/font-size:\s*(?:13|13\.5|15|18|28)px/gu)) {
      issues.push(`${rel}: 规范外字号 ${match[0]}(请改用 12/14/16/20/24/32 阶梯)`)
    }
    for (const match of code.matchAll(/@media[^{}]*?(?:max|min)-width:\s*(?:900|960)px/gu)) {
      issues.push(`${rel}: 规范外断点 ${match[0]}(请改用 1100/760/640)`)
    }
    for (const match of code.matchAll(/--et-[a-z0-9-]+/gu)) {
      if (!definedTokens.has(match[0])) issues.push(`${rel}: 未定义的令牌 ${match[0]}`)
    }
    for (const match of code.matchAll(/--dsw-alias-[a-z0-9-]+/gu)) {
      const known = upstream ?? fallbackUpstream
      if (!known.has(match[0])) issues.push(`${rel}: 上游不存在的令牌 ${match[0]}`)
    }
  }
}

/**
 * anchorChecks 选择器级精查:在 CSS 源中找含 anchor 子串的选择器块,块内令牌
 * 必须 ⊇ 期望(『实心/描边换用』类偏差文件级核对查不出,由此兜住)。
 * 返回缺失说明;全过返回空串。
 */
function checkAnchorBlocks(css, anchorChecks) {
  const problems = []
  for (const check of anchorChecks ?? []) {
    const index = css.indexOf(check.anchor)
    if (index < 0) {
      problems.push(`CSS 缺含「${check.anchor}」的选择器规则(${check.note ?? ''})`)
      continue
    }
    const open = css.indexOf('{', index)
    const close = css.indexOf('}', open)
    const block = open >= 0 && close > open ? css.slice(open, close) : ''
    const blockTokens = new Set([...block.matchAll(/--et-[a-z0-9-]+/gu)].map(match => match[0]))
    const lacking = (check.expectedTokens ?? []).filter(token => !blockTokens.has(token))
    if (lacking.length > 0) problems.push(`选择器「${check.anchor}」块缺期望令牌 ${lacking.join(', ')}(${check.note ?? ''})`)
  }
  return problems
}

/**
 * T6/T7 状态点 × 令牌对照(38 号 T14;清单真值源 = theme-state-points.json)。
 * 组件文件未落地 → pending(报告可见、不计失败);落地后 enforce=true 的状态点
 * 期望令牌必须全部出现在其组件文件级源码(文件级 ⊇ 状态级;anchorChecks 做
 * 选择器级精查;逐状态锚点核对由 tests/theme-tokens.spec.ts 与人工截图清单补足)。
 */
function checkStatePoints() {
  const components = []
  for (const rel of STATE_POINT_MANIFESTS) {
    const manifestPath = join(root, rel)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      issues.push(`${rel}: 状态点清单不可读(${basename(rel)})`)
      continue
    }
    for (const component of manifest.components ?? []) {
      const files = (component.files ?? []).map(f => join(root, 'packages/workbench', f))
      const relFiles = (component.files ?? []).map(f => `packages/workbench/${f}`)
      const missing = files.filter(f => !statSyncSafe(f))
      const entry = { id: component.id, label: component.label, files: relFiles, states: [] }
      if (missing.length > 0) {
        entry.fileStatus = 'pending'
        entry.pendingStates = (component.states ?? []).length
        entry.note = `组件文件未落地,${entry.pendingStates} 个状态点挂起(S2-T6T7 交付后自动纳入)`
        components.push(entry)
        continue
      }
      entry.fileStatus = 'present'
      const source = files.map(f => stripComments(readFileSync(f, 'utf8'))).join('\n')
      const used = new Set([...source.matchAll(/--et-[a-z0-9-]+/gu)].map(match => match[0]))
      for (const state of component.states ?? []) {
        const expected = state.expectedTokens ?? []
        const absent = expected.filter(token => !definedTokens.has(token))
        if (absent.length > 0) {
          issues.push(`${rel}: ${component.id}.${state.id} 清单引用未定义令牌 ${absent.join(', ')}`)
        }
        const lacking = expected.filter(token => !used.has(token))
        if (state.enforce === true && lacking.length > 0) {
          issues.push(`${rel}: ${component.id}.${state.id}(${state.label})缺期望令牌 ${lacking.join(', ')}(原型 ${state.prototypeClass ?? '-'};依据 ${manifest.meta?.依据?.join('、') ?? '-'})`)
        }
        const anchorProblems = state.enforce === true ? checkAnchorBlocks(source, state.anchorChecks) : []
        for (const problem of anchorProblems) {
          issues.push(`${rel}: ${component.id}.${state.id}(${state.label})anchorCheck 失败:${problem}(原型 ${state.prototypeClass ?? '-'};依据 ${manifest.meta?.依据?.join('、') ?? '-'})`)
        }
        const hints = (state.selectorHints ?? []).map(hint => ({ hint, found: source.includes(hint) }))
        entry.states.push({
          id: state.id,
          label: state.label,
          enforce: state.enforce === true,
          expectedTokens: expected,
          ok: lacking.length === 0 && anchorProblems.length === 0,
          hints,
          anchorChecks: (state.anchorChecks ?? []).map(check => ({ anchor: check.anchor, expectedTokens: check.expectedTokens })),
          note: state.note,
        })
      }
      components.push(entry)
    }
    for (const item of manifest.crossCutting ?? []) {
      const source = (item.files ?? []).map(f => stripComments(readFileSync(join(root, 'packages/workbench', f), 'utf8'))).join('\n')
      const patterns = item.patterns ?? (item.pattern === undefined ? [] : [item.pattern])
      const lacking = patterns.filter(pattern => !source.includes(pattern))
      // patterns 为空 = 机器不可判的人工核对项(如状态色配文字)——ok 记 null,不冒充通过。
      const ok = patterns.length === 0 ? null : lacking.length === 0
      if (item.enforce === true && ok === false) {
        issues.push(`${rel}: 横切项 ${item.id}(${item.label})未满足:${item.expect}(缺 ${lacking.join(', ')})`)
      }
      components.push({ id: `cross:${item.id}`, label: item.label, pattern: item.pattern, patterns, ok, enforce: item.enforce === true, 依据: item.依据 })
    }
  }
  return components
}

function statSyncSafe(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const statePointComponents = checkStatePoints()
const statePointStats = {
  enforced: 0, ok: 0, pending: 0, failed: 0,
}
for (const component of statePointComponents) {
  if (component.fileStatus === 'pending') {
    statePointStats.pending += component.pendingStates ?? 0
    continue
  }
  if ('states' in component) {
    for (const state of component.states) {
      if (state.enforce) {
        statePointStats.enforced += 1
        if (state.ok) statePointStats.ok += 1
        else statePointStats.failed += 1
      }
    }
  }
}

if (reportPath !== null) {
  const report = {
    gate: 'G0-2 UI 令牌 lint(38 号 T14 主题自查机器半)',
    command: 'node scripts/lint-ui-tokens.mjs --report ' + relative(root, reportPath),
    generatedAt: new Date().toISOString(),
    summary: {
      issues: issues.length,
      filesScanned,
      definedTokens: definedTokens.size,
      statePoints: statePointStats,
    },
    issues: [...new Set(issues)].sort(),
    tokenUsage,
    statePoints: statePointComponents,
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
}

if (issues.length > 0) {
  console.error(`UI 令牌检查失败(${issues.length} 项):`)
  for (const issue of [...new Set(issues)].sort()) console.error(`- ${issue}`)
  process.exit(1)
}
const pendingNote = statePointStats.pending > 0 ? `,${statePointStats.pending} 个状态点 pending(组件未落地)` : ''
console.log(`UI 令牌检查通过:${SCAN_DIRS.length} 个目录 ${filesScanned} 个文件,${definedTokens.size} 个 --et-* 令牌;状态点强制 ${statePointStats.ok}/${statePointStats.enforced} 通过${pendingNote}。${reportPath === null ? '' : `报告已写入 ${relative(root, reportPath)}`}`)
