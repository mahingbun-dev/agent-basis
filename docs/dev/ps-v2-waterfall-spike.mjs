#!/usr/bin/env node
/**
 * T1.7 Spike：上游 dsh-system-prompt 的 system-prompt/assemble waterfall
 * 能否按会话区分并替换段落文本？（计划书 2026-11-11 §3 T1.7 / 测试计划 T1.7）
 *
 * 两层实测，互为印证：
 *   Tier1 进程内最小 harness（无模型）：直接 new Context + plugin(SystemPrompt)，
 *     用假 agent（{id:'session-…'}，同 dsh-agent 的 assembleContextFor 形态）
 *     调 assemble()，验证 ①监听器收到调用方 context 原对象（含未声明字段 agent）
 *     ②waterfall 返回的 sections 权威（按 agent.id 替换生效） ③未打标监听器
 *     收到全部组装。
 *   Tier2 真宿主（dsh 0.2.2-rc.1 = 生产 profile 同版本）：起隔离 scratch 宿主
 *     （独立 DSH_HOME，绝不碰运行中部署），注入 ps-spike-observer 插件
 *     （注册全局 probe 段 + system-prompt/assemble 监听，模拟 T2.4 严格回放：
 *     首次见到 agent.id 即冻结该会话 probe 文本，此后每次组装替换回冻结值），
 *     经 LiteLLM 驱动真模型回合：会话A(文本α) → 全局改文本β → 会话B(用β)
 *     → 会话A补轮(仍α，逐会话替换生效)。
 *
 * 产物（回填到本脚本所在 docs/dev/）：
 *   ps-v2-spike-observations.jsonl  宿主内每次组装的 AssembleContext 观测
 *   ps-v2-spike-run.json            两层全部断言结果
 *
 * 环境前提：agent-basis 仓库可达（@eterna/llm-openai file: 依赖 + .secrets/litellm-*）；
 * 端口 3109 空闲（占用即失败，绝不 pkill 其他实例）。scratch home 落在
 * agent-basis/.basis-home-ps-spike（已被 agent-basis .gitignore 的 `.basis-home` 前缀规则覆盖）。
 *
 * 用法：node docs/dev/ps-v2-waterfall-spike.mjs [--clean]
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const docsDev = scriptDir
const basisRepo = process.env.AGENT_BASIS_REPO ?? resolve(scriptDir, '..', '..', '..', 'agent-basis')
const home = resolve(basisRepo, '.basis-home-ps-spike')
const profile = resolve(home, 'profiles', 'ps-spike')
const pluginDir = resolve(home, 'ps-spike-observer')
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 'ps-spike-host.log')
const observeFile = resolve(home, 'observations.jsonl')
const controlFile = resolve(home, 'control.json')
const unitTierFile = resolve(home, 'unit-tier.mjs')
const port = 3109
const profileName = 'ps-spike'

const MARKER_A = 'PS_V2_SPIKE_PROBE_ALPHA（会话快照冻结值）'
const MARKER_B = 'PS_V2_SPIKE_PROBE_BETA（全局新值）'
const PROMPT_TEXT = '请只回复两个字：在线'

const artifactObservations = resolve(docsDev, 'ps-v2-spike-observations.jsonl')
const artifactRun = resolve(docsDev, 'ps-v2-spike-run.json')

const failures = []
const checks = []
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  checks.push({ name, ok, detail: String(detail).slice(0, 400) })
  if (!ok) failures.push(name)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(resolve(basisRepo, 'packages/llm-openai/package.json'))) {
  console.error(`agent-basis 仓库不可达：${basisRepo}（可用 AGENT_BASIS_REPO 指定）`)
  process.exit(1)
}

/* ---------- observer 插件生成（T2.4 严格回放的最小模拟） ---------- */
const PROBE_SECTION = 'ps-spike:probe'
const PLUGIN_JS = `#!/usr/bin/env node
/** T1.7 spike 观测插件：全局 probe 段 + assemble waterfall 监听（冻结回放模拟）。 */
import { appendFileSync, readFileSync } from 'node:fs'

export const name = 'ps-spike-observer'
export const inject = ['systemPrompt']
export const PROBE_SECTION = ${JSON.stringify(PROBE_SECTION)}

export function apply(ctx) {
  const observeFile = process.env.PS_SPIKE_OBSERVE
  const controlFile = process.env.PS_SPIKE_CONTROL
  /** sessionId -> 首次组装时冻结的 probe 文本（模拟会话快照）。 */
  const snapshots = new Map()
  let seq = 0

  const currentGlobalText = () => {
    try {
      return String(JSON.parse(readFileSync(controlFile, 'utf8')).probeText)
    } catch {
      return 'PS_V2_SPIKE_CONTROL_UNREADABLE'
    }
  }

  ctx.systemPrompt.section({
    name: PROBE_SECTION,
    order: 9500,
    text: () => currentGlobalText(),
    interpolate: false,
  })

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context?.agent
    const agentId = typeof agent?.id === 'string' ? agent.id : null
    const entry = {
      seq: ++seq,
      at: new Date().toISOString(),
      contextKeys: Object.keys(context ?? {}).sort(),
      hasAgent: agent !== undefined,
      agentId,
      scopeIsAgent: agent !== undefined && context?.scope === agent,
      hasModelSelection: context?.modelSelection !== undefined,
      hasToolSet: context?.toolSet !== undefined,
      signalPresent: context?.signal instanceof AbortSignal,
      sectionCount: assembly.sections.length,
      sectionNames: assembly.sections.map((s) => s.name),
      probeTextBefore: assembly.sections.find((s) => s.name === PROBE_SECTION)?.text ?? null,
      snapshotAlreadyFrozen: agentId !== null && snapshots.has(agentId),
    }
    // 严格回放模拟：首次见到该会话冻结 probe 文本；此后把 probe 段替换回冻结值。
    if (agentId !== null && !snapshots.has(agentId)) {
      const before = assembly.sections.find((s) => s.name === PROBE_SECTION)?.text
      if (before !== undefined) snapshots.set(agentId, before)
    }
    const frozen = agentId !== null ? snapshots.get(agentId) : undefined
    let replaced = false
    if (frozen !== undefined) {
      for (const s of assembly.sections) {
        if (s.name === PROBE_SECTION && s.text !== frozen) { s.text = frozen; replaced = true }
      }
    }
    entry.probeTextAfter = assembly.sections.find((s) => s.name === PROBE_SECTION)?.text ?? null
    entry.replaced = replaced
    if (observeFile) appendFileSync(observeFile, JSON.stringify(entry) + '\\n')
    return next()
  })
}
`

function ensureScratch() {
  mkdirSync(pluginDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  if (!existsSync(resolve(pluginDir, 'index.js'))) {
    writeFileSync(resolve(pluginDir, 'package.json'), `${JSON.stringify({
      name: 'ps-spike-observer', version: '0.0.0', private: true, type: 'module',
      main: 'index.js',
    }, null, 2)}\n`)
    writeFileSync(resolve(pluginDir, 'index.js'), PLUGIN_JS)
  }
  if (existsSync(resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return
  mkdirSync(profile, { recursive: true })
  writeFileSync(resolve(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-ps-spike',
    private: true,
    dependencies: {
      '@eterna/llm-openai': `file:${resolve(basisRepo, 'packages/llm-openai')}`,
      'ps-spike-observer': `file:${pluginDir}`,
      '@deepseek-ai/dsh': '0.2.2-rc.1',
      '@deepseek-ai/dsh-base': '0.2.2-rc.1',
      '@deepseek-ai/dsh-web-app': '0.2.2-rc.1',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    pnpm: { onlyBuiltDependencies: ['esbuild', '@deepseek-ai/dsh-subprocess-local', 'koffi', 'node-pty'] },
  }, null, 2)}\n`)
  writeFileSync(resolve(profile, 'pnpm-workspace.yaml'), [
    'allowBuilds:',
    "  '@deepseek-ai/dsh-subprocess-local': true",
    "  '@google/genai': false",
    '  esbuild: true',
    '  koffi: true',
    '  node-pty: true',
    '  protobufjs: false',
    '',
  ].join('\n'))
  writeFileSync(resolve(profile, 'cordis.yml'), '[]\n')
  console.log('[boot] profile node_modules 缺失，执行 pnpm install（首次较慢）…')
  const r = spawnSync('pnpm', ['install'], { cwd: profile, stdio: 'inherit' })
  if ((r.status ?? 1) !== 0) throw new Error(`pnpm install failed in ${profile}`)
}

/* ---------- patch 层：LLM 路由 + observer 插件行 + preset-standard 原样 ---------- */
function litellmBaseUrl() {
  return readFileSync(resolve(basisRepo, '.secrets/litellm-base-url.txt'), 'utf8').trim()
}
function litellmKey() {
  // 纪律：key 只在这里读进宿主环境变量，绝不写入被跟踪文件/日志/输出。
  return readFileSync(resolve(basisRepo, '.secrets/litellm-master-key.txt'), 'utf8').trim()
}
function buildPatch() {
  const presetFile = resolve(profile, 'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
  const lines = readFileSync(presetFile, 'utf8').split('\n')
  const insLine = lines.indexOf('- insert:')
  if (insLine < 0) throw new Error(`- insert: not found in ${presetFile}`)
  const body = lines.slice(insLine + 1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  const block = [
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    `        baseURL: '${litellmBaseUrl()}'`,
    '        apiKeyEnv: LITELLM_API_KEY',
    "        provider: 'eterna'",
    '        models:',
    '          - id: deepseek-flash',
    '    - id: ps-spike-observer',
    '      name: ps-spike-observer',
    '',
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: llm-deepseek-account',
    '  disabled: true',
    '- id: agent-default-model',
    '  config:',
    "    provider: 'eterna'",
    "    model: 'deepseek-flash'",
    '',
  ].join('\n')
  return `# T1.7 spike patch layer（由 ps-v2-waterfall-spike.mjs 生成；probe 文本走运行时 control.json）。\n${block}${body.join('\n')}\n`
}

/* ---------- Tier1：进程内最小 harness（独立子进程，避免事件循环悬挂） ---------- */
function runUnitTier() {
  const spDir = readdirSync(resolve(profile, 'node_modules', '.pnpm'))
    .filter((d) => d.startsWith('@deepseek-ai+dsh-system-prompt@0.2.2-rc.1'))
    .map((d) => resolve(profile, 'node_modules', '.pnpm', d, 'node_modules/@deepseek-ai/dsh-system-prompt'))[0]
  if (!spDir) throw new Error('profile .pnpm 内找不到 dsh-system-prompt@0.2.2-rc.1')
  const code = `
import { createRequire } from 'node:module'
const req = createRequire(${JSON.stringify(`${spDir}/package.json`)})
const cordis = await import(req.resolve('@deepseek-ai/cordis'))
const mod = await import(${JSON.stringify(`${spDir}/lib/index.js`)})
const { Context } = cordis
const SystemPrompt = mod.default ?? mod.SystemPrompt
const ctx = new Context({})
ctx.plugin(SystemPrompt, {})
await new Promise((r) => setTimeout(r, 300))
const agentA = { id: 'unit-session-AAAA' }
const seen = []
ctx.systemPrompt.section({ name: 'probe', order: 500, text: () => 'CURRENT_GLOBAL_TEXT', interpolate: false })
ctx.on('system-prompt/assemble', async (assembly, context, next) => {
  seen.push({ keys: Object.keys(context ?? {}).sort(), agentId: context?.agent?.id ?? null,
    scopeIsAgent: context?.agent !== undefined && context?.scope === context?.agent })
  if (context?.agent?.id === 'unit-session-AAAA') {
    for (const s of assembly.sections) if (s.name === 'probe') s.text = 'FROZEN_FOR_A'
  }
  return next()
})
const textOf = (a) => a.sections.find((s) => s.name === 'probe')?.text
const A = await ctx.systemPrompt.assemble({ agent: agentA, scope: agentA })
const A2 = await ctx.systemPrompt.assemble({ agent: agentA, scope: agentA })
const B = await ctx.systemPrompt.assemble({ agent: { id: 'unit-session-BBBB' }, scope: { id: 'unit-session-BBBB' } })
const G = await ctx.systemPrompt.assemble({})
console.log('@@UNIT@@' + JSON.stringify({
  A: textOf(A), A2: textOf(A2), B: textOf(B), G: textOf(G),
  listenerCalls: seen.length, seen,
  spVersion: ${JSON.stringify(JSON.parse(readFileSync(resolve(spDir, 'package.json'), 'utf8')).version)},
}))
process.exit(0)
`
  writeFileSync(unitTierFile, code)
  const r = spawnSync(process.execPath, [unitTierFile], { encoding: 'utf8', timeout: 120000 })
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('@@UNIT@@'))
  if (!line) throw new Error(`unit tier 无输出：${r.stderr?.slice(0, 500)}`)
  return JSON.parse(line.slice('@@UNIT@@'.length))
}

/* ---------- 宿主生命周期与 HTTP 驱动（对齐 t7-spike-verify.mjs 先例） ---------- */
let host = undefined
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    env: {
      ...process.env, DSH_HOME: home, LITELLM_API_KEY: litellmKey(),
      PS_SPIKE_OBSERVE: observeFile, PS_SPIKE_CONTROL: controlFile,
    },
    stdio: ['ignore', out, out],
  })
  host.on('exit', (code) => { if (!stopping) console.log(`[host] exit code=${code}`) })
}
async function stopHost() {
  stopping = true
  if (host?.pid && host.exitCode === null) {
    host.kill('SIGTERM')
    await Promise.race([new Promise((r) => host.once('exit', r)), sleep(15000)])
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  spawnSync('pkill', ['-f', `profile ${profileName}`], { stdio: 'ignore' })
  await sleep(1500)
}
async function waitForToken(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (host.exitCode !== null) throw new Error(`host exited early code=${host.exitCode}; log:\n${readFileSync(hostLog, 'utf8')}`)
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    await sleep(500)
  }
  throw new Error(`host not ready in ${timeoutMs}ms; log:\n${readFileSync(hostLog, 'utf8')}`)
}
async function portBusy() {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return (r.stdout ?? '').trim().length > 0
}

/** system/message(source.kind=system-prompt) 事件 → 拼接文本（对齐 t7 先例）。 */
function systemPromptTextsOfLines(lines) {
  return lines
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch { return undefined } })
    .filter((e) => e?.type === 'system/message' && e.data?.message?.source?.kind === 'system-prompt')
    .map((e) => e.data.message.content.map((c) => c.text ?? '').join('\n'))
}
function api(token) {
  const base = `http://127.0.0.1:${port}`
  const state = { cookie: undefined, rpcId: 0 }
  const call = async (endpoint, args) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `ps-${++state.rpcId}`, method: endpoint, payload: { args } }),
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { throw new Error(`${endpoint}: non-JSON ${res.status}: ${text.slice(0, 200)}`) }
    if (!body.result?.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
    return body.result.value
  }
  return {
    async connect() {
      const res = await fetch(`${base}/connect?token=${token}&interactions=answer`, { redirect: 'manual' })
      state.cookie = res.headers.get('set-cookie')?.split(';')[0]
      if (!state.cookie) throw new Error('/connect: no cookie')
    },
    createSession: async () => {
      for (let i = 0; i < 20; i++) {
        try { return await call('session/create', { request: { cwd: `/tmp/ps-v2-spike-ws-${process.pid}` } }) } catch (error) {
          if (i === 19) throw error
          await sleep(1000)
        }
      }
    },
    prompt: (sessionId) => call('session/prompt', { request: {
      requestId: `ps-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text: PROMPT_TEXT }],
    } }),
    awaitTurnEnd: async (sessionId, minTurns = 1, timeoutMs = 120000) => {
      const t0 = Date.now()
      for (;;) {
        const page = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
        const turns = page.records.filter((r) => r.event?.type === 'turn/end')
        if (turns.length >= minTurns) return page
        if (Date.now() - t0 > timeoutMs) throw new Error(`session ${sessionId}: ${turns.length}/${minTurns} turn/end after ${timeoutMs}ms`)
        await sleep(1000)
      }
    },
    liveSystemPromptTexts: async (sessionId) => {
      const page = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
      const lines = page.records.map((r) => JSON.stringify(r.event))
      return systemPromptTextsOfLines(lines).join('\n')
    },
  }
}
const readObservations = () => (existsSync(observeFile)
  ? readFileSync(observeFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
  : [])

/* ---------- 主流程 ---------- */
let exitCode = 0
const meta = { basisRepo, home, port, startedAt: new Date().toISOString() }
try {
  if (await portBusy()) {
    console.error(`端口 ${port} 已被占用（绝不 pkill 其他实例）——请先释放`)
    process.exit(1)
  }
  console.log(`[boot] basisRepo=${basisRepo}`)
  console.log(`[boot] scratch home=${home}`)
  ensureScratch()

  /* ===== Tier1：进程内最小 harness ===== */
  console.log('\n===== Tier1 进程内最小 harness（dsh-system-prompt 直测）=====')
  const unit = runUnitTier()
  check('T1·监听器收到调用方 context 原对象（含未声明字段 agent）',
    unit.seen.some((s) => s.keys.includes('agent') && s.agentId === 'unit-session-AAAA'),
    `keys=${JSON.stringify(unit.seen[0]?.keys)} agentId=${unit.seen[0]?.agentId}`)
  check('T1·scope===agent（assembleContextFor 形态）时 scopeIsAgent=true',
    unit.seen.some((s) => s.agentId === 'unit-session-AAAA' && s.scopeIsAgent === true))
  check('T1·waterfall 按会话替换段落文本权威（A 冻结/B 现值/全局现值）',
    unit.A === 'FROZEN_FOR_A' && unit.A2 === 'FROZEN_FOR_A' && unit.B === 'CURRENT_GLOBAL_TEXT' && unit.G === 'CURRENT_GLOBAL_TEXT',
    `A=${unit.A} A2=${unit.A2} B=${unit.B} G=${unit.G}`)
  check('T1·未打标监听器收到全部组装（4/4 次显式调用）', unit.listenerCalls === 4, `calls=${unit.listenerCalls}`)
  check('T1·实测包版本=0.2.2-rc.1（生产 profile 同版本）', unit.spVersion === '0.2.2-rc.1', `v=${unit.spVersion}`)
  meta.unitTier = unit

  /* ===== Tier2：真宿主 ===== */
  console.log('\n===== Tier2 真宿主（dsh-base+dsh-web-app 0.2.2-rc.1 + LiteLLM 真回合）=====')
  writeFileSync(controlFile, JSON.stringify({ probeText: MARKER_A }, null, 2))
  rmSync(observeFile, { force: true })
  writeFileSync(resolve(profile, 'cordis.patch.yml'), buildPatch())
  {
    const r = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    const out = r.stdout ?? ''
    check('T2·preflight dump-config 退出码 0', r.status === 0, `status=${r.status}`)
    check('T2·组合树含 ps-spike-observer 行', out.includes('ps-spike-observer'))
    check('T2·无 skipping/incompatible', !/skipping|incompatible/i.test(out))
    if (r.status !== 0 || !out.includes('ps-spike-observer')) throw new Error('组合预检失败，中止')
  }

  startHost()
  const token = await waitForToken()
  const hostPid = host.pid
  console.log(`[host] ready pid=${hostPid} log=${hostLog}`)
  const dsh = api(token)
  await dsh.connect()

  // 会话 A：probe 文本 = α
  const sessionAId = (await dsh.createSession()).sessionId
  await dsh.prompt(sessionAId)
  await dsh.awaitTurnEnd(sessionAId, 1)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('T2·会话A 系统提示含 α', texts.includes(MARKER_A), `session=${sessionAId}`)
    check('T2·会话A 系统提示不含 β', !texts.includes(MARKER_B))
  }

  // 观测：真回合的 AssembleContext 形态
  {
    const obsA = readObservations().filter((e) => e.agentId === sessionAId)
    check('T2·观测到会话A 的组装事件（agent.id=sessionId）', obsA.length >= 1, `n=${obsA.length}`)
    const first = obsA[0]
    if (first) {
      check('T2·真回合 context 含 agent/scope/modelSelection/toolSet',
        ['agent', 'modelSelection', 'scope', 'toolSet'].every((k) => first.contextKeys.includes(k)),
        `keys=${JSON.stringify(first.contextKeys)}`)
      check('T2·agent.id 即会话 id（字符串）', typeof first.agentId === 'string' && first.agentId === sessionAId)
      check('T2·scope===agent（身份路由键=会话 Agent）', first.scopeIsAgent === true)
    }
  }

  // 不重启：全局 probe 文本 α→β（control 文件，每次组装现读）
  writeFileSync(controlFile, JSON.stringify({ probeText: MARKER_B }, null, 2))
  console.log('[spike] control α→β（宿主不重启）；等待 2s 后开会话 B')
  await sleep(2000)

  // 会话 B：新会话用 β（无快照 → 用全局现值）
  const sessionBId = (await dsh.createSession()).sessionId
  await dsh.prompt(sessionBId)
  await dsh.awaitTurnEnd(sessionBId, 1)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionBId)
    check('T2·会话B 系统提示含 β（新会话即用新文）', texts.includes(MARKER_B), `session=${sessionBId}`)
    check('T2·会话B 系统提示不含 α', !texts.includes(MARKER_A))
    check('T2·宿主 pid 未变（全程未重启）', host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)
  }

  // 会话 A 补轮：严格回放核心断言——waterfall 按会话替换回冻结值 α
  await dsh.prompt(sessionAId)
  await dsh.awaitTurnEnd(sessionAId, 2)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('T2·核心：旧会话A 补轮后系统提示仍为 α（按会话替换生效）', texts.includes(MARKER_A) && !texts.includes(MARKER_B), `session=${sessionAId}`)
    check('T2·宿主 pid 仍未变', host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)
  }

  // 观测复核：会话身份稳定性 + 替换动作落观测
  {
    const obs = readObservations()
    const obsA = obs.filter((e) => e.agentId === sessionAId)
    const obsB = obs.filter((e) => e.agentId === sessionBId)
    check('T2·两会话 agent.id 互不相同（会话可区分）', sessionAId !== sessionBId && obsA.length >= 1 && obsB.length >= 1,
      `A→${obsA.length} 次、B→${obsB.length} 次组装`)
    check('T2·会话A 跨轮 agent.id 稳定（≥2 次组装同一 id）', obsA.length >= 2 && obsA.every((e) => e.agentId === sessionAId),
      `n=${obsA.length}`)
    const replacedA = obsA.filter((e) => e.replaced === true && e.probeTextAfter === MARKER_A && e.probeTextBefore === MARKER_B)
    check('T2·会话A β 期组装被替换回 α（probeTextBefore=β→After=α）', replacedA.length >= 1, `n=${replacedA.length}`)
    const usedB = obsB.filter((e) => e.probeTextAfter === MARKER_B && e.replaced === false)
    check('T2·会话B 组装未替换、用全局 β', usedB.length >= 1, `n=${usedB.length}`)
    check('T2·无 unknown 会话（所有组装都带 agent.id）', obs.every((e) => e.agentId !== null), `total=${obs.length}`)
  }
  {
    const log = readFileSync(hostLog, 'utf8')
    check('T2·宿主日志只有一次 dsh web: 启动行', (log.match(/dsh web: /g) ?? []).length === 1)
    check('T2·宿主日志含 llm-openai → LiteLLM 调用证据', /\[(eterna|basis)-llm-openai\] POST/.test(log))
  }
  console.log('[cleanup] SIGTERM 宿主…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  await stopHost()
  const freed = !(await portBusy())
  check('清理：宿主已停止、端口 3109 已释放', freed)
  meta.finishedAt = new Date().toISOString()
  meta.totalObservations = existsSync(observeFile)
    ? readFileSync(observeFile, 'utf8').split('\n').filter(Boolean).length : 0

  // 产物回填 docs/dev/
  try {
    if (existsSync(observeFile)) copyFileSync(observeFile, artifactObservations)
    writeFileSync(artifactRun, `${JSON.stringify({ meta, checks, failures }, null, 2)}\n`)
    console.log(`[artifacts] ${artifactObservations}\n[artifacts] ${artifactRun}`)
  } catch (error) {
    failures.push(`artifact: ${String(error?.message ?? error)}`)
  }
  if (process.argv.includes('--clean')) rmSync(home, { recursive: true, force: true })
  rmSync(`/tmp/ps-v2-spike-ws-${process.pid}`, { recursive: true, force: true })
  console.log(`\n结论：${failures.length === 0 ? '全部断言通过（exit 0）' : `存在失败项（exit 1）：${failures.join(' | ')}`}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
