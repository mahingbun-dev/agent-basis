#!/usr/bin/env node
/**
 * T7.5 集成验收(真会话 E2E;可重复执行,退出码 0/1)。计划书 §6 T7.5 行:
 * 全链路「修改→R3 审批→新会话生效→轨迹可见→回滚→导出→再导入→版本链完整」。
 *
 * 断言链(逐条输出 [PASS]/[FAIL],全部落 docs/dev/t7-acceptance.md):
 *   A. 前端发起 persona 修改(经宿主 HTTP /api 通道,与 T7.2 浏览器半边
 *      ctx.connection.rpc 同一 wire 形态 payload.args={input:{…}})→
 *      loopPrompt/prompt-save 一段返回 R3 审批卡(matchedRule.grade='R3'、
 *      ruleId=eterna.prompt-studio.persona-write、doubleConfirm→2 个 questionItems、
 *      patch 未落盘、snapshot.pendingApproval 出现);
 *   B. 允许一次(二段回显同 content+baseVersionId+approvalId+approved)→
 *      committed、版本 +1、checksum 变化(==sha256(新文本)、≠写前);
 *   C. 新会话系统提示含新文本(LITELLM 真模型回合,通道 A 无需重启、宿主 pid 不变);
 *      旧会话(保存前已开)补轮后系统提示不含新文本;
 *   D. loopPrompt/trace 返回新会话轮次树(含工具调用与审批点:回合内驱动
 *      bash 工具,宿主 approval/asked 审批瀑布经官方 $events 流转发给本脚本,
 *      以 $events/result 应答 allowed-once——与浏览器 owner client 同一协议);
 *   E. 回滚(两段式)产生新版本(source=rollback,parentId=被回滚版本)且旧版本仍在;
 *   F. 导出 JSON 包(只读不走审批)checksum==sha256(persona);
 *      删除包内一行再导入→schemaVersion/checksum 强校验拒绝(未入库、有审计);
 *      原样重导→两段式 committed 成新版本(source=import,checksum 与原包一致);
 *   G. governance 审计事件含以上每次写操作(approval-requested/committed/rejected,
 *      operator/versionId/at 齐全;无 glue 场景落 <home>/eterna-prompt-studio/audit.jsonl)。
 *
 * 隔离纪律:运行态全在 .eterna-home-t7(DSH_HOME);Web 宿主一律 3108;进程清理只用
 * SIGTERM + pkill -f 'profile t7-studio' 精确模式(绝不 pkill 其他 dsh 实例);
 * LITELLM_API_KEY 只从 .secrets/litellm-master-key.txt 读进宿主进程环境,不写入
 * 任何被跟踪文件/日志/输出。
 *
 * 已知时序事实(docs/dev/t7-spike.md §6):回合完成以 session/events 出现 turn/end
 * 为准(wait 的 'idle' 不可靠);approval 应答经 /api/remote.mux WebSocket mux
 * (JSON 帧:{type:'open',streamId,endpoint,payload} → {type:'item',streamId,value},
 * 首帧 value.type='ready' 携带 clientId;approval/request 以 value.type='waterfall'
 * 投递,经 HTTP /api/$events/result 以 {clientId,eventId,outcome} 结算)。
 *
 * 用法:node scripts/t7-e2e.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const profileName = 't7-studio'
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 't7-e2e-host.log')
const port = 3108
const pkgDir = resolve(repoRoot, 'packages', 'prompt-studio')
const pkgName = '@eterna/prompt-studio'
const rowId = 'eterna-prompt-studio'
const author = 't7-e2e'

/* persona 文本(基线=patch 层单引号标量;新文本=基线+红线行,唯一子串作断言锚点) */
const MARKER_BASE = 'T7_E2E_PERSONA_BASE alpha'
const MARKER_V2 = 'T7_E2E_STUDIO_V2'
const SAVE_TAIL = 'T7_E2E_STUDIO_V2 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const NEW_TEXT = `${MARKER_BASE}\n${SAVE_TAIL}`
const PROMPT_TEXT = '请只回复两个字:在线'
const TOOL_PROMPT = '请用 bash 工具运行命令 echo T7_E2E_TRACE_OK,并且这次调用必须带上 sandbox_permissions 参数(取值 danger-full-access)与 justification 参数(内容: T7.5 e2e 审批点留痕)。然后把命令输出原样告诉我。不要做其他任何事。'

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const require_ = createRequire(import.meta.url)

/* ---------- 断言台账(供 docs/dev/t7-acceptance.md 逐条誊录) ---------- */
const failures = []
const ledger = []
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  ledger.push({ name, ok, detail: String(detail).slice(0, 600) })
  if (!ok) failures.push(name)
  return ok
}

/* ---------- 秘钥(纪律 4:只读进宿主进程环境,不落盘/不进日志) ---------- */
function litellmKey() {
  return readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim()
}
function litellmBaseUrl() {
  return readFileSync(resolve(repoRoot, '.secrets/litellm-base-url.txt'), 'utf8').trim()
}

/* ---------- profile 自举(幂等;与 t7-smoke.mjs 同配方) ---------- */
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
  console.log('[boot] profile node_modules 缺失,执行 pnpm install(首次较慢)…')
  const r = spawnSync('pnpm', ['install'], { cwd: profile, stdio: 'inherit' })
  if ((r.status ?? 1) !== 0) throw new Error(`pnpm install failed in ${profile}`)
}

/* ---------- 插件装载(PLUGIN-AUTHORING §4 symlink 终态,幂等;t7-smoke 同款) ---------- */
function ensurePluginInstalled() {
  const linkPath = resolve(profile, 'node_modules', '@eterna', 'prompt-studio')
  const { lstatSync, realpathSync, mkdirSync: mkDir, symlinkSync } = require_('node:fs')
  if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
    try {
      if (realpathSync(linkPath) === pkgDir) return 'already-linked'
    } catch { /* 悬空链接,重建 */ }
  }
  rmSync(linkPath, { recursive: true, force: true })
  mkDir(resolve(profile, 'node_modules', '@eterna'), { recursive: true })
  symlinkSync(pkgDir, linkPath, 'dir')
  return 'linked'
}

/* ---------- patch 层生成(纯文本变换 + LLM 路由 + studio insert 行;t7-smoke 同款) ---------- */
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
  const head = [
    '# T7.5 e2e patch layer(LLM 路由 + persona 基线标记 + eterna-prompt-studio 行;由 scripts/t7-e2e.mjs 生成)。',
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
    '# 提示词工坊+循环轨迹(T7.5 e2e;@eterna/prompt-studio 的 insert 行)。',
    '- insert:',
    `    - id: ${rowId}`,
    `      name: '${pkgName}'`,
    '',
  ].join('\n')
  return `${head}${out.join('\n')}\n`
}

/* ---------- 宿主生命周期(纪律 3:清理只精确命中本 profile) ---------- */
let host
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

/* ---------- Web 宿主 HTTP API RPC 客户端(spike 同款;SRC 载荷 { args } 按形参名) ---------- */
function api(token) {
  const base = `http://127.0.0.1:${port}`
  const state = { cookie: undefined, rpcId: 0 }
  const call = async (endpoint, args = {}) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `t7-e2e-${++state.rpcId}`, method: endpoint, payload: { args } }),
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { throw new Error(`${endpoint}: non-JSON ${res.status}: ${text.slice(0, 200)}`) }
    if (!body.result?.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(body.result?.error ?? body).slice(0, 400)}`)
    return body.result.value
  }
  return {
    call,
    get cookie() { return state.cookie },
    async connect() {
      const res = await fetch(`${base}/connect?token=${token}&interactions=answer`, { redirect: 'manual' })
      state.cookie = res.headers.get('set-cookie')?.split(';')[0]
      if (!state.cookie) throw new Error('/connect: no cookie')
    },
    createSession: async () => {
      for (let i = 0; i < 20; i++) {
        try { return await call('session/create', { request: { cwd: `/tmp/t7-e2e-ws-${process.pid}` } }) } catch (error) {
          if (i === 19) throw error
          await sleep(1000)
        }
      }
    },
    prompt: (sessionId, text) => call('session/prompt', { request: {
      requestId: `t7-e2e-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text }],
    } }),
    /** 回合完成信号:session/events 出现 turn/end(spike 实证:'idle' 不可靠)。 */
    awaitTurnEnd: async (sessionId, minTurns = 1, timeoutMs = 180000) => {
      const t0 = Date.now()
      let lastPage
      for (;;) {
        lastPage = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
        const turns = lastPage.records.filter((r) => r.event?.type === 'turn/end')
        if (turns.length >= minTurns) return lastPage
        if (host.exitCode !== null) throw new Error(`host exited while awaiting turn/end of ${sessionId}`)
        if (Date.now() - t0 > timeoutMs) {
          const tail = lastPage.records.slice(-8).map((r) => r.event?.type).join(',')
          throw new Error(`session ${sessionId}: ${turns.length}/${minTurns} turn/end after ${timeoutMs}ms; tail=${tail}`)
        }
        await sleep(1000)
      }
    },
    /** 运行中断言源:attached 会话的内存日志(system-prompt 源消息文本拼接)。 */
    liveSystemPromptTexts: async (sessionId) => {
      const page = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
      return page.records
        .map((r) => r.event)
        .filter((e) => e?.type === 'system/message' && e.data?.message?.source?.kind === 'system-prompt')
        .map((e) => e.data.message.content.map((c) => c.text ?? '').join('\n'))
        .join('\n')
    },
  }
}

/* ---------- 官方 $events 流客户端(remote.mux WebSocket mux + $events/result 应答) ---------- */
function loadWsModule() {
  try { return require_('ws') } catch { /* 仓库无 ws,落到 profile 的 pnpm store */ }
  const storeDir = resolve(home, 'profiles', profileName, 'node_modules', '.pnpm')
  const dir = readdirSync(storeDir).find((d) => /^ws@\d/.test(d))
  if (dir === undefined) throw new Error('ws 模块不可得(仓库与 profile pnpm store 均无)')
  return require_(resolve(storeDir, dir, 'node_modules', 'ws'))
}

class RemoteEventsClient {
  #ws = undefined
  #clientId = undefined
  #waterfalls = []
  #wake = undefined
  #closed = false

  constructor(cookie) {
    this.cookie = cookie
    this.streamId = `t7-e2e-events-${process.pid}`
  }

  async open() {
    const { WebSocket } = loadWsModule()
    this.#ws = new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`, { headers: { cookie: this.cookie } })
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error('remote.mux WebSocket open timeout(15s)')), 15000)
      this.#ws.once('open', () => { clearTimeout(timer); resolveOpen() })
      this.#ws.once('error', (error) => { clearTimeout(timer); rejectOpen(error) })
    })
    this.#ws.on('message', (raw) => this.#onFrame(String(raw)))
    this.#ws.on('close', () => { this.#closed = true; this.#wake?.() })
    this.#send({ type: 'open', streamId: this.streamId, endpoint: '$events', payload: { args: {} } })
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('$events ready frame timeout(15s)')), 15000)
      const poll = () => {
        if (this.#clientId !== undefined) { clearTimeout(timer); resolveReady(); return }
        if (this.#closed) { clearTimeout(timer); rejectReady(new Error('socket closed before ready')); return }
        setTimeout(poll, 100)
      }
      poll()
    })
  }

  #send(message) { this.#ws.send(JSON.stringify(message)) }

  #onFrame(text) {
    let message
    try { message = JSON.parse(text) } catch { return }
    if (message.type !== 'item' || message.streamId !== this.streamId) {
      if (message.type === 'error') console.log(`[events] stream error: ${JSON.stringify(message.error)?.slice(0, 200)}`)
      return
    }
    const value = message.value
    if (value?.type === 'ready') {
      this.#clientId = value.clientId
      console.log(`[events] $events stream ready clientId=${value.clientId}`)
      this.#wake?.()
      return
    }
    if (value?.type === 'waterfall') {
      console.log(`[events] waterfall ${value.event} eventId=${value.eventId} request=${JSON.stringify(value.request ?? {})?.slice(0, 200)}`)
      this.#waterfalls.push(value)
      this.#wake?.()
    }
  }

  get clientId() { return this.#clientId }

  /** 等待一条指定事件的 waterfall 投递(跳过已应答过的 eventId,支持多次投递)。 */
  async waitForWaterfall(event, timeoutMs = 60000, { exclude = new Set() } = {}) {
    const t0 = Date.now()
    for (;;) {
      const found = this.#waterfalls.find((w) => w.event === event && !exclude.has(w.eventId))
      if (found !== undefined) return found
      if (Date.now() - t0 > timeoutMs) throw new Error(`waterfall ${event} not delivered within ${timeoutMs}ms`)
      if (this.#closed) throw new Error('events socket closed while waiting for waterfall')
      await new Promise((r) => { this.#wake = r; setTimeout(r, 500) })
      this.#wake = undefined
    }
  }

  /** 结算一条 waterfall(与浏览器 owner client 同一协议:HTTP $events/result)。 */
  async answer(eventId, value) {
    if (this.#clientId === undefined) throw new Error('$events client not ready')
    const res = await fetch(`http://127.0.0.1:${port}/api/$events/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `t7-e2e-ev-${Math.random().toString(36).slice(2, 10)}`,
        method: '$events/result',
        payload: { args: { clientId: this.#clientId, eventId, outcome: { kind: 'result', value } } },
      }),
    })
    const body = await res.json().catch(() => undefined)
    if (!body?.result?.ok) throw new Error(`$events/result failed: ${JSON.stringify(body?.result?.error ?? body)?.slice(0, 300)}`)
  }

  close() {
    try { this.#ws?.close() } catch { /* 已关 */ }
  }
}

/* ---------- 审计轮询读(写链路审计为异步落账,轮询到齐或超时) ---------- */
function readAuditRecords() {
  const file = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch { return undefined } })
    .filter((r) => r !== undefined)
    .map((r) => (r.detail ?? r))
}

async function waitForAuditActions(actions, timeoutMs = 15000) {
  const t0 = Date.now()
  for (;;) {
    const records = readAuditRecords().filter((r) => actions.includes(r.action))
    if (actions.every((action) => records.some((r) => r.action === action))) return records
    if (Date.now() - t0 > timeoutMs) return readAuditRecords()
    await sleep(500)
  }
}

/* ---------- 主流程 ---------- */
let exitCode = 0
let sessionAId
let sessionBId
let events
const tmpWs = `/tmp/t7-e2e-ws-${process.pid}`
try {
  if (await portBusy()) {
    console.error(`端口 ${port} 已被占用(绝不 pkill 其他实例)——请先释放或检查遗留 t7 宿主`)
    process.exit(1)
  }
  if (!existsSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'))) {
    throw new Error('凭据缺失:.secrets/litellm-master-key.txt 不存在(纪律 8:不伪造)')
  }
  console.log(`[boot] repo=${repoRoot}`)
  console.log(`[boot] home=${home}`)
  ensureProfile()

  // 0) 幂等:清本包运行态(版本库单元 + 兜底审计 + 会话日志),断言从零复现。
  rmSync(resolve(home, 'storages', 'eterna_prompt_studio'), { recursive: true, force: true })
  rmSync(resolve(home, 'eterna-prompt-studio'), { recursive: true, force: true })
  rmSync(resolve(home, 'sessions'), { recursive: true, force: true })
  rmSync(tmpWs, { recursive: true, force: true })

  // 1) 浏览器半边 bundle(client-modules 扫 exports["./client"] 要求存在)。
  const build = spawnSync(process.execPath, [resolve(pkgDir, 'scripts/build-client.mjs')], { encoding: 'utf8' })
  check('0.1 浏览器半边 bundle 构建(lib/client.js)', build.status === 0 && existsSync(resolve(pkgDir, 'lib/client.js')),
    (build.stderr ?? '').split('\n').at(-1) ?? '')

  const installState = ensurePluginInstalled()
  console.log(`[boot] plugin ${pkgName}: ${installState}`)

  // 2) patch 层(基线标记 + studio 行)+ dump-config 组合预检
  const patchPath = resolve(profile, 'cordis.patch.yml')
  writeFileSync(patchPath, buildPatch(MARKER_BASE))
  {
    const r = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    const out = r.stdout ?? ''
    check('0.2 preflight: dump-config 退出码 0', r.status === 0, `status=${r.status}`)
    check('0.3 preflight: 组合树 persona 前缀=基线标记', out.includes(MARKER_BASE))
    check('0.4 preflight: 组合树含 eterna-prompt-studio 行', out.includes(pkgName))
    check('0.5 preflight: 无 skipping/incompatible', r.status === 0 && !/skipping|incompatible/i.test(out))
    if (r.status !== 0 || !out.includes(pkgName)) throw new Error('组合预检失败,中止(见上方输出)')
  }

  // 3) 启动宿主(3108)
  startHost()
  const token = await waitForToken()
  const dsh = api(token)
  await dsh.connect()
  const hostPid = host.pid
  console.log(`[host] ready pid=${hostPid} log=${hostLog}`)
  check('1.1 宿主就绪(dsh web token)', typeof token === 'string' && token.length > 0, `pid=${hostPid}`)

  {
    const inventory = await dsh.call('pluginInventory/list')
    const entry = (inventory.entries ?? []).find((e) => e.moduleName === pkgName)
    check('1.2 pluginInventory: 含 @eterna/prompt-studio 行', entry !== undefined,
      entry === undefined ? `entries=${(inventory.entries ?? []).length}` : `entryId=${entry.entryId}`)
    check('1.3 pluginInventory: 行 enabled=true', entry?.enabled === true)
    check('1.4 pluginInventory: 行 fiberPhase=active', entry?.fiberPhase === 'active')
    check('1.5 宿主启动日志无 skipping/incompatible', !/skipping|incompatible/i.test(readFileSync(hostLog, 'utf8')))
  }

  // 4) 旧会话 A:保存前开回合(LITELLM 真模型),作为「不受新文本影响」的对照
  sessionAId = (await dsh.createSession()).sessionId
  await dsh.prompt(sessionAId, PROMPT_TEXT)
  await dsh.awaitTurnEnd(sessionAId, 1)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('2.1 会话 A(旧)回合完成且系统提示含基线标记', texts.includes(MARKER_BASE), `session=${sessionAId}`)
    check('2.2 会话 A 系统提示不含 V2 新文本(尚未保存)', !texts.includes(MARKER_V2))
  }

  // 5) snapshot/prompt-get/prompt-versions 基线
  const snapshot0 = await dsh.call('loopPrompt/snapshot')
  check('3.1 snapshot: channel.kind=A-patch-hmr(通道 A)', snapshot0.channel?.kind === 'A-patch-hmr')
  check('3.2 snapshot: persona.available 且含基线标记', snapshot0.persona?.available === true && snapshot0.persona.text === MARKER_BASE,
    `bytes=${snapshot0.persona?.bytes}`)
  check('3.3 snapshot: versions.ready=true(DSH storage 栈挂载)', snapshot0.versions?.ready === true, `count=${snapshot0.versions?.count}`)
  check('3.4 snapshot: 无在途审批', snapshot0.pendingApproval === null)
  check('3.5 snapshot: trace.pipeline=v0-disk-log', snapshot0.trace?.pipeline === 'v0-disk-log')
  {
    const got = await dsh.call('loopPrompt/prompt-get')
    check('3.6 prompt-get: effectiveNote 提示新会话生效', typeof got.effectiveNote === 'string' && got.effectiveNote.includes('新会话生效'))
    const versions0 = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    const initial = versions0.versions?.at(-1)
    check('3.7 prompt-versions: initial 种子(seq=1,source=initial,parentId=null)',
      initial?.seq === 1 && initial?.source === 'initial' && initial?.parentId === null, `id=${initial?.id}`)
    check('3.8 prompt-versions: initial checksum=sha256(content) 且内容=基线',
      initial?.checksum === sha256(initial?.content ?? '') && initial?.content === MARKER_BASE, `total=${versions0.total}`)
  }

  // 6) 断言链 A+B:前端发起 persona 修改 → R3 审批卡 → 允许一次 → 版本 +1(checksum 变化)
  const versionsPre = await dsh.call('loopPrompt/prompt-versions', { input: {} })
  const baseVersion = versionsPre.versions?.[0]
  const maxSeq = Math.max(...(versionsPre.versions ?? []).map((v) => v.seq))
  check('4.1 乐观锁取最新版本作 baseVersionId(versions[0]=seq 最大)', baseVersion?.seq === maxSeq,
    `baseVersionId=${baseVersion?.id} seq=${baseVersion?.seq}`)
  const phase1 = await dsh.call('loopPrompt/prompt-save', {
    input: { content: NEW_TEXT, baseVersionId: baseVersion.id, author, summary: 'T7.5 集成验收:追加红线行' },
  })
  check('4.2 prompt-save(一段): status=approval-required', phase1.status === 'approval-required')
  check('4.3 prompt-save(一段): R3 审批卡(grade=R3 + ruleId)',
    phase1.approval?.card?.matchedRule?.grade === 'R3' && phase1.approval?.card?.matchedRule?.ruleId === 'eterna.prompt-studio.persona-write',
    `ruleId=${phase1.approval?.card?.matchedRule?.ruleId}`)
  check('4.4 prompt-save(一段): doubleConfirm→2 个 questionItems', (phase1.approval?.questionItems?.length ?? 0) === 2,
    `items=${phase1.approval?.questionItems?.length}`)
  check('4.5 prompt-save(一段): patch 未落盘(V2 未写,等审批)', !readFileSync(patchPath, 'utf8').includes(MARKER_V2))
  {
    const snapPending = await dsh.call('loopPrompt/snapshot')
    check('4.6 snapshot: pendingApproval 出现且 id 一致(R3 卡在途)',
      snapPending.pendingApproval?.approvalId === phase1.approval?.approvalId && snapPending.pendingApproval?.kind === 'save',
      `approvalId=${snapPending.pendingApproval?.approvalId}`)
  }
  const approvalId = phase1.approval?.approvalId
  const phase2 = await dsh.call('loopPrompt/prompt-save', {
    input: { content: NEW_TEXT, baseVersionId: baseVersion.id, author, approvalId, approved: true },
  })
  check('5.1 prompt-save(二段): status=committed', phase2.status === 'committed')
  check('5.2 prompt-save(二段): 版本 +1(source=save, seq=写前+1)',
    phase2.version?.source === 'save' && phase2.version?.seq === (versionsPre.total ?? 0) + 1,
    `seq=${phase2.version?.seq} prevTotal=${versionsPre.total}`)
  check('5.3 版本 checksum 变化(=sha256(新文本),≠写前基线)',
    phase2.version?.checksum === sha256(NEW_TEXT) && phase2.version?.checksum !== baseVersion.checksum)
  check('5.4 prompt-save(二段): patch 层已原子更新(含 V2 文本)', readFileSync(patchPath, 'utf8').includes(MARKER_V2))
  {
    const snapAfter = await dsh.call('loopPrompt/snapshot')
    check('5.5 prompt-save(二段): 在途审批已清', snapAfter.pendingApproval === null)
  }
  await sleep(8000) // HMR 重组合时序(awaitWriteFinish≈2s;UI 按 8s 级等待)
  check('5.6 保存后宿主日志无 skipping/incompatible(HMR 洁净)', !/skipping|incompatible/i.test(readFileSync(hostLog, 'utf8')))
  check('5.7 宿主进程 pid 未变(未重启)', host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)

  // 7) 断言链 C+D:新会话生效(含 bash 工具调用 + 宿主审批点应答)+ 轨迹端点
  events = new RemoteEventsClient(dsh.cookie)
  await events.open()
  check('6.1 官方 $events 流就绪(owner client,interactions=answer)', typeof events.clientId === 'string' && events.clientId.length > 0,
    `clientId=${events.clientId}`)

  sessionBId = (await dsh.createSession()).sessionId
  const turnEndPromise = (async () => {
    await dsh.prompt(sessionBId, TOOL_PROMPT)
    return dsh.awaitTurnEnd(sessionBId, 1, 240000)
  })()
  // 宿主审批瀑布应答循环:bash 升级触发 approval/asked → 本脚本以 allowed-once 应答
  // (与浏览器 owner client 同一 $events/result 协议;每个 eventId 只应答一次,
  //  至多 3 次,余量给同会话多次升级)。
  const answered = new Set()
  const answerLoop = (async () => {
    for (let i = 0; i < 3; i += 1) {
      const waterfall = await events.waitForWaterfall('approval/request', 180000, { exclude: answered })
      await events.answer(waterfall.eventId, 'allowed-once')
      answered.add(waterfall.eventId)
      console.log(`[events] approval answered allowed-once (#${answered.size} eventId=${waterfall.eventId})`)
    }
  })().catch((error) => console.log(`[events] answer loop ended: ${String(error?.message ?? error)}`))
  await turnEndPromise
  {
    const texts = await dsh.liveSystemPromptTexts(sessionBId)
    check('6.2 会话 B(新)系统提示含新文本 V2(通道 A:保存即对新会话生效)', texts.includes(MARKER_V2), `session=${sessionBId}`)
  }
  check('6.3 会话 B 宿主审批点已应答 allowed-once(approval 瀑布走官方 $events)', answered.size >= 1,
    `answered=${answered.size}`)

  {
    const report = await dsh.call('loopPrompt/trace', { input: { sessionId: sessionBId } })
    const selected = report.selected
    check('7.1 trace(sessionId=B): 返回该会话轮次树(selected 非空,sessions 空)',
      selected?.sessionId === sessionBId && Array.isArray(selected?.turns) && selected.turns.length >= 1 && report.sessions.length === 0,
      `turns=${selected?.turns?.length}`)
    const toolsFlat = (selected?.turns ?? []).flatMap((t) => t.tools ?? [])
    check('7.2 trace(B): 轮次树含工具调用(callId/name/argsPreview/durationMs)',
      toolsFlat.length >= 1 && toolsFlat.every((c) => typeof c.callId === 'string' && c.callId.length > 0)
      && toolsFlat.some((c) => typeof c.name === 'string' && c.name.length > 0),
      `tools=${toolsFlat.map((c) => `${c.name}${c.isError ? '(err)' : ''}`).join(',') || '(none)'}`)
    const approvalsFlat = (selected?.turns ?? []).flatMap((t) => t.approvalPoints ?? [])
    check('7.3 trace(B): 轮次树含审批点(outcome=allowed-once,decidedAt 回填)',
      approvalsFlat.length >= 1 && approvalsFlat.some((p) => p.outcome === 'allowed-once' && typeof p.decidedAt === 'string'),
      `points=${JSON.stringify(approvalsFlat.map((p) => ({ name: p.name, outcome: p.outcome })))?.slice(0, 200)}`)
    const usageTurns = (selected?.turns ?? []).filter((t) => t.usage !== null)
    check('7.4 trace(B): 真模型 usage 计入轮次(inputTokens/outputTokens/totalTokens)',
      usageTurns.length >= 1 && usageTurns.every((t) => typeof t.usage.inputTokens === 'number' && typeof t.usage.outputTokens === 'number'),
      `usageTurns=${usageTurns.length}`)
    check('7.5 trace(B): 事件投影计数(total>=projected,skipped 记坏行)',
      selected?.events?.total >= selected?.events?.projected && selected?.events?.projected > 0,
      `total=${selected?.events?.total} projected=${selected?.events?.projected} skipped=${selected?.events?.skipped}`)
    const list = await dsh.call('loopPrompt/trace', { input: {} })
    check('7.6 trace 列表模式: 最近会话清单含会话 B(标题/轮次/usage 折叠)',
      Array.isArray(list.sessions) && list.sessions.some((s) => s.sessionId === sessionBId && s.turns >= 1),
      `sessions=${list.sessions?.map((s) => s.sessionId)?.slice(0, 5)?.join(',')}`)
    const snapB = await dsh.call('loopPrompt/snapshot')
    check('7.7 snapshot.trace.recent 同步含会话 B', (snapB.trace?.recent ?? []).some((s) => s.sessionId === sessionBId),
      `recent=${snapB.trace?.recent?.length}`)
  }

  // 8) 断言链 C(后半):旧会话不含新文本($events 流保持打开——socket 关闭会释放
  // 共享 Peer,后续同 cookie 的 RPC 会 401;关闭只放在 finally)
  await dsh.prompt(sessionAId, PROMPT_TEXT)
  await dsh.awaitTurnEnd(sessionAId, 2)
  {
    const texts = await dsh.liveSystemPromptTexts(sessionAId)
    check('8.1 旧会话 A 补轮后系统提示仍不含新文本 V2(进行中会话不受影响)', !texts.includes(MARKER_V2), `session=${sessionAId}`)
  }

  // 9) 断言链 E:回滚产生新版本且旧版本仍在
  const versionsMid = await dsh.call('loopPrompt/prompt-versions', { input: {} })
  const initial = versionsMid.versions?.find((v) => v.source === 'initial')
  const rb1 = await dsh.call('loopPrompt/prompt-rollback', { input: { versionId: initial.id, author, summary: 'T7.5 集成验收:回滚到 initial' } })
  check('9.1 prompt-rollback(一段): status=approval-required', rb1.status === 'approval-required')
  const rb2 = await dsh.call('loopPrompt/prompt-rollback', {
    input: { versionId: initial.id, author, approvalId: rb1.approval?.approvalId, approved: true },
  })
  check('9.2 prompt-rollback(二段): committed 且 source=rollback', rb2.status === 'committed' && rb2.version?.source === 'rollback',
    `seq=${rb2.version?.seq}`)
  check('9.3 prompt-rollback(二段): parentId=被回滚版本', rb2.version?.parentId === initial.id, `parentId=${rb2.version?.parentId}`)
  check('9.4 prompt-rollback(二段): 新版本内容=被回滚内容(checksum 一致)', rb2.version?.checksum === initial.checksum)
  {
    const after = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('9.5 版本只增不删:total=写前+1 且 initial 版本仍在',
      after.total === versionsMid.total + 1 && after.versions.some((v) => v.id === initial.id),
      `total=${after.total} prev=${versionsMid.total}`)
    check('9.6 回滚后 patch 层回到被回滚内容(无 V2 文本)', !readFileSync(patchPath, 'utf8').includes(MARKER_V2))
  }

  // 10) 断言链 F:导出 checksum 正确 → 篡改导入被拒 → 原样导入成功
  const versionsPreExport = await dsh.call('loopPrompt/prompt-versions', { input: {} })
  const savedVersion = versionsPreExport.versions?.find((v) => v.source === 'save')
  const exported = await dsh.call('loopPrompt/prompt-export', { input: { versionId: savedVersion.id, exportedBy: author } })
  check('10.1 prompt-export: pack.checksum=sha256(persona)(UTF-8 口径)',
    exported.pack?.checksum === sha256(exported.pack?.persona ?? '') && exported.pack?.checksum === savedVersion.checksum,
    `checksum=${exported.pack?.checksum?.slice(0, 12)}…`)
  check('10.2 prompt-export: 包字段(schemaVersion=1/sourceVersionId/exportedBy/exportedAt)',
    exported.pack?.schemaVersion === 1 && exported.pack?.sourceVersionId === savedVersion.id
    && exported.pack?.exportedBy === author && typeof exported.pack?.exportedAt === 'string')
  {
    const latestExport = await dsh.call('loopPrompt/prompt-export', { input: {} })
    const latest = versionsPreExport.versions?.[0]
    check('10.3 prompt-export: 缺省=最新版本', latestExport.pack?.sourceVersionId === latest.id, `latest=${latest.id}`)
    const afterExports = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    const snapExport = await dsh.call('loopPrompt/snapshot')
    check('10.4 prompt-export: 只读不走审批(版本数不变、无在途卡)',
      afterExports.total === versionsPreExport.total && snapExport.pendingApproval === null,
      `total=${afterExports.total} pending=${snapExport.pendingApproval === null ? 'null' : '非空'}`)
  }
  const pack = exported.pack
  // 篡改:删除导出包内一行(尾行)但不改 checksum → 强校验拒收
  const lines = pack.persona.split('\n')
  const tamperedPersona = lines.slice(0, -1).join('\n')
  const tampered = { ...pack, persona: tamperedPersona }
  const rejected = await dsh.call('loopPrompt/prompt-import', { input: { pack: tampered, author } })
  check('10.5 prompt-import(删一行篡改): status=rejected(checksum 强校验拒收)', rejected.status === 'rejected',
    `issues=${JSON.stringify(rejected.issues)?.slice(0, 200)}`)
  check('10.6 rejected issues 明示校验和不符', (rejected.issues ?? []).some((s) => s.includes('校验和不符') || s.includes('checksum')),
    `issues=${JSON.stringify(rejected.issues)?.slice(0, 200)}`)
  {
    const afterReject = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('10.7 拒收未入库(版本数不变)', afterReject.total === versionsPreExport.total, `total=${afterReject.total}`)
  }
  const im1 = await dsh.call('loopPrompt/prompt-import', { input: { pack, author, summary: 'T7.5 集成验收:原样重导' } })
  check('10.8 prompt-import(原样,一段): status=approval-required', im1.status === 'approval-required')
  check('10.9 prompt-import(一段): R3 审批卡(与保存同门)', im1.approval?.card?.matchedRule?.grade === 'R3'
    && (im1.approval?.questionItems?.length ?? 0) === 2)
  const im2 = await dsh.call('loopPrompt/prompt-import', {
    input: { pack, author, approvalId: im1.approval?.approvalId, approved: true },
  })
  check('10.10 prompt-import(二段): committed 且 source=import', im2.status === 'committed' && im2.version?.source === 'import',
    `seq=${im2.version?.seq}`)
  check('10.11 导入新版本 checksum=原包 checksum(与 save 版本同内容)', im2.version?.checksum === pack.checksum)
  {
    const afterImport = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('10.12 版本链完整:total=拒收前+1,initial 仍在,新→旧有序',
      afterImport.total === versionsPreExport.total + 1 && afterImport.versions.some((v) => v.id === initial.id)
      && afterImport.versions[0]?.id === im2.version?.id,
      `total=${afterImport.total} latest=${afterImport.versions?.[0]?.id}`)
  }

  // 11) 断言链 G:governance 审计事件含以上每次写操作
  {
    const expectedActions = [
      'prompt-save.approval-requested', 'prompt-save.committed',
      'prompt-rollback.approval-requested', 'prompt-rollback.committed',
      'prompt-import.rejected', 'prompt-import.approval-requested', 'prompt-import.committed',
    ]
    const all = await waitForAuditActions(expectedActions)
    const byAction = (action) => all.filter((r) => r.action === action)
    const auditFile = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
    check('11.1 兜底审计 NDJSON 存在(无 glue governance 场景)', existsSync(auditFile), auditFile)
    const rawRecords = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
    const envelopeOk = rawRecords.length > 0 && rawRecords.every((r) => r.kind === 'governance' && typeof r.at === 'string' && r.detail?.action !== undefined)
    check('11.2 审计记录为包络形态({kind:governance,at,detail:{action,…}})', envelopeOk,
      `records=${rawRecords.length} sample=${JSON.stringify(rawRecords[0] ?? null)?.slice(0, 160)}`)
    check('11.3 save 写链路留痕:approval-requested + committed',
      byAction('prompt-save.approval-requested').length >= 1 && byAction('prompt-save.committed').length >= 1)
    check('11.4 rollback 写链路留痕:approval-requested + committed',
      byAction('prompt-rollback.approval-requested').length >= 1 && byAction('prompt-rollback.committed').length >= 1)
    check('11.5 import 写链路留痕:rejected(篡改)+ approval-requested + committed(原样)',
      byAction('prompt-import.rejected').length >= 1 && byAction('prompt-import.approval-requested').length >= 1
      && byAction('prompt-import.committed').length >= 1)
    const committed = [...byAction('prompt-save.committed'), ...byAction('prompt-rollback.committed'), ...byAction('prompt-import.committed')]
    check('11.6 committed 事件含 G5 字段(system/operator/versionId/at/checksum)',
      committed.length >= 3 && committed.every((r) => r.system === 'eterna-prompt-studio' && r.operator === author
        && typeof r.versionId === 'string' && typeof r.at === 'string' && typeof r.checksum === 'string'),
      `committed=${committed.length} operators=${[...new Set(committed.map((r) => r.operator))].join(',')}`)
    const requested = [...byAction('prompt-save.approval-requested'), ...byAction('prompt-rollback.approval-requested'), ...byAction('prompt-import.approval-requested')]
    check('11.7 approval-requested 事件含操作者与在途审批 id', requested.length >= 3
      && requested.every((r) => r.operator === author && typeof r.approvalId === 'string'), `requested=${requested.length}`)
    const rejectedRec = byAction('prompt-import.rejected')[0]
    check('11.8 rejected 事件含校验失败明细(issues)', rejectedRec !== undefined && Array.isArray(rejectedRec.issues)
      && rejectedRec.issues.length >= 1, `issues=${JSON.stringify(rejectedRec?.issues)?.slice(0, 160)}`)
  }

  // 12) 磁盘证据:版本库单元一文档一记录
  {
    const unitDir = resolve(home, 'storages', 'eterna_prompt_studio', 'versions')
    const versionsFinal = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    const docs = existsSync(unitDir) ? readdirSync(unitDir).filter((f) => f.endsWith('.json')) : []
    // T1.4 起装载种子按条目:除 persona 链(total)外,另有 6 条 patch 值型条目链首
    // 各 1 文档(live patch 的 agent-instructions/plan-mode + 领域层 4 条;live patch
    // 无 preset-cordis 行,该预设条目定位失败不种子)——磁盘口径=persona total+6。
    check('12.1 版本库单元落 DSH storage 栈(一文档一记录,数=persona total+6 条目链首)',
      docs.length === versionsFinal.total + 6, `docs=${docs.length} total=${versionsFinal.total}`)
  }

  console.log('[cleanup] SIGTERM 宿主(持久化层停机冲刷)…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  try { events?.close() } catch { /* 已关 */ }
  await stopHost()
  const freed = !(await portBusy())
  check('13.1 清理:宿主进程已停止、端口 3108 已释放', freed)
  if (!freed) {
    spawnSync('pkill', ['-9', '-f', `profile ${profileName}`], { stdio: 'ignore' })
    await sleep(1000)
  }
  rmSync(tmpWs, { recursive: true, force: true })
  const passCount = ledger.filter((e) => e.ok).length
  console.log(`\n结论:${failures.length === 0 ? 'T7.5 集成验收全部通过(exit 0)' : `存在失败项(exit 1):${failures.join(' | ')}`}`)
  console.log(`断言台账:PASS=${passCount} FAIL=${ledger.filter((e) => !e.ok).length}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
