#!/usr/bin/env node
/**
 * profile 升级预检（B1；47 §B1 / 49 D3 / 50 WP2-2 / 54 §4.4 T12）。
 *
 * 检查持久化 profile 的三样东西能否解析：
 *   1. profiles/<name>/package.json —— JSON 可解析，dsh.profile.bundles 是字符串数组；
 *   2. profiles/<name>/cordis.patch.yml —— YAML 可解析，顶层是补丁数组（文件缺失只告警：
 *      dsh 把用户层 patch 视为可选）；
 *   3. 每个 bundle 名能否解析到可装载的包。解析顺序与 dsh app-boot 一致：
 *      「dsh 安装锚点 → profile 锚点」，见 deepseek-harness
 *      packages/boot/app-boot/src/profile.ts:525-541（resolveBundleDir）。解析到包后
 *      再验 dsh.bundle 声明与声明的 patch 文件存在（同 profile.ts:54-71）。
 *
 * 留痕（47 §B1 第 4 条「移植后校验可解析，坏项打印告警并写入
 * profiles/<name>/.upgrade-removed-bundles.json」）：
 *   - 坏项 = 上游已下架（RETIRED_BUNDLES，镜像 dsh-official-bundles/src/bundles.ts:37-42）、
 *     解析不到、package.json 不可读、未声明 dsh.bundle / patch 文件缺失；
 *   - 留痕文件 0600，内容语义不变时不重写（checkedAt 不参与比较）；
 *   - --apply-removals 只把「上游已下架」的项从 package.json 移除（写前备份
 *     package.json.bak-<ts>）；其余坏项只留痕不自作主张删除——用户装品可能只需重装，
 *     自动删除会静默丢插件。
 *
 * 退出码（54 §4.4 T12「坏 bundle 留痕并返回非 0，boot 不炸」）：
 *   gate（缺省）: 0 = 干净；1 = 有坏项或解析失败（升级门禁拒绝）；2 = 用法错误
 *   boot（--boot）: 恒 0（用法错误除外）——entrypoint 用。「boot 不炸」= 预检自身
 *     绝不阻塞启动；坏项由 dsh 跳过（profile.ts:543-551 的 skippedBundles 语义）。
 *
 * 红线：只读包名/结构。YAML 报错只留首行 + 行列，不打印 code frame——patch 的
 * env 值/令牌占位不进日志或留痕文件。
 *
 * 用法：
 *   node scripts/profile-upgrade-check.mjs <profile 目录> [选项]
 *     --install-anchor <package.json 或包目录>  dsh 安装锚点（缺省自动探测）
 *     --trace <path>                            留痕路径（缺省 <profile>/.upgrade-removed-bundles.json）
 *     --boot                                    boot 模式（恒 0）
 *     --apply-removals                          移除上游已下架 bundle（先备份）
 *     --json                                    stdout 输出机读汇总
 */
import { copyFileSync, chmodSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const TAG = '[profile-upgrade-check]'
const TRACE_FILENAME = '.upgrade-removed-bundles.json'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 上游已下架的 bundle（镜像 dsh-official-bundles/src/bundles.ts:37-42）。 */
export const RETIRED_BUNDLES = new Set([
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  '@deepseek-ai/dsh-experimental-agent-team-profile',
])

const BAD_STATUSES = new Set(['retired', 'missing', 'unreadable', 'invalid'])

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/** yaml 从 tools/packctl 的依赖树解析（容器内 /repo 同仓 pnpm install 存在）。 */
function loadYaml() {
  const requireFromPackctl = createRequire(new URL('../tools/packctl/package.json', import.meta.url))
  try {
    return requireFromPackctl('yaml')
  } catch (error) {
    throw new Error(`yaml 依赖不可解析（期望 tools/packctl/node_modules/yaml）:${error?.message ?? error}`)
  }
}

/** YAML 错误只留首行 + 行列：message 的后续行是 code frame（含源码文本）。 */
function summarizeYamlError(error) {
  const first = String(error?.message ?? error).split('\n')[0].slice(0, 240)
  const pos = Array.isArray(error?.linePos) ? error.linePos[0] : undefined
  if (pos === undefined || /at line \d+/u.test(first)) return first
  return `${first} (line ${pos.line}, column ${pos.col})`
}

function readManifestText(path) {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { error: error?.code === 'ENOENT' ? 'package.json 不存在' : `package.json 不可读(${error?.code ?? 'EUNKNOWN'})` }
  }
}

/** 判定 profile package.json：JSON 对象 + dsh.profile.bundles 形状。 */
export function checkManifest(profileDir) {
  const path = join(profileDir, 'package.json')
  const read = readManifestText(path)
  if (read.error !== undefined) return { path, error: read.error }
  let manifest
  try {
    manifest = JSON.parse(read.text)
  } catch (error) {
    return { path, error: `package.json JSON 解析失败(${error?.message ?? error})` }
  }
  if (!isRecord(manifest)) return { path, manifest, error: 'package.json 顶层不是对象' }
  const bundles = manifest.dsh?.profile?.bundles
  if (bundles === undefined) {
    return { path, manifest, bundles: [], warnings: ['dsh.profile.bundles 缺失（按空清单预检）'] }
  }
  if (!Array.isArray(bundles) || !bundles.every(item => typeof item === 'string')) {
    return { path, manifest, error: 'dsh.profile.bundles 不是字符串数组' }
  }
  return { path, manifest, bundles }
}

/** 判定 profile cordis.patch.yml：缺失=告警（dsh 可选用户层），存在=必须解析成数组。 */
export function checkUserPatch(profileDir) {
  const path = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(path)) return { path, status: 'absent', warnings: ['cordis.patch.yml 缺失（dsh 按无用户层处理）'] }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { path, error: `cordis.patch.yml 不可读(${error?.code ?? 'EUNKNOWN'})` }
  }
  let data
  try {
    const { parseDocument } = loadYaml()
    const doc = parseDocument(text, { strict: false })
    if (doc.errors.length > 0) throw new Error(summarizeYamlError(doc.errors[0]))
    data = doc.toJS()
  } catch (error) {
    return { path, error: `cordis.patch.yml 解析失败:${error?.message ?? error}` }
  }
  if (!Array.isArray(data)) return { path, error: 'cordis.patch.yml 顶层不是补丁数组' }
  return { path, status: 'ok', blocks: data.length }
}

/** 安装锚点：显式 → env → 仓库 node_modules → PATH 上的 dsh 包。 */
export function resolveInstallAnchor(explicit) {
  const candidates = []
  if (explicit !== undefined) candidates.push(explicit)
  if (process.env.DSH_INSTALL_ANCHOR !== undefined && process.env.DSH_INSTALL_ANCHOR !== '') candidates.push(process.env.DSH_INSTALL_ANCHOR)
  candidates.push(join(REPO_ROOT, 'node_modules/@deepseek-ai/dsh/package.json'))
  for (const candidate of candidates) {
    const anchor = normalizeAnchor(candidate)
    if (anchor !== undefined) return anchor
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const bin = join(dir, 'dsh')
    if (!existsSync(bin)) continue
    const anchor = dshPackageJsonNear(bin)
    if (anchor !== undefined) return anchor
  }
  return undefined
}

function normalizeAnchor(candidate) {
  const absolute = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate)
  if (!existsSync(absolute)) return undefined
  try {
    const real = realpathSync(absolute)
    return statSync(real).isDirectory() ? join(real, 'package.json') : real
  } catch {
    return undefined
  }
}

function dshPackageJsonNear(bin) {
  let current
  try {
    current = realpathSync(bin)
  } catch {
    return undefined
  }
  for (let depth = 0; depth < 5; depth++) {
    const dir = dirname(current)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === '@deepseek-ai/dsh') return manifest
      } catch { /* 继续向上 */ }
    }
    current = dir
  }
  return undefined
}

/** Node 自身的 node_modules 查找序（与 dsh profile.ts:509-520 同款）。 */
export function packageDirFromAnchor(anchor, name) {
  if (anchor === undefined || !existsSync(anchor)) return undefined
  for (const searchPath of createRequire(anchor).resolve.paths(name) ?? []) {
    const candidate = join(searchPath, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** 单 bundle 预检：下架 → 解析 → manifest → dsh.bundle → patch 文件 → 平台。 */
export function probeBundle(name, anchors) {
  if (RETIRED_BUNDLES.has(name)) {
    return { bundle: name, status: 'retired', reason: '上游 RETIRED_BUNDLES 已下架（47 §B1 迁移规则：删除该 bundle 项）' }
  }
  let dir
  for (const anchor of anchors) {
    dir = packageDirFromAnchor(anchor, name)
    if (dir !== undefined) break
  }
  if (dir === undefined) {
    return { bundle: name, status: 'missing', reason: 'dsh 安装锚点与 profile 锚点均无法解析到 package.json' }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return { bundle: name, status: 'unreadable', reason: `包内 package.json 不可读/非 JSON（${dir}）` }
  }
  const bundle = manifest?.dsh?.bundle
  if (!isRecord(bundle)) {
    return { bundle: name, status: 'invalid', reason: '未声明 dsh.bundle（dsh 会跳过该层）' }
  }
  const declared = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  if (!Array.isArray(declared) || declared.length === 0 || !declared.every(file => typeof file === 'string')) {
    return { bundle: name, status: 'invalid', reason: 'dsh.bundle.patch 不是文件路径或路径数组' }
  }
  const missingPatch = declared.find(file => !existsSync(join(dir, file)))
  if (missingPatch !== undefined) {
    return { bundle: name, status: 'invalid', reason: `bundle patch 文件缺失：${missingPatch}` }
  }
  const platforms = bundle.platforms
  if (platforms !== undefined) {
    if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every(value => typeof value === 'string')) {
      return { bundle: name, status: 'invalid', reason: 'dsh.bundle.platforms 不是非空平台名数组' }
    }
    if (!platforms.includes(process.platform)) {
      return { bundle: name, status: 'platform-skipped', reason: `当前平台 ${process.platform} 不在 bundle.platforms 内（dsh 有意跳过）` }
    }
  }
  return { bundle: name, status: 'ok', dir }
}

/** 移除上游下架项：先备份 package.json，再写 2 空格 + 尾换行（与 dsh writeProfileManifest 同格式）。 */
function applyRetiredRemovals({ profileDir, manifest, retired }) {
  const backup = join(profileDir, `package.json.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  copyFileSync(join(profileDir, 'package.json'), backup)
  const bundles = manifest.dsh.profile.bundles.filter(name => !retired.includes(name))
  const next = { ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(next, null, 2)}\n`)
  return backup
}

/** 留痕：内容语义不变时不重写（checkedAt 只是首次发现时间）；已移除记录沿用上一份，不因后续复检而丢历史。 */
function writeTrace(tracePath, payload) {
  const body = { ...payload }
  delete body.checkedAt
  let previous
  if (existsSync(tracePath)) {
    try {
      const parsed = JSON.parse(readFileSync(tracePath, 'utf8'))
      const previousBody = { ...parsed }
      delete previousBody.checkedAt
      previous = previousBody
    } catch { /* 坏文件按需覆盖 */ }
  }
  if (previous !== undefined) {
    if (Array.isArray(previous.removed) && previous.removed.length > 0) {
      body.removed = [...new Set([...(body.removed ?? []), ...previous.removed])].sort()
      if ((body.backup === null || body.backup === undefined) && typeof previous.backup === 'string') body.backup = previous.backup
    }
  }
  if (previous !== undefined && isDeepStrictEqual(previous, body)) return { written: false }
  writeFileSync(tracePath, `${JSON.stringify({ checkedAt: new Date().toISOString(), ...body }, null, 2)}\n`, { mode: 0o600 })
  try { chmodSync(tracePath, 0o600) } catch { /* 非 POSIX 卷忽略 */ }
  return { written: true }
}

/**
 * 预检主体（测试用显式路径）。
 * @returns {{ok:boolean, mode:string, profileDir:string, installAnchor?:string, tracePath:string,
 *   traceWritten:boolean, bundles:object[], bad:object[], removed:string[], warnings:string[],
 *   manifestError?:string, patchError?:string}}
 */
export function checkProfile({ profileDir, installAnchor, tracePath, mode = 'gate', applyRemovals = false }) {
  const dir = resolve(profileDir)
  const manifestResult = checkManifest(dir)
  const patchResult = checkUserPatch(dir)
  const warnings = [...(manifestResult.warnings ?? []), ...(patchResult.warnings ?? [])]
  const bad = []
  let bundles = []
  let removed = []
  let backup
  if (manifestResult.error !== undefined) {
    bad.push({ bundle: '(package.json)', status: 'manifest', reason: manifestResult.error })
  } else {
    const anchors = [installAnchor, join(dir, 'package.json')].filter(anchor => anchor !== undefined)
    bundles = manifestResult.bundles.map(name => probeBundle(name, anchors))
    const retired = bundles.filter(item => item.status === 'retired').map(item => item.bundle)
    if (applyRemovals && retired.length > 0) {
      backup = applyRetiredRemovals({ profileDir: dir, manifest: manifestResult.manifest, retired })
      removed = retired
      bundles = bundles.map(item => item.status === 'retired' ? { ...item, status: 'removed-by-check' } : item)
    }
  }
  for (const item of bundles) {
    if (BAD_STATUSES.has(item.status)) bad.push(item)
  }
  if (patchResult.error !== undefined) bad.push({ bundle: '(cordis.patch.yml)', status: 'patch', reason: patchResult.error })
  const trace = resolve(tracePath ?? join(dir, TRACE_FILENAME))
  let traceWritten = false
  if (bad.length > 0 || removed.length > 0) {
    traceWritten = writeTrace(trace, {
      version: 1,
      profileDir: dir,
      profile: basename(dir),
      mode,
      removed,
      backup: backup ?? null,
      manifestError: manifestResult.error ?? null,
      patchError: patchResult.error ?? null,
      bad: bad.map(item => ({ bundle: item.bundle, status: item.status, reason: item.reason })),
    }).written
  }
  return {
    ok: bad.length === 0,
    mode,
    profileDir: dir,
    installAnchor: installAnchor === undefined ? undefined : installAnchor,
    tracePath: trace,
    traceWritten,
    bundles,
    bad,
    removed,
    backup,
    warnings,
    manifestError: manifestResult.error,
    patchError: patchResult.error,
  }
}

function parseArgs(argv) {
  const options = { mode: 'gate', applyRemovals: false, json: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--install-anchor') options.installAnchor = argv[++i]
    else if (arg === '--trace') options.tracePath = argv[++i]
    else if (arg === '--boot') options.mode = 'boot'
    else if (arg === '--gate') options.mode = 'gate'
    else if (arg === '--apply-removals') options.applyRemovals = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--') continue
    else if (arg.startsWith('-')) return { error: `未知选项 ${arg}` }
    else positional.push(arg)
  }
  if (options.help) return { options }
  if (positional.length !== 1) return { error: '需要一个 profile 目录参数' }
  options.profileDir = positional[0]
  return { options }
}

function printReport(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      mode: result.mode,
      profileDir: result.profileDir,
      installAnchor: result.installAnchor ?? null,
      tracePath: result.tracePath,
      traceWritten: result.traceWritten,
      bundles: result.bundles.map(item => ({ bundle: item.bundle, status: item.status, reason: item.reason })),
      removed: result.removed,
      warnings: result.warnings,
    }, null, 2)}\n`)
    return
  }
  const counts = {}
  for (const item of result.bundles) counts[item.status] = (counts[item.status] ?? 0) + 1
  const summary = Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(' ')
  console.log(`${TAG}: profile=${basename(result.profileDir)} mode=${result.mode} installAnchor=${result.installAnchor ?? '(未找到：仅 profile 锚点)'} bundles[${summary || 'none'}]`)
  for (const warning of result.warnings) console.log(`${TAG}: WARN ${warning}`)
  for (const item of result.bad) console.error(`${TAG}: BAD ${item.bundle} [${item.status}] ${item.reason}`)
  for (const name of result.removed) console.log(`${TAG}: REMOVED ${name}（备份 ${result.backup}）`)
  if (result.traceWritten) console.log(`${TAG}: 留痕 ${result.tracePath}`)
  if (result.ok) console.log(`${TAG}: OK 无坏项`)
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error !== undefined) {
    console.error(`${TAG}: ${parsed.error}；用法: profile-upgrade-check.mjs <profile 目录> [--install-anchor <path>] [--trace <path>] [--boot] [--apply-removals] [--json]`)
    process.exit(2)
  }
  const { options } = parsed
  if (options.help) {
    console.log('用法: profile-upgrade-check.mjs <profile 目录> [--install-anchor <path>] [--trace <path>] [--boot] [--apply-removals] [--json]')
    return
  }
  let result
  try {
    const installAnchor = resolveInstallAnchor(options.installAnchor)
    result = checkProfile({ profileDir: options.profileDir, installAnchor, tracePath: options.tracePath, mode: options.mode, applyRemovals: options.applyRemovals })
  } catch (error) {
    // 预检自身异常也不许炸 boot；gate 下按失败返回。
    console.error(`${TAG}: ERROR 预检异常（不阻塞 boot 模式）: ${error?.message ?? error}`)
    process.exit(options.mode === 'boot' ? 0 : 1)
  }
  printReport(result, options)
  if (options.mode === 'boot') return
  if (!result.ok) {
    console.error(`${TAG}: 预检失败（坏项见上；升级门禁拒绝）`)
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()