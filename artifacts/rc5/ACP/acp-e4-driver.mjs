#!/usr/bin/env node
/**
 * E4 ACP 全组驱动（51 §3.9 RC5-ACP-001..010；54 §6.1 E4）。
 *
 * 形态：`docker compose --profile acp run --rm -T --no-deps eterna-agent-acp`
 * （stdin_open=true / tty=false / 无 ports）。stdout 按 NDJSON 解析，全部帧、stderr、
 * 容器退出码、命令原文与断言结果落 artifacts/rc5/ACP/<case-id>/。
 *
 * 场景：
 *   protocol      001 002 003 004 005 006 007（单连接；本地假模型供 prompt 用例）
 *   concurrency   008（两容器同数据根并发）
 *   docs          009（文档定位检查）
 *   shared-volume 010（E1 web + ACP 同卷各跑一轮）
 *   all           顺序执行以上全部，并写 artifacts/rc5/ACP/report.json
 *
 * 凭据纪律：evidance 只写脱敏文本；不打印/落盘任何 cookie/token/API key。
 * 生产容器（eterna-agent）不在任何命令的写路径上；只操作 eterna-rc5-e4-* / e1 ACP 测试容器。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STATUS,
  bootTokenFromContainer,
  bootstrapDshSession,
  loadAccounts,
  login,
  parseArgs,
  rpc,
  shape,
} from '../../../scripts/rc5-test-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const FIXTURE = join(HERE, 'fixture')
const ENV_FIXTURE = join(FIXTURE, 'env.e4-fixture')
const ENV_FIXTURE_B = join(FIXTURE, 'env.e4-fixture-b')
const ENV_E1 = join(FIXTURE, 'env.e1-acp')
const OVERRIDE = join(FIXTURE, 'compose.acp-fixture.yml')
const MODEL_PORT = 18080
const MODEL_LOG_BASE = join(HERE, 'runs')

const args = parseArgs(process.argv.slice(2), { scenario: 'all' })
const SCENARIO = String(args.scenario)

/* --------------------------------------------------------------- 证据面 */

/** 脱敏：cookie/token/密码/API key 一律 <redacted>。证据先脱敏再落盘。 */
function safe(text) {
  if (typeof text !== 'string') return String(text)
  return text
    .replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>')
    .replace(/(eterna_session=)[^;,\s]+/g, '$1<redacted>')
    .replace(/(dsh-auth=)[^;,\s]+/g, '$1<redacted>')
    .replace(/("?(?:password|secret|token|authorization|apiKey|api_key|MIMO_API_KEY|ACP_FIXTURE_API_KEY)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1<redacted>')
    .replace(/(mcp-session-id:\s*)[^\s]+/gi, '$1<redacted>')
}

function mkdirp(path) { mkdirSync(path, { recursive: true }) }

function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }

const results = []

function record({ id, priority = 'P0', title, status, detail, assertions = [], client, command, exitInfo, extra, dir }) {
  const caseDir = dir ?? join(HERE, id)
  mkdirp(caseDir)
  const payload = {
    id,
    priority,
    title,
    status,
    at: new Date().toISOString(),
    detail: safe(detail ?? ''),
    assertions: assertions.map(row => ({ ...row, observed: safe(String(row.observed)) })),
  }
  writeJson(join(caseDir, 'assert.json'), payload)
  if (command !== undefined) {
    const resolvedExit = exitInfo ?? (client === undefined ? undefined : client.exitInfo)
    writeFileSync(join(caseDir, 'cmd.log'), `${command}\nEXIT=${resolvedExit === undefined ? 'n/a' : JSON.stringify(resolvedExit)}\n`)
  }
  if (client !== undefined) {
    writeFileSync(join(caseDir, 'stdout.ndjson'), `${client.rawLines.map(safe).join('\n')}\n`)
    writeFileSync(join(caseDir, 'stderr.log'), safe(client.stderr))
  }
  if (extra !== undefined) writeJson(join(caseDir, 'extra.json'), extra)
  results.push({ id, priority, title, status })
  console.log(`[${status}] ${id} (${priority}) ${title} :: ${safe(detail ?? '')}`)
  return payload
}

function assertion(name, expected, observed) {
  const value = typeof observed === 'boolean' ? String(observed) : observed
  const ok = typeof observed === 'boolean' ? observed : undefined
  return { name, expected, observed: value, ok }
}

/** 用例记录早于容器退出时，退出码在 close() 后回填到该 case 的 cmd.log。 */
function rewriteExit(caseId, exitInfo) {
  const path = join(HERE, caseId, 'cmd.log')
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split('\n').filter(line => !line.startsWith('EXIT=') && line !== '')
  writeFileSync(path, `${lines.join('\n')}\nEXIT=${JSON.stringify(exitInfo)}\n`)
}

/* --------------------------------------------------------------- 工具面 */

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function readEnvValue(envFile, key) {
  const text = readFileSync(envFile, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    if (trimmed.slice(0, index) === key) return trimmed.slice(index + 1)
  }
  return undefined
}

/** 只清理本夹具自己的测试容器（名字前缀硬限制），生产/其它 lane 容器一律不碰。 */
function cleanupOwnContainer(name) {
  if (!/^eterna-rc5-(e4-acpfixture|e1-acpclient)/u.test(name)) return
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30_000 })
}

/** compose run 的容器按 project label 清理（project 前缀同样硬限制）。 */
function cleanupProject(project) {
  if (!/^rc5-acp-/u.test(project)) return
  const result = spawnSync('docker', [
    'ps', '-aq',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=eterna-agent-acp',
  ], { encoding: 'utf8', timeout: 15_000 })
  const ids = (result.stdout ?? '').trim().split('\n').filter(Boolean)
  if (ids.length > 0) spawnSync('docker', ['rm', '-f', ...ids], { encoding: 'utf8', timeout: 60_000 })
}

function dockerPsLine(name) {
  const result = spawnSync('docker', ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}\t{{.Status}}'], { encoding: 'utf8', timeout: 15_000 })
  return (result.stdout ?? '').trim()
}

function inspectHealth(name) {
  const result = spawnSync('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], { encoding: 'utf8', timeout: 15_000 })
  return (result.stdout ?? '').trim()
}

function logsSince(name, sinceIso) {
  const result = spawnSync('docker', ['logs', '--since', sinceIso, name], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

/** compose run 的容器名是 `<project>-<service>-run-<hash>`（container_name 不生效），按 label 找。 */
function findRunContainer(project) {
  const result = spawnSync('docker', [
    'ps', '-q',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=eterna-agent-acp',
    '--filter', 'status=running',
  ], { encoding: 'utf8', timeout: 15_000 })
  return (result.stdout ?? '').trim().split('\n').filter(Boolean)[0]
}

function listenerReport(container) {
  const inspect = spawnSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], { encoding: 'utf8', timeout: 15_000 })
  const rawPorts = inspect.status === 0 ? (inspect.stdout ?? '').trim() : `inspect-error:${inspect.stderr ?? ''}`.slice(0, 200)
  let portMap
  try { portMap = JSON.parse(rawPorts) ?? {} } catch { portMap = undefined }
  // 镜像 EXPOSE 8080 会让 Ports 里出现 "8080/tcp": null——那是元数据，不是监听/映射；
  // 判据只看真实 host binding（数组非空）与容器内应用 socket。
  const publishedBindings = portMap === undefined ? ['<unparsable>'] : Object.values(portMap).flatMap(value => (Array.isArray(value) ? value : [])).filter(Boolean)
  const dockerPort = spawnSync('docker', ['port', container], { encoding: 'utf8', timeout: 15_000 })
  const dockerPortOutput = (dockerPort.stdout ?? '').trim()
  const tcp = spawnSync('docker', ['exec', container, 'sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'], { encoding: 'utf8', timeout: 20_000 })
  const fd = spawnSync('docker', ['exec', container, 'sh', '-c', 'ls -l /proc/[0-9]*/fd 2>/dev/null'], { encoding: 'utf8', timeout: 20_000 })
  const owned = new Set([...(fd.stdout ?? '').matchAll(/socket:\[(\d+)\]/g)].map(match => match[1]))
  const decodeV4 = hex => {
    const bytes = []
    for (let index = 6; index >= 0; index -= 2) bytes.push(Number.parseInt(hex.slice(index, index + 2), 16))
    return bytes.join('.')
  }
  const listeners = []
  for (const line of (tcp.stdout ?? '').split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 10 || columns[3] !== '0A') continue
    const [addressHex, portHex] = columns[1].split(':')
    const address = addressHex.length === 8 ? decodeV4(addressHex) : addressHex
    listeners.push({ address, port: Number.parseInt(portHex, 16), inode: columns[9] })
  }
  const appListeners = listeners.filter(item => owned.has(item.inode))
  const infra = listeners.filter(item => !owned.has(item.inode))
  return { rawPorts, portMap, publishedBindings, dockerPortOutput, appListeners, infra, rawTcpStatus: tcp.status, rawFdStatus: fd.status }
}

/* ------------------------------------------------------------ ACP 客户端 */

class AcpClient {
  constructor({ label, envFile, project, override, idBase = 1 }) {
    this.label = label
    this.envFile = envFile
    this.project = project
    this.override = override
    this.containerName = `${readEnvValue(envFile, 'ETERNA_CONTAINER_NAME')}-acp`
    this.idBase = idBase
    this.nextId = idBase
    this.rawLines = []
    this.frames = []
    this.parseErrors = []
    this.notifications = []
    this.incomingRequests = []
    this.stderr = ''
    this.pending = new Map()
    this.waiters = []
    this.onIncomingRequest = undefined
    this.exitInfo = undefined
    this.child = undefined
    this.command = undefined
    this.buffer = ''
    this.startedAt = undefined
  }

  get composeArgs() {
    const args = ['compose', '-p', this.project, '--env-file', this.envFile, '-f', join(REPO, 'docker-compose.yml')]
    if (this.override !== undefined) args.push('-f', this.override)
    args.push('--profile', 'acp', 'run', '--rm', '-T', '--no-deps', 'eterna-agent-acp')
    return args
  }

  start() {
    cleanupOwnContainer(this.containerName)
    cleanupProject(this.project)
    this.command = `cd ${REPO}\ndocker ${this.composeArgs.map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`
    this.startedAt = Date.now()
    const child = spawn('docker', this.composeArgs, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.on('exit', (code, signal) => {
      this.exitInfo = { code, signal, elapsedMs: Date.now() - this.startedAt }
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`${this.label}: ACP 进程退出 code=${code} signal=${signal} 而未响应 id=${entry.id}；stderr=${safe(this.stderr).slice(-300)}`))
      }
      this.pending.clear()
    })
    child.stdout.on('data', chunk => this.consume(chunk))
    child.stderr.on('data', chunk => { this.stderr += chunk.toString('utf8') })
    return this
  }

  consume(chunk) {
    this.buffer += chunk.toString('utf8')
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const raw = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (raw.trim() === '') continue
      this.rawLines.push(raw)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        this.parseErrors.push({ raw, error: String(error) })
        continue
      }
      const entry = { seq: this.frames.length, at: Date.now(), frame: parsed }
      this.frames.push(entry)
      this.dispatch(entry)
      for (const waiter of [...this.waiters]) {
        let matched = false
        try { matched = waiter.predicate(entry.frame) } catch { matched = false }
        if (matched) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          clearTimeout(waiter.timer)
          waiter.resolve(entry)
        }
      }
    }
  }

  dispatch(entry) {
    const frame = entry.frame
    if (frame === null || typeof frame !== 'object') return
    const hasId = frame.id !== undefined && frame.id !== null
    if (typeof frame.method === 'string' && hasId) {
      this.incomingRequests.push({ at: entry.at, frame })
      const handler = this.onIncomingRequest
      if (handler === undefined) {
        this.respondError(frame.id, -32601, `client does not handle ${frame.method}`)
        return
      }
      Promise.resolve()
        .then(() => handler(frame))
        .then(result => { if (result !== undefined) this.respond(frame.id, result) })
        .catch(error => this.respondError(frame.id, -32603, String(error)))
      return
    }
    if (typeof frame.method === 'string') {
      this.notifications.push({ at: entry.at, frame })
      return
    }
    if (hasId && ('result' in frame || 'error' in frame)) {
      const key = String(frame.id)
      const pending = this.pending.get(key)
      if (pending !== undefined) {
        this.pending.delete(key)
        pending.resolve(frame)
      }
    }
  }

  send(value) {
    this.child.stdin.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`)
  }

  request(method, params, { id, timeoutMs = 180_000 } = {}) {
    const requestId = id ?? this.nextId++
    const key = String(requestId)
    const promise = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key)
        reject(new Error(`${this.label}: 等 id=${key} (${method}) 超时 ${timeoutMs}ms；已收帧=${this.frames.length}`))
      }, timeoutMs)
      this.pending.set(key, {
        id: requestId,
        resolve: frame => { clearTimeout(timer); resolvePromise(frame) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
    })
    this.send({ jsonrpc: '2.0', id: requestId, method, params })
    return promise
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  respond(id, result) {
    this.send({ jsonrpc: '2.0', id, result })
  }

  respondError(id, code, message) {
    this.send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  waitFor(predicate, timeoutMs, label) {
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, timer: undefined }
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        reject(new Error(`${this.label}: 等 ${label} 超时 ${timeoutMs}ms；已收帧=${this.frames.length}`))
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }

  async close({ timeoutMs = 25_000 } = {}) {
    try { this.child.stdin.end() } catch { /* ignore */ }
    if (this.exitInfo !== undefined) return this.exitInfo
    await new Promise(resolvePromise => {
      const timer = setTimeout(() => {
        try { this.child.kill('SIGTERM') } catch { /* ignore */ }
        resolvePromise(undefined)
      }, timeoutMs)
      this.child.once('exit', () => { clearTimeout(timer); resolvePromise(undefined) })
    })
    return this.exitInfo
  }
}

/* ------------------------------------------------------------ 假模型控制 */

let modelServer = undefined

async function startModelServer(runDir) {
  mkdirp(runDir)
  const logPath = join(runDir, 'fake-model.log')
  const child = spawn(process.execPath, [join(FIXTURE, 'fake-model-server.mjs')], {
    env: { ...process.env, ACP_FIXTURE_PORT: String(MODEL_PORT), ACP_FIXTURE_LOG: logPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString('utf8') })
  child.stderr.on('data', chunk => { output += chunk.toString('utf8') })
  const deadline = Date.now() + 10_000
  while (!output.includes('listening') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`假模型启动失败 rc=${child.exitCode}: ${output}`)
    await sleep(100)
  }
  if (!output.includes('listening')) throw new Error(`假模型 10s 内未监听: ${output}`)
  modelServer = { child, logPath, output: () => output }
  return modelServer
}

async function stopModelServer() {
  if (modelServer === undefined) return
  try { modelServer.child.kill('SIGTERM') } catch { /* ignore */ }
  await sleep(200)
  modelServer = undefined
}

/** 轮询假模型日志：等到含 marker 的 chat_completions 请求真的到达宿主机。 */
async function waitForModelRequest(logPath, marker, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      const text = readFileSync(logPath, 'utf8')
      if (text.split('\n').some(line => line.includes('"event":"chat_completions"') && line.includes(marker))) return true
    }
    await sleep(50)
  }
  return false
}

/** 读假模型日志，返回某 marker 请求的连接关闭记录（aborted=true 即客户端取消打断了上游流）。 */
function modelAbortFor(logPath, marker) {
  if (!existsSync(logPath)) return undefined
  const rows = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return undefined }
  }).filter(Boolean)
  const request = [...rows].reverse().find(row => row.event === 'chat_completions' && String(row.promptExcerpt ?? '').includes(marker))
  if (request === undefined) return undefined
  const closed = rows.find(row => row.event === 'response_closed' && row.id === request.id)
  return { requestId: request.id, aborted: closed?.aborted }
}

/* ------------------------------------------------------------ 用例实现 */

function frameId(frame) { return frame?.id }

function framesOf(client, predicate) { return client.frames.filter(entry => predicate(entry.frame)) }

async function scenarioProtocol() {
  const runDir = join(MODEL_LOG_BASE, 'protocol')
  mkdirp(runDir)
  const model = await startModelServer(runDir)
  const client = new AcpClient({ label: 'ACP-P', envFile: ENV_FIXTURE, project: 'rc5-acp-proto', override: OVERRIDE })
  client.start()
  const commonExtra = () => ({
    command: client.command,
    exit: client.exitInfo,
    frameCount: client.frames.length,
    parseErrors: client.parseErrors.length,
    fakeModelLog: model.logPath,
  })

  /* ---------- 001 initialize 握手 ---------- */
  const initResponse = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, { id: 1, timeoutMs: 240_000 })
  const initResult = initResponse.result
  const initOk = initResponse.jsonrpc === '2.0' && initResult?.protocolVersion === 1 && typeof initResult?.agentInfo?.name === 'string'
  record({
    id: 'RC5-ACP-001',
    title: 'initialize：合法 JSON-RPC 响应 + 协议版本协商',
    status: initOk ? STATUS.PASS : STATUS.FAIL,
    detail: `protocolVersion=${initResult?.protocolVersion} agent=${initResult?.agentInfo?.name} version=${initResult?.agentInfo?.version} mcpHttp=${initResult?.agentCapabilities?.mcpCapabilities?.http}`,
    assertions: [
      { name: 'jsonrpc==2.0', expected: '2.0', observed: String(initResponse.jsonrpc), ok: initResponse.jsonrpc === '2.0' },
      { name: 'result.protocolVersion==1', expected: '1', observed: String(initResult?.protocolVersion), ok: initResult?.protocolVersion === 1 },
      { name: 'agentInfo.name 非空', expected: '非空字符串', observed: String(initResult?.agentInfo?.name), ok: typeof initResult?.agentInfo?.name === 'string' },
      { name: '无 error 字段', expected: '无', observed: String('error' in initResponse), ok: !('error' in initResponse) },
    ],
    client,
    command: client.command,
    exitInfo: client.exitInfo,
    extra: { initializeResponse: initResponse },
  })

  /* ---------- 002 session/new + session/prompt ---------- */
  const newSession = await client.request('session/new', { cwd: '/data', mcpServers: [] }, { id: 2, timeoutMs: 180_000 })
  const sessionId = newSession.result?.sessionId
  const sessionOk = typeof sessionId === 'string'
  const promptStarted = Date.now()
  let promptResponse
  let promptError
  try {
    promptResponse = await client.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: '只回复两个字：你好' }],
    }, { id: 3, timeoutMs: 120_000 })
  } catch (error) {
    promptError = error
  }
  const promptElapsed = Date.now() - promptStarted
  const stopReason = promptResponse?.result?.stopReason
  record({
    id: 'RC5-ACP-002',
    title: 'session/new + session/prompt 正常返回；无超时',
    status: sessionOk && stopReason === 'end_turn' ? STATUS.PASS : STATUS.FAIL,
    detail: `sessionId=${sessionId} stopReason=${stopReason ?? '-'} elapsed=${promptElapsed}ms${promptError === undefined ? '' : ` err=${promptError.message}`}`,
    assertions: [
      { name: 'session/new 返回 sessionId', expected: '非空字符串', observed: String(sessionId), ok: sessionOk },
      { name: 'session/prompt 无超时', expected: '<120000ms', observed: `${promptElapsed}ms`, ok: promptError === undefined },
      { name: 'stopReason==end_turn', expected: 'end_turn', observed: String(stopReason), ok: stopReason === 'end_turn' },
      { name: 'prompt 有 result 无 error', expected: 'result', observed: shape(promptResponse?.error ?? 'result'), ok: promptResponse !== undefined && promptResponse.error === undefined },
    ],
    client,
    command: client.command,
    exitInfo: client.exitInfo,
    extra: { sessionId, promptResponse, elapsedMs: promptElapsed, modelLog: model.logPath },
  })

  /* ---------- 004 无监听端口（进程存活时） ---------- */
  const runContainer = findRunContainer(client.project)
  const ports = runContainer === undefined
    ? { rawPorts: 'not-found', publishedBindings: ['<not-found>'], dockerPortOutput: '', appListeners: [], infra: [], rawTcpStatus: -1, rawFdStatus: -1 }
    : listenerReport(runContainer)
  const noPublished = Array.isArray(ports.publishedBindings) && ports.publishedBindings.length === 0 && ports.dockerPortOutput === ''
  record({
    id: 'RC5-ACP-004',
    title: 'ACP 容器无监听端口（无 host 端口映射 + /proc/net 无应用 LISTEN）',
    status: noPublished && ports.appListeners.length === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `container=${runContainer ?? '未找到'} ports=${ports.rawPorts} hostBindings=${ports.publishedBindings.length} dockerPort=${JSON.stringify(ports.dockerPortOutput)} appListeners=${ports.appListeners.map(item => `${item.address}:${item.port}`).join(',') || '无'} infra=${ports.infra.map(item => `${item.address}:${item.port}`).join(',') || '无'}`,
    assertions: [
      { name: 'run 容器存在', expected: '非空 id', observed: String(runContainer ?? ''), ok: typeof runContainer === 'string' },
      { name: '无 host 端口映射（docker inspect Ports 无 binding；EXPOSE 元数据不算）', expected: '0 binding', observed: `${ports.rawPorts} → bindings=${ports.publishedBindings.length}`, ok: noPublished },
      { name: 'docker port 输出为空', expected: '空', observed: JSON.stringify(ports.dockerPortOutput), ok: ports.dockerPortOutput === '' },
      { name: '容器内应用 LISTEN==0', expected: '0', observed: String(ports.appListeners.length), ok: ports.appListeners.length === 0 },
      { name: '/proc/net/tcp 可读', expected: 'exit 0', observed: `tcp=${ports.rawTcpStatus} fd=${ports.rawFdStatus}`, ok: ports.rawTcpStatus === 0 && ports.rawFdStatus === 0 },
    ],
    client,
    command: `docker ps -q --filter label=com.docker.compose.project=${client.project} --filter label=com.docker.compose.service=eterna-agent-acp\ndocker inspect --format '{{json .NetworkSettings.Ports}}' ${runContainer ?? '<id>'}\ndocker port ${runContainer ?? '<id>'}\ndocker exec ${runContainer ?? '<id>'} sh -c 'cat /proc/net/tcp /proc/net/tcp6'\ndocker exec ${runContainer ?? '<id>'} sh -c 'ls -l /proc/[0-9]*/fd'`,
    exitInfo: undefined,
    extra: ports,
  })

  /* ---------- 005 非法 JSON ---------- */
  client.send('{"jsonrpc":"2.0","id":99,"method":')
  let parseErrorFrame
  try {
    parseErrorFrame = (await client.waitFor(frame => frame?.error !== undefined && frame?.error?.code === -32700, 15_000, 'JSON-RPC parse error -32700')).frame
  } catch { parseErrorFrame = undefined }
  const alive = await client.request('initialize', { protocolVersion: 1 }, { id: 100, timeoutMs: 30_000 }).then(() => true).catch(() => false)
  record({
    id: 'RC5-ACP-005',
    title: '非法 JSON → JSON-RPC error（-32700）且进程不崩',
    status: parseErrorFrame !== undefined && alive ? STATUS.PASS : STATUS.FAIL,
    detail: `error.code=${parseErrorFrame?.error?.code ?? '-'} id=${String(parseErrorFrame?.id)} aliveAfter=${alive}`,
    assertions: [
      { name: 'parse error 帧到达', expected: 'error.code=-32700', observed: String(parseErrorFrame?.error?.code ?? '无'), ok: parseErrorFrame !== undefined },
      { name: '错误后 initialize 仍可用', expected: 'true', observed: String(alive), ok: alive },
      { name: '无 stdout 非 JSON 行', expected: '0', observed: String(client.parseErrors.length), ok: client.parseErrors.length === 0 },
    ],
    client,
    command: client.command,
    exitInfo: client.exitInfo,
    extra: { parseErrorFrame },
  })

  /* ---------- 006 session/request_permission ---------- */
  let permissionRequest
  client.onIncomingRequest = async frame => {
    if (frame.method !== 'session/request_permission') throw new Error(`unexpected incoming request ${frame.method}`)
    permissionRequest = { at: Date.now(), params: frame.params }
    await sleep(150)
    permissionRequest.answeredAt = Date.now()
    return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
  }
  const permissionStarted = Date.now()
  let permissionPrompt
  let permissionError
  try {
    permissionPrompt = await client.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'ACP-TOOL: 请执行审批夹具命令，然后结束。' }],
    }, { id: 6, timeoutMs: 120_000 })
  } catch (error) { permissionError = error }
  const permissionElapsed = Date.now() - permissionStarted
  const permissionStop = permissionPrompt?.result?.stopReason
  const permissionOptions = Array.isArray(permissionRequest?.params?.options) ? permissionRequest.params.options : []
  const hasAllow = permissionOptions.some(option => option?.kind === 'allow_once' || option?.optionId === 'allow-once')
  const hasReject = permissionOptions.some(option => option?.kind === 'reject_once' || option?.optionId === 'reject-once')
  record({
    id: 'RC5-ACP-006',
    title: '工具需审批：ACP 按协议发 session/request_permission；客户端应答后不挂死',
    status: permissionRequest !== undefined && hasAllow && hasReject && permissionStop === 'end_turn' ? STATUS.PASS : STATUS.FAIL,
    detail: `permissionRequest=${permissionRequest === undefined ? '无' : `toolCallId=${permissionRequest.params?.toolCall?.toolCallId}`} options=${permissionOptions.map(option => option.optionId).join(',') || '无'} stopReason=${permissionStop ?? '-'} elapsed=${permissionElapsed}ms${permissionError === undefined ? '' : ` err=${permissionError.message}`}`,
    assertions: [
      { name: '收到 session/request_permission', expected: '1 次', observed: String(permissionRequest === undefined ? 0 : 1), ok: permissionRequest !== undefined },
      { name: '请求带 sessionId', expected: sessionId, observed: String(permissionRequest?.params?.sessionId), ok: permissionRequest?.params?.sessionId === sessionId },
      { name: '请求带 toolCallId', expected: '非空', observed: String(permissionRequest?.params?.toolCall?.toolCallId), ok: typeof permissionRequest?.params?.toolCall?.toolCallId === 'string' },
      { name: '选项含 allow_once', expected: 'true', observed: String(hasAllow), ok: hasAllow },
      { name: '选项含 reject_once', expected: 'true', observed: String(hasReject), ok: hasReject },
      { name: '应答后 prompt 结束（不挂死）', expected: '<120000ms 且 end_turn', observed: `${permissionElapsed}ms/${permissionStop}`, ok: permissionStop === 'end_turn' },
    ],
    client,
    command: client.command,
    exitInfo: client.exitInfo,
    extra: { permissionRequest, permissionPrompt, elapsedMs: permissionElapsed, handlerDelayMs: permissionRequest === undefined ? undefined : permissionRequest.answeredAt - permissionRequest.at },
  })
  client.onIncomingRequest = undefined

  /* ---------- 007 session/cancel ---------- */
  const cancelStarted = Date.now()
  const slowPrompt = client.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'ACP-SLOW: 请慢慢说，直到我取消。' }],
  }, { id: 7, timeoutMs: 60_000 })
  // 假模型流长 ~5.25s；等到请求确实到达宿主机后再留 250ms，保证 cancel 落在 turn 运行中。
  const modelHit = await waitForModelRequest(model.logPath, 'ACP-SLOW', 30_000)
  await sleep(250)
  const cancelSentAt = Date.now()
  client.notify('session/cancel', { sessionId })
  let cancelResponse
  let cancelError
  try { cancelResponse = await slowPrompt } catch (error) { cancelError = error }
  const cancelElapsed = Date.now() - cancelStarted
  const cancelToResponse = Date.now() - cancelSentAt
  const cancelStop = cancelResponse?.result?.stopReason
  const modelAbort = modelAbortFor(model.logPath, 'ACP-SLOW')
  const afterInit = await client.request('initialize', { protocolVersion: 1 }, { id: 707, timeoutMs: 30_000 }).then(response => response.result?.protocolVersion === 1).catch(() => false)
  const afterSession = await client.request('session/new', { cwd: '/data', mcpServers: [] }, { id: 708, timeoutMs: 60_000 }).then(response => typeof response.result?.sessionId === 'string').catch(() => false)
  record({
    id: 'RC5-ACP-007',
    title: '取消 prompt：取消生效（stopReason=cancelled）且后续请求可用',
    status: cancelStop === 'cancelled' && modelAbort?.aborted === true && afterInit && afterSession ? STATUS.PASS : STATUS.FAIL,
    detail: `modelRequestArrived=${modelHit} modelAborted=${modelAbort?.aborted} stopReason=${cancelStop ?? '-'} cancel→resp=${cancelToResponse}ms total=${cancelElapsed}ms afterInitialize=${afterInit} afterSessionNew=${afterSession}${cancelError === undefined ? '' : ` err=${cancelError.message}`}`,
    assertions: [
      { name: '假模型收到 ACP-SLOW 请求', expected: 'true', observed: String(modelHit), ok: modelHit === true },
      { name: '取消打断上游流（aborted=true）', expected: 'true', observed: String(modelAbort?.aborted), ok: modelAbort?.aborted === true },
      { name: 'stopReason==cancelled', expected: 'cancelled', observed: String(cancelStop), ok: cancelStop === 'cancelled' },
      { name: '取消后响应 < 10s', expected: '<10000ms', observed: `${cancelToResponse}ms`, ok: cancelToResponse < 10_000 },
      { name: '取消后 initialize 可用', expected: 'true', observed: String(afterInit), ok: afterInit },
      { name: '取消后 session/new 可用', expected: 'true', observed: String(afterSession), ok: afterSession },
    ],
    client,
    command: client.command,
    exitInfo: client.exitInfo,
    extra: { cancelResponse, cancelError: cancelError === undefined ? undefined : cancelError.message, cancelToResponseMs: cancelToResponse, totalMs: cancelElapsed, modelHit, modelAbort },
  })

  /* ---------- 收尾：关 stdin，等退出 ---------- */
  const exitInfo = await client.close()
  for (const caseId of ['RC5-ACP-001', 'RC5-ACP-002', 'RC5-ACP-004', 'RC5-ACP-005', 'RC5-ACP-006', 'RC5-ACP-007', 'RC5-ACP-003']) {
    rewriteExit(caseId, exitInfo)
  }
  const stderr = client.stderr

  /* ---------- 003 stdout 纯净（全量帧） ---------- */
  const nonJsonRpc = client.rawLines.filter(raw => {
    try {
      const parsed = JSON.parse(raw)
      return parsed?.jsonrpc !== '2.0'
    } catch { return true }
  })
  const kinds = {}
  for (const entry of client.frames) {
    const kind = entry.frame?.method !== undefined
      ? `method:${entry.frame.method}`
      : (entry.frame?.error !== undefined ? 'response:error' : 'response:result')
    kinds[kind] = (kinds[kind] ?? 0) + 1
  }
  const extraFrames = Object.keys(kinds).filter(kind => ![
    'method:session/update', 'method:session/request_permission',
  ].includes(kind) && kind.startsWith('method:'))
  record({
    id: 'RC5-ACP-003',
    title: 'stdout 纯净：每行均为 JSON-RPC 2.0，无日志/横幅/进度',
    status: client.rawLines.length > 0 && nonJsonRpc.length === 0 && client.parseErrors.length === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `lines=${client.rawLines.length} nonJsonRpc=${nonJsonRpc.length} parseErrors=${client.parseErrors.length} kinds=${Object.entries(kinds).map(([key, value]) => `${key}×${value}`).join(' ')}`,
    assertions: [
      { name: 'stdout 行数 > 0', expected: '>0', observed: String(client.rawLines.length), ok: client.rawLines.length > 0 },
      { name: '非 JSON-RPC 行 == 0', expected: '0', observed: String(nonJsonRpc.length), ok: nonJsonRpc.length === 0 },
      { name: 'JSON 解析失败 == 0', expected: '0', observed: String(client.parseErrors.length), ok: client.parseErrors.length === 0 },
      { name: '首帧即 JSON-RPC（无启动横幅）', expected: 'jsonrpc=2.0', observed: String(client.frames[0]?.frame?.jsonrpc), ok: client.frames[0]?.frame?.jsonrpc === '2.0' },
    ],
    client,
    command: client.command,
    exitInfo,
    extra: { kinds, nonJsonRpc, stderrLines: stderr.split('\n').filter(Boolean).length, exitInfo, extraFrames },
  })

  /* ---------- 容器退出证据 ---------- */
  record({
    id: 'RC5-ACP-EXIT',
    priority: 'INFO',
    title: 'ACP 容器关闭 stdin 后正常退出（stderr 诊断面不计入纯净性）',
    status: exitInfo !== undefined && exitInfo.code === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `exit=${JSON.stringify(exitInfo)} stderrLines=${stderr.split('\n').filter(Boolean).length}`,
    assertions: [
      { name: 'exit.code==0', expected: '0', observed: String(exitInfo?.code), ok: exitInfo?.code === 0 },
    ],
    client,
    command: client.command,
    exitInfo,
    dir: join(HERE, 'runs', 'protocol', 'exit'),
  })

  await stopModelServer()
  return { runDir, exitInfo }
}

async function scenarioConcurrency() {
  const runDir = join(MODEL_LOG_BASE, 'concurrency')
  mkdirp(runDir)
  const model = await startModelServer(runDir)
  const clientA = new AcpClient({ label: 'ACP-A', envFile: ENV_FIXTURE, project: 'rc5-acp-conc-a', override: OVERRIDE, idBase: 1 })
  const clientB = new AcpClient({ label: 'ACP-B', envFile: ENV_FIXTURE_B, project: 'rc5-acp-conc-b', override: OVERRIDE, idBase: 1001 })
  const startAt = Date.now()
  clientA.start()
  clientB.start()

  const initA = await clientA.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, { id: 1, timeoutMs: 240_000 })
  const initB = await clientB.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, { id: 1001, timeoutMs: 240_000 })
  const [sessionA, sessionB] = await Promise.all([
    clientA.request('session/new', { cwd: '/data', mcpServers: [] }, { id: 2, timeoutMs: 180_000 }),
    clientB.request('session/new', { cwd: '/data', mcpServers: [] }, { id: 1002, timeoutMs: 180_000 }),
  ])
  const idA = sessionA.result?.sessionId
  const idB = sessionB.result?.sessionId
  const [promptA, promptB] = await Promise.all([
    clientA.request('session/prompt', { sessionId: idA, prompt: [{ type: 'text', text: '并发 A：只回复两个字：你好' }] }, { id: 3, timeoutMs: 120_000 }),
    clientB.request('session/prompt', { sessionId: idB, prompt: [{ type: 'text', text: '并发 B：只回复两个字：你好' }] }, { id: 1003, timeoutMs: 120_000 }),
  ])
  const exitA = await clientA.close()
  const exitB = await clientB.close()
  await stopModelServer()

  const mentions = client => client.frames.filter(entry => {
    const text = JSON.stringify(entry.frame)
    return (typeof idA === 'string' && text.includes(idA)) || (typeof idB === 'string' && text.includes(idB))
  })
  const crossA = clientA.frames.filter(entry => JSON.stringify(entry.frame).includes(idB))
  const crossB = clientB.frames.filter(entry => JSON.stringify(entry.frame).includes(idA))
  const ownA = clientA.frames.filter(entry => JSON.stringify(entry.frame).includes(idA)).length
  const ownB = clientB.frames.filter(entry => JSON.stringify(entry.frame).includes(idB)).length
  const lockedA = /database is locked/i.test(clientA.stderr)
  const lockedB = /database is locked/i.test(clientB.stderr)
  const renderA = clientA.stderr.split('\n').filter(line => line.includes('profile 渲染')).slice(-3).join(' | ')
  const renderB = clientB.stderr.split('\n').filter(line => line.includes('profile 渲染')).slice(-3).join(' | ')
  const ok = idA !== idB
    && initA.result?.protocolVersion === 1 && initB.result?.protocolVersion === 1
    && promptA.result?.stopReason === 'end_turn' && promptB.result?.stopReason === 'end_turn'
    && crossA.length === 0 && crossB.length === 0
    && !lockedA && !lockedB
    && exitA?.code === 0 && exitB?.code === 0

  record({
    id: 'RC5-ACP-008',
    priority: 'P1',
    title: '两客户端并发：各自 initialize + session/new + prompt；会话隔离无串话',
    status: ok ? STATUS.PASS : STATUS.FAIL,
    detail: `idA=${idA} idB=${idB} stopA=${promptA.result?.stopReason} stopB=${promptB.result?.stopReason} crossA=${crossA.length} crossB=${crossB.length} ownA=${ownA} ownB=${ownB} lockedA=${lockedA} lockedB=${lockedB} exitA=${JSON.stringify(exitA)} exitB=${JSON.stringify(exitB)} elapsed=${Date.now() - startAt}ms`,
    assertions: [
      { name: '两会话 id 不同', expected: 'idA!=idB', observed: `${idA} / ${idB}`, ok: idA !== idB },
      { name: 'A 收到自己的 session 帧', expected: '>0', observed: String(ownA), ok: ownA > 0 },
      { name: 'B 收到自己的 session 帧', expected: '>0', observed: String(ownB), ok: ownB > 0 },
      { name: 'A 无 B 的会话串话', expected: '0', observed: String(crossA.length), ok: crossA.length === 0 },
      { name: 'B 无 A 的会话串话', expected: '0', observed: String(crossB.length), ok: crossB.length === 0 },
      { name: '两端 prompt 均 end_turn', expected: 'end_turn/end_turn', observed: `${promptA.result?.stopReason}/${promptB.result?.stopReason}`, ok: promptA.result?.stopReason === 'end_turn' && promptB.result?.stopReason === 'end_turn' },
      { name: '无 database is locked', expected: 'false/false', observed: `${lockedA}/${lockedB}`, ok: !lockedA && !lockedB },
      { name: '两容器均 exit 0', expected: '0/0', observed: `${exitA?.code}/${exitB?.code}`, ok: exitA?.code === 0 && exitB?.code === 0 },
    ],
    client: clientA,
    command: `${clientA.command}\n\n${clientB.command}`,
    exitInfo: { A: exitA, B: exitB },
    extra: {
      idA, idB,
      initA: initA.result, initB: initB.result,
      promptA: promptA.result, promptB: promptB.result,
      crossA: crossA.map(entry => entry.frame), crossB: crossB.map(entry => entry.frame),
      stderrAFile: 'stderr-b.log', stderrBFile: 'stderr-b.log',
      renderA, renderB,
      modelLog: model.logPath,
      mergedFrames: { A: clientA.frames.length, B: clientB.frames.length, mentions: mentions(clientA).length },
    },
    dir: join(HERE, 'RC5-ACP-008'),
  })
  // B 的 stdout/stderr 另存（同一个 case 目录）
  const caseDir = join(HERE, 'RC5-ACP-008')
  writeFileSync(join(caseDir, 'stdout-b.ndjson'), `${clientB.rawLines.map(safe).join('\n')}\n`)
  writeFileSync(join(caseDir, 'stderr-b.log'), safe(clientB.stderr))
  writeFileSync(join(caseDir, 'cmd-b.log'), `${clientB.command}\nEXIT=${JSON.stringify(exitB)}\n`)
  return {}
}

const DOC_CHECKS = [
  {
    id: 'trusted-stdio',
    phrase: '受信 stdio 面',
    files: ['deploy/README.md', 'docker-compose.yml'],
    expectation: '文档明确 ACP 是受信 stdio 面/受信控制器，不是 Web 功能',
  },
  {
    id: 'trusted-operator-only',
    phrase: '只允许管理员/运维在本机启动',
    files: ['deploy/README.md', 'docker-compose.yml', 'docs/design/47-上游DSH-0.2.2-rc.5合并评估与开发方案.md'],
    expectation: '明确仅可信操作员/本机驱动，不暴露公网/端口',
  },
  {
    id: 'no-tenant-isolation',
    phrase: '无租户隔离',
    files: ['docs/design/49-上游rc.5合并总设计.md'],
    expectation: '明确 ACP 是无租户隔离的受信面，可读全部租户数据',
  },
  {
    id: 'shared-data-root',
    phrase: '共享同一 `/data` 实例根',
    files: ['deploy/README.md', 'docs/docker-deploy.md'],
    expectation: '明确与 web 共享 /data（跨租户数据可读）',
  },
]

function findLines(relPath, phrase) {
  const absolute = join(REPO, relPath)
  if (!existsSync(absolute)) return []
  const lines = readFileSync(absolute, 'utf8').split('\n')
  const hits = []
  lines.forEach((line, index) => {
    if (line.includes(phrase)) hits.push({ file: relPath, line: index + 1, text: line.trim() })
  })
  return hits
}

async function scenarioDocs() {
  const hits = []
  const assertions = []
  for (const check of DOC_CHECKS) {
    const found = check.files.flatMap(file => findLines(file, check.phrase))
    hits.push({ check: check.id, expectation: check.expectation, phrase: check.phrase, found })
    assertions.push({
      name: `${check.id}: 「${check.phrase}」`,
      expected: check.expectation,
      observed: found.length === 0 ? '未找到' : found.map(hit => `${hit.file}:${hit.line}`).join(', '),
      ok: found.length > 0,
    })
  }
  const allOk = assertions.every(row => row.ok === true)
  const detail = assertions.map(row => `${row.ok ? '✓' : '✗'} ${row.name}`).join('；')
  record({
    id: 'RC5-ACP-009',
    priority: 'P1',
    title: '文档定位：仅可信操作员、无租户隔离、共享 /data、不暴露公网',
    status: allOk ? STATUS.PASS : STATUS.FAIL,
    detail,
    assertions,
    extra: { hits },
  })
  // 引用原文另存，便于人工复核
  const lines = ['# RC5-ACP-009 文档引文（由驱动自动摘录）', '']
  for (const entry of hits) {
    lines.push(`## ${entry.check}`, '', `口径：${entry.expectation}`, '')
    if (entry.found.length === 0) lines.push('- 未找到')
    for (const hit of entry.found) lines.push(`- \`${hit.file}:${hit.line}\` — ${hit.text}`)
    lines.push('')
  }
  writeFileSync(join(HERE, 'RC5-ACP-009', 'citations.md'), `${lines.join('\n')}\n`)
  return {}
}

async function scenarioSharedVolume() {
  const runDir = join(MODEL_LOG_BASE, 'shared-volume')
  mkdirp(runDir)
  const accounts = loadAccounts('/Users/sunny/eterna-data/test-rc5/.test-accounts.json')
  const BASE = 'http://127.0.0.1:3108'
  const WEB_CONTAINER = 'eterna-rc5-e1'
  const webHealthBefore = inspectHealth(WEB_CONTAINER)
  const webPsBefore = dockerPsLine(WEB_CONTAINER)
  const webSince = new Date(Date.now() - 5 * 60_000).toISOString()

  // ---- web 一轮：真实登录 + session/create + session/list（写 SQLite）----
  let webRound
  try {
    const bootToken = bootTokenFromContainer(WEB_CONTAINER)
    const dshCookie = await bootstrapDshSession(BASE, bootToken)
    const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
    const cookie = `${dshCookie}; ${auth.cookie}`
    const created = await rpc(BASE, cookie, 'session/create', { request: {} }, { timeoutMs: 60_000 })
    const listed = await rpc(BASE, cookie, 'session/list', { request: {} }, { timeoutMs: 60_000 })
    webRound = {
      loginStatus: auth.status,
      createdOk: created.ok,
      sessionId: created.value?.sessionId ?? created.value?.request?.sessionId,
      listedOk: listed.ok,
      listSize: Array.isArray(listed.value?.sessions) ? listed.value.sessions.length : (Array.isArray(listed.value) ? listed.value.length : undefined),
    }
  } catch (error) {
    webRound = { error: safe(error instanceof Error ? error.message : String(error)) }
  }

  // ---- ACP 一轮（同卷 e1）----
  const model = await startModelServer(runDir)
  const client = new AcpClient({ label: 'ACP-E1', envFile: ENV_E1, project: 'rc5-acp-e1', override: OVERRIDE })
  client.start()
  let acpRound
  try {
    const init = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, { id: 1, timeoutMs: 240_000 })
    const session = await client.request('session/new', { cwd: '/data', mcpServers: [] }, { id: 2, timeoutMs: 180_000 })
    const sessionId = session.result?.sessionId
    const prompt = await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '共享卷：只回复两个字：你好' }] }, { id: 3, timeoutMs: 120_000 })
    acpRound = { protocolVersion: init.result?.protocolVersion, sessionId, stopReason: prompt.result?.stopReason }
  } catch (error) {
    acpRound = { error: safe(error instanceof Error ? error.message : String(error)) }
  }
  const acpExit = await client.close()
  await stopModelServer()

  // ---- 并发后复核：web 仍健康、无 database is locked ----
  const webHealthAfter = inspectHealth(WEB_CONTAINER)
  const webPsAfter = dockerPsLine(WEB_CONTAINER)
  const webLogs = logsSince(WEB_CONTAINER, webSince)
  const webLocked = /database is locked/i.test(webLogs)
  const acpLocked = /database is locked/i.test(client.stderr)
  const acpRender = client.stderr.split('\n').filter(line => line.includes('profile 渲染')).slice(-4)

  const ok = webRound?.createdOk === true && webRound?.listedOk === true
    && acpRound?.stopReason === 'end_turn'
    && webHealthAfter === 'healthy'
    && !webLocked && !acpLocked
    && acpExit?.code === 0

  record({
    id: 'RC5-ACP-010',
    priority: 'P1',
    title: 'web 与 ACP 同时启动同卷各跑一轮：两端可用；SQLite 无 database is locked；无 profile 渲染竞争',
    status: ok ? STATUS.PASS : STATUS.FAIL,
    detail: `web=${JSON.stringify(webRound)} acp=${JSON.stringify(acpRound)} webHealth=${webHealthBefore}→${webHealthAfter} locked(web/acp)=${webLocked}/${acpLocked} acpExit=${JSON.stringify(acpExit)}`,
    assertions: [
      { name: 'web 登录 200', expected: '200', observed: String(webRound?.loginStatus ?? 'n/a'), ok: webRound?.loginStatus === 200 },
      { name: 'web session/create ok', expected: 'true', observed: String(webRound?.createdOk), ok: webRound?.createdOk === true },
      { name: 'web session/list ok', expected: 'true', observed: String(webRound?.listedOk), ok: webRound?.listedOk === true },
      { name: 'ACP prompt end_turn', expected: 'end_turn', observed: String(acpRound?.stopReason), ok: acpRound?.stopReason === 'end_turn' },
      { name: 'web 容器仍 healthy', expected: 'healthy', observed: webHealthAfter, ok: webHealthAfter === 'healthy' },
      { name: 'web 日志无 database is locked', expected: 'false', observed: String(webLocked), ok: !webLocked },
      { name: 'ACP stderr 无 database is locked', expected: 'false', observed: String(acpLocked), ok: !acpLocked },
      { name: 'ACP 容器 exit 0', expected: '0', observed: String(acpExit?.code), ok: acpExit?.code === 0 },
      { name: 'ACP profile 渲染有日志（flock 路径）', expected: '>0 行', observed: String(acpRender.length), ok: acpRender.length > 0 },
    ],
    client,
    command: `${client.command}\n# web 轮：HTTP 3108 login + session/create + session/list`,
    exitInfo: acpExit,
    extra: {
      webHealthBefore, webHealthAfter, webPsBefore, webPsAfter,
      webRound, acpRound,
      webLocked, acpLocked, acpRender,
      webLogLines: webLogs.split('\n').filter(line => /database is locked|SQLITE_BUSY/i.test(line)).map(safe),
      modelLog: model.logPath,
    },
  })
  return {}
}

/* --------------------------------------------------------------- 主流程 */

async function main() {
  const runStartedAt = new Date().toISOString()
  const scenarios = SCENARIO === 'all' ? ['protocol', 'concurrency', 'docs', 'shared-volume'] : [SCENARIO]
  for (const scenario of scenarios) {
    console.log(`\n=== scenario: ${scenario} ===`)
    if (scenario === 'protocol') await scenarioProtocol()
    else if (scenario === 'concurrency') await scenarioConcurrency()
    else if (scenario === 'docs') await scenarioDocs()
    else if (scenario === 'shared-volume') await scenarioSharedVolume()
    else throw new Error(`unknown scenario: ${scenario}`)
  }

  const counts = { PASS: 0, FAIL: 0, SKIP: 0, NOTRUN: 0 }
  for (const row of results) counts[row.status] = (counts[row.status] ?? 0) + 1
  const summary = {
    suite: 'ACP',
    scenario: SCENARIO,
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    repo: REPO,
    counts,
    cases: results,
  }
  if (SCENARIO === 'all' || SCENARIO === 'protocol') writeJson(join(HERE, 'report.json'), summary)
  console.log(`\n[ACP] PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP} NOTRUN=${counts.NOTRUN}`)
  process.exit(counts.FAIL === 0 ? 0 : 1)
}

main().catch(async error => {
  console.error(`[ACP] 驱动异常: ${safe(error instanceof Error ? error.stack ?? error.message : String(error))}`)
  await stopModelServer()
  process.exit(1)
})