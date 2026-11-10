// 中继服务（E1-T2）：HTTP（/json/version、/json/list、/api/tools、/api/status、/fixture）+ WS 双腿（/extension、/cdp）。
// 开发模式默认仅绑定 127.0.0.1；RELAY_TOKEN 设置后双腿均要求 ?token= 匹配（E4-T1 起换 eterna-access 会话令牌）。

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { PROTO_VERSION, type ExtToRelay, type RelayToExt } from './protocol.ts'
import { RelayCore, type ExtLink } from './relay-core.ts'
import { BrowserTools } from './tools.ts'

const FIXTURE_FORM = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>E1 Fixture 工作台</title></head>
<body>
<h1>E1 Fixture 工作台</h1>
<p>这是一个用于 E1 门禁冒烟的本地受控页面。</p>
<label for="kw">搜索关键词</label>
<input id="kw" name="kw" placeholder="输入关键词" />
<button id="go" type="button">提交</button>
<ul><li><a href="/fixture/result?text=直接访问">直接访问结果页</a></li></ul>
<script>
  document.getElementById("go").addEventListener("click", function () {
    var v = document.getElementById("kw").value || "空"
    location.href = "/fixture/result?text=" + encodeURIComponent(v)
  })
</script>
</body></html>`

function fixtureResult(query: string): string {
  const text = new URLSearchParams(query).get('text') ?? ''
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>E1 Result 页</title></head>
<body>
<h1>E1 Result 页</h1>
<p id="out">关键词：${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>
</body></html>`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(data)
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function rawText(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return ''
}

export interface RelayServerOptions {
  port: number
  token?: string
  log?: (line: string) => void
}

export class RelayServer {
  readonly core = new RelayCore()
  private tools: BrowserTools | null = null
  private wss: WebSocketServer | null = null
  private extSocket: WebSocket | null = null
  private cdpSocket: WebSocket | null = null
  private httpServer = createServer((req, res) => {
    this.handleHttp(req, res)
  })
  private readonly log: (line: string) => void

  constructor(private readonly opts: RelayServerOptions) {
    this.log = opts.log ?? ((line) => {
      // 服务端日志走 stderr（stdout 可能被管道消费方忽略）
      console.error(`[relay] ${line}`)
    })
    this.core.onEventLog = this.log
    this.tools = new BrowserTools(this.core)
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ noServer: true })
    this.httpServer.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })
    await new Promise<void>(resolve => this.httpServer.listen(this.opts.port, '127.0.0.1', resolve))
    this.log(`relay 监听 http://127.0.0.1:${String(this.opts.port)}（/extension /cdp /api/tools /fixture）`)
  }

  async stop(): Promise<void> {
    this.extSocket?.close()
    this.cdpSocket?.close()
    this.wss?.close()
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => {
        resolve()
      })
    })
  }

  private tokenOk(url: string): boolean {
    if (this.opts.token === undefined || this.opts.token === '') return true
    const q = new URL(url, 'http://x').searchParams.get('token')
    return q === this.opts.token
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = req.url ?? ''
    if (!this.tokenOk(url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.startsWith('/extension')) {
      if (this.extSocket !== null) {
        socket.write('HTTP/1.1 409 Conflict\r\n\r\n')
        socket.destroy()
        return
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.extSocket = ws
        ws.on('message', (data) => {
          this.onExtMessage(rawText(data))
        })
        ws.on('close', () => {
          if (this.extSocket === ws) {
            this.extSocket = null
            this.core.setExt(null)
            this.log('扩展断开')
          }
        })
        this.log('扩展已连接')
      })
      return
    }
    if (url.startsWith('/cdp')) {
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        if (this.cdpSocket !== null) this.cdpSocket.close(4001, 'replaced')
        this.cdpSocket = ws
        ws.on('message', (data) => {
          try {
            void this.core.handleClientMessage(JSON.parse(rawText(data)) as unknown)
          } catch {
            this.log('CDP 非法帧已忽略')
          }
        })
        ws.on('close', () => {
          if (this.cdpSocket === ws) {
            this.cdpSocket = null
            this.core.setCdp(null)
            this.log('CDP 客户端断开')
          }
        })
        this.core.setCdp({
          send: (msg) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
          },
        })
        this.log('CDP 客户端已连接（playwright-core）')
      })
      return
    }
    socket.destroy()
  }

  private onExtMessage(text: string): void {
    let frame: ExtToRelay
    try {
      frame = JSON.parse(text) as ExtToRelay
    } catch {
      this.log('扩展非法帧已忽略')
      return
    }
    if (frame.t === 'hello') {
      const link: ExtLink = {
        send: (f: RelayToExt) => {
          if (this.extSocket !== null && this.extSocket.readyState === WebSocket.OPEN) this.extSocket.send(JSON.stringify(f))
        },
        extVersion: frame.extVersion,
        chromeVersion: frame.chromeVersion,
      }
      this.core
        .onExtHello(link, frame)
        .catch((err: unknown) => {
          this.log(`握手被拒：${err instanceof Error ? err.message : String(err)}`)
          this.extSocket?.close(4002, 'proto-mismatch')
          this.extSocket = null
        })
      return
    }
    if (frame.t === 'event') this.log(`EXT event ← ${frame.method} tab=${String(frame.tabId)}`)
    this.core.onExtFrame(frame).catch((err: unknown) => {
      this.log(`扩展帧处理异常：${err instanceof Error ? err.message : String(err)}`)
    })
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // playwright-core connectOverCDP 请求 /json/version/（带尾斜杠），归一化后再匹配
    const rawUrl = req.url ?? '/'
    const qIndex = rawUrl.indexOf('?')
    const url = (qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl).replace(/\/+$/, '') + (qIndex >= 0 ? rawUrl.slice(qIndex) : '')
    if (url === '/healthz') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (url === '/json/version') {
      sendJson(res, 200, {
        Browser: 'EternaCompanionRelay/0.1',
        protocolVersion: '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${String(this.opts.port)}/cdp${this.opts.token !== undefined && this.opts.token !== '' ? `?token=${encodeURIComponent(this.opts.token)}` : ''}`,
      })
      return
    }
    if (url === '/json/list') {
      sendJson(res, 200, this.core.listForHttp())
      return
    }
    if (url === '/api/status') {
      const ext = this.core.extension
      sendJson(res, 200, {
        extensionConnected: this.core.extensionConnected,
        extVersion: ext?.extVersion ?? null,
        chromeVersion: ext?.chromeVersion ?? null,
        tabCount: this.core.tabCount,
        cdpConnected: this.cdpSocket !== null,
        proto: PROTO_VERSION,
      })
      return
    }
    if (url === '/api/tools' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        let parsed: { name?: string; args?: Record<string, unknown> }
        try {
          parsed = JSON.parse(body) as { name?: string; args?: Record<string, unknown> }
        } catch {
          sendJson(res, 400, { ok: false, error: { code: 'BAD_JSON', message: '请求体不是合法 JSON' } })
          return
        }
        if (typeof parsed.name !== 'string') {
          sendJson(res, 400, { ok: false, error: { code: 'BAD_ARGS', message: '缺少 name 字段' } })
          return
        }
        if (this.tools === null) {
          sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: '工具层未初始化' } })
          return
        }
        this.tools
          .execute(parsed.name, parsed.args ?? {})
          .then((result) => {
            sendJson(res, 200, result)
          })
          .catch((err: unknown) => {
            sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } })
          })
      })
      return
    }
    if (url === '/fixture' || url === '/fixture/') {
      sendHtml(res, FIXTURE_FORM)
      return
    }
    if (url.startsWith('/fixture/result')) {
      sendHtml(res, fixtureResult(url.split('?')[1] ?? ''))
      return
    }
    if (url === '/') {
      sendHtml(res, "<!doctype html><meta charset='utf-8'><title>Eterna Relay</title><p>Eterna browser relay 运行中。可用端点：/healthz /api/status /api/tools /fixture /json/version</p>")
      return
    }
    res.writeHead(404, { 'cache-control': 'no-store' })
    res.end('not found')
  }
}
