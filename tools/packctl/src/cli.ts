/**
 * packctl CLI 形态:pack init / pack lint / pack check。
 *
 * runPack(argv, io) 是纯编排(可测):io 注入输出与 cwd;退出码约定:
 * 0 = 通过;1 = 检查发现 error(或 init 失败);2 = 用法错误。
 * bin/packctl.mjs 直接 import 本模块(node >= 22.18 原生 strip-types)。
 */
import { initPack } from './init.ts'
import { anyLintErrors, lintPacks } from './lint.ts'
import { checkPack } from './check.ts'
import { formCheck, resolveFormCheckRoot } from './form.ts'
import { discoverPackRoots, isPackDir } from './pack.ts'
import { promptScan } from './prompt.ts'
import { tenantScan } from './tenant.ts'
import { hasErrors } from './types.ts'
import type { Finding } from './types.ts'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliIo {
  readonly cwd: string
  readonly writeLine: (line: string) => void
}

const USAGE = [
  'packctl —— 领域包脚手架与门禁(06 号 SOP 模板 / G0 lint)',
  '用法:',
  '  packctl init <industry> [--root <dir>]   生成 packs/<industry>/ 骨架(不覆盖已有)',
  '  packctl lint [<path>] [--json]           结构 + Cordis 纪律 + 条目锚点 + golden 完整性',
  '  packctl check [<path>]                   静态冒烟:bundle 声明引用的文件都存在',
  '  packctl tenant-scan                      packages/* 隔离铁律静态检查(路由面/登记册/持久化)',
  '  packctl prompt-scan                      提示词登记铁律静态检查(patch 键/section 使用/packs persona)',
  '  packctl form-check [--enforce-pair-drift] 双形态依赖方向(TIER001)与挂载一致(FORM001)静态检查(G0-6;docs/tiers.yml 真值源;仓库根=cwd 向上查找,不在仓库内时回退 packctl 所属仓库)',
  '<path> 缺省为 cwd:是 pack 根则 lint 它;含 packs/ 则 lint 全部领域包;否则向上查找。',
].join('\n')

interface ParsedArgs {
  readonly command: string
  readonly positional: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { command: positional[0] ?? '', positional: positional.slice(1), flags }
}

/** CLI 主入口:返回进程退出码(不直接 process.exit,便于测试)。 */
export function runPack(argv: readonly string[], io: CliIo): number {
  if (argv[0] === '--help' || argv[0] === '-h') {
    io.writeLine(USAGE)
    return 0
  }
  const { command, positional, flags } = parseArgs(argv)
  switch (command) {
    case 'init':
      return cmdInit(positional, flags, io)
    case 'lint':
      return cmdLint(positional, flags, io)
    case 'check':
      return cmdCheck(positional, io)
    case 'tenant-scan':
      return cmdTenantScan(io)
    case 'form-check':
      return cmdFormCheck(flags, io)
    case 'prompt-scan':
      return cmdPromptScan(io)
    case 'help':
      io.writeLine(USAGE)
      return 0
    default:
      io.writeLine(`未知命令: ${command || '(空)'}\n${USAGE}`)
      return 2
  }
}

/**
 * form-check(G0-6,40 号 S-2):双形态依赖方向与挂载一致性静态检查。
 * Tier 真值源问题 → 退出码 2(用法错误);有 error finding → 1;全绿 → 0。
 * --enforce-pair-drift:显式置 error(缺省随 ENFORCE_PAIR_DRIFT 常量——2026-11-19
 * base 对同步 PR 合入后=true,漂移即 error;旗标保留为显式复跑口径)。
 */
function cmdFormCheck(flags: Readonly<Record<string, string | boolean>>, io: CliIo): number {
  // 仓库根解析:cwd 向上找 docs/tiers.yml;不在仓库内(如绝对路径调用)时回退到
  // packctl 自身所属仓库(form-check 检查的本就是 packctl 所在仓库的工件)。
  // 旗标缺省传 undefined 让库层 ENFORCE_PAIR_DRIFT 常量治理默认 severity——此前
  // 显式传 false 会把 warning 钉死、常量翻转在 CLI 层失效(A6 契约「翻 true 转
  // error」的接线前提,2026-11-19)。
  const repoRoot = resolveFormCheckRoot(io.cwd, dirname(fileURLToPath(import.meta.url)))
  const { usageError, findings } = formCheck(repoRoot,
    flags['enforce-pair-drift'] === true ? { enforcePairDrift: true } : {})
  if (usageError !== undefined) {
    io.writeLine(`form-check: ${usageError}`)
    return 2
  }
  for (const finding of findings) {
    io.writeLine(`${finding.severity.toUpperCase()} ${finding.code} ${finding.path}: ${finding.message}`)
  }
  const errorCount = findings.filter(f => f.severity === 'error').length
  io.writeLine(`form-check: ${String(findings.length)} finding(s)(${String(errorCount)} error)`)
  return errorCount > 0 ? 1 : 0
}

/** tenant-scan(T3.4):packages/* 隔离铁律静态检查;违规 error → 退出码 1。 */
function cmdTenantScan(io: CliIo): number {
  const findings = tenantScan(io.cwd)
  for (const finding of findings) {
    io.writeLine(`${finding.severity.toUpperCase()} ${finding.code} ${finding.path}: ${finding.message}`)
  }
  io.writeLine(`tenant-scan: ${findings.length} finding(s)`)
  return findings.length > 0 ? 1 : 0
}

/** prompt-scan(T2.5):提示词登记铁律静态检查;任何 finding(含缺豁免标注 warning)→ 退出码 1。 */
function cmdPromptScan(io: CliIo): number {
  const findings = promptScan(io.cwd)
  for (const finding of findings) {
    io.writeLine(`${finding.severity.toUpperCase()} ${finding.code} ${finding.path}: ${finding.message}`)
  }
  io.writeLine(`prompt-scan: ${findings.length} finding(s)`)
  return findings.length > 0 ? 1 : 0
}

function cmdInit(positional: readonly string[], flags: Readonly<Record<string, string | boolean>>, io: CliIo): number {
  const industry = positional[0]
  if (industry === undefined) {
    io.writeLine('用法: packctl init <industry> [--root <dir>]')
    return 2
  }
  const rootDir = typeof flags.root === 'string' ? flags.root : io.cwd
  const { result, findings } = initPack(industry, { rootDir })
  for (const f of findings) {
    io.writeLine(formatFinding(f))
  }
  if (result === undefined) return 1
  io.writeLine(`已生成 ${result.packDir}(${String(result.files.length)} 个文件):`)
  for (const rel of result.files) {
    io.writeLine(`  ${rel}`)
  }
  io.writeLine('下一步:cd 到包根跑 packctl lint(骨架应全绿),再按 06 号 SOP S1 分诊替换内容。')
  return 0
}

function resolvePackRoots(positional: readonly string[], io: CliIo): readonly string[] | number {
  const start = positional[0] !== undefined && positional[0].length > 0 ? positional[0] : io.cwd
  if (!isPackDir(start) && positional[0] !== undefined && positional[0].length > 0) {
    io.writeLine(`路径不是领域包根(缺 package.json + dsh.bundle): ${positional[0]}`)
    return 2
  }
  const roots = discoverPackRoots(start)
  if (roots.length === 0) {
    io.writeLine(`未找到领域包(需要 package.json 带 dsh.bundle 声明): ${start}`)
    return 2
  }
  return roots
}

function cmdLint(positional: readonly string[], flags: Readonly<Record<string, string | boolean>>, io: CliIo): number {
  const roots = resolvePackRoots(positional, io)
  if (typeof roots === 'number') return roots
  const results = lintPacks(roots)
  const json = flags.json === true
  if (json) {
    io.writeLine(JSON.stringify(results, null, 2))
  } else {
    for (const result of results) {
      io.writeLine(`pack: ${result.packRoot}`)
      if (result.findings.length === 0) {
        io.writeLine('  ✓ 无发现(lint 全绿)')
      }
      for (const f of result.findings) {
        io.writeLine(`  ${formatFinding(f)}`)
      }
    }
  }
  const errors = anyLintErrors(results)
  const errorCount = results.reduce((n, r) => n + r.findings.filter(f => f.severity === 'error').length, 0)
  const warnCount = results.reduce((n, r) => n + r.findings.filter(f => f.severity === 'warning').length, 0)
  if (!json) {
    io.writeLine(`lint ${errors ? '不通过' : '通过'}: ${String(errorCount)} error / ${String(warnCount)} warning,共 ${String(roots.length)} 个包`)
  }
  return errors ? 1 : 0
}

function cmdCheck(positional: readonly string[], io: CliIo): number {
  const roots = resolvePackRoots(positional, io)
  if (typeof roots === 'number') return roots
  let failed = false
  for (const root of roots) {
    const result = checkPack(root)
    io.writeLine(`pack: ${result.packRoot}`)
    for (const f of result.findings) {
      io.writeLine(`  ${formatFinding(f)}`)
    }
    if (hasErrors(result.findings)) failed = true
    if (result.skippedSpecifiers > 0) {
      io.writeLine(`  注: ${String(result.skippedSpecifiers)} 个包名式 bundle 引用需安装环境才能核验(静态冒烟跳过)`)
    }
  }
  return failed ? 1 : 0
}

function formatFinding(f: Finding): string {
  return `[${f.severity === 'error' ? 'E' : 'W'}][${f.code}] ${f.path}: ${f.message}`
}
