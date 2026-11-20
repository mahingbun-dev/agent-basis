#!/usr/bin/env node
/**
 * ACP stdio 协议验证（51 §3.9 / §4；54 §6.3；T47）。
 *
 * 覆盖：
 *   ACP-001   initialize → 合法 JSON-RPC 响应，协议版本协商成功（protocolVersion=1）
 *   ACP-002   session/new（必需）+ session/prompt（需真实模型凭据；无凭据记 NOTRUN）
 *   ACP-003   抓 stdout 全文：每行都是 JSON-RPC（无日志/横幅/进度）
 *   ACP-004   无监听端口（读容器 /proc/net/tcp{,6}，state=0A 即 LISTEN）
 *   ACP-005   非法 JSON → JSON-RPC error，进程不崩（随后 initialize 仍可用）
 *
 * 容器：`docker compose --profile acp run --rm -T --no-deps eterna-agent-acp`
 * （无端口；stdout 是协议专用通道，entrypoint 日志全走 stderr）。
 *
 * 用法：
 *   node scripts/verify-acp-stdio.mjs \
 *     --env-file $HOME/eterna-data/test-rc5/.env.e4 \
 *     --project rc5-test-e4 \
 *     --json artifacts/rc5/p5/testbed/acp-stdio/report.json
 *   --with-prompt   发送 session/prompt（默认也发，但无真实 MIMO key 时结果必为 NOTRUN）
 *   --timeout-ms 180000
 *
 * 只读：不写数据根（ACP-002 的 session/new 会在测试数据根落会话元数据，属测试环境）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Report, STATUS, parseArgs, redact, shape } from './rc5-test-client.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2), {
  project: 'rc5-test-e4',
  envFile: resolve(process.env.HOME ?? '/tmp', 'eterna-data/test-rc5/.env.e4'),
  'timeout-ms': '180000',
  prompt: true,
})
const PROJECT = String(args.project)
const ENV_FILE = String(args.envFile)
const TIMEOUT_MS = Number.parseInt(String(args['timeout-ms']), 10)
const OUT = args.json === undefined ? undefined : String(args.json)

const report = new Report({ suite: 'ACP', env: { project: PROJECT, envFile: ENV_FILE, timeoutMs: TIMEOUT_MS }, out: OUT })

if (!existsSync(ENV_FILE)) {
  report.add('SETUP-ENV', 'P0', STATUS.FAIL, 'E4 env 文件存在', `${ENV_FILE} 不存在（先跑 scripts/prepare-rc5-envs.sh e4）`)
  process.exit(report.finish())
}

/* ------------------------------------------------------------ 子进程面 */

const composeArgs = [
  'compose',
  '-p', PROJECT,
  '--env-file', ENV_FILE,
  '-f', join(repoRoot, 'docker-compose.yml'),
  '--profile', 'acp',
  'run', '--rm', '-T', '--no-deps', 'eterna-agent-acp',
]

const child = spawn('docker', composeArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
let stdoutBuffer = ''
const stdoutLines = []
const stderrChunks = []
let exitInfo = undefined
child.on('exit', (code, signal) => { exitInfo = { code, signal } })
child.stderr.on('data', chunk => stderrChunks.push(chunk))
child.stdout.on('data', chunk => {
  stdoutBuffer += chunk.toString('utf8')
  let index = stdoutBuffer.indexOf('\n')
  while (index !== -1) {
    const line = stdoutBuffer.slice(0, index)
    stdoutBuffer = stdoutBuffer.slice(index + 1)
    if (line.trim() !== '') stdoutLines.push(line)
    index = stdoutBuffer.indexOf('\n')
  }
})

/** 等 stdout 出现满足条件的 JSON-RPC 帧（id 匹配）。 */
function waitForFrame(id, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const frame = stdoutLines.map(line => {
        try { return JSON.parse(line) } catch { return undefined }
      }).find(item => item !== undefined && (id === undefined || item.id === id))
      if (frame !== undefined) {
        clearInterval(timer)
        resolvePromise(frame)
        return
      }
      if (exitInfo !== undefined) {
        clearInterval(timer)
        reject(new Error(`ACP 进程已退出（code=${exitInfo.code}）而未响应 id=${String(id)}；stderr=${redact(stderrChunks.join('')).slice(-300)}`))
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`等 id=${String(id)} 超时（${timeoutMs}ms）；stdout 行数=${stdoutLines.length}`))
      }
    }, 50)
  })
}

function send(frame) {
  child.stdin.write((typeof frame === 'string' ? frame : JSON.stringify(frame)) + '\n')
}

function findRunContainer() {
  const result = spawnSync('docker', [
    'ps', '-q',
    '--filter', `label=com.docker.compose.project=${PROJECT}`,
    '--filter', 'label=com.docker.compose.service=eterna-agent-acp',
  ], { encoding: 'utf8', timeout: 20_000 })
  const ids = (result.stdout ?? '').trim().split('\n').filter(Boolean)
  return ids[0]
}

/* --------------------------------------------------------------- 用例 */

let initialized = false
let sessionId

await report.run('RC5-ACP-001', 'P0', 'initialize：合法 JSON-RPC 响应 + 协议版本协商', async () => {
  const id = 1
  send({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })
  const frame = await waitForFrame(id)
  const result = frame.result
  initialized = frame.jsonrpc === '2.0' && result?.protocolVersion === 1
  return {
    status: initialized ? STATUS.PASS : STATUS.FAIL,
    detail: `protocolVersion=${result?.protocolVersion} agent=${result?.agentInfo?.name ?? '?'} version=${result?.agentInfo?.version ?? '?'} mcpHttp=${result?.agentCapabilities?.mcpCapabilities?.http}`,
  }
})

if (!initialized) {
  for (const [id, priority, title] of [
    ['RC5-ACP-002', 'P0', 'session/new + session/prompt'],
    ['RC5-ACP-003', 'P0', 'stdout 纯净（每行 JSON-RPC）'],
    ['RC5-ACP-004', 'P0', '无监听端口'],
    ['RC5-ACP-005', 'P0', '非法 JSON → error 且进程不崩'],
  ]) report.add(id, priority, STATUS.NOTRUN, title, 'initialize 未成功，后续无法执行')
} else {
  /* session/new */
  await report.run('RC5-ACP-002a', 'P0', 'session/new 返回 sessionId', async () => {
    const id = 2
    send({ jsonrpc: '2.0', id, method: 'session/new', params: { cwd: '/data', mcpServers: [] } })
    const frame = await waitForFrame(id, 120_000)
    sessionId = frame.result?.sessionId
    return {
      status: typeof sessionId === 'string' ? STATUS.PASS : STATUS.FAIL,
      detail: typeof sessionId === 'string' ? `sessionId=${sessionId}` : shape(frame.error),
    }
  })

  /* session/prompt：无真实凭据时只能记 NOTRUN（不冒充） */
  if (args.prompt !== false && args.prompt !== 'false') {
    await report.run('RC5-ACP-002b', 'P0', 'session/prompt 正常返回（需真实模型凭据）', async () => {
      if (typeof sessionId !== 'string') return { status: STATUS.NOTRUN, detail: '无 sessionId' }
      const id = 3
      send({
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: '只回复两个字：你好' }] },
      })
      try {
        const frame = await waitForFrame(id, 120_000)
        if (frame.error !== undefined) {
          return { status: STATUS.NOTRUN, detail: `模型/凭据层错误（E4 用测试占位 key）：${shape(frame.error).slice(0, 160)}` }
        }
        return { status: STATUS.PASS, detail: `stopReason=${frame.result?.stopReason ?? '?'}` }
      } catch (error) {
        return { status: STATUS.FAIL, detail: `prompt 无响应：${error instanceof Error ? error.message : String(error)}` }
      }
    })
  } else {
    report.add('RC5-ACP-002b', 'P0', STATUS.NOTRUN, 'session/prompt', '--no-prompt 跳过')
  }

  /* ACP-004 端口（在进程存活时读 /proc/net/tcp） */
  await report.run('RC5-ACP-004', 'P0', 'ACP 容器无监听端口', async () => {
    const container = findRunContainer()
    if (container === undefined || container === '') return { status: STATUS.NOTRUN, detail: '找不到 run 容器（可能已退出）' }
    const result = spawnSync('docker', ['exec', container, 'sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'], { encoding: 'utf8', timeout: 20_000 })
    if (result.status !== 0) return { status: STATUS.NOTRUN, detail: `读取 /proc/net/tcp 失败: ${(result.stderr ?? '').slice(0, 120)}` }
    // 逐行解析：local_address 的 IP 是 4 字节小端 hex，port 是 2 字节小端 hex。
    const decodeV4 = hex => {
      const bytes = []
      for (let i = 6; i >= 0; i -= 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16))
      return bytes.join('.')
    }
    const decodePort = hex => Number.parseInt(hex.slice(2, 4) + hex.slice(0, 2), 16)
    const listeners = []
    for (const line of (result.stdout ?? '').split('\n')) {
      const columns = line.trim().split(/\s+/)
      if (columns.length < 10 || columns[3] !== '0A') continue
      const [addressHex, portHex] = columns[1].split(':')
      const address = addressHex.length === 8 ? decodeV4(addressHex) : addressHex
      listeners.push({ address, port: decodePort(portHex), inode: columns[9] })
    }
    // 区分「应用监听」与「Docker 内嵌 DNS（127.0.0.11:53，容器外代理）」：
    // 用 socket inode 反查本容器进程 fd；无进程拥有的监听一律判基础设施。
    const fdList = spawnSync('docker', ['exec', container, 'sh', '-c', 'ls -l /proc/[0-9]*/fd 2>/dev/null'], { encoding: 'utf8', timeout: 20_000 })
    const ownedInodes = new Set([...(fdList.stdout ?? '').matchAll(/socket:\[(\d+)\]/g)].map(match => match[1]))
    const appListeners = listeners.filter(item => ownedInodes.has(item.inode))
    const infra = listeners.filter(item => !ownedInodes.has(item.inode))
    return {
      status: appListeners.length === 0 ? STATUS.PASS : STATUS.FAIL,
      detail: appListeners.length === 0
        ? `无应用监听（基础设施监听 ${infra.length} 个：${infra.map(item => `${item.address}:${item.port}`).join(',') || '无'}）`
        : `发现 ${appListeners.length} 个应用 LISTEN: ${appListeners.map(item => `${item.address}:${item.port}`).join(',')}；基础设施 ${infra.length} 个`,
    }
  })

  /* ACP-005 非法 JSON */
  await report.run('RC5-ACP-005', 'P0', '非法 JSON → JSON-RPC error 且进程不崩', async () => {
    const before = stdoutLines.length
    send('{"jsonrpc":"2.0","id":99,"method":')
    // 无 id 可等：轮询 stdout 出现 error 帧
    let frame
    for (let attempt = 0; attempt < 200; attempt++) {
      frame = stdoutLines.slice(before).map(line => {
        try { return JSON.parse(line) } catch { return undefined }
      }).find(item => item !== undefined && item.error !== undefined)
      if (frame !== undefined) break
      if (exitInfo !== undefined) break
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    }
    const errorCode = frame?.error?.code
    // 进程仍可用：再 initialize 一次
    const id = 100
    send({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: 1 } })
    let alive = false
    try {
      await waitForFrame(id, 20_000)
      alive = true
    } catch {
      alive = false
    }
    return {
      status: errorCode === -32700 && alive ? STATUS.PASS : STATUS.FAIL,
      detail: `error.code=${errorCode ?? '-'} aliveAfter=${alive}`,
    }
  })
}

/* 收尾：关 stdin，让 ACP 正常退出；随后校验 stdout 纯净。 */
child.stdin.end()
await new Promise(resolvePromise => {
  const timer = setTimeout(() => { try { child.kill('SIGTERM') } catch {} ; resolvePromise(undefined) }, 15_000)
  child.on('exit', () => { clearTimeout(timer); resolvePromise(undefined) })
})

await report.run('RC5-ACP-003', 'P0', 'stdout 纯净：每行均为 JSON-RPC，无日志/横幅', async () => {
  const offenders = []
  for (const line of stdoutLines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed?.jsonrpc !== '2.0') offenders.push(line)
    } catch {
      offenders.push(line)
    }
  }
  return {
    status: stdoutLines.length > 0 && offenders.length === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `lines=${stdoutLines.length} nonJsonRpc=${offenders.length}${offenders.length > 0 ? ` first=${redact(offenders[0]).slice(0, 120)}` : ''}`,
  }
})

/* stderr 是诊断面，不作为失败判据；只记行数供排障。 */
report.add('ACP-STDERR', 'INFO', STATUS.PASS, 'stderr 诊断面（不计入纯净性）', `lines=${stderrChunks.join('').split('\n').filter(Boolean).length} exit=${JSON.stringify(exitInfo)}`)

process.exit(report.finish())