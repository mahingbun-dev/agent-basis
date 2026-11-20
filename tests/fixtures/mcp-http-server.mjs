#!/usr/bin/env node
/**
 * 本地 HTTP MCP 夹具（51 §1「MCP HTTP 服务：本地 127.0.0.1:<port>/mcp」；T47）。
 *
 * 用途：
 *   - MCPP-007：个人层 HTTP server（`http://127.0.0.1:<port>/mcp`）允许并 probe 成功；
 *   - MCPP-008/009 的对照目标（元数据地址仍应被拒，本夹具不参与）；
 *   - `verify-mcp-personal.mjs --http-port`。
 *
 * 传输：MCP Streamable HTTP 的最小实现——POST /mcp 收一条 JSON-RPC，回
 * application/json 单帧；initialize 时回 `mcp-session-id`；GET /mcp 不支持 SSE
 * （405），DELETE /mcp 结束会话（200）。够 dsh-mcp-client probe/tools/list 使用。
 *
 * 只监听 127.0.0.1（默认），不联网、不写盘、不打印环境变量。
 *
 * 用法：
 *   node tests/fixtures/mcp-http-server.mjs --port 8765
 *   node tests/fixtures/mcp-http-server.mjs --port 8765 --host 127.0.0.1 --path /mcp
 *   （端口 0 = 由内核分配，启动时把实际端口打到 stderr：`[mcp-http] listening :<port>`）
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { handleMessage, toFrame } from './mcp-fixture-core.mjs'

function argOf(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value === '' ? fallback : value
}

const PORT = Number.parseInt(argOf('--port', '8765'), 10)
const HOST = argOf('--host', '127.0.0.1')
const PATH = argOf('--path', '/mcp')
const TAG = argOf('--tag', 'http-fixture')

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  process.stderr.write(`[mcp-http] 非法端口: ${argOf('--port', '')}\n`)
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
    // 本夹具不做 server-initiated SSE；客户端按 JSON 单帧即可。
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
  req.on('data', chunk => {
    chunks.push(chunk)
    if (chunks.reduce((n, buf) => n + buf.length, 0) > 4 * 1024 * 1024) {
      tooLarge = true
      req.destroy()
    }
  })
  req.on('end', () => {
    if (tooLarge) return
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      // 非法 JSON 按 JSON-RPC parse error 回（ACP-005 的 HTTP 侧对照）。
      send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const headers = {}
    if (parsed?.method === 'initialize') {
      const sid = randomUUID()
      sessions.add(sid)
      headers['mcp-session-id'] = sid
    }
    const frame = toFrame(parsed, handleMessage(parsed, { tag: TAG }))
    if (frame === undefined) {
      // 通知：MCP Streamable HTTP 规定回 202 无内容。
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
  const address = server.address()
  const actual = typeof address === 'object' && address !== null ? address.port : PORT
  process.stderr.write(`[mcp-http] listening :${actual} host=${HOST} path=${PATH} tag=${TAG}\n`)
})
server.on('error', error => {
  process.stderr.write(`[mcp-http] FATAL ${error.message}\n`)
  process.exit(1)
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))