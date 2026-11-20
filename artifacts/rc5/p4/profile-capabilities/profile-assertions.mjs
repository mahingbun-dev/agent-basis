#!/usr/bin/env node
/**
 * T29/T34/T35 profile 能力断言（只读取证据与模板，不 boot）。
 * 输入：web/、super/ 的 verify 证据（inventory.json + dump-config.log）、
 *       docker/profile 模板、已安装 rc.5 包源。
 * 输出：PASS/FAIL 行；退出码 = 失败数 > 0 ? 1 : 0。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const read = (path) => readFileSync(path, 'utf8')
const readJson = (path) => JSON.parse(read(path))
const failures = []
const pass = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}
const pnpm = readdirSync(join(repo, 'node_modules/.pnpm'))
const pkgDir = (prefix) => {
  const dir = pnpm.find((name) => name.startsWith(prefix))
  if (dir === undefined) throw new Error(`missing .pnpm entry ${prefix}`)
  return join(repo, 'node_modules/.pnpm', dir, 'node_modules', '@deepseek-ai', prefix.replace(/^@deepseek-ai\+/, '').replace(/@.*$/, ''))
}
const countOf = (text, needle) => text.split(needle).length - 1
const webTemplate = read(join(repo, 'docker/profile/cordis.patch.yml.template'))
const superTemplate = read(join(repo, 'docker/profile/cordis.super.patch.yml.template'))
const dumps = { web: read(join(here, 'web/dump-config.log')), super: read(join(here, 'super/dump-config.log')) }
const webInventory = readJson(join(here, 'web/inventory.json'))
const superInventory = readJson(join(here, 'super/inventory.json'))
const entryOf = (snapshot, id) => snapshot.entries.find((entry) => entry.entryId.replace(/^include:/, '') === id)
const activeOf = (snapshot, id) => {
  const entry = entryOf(snapshot, id)
  return entry !== undefined && entry.enabled && entry.fiberPhase === 'active'
}

// ── T29 office ──────────────────────────────────────────────────────────────
for (const [label, text] of [['web', webTemplate], ['super', superTemplate]]) {
  const standard = text.slice(text.indexOf('- id: preset-standard'))
  const ptcStart = text.indexOf('- id: preset-ptc')
  const cordisStart = text.indexOf('- id: preset-cordis')
  const cordis = text.slice(cordisStart, text.indexOf('- id: preset-standard'))
  pass(`[${label}] preset-standard row set includes tool-office`,
    /- id: tool-office\n\s+name: '@deepseek-ai\/dsh-tool-office'/.test(standard))
  pass(`[${label}] template cuts preset-ptc (product decision) without restating its config`,
    /- id: preset-ptc\n\s+disabled: true/.test(text.slice(ptcStart, cordisStart)))
  pass(`[${label}] preset-cordis (product restatement) includes tool-office`,
    /- id: tool-office\n\s+name: '@deepseek-ai\/dsh-tool-office'/.test(cordis))
  pass(`[${label}] template does not re-insert office-kit/skill-office (upstream web-app owns them)`,
    !/- id: office-kit/.test(text) && !/- id: skill-office/.test(text))
}
for (const [label, dump] of Object.entries(dumps)) {
  const composedPreset = (id) => {
    const start = dump.indexOf(`- id: preset-${id}`)
    if (start < 0) return ''
    const next = dump.indexOf('\n- id: preset-', start + 1)
    const section = dump.indexOf('\n# ==', start + 1)
    const ends = [next, section].filter((index) => index > start)
    return dump.slice(start, ends.length === 0 ? undefined : Math.min(...ends))
  }
  for (const id of ['standard', 'ptc', 'cordis']) {
    pass(`[${label}] composed profile: preset-${id} row set includes tool-office`,
      /- id: tool-office\n\s+name: '@deepseek-ai\/dsh-tool-office'/.test(composedPreset(id)))
  }
  pass(`[${label}] composed profile: office-kit outputDirectory = dshHomePath(office-kit, outputs)`,
    /- id: office-kit\n\s+name: '@deepseek-ai\/dsh-office-kit'\n\s+config:\n\s+outputDirectory: !!js dshHomePath\('office-kit', 'outputs'\)/.test(dump))
  pass(`[${label}] composed profile: skill-office pythonEnvironment resolves to user unless desktop`,
    /- id: skill-office[\s\S]{0,400}?pythonEnvironment: !!js >-\n\s+ctx\.get\('profileContext'\)\?\.name === 'desktop' &&\n\s+process\.env\.DSH_PRIMARY_RUNTIME \? 'workspace-dependencies' : 'user'/.test(dump))
}
for (const [label, dump] of Object.entries(dumps)) {
  pass(`[${label}] composed profile: terminal panel config preferredShells=[bash], readUserTerminals=false`,
    /- id: optional-terminal-panel\n\s+name: '@deepseek-ai\/dsh-terminal-panel'\n\s+config:\n\s+preferredShells:\n\s+- bash\n\s+readUserTerminals: false/.test(dump))
}
const officeKitSrc = read(join(pkgDir('@deepseek-ai+dsh-office-kit@'), 'src/index.ts'))
pass('office-kit upstream default outputRetentionMs = 24h (86400000)',
  /outputRetentionMs:.*default\(24 \* 60 \* 60 \* 1000\)/.test(officeKitSrc),
  (officeKitSrc.split('\n').find((line) => line.includes('outputRetentionMs:') && line.includes('default(')) ?? ''))
pass('office-kit upstream default maxOutputStoreBytes = 512MB',
  /maxOutputStoreBytes:.*default\(512 \* 1024 \* 1024\)/.test(officeKitSrc),
  (officeKitSrc.split('\n').find((line) => line.includes('maxOutputStoreBytes:') && line.includes('default(')) ?? ''))
for (const [label, snapshot] of [['web', webInventory], ['super', superInventory]]) {
  pass(`[${label}] boot: office-kit active`, activeOf(snapshot, 'office-kit'))
  pass(`[${label}] boot: skill-office active`, activeOf(snapshot, 'skill-office'))
  const standardPreset = snapshot.agentPresets.find((preset) => preset.id === 'standard')
  const officeRow = standardPreset.rows.find((row) => row.entryId === 'tool-office')
  pass(`[${label}] boot: standard preset tool-office enabled+active`,
    officeRow !== undefined && officeRow.enabled && officeRow.fiberPhase === 'active')
  const cordisPreset = snapshot.agentPresets.find((preset) => preset.id === 'cordis')
  const officeCordis = cordisPreset?.rows.find((row) => row.entryId === 'tool-office')
  pass(`[${label}] boot: cordis (创造模式) preset tool-office enabled+active`,
    officeCordis !== undefined && officeCordis.enabled && officeCordis.fiberPhase === 'active')
  pass(`[${label}] boot: preset-ptc cut from live roster (product decision)`,
    snapshot.agentPresets.every((preset) => preset.id !== 'ptc'))
}

// ── T34 terminal ────────────────────────────────────────────────────────────
for (const [label, text] of [['web', webTemplate], ['super', superTemplate]]) {
  pass(`[${label}] template: optional-terminal-panel preferredShells=[bash], readUserTerminals=false`,
    new RegExp("- id: optional-terminal-panel\\n\\s+config:\\n\\s+preferredShells:\\n\\s+- bash\\n\\s+readUserTerminals: false").test(text))
  pass(`[${label}] template: terminal rows not re-inserted (bundle owns the group)`,
    !/- id: optional-terminal-registry/.test(text))
}

for (const [label, snapshot] of [['web', webInventory], ['super', superInventory]]) {
  for (const id of ['optional-terminal-registry', 'optional-terminal-panel', 'optional-tool-terminal', 'terminal-controller', 'ui-sidebar-terminal']) {
    pass(`[${label}] boot: ${id} enabled+active`, activeOf(snapshot, id))
  }
}
const toolTerminalSrc = read(join(pkgDir('@deepseek-ai+dsh-tool-terminal@'), 'src/index.ts'))
const terminalTools = [...toolTerminalSrc.matchAll(/name: '(terminal_[a-z]+)'/g)].map((match) => match[1])
pass('tool-terminal exposes 6 terminal_* tools', terminalTools.length === 6, terminalTools.join(', '))
const accessTerminalSrc = read(join(repo, 'packages/access/src/terminal.ts'))
const tmStart = accessTerminalSrc.indexOf('export const TERMINAL_METHODS')
const tmEq = accessTerminalSrc.indexOf('= [', tmStart)
const terminalMethods = [...accessTerminalSrc.slice(tmEq, accessTerminalSrc.indexOf(']', tmEq)).matchAll(/'([a-z]+)'/g)].map((m) => m[1])
pass('access tenant guard covers 9 terminal methods', terminalMethods.length === 9, terminalMethods.join(', '))

// ── T35 agent-team ─────────────────────────────────────────────────────────
for (const [label, snapshot] of [['web', webInventory], ['super', superInventory]]) {
  for (const id of ['agent-team', 'tool-agent-team', 'ui-agent-team']) {
    pass(`[${label}] boot: ${id} enabled+active`, activeOf(snapshot, id))
  }
  pass(`[${label}] boot: no agent-team row duplicate`,
    snapshot.entries.filter((entry) => entry.entryId.replace(/^include:/, '') === 'agent-team').length === 1)
}
const teamLog = read(join(here, 'team-mode/team-mode-runtime.log'))
const configLine = teamLog.split('\n').find((line) => line.startsWith('PROFILE_CONFIG_PROBE '))
const runtimeConfig = configLine === undefined ? undefined : JSON.parse(configLine.slice('PROFILE_CONFIG_PROBE '.length))
pass('真 boot effectiveConfig: skill-office pythonEnvironment=user',
  runtimeConfig?.skillOffice?.pythonEnvironment === 'user', JSON.stringify(runtimeConfig?.skillOffice))
pass('真 boot effectiveConfig: office-kit outputDirectory=<DSH_HOME>/office-kit/outputs',
  typeof runtimeConfig?.officeKit?.outputDirectory === 'string' && runtimeConfig.officeKit.outputDirectory.endsWith('/office-kit/outputs'),
  runtimeConfig?.officeKit?.outputDirectory)
pass('真 boot effectiveConfig: office-kit outputRetentionMs=24h, maxOutputStoreBytes=512MiB',
  runtimeConfig?.officeKit?.outputRetentionMs === 86_400_000 && runtimeConfig?.officeKit?.maxOutputStoreBytes === 512 * 1024 * 1024,
  JSON.stringify({ outputRetentionMs: runtimeConfig?.officeKit?.outputRetentionMs, maxOutputStoreBytes: runtimeConfig?.officeKit?.maxOutputStoreBytes }))
pass('真 boot effectiveConfig: terminal panel preferredShells=[bash], readUserTerminals=false',
  JSON.stringify(runtimeConfig?.terminalPanel?.preferredShells) === JSON.stringify(['bash']) && runtimeConfig?.terminalPanel?.readUserTerminals === false,
  JSON.stringify({ preferredShells: runtimeConfig?.terminalPanel?.preferredShells, readUserTerminals: runtimeConfig?.terminalPanel?.readUserTerminals }))
pass('真 boot effectiveConfig: agent-team defaultEnabled=false (Team mode 默认关)',
  runtimeConfig?.agentTeam?.defaultEnabled === false && runtimeConfig?.agentTeam?.maxTasks === 256,
  JSON.stringify(runtimeConfig?.agentTeam))
const probeLine = teamLog.split('\n').find((line) => line.startsWith('TEAM_DEFAULT_PROBE '))
const probe = probeLine === undefined ? undefined : JSON.parse(probeLine.slice('TEAM_DEFAULT_PROBE '.length))
pass('真 boot: new Session defaults Team mode OFF (agentTeams.isEnabled=false)',
  probe !== undefined && probe.isEnabled === false && probe.teamModeEventCount === 0,
  probeLine)
const governanceSrc = read(join(repo, 'packages/glue/tests/governance-rules-fixture.spec.ts'))
pass('governance rules list team_* collab tools (audited allow rule)',
  /'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update'/.test(governanceSrc))

console.log(failures.length === 0
  ? 'profile-assertions: OK — all capability assertions passed'
  : `profile-assertions: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
