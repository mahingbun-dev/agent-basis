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

/**
 * 扫描面 = packages/* 全覆盖,再用 EXEMPT_DIRS 显式豁免。
 * ★ 2026-11-19 教训:此前是手写白名单,新包(knowledge-admin)默认逃过检查,
 *   带 23 处字面色值 + 9 个上游不存在的 --dsw-alias-* 名入库。白名单式护栏
 *   只保护名单内的包,新包等于默认放行;故改为黑名单式。
 */
const EXEMPT_DIRS = new Set([
  // 后端/CLI 包,无浏览器半边(纯 Host 侧逻辑,不产出 UI)。
  'packages/agent-loop',
  'packages/approval-cli',
  'packages/audit',
  'packages/cache-guard',
  'packages/evolve',
  'packages/governance',
  'packages/knowledge',
  'packages/llm',
  'packages/llm-openai',
  'packages/observe',
  'packages/session',
  'packages/system-prompt',
  'packages/tasks',
  'packages/toolkit',
  'packages/tools',
  // 独立 relay 页(浏览器中继的本地状态页):自带完整令牌块(浅/深两套),
  // 不注入 DSH 壳,故其字面色值属合法令牌定义(同 extension-companion 的 options.html)。
  'packages/browser-relay',
])

const SCAN_DIRS = readdirSync(join(root, 'packages'))
  .filter(name => isDir(join(root, 'packages', name, 'src')))
  .filter(name => !EXEMPT_DIRS.has(`packages/${name}`))
  .map(name => `packages/${name}/src`)

function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 允许出现字面色值的文件(令牌源 / 品牌插画 / 独立扩展页的令牌块 / 画布令牌兜位)。 */
/**
 * v4 层级/圆角规则的豁免：独立页(pages.ts 登录/门禁/扩展设置)不在 DSH 壳内,
 * 其浮层不与宿主 toast/决策层共处一屏,允许逃生舱 z-index;圆角在 P0 后统一。
 */
const LADDER_EXEMPT = new Set([
  'packages/access/src/pages.ts',
])

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
    // .js 也要收：2026-11-19 增量扫描发现 knowledge-admin 的客户端半边是手写
    // h() 的纯 .js（992 行），只收 ts/tsx 会让它整体逃过令牌检查。
    else if (/\.(ts|tsx|js|jsx|mjs|html)$/u.test(name)) out.push(path)
  }
  return out
}

function stripComments(code) {
  return code.replace(HTTP_STYLE, '').replace(LINE_COMMENT, '$1')
}

/**
 * 上游 `--dsw-alias-*` 名字表 = 两个来源的并集（缺一不可）：
 * 1. dsh-web-frontend 的 CSS：宿主**引用**的所有别名（含主题插件未定义、
 *    但宿主仍在用的少数名字，如 border-l2-darkmode-thin / label-error）；
 * 2. dsh-client-ui-theme 的 lib/client.js：108 个别名的**真正定义点**
 *    （`body` 与 `body[data-ds-dark-theme]` 两个块）。
 * ★ 2026-11-19 教训：只扫 CSS 会把主题层定义、宿主 CSS 未引用的名字
 *   判成“上游不存在”（v4 桥接一次撞出 15 个假阳性）；只扫主题插件则
 *   会放过宿主在用的未定义名。故必须取并集。
 */
function upstreamTokens() {
  const pnpm = join(root, 'node_modules/.pnpm')
  let entries
  try {
    entries = readdirSync(pnpm)
  } catch {
    return null
  }
  const tokens = new Set()
  let foundAny = false

  // 来源 1：宿主前端 CSS 的引用
  const frontend = entries.find(name => name.startsWith('@deepseek-ai+dsh-web-frontend@'))
  if (frontend !== undefined) {
    const assets = join(pnpm, frontend, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
    try {
      for (const file of readdirSync(assets)) {
        if (!file.endsWith('.css')) continue
        foundAny = true
        for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/--dsw-alias-[a-z0-9-]+/gu)) {
          tokens.add(match[0])
        }
      }
    } catch { /* 该来源缺失时忽略，靠另一来源 */ }
  }

  // 来源 2：主题插件的定义块
  const theme = entries.find(name => name.startsWith('@deepseek-ai+dsh-client-ui-theme@'))
  if (theme !== undefined) {
    const clientFile = join(pnpm, theme, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js')
    try {
      const source = readFileSync(clientFile, 'utf8')
      foundAny = true
      for (const match of source.matchAll(/--dsw-alias-([a-z0-9-]+)\s*:/gu)) {
        tokens.add(`--dsw-alias-${match[1]}`)
      }
    } catch { /* 同上 */ }
  }

  return foundAny && tokens.size > 0 ? tokens : null
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
/** v4 阶梯越级项(圆角/层级):先落债务清单,清完后自动升级为 issue。 */
const zViolations = []
/** v4 字阶越级项(同走债务通道)。 */
const typeViolations = []
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
    const ladderExempt = LADDER_EXEMPT.has(rel)
    if (!HEX_ALLOWED.has(rel)) {
      for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[0]}(请改用 --et-* 令牌)`)
      }
      for (const match of code.matchAll(/\b(rgba?|hsla?)\(([^)]*)\)/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[1]}(${match[2]})(请改用 --et-* 令牌)`)
      }
    }
    // v4 字阶(42 号 §5.2):11 / 13 / 15 / 20 / 24 / 32 / 40 / 64。
    // 旧 v3 规则把 13/15 当违规,与 v4 正好相反,已改为白名单式。
    // v4 字阶 11/13/15/20/24/32/40/64;v3 存量仍在用的 12/14/16/28 一并放行,
    // 待 45 号 P3 逐包重排时随包收敛(同理 56 是 v3 独立页主标题)。
    const TYPE_SCALE = new Set([10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40, 56, 64])
    for (const match of code.matchAll(/font-size:\s*([0-9.]+)px/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && !TYPE_SCALE.has(value)) {
        typeViolations.push({ file: rel, kind: 'font-size', value })
      }
    }
    for (const match of code.matchAll(/fontSize:\s*([0-9.]+)\b/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && !TYPE_SCALE.has(value)) {
        typeViolations.push({ file: rel, kind: 'fontSize', value })
      }
    }
    for (const match of code.matchAll(/@media[^{}]*?(?:max|min)-width:\s*(?:900|960)px/gu)) {
      issues.push(`${rel}: 规范外断点 ${match[0]}(请改用 1100/760/640)`)
    }
    // v4 圆角阶梯(42 号 §2.2):只允许 var(--et-radius-*) 与 8/12/16/22/28/36/9999。
    // 0/50%/100% 是圆形与直角,属形状而非档位,不在此列。
    const RADIUS_LADDER = new Set([0, 8, 12, 16, 22, 28, 36, 9999])
    for (const match of code.matchAll(/border-radius:\s*([0-9]+)px/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && !RADIUS_LADDER.has(value)) {
        zViolations.push({ file: rel, kind: 'radius', value })
      }
    }
    for (const match of code.matchAll(/borderRadius:\s*([0-9]+)\b/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && !RADIUS_LADDER.has(value)) {
        zViolations.push({ file: rel, kind: 'radius', value })
      }
    }
    // v4 层级表(42 号 §7a.5):≤40 归组件局部层叠(下拉/菜单,合法);
    // >40 属页面级浮层,必须精确取自 100/200/1000/1100/1500。
    const Z_PAGE = new Set([100, 200, 1000, 1100, 1500])
    for (const match of code.matchAll(/z-index:\s*([0-9]+)/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && value > 40 && !Z_PAGE.has(value)) {
        zViolations.push({ file: rel, kind: 'z-index', value })
      }
    }
    for (const match of code.matchAll(/zIndex:\s*([0-9]+)\b/gu)) {
      const value = Number(match[1])
      if (!ladderExempt && value > 40 && !Z_PAGE.has(value)) {
        zViolations.push({ file: rel, kind: 'zIndex', value })
      }
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

/**
 * v4 阶梯债务清单(45 号计划 P2 必须清零)。
 * 条目不阻止 CI(否则迁移期每个 PR 都红),但**新增越级项一律打回**;
 * 条目清完后应收敛为 0,届时本清单删除、规则自动变成硬门禁。
 * stale 校验:某条目在源码中已不存在 → 报错,强制删除过期条目
 * (宁可让清单变短,不允许它长期留着一个已经不违规的条目)。
 */
const LADDER_DEBT = [
  // 审批卡/提问卡:10000 → 200(45 号 P2-1/P2-2)
  { file: 'packages/access/src/client/styles.ts', kind: 'z-index', value: 10000, plan: 'P2-1/P2-2' },
  // 账户菜单:2147483000 → 1000(45 号 P2-3)
  { file: 'packages/access/src/client/styles.ts', kind: 'z-index', value: 2147483000, plan: 'P2-3' },
  // 模型菜单:1300 → 100(45 号 P2-3)
  { file: 'packages/access/src/client/model-menu.tsx', kind: 'zIndex', value: 1300, plan: 'P2-3' },
]

const debtKey = (v) => `${v.file}|${v.kind}|${v.value}`
const debtMatched = new Set()
const allViolations = [...zViolations, ...typeViolations]
for (const v of allViolations) {
  const hit = LADDER_DEBT.find(d => debtKey(d) === debtKey(v))
  if (hit !== undefined) { debtMatched.add(debtKey(hit)); continue }
  const label = v.kind === 'radius' ? `圆角 ${v.value}px 越出阶梯`
    : v.kind === 'font-size' || v.kind === 'fontSize' ? `字号 ${v.value}px 越出字阶(11/13/15/20/24/32/40/64)`
    : `层级越级 ${v.kind} ${v.value}`
  issues.push(`${v.file}: ${label}(见 42 号 §2.2/§5.2/§7a.5;若确需保留须登记进 LADDER_DEBT 并注明清账计划)`)
}
for (const d of LADDER_DEBT) {
  if (!debtMatched.has(debtKey(d))) {
    issues.push(`scripts/lint-ui-tokens.mjs: 债务条目已过期(${d.file} ${d.kind}=${d.value},计划 ${d.plan})——源码已无此越级项,请删除该条目`)
  }
}
const debtRemaining = LADDER_DEBT.length

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
      issues: new Set(issues).size,
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

/** 去重后的唯一问题列表:同一 (文件, 规则, 值) 只算一项(标题与报告都用它)。 */
const uniqueIssues = [...new Set(issues)].sort()
if (uniqueIssues.length > 0) {
  console.error(`UI 令牌检查失败(${uniqueIssues.length} 项):`)
  for (const issue of uniqueIssues) console.error(`- ${issue}`)
  process.exit(1)
}
const pendingNote = statePointStats.pending > 0 ? `,${statePointStats.pending} 个状态点 pending(组件未落地)` : ''
const debtNote = debtRemaining > 0 ? `;v4 阶梯迁移债务 ${debtRemaining} 项待清(45 号 P0/P2)` : ';v4 阶梯 0 债务'
console.log(`UI 令牌检查通过:${SCAN_DIRS.length} 个目录 ${filesScanned} 个文件,${definedTokens.size} 个 --et-* 令牌;状态点强制 ${statePointStats.ok}/${statePointStats.enforced} 通过${pendingNote}${debtNote}。${reportPath === null ? '' : `报告已写入 ${relative(root, reportPath)}`}`)
