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
 *      T2.1 起保存优先经官方 configEditor seam 写回热生效——5.8 审计通道字段=
 *      config-editor、5.9 整行写回后 !!js 表达式保真、5.10 写后 dump-config 干跑
 *      通过、5.11 不等 8s 文件监视 HMR 的新会话立即用新文(edit 返回即重组合完成);
 *   D. loopPrompt/trace 返回新会话轮次树(含工具调用与审批点:回合内驱动
 *      bash 工具,宿主 approval/asked 审批瀑布经官方 $events 流转发给本脚本,
 *      以 $events/result 应答 allowed-once——与浏览器 owner client 同一协议);
 *   E. 回滚(两段式)产生新版本(source=rollback,parentId=被回滚版本)且旧版本仍在;
 *   F. 导出 JSON 包(只读不走审批)checksum==sha256(persona);
 *      删除包内一行再导入→schemaVersion/checksum 强校验拒绝(未入库、有审计);
 *      原样重导→两段式 committed 成新版本(source=import,checksum 与原包一致);
 *   G. governance 审计事件含以上每次写操作(approval-requested/committed/rejected,
 *      operator/versionId/at 齐全;无 glue 场景落 <home>/eterna-prompt-studio/audit.jsonl)。
 *   T2.2 逐条目热生效实测矩阵(断言链 15,测试计划 §4 T2.2——判据唯一通道):
 *   夹具=patch 层 preset-cordis 同构行(生产档形状;文本与 standard 互异防回放身份
 *   歧义)+ tmpWs git 项目根 AGENTS.md 指令链夹具;对矩阵内每条目执行
 *   「改→同进程生效验证→回滚」,黄金判据=同进程(pid 不变)新会话立即用新文;
 *   进行中会话第二面(快照回放/durable 指令消息)一并实测;只读型/运行时注入型
 *   =fail-closed 拒写+回放按型跳过审计;领域层=写回/回滚闭环+写后 dump-config
 *   组合树不含新文(本档未装载领域包);registry effect 声明与实测对账(15.40);
 *   矩阵落 docs/dev/ps-v2-hot-effect-matrix.md(逐格引用本链断言编号)。
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

/* T2.2 逐条目热生效实测矩阵标记(断言链 15;docs/dev/ps-v2-hot-effect-matrix.md):
 * - cordis 同构预设行(preset-cordis)四个子插件与生产档同构(persona/agent-instructions/
 *   time-context/planning→plan-mode),文本刻意与 standard 档互异——防回放身份判定歧义
 *   (assembly-replay SKIP_GOVERNING_AMBIGUOUS 语义);
 * - 指令链夹具:tmpWs git init + AGENTS.md(标记行置于文件后段,>64B)——
 *   agent-instructions 的 maxBytes 改动半径以「标记是否被新上限截掉」观测。 */
const CORDIS_PERSONA_BASE = 'T7_E2E_CORDIS_PERSONA_BASE creative mode persona alpha'
const CORDIS_PERSONA_TAIL = 'T7_E2E_CORDIS_PERSONA_V2 rewritten creative persona gamma. 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const CORDIS_PERSONA_NEW = CORDIS_PERSONA_TAIL
const CORDIS_PERSONA_V2 = 'T7_E2E_CORDIS_PERSONA_V2'
const CORDIS_PLAN_SECTION = [
  'You are in plan mode (cordis preset). Stay in plan mode until the user approves',
  'your plan through exit_plan_mode or switches the session mode. T7_E2E_CORDIS_PLAN_BASE anchor sentence.',
  '',
  'Explore first with non-mutating reads and ground the plan in the actual repository.',
]
const CORDIS_PLAN_BASE = 'T7_E2E_CORDIS_PLAN_BASE'
const CORDIS_PLAN_V2 = 'T7_E2E_CORDIS_PLAN_V2'
const CORDIS_PLAN_NEW = `You are in plan mode (cordis preset). ${CORDIS_PLAN_V2}: the cordis plan section was rewritten by the T2.2 hot-effect matrix chain. Explore first with non-mutating reads.`
const AGENT_INSTR_MARKER = 'T7_E2E_AGENT_INSTR_MARKER'
const SMALL_MAXBYTES = '64'

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
    // T2.2 热生效矩阵夹具:preset-cordis 同构行(生产档形状,四个子插件;文本与
    // standard 档互异防回放身份歧义)。cordis 预设四条注册表条目由此在本宿主可定位。
    '- id: preset-cordis',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    "    id: cordis",
    '    order: 4',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    '          prefix: >-',
    `            ${CORDIS_PERSONA_BASE}`,
    '      - id: agent-instructions',
    "        name: '@deepseek-ai/dsh-agent-instructions'",
    '        config:',
    '          maxBytes: 65536',
    '      - id: time-context',
    "        name: '@deepseek-ai/dsh-time-context'",
    '      - id: planning',
    '        name: cordis:group',
    '        group: true',
    '        isolate:',
    '          planMode: true',
    '        config:',
    '          - id: plan-mode',
    "            name: '@deepseek-ai/dsh-plan-mode'",
    '            config:',
    '              section: |',
    ...CORDIS_PLAN_SECTION.map(line => (line === '' ? '' : `                ${line}`)),
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
    /**
     * T2.2 全消息面(system/message + user/message):agent-instructions 的指令链
     * 以 user/message 的 <system-reminder> 载荷注入(首轮 request 内,run2 实测:
     * 事件类型=user/message,非 system-prompt source)——截断判定按标记是否出现
     * 在任何消息内容里。
     */
    allMessageTexts: async (sessionId) => {
      const page = await call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } })
      return page.records
        .map((r) => r.event)
        .filter((e) => e?.type === 'system/message' || e?.type === 'user/message')
        .map((e) => (e.data?.message?.content ?? e.data?.content ?? []).map((c) => c.text ?? '').join('\n'))
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
/* T2.2 领域层写回落点的仓库文件原文(断言链 15 写→回滚的零残留复核 +
 * finally 兜底还原:链中途崩溃时不把临时标记留在被跟踪文件里)。 */
const domainMatrixFiles = [
  'packs/event-planning/cordis.patch.yml',
  'packs/event-planning/persona.md',
  'packs/industrial-analysis/cordis.patch.yml',
  'packs/industrial-analysis/persona.md',
]
const domainOriginals = new Map(domainMatrixFiles.map((file) => [file, readFileSync(resolve(repoRoot, file), 'utf8')]))
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
  // T2.2 指令链夹具:项目根标记(.git)+ AGENTS.md(标记行在文件后段,全文件
  // ≈130B>64B)——agent-instructions 的 maxBytes 半径以标记是否被截掉观测。
  mkdirSync(tmpWs, { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: tmpWs, stdio: 'ignore' })
  writeFileSync(resolve(tmpWs, 'AGENTS.md'), [
    '# T7.5 e2e instruction-chain fixture(project root marker file).',
    `This workspace carries one instruction payload line for the matrix. ${AGENT_INSTR_MARKER} gamma delta epsilon zeta eta theta.`,
    '',
  ].join('\n'))

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
  // T2.1 写穿 configEditor 断言(测试计划 §4 T2.1:官方 seam 写回 + 不重启热生效):
  // persona 落点在 live patch 顶层 preset-standard 行 → 优先走 configEditor.edit 通道
  // (edit 返回时 Loader 重组合已完成),entry-patch 直写降为兜底。
  {
    const committedRecs = (await waitForAuditActions(['prompt-save.committed']))
      .filter((r) => r.action === 'prompt-save.committed')
    check('5.8 T2.1: 保存经 configEditor 通道(审计 committed 带 channel=config-editor)',
      committedRecs.some((r) => r.channel === 'config-editor'),
      `channels=${committedRecs.map((r) => r.channel).join(',') || '(未读到)'}`)
    const patchNow = readFileSync(patchPath, 'utf8')
    const jsLines = patchNow.split('\n').filter((l) => l.includes('!!js') && l.includes('process.platform'))
    check('5.9 T2.1: configEditor 整行写回后 !!js 表达式保真(未被求值 bake)',
      jsLines.some((l) => l.includes("=== 'win32'")) && jsLines.some((l) => l.includes("!== 'win32'")),
      `jsExpr 行数=${jsLines.length}`)
    const dump = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    check('5.10 T2.1: configEditor 写回后 dump-config 干跑通过且组合树含新文(V2)',
      dump.status === 0 && (dump.stdout ?? '').includes(MARKER_V2) && !/skipping|incompatible/i.test(dump.stdout ?? ''),
      `status=${dump.status}`)
    // 即时热生效:不等 8s 文件监视 HMR(configEditor.edit 返回即重组合完成),
    // 立即开新会话即用新文——「写回后不重启,新会话即用新文」的通道级证据。
    const sessionCId = (await dsh.createSession()).sessionId
    await dsh.prompt(sessionCId, PROMPT_TEXT)
    await dsh.awaitTurnEnd(sessionCId, 1)
    const textsC = await dsh.liveSystemPromptTexts(sessionCId)
    check('5.11 T2.1: 新会话 C 不等 HMR 即用新文(configEditor 同步重组合;同进程 pid 不变)',
      textsC.includes(MARKER_V2) && host.exitCode === null && host.pid === hostPid,
      `session=${sessionCId}`)
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
    // T1.4 起装载种子按条目:除 persona 链(total)外,另有 9 条 patch 值型条目链首
    // 各 1 文档(live patch 的 agent-instructions/plan-mode + T2.2 夹具 cordis 行的
    // persona/agent-instructions/plan-mode + 领域层 4 条;time-context×2 只读型与
    // runtime×2 运行时注入型无静态值不种子)——磁盘口径=persona total+9。
    check('12.1 版本库单元落 DSH storage 栈(一文档一记录,数=persona total+9 条目链首)',
      docs.length === versionsFinal.total + 9, `docs=${docs.length} total=${versionsFinal.total}`)
  }

  // 14) 断言链 T2.4:历史会话严格回放(system-prompt/assemble waterfall 按会话快照
  //     替换条目文本;计划书 §6 T2.4/测试计划 §4 T2.4)。非 persona 条目采样=
  //     preset.standard.plan-mode.section(改前旧会话已开 → 改后旧会话补轮仍旧文、
  //     新会话用新文;同一服务不重启 pid 不变;审计含回放事件 applied|governed——
  //     两条通道都证明治理条目身份是从**会话快照**解析的)。
  {
    // 基线锚点=standard 预设 plan 段第二句(新文刻意不保留,作新旧判别);
    // 新文=原首句 + T2.4 标记(保持 plan 语义,防模型行为漂移)。
    const PLAN_BASE_ANCHOR = 'Imperative language to implement changes means plan the implementation, not execute it'
    const PLAN_V2_MARKER = 'T7_E2E_PLAN_V2'
    const PLAN_NEW = `You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode. ${PLAN_V2_MARKER}: plan-mode 段已由 T2.4 回放断言链改写(新会话应见此段)。`
    // commands/execute 形参须与 descriptor 全量匹配(submittedAttachments 不可缺省)。
    const enterPlanMode = (sessionId) => dsh.call('commands/execute', { agentId: sessionId, line: '/plan', submittedAttachments: [] })

    // 旧会话 P(改前开启,快照=基线 plan 段)+ 激活 plan 模式 + 首轮(基线可见)
    const sessionPId = (await dsh.createSession()).sessionId
    const planOnP = await enterPlanMode(sessionPId)
    check('14.1 /plan 命令进入 plan 模式(command/execute 返回 success)', planOnP?.result?.kind === 'success',
      `kind=${planOnP?.result?.kind} text=${String(planOnP?.result?.text ?? '').slice(0, 60)}`)
    await dsh.prompt(sessionPId, PROMPT_TEXT)
    await dsh.awaitTurnEnd(sessionPId, 1)
    {
      const texts = await dsh.liveSystemPromptTexts(sessionPId)
      check('14.2 会话 P(旧)首轮系统提示含基线 plan 段(plan 模式激活,回放前提)',
        texts.includes(PLAN_BASE_ANCHOR), `session=${sessionPId}`)
      check('14.3 会话 P(旧)首轮系统提示不含 plan 新文标记(尚未保存)', !texts.includes(PLAN_V2_MARKER))
    }
    // 快照侧证:T2.3 快照里该条目文本=基线(旧会话回放的数据源)
    {
      const snap = await dsh.call('loopPrompt/session-snapshot', { input: { sessionId: sessionPId } })
      const planEntry = (snap.snapshot?.entries ?? []).find((e) => e.entryId === 'preset.standard.plan-mode.section')
      check('14.4 会话 P 快照:plan-mode 条目文本=基线(严格回放数据源在位)',
        snap.status === 'ok' && planEntry?.text !== null && String(planEntry?.text).includes(PLAN_BASE_ANCHOR),
        `status=${snap.status} entryText=${String(planEntry?.text ?? null).slice(0, 50)}`)
    }

    // 改非 persona 条目:plan-mode section 两段式保存(configEditor 通道热生效)
    const planSave1 = await dsh.call('loopPrompt/prompt-save', {
      input: { entryId: 'preset.standard.plan-mode.section', content: PLAN_NEW, author, summary: 'T2.4 回放:plan-mode 段改新文' },
    })
    check('14.5 prompt-save(plan-mode,一段): status=approval-required', planSave1.status === 'approval-required',
      `status=${planSave1.status}`)
    const planSave2 = await dsh.call('loopPrompt/prompt-save', {
      input: {
        entryId: 'preset.standard.plan-mode.section', content: PLAN_NEW, author,
        approvalId: planSave1.approval?.approvalId, approved: true, summary: 'T2.4 回放:plan-mode 段改新文',
      },
    })
    check('14.6 prompt-save(plan-mode,二段): committed(非 persona 条目写回)',
      planSave2.status === 'committed' && planSave2.version?.entryId === 'preset.standard.plan-mode.section',
      `status=${planSave2.status}`)

    // 新会话 Q(改后开启):plan 模式激活后首轮即用新文(新会话读最新)
    const sessionQId = (await dsh.createSession()).sessionId
    await enterPlanMode(sessionQId)
    await dsh.prompt(sessionQId, PROMPT_TEXT)
    await dsh.awaitTurnEnd(sessionQId, 1)
    {
      const texts = await dsh.liveSystemPromptTexts(sessionQId)
      check('14.7 会话 Q(新)系统提示含 plan 新文标记(新会话读最新)', texts.includes(PLAN_V2_MARKER),
        `session=${sessionQId}`)
      check('14.8 会话 Q(新)系统提示不含基线 plan 段首句(新文已替换)', !texts.includes(PLAN_BASE_ANCHOR))
    }

    // 旧会话 P 补轮:严格回放核心——仍基线旧文、不含新文标记(同服务不重启)
    await dsh.prompt(sessionPId, PROMPT_TEXT)
    await dsh.awaitTurnEnd(sessionPId, 2)
    {
      const texts = await dsh.liveSystemPromptTexts(sessionPId)
      check('14.9 会话 P(旧)补轮后仍含基线 plan 段(旧会话全程沿用快照)',
        texts.includes(PLAN_BASE_ANCHOR), `session=${sessionPId}`)
      check('14.10 会话 P(旧)补轮后不含 plan 新文标记(严格回放不吸收新文)',
        !texts.includes(PLAN_V2_MARKER))
      check('14.11 宿主 pid 未变(严格回放全程同一服务)', host.exitCode === null && host.pid === hostPid,
        `pid=${host.pid}`)
    }

    // 审计证据:回放监听按会话快照替换/身份解析(applied=已替换回旧文;governed=
    // 段文本本就等于快照旧值[旧会话 scoped 层持久持有旧实例],身份经快照解析)——
    // 两条通道都以 snapshotId+entryId 证明「回放由会话快照治理」。
    {
      const auditFile2 = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
      const replayScan = await (async () => {
        const t0 = Date.now()
        for (;;) {
          const records = existsSync(auditFile2)
            ? readFileSync(auditFile2, 'utf8').split('\n').filter(Boolean)
              .map((line) => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
              .map((r) => r.detail ?? {})
              .filter((d) => typeof d.action === 'string' && d.action.startsWith('assembly-replay.'))
            : []
          const hit = records.filter((d) => d.sessionId === sessionPId
            && (d.action === 'assembly-replay.applied' || d.action === 'assembly-replay.governed')
            && [...(d.replaced ?? []), ...(d.governed ?? [])].some((item) => item.entryId === 'preset.standard.plan-mode.section'))
          if (hit.length >= 1) return { records, hit }
          if (Date.now() - t0 > 15000) return { records, hit }
          await sleep(500)
        }
      })()
      check('14.12 审计:会话 P 有回放事件(applied|governed)且治理条目=plan-mode(身份从会话快照解析)',
        replayScan.hit.length >= 1,
        `events=${replayScan.hit.map((d) => d.action).join(',') || '(未读到)'} replayEvents=${replayScan.records.length}`)
    }
  }

  // 15) 断言链 T2.2:逐条目热生效实测矩阵(测试计划 §4 T2.2——判据唯一通道):
  //     对矩阵内每条目执行「改→同进程生效验证→回滚」,逐条输出 PASS/FAIL;矩阵文档
  //     docs/dev/ps-v2-hot-effect-matrix.md 逐格引用本链断言编号(无编号格子判未实测)。
  //     预设条目半径以「同进程(pid 不变)新会话是否立即用新文」为黄金判据;进行中
  //     会话沿用开启时快照(T2.4 严格回放)或 durable 首条指令消息,作为半径第二面
  //     一并实测;只读型/运行时注入型以「写链路 fail-closed 拒写 + 回放按型跳过」
  //     实测;领域层条目以「写回/回滚闭环 + 写后组合树不含新文(本档未装载领域包)」
  //     实测。宿主全程不重启(host.pid 断言逐段在场)。
  {
    /** 两段式保存(非默认条目;返回两段结果)。 */
    const saveTwoPhase = async (entryId, content, summary) => {
      const input = { entryId, content, author, summary }
      const phase1 = await dsh.call('loopPrompt/prompt-save', { input })
      const phase2 = await dsh.call('loopPrompt/prompt-save', {
        input: { ...input, approvalId: phase1.approval?.approvalId, approved: true },
      })
      return { phase1, phase2 }
    }
    /** 两段式回滚(按版本归属条目落点)。 */
    const rollbackTwoPhase = async (versionId, summary) => {
      const input = { versionId, author, summary }
      const phase1 = await dsh.call('loopPrompt/prompt-rollback', { input })
      const phase2 = await dsh.call('loopPrompt/prompt-rollback', {
        input: { ...input, approvalId: phase1.approval?.approvalId, approved: true },
      })
      return { phase1, phase2 }
    }
    /** 条目链最新版本 id(回滚目标)。 */
    const latestVersionOf = async (entryId) =>
      (await dsh.call('loopPrompt/prompt-versions', { input: { entryId } })).versions?.[0]
    /** 干跑 dump-config(同进程组合证据;不写状态)。 */
    const dumpConfigText = () => new Promise((resolveDump, rejectDump) => {
      const r = spawnSync(process.execPath, [
        resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
        '--profile', profileName, '--dump-config',
      ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
      if (r.status === 0) resolveDump(r.stdout ?? '')
      else rejectDump(new Error(`dump-config status=${r.status}`))
    })
    /** 选预设(上游 agentPresets/select:会话首回合前选 preset;wire 字段=agentId)。 */
    const selectPreset = (sessionId, agentPreset) =>
      dsh.call('agentPresets/select', { agentId: sessionId, agentPreset })

    // —— 15.1 声明面:snapshot entries[] 全部带 effect.radius(枚举内) ——
    {
      const snap = await dsh.call('loopPrompt/snapshot')
      const radii = new Set(['immediate-new-session', 'not-composed-anywhere', 'readonly-upstream', 'runtime-rebuilt'])
      const entries = snap.entries ?? []
      check('15.1 矩阵声明面:entries[] 16 条全部带 effect.radius(T2.2 registry effect 字段透传;T3.1 起 16 条含元提示词层)',
        entries.length === 16 && entries.every((e) => typeof e.effect?.radius === 'string' && radii.has(e.effect.radius))
        && entries.every((e) => typeof e.effect?.note === 'string' && e.effect.note.length > 0),
        `radius=${entries.map((e) => e.effect?.radius).join(',') ?? '(缺)'}`)
    }

    // —— A|preset.standard.agent-instructions(maxBytes 数值配置的生效半径) ——
    {
      const entryId = 'preset.standard.agent-instructions'
      const before = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check('15.2 A|前置: prompt-get{agent-instructions} 值=65536(数值配置反引)',
        before.value?.text === '65536', `value=${before.value?.text}`)

      const sessionI1 = (await dsh.createSession()).sessionId
      await dsh.prompt(sessionI1, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionI1, 1)
      const textsI1 = await dsh.allMessageTexts(sessionI1)
      check('15.3 A|会话 I1 基线: 指令链注入(AGENTS.md 标记在消息面,项目根=cwd)',
        textsI1.includes(AGENT_INSTR_MARKER), `session=${sessionI1}`)

      const { phase1: ai1, phase2: ai2 } = await saveTwoPhase(entryId, SMALL_MAXBYTES, 'T2.2 矩阵:指令链上限降至 64B')
      check('15.4 A|两段式保存 maxBytes=64: committed', ai1.status === 'approval-required' && ai2.status === 'committed'
        && ai2.version?.entryId === entryId, `status=${ai2.status}`)

      const sessionI2 = (await dsh.createSession()).sessionId
      await dsh.prompt(sessionI2, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionI2, 1)
      const textsI2 = await dsh.allMessageTexts(sessionI2)
      check('15.5 A|同进程新会话 I2: 指令链按 64B 上限截断(标记不在消息面;pid 不变)→即时(新会话)',
        !textsI2.includes(AGENT_INSTR_MARKER) && host.exitCode === null && host.pid === hostPid,
        `session=${sessionI2}`)

      await dsh.prompt(sessionI1, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionI1, 2)
      const textsI1b = await dsh.allMessageTexts(sessionI1)
      check('15.6 A|进行中会话 I1 补轮: 指令消息仍在消息面(durable 首条不改写)→旧会话沿用',
        textsI1b.includes(AGENT_INSTR_MARKER), `session=${sessionI1}`)

      const latestAi = await latestVersionOf(entryId)
      const seedAi = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: aiRb2 } = await rollbackTwoPhase(seedAi?.id ?? latestAi?.id, 'T2.2 矩阵:指令链上限回滚到 initial')
      check('15.7 A|回滚(两段式): committed(source=rollback,版本链只增)',
        aiRb2.status === 'committed' && aiRb2.version?.source === 'rollback', `seq=${aiRb2.version?.seq}`)
      const afterAi = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check('15.8 A|回滚后值回 65536(数值 round-trip 闭环)',
        afterAi.value?.text === '65536', `value=${afterAi.value?.text}`)
    }

    // —— B|preset.cordis.persona + preset.cordis.agent-instructions(cordis 同构行) ——
    {
      const dumpCordis = await dumpConfigText()
      check('15.9 B|前置: dump-config 组合树含 cordis 同构行基线(夹具行已入组合)',
        dumpCordis.includes(CORDIS_PERSONA_BASE) && !/skipping|incompatible/i.test(dumpCordis))
      const cordisPersona = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.cordis.persona' } })
      check('15.10 B|前置: prompt-get{cordis.persona} 折叠块(>-)反引=基线',
        cordisPersona.value?.text === CORDIS_PERSONA_BASE, `bytes=${cordisPersona.value?.bytes}`)

      const sessionC1 = (await dsh.createSession()).sessionId
      const selected = await selectPreset(sessionC1, 'cordis')
      check('15.11 B|agentPresets/select(cordis) 返回 preset 身份(会话选定创造模式)',
        typeof selected === 'string' && selected === 'cordis', `selected=${JSON.stringify(selected)}`)
      await dsh.prompt(sessionC1, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionC1, 1)
      const textsC1 = await dsh.liveSystemPromptTexts(sessionC1)
      check('15.12 B|会话 C1(cordis): 系统提示含 cordis 基线且不含 standard 标记(预设隔离)',
        textsC1.includes(CORDIS_PERSONA_BASE) && !textsC1.includes(MARKER_BASE), `session=${sessionC1}`)
      const messagesC1 = await dsh.allMessageTexts(sessionC1)
      check('15.13 B|会话 C1(cordis): 指令链注入(AGENTS.md 标记在消息面;cordis 档 agent-instructions 同构)',
        messagesC1.includes(AGENT_INSTR_MARKER), `session=${sessionC1}`)

      const { phase2: cp2 } = await saveTwoPhase('preset.cordis.persona', CORDIS_PERSONA_NEW, 'T2.2 矩阵:cordis persona 改新文')
      const { phase2: ca2 } = await saveTwoPhase('preset.cordis.agent-instructions', SMALL_MAXBYTES, 'T2.2 矩阵:cordis 指令链上限降至 64B')
      check('15.14 B|两段式保存(cordis persona+agent-instructions 双写): 均 committed',
        cp2.status === 'committed' && ca2.status === 'committed', `persona=${cp2.status} instr=${ca2.status}`)

      const sessionC2 = (await dsh.createSession()).sessionId
      await selectPreset(sessionC2, 'cordis')
      await dsh.prompt(sessionC2, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionC2, 1)
      const textsC2 = await dsh.liveSystemPromptTexts(sessionC2)
      const messagesC2 = await dsh.allMessageTexts(sessionC2)
      check('15.15 B|同进程新会话 C2: persona 即时换新文(含 V2 不含基线;pid 不变)→即时(新会话)',
        textsC2.includes(CORDIS_PERSONA_V2) && !textsC2.includes(CORDIS_PERSONA_BASE)
        && host.exitCode === null && host.pid === hostPid, `session=${sessionC2}`)
      check('15.16 B|同进程新会话 C2: 指令链按 64B 截断(标记不在消息面)→即时(新会话)',
        !messagesC2.includes(AGENT_INSTR_MARKER), `session=${sessionC2}`)

      const cordisSeedPersona = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.cordis.persona' } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: cpRb2 } = await rollbackTwoPhase(cordisSeedPersona?.id, 'T2.2 矩阵:cordis persona 回滚到 initial')
      const cordisSeedInstr = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.cordis.agent-instructions' } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: caRb2 } = await rollbackTwoPhase(cordisSeedInstr?.id, 'T2.2 矩阵:cordis 指令链上限回滚')
      const afterCp = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.cordis.persona' } })
      const afterCa = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.cordis.agent-instructions' } })
      check('15.17 B|双回滚闭环: persona 折叠块反引回基线 + agent-instructions 值回 65536',
        cpRb2.status === 'committed' && caRb2.status === 'committed'
        && afterCp.value?.text === CORDIS_PERSONA_BASE && afterCa.value?.text === '65536',
        `persona=${afterCp.value?.text?.slice(0, 30)}… instr=${afterCa.value?.text}`)
    }

    // —— C|preset.cordis.plan-mode.section(cordis 档 plan 段) ——
    {
      const entryId = 'preset.cordis.plan-mode.section'
      const before = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check('15.18 C|前置: prompt-get{cordis.plan-mode} 字面块(|)反引含基线锚',
        (before.value?.text ?? '').includes(CORDIS_PLAN_BASE), `bytes=${before.value?.bytes}`)
      const enterPlanMode = (sessionId) => dsh.call('commands/execute', { agentId: sessionId, line: '/plan', submittedAttachments: [] })

      const sessionC3 = (await dsh.createSession()).sessionId
      await selectPreset(sessionC3, 'cordis')
      const planOnC3 = await enterPlanMode(sessionC3)
      check('15.19 C|会话 C3(cordis)进入 plan 模式(/plan success)', planOnC3?.result?.kind === 'success',
        `kind=${planOnC3?.result?.kind}`)
      await dsh.prompt(sessionC3, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionC3, 1)
      const textsC3 = await dsh.liveSystemPromptTexts(sessionC3)
      check('15.20 C|会话 C3 基线: 系统提示含 cordis plan 基线锚(plan 模式激活时注入)',
        textsC3.includes(CORDIS_PLAN_BASE), `session=${sessionC3}`)

      const { phase2: cpl2 } = await saveTwoPhase(entryId, CORDIS_PLAN_NEW, 'T2.2 矩阵:cordis plan 段改新文')
      check('15.21 C|两段式保存新段: committed', cpl2.status === 'committed' && cpl2.version?.entryId === entryId,
        `status=${cpl2.status}`)

      const sessionC4 = (await dsh.createSession()).sessionId
      await selectPreset(sessionC4, 'cordis')
      await enterPlanMode(sessionC4)
      await dsh.prompt(sessionC4, PROMPT_TEXT)
      await dsh.awaitTurnEnd(sessionC4, 1)
      const textsC4 = await dsh.liveSystemPromptTexts(sessionC4)
      check('15.22 C|同进程新会话 C4(cordis+/plan): plan 段即时换新文(含 V2 不含基线锚;pid 不变)→即时(新会话)',
        textsC4.includes(CORDIS_PLAN_V2) && !textsC4.includes(CORDIS_PLAN_BASE)
        && host.exitCode === null && host.pid === hostPid, `session=${sessionC4}`)

      const cordisSeedPlan = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: cplRb2 } = await rollbackTwoPhase(cordisSeedPlan?.id, 'T2.2 矩阵:cordis plan 段回滚')
      const afterCpl = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check('15.23 C|回滚闭环: committed 且字面块反引回基线锚',
        cplRb2.status === 'committed' && (afterCpl.value?.text ?? '').includes(CORDIS_PLAN_BASE)
        && !afterCpl.value?.text.includes(CORDIS_PLAN_V2), `status=${cplRb2.status}`)
    }

    // —— D|只读型拒写(time-context×2:改后生效半径不存在,写链路 fail-closed) ——
    {
      const tcStd = await dsh.call('loopPrompt/prompt-save', {
        input: { entryId: 'preset.standard.time-context', content: '不可能被接受的写入', author, summary: 'T2.2 矩阵:只读型拒写探针' },
      })
      check('15.24 D|prompt-save{standard.time-context}: rejected 且明示无 patch 写回落点',
        tcStd.status === 'rejected' && (tcStd.issues ?? []).some((s) => s.includes('无 patch 写回落点')),
        `status=${tcStd.status} issues=${JSON.stringify(tcStd.issues)?.slice(0, 120)}`)
      const tcCordis = await dsh.call('loopPrompt/prompt-save', {
        input: { entryId: 'preset.cordis.time-context', content: '不可能被接受的写入', author, summary: 'T2.2 矩阵:只读型拒写探针' },
      })
      check('15.25 D|prompt-save{cordis.time-context}: rejected 且同明示',
        tcCordis.status === 'rejected' && (tcCordis.issues ?? []).some((s) => s.includes('无 patch 写回落点')),
        `status=${tcCordis.status}`)
    }

    // —— E|运行时注入型(memory/glue section:拒写 + 回放按型跳过 + 快照分型标注) ——
    {
      const rtMemory = await dsh.call('loopPrompt/prompt-save', {
        input: { entryId: 'runtime.memory.index-section', content: '不可能被接受的写入', author, summary: 'T2.2 矩阵:运行时注入型拒写探针' },
      })
      check('15.26 E|prompt-save{runtime.memory.index-section}: rejected 且明示运行时注入型',
        rtMemory.status === 'rejected' && (rtMemory.issues ?? []).some((s) => s.includes('运行时注入型')),
        `status=${rtMemory.status} issues=${JSON.stringify(rtMemory.issues)?.slice(0, 120)}`)
      const rtGlue = await dsh.call('loopPrompt/prompt-save', {
        input: { entryId: 'runtime.glue.memory-plugin', content: '不可能被接受的写入', author, summary: 'T2.2 矩阵:运行时注入型拒写探针' },
      })
      check('15.27 E|prompt-save{runtime.glue.memory-plugin}: rejected 且同明示',
        rtGlue.status === 'rejected' && (rtGlue.issues ?? []).some((s) => s.includes('运行时注入型')),
        `status=${rtGlue.status}`)
      // 回放按型跳过(审计证据):任何 applied 回放事件的 skippedEntries 应含两条 runtime
      // 条目且 reason=runtime-injection(文本每次装配重建,不受快照回放冻结)。
      {
        const auditFile3 = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
        const appliedEvents = existsSync(auditFile3)
          ? readFileSync(auditFile3, 'utf8').split('\n').filter(Boolean)
            .map((line) => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
            .map((r) => r.detail ?? {})
            .filter((d) => d.action === 'assembly-replay.applied' || d.action === 'assembly-replay.governed')
          : []
        const skips = appliedEvents.flatMap((d) => d.skippedEntries ?? [])
        check('15.28 E|审计: 回放事件(applied|governed)的 skippedEntries 含两条 runtime 条目(reason=runtime-injection,按型跳过实测)',
          skips.some((s) => s.entryId === 'runtime.memory.index-section' && String(s.reason).includes('runtime-injection'))
          && skips.some((s) => s.entryId === 'runtime.glue.memory-plugin' && String(s.reason).includes('runtime-injection')),
          `applied=${appliedEvents.length} runtimeSkips=${skips.filter((s) => String(s.reason).includes('runtime-injection')).length}`)
      }
      // 快照分型标注:任一矩阵会话的快照里 runtime 条目为在场标注(不伪造 versionId)。
      {
        const snapList = await dsh.call('loopPrompt/session-snapshot', { input: {} })
        const firstSessionId = snapList.snapshots?.[0]?.sessionId
        const snap = firstSessionId !== undefined
          ? await dsh.call('loopPrompt/session-snapshot', { input: { sessionId: firstSessionId } })
          : undefined
        const rtEntry = snap?.snapshot?.entries?.find((e) => e.entryId === 'runtime.memory.index-section')
        check('15.29 E|快照分型: runtime 条目=在场标注(annotation 含「运行时注入」,versionId=null 不伪造)',
          snap?.status === 'ok' && rtEntry !== undefined && rtEntry.versionId === null
          && String(rtEntry.annotation ?? '').includes('运行时注入'),
          `annotation=${String(rtEntry?.annotation ?? '(缺)').slice(0, 40)}`)
      }
    }

    // —— F/G|领域层 personaPrefix×2(直写兜底通道 + 本档未装载领域包的组合证据) ——
    for (const [seq, entryId, file, marker, anchor] of [
      ['F', 'domain.event-planning.persona-prefix', 'packs/event-planning/cordis.patch.yml', 'T7_E2E_EVENT_PREFIX_V2', 'senior event planning specialist'],
      ['G', 'domain.industrial-analysis.persona-prefix', 'packs/industrial-analysis/cordis.patch.yml', 'T7_E2E_IND_PREFIX_V2', 'senior industrial data-intelligence analysis specialist'],
    ]) {
      const filePath = resolve(repoRoot, file)
      const original = domainOriginals.get(file) ?? ''
      const before = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check(`15.30${seq}|前置: prompt-get 反引含领域身份句(>- 折叠块)`,
        String(before.value?.text ?? '').includes(anchor), `bytes=${before.value?.bytes}`)
      const newText = `${String(before.value?.text)} ${marker} appended by T2.2 matrix.`
      const { phase2 } = await saveTwoPhase(entryId, newText, `T2.2 矩阵:${entryId} 追加标记句`)
      check(`15.31${seq}|两段式保存(原文+标记句): committed`, phase2.status === 'committed'
        && phase2.version?.entryId === entryId, `status=${phase2.status}`)
      {
        const auditFile4 = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
        const commits = existsSync(auditFile4)
          ? readFileSync(auditFile4, 'utf8').split('\n').filter(Boolean)
            .map((line) => { try { return JSON.parse(line) } catch { return undefined } }).filter(Boolean)
            .map((r) => r.detail ?? {})
            .filter((d) => d.action === 'prompt-save.committed' && d.entryId === entryId)
          : []
        check(`15.32${seq}|审计: committed channel=entry-patch(领域条目走直写兜底通道明示)`,
          commits.some((d) => d.channel === 'entry-patch'), `channels=${commits.map((d) => d.channel).join(',') || '(未读到)'}`)
      }
      const after = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check(`15.33${seq}|写回落盘 + 同进程读回: pack 文件含标记且 prompt-get 反引含标记`,
        readFileSync(filePath, 'utf8').includes(marker) && String(after.value?.text).includes(marker),
        `fileHas=${readFileSync(filePath, 'utf8').includes(marker)}`)
      const dumpAfter = await dumpConfigText()
      check(`15.34${seq}|组合半径: dump-config 组合树不含标记(t7 档未装载领域包,改动不进入组合)`,
        !dumpAfter.includes(marker) && !/skipping|incompatible/i.test(dumpAfter))
      const seed = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: rb2 } = await rollbackTwoPhase(seed?.id, `T2.2 矩阵:${entryId} 回滚到 initial`)
      const afterRb = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check(`15.35${seq}|回滚(两段式): committed 且反引值=写前基线(>- 块语义等价重述;标记不残留)`,
        rb2.status === 'committed' && String(afterRb.value?.text) === String(before.value?.text)
        && !readFileSync(filePath, 'utf8').includes(marker),
        `status=${rb2.status} valueRestored=${String(afterRb.value?.text) === String(before.value?.text)}`)
    }

    // —— H/I|领域层 persona-md ×2(整文件条目;当前无运行时注入点→不参与任何组装) ——
    for (const [seq, entryId, file, marker] of [
      ['H', 'domain.event-planning.persona-md', 'packs/event-planning/persona.md', 'T7_E2E_EVENT_MD_V2'],
      ['I', 'domain.industrial-analysis.persona-md', 'packs/industrial-analysis/persona.md', 'T7_E2E_IND_MD_V2'],
    ]) {
      const filePath = resolve(repoRoot, file)
      const original = domainOriginals.get(file) ?? ''
      const before = await dsh.call('loopPrompt/prompt-get', { input: { entryId } })
      check(`15.36${seq}|前置: prompt-get 反引=persona.md 全文(整文件条目)`,
        before.value?.text === original, `bytes=${before.value?.bytes}/${Buffer.byteLength(original, 'utf8')}`)
      const newText = `${original}\n\nT2.2 matrix marker line: ${marker} (temporary, rolled back in the same chain).\n`
      const { phase2 } = await saveTwoPhase(entryId, newText, `T2.2 矩阵:${entryId} 追加标记行`)
      check(`15.37${seq}|两段式保存(全文+标记行): committed`, phase2.status === 'committed'
        && phase2.version?.entryId === entryId, `status=${phase2.status}`)
      const dumpAfter = await dumpConfigText()
      check(`15.38${seq}|写后组合面: 文件含标记而 dump-config 组合树不含(该文件不参与任何宿主组装)`,
        readFileSync(filePath, 'utf8').includes(marker) && !dumpAfter.includes(marker)
        && !/skipping|incompatible/i.test(dumpAfter))
      const seed = (await dsh.call('loopPrompt/prompt-versions', { input: { entryId } }))
        .versions?.find((v) => v.source === 'initial')
      const { phase2: rb2 } = await rollbackTwoPhase(seed?.id, `T2.2 矩阵:${entryId} 回滚到 initial`)
      check(`15.39${seq}|回滚(两段式): committed 且文件字节=原文`,
        rb2.status === 'committed' && readFileSync(filePath, 'utf8') === original,
        `status=${rb2.status} restored=${readFileSync(filePath, 'utf8') === original}`)
    }

    // —— J|矩阵声明对账(registry effect 声明 ↔ 实测结论;矩阵文档互锁) ——
    {
      const snap = await dsh.call('loopPrompt/snapshot')
      const radiusOf = new Map((snap.entries ?? []).map((e) => [e.id, e.effect?.radius]))
      const expectRadius = (id, radius) => radiusOf.get(id) === radius
      check('15.40 J|声明对账: preset patch 值型 6 条=即时(新会话);time-context×2=readonly-upstream;domain×4=not-composed;runtime×2=runtime-rebuilt(与 15.2-15.39 实测逐面一致)',
        ['preset.standard.persona', 'preset.standard.agent-instructions', 'preset.standard.plan-mode.section',
          'preset.cordis.persona', 'preset.cordis.agent-instructions', 'preset.cordis.plan-mode.section']
          .every((id) => expectRadius(id, 'immediate-new-session'))
        && expectRadius('preset.standard.time-context', 'readonly-upstream')
        && expectRadius('preset.cordis.time-context', 'readonly-upstream')
        && ['domain.event-planning.persona-prefix', 'domain.event-planning.persona-md',
          'domain.industrial-analysis.persona-prefix', 'domain.industrial-analysis.persona-md']
          .every((id) => expectRadius(id, 'not-composed-anywhere'))
        && expectRadius('runtime.memory.index-section', 'runtime-rebuilt')
        && expectRadius('runtime.glue.memory-plugin', 'runtime-rebuilt'),
        `radius=${[...radiusOf.entries()].map(([id, r]) => `${id.split('.').at(-1)}:${r}`).join(' ') ?? '(缺)'}`)
      check('15.41 J|矩阵收尾: 宿主 pid 未变(矩阵全程同一服务,无重启)',
        host.exitCode === null && host.pid === hostPid, `pid=${host.pid}`)
      // 领域层收尾:标记零残留(四份文件)+ 前缀条目反引值回基线(语义等价;>-
      // 折叠块回滚是按值重述,块字节可被规范化——字节级还原由 finally 兜底统一执行)。
      const markerFree = domainMatrixFiles.every((file) => !readFileSync(resolve(repoRoot, file), 'utf8')
        .includes('T7_E2E_'))
      const eventPrefixAfter = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.event-planning.persona-prefix' } })
      const indPrefixAfter = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.industrial-analysis.persona-prefix' } })
      check('15.42 J|领域层收尾: 四份仓库 pack 文件无矩阵标记残留 + 两条前缀条目反引值已回滚',
        markerFree && String(eventPrefixAfter.value?.text).includes('senior event planning specialist')
        && !String(eventPrefixAfter.value?.text).includes('T7_E2E_')
        && String(indPrefixAfter.value?.text).includes('senior industrial data-intelligence analysis specialist')
        && !String(indPrefixAfter.value?.text).includes('T7_E2E_'),
        `markerFree=${markerFree}`)
    }
  }

  console.log('[cleanup] SIGTERM 宿主(持久化层停机冲刷)…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  // T2.2 领域层安全网:断言链 15 中途崩溃时不把临时标记留在被跟踪的 pack 文件里
  // (正常路径回滚已字节还原,此处应为 no-op;还原动作不入版本链——版本库在
  // .eterna-home-t7 运行态内,下轮整体清场)。
  for (const [file, original] of domainOriginals) {
    const filePath = resolve(repoRoot, file)
    try {
      if (existsSync(filePath) && readFileSync(filePath, 'utf8') !== original) {
        writeFileSync(filePath, original)
        console.log(`[matrix-guard] ${file} 字节与运行前原文不同(>- 折叠块回滚按值重述的规范化差异,或链中途崩溃),已按运行前原文还原`)
      }
    } catch (error) {
      console.error(`[matrix-guard] ${file} 兜底还原失败:${String(error?.message ?? error)}`)
    }
  }
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
