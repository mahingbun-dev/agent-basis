/**
 * form-check(G0-6,33 号 §1.1;40 号 S-2):双形态依赖方向与挂载一致性静态检查。
 *
 * 判定四则(逐条照 33 号 G0-6 原文,不增删):
 *  ① Tier 真值源 = docs/tiers.yml;文件缺失 / YAML 不可解析 / tier1 条目在
 *     packages/ + tools/ 下不实存 → 退出码 2(用法错误,cli.ts 现有约定);
 *  ② TIER001:tier1 包全部源码(*.ts|*.tsx|*.mts,含 src、client 半边与 tests)
 *     的 import 静态扫描不得解析到任何 tier2 包名(裸名 @eterna/<tier2> 或相对
 *     路径穿越包边界落到 tier2 包目录);
 *  ③ FORM001:base / super 各自的挂载清单与模板一致(比对口径 40 号 §9 Q1 暂定:
 *     insert 块内 @eterna 挂载行 id + name 按序逐行相等)+ 超集断言 base 模板
 *     挂载行集 ⊆ super 模板挂载行集(31 号 §2.1「base ⊕」语义的机器化);
 *  ④ Tier2 → Tier2 依赖不受约束(31 号 §2.2 只约束 Tier1→Tier2)——不做检查。
 *
 * FORM001 漂移处置(40 号 §8 风险 1「两条路都不得静默放红」):base 对同步独立 PR
 * 已合入(2026-11-19:11 行补齐 + G1-1 断言面同步扩 + 双 boot 复跑——§9 Q1 拍板的
 * 同步路),ENFORCE_PAIR_DRIFT 常量自此置 true:清单↔模板按序漂移一律 ERROR、置
 * 退出码 1;--enforce-pair-drift 旗标保留为显式复跑口径。漂移每次运行仍全量打印。
 * 超集断言与文件缺失恒为 ERROR,不在此列。
 *
 * 演进项(2026-11-19 登记,不在本次施工;A5 契约 ④):FORM001 比对口径拟把行内
 * config 纳入(见 extractEternaMountRows——现只取 id+name):super 形态 eterna-tasks
 * 行 config.realm=admin 曾只落容器模板、开发档清单缺同款,按序比对不可见;两侧
 * 补齐后由本演进项收口「行内 config 也参与漂移判定」。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { error, warning, type Finding } from './types.ts'
import { asStringArray, isRecord, parseYaml, stripCommentsLineByLine } from './util.ts'

/**
 * 清单↔模板按序比对是否置 error。base 对同步独立 PR 已合入(2026-11-19,40 号
 * §9 Q1 拍板的同步路:11 行补齐 + G1-1 断言面同步扩 + 双 boot 复跑)→ true;
 * 首版曾按 Q1 暂定 false(以 WARNING 显式登记、不置退出码)。
 */
const ENFORCE_PAIR_DRIFT = true

/** form-check 的两对工件:形态 → {容器档模板, 开发档挂载清单}。 */
const FORM_PAIRS: readonly {
  readonly form: 'base' | 'super'
  readonly template: string
  readonly list: string
}[] = [
  { form: 'base', template: 'docker/profile/cordis.patch.yml.template', list: 'profiles/eterna-web/cordis.patch.yml' },
  { form: 'super', template: 'docker/profile/cordis.super.patch.yml.template', list: 'profiles/eterna-super/cordis.patch.yml' },
]

export interface FormCheckOutcome {
  /** 非空 → 用法错误(Tier 真值源缺失/不可解析/tier1 不实存),CLI 退出码 2。 */
  readonly usageError?: string
  readonly findings: readonly Finding[]
}

interface Tiers {
  readonly tier1: readonly string[]
  readonly tier2: readonly string[]
}

/**
 * form-check 仓库根解析(CLI 编排层口径):
 *  1. 从 cwd 向上找最近含 docs/tiers.yml 的祖先(在仓库内任意子目录运行可命中);
 *  2. 找不到 → 从 packctl 自身所在目录向上找(绝对路径调用、cwd 在仓库外时,
 *     form-check 检查的是 packctl 所属仓库的工件,而非 cwd 所在目录);
 *  3. 两者都找不到 → 返回 cwd 原样(维持判定则 ①「真值源缺失 → 退出码 2」契约)。
 */
export function resolveFormCheckRoot(cwd: string, moduleDir: string): string {
  return findRootWithTiers(cwd) ?? findRootWithTiers(moduleDir) ?? cwd
}

/** 从 start 向上找最近含 docs/tiers.yml 的祖先目录;到文件系统根仍无 → undefined。 */
function findRootWithTiers(start: string): string | undefined {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'docs', 'tiers.yml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** 判定则 ①:加载并校验 docs/tiers.yml(真值源)。 */
function loadTiers(repoRoot: string): { ok: true; tiers: Tiers } | { ok: false; usageError: string } {
  const tiersPath = join(repoRoot, 'docs', 'tiers.yml')
  if (!existsSync(tiersPath)) {
    return { ok: false, usageError: `Tier 真值源缺失: ${join('docs', 'tiers.yml')}(G0-6 ①;tier1/tier2 包名清单,新包落地时登记)` }
  }
  const parsed = parseYaml(readFileSync(tiersPath, 'utf8'))
  if (!parsed.ok) {
    return { ok: false, usageError: `Tier 真值源不可解析: docs/tiers.yml:${parsed.error ?? '未知错误'}` }
  }
  if (!isRecord(parsed.value)) {
    return { ok: false, usageError: 'Tier 真值源形态错误: docs/tiers.yml 顶层必须是 tier1/tier2 映射' }
  }
  const tier1 = asStringArray(parsed.value.tier1)
  const tier2 = asStringArray(parsed.value.tier2)
  if (tier1 === undefined || tier2 === undefined) {
    return { ok: false, usageError: 'Tier 真值源形态错误: tier1/tier2 必须是字符串数组' }
  }
  if (tier1.length === 0) {
    return { ok: false, usageError: 'Tier 真值源形态错误: tier1 为空' }
  }
  const overlap = tier1.filter(name => tier2.includes(name))
  if (overlap.length > 0) {
    return { ok: false, usageError: `Tier 真值源自相矛盾: ${overlap.join(', ')} 同时登记在 tier1 与 tier2` }
  }
  for (const name of tier1) {
    if (!isDir(join(repoRoot, 'packages', name)) && !isDir(join(repoRoot, 'tools', name))) {
      return { ok: false, usageError: `tier1 条目不实存: ${name}(packages/${name} 与 tools/${name} 都不是目录;tier1 必须是已落地包——tier2 才允许登记未落地名)` }
    }
  }
  return { ok: true, tiers: { tier1, tier2 } }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// ── 判定则 ③:insert 块内 @eterna 挂载行提取与比对 ─────────────────────────

export interface MountRow {
  readonly id: string
  readonly name: string
}

/**
 * 提取 patch 文本 insert 块内的 @eterna 挂载行(id + name,按出现序)。
 * 块边界口径与 entrypoint 第 2.5 步/模板头注「重放挂载块」同源:列 0 的
 * `- insert:` 开块,任何其他列 0 行(含注释)闭块;preset 组内的嵌套 `- id:`
 * 行因此天然不计入(它们不在 insert 块内)。行形态:`<缩进>- id: <x>` 后随
 * `<缩进>name: '<@eterna/...>'`。
 */
export function extractEternaMountRows(text: string): readonly MountRow[] {
  const rows: MountRow[] = []
  let inInsert = false
  let pendingId: string | undefined
  for (const line of text.split('\n')) {
    if (/^-\s+insert:\s*$/.test(line)) {
      inInsert = true
      pendingId = undefined
      continue
    }
    if (/^\S/.test(line)) {
      inInsert = false
      pendingId = undefined
      continue
    }
    if (!inInsert) continue
    const idMatch = /^\s+- id:\s*(\S+)\s*$/.exec(line)
    if (idMatch !== null) {
      pendingId = idMatch[1]
      continue
    }
    const nameMatch = /^\s+name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line)
    const rawName = nameMatch?.[1]
    if (rawName !== undefined && pendingId !== undefined) {
      if (rawName.startsWith('@eterna/')) rows.push({ id: pendingId, name: rawName })
      pendingId = undefined
    }
  }
  return rows
}

function rowLabel(row: MountRow): string {
  return `${row.id}(${row.name})`
}

/** 按序比对两份挂载行(id+name 逐行相等);返回人类可读的漂移描述(一致则空串)。 */
function describeDrift(templateRows: readonly MountRow[], listRows: readonly MountRow[]): string {
  const templateOnly: string[] = []
  const listOnly: string[] = []
  const orderConflicts: string[] = []
  const templateKeys = templateRows.map(rowLabel)
  const listKeys = listRows.map(rowLabel)
  for (let i = 0; i < Math.max(templateRows.length, listRows.length); i++) {
    const t = templateKeys[i]
    const l = listKeys[i]
    if (t !== undefined && l !== undefined && t !== l) orderConflicts.push(`#${i + 1}: 模板 ${t} ≠ 清单 ${l}`)
    if (t !== undefined && !listKeys.includes(t)) templateOnly.push(t)
    if (l !== undefined && !templateKeys.includes(l)) listOnly.push(l)
  }
  const parts: string[] = []
  if (orderConflicts.length > 0) parts.push(`顺序冲突 ${orderConflicts.join('; ')}`)
  if (templateOnly.length > 0) parts.push(`模板独有 ${templateOnly.join(', ')}`)
  if (listOnly.length > 0) parts.push(`清单独有 ${listOnly.join(', ')}`)
  return parts.join(' | ')
}

// ── 判定则 ②:TIER001 import 静态扫描 ─────────────────────────────────────

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts']
const SKIPPED_DIR_NAMES = new Set(['node_modules', 'lib', 'dist'])

/** import/export … from、副作用 import、require()、动态 import() 的说明符行匹配。 */
function importSpecifiersOnLine(line: string): readonly string[] {
  const specifiers: string[] = []
  if (/^\s*(?:import|export)\b/.test(line) || /^\s*[})\]]*\s*from\s*['"]/.test(line)) {
    for (const match of line.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1] ?? '')
    for (const match of line.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1] ?? '')
  }
  for (const match of line.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1] ?? '')
  for (const match of line.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1] ?? '')
  return specifiers
}

function listSourceFiles(root: string, rel: string, out: string[]): void {
  let entries: readonly string[]
  try {
    entries = readdirSync(join(root, rel))
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIPPED_DIR_NAMES.has(entry)) continue
    const relPath = rel === '' ? entry : `${rel}/${entry}`
    const full = join(root, relPath)
    if (isDir(full)) {
      listSourceFiles(root, relPath, out)
      continue
    }
    if (SOURCE_EXTENSIONS.some(ext => entry.endsWith(ext)) && !entry.endsWith('.d.ts')) out.push(relPath)
  }
}

/**
 * 说明符解析:命中 tier2 → 返回 tier2 包名;否则 undefined。
 * 两种形态:裸名 @eterna/<tier2>(含子路径);相对路径解析后穿越包边界落入
 * packages/<tier2>/ 或 tools/<tier2>/。
 */
function resolveTier2Target(repoRoot: string, fileAbs: string, specifier: string, tier2: ReadonlySet<string>): string | undefined {
  const bare = /^@eterna\/([^/]+)/.exec(specifier)
  if (bare !== null && tier2.has(bare[1] ?? '')) return bare[1] ?? ''
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = normalize(join(dirname(fileAbs), specifier))
    for (const rootName of ['packages', 'tools'] as const) {
      const rel = relative(join(repoRoot, rootName), resolved)
      if (rel === '' || rel.startsWith('..')) continue
      const firstSegment = rel.split('/')[0] ?? ''
      if (tier2.has(firstSegment)) return firstSegment
    }
  }
  return undefined
}

// ── 编排 ──────────────────────────────────────────────────────────────────

/**
 * form-check 主入口(纯函数,文件系统只读)。
 * @param repoRoot 仓库根(含 docs/tiers.yml、packages/、tools/、docker/profile/、profiles/)。
 * @param opts.enforcePairDrift 清单↔模板漂移置 error(默认取 ENFORCE_PAIR_DRIFT)。
 */
export function formCheck(repoRoot: string, opts: { enforcePairDrift?: boolean } = {}): FormCheckOutcome {
  const loaded = loadTiers(repoRoot)
  if (!loaded.ok) return { usageError: loaded.usageError, findings: [] }
  const { tier1, tier2 } = loaded.tiers
  const tier2Set = new Set(tier2)
  const enforce = opts.enforcePairDrift ?? ENFORCE_PAIR_DRIFT
  const findings: Finding[] = []

  // ② TIER001:tier1 包源码 import 静态扫描。
  for (const pkg of tier1) {
    const pkgRoot = isDir(join(repoRoot, 'packages', pkg)) ? join(repoRoot, 'packages', pkg) : join(repoRoot, 'tools', pkg)
    const files: string[] = []
    listSourceFiles(pkgRoot, '', files)
    for (const relPath of files) {
      const full = join(pkgRoot, relPath)
      const stripped = stripCommentsLineByLine(readFileSync(full, 'utf8'))
      for (const { line, text } of stripped) {
        for (const specifier of importSpecifiersOnLine(text)) {
          if (specifier === '') continue
          const target = resolveTier2Target(repoRoot, full, specifier, tier2Set)
          if (target !== undefined) {
            findings.push(error('TIER001', `${pkg}/${relPath}:${String(line)}`,
              `Tier1 包 ${pkg} 不得 import Tier2 包 ${target}(31 号 §2.2 铁律 1「Tier1 永不 import Tier2」): ${specifier}`))
          }
        }
      }
    }
  }

  // ③ FORM001:两形态 清单↔模板 按序比对 + base 模板 ⊆ super 模板 超集断言。
  const rowsByTemplate = new Map<string, readonly MountRow[]>()
  for (const pair of FORM_PAIRS) {
    const templatePath = join(repoRoot, pair.template)
    const listPath = join(repoRoot, pair.list)
    if (!existsSync(templatePath)) {
      findings.push(error('FORM001', pair.template, `形态工件缺失: ${pair.template}(G0-6 ③ 要求两形态模板与挂载清单齐备)`))
      continue
    }
    if (!existsSync(listPath)) {
      findings.push(error('FORM001', pair.list, `形态工件缺失: ${pair.list}(G0-6 ③ 要求两形态模板与挂载清单齐备)`))
      continue
    }
    const templateRows = extractEternaMountRows(readFileSync(templatePath, 'utf8'))
    rowsByTemplate.set(pair.template, templateRows)
    const listRows = extractEternaMountRows(readFileSync(listPath, 'utf8'))
    const drift = describeDrift(templateRows, listRows)
    if (drift !== '') {
      const message = `${pair.form} 形态挂载清单与模板漂移(比对口径=insert 块内 @eterna 挂载行 id+name 按序,40 号 §9 Q1;行内 config 纳入口径见文件头演进项): ${drift}`
      findings.push(enforce
        ? error('FORM001', pair.list, message)
        : warning('FORM001', pair.list,
          `${message}——WARNING 为显式登记路径(仅在显式传 enforcePairDrift:false 时,40 号 §8 风险 1「不得静默放红」;缺省已置 true,见文件头)`))
    }
  }
  const baseTemplate = FORM_PAIRS[0]?.template
  const superTemplate = FORM_PAIRS[1]?.template
  const baseRows = baseTemplate !== undefined ? rowsByTemplate.get(baseTemplate) : undefined
  const superRows = superTemplate !== undefined ? rowsByTemplate.get(superTemplate) : undefined
  if (baseRows !== undefined && superRows !== undefined) {
    const superKeys = new Set(superRows.map(rowLabel))
    const missing = baseRows.filter(row => !superKeys.has(rowLabel(row)))
    if (missing.length > 0) {
      findings.push(error('FORM001', superTemplate ?? '',
        `超集断言失败: base 模板挂载行不在 super 模板内(31 号 §2.1 super=base⊕…): ${missing.map(rowLabel).join(', ')}`))
    }
  }

  return { findings }
}
