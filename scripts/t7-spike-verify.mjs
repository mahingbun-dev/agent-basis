#!/usr/bin/env node
/**
 * T7.0 生效通道 spike 断言脚本（可重复执行，退出码 0/1）。
 *
 * 实证结论（通道 A）：Web 宿主（dsh-base + dsh-web-app；hmr 行由 profileContext 启用）
 * 运行中原位改写 profile patch 层（cordis.patch.yml）里的会话 persona 前缀后，
 * 无需重启宿主进程，新会话的系统提示即用新 persona；进行中会话不受影响。
 * （Web 组合的会话 persona 由 agent-preset 行 preset-standard 的 @deepseek-ai/dsh-persona
 * 插件提供——它以同名段遮蔽宿主 system-prompt 行的 config.personaPrefix，故写回落点
 * 是 preset-standard 行；SDK/无 HMR 组合不适用本结论。）
 *
 * 全流程：确保 profile → 写入标记 A → 组合预检(dump-config) → 启动宿主(3108)
 *   → 驱动会话 A（经 LiteLLM）→ 断言系统提示含 A → 不重启改写标记 B
 *   → 驱动会话 B → 断言系统提示含 B 且宿主 pid 未变 → 旧会话 A 补一轮断言无 B
 *   → 优雅停宿主 → 从 .eterna-home-t7 会话 JSONL(zstd) 复断言 → 清理释放 3108。
 *
 * 已知时序事实（脚本为此设计）：
 *   - session/wait 的 reason:'idle' 在回合尚未开跑时也可能返回（不可作完成信号）；
 *     回合完成以 session/events 出现 turn/end 为准。
 *   - session.v4.jsonl.zstd 容器由宿主后台成帧落盘（本机实测 90s 内可未落盘），
 *     SIGTERM 优雅停机时冲刷；磁盘断言放在停机后做，运行中断言走官方
 *     session/events（attached 会话读内存日志，无落盘依赖）。
 *
 * 环境前提：仓库内运行；LiteLLM 网关可达；master key 只从
 * .secrets/litellm-master-key.txt 读取；端口 3108 空闲（占用即失败，绝不 pkill 其他实例）。
 *
 * 用法：node scripts/t7-spike-verify.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 't7-spike-host.log')
const port = 3108
const profileName = 't7-studio'

const MARKER_A = 'T7_SPIKE_PERSONA_MARKER_A eterna spike persona alpha'
const MARKER_B = 'T7_SPIKE_PERSONA_MARKER_B eterna spike persona beta'
const PROMPT_TEXT = '请只回复两个字：在线'

const failures = []
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const require_ = createRequire(import.meta.url)

/* ---------- zstd 多帧容器解码（对齐 packages/panel/src/session-logs.ts 的
   scanZstdFrames / decodeZstdLog；其又对齐 persistence-jsonl 公开解码路径）---------- */
const ZSTD_MAGIC = 4247762216
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag)
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let lastBlock = false
    for (;;) {
      if (buffer.length - offset < 3) { lastBlock = true; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) { lastBlock = false; break }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { lastBlock = true; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!lastBlock) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}
/** 一段会话日志文本 → system/message(source.kind=system-prompt) 的拼接文本。 */
function systemPromptTextsOfLines(lines) {
  return lines
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch { return undefined } })
    .filter((e) => e?.type === 'system/message' && e.data?.message?.source?.kind === 'system-prompt')
    .map((e) => e.data.message.content.map((c) => c.text ?? '').join('\n'))
}
function sessionLogTexts(file) {
  const buffer = readFileSync(file)
  const text = scanZstdFrames(buffer)
    .map((f) => zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8'))
    .join('')
  return systemPromptTextsOfLines(text.split('\n'))
}
function sessionLogFile(sessionId) {
  // 面积目录名由宿主持久化层按 cwd 编码（/tmp/x → --tmp-x--），会话目录名即
  // session id 本身（session-<uuid>）；不复制编码规则，直接按 id 定位。
  const sessionsRoot = resolve(home, 'sessions')
  if (!existsSync(sessionsRoot)) return undefined
  for (const area of readdirSync(sessionsRoot)) {
    const candidate = resolve(sessionsRoot, area, sessionId, 'session.v4.jsonl.zstd')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/* ---------- profile 自举（幂等：node_modules 缺失时才重建并安装）---------- */
function ensureProfile() {
  mkdirSync(profile, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  if (existsSync(resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return
  writeFileSync(resolve(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-t7-studio',
    private: true,
    dependencies: {
      '@eterna/llm-openai': `file:${resolve(repoRoot, 'packages/llm-openai')}`,
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
    '  esbuild: true',
    '  koffi: true',
    '  node-pty: true',
    '',
  ].join('\n'))
  writeFileSync(resolve(profile, 'cordis.yml'), '[]\n')
  console.log('[boot] profile node_modules 缺失，执行 pnpm install（首次较慢）…')
  const r = spawnSync('pnpm', ['install'], { cwd: profile, stdio: 'inherit' })
  if ((r.status ?? 1) !== 0) throw new Error(`pnpm install failed in ${profile}`)
}

/* ---------- patch 层生成：LLM 路由块 + preset-standard 覆写行（纯文本变换，保 !!js）---------- */
function personaPrefixLine(marker) {
  return `          prefix: '${marker}'`
}
function litellmBaseUrl() {
  return readFileSync(resolve(repoRoot, '.secrets/litellm-base-url.txt'), 'utf8').trim()
}
function litellmKey() {
  // 纪律 4：key 只在这里读进宿主环境变量，绝不写入被跟踪文件/日志/输出。
  return readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim()
}
function buildPatch(marker) {
  const presetFile = resolve(profile, 'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
  const lines = readFileSync(presetFile, 'utf8').split('\n')
  const insLine = lines.indexOf('- insert:')
  if (insLine < 0) throw new Error(`- insert: not found in ${presetFile}`)
  const body = lines.slice(insLine + 1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  const out = []
  let prefixSeen = 0
  for (const line of body) {
    if (/^(\s*)prefix: /.test(line)) {
      prefixSeen += 1
      out.push(line.replace(/^(\s*)prefix: .*$/, (_m, indent) => `${indent}prefix: '${marker}'`))
    } else out.push(line)
  }
  if (prefixSeen !== 1) throw new Error(`expected exactly one prefix: line, got ${prefixSeen}`)
  const llmBlock = [
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    `        baseURL: '${litellmBaseUrl()}'`,
    '        apiKeyEnv: LITELLM_API_KEY',
    "        provider: 'eterna'",
    '        models:',
    '          - id: deepseek-flash',
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
  return `# T7.0 spike patch layer — persona 前缀为被测值（由 scripts/t7-spike-verify.mjs 生成）。\n${llmBlock}${out.join('\n')}\n`
}

/* ---------- 宿主生命周期 ---------- */
let host = undefined
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: litellmKey() },
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
  // 兜底清场：精确命中本 spike 宿主（纪律 3；不匹配 't7-spike' 以免误杀本脚本，
  // 也绝不 pkill 其他 dsh 实例）。
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

/* ---------- 经 Web 宿主 HTTP API 驱动会话 ---------- */
function api(token) {
  const base = `http://127.0.0.1:${port}`
  const state = { cookie: undefined, rpcId: 0 }
  const call = async (endpoint, args) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `t7-${++state.rpcId}`, method: endpoint, payload: { args } }),
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
        try { return await call('session/create', { request: { cwd: `/tmp/t7-spike-ws-${process.pid}` } }) } catch (error) {
          if (i === 19) throw error
          await sleep(1000)
        }
      }
    },
    prompt: (sessionId) => call('session/prompt', { request: {
      requestId: `t7-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text: PROMPT_TEXT }],
    } }),
    /** 回合完成信号：session/events 页面出现 turn/end（wait 的 'idle' 不可靠）。 */
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
    /** 运行中断言源：attached 会话的内存日志（无磁盘落盘依赖）。 */
    liveSystemPromptTexts: async (sessionId) => {
      const page = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
      const lines = page.records.map((r) => JSON.stringify(r.event))
      return systemPromptTextsOfLines(lines).join('\n')
    },
  }
}

/* ---------- 主流程 ---------- */
let exitCode = 0
let sessionAId
let sessionBId
try {
  if (await portBusy()) {
    console.error(`端口 ${port} 已被占用（绝不 pkill 其他实例）——请先释放或检查遗留 t7 宿主`)
    process.exit(1)
  }
  console.log(`[boot] repo=${repoRoot}`)
  console.log(`[boot] home=${home}`)
  ensureProfile()

  // 1) 写入标记 A + 组合预检（不 mount：校验 patch 可解析、marker 已进树、装载干净）
  writeFileSync(resolve(profile, 'cordis.patch.yml'), buildPatch(MARKER_A))
  {
    const r = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    const out = r.stdout ?? ''
    check('preflight: dump-config 退出码 0', r.status === 0, `status=${r.status}`)
    check('preflight: 组合树 persona 前缀=标记 A', out.includes(MARKER_A))
    check('preflight: 无 skipping/incompatible', !/skipping|incompatible/i.test(out))
    if (r.status !== 0 || !out.includes(MARKER_A)) throw new Error('组合预检失败，中止（见上方输出）')
  }

  // 2) 启动宿主（标记 A），等待就绪
  startHost()
  const token = await waitForToken()
  const hostPid = host.pid
  console.log(`[host] ready pid=${hostPid} log=${hostLog}`)
  const dsh = api(token)
  await dsh.connect()

  // 3) 会话 A：系统提示含标记 A（运行中断言走 session/events）
  sessionAId = (await dsh.createSession()).sessionId
  await dsh.prompt(sessionAId)
  await dsh.awaitTurnEnd(sessionAId, 1)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('会话 A 系统提示含标记 A', texts.includes(MARKER_A), `session=${sessionAId}`)
    check('会话 A 系统提示不含标记 B', !texts.includes(MARKER_B))
  }

  // 4) 不重启，patch 层原位改写标记 B（触发 HMR profile 重组合；awaitWriteFinish≈2s）
  const patchPath = resolve(profile, 'cordis.patch.yml')
  const patchBefore = readFileSync(patchPath, 'utf8')
  writeFileSync(patchPath, patchBefore.replace(`prefix: '${MARKER_A}'`, `prefix: '${MARKER_B}'`))
  if (!readFileSync(patchPath, 'utf8').includes(MARKER_B)) throw new Error('标记 B 写入失败')
  console.log('[spike] patch 已原位改写 A→B；宿主不重启，等待 HMR 重组合 8s')
  await sleep(8000)
  check('宿主进程 pid 未变（未重启）', host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)

  // 5) 会话 B：系统提示含标记 B（通道 A 核心断言；容忍重组合延迟重试）
  let textsB = ''
  for (let attempt = 1; attempt <= 3 && !textsB.includes(MARKER_B); attempt++) {
    if (attempt > 1) await sleep(5000)
    sessionBId = (await dsh.createSession()).sessionId
    await dsh.prompt(sessionBId)
    await dsh.awaitTurnEnd(sessionBId, 1)
    textsB = await dsh.liveSystemPromptTexts(sessionBId)
  }
  check('会话 B 系统提示含标记 B（新会话无需重启即生效 → 通道 A）', textsB.includes(MARKER_B), `session=${sessionBId}`)
  check('会话 B 系统提示不含标记 A', !textsB.includes(MARKER_A))
  check('宿主进程 pid 仍为启动时 pid（全程未重启）', host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)
  {
    const log = readFileSync(hostLog, 'utf8')
    check('宿主日志只有一次 dsh web: 启动行（无二次 boot）', (log.match(/dsh web: /g) ?? []).length === 1)
    check('宿主日志含 eterna-llm-openai → LiteLLM 调用证据', log.includes('[eterna-llm-openai] POST'))
  }

  // 6) 旧会话不受影响：patch=B 后给会话 A 再补一轮，运行中日志不出现标记 B
  await dsh.prompt(sessionAId)
  await dsh.awaitTurnEnd(sessionAId, 2)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('旧会话 A 补轮后系统提示仍无标记 B', !texts.includes(MARKER_B), `session=${sessionAId}`)
  }

  // 7) 优雅停宿主（持久化层停机冲刷），磁盘复断言 + 清理
  console.log('[cleanup] SIGTERM 宿主，等待落盘冲刷…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  await stopHost()
  const freed = !(await portBusy())
  check('清理：宿主进程已停止、端口 3108 已释放', freed)
  if (!freed) {
    spawnSync('pkill', ['-9', '-f', `profile ${profileName}`], { stdio: 'ignore' })
    await sleep(1000)
  }
  rmSync(`/tmp/t7-spike-ws-${process.pid}`, { recursive: true, force: true })

  // 7b) 磁盘复断言（ask 指定的断言源）：停机冲刷后的会话 JSONL
  try {
    if (sessionAId) {
      const file = sessionLogFile(sessionAId)
      if (check('磁盘 JSONL(会话 A) 可读', file !== undefined, file ?? '')) {
        const texts = sessionLogTexts(file).join('\n')
        check('磁盘 JSONL(会话 A) 含标记 A、不含标记 B', texts.includes(MARKER_A) && !texts.includes(MARKER_B))
      }
    }
    if (sessionBId) {
      const file = sessionLogFile(sessionBId)
      if (check('磁盘 JSONL(会话 B) 可读', file !== undefined, file ?? '')) {
        const texts = sessionLogTexts(file).join('\n')
        check('磁盘 JSONL(会话 B) 含标记 B、不含标记 A', texts.includes(MARKER_B) && !texts.includes(MARKER_A))
      }
    }
  } catch (error) {
    failures.push(String(error?.message ?? error))
    console.error(`[FATAL disk] ${String(error?.message ?? error)}`)
  }

  console.log(`\n结论：${failures.length === 0 ? '通道 A 断言全部通过（exit 0）' : `存在失败项（exit 1）：${failures.join(' | ')}`}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
