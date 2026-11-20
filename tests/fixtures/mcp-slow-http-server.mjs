#!/usr/bin/env node
/**
 * 慢工具 HTTP MCP 夹具（RC5-MCPP-017：个人层工具调用 60s 超时）。
 *
 * 与 mcp-http-server.mjs 同构，只多一个 `slow` 工具：
 *   tools/call slow {delayMs} → 等 delayMs（默认 90000，封顶 120000）后回文本。
 * 产品侧 toolCallTimeoutMs=60s 必须先到点并返回超时错误，而不是等到夹具响应。
 *
 * 监听地址默认 127.0.0.1；容器访问需 `--host 0.0.0.0`（E2 lane 经
 * host.docker.internal 连宿主）。只监听、不联网、不写盘。
 *
 * 用法：node tests/fixtures/mcp-slow-http-server.mjs --port 8767 --host 0.0.0.0
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SERVER_INFO, DEFAULT_PROTOCOL, TOOL, handleMessage, toFrame } from './mcp-fixture-core.mjs'

function argOf(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value === '' ? fallback : value
}

const PORT = Number.parseInt(argOf('--port', '8767'), 10)
const HOST = argOf('--host', '127.0.0.1')
const PATH = argOf('--path', '/mcp')
const TAG = argOf('--tag', 'slow-http-fixture')
const DEFAULT_DELAY_MS = 90_000
const MAX_DELAY_MS = 120_000

const SLOW_TOOL = {
  name: 'slow',
  description: '等待指定毫秒后返回（测试夹具，用于验证工具调用超时）',
  inputSchema: {
    type: 'object',
    properties: { delayMs: { type: 'number', description: '等待毫秒数，默认 90000，封顶 120000' } },
    additionalProperties: false,
  },
}

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  process.stderr.write(`[mcp-slow] 非法端口: ${argOf('--port', '')}\n`)
  process.exit(2)
}

const sessions = new Set()

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(payload)
}

function slowOutcome(message) {
  const requested = Number(message.params?.arguments?.delayMs)
  const delay = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_DELAY_MS, requested) : DEFAULT_DELAY_MS
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        result: {
          content: [{ type: 'text', text: `slow:${delay}` }],
          structuredContent: { waitedMs: delay, tag: TAG },
          isError: false,
        },
      })
    }, delay)
    timer.unref()
    message.__slowTimer = timer
  })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  if (url.pathname === '/health') {
    send(res, 200, { ok: true, tag: TAG })
    return
  }
  if (url.pathname !== PATH) {
    send(res, 404, { error: 'not found' })
    return
  }
  if (req.method === 'GET') {
    send(res, 405, { error: 'SSE not supported by fixture' }, { allow: 'POST, DELETE' })
    return
  }
  if (req.method === 'DELETE') {
    const sid = req.headers['mcp-session-id']
    if (typeof sid === 'string') sessions.delete(sid)
    send(res, 200, { ok: true })
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'method not allowed' }, { allow: 'POST, DELETE' })
    return
  }

  const chunks = []
  let tooLarge = false
  req.on('data', (chunk) => {
    chunks.push(chunk)
    if (chunks.reduce((n, buf) => n + buf.length, 0) > 4 * 1024 * 1024) {
      tooLarge = true
      req.destroy()
    }
  })
  req.on('end', async () => {
    if (tooLarge) return
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const headers = {}
    if (parsed?.method === 'initialize') {
      const sid = randomUUID()
      sessions.add(sid)
      headers['mcp-session-id'] = sid
    }
    if (parsed?.method === 'tools/list') {
      send(res, 200, {
        jsonrpc: '2.0', id: parsed.id,
        result: {
          tools: [TOOL, SLOW_TOOL],
          serverInfo: SERVER_INFO,
          protocolVersion: DEFAULT_PROTOCOL,
        },
      }, headers)
      return
    }
    if (parsed?.method === 'tools/call' && parsed?.params?.name === SLOW_TOOL.name) {
      const outcome = await slowOutcome(parsed)
      if (res.destroyed || res.writableEnded) return
      send(res, 200, JSON.parse(toFrame(parsed, outcome)), headers)
      return
    }
    const frame = toFrame(parsed, handleMessage(parsed, { tag: TAG }))
    if (frame === undefined) {
      res.writeHead(202, { 'cache-control': 'no-store', ...headers })
      res.end()
      return
    }
    send(res, 200, JSON.parse(frame), headers)
  })
  req.on('error', () => {
    // 客户端断开：无需响应
  })
})

server.listen(PORT, HOST, () => {
  process.stderr.write(`[mcp-slow] listening ${HOST}:${PORT} path=${PATH} tag=${TAG}\n`)
})