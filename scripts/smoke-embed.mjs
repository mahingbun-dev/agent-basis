#!/usr/bin/env node
/**
 * T6 嵌入档冒烟（plans/2026-11-06-dsh企业agent路线定案.md T6 行）：一次性任务经
 * headless 真会话（profiles/eterna-embed = @deepseek-ai/dsh-base +
 * @deepseek-ai/dsh-headless + 企业层）跑通，经 NAS liteLLM 网关。
 *
 * 断言（退出码 0/1，可重复执行）：
 *  1. profile 物化：$EMBED_PROFILE_HOME/profiles/eterna-embed（默认
 *     .eterna-home-embed/），bundle 元组 = 官方 headless 模板
 *     （@deepseek-ai/dsh-official-bundles PROFILE_TEMPLATES.headless），补丁层与
 *     profiles/eterna-embed/cordis.patch.yml 逐字一致；@eterna/llm-openai 以
 *     symlink 终态入 profile node_modules（t7-spike 实证：Loader 只按
 *     node_modules 解析，symlink 即终态）。
 *  2. headless 真会话：`dsh --profile eterna-embed --json "<task>"` 以工作目录=
 *     冒烟工作区启动，任务强制一次文件写入（tool_calls 完整一轮）。
 *  3. --json NDJSON 流：开事件 session(sessionId)；≥1 条 tool_call 且每条
 *     callId 都有 tool_result 且 status=completed（一轮闭合）；无 error 事件；
 *     终事件 final.reason.kind 为清洁收尾（'completed'；wire 层 finish_reason
 *     =stop 在 DSH 0.2.2-rc.1 各官方面都投影为 turn reason kind 'completed'，
 *     实证：node scripts/smoke.mjs 输出 finishReason: completed——本脚本按
 *     DSH 口径断言清洁收尾并在输出中显式映射，见 docs/embed-profile.md
 *     「finishReason 口径」）。
 *  4. 落盘证据：工作区内任务文件存在且内容逐字等于预期（工具真执行）。
 *
 * 凭据纪律：LITELLM_API_KEY 从启动环境读（缺省兜底 .secrets/litellm-master-key.txt，
 * 只进子进程环境，不进任何被跟踪文件/日志/argv）；网关 BASE_URL 从
 * ETERNA_LLM_BASE_URL 环境读（缺省兜底 .secrets/litellm-base-url.txt 自查）。
 *
 * 用法：
 *   LITELLM_API_KEY=$(cat .secrets/litellm-master-key.txt) node scripts/smoke-embed.mjs
 */

import { spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const sourcePatch = join(repoRoot, 'profiles', 'eterna-embed', 'cordis.patch.yml')
const eternaLlmDir = join(repoRoot, 'packages', 'llm-openai')
const home = resolve(process.env.EMBED_PROFILE_HOME ?? join(repoRoot, '.eterna-home-embed'))
const profileName = 'eterna-embed'
const profileDir = join(home, 'profiles', profileName)

const RUN_TIMEOUT_MS = 240_000
const TASK = '在当前工作目录创建文件 embed-smoke.txt，内容恰好为一行：eterna-embed-smoke-ok。创建成功后只回复一行：ok embed-smoke.txt'
const EXPECTED_FILE = 'embed-smoke.txt'
const EXPECTED_CONTENT = 'eterna-embed-smoke-ok'
/** 清洁收尾的 finishReason 取值：DSH turn reason kind 'completed'（wire finish_reason=stop 的投影）；'stop' 兼容直接暴露 wire 语义的未来面。 */
const CLEAN_STOP_KINDS = new Set(['completed', 'stop'])

const failures = []
const pass = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ---------------------------------------------------------------------------
// 0. 前置检查（bin、源补丁、@eterna/llm-openai 构建产物）。

if (!existsSync(dshBin)) {
  console.error(`smoke-embed: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(sourcePatch)) {
  console.error(`smoke-embed: missing ${sourcePatch}`)
  process.exit(1)
}
if (!existsSync(join(eternaLlmDir, 'lib', 'index.js'))) {
  console.error(`smoke-embed: @eterna/llm-openai is not built (${join(eternaLlmDir, 'lib', 'index.js')} missing); run pnpm build in packages/llm-openai`)
  process.exit(1)
}

// 凭据与网关地址：env 优先，.secrets 兜底自查（值永不打印）。
const secretsDir = join(repoRoot, '.secrets')
const apiKey = process.env.LITELLM_API_KEY
  ?? readIfExists(join(secretsDir, 'litellm-master-key.txt'))?.trim()
const baseURL = process.env.ETERNA_LLM_BASE_URL
  ?? readIfExists(join(secretsDir, 'litellm-base-url.txt'))?.trim()
if (!apiKey) {
  console.error('smoke-embed: LITELLM_API_KEY missing — export it (e.g. LITELLM_API_KEY=$(cat .secrets/litellm-master-key.txt)) or provide the secrets file')
  process.exit(1)
}
if (!baseURL) {
  console.error('smoke-embed: gateway BASE_URL missing — set ETERNA_LLM_BASE_URL or provide .secrets/litellm-base-url.txt')
  process.exit(1)
}
console.log(`smoke-embed: gateway ${baseURL} (key source: ${process.env.LITELLM_API_KEY ? 'env LITELLM_API_KEY' : '.secrets/litellm-master-key.txt'})`)

// ---------------------------------------------------------------------------
// 1. 物化 profile（可重复执行：每次重建）。

const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`smoke-embed: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point EMBED_PROFILE_HOME at a clean home`)
  process.exit(1)
}
rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: `dsh-profile-${profileName}`,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const copied = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
pass('profile patch copy is byte-identical to profiles/eterna-embed/cordis.patch.yml', copied === readFileSync(sourcePatch, 'utf8'))

// @eterna/llm-openai symlink 终态（row-name 解析只看 profile 根 node_modules）。
const nmEterna = join(profileDir, 'node_modules', '@eterna')
mkdirSync(nmEterna, { recursive: true })
const linkPath = join(nmEterna, 'llm-openai')
try { rmSync(linkPath, { recursive: true, force: true }) } catch { /* not a symlink */ }
symlinkSync(eternaLlmDir, linkPath, 'dir')
pass('@eterna/llm-openai symlinked into profile node_modules', existsSync(join(linkPath, 'lib', 'index.js')), `${linkPath} -> ${eternaLlmDir}`)

// 冒烟工作区（任务落盘面，与 home 分离）。
const ws = mkdtempSync(join(tmpdir(), 'eterna-embed-smoke-'))

// ---------------------------------------------------------------------------
// 2. headless 真会话：一次性任务 + --json NDJSON。

const child = spawn(process.execPath, [dshBin, '--profile', profileName, '--json', TASK], {
  cwd: ws,
  env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: apiKey, ETERNA_LLM_BASE_URL: baseURL },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const stdoutLines = []
let stderrTail = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n')) if (line.trim().length > 0) stdoutLines.push(line)
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderrTail += chunk })

// 单一 exit 监听同时裁决超时与退出码：'exit' 只发一次，第二个监听若在事件
// 之后才挂上会永远悬挂（node 顶层 await 未决以 exit 13 收场——首跑实测教训）。
const { timedOut, code: exitCode } = await new Promise((resolveRun) => {
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 5000).unref()
    resolveRun({ timedOut: true, code: null })
  }, RUN_TIMEOUT_MS)
  child.on('exit', (code) => { clearTimeout(timer); resolveRun({ timedOut: false, code }) })
})

if (timedOut) {
  console.error(`smoke-embed: run exceeded ${RUN_TIMEOUT_MS}ms and was terminated`)
  console.error('--- dsh stderr tail ---')
  console.error(stderrTail.slice(-4000))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. NDJSON 流断言。

const events = []
for (const [index, line] of stdoutLines.entries()) {
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    pass(`stdout line ${index} is valid NDJSON`, false, line.slice(0, 200))
    continue
  }
  events.push(parsed)
}

const sessionEvent = events.find((event) => event.type === 'session')
pass('opening session event with sessionId', sessionEvent?.type === 'session' && typeof sessionEvent.sessionId === 'string',
  sessionEvent ? `sessionId=${sessionEvent.sessionId} cwd=${sessionEvent.cwd}` : 'no session event')

const errorEvents = events.filter((event) => event.type === 'error')
pass('no error events in stream', errorEvents.length === 0, errorEvents.map((event) => event.message).join(' | ') || 'clean stream')

const toolCalls = events.filter((event) => event.type === 'tool_call')
const toolResults = events.filter((event) => event.type === 'tool_result')
pass('at least one tool_call (tool round exercised)', toolCalls.length > 0,
  toolCalls.map((event) => `${event.tool}(${event.callId})`).join(', ') || 'none')
const unmatchedCallIds = toolCalls
  .map((event) => event.callId)
  .filter((callId) => !toolResults.some((result) => result.callId === callId))
const errorResults = toolResults.filter((result) => result.status !== 'completed')
pass('every tool_call closed by a completed tool_result (one full round)',
  toolCalls.length > 0 && unmatchedCallIds.length === 0 && errorResults.length === 0,
  unmatchedCallIds.map((callId) => `${callId}: no tool_result`).concat(errorResults.map((result) => `${result.callId}: ${result.status}`)).join('; ') || `${toolResults.length} results closed`)

const finalEvent = events.findLast((event) => event.type === 'final')
const reasonKind = typeof finalEvent?.reason?.kind === 'string' ? finalEvent.reason.kind : null
pass('final event present with clean-stop reason', finalEvent?.type === 'final' && reasonKind !== null && CLEAN_STOP_KINDS.has(reasonKind),
  `finishReason: ${reasonKind ?? 'null'}${reasonKind === 'completed' ? ' (DSH turn reason kind; wire finish_reason=stop)' : ''} | exit=${exitCode}`)
pass('final answer text non-empty', typeof finalEvent?.text === 'string' && finalEvent.text.trim().length > 0,
  finalEvent ? JSON.stringify(finalEvent.text.slice(0, 120)) : 'no final event')
pass('dsh exit code 0 (completed turn)', exitCode === 0, `exit=${exitCode}`)

// ---------------------------------------------------------------------------
// 4. 落盘证据：工具真把文件写进了工作区。

const writtenPath = join(ws, EXPECTED_FILE)
const written = existsSync(writtenPath) ? readFileSync(writtenPath, 'utf8') : null
pass(`tool wrote ${EXPECTED_FILE} with exact content`, written !== null && written.trim() === EXPECTED_CONTENT,
  written === null ? 'file missing' : JSON.stringify(written))

// 会话持久化证据（headless 每次 checkpoint 一次性会话）。
const sessionsDir = join(home, 'sessions')
const sessionFiles = existsSync(sessionsDir) ? readdirSync(sessionsDir) : []
pass('session persisted under DSH_HOME', sessionEvent !== undefined && sessionFiles.length > 0,
  `${sessionFiles.length} session file(s) in ${sessionsDir}`)

console.log(`smoke-embed: workspace ${ws}`)
console.log(failures.length === 0
  ? `smoke-embed: OK — headless one-shot round trip via ${baseURL}, finishReason=${reasonKind}, tool_calls=${toolCalls.length}`
  : `smoke-embed: FAILED — ${failures.join('; ')}`)
if (failures.length > 0) {
  console.error('--- dsh stderr tail ---')
  console.error(stderrTail.slice(-4000))
}
process.exitCode = failures.length === 0 ? 0 : 1

// ---------------------------------------------------------------------------

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}
