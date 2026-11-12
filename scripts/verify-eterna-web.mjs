#!/usr/bin/env node
/**
 * Real-boot verification for the Eterna enterprise Web 档 (profiles/eterna-web).
 *
 * Boots the actual composition — @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app
 * + profiles/eterna-web/cordis.patch.yml — with the repo-local dsh CLI (no model
 * calls, no credentials, OS-assigned port via --port 0), then asserts against the
 * LIVE pluginInventory/list Remote (read-only projection of the settled Loader
 * tree) that:
 *   - every cut row is absent or disabled, in the host tree AND in every agent
 *     preset composition (a preset re-enabling a cut row is a failure);
 *   - every kept host row is present, enabled, and ACTIVE;
 *   - every kept preset row is present, enabled, and ACTIVE in the default
 *     `standard` preset;
 *   - no entry sits in the `failed` phase (catches broken injection chains that
 *     a future upstream refresh could introduce);
 *   - T1.2 生产挂载（ps-v2）：eterna-prompt-studio 行 present+enabled+active，
 *     启动日志无 skipping/incompatible，宿主 index.html 的 __DSH_BOOT__ 花名册
 *     含 @eterna/prompt-studio/client.js 且 combo 含本包 factory 注册。
 *
 * dump-config is deliberately NOT used: it only proves patch text, not row
 * activation (2026-11-04 E2E 教训). The readiness signal is the `dsh web: <url>`
 * stdout line, which the web-runtime row prints only after the Loader settled
 * and the required-entry startup audit passed (dsh-web-app src/index.ts:244-254).
 *
 * Environment:
 *   ETERNA_PROFILE_HOME — DSH home to materialize the profile in
 *                        (default: <repo>/.eterna-home)
 *
 * Exit 0 = all assertions passed; exit 1 = boot or assertion failure.
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const sourcePatch = join(repoRoot, 'profiles', 'eterna-web', 'cordis.patch.yml')
const home = resolve(process.env.ETERNA_PROFILE_HOME ?? join(repoRoot, '.eterna-home'))
const profileName = 'eterna-web'
const profileDir = join(home, 'profiles', profileName)

const BOOT_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000

/** Rows the enterprise Web 档 cuts (plans §11.2/§11.3/§11.8; credentials 见 docs 偏差说明). */
const CUT_ROWS = [
  // 遥测两处
  'otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics',
  // 凭据库 + 账号体系（credentials 保留：connection 必需行硬依赖，见 docs）
  'authorization', 'deepseek-account', 'llm-deepseek', 'llm-deepseek-account',
  'account-controller', 'ui-settings-account',
  // ptc 家族修订（2026-11-09）：创造模式（preset-cordis）回加后 ptc-runtime/
  // workflow-ptc/tool-workflow 三行宿主回加（workflow-ptc 硬依赖 ptcRuntime
  // 服务）；仅 tool-executor-ptc 维持裁切。标准会话经 preset-standard 内
  // disabled 不可见。另本就 disabled 的两行
  'tool-executor-ptc', 'fs-observation-policy', 'tool-plugin-manager', 'ui-workflow-run',
  // 场景裁切（shortcuts 不在此列：client 服务根，2026-11-09 浏览器 E2E 教训——
  // 裁掉即 26 个 client-ui 插件 web boot 全家 pending，宿主侧断言照绿）
  'office-to-pdf', 'open-in-app', 'ui-open-in-app', 'ui-shortcuts',
  'ui-brand-official', 'ui-message-feedback',
  // Session Log 上传（2026-11-09 用户裁定：通用设置去掉该开关，上传能力一并裁——数据不出内网）
  'session-log-deepseek', 'ui-settings-session-log',
]

/** Kept rows that live in the HOST plane: present + enabled + active. */
const HOST_KEPT_ROWS = [
  // 基础能力骨架
  'llm', 'llm-retry', 'session', 'session-persistence-jsonl', 'session-checkpoint-policy',
  'spill-local', 'spill-policy', 'image-offload', 'agent', 'agent-loop', 'agent-default-model',
  'system-prompt', 'tools', 'tool-executor-native', 'fs-sandbox', 'sandbox', 'sandbox-policy',
  'bash-sandbox', 'approval', 'permission', 'shell-env', 'subprocess', 'jobs', 'timeout-policy',
  'repeat-tool-reminder', 'token-meter', 'commands', 'command-feedback', 'user-questions',
  'working-directory', 'tool-working-directory', 'session-projection', 'session-projection-cache',
  'storage', 'storage-json', 'storage-domain', 'attachment-local', 'mcp-resources',
  // 回加家族（host 半）
  'goal', 'goal-round-driver', 'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process',
  'schedule', 'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http',
  // 创造模式宿主行（2026-11-09 回加：workflow-ptc 硬依赖 ptcRuntime）
  'ptc-runtime', 'workflow-ptc', 'tool-workflow',
  // skill / title / query
  'skill', 'session-title', 'session-title-llm', 'session-query-sqlite',
  // Web 网关与传输
  'typert', 'typert-loader', 'typert-gateway', 'remote-access', 'timer',
  'webserver', 'web-runtime', 'web-startup', 'connection', 'modules', 'plugin-inventory',
  // jobs/报告异步化（图纸⑦）
  'job-controller', 'ui-jobs', 'deliverable-file-references',
  // UI：审批/上传/设置/交付
  'ui-chat', 'ui-conversation', 'ui-approval', 'ui-permission', 'ui-user-questions',
  'ui-attachment', 'ui-tool', 'ui-renderer', 'settings-controller', 'ui-settings',
  'ui-settings-models', 'ui-deliverables', 'ui-skill', 'session-log-download',
  'session-controller', 'session-stats', 'session-turn-outline',
  // 回加 UI（§11.8）
  'ui-schedule', 'ui-goal', 'ui-plan', 'ui-subagent', 'subagent-model-selection-settings',
  'ui-sidebar-browser', 'ui-sidebar-terminal', 'terminal-controller',
  // workspace 与预设
  'workspace', 'workspace-controller', 'workspace-files', 'file-upload', 'file-reference-local',
  'locale', 'ui-theme', 'agent-preset-registry',
  // client 服务根（§11.3 修订：浏览器 E2E 实测 26 插件等待链的根，必留）
  'shortcuts',
  // 计划书偏差说明的实证行：必须保持启用
  'credentials',
  // 提示词工作室（T1.2 生产挂载，insert 行 + profile node_modules symlink）
  'eterna-prompt-studio',
]

/** Kept rows that live behind agent presets: present + enabled + active in `standard`. */
const PRESET_KEPT_ROWS = [
  'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-schedule',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner',
  'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork',
  'tool-todo', 'tool-web', 'agent-instructions', 'tool-ask-user',
]

// ---------------------------------------------------------------------------
// 1. Materialize the profile under the DSH home.

if (!existsSync(dshBin)) {
  console.error(`verify-eterna-web: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(sourcePatch)) {
  console.error(`verify-eterna-web: missing ${sourcePatch}`)
  process.exit(1)
}
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-eterna-web: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point ETERNA_PROFILE_HOME at a clean home`)
  process.exit(1)
}

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
// 创造模式（preset-cordis）硬依赖：skill-filesystem 的 customSkillDirs 表达式
// 以 createRequire(baseUrl) 解析 @deepseek-ai/dsh-agent-preset（baseUrl=profile
// 目录）——必须把该包链接进 profile node_modules，否则 skill-filesystem 条目
// failed（2026-11-09 实测 MODULE_NOT_FOUND）。rc.1 已钉版，取 .pnpm 内唯一实装。
const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
const presetCandidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).filter((dir) => dir.startsWith('@deepseek-ai+dsh-agent-preset@0.2.2-rc.1'))
  : []
if (presetCandidates.length === 0) {
  console.error('verify-eterna-web: @deepseek-ai/dsh-agent-preset@0.2.2-rc.1 未安装——创造模式 skill 目录无法解析')
  process.exit(1)
}
const agentPresetDir = join(pnpmDir, presetCandidates[0], 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
const profileNodeModules = join(profileDir, 'node_modules', '@deepseek-ai')
mkdirSync(profileNodeModules, { recursive: true })
symlinkSync(agentPresetDir, join(profileNodeModules, 'dsh-agent-preset'), 'dir')
// companion 浏览器执行面（E1）：dsh-mcp-client 插件（mcp-browser 条目的 name 引用）
const mcpClientCandidates = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).filter((dir) => dir.startsWith('@deepseek-ai+dsh-mcp-client@0.2.2-rc.1'))
  : []
if (mcpClientCandidates.length === 0) {
  console.error('verify-eterna-web: @deepseek-ai/dsh-mcp-client@0.2.2-rc.1 未安装——mcp-browser 条目无法解析')
  process.exit(1)
}
const mcpClientDir = join(pnpmDir, mcpClientCandidates[0], 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
symlinkSync(mcpClientDir, join(profileNodeModules, 'dsh-mcp-client'), 'dir')
// 提示词工作室（T1.2 生产挂载）：insert 行 name 解析 '@eterna/prompt-studio' 经
// profile node_modules（Loader + client-modules 两个消费方都只按 node_modules 解析，
// 不读 profile 依赖表——t7-smoke.mjs ensurePluginInstalled 同款 symlink 终态；
// realpath 落 repo 源树，运行时依赖走 repo 工作区）。
const promptStudioPkg = join(repoRoot, 'packages', 'prompt-studio')
if (!existsSync(join(promptStudioPkg, 'lib', 'client.js'))) {
  console.error('verify-eterna-web: packages/prompt-studio/lib/client.js 缺失——先跑 pnpm --filter @eterna/prompt-studio run verify（build:client）')
  process.exit(1)
}
mkdirSync(join(profileDir, 'node_modules', '@eterna'), { recursive: true })
symlinkSync(promptStudioPkg, join(profileDir, 'node_modules', '@eterna', 'prompt-studio'), 'dir')
// 上下文压缩家族（2026-11-12 fork 本地化）：compaction group 三行 name 解析
// '@eterna/compaction/*-plugin' 同样只经 profile node_modules。缺此行时三行解析失败，
// 整组 standard 预设行静默不激活（fiberPhase=null）——与 entrypoint 记载的
// @deepseek-ai 版本错配同一种「静默 disable」表现。
symlinkSync(join(repoRoot, 'packages', 'compaction'), join(profileDir, 'node_modules', '@eterna', 'compaction'), 'dir')
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-${profileName}`,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const copied = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
if (copied !== readFileSync(sourcePatch, 'utf8')) {
  console.error('verify-eterna-web: profile patch copy drifted from the source file')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Boot.

const child = spawn(process.execPath, [dshBin, '--profile', profileName, '--no-open', '--port', '0'], {
  cwd: repoRoot,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const output = []
const collect = (stream, sink) => {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    sink(chunk)
    output.push(chunk)
  })
}
collect(child.stdout, () => {})
collect(child.stderr, () => {})

let urlLine
try {
  urlLine = await new Promise((resolveLine, rejectLine) => {
    const timer = setTimeout(() => rejectLine(new Error(`boot did not print the readiness line within ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS)
    const check = () => {
      const match = output.join('').match(/^dsh web: (\S+)$/m)
      if (match) {
        clearTimeout(timer)
        resolveLine(match[1])
      }
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectLine(new Error(`dsh exited early with code ${code}`))
    })
    check()
  })
} catch (error) {
  await stop(child)
  console.error(`verify-eterna-web: boot failed: ${error.message}`)
  console.error('--- dsh output ---')
  console.error(output.join(''))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Probe the live inventory.

const result = await probe(urlLine)
// T1.2 生产挂载的浏览器半边证据：宿主 index.html 的 __DSH_BOOT__ 花名册须含
// 本包 client.js（须在 stop 前对活宿主取证；三步换票照抄 t7-ui-check.mjs:96-110）。
const roster = await probeRoster(urlLine)
await stop(child)

if (!result.ok) {
  console.error(`verify-eterna-web: pluginInventory/list failed: ${JSON.stringify(result.error)}`)
  process.exit(1)
}
const snapshot = result.value
const hostByEntry = new Map(snapshot.entries.map((entry) => [entry.entryId.replace(/^include:/, ''), entry]))
const presetByName = new Map((snapshot.agentPresets ?? []).map((preset) => [preset.id, preset]))

const failures = []
const pass = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// 3-pre. T1.2 生产挂载：启动日志洁净（无 skipping/incompatible——装载被跳过或
// 版本不兼容时宿主只打日志不进 failed 相位，t7-ui-check.mjs:127 同款口径）。
pass('boot log clean (no skipping/incompatible)', !/skipping|incompatible/i.test(output.join('')),
  'boot + probe 期间 stdout/stderr 无装载跳过或版本不兼容记录')

// 3a. No failed rows: a failed row means an injection chain broke (e.g. a cut
// row still has a hard consumer) — fatal even when the audit only warns.
const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
pass('no failed entries', failed.length === 0,
  failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)

// 3b. Cut rows: absent or disabled in the host tree, and not enabled in any preset.
const cutViolations = []
for (const id of CUT_ROWS) {
  const host = hostByEntry.get(id)
  if (host !== undefined && host.enabled) cutViolations.push(`${id}: host entry enabled`)
  for (const preset of presetByName.values()) {
    const row = preset.rows.find((candidate) => candidate.entryId === id)
    if (row !== undefined && row.enabled) cutViolations.push(`${id}: enabled in preset ${preset.id}`)
  }
}
pass(`all ${CUT_ROWS.length} cut rows inactive`, cutViolations.length === 0, cutViolations.join('; ') || 'absent or disabled everywhere')

// 3c. Host kept rows: present, enabled, active.
const hostMissing = HOST_KEPT_ROWS.filter((id) => !hostByEntry.has(id))
const hostInactive = HOST_KEPT_ROWS.filter((id) => {
  const host = hostByEntry.get(id)
  return host !== undefined && (!host.enabled || host.fiberPhase !== 'active')
})
pass(`all ${HOST_KEPT_ROWS.length} kept host rows enabled+active`,
  hostMissing.length === 0 && hostInactive.length === 0,
  [...hostMissing.map((id) => `${id}: absent`), ...hostInactive.map((id) => `${id}: ${describe(hostByEntry.get(id))}`)].join('; ') || 'active in the settled Loader tree')

// 3c-companion. mcp-browser（companion 浏览器执行面挂载，E1）：present + enabled + active。
const browserMcpEntry = hostByEntry.get('mcp-browser')
pass('mcp-browser (companion browser execution plane) enabled+active',
  browserMcpEntry !== undefined && browserMcpEntry.enabled && browserMcpEntry.fiberPhase === 'active',
  browserMcpEntry === undefined ? 'mcp-browser absent — dsh-mcp-client symlink 或 patch insert 缺失' : describe(browserMcpEntry))

// 3c-studio. eterna-prompt-studio（T1.2 生产挂载）：present + enabled + active。
// 产品可见性的机器证据之一（另一半=下方花名册断言）；亦已并入 HOST_KEPT_ROWS 循环。
const studioEntry = hostByEntry.get('eterna-prompt-studio')
pass('eterna-prompt-studio (prompt studio panel) enabled+active',
  studioEntry !== undefined && studioEntry.enabled && studioEntry.fiberPhase === 'active',
  studioEntry === undefined ? 'eterna-prompt-studio absent — profile node_modules symlink 或 patch insert 缺失' : describe(studioEntry))

// 3d. Preset kept rows: present, enabled, active in the default preset.
const standard = presetByName.get('standard')
pass('standard preset composed and default', standard !== undefined && standard.isDefault === true,
  standard === undefined ? 'preset standard missing from the roster' : `presets: ${[...presetByName.keys()].join(', ')}`)
if (standard !== undefined) {
  const rowById = new Map(standard.rows.map((row) => [row.entryId, row]))
  const presetMissing = PRESET_KEPT_ROWS.filter((id) => !rowById.has(id))
  const presetInactive = PRESET_KEPT_ROWS.filter((id) => {
    const row = rowById.get(id)
    return row !== undefined && (!row.enabled || row.fiberPhase !== 'active')
  })
  pass(`all ${PRESET_KEPT_ROWS.length} kept preset rows enabled+active in standard`,
    presetMissing.length === 0 && presetInactive.length === 0,
    [...presetMissing.map((id) => `${id}: absent`), ...presetInactive.map((id) => `${id}: ${JSON.stringify(rowById.get(id) && { enabled: rowById.get(id).enabled, fiberPhase: rowById.get(id).fiberPhase })}`)].join('; ') || 'flattened composition active')
}

// 3e. T1.2 浏览器半边：宿主 index.html 花名册含 @eterna/prompt-studio/client.js，
// 且该 combo 脚本可取、含本包 factory 注册（t7-ui-check.mjs:151-165 同款断言，
// 落在生产档真 boot——隔离档案不证明生产，ps-v2-test-plan §9 问题 1）。
if (!roster.ok) {
  pass('browser roster: index.html + combo 花名册取证', false, JSON.stringify(roster.error))
} else {
  const { html, ours, comboBody } = roster
  pass('browser roster: index.html 200 且注入 __DSH_BOOT__ 花名册',
    roster.status === 200 && html.includes('__DSH_BOOT__'),
    `status=${roster.status}, __DSH_BOOT__=${html.includes('__DSH_BOOT__')}`)
  pass('browser roster: combo 花名册含 @eterna/prompt-studio/client.js', ours !== undefined,
    ours === undefined ? 'combo urls 无本包条目——dsh.client 声明或 Loader 行缺席' : ours.slice(0, 120))
  pass('browser roster: 本包 combo 脚本可取且含 factory 注册(id=@eterna/prompt-studio)',
    comboBody !== '' && comboBody.includes('id: "@eterna/prompt-studio"'),
    comboBody === '' ? 'combo 取回为空' : `bytes=${comboBody.length}`)
  // 上下文压缩(2026-11-12 fork):设置分区 client 半边同款口径——花名册含
  // @eterna/compaction/client.js 且 factory 注册,否则设置弹窗分区不渲染。
  pass('browser roster: combo 花名册含 @eterna/compaction/client.js', roster.compactionCombo !== '',
    roster.compactionCombo === '' ? 'combo urls 无压缩包条目——dsh.client 声明或 lib/client.js 缺失' : roster.compactionCombo.slice(0, 120))
  pass('browser roster: 压缩包 combo 可取且含 factory 注册(id=@eterna/compaction)',
    roster.compactionBody !== '' && roster.compactionBody.includes('id: "@eterna/compaction"'),
    roster.compactionBody === '' ? 'combo 取回为空' : `bytes=${roster.compactionBody.length}`)
}

// ---------------------------------------------------------------------------
// 4. Verdict.

console.log(`verify-eterna-web: boot ${urlLine}`)
console.log(failures.length === 0
  ? `verify-eterna-web: OK — ${snapshot.entries.length} host entries, ${presetByName.size} presets, cut rows inactive, kept rows active`
  : `verify-eterna-web: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1

// ---------------------------------------------------------------------------

function describe(entry) {
  return entry === undefined ? 'absent' : `${entry.enabled ? 'enabled' : 'disabled'}/${entry.fiberPhase ?? 'no-fiber'}`
}

/** One authenticated pluginInventory/list call against the booted web host. */
async function probe(url) {
  const index = new URL(url)
  const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]
  if (!auth.ok && auth.status !== 303) {
    return { ok: false, error: { code: 'auth', message: `index request returned ${auth.status}` } }
  }
  const response = await fetch(new URL('/api/pluginInventory/list', index.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-eterna-web', method: 'pluginInventory/list', payload: { args: {} } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const body = await response.json().catch((error) => ({ parseError: String(error) }))
  if (response.status !== 200 || body.type !== 'server-response' || body.result === undefined) {
    return { ok: false, error: { code: 'transport', message: `POST /api/pluginInventory/list -> ${response.status}`, body } }
  }
  return body.result
}

/**
 * 浏览器会话三步换票（/connect token→cookie → /?token= 会话升级 → / 最终 200
 * HTML，照抄 t7-ui-check.mjs:96-110），取证 index.html 花名册与 @eterna/prompt-studio
 * combo 脚本。任一步失败返回 {ok:false,error}，不抛出（取证失败转断言红）。
 */
async function probeRoster(url) {
  try {
    const index = new URL(url)
    const token = index.searchParams.get('token')
    if (token === null) return { ok: false, error: { code: 'token', message: `boot url 无 token: ${url}` } }
    let cookie
    const step = async (u) => {
      const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: cookie === undefined ? {} : { cookie } })
      const set = res.headers.get('set-cookie')
      if (set !== null) cookie = set.split(';')[0]
      return res
    }
    const connect = await step(`${index.origin}/connect?token=${token}&interactions=answer`)
    if (connect.headers.get('set-cookie') === null) return { ok: false, error: { code: 'connect', message: `/connect 无 set-cookie (status=${connect.status})` } }
    const upgrade = await step(`${index.origin}/?token=${token}`)
    if (upgrade.status === 303) await step(`${index.origin}/`)
    const page = await fetch(index.origin, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const html = await page.text()
    const comboUrls = [...html.matchAll(/(plugins\/\?\?[^"']+client\.js[^"']*)/g)]
      .map((m) => m[1].replaceAll('&amp;', '&'))
    const ours = comboUrls.find((u) => u.includes('@eterna/prompt-studio/client.js'))
    let comboBody = ''
    if (ours !== undefined) {
      const combo = await fetch(`${index.origin}/${ours.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) comboBody = await combo.text()
    }
    // 上下文压缩(2026-11-12 fork):设置分区 client 半边的花名册取证,同款口径。
    const compactionCombo = comboUrls.find((u) => u.includes('@eterna/compaction/client.js')) ?? ''
    let compactionBody = ''
    if (compactionCombo !== '') {
      const combo = await fetch(`${index.origin}/${compactionCombo.replace(/^\/+/, '')}`, { headers: { cookie }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (combo.ok) compactionBody = await combo.text()
    }
    return { ok: true, status: page.status, html, ours, comboBody, compactionCombo, compactionBody }
  } catch (error) {
    return { ok: false, error: { code: 'roster', message: String(error?.message ?? error) } }
  }
}

/** Bounded shutdown: SIGTERM, then SIGKILL after the grace period. */
async function stop(childProcess) {
  if (childProcess.exitCode !== null) return
  childProcess.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      childProcess.kill('SIGKILL')
      resolveStop()
    }, 5000)
    childProcess.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
  })
}
