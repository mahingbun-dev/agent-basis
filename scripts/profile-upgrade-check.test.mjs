/**
 * profile-upgrade-check.mjs 单测（B1 / 54 §4.4 T12）：
 *   干净档、下架 bundle 留痕+非零、--apply-removals、缺失 bundle、坏 manifest/patch、
 *   dsh.bundle 形状、平台跳过、留痕幂等、CLI 退出码（gate≠0 / boot=0）、日志不落敏感值。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkProfile, probeBundle, RETIRED_BUNDLES } from './profile-upgrade-check.mjs'

const POSIX = process.platform !== 'win32'
const mode = path => statSync(path).mode & 0o777

const SCRIPT = fileURLToPath(new URL('./profile-upgrade-check.mjs', import.meta.url))
const RETIRED = [...RETIRED_BUNDLES][0]
const OTHER_PLATFORM = process.platform === 'win32' ? 'linux' : 'win32'

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function bundlePackage(dir, name, { patch = './cordis.patch.yml', platforms } = {}) {
  writeJson(join(dir, 'package.json'), { name, dsh: { bundle: platforms === undefined ? { patch } : { patch, platforms } } })
  if (patch !== undefined) writeFileSync(join(dir, typeof patch === 'string' ? patch : patch[0]), '- id: fixture\n  config:\n    id: fixture\n')
}

/** 假 dsh 安装树：install/node_modules/@deepseek-ai/dsh + dsh-base。 */
function fakeInstall(dir) {
  const root = join(dir, 'install')
  writeJson(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), { name: '@deepseek-ai/dsh', version: '0.2.2-rc.5' })
  bundlePackage(join(root, 'node_modules/@deepseek-ai/dsh-base'), '@deepseek-ai/dsh-base')
  return join(root, 'node_modules/@deepseek-ai/dsh/package.json')
}

/** 假 profile：manifest + 用户层 patch + 用户装品（profile/node_modules）。 */
function workspace({ bundles = ['@deepseek-ai/dsh-base', '@eterna/demo'], patch } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-upgrade-check-'))
  const profileDir = join(dir, 'profiles/eterna-web')
  const anchor = fakeInstall(dir)
  writeJson(join(profileDir, 'package.json'), { name: 'dsh-profile-eterna-web', private: true, dsh: { profile: { bundles } } })
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch ?? '- id: mcp-manager\n  config:\n    servers: {}\n')
  bundlePackage(join(profileDir, 'node_modules/@eterna/demo'), '@eterna/demo')
  return { dir, profileDir, anchor, tracePath: join(profileDir, '.upgrade-removed-bundles.json') }
}

const runCheck = (w, extra = {}) => checkProfile({ profileDir: w.profileDir, installAnchor: w.anchor, tracePath: w.tracePath, ...extra })

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

test('干净档：manifest/bundle/patch 全可解析，gate 通过且零留痕', () => {
  const w = workspace()
  const result = runCheck(w)
  assert.equal(result.ok, true)
  assert.deepEqual(result.bundles.map(item => [item.bundle, item.status]), [
    ['@deepseek-ai/dsh-base', 'ok'],
    ['@eterna/demo', 'ok'],
  ])
  assert.equal(result.traceWritten, false)
  assert.equal(existsSync(w.tracePath), false)
})

test('下架 bundle：gate 留痕并返回非 0；--apply-removals 备份并移除，二次零写', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base', RETIRED, '@eterna/demo'] })
  const gate = runCli([w.profileDir, '--install-anchor', w.anchor])
  assert.equal(gate.status, 1)
  assert.match(gate.stderr, /BAD .*retired/u)
  const trace = JSON.parse(readFileSync(w.tracePath, 'utf8'))
  assert.deepEqual(trace.bad.map(item => item.bundle), [RETIRED])
  assert.match(String(trace.bad[0].reason), /RETIRED_BUNDLES/u)
  if (POSIX) assert.equal(mode(w.tracePath), 0o600, '留痕文件必须 0600')

  const before = readFileSync(join(w.profileDir, 'package.json'), 'utf8')
  const applied = runCheck(w, { applyRemovals: true })
  assert.equal(applied.ok, true)
  assert.deepEqual(applied.removed, [RETIRED])
  assert.deepEqual(JSON.parse(readFileSync(join(w.profileDir, 'package.json'), 'utf8')).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@eterna/demo'])
  assert.notEqual(readFileSync(join(w.profileDir, 'package.json'), 'utf8'), before)
  assert.equal(readdirSync(w.profileDir).some(name => /package\.json\.bak-/.test(name)), true)

  // 二次 --apply-removals：已无下架项 → 清单与留痕均零写。
  const manifestAfter = readFileSync(join(w.profileDir, 'package.json'), 'utf8')
  const traceAfter = readFileSync(w.tracePath, 'utf8')
  const again = runCheck(w, { applyRemovals: true })
  assert.equal(again.removed.length, 0)
  assert.equal(again.traceWritten, false)
  assert.equal(readFileSync(join(w.profileDir, 'package.json'), 'utf8'), manifestAfter)
  assert.equal(readFileSync(w.tracePath, 'utf8'), traceAfter)
  // 复检不丢移除历史：留痕仍记得下架项与备份路径。
  assert.deepEqual(JSON.parse(traceAfter).removed, [RETIRED])
  assert.match(String(JSON.parse(traceAfter).backup), /package\.json\.bak-/u)
})

test('缺失 bundle：gate 失败仍写留痕；--boot 退出 0（boot 不炸）', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base', '@eterna/not-installed'] })
  const gate = runCli([w.profileDir, '--install-anchor', w.anchor])
  assert.equal(gate.status, 1)
  const trace = JSON.parse(readFileSync(w.tracePath, 'utf8'))
  assert.equal(trace.bad[0].status, 'missing')
  const boot = runCli([w.profileDir, '--install-anchor', w.anchor, '--boot', '--json'])
  assert.equal(boot.status, 0)
  assert.equal(JSON.parse(boot.stdout).ok, false)
})

test('坏 package.json：gate 非 0、留痕 manifestError、boot 退出 0', () => {
  const w = workspace()
  writeFileSync(join(w.profileDir, 'package.json'), '{ not json')
  const gate = runCli([w.profileDir, '--install-anchor', w.anchor])
  assert.equal(gate.status, 1)
  const trace = JSON.parse(readFileSync(w.tracePath, 'utf8'))
  assert.match(String(trace.manifestError), /JSON 解析失败/u)
  assert.equal(runCli([w.profileDir, '--install-anchor', w.anchor, '--boot']).status, 0)
})

test('坏 patch：gate 非 0、patch 原样保留、留痕 patchError、boot 退出 0', () => {
  const w = workspace({ patch: 'a: [unclosed\n' })
  const before = readFileSync(join(w.profileDir, 'cordis.patch.yml'), 'utf8')
  const gate = runCli([w.profileDir, '--install-anchor', w.anchor])
  assert.equal(gate.status, 1)
  assert.match(gate.stderr, /cordis\.patch\.yml 解析失败/u)
  assert.equal(readFileSync(join(w.profileDir, 'cordis.patch.yml'), 'utf8'), before)
  const trace = JSON.parse(readFileSync(w.tracePath, 'utf8'))
  assert.match(String(trace.patchError), /解析失败/u)
  assert.equal(runCli([w.profileDir, '--install-anchor', w.anchor, '--boot']).status, 0)
})

test('坏 patch 的 YAML 报错不打印 code frame（patch 内令牌值不落日志）', () => {
  const secret = 'rl-do-not-log-0123456789'
  const w = workspace({ patch: `- id: mcp-browser\n  config:\n    env:\n      ETNA_RELAY_TOKEN: ${String(secret)}\n    broken: [unclosed\n` })
  const gate = runCli([w.profileDir, '--install-anchor', w.anchor])
  assert.equal(gate.status, 1)
  assert.doesNotMatch(`${gate.stdout}${gate.stderr}`, new RegExp(secret, 'u'))
  const traceText = readFileSync(w.tracePath, 'utf8')
  assert.doesNotMatch(traceText, new RegExp(secret, 'u'))
})

test('bundle 形状：未声明 dsh.bundle / patch 文件缺失均判 invalid', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base', '@eterna/no-bundle', '@eterna/no-patch'] })
  writeJson(join(w.profileDir, 'node_modules/@eterna/no-bundle/package.json'), { name: '@eterna/no-bundle' })
  writeJson(join(w.profileDir, 'node_modules/@eterna/no-patch/package.json'), { name: '@eterna/no-patch', dsh: { bundle: { patch: './missing.patch.yml' } } })
  const result = runCheck(w)
  assert.equal(result.ok, false)
  assert.deepEqual(result.bad.map(item => [item.bundle, item.status]), [
    ['@eterna/no-bundle', 'invalid'],
    ['@eterna/no-patch', 'invalid'],
  ])
})

test('平台不匹配：判 platform-skipped（dsh 有意跳过，不算坏项）', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base', '@eterna/other-platform'] })
  bundlePackage(join(w.profileDir, 'node_modules/@eterna/other-platform'), '@eterna/other-platform', { platforms: [OTHER_PLATFORM] })
  const result = runCheck(w)
  assert.equal(result.ok, true)
  assert.equal(result.bundles.find(item => item.bundle === '@eterna/other-platform').status, 'platform-skipped')
})

test('留痕幂等：同一坏项重复检查不重写（checkedAt 保持首次发现时间）', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base', '@eterna/not-installed'] })
  const first = runCheck(w)
  assert.equal(first.traceWritten, true)
  const firstText = readFileSync(w.tracePath, 'utf8')
  const firstMtime = readFileSync(w.tracePath, 'utf8')
  // 人为把 mtime 拨回，避免同毫秒内写入导致假阴性。
  utimesSync(w.tracePath, new Date(2000, 0, 1), new Date(2000, 0, 1))
  const second = runCheck(w)
  assert.equal(second.traceWritten, false)
  assert.equal(readFileSync(w.tracePath, 'utf8'), firstText)
  assert.equal(readFileSync(w.tracePath, 'utf8'), firstMtime)
})

test('probeBundle 直接面：安装锚点优先于 profile 锚点（同名双份取安装）', () => {
  const w = workspace({ bundles: ['@deepseek-ai/dsh-base'] })
  bundlePackage(join(w.profileDir, 'node_modules/@deepseek-ai/dsh-base'), '@deepseek-ai/dsh-base')
  const item = probeBundle('@deepseek-ai/dsh-base', [w.anchor, join(w.profileDir, 'package.json')])
  assert.equal(item.status, 'ok')
  assert.match(item.dir, /install\/node_modules\/@deepseek-ai\/dsh-base$/u)
})