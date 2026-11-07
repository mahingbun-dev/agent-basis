#!/usr/bin/env node
/**
 * Real-boot verification for the Basis enterprise Web 档 (profiles/basis-web).
 *
 * Boots the actual composition — @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app
 * + profiles/basis-web/cordis.patch.yml — with the repo-local dsh CLI (no model
 * calls, no credentials, OS-assigned port via --port 0), then asserts against the
 * LIVE pluginInventory/list Remote (read-only projection of the settled Loader
 * tree) that:
 *   - every cut row is absent or disabled, in the host tree AND in every agent
 *     preset composition (a preset re-enabling a cut row is a failure);
 *   - every kept host row is present, enabled, and ACTIVE;
 *   - every kept preset row is present, enabled, and ACTIVE in the default
 *     `standard` preset;
 *   - no entry sits in the `failed` phase (catches broken injection chains that
 *     a future upstream refresh could introduce).
 *
 * dump-config is deliberately NOT used: it only proves patch text, not row
 * activation (2026-11-04 E2E 教训). The readiness signal is the `dsh web: <url>`
 * stdout line, which the web-runtime row prints only after the Loader settled
 * and the required-entry startup audit passed (dsh-web-app src/index.ts:244-254).
 *
 * Environment:
 *   BASIS_PROFILE_HOME — DSH home to materialize the profile in
 *                        (default: <repo>/.basis-home)
 *
 * Exit 0 = all assertions passed; exit 1 = boot or assertion failure.
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const sourcePatch = join(repoRoot, 'profiles', 'basis-web', 'cordis.patch.yml')
const home = resolve(process.env.BASIS_PROFILE_HOME ?? join(repoRoot, '.basis-home'))
const profileName = 'basis-web'
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
  // ptc/workflow 家族 + 本就 disabled 的三行
  'ptc-runtime', 'workflow-ptc', 'tool-workflow', 'tool-executor-ptc',
  'fs-observation-policy', 'tool-plugin-manager', 'ui-workflow-run',
  // 场景裁切
  'office-to-pdf', 'open-in-app', 'ui-open-in-app', 'shortcuts', 'ui-shortcuts',
  'ui-brand-official', 'ui-message-feedback',
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
  // skill / title / query
  'skill', 'session-title', 'session-title-llm', 'session-query-sqlite', 'session-log-deepseek',
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
  // 计划书偏差说明的实证行：必须保持启用
  'credentials',
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
  console.error(`verify-basis-web: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(sourcePatch)) {
  console.error(`verify-basis-web: missing ${sourcePatch}`)
  process.exit(1)
}
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-basis-web: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point BASIS_PROFILE_HOME at a clean home`)
  process.exit(1)
}

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-${profileName}`,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const copied = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
if (copied !== readFileSync(sourcePatch, 'utf8')) {
  console.error('verify-basis-web: profile patch copy drifted from the source file')
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
  console.error(`verify-basis-web: boot failed: ${error.message}`)
  console.error('--- dsh output ---')
  console.error(output.join(''))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Probe the live inventory.

const result = await probe(urlLine)
await stop(child)

if (!result.ok) {
  console.error(`verify-basis-web: pluginInventory/list failed: ${JSON.stringify(result.error)}`)
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

// ---------------------------------------------------------------------------
// 4. Verdict.

console.log(`verify-basis-web: boot ${urlLine}`)
console.log(failures.length === 0
  ? `verify-basis-web: OK — ${snapshot.entries.length} host entries, ${presetByName.size} presets, cut rows inactive, kept rows active`
  : `verify-basis-web: FAILED — ${failures.join('; ')}`)
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
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-basis-web', method: 'pluginInventory/list', payload: { args: {} } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const body = await response.json().catch((error) => ({ parseError: String(error) }))
  if (response.status !== 200 || body.type !== 'server-response' || body.result === undefined) {
    return { ok: false, error: { code: 'transport', message: `POST /api/pluginInventory/list -> ${response.status}`, body } }
  }
  return body.result
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
