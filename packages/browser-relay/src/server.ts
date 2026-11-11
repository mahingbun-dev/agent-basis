// 中继服务（E1-T2）：HTTP（/json/version、/json/list、/api/tools、/api/status、/fixture）+ WS 双腿（/extension、/cdp）。
// 开发模式默认仅绑定 127.0.0.1；RELAY_TOKEN 设置后双腿均要求 ?token= 匹配（E4-T1 起换 eterna-access 会话令牌）。

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync as fsExistsSync, readFileSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { PROTO_VERSION, type ExtToRelay, type RelayToExt } from './protocol.ts'
import { RelayCore, type ExtLink } from './relay-core.ts'
import { BrowserTools } from './tools.ts'

const existsSyncFn = fsExistsSync

/** 公网指引页地址：publicWsUrl（wss://host/prefix/extension）→ https://host/prefix/companion/guide；缺省本机端口 */
function guideUrlOf(opts: Pick<RelayServerOptions, 'port' | 'publicWsUrl'>): string {
  const fallback = `http://127.0.0.1:${String(opts.port)}/companion/guide`
  const ws = opts.publicWsUrl
  if (ws === undefined || ws === '') return fallback
  const m = /^(wss|ws):\/\/([^/?#]+)(\/.*)?$/.exec(ws)
  if (m === null) return fallback
  const scheme = m[1] === 'wss' ? 'https' : 'http'
  const prefix = (m[3] ?? '').replace(/\/extension\/?$/, '')
  return `${scheme}://${m[2]}${prefix}/companion/guide`
}

/** /companion/guide：三态自检 + 安装步骤 + 下载（同源取 /api/status，无跨域） */
function companionGuideHtml(displayWsUrl: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Eterna 浏览器执行面 · 安装指引</title>
<style>
:root{color-scheme:light dark;--bg:#ffffff;--surface:#ffffff;--surface-2:#f7f7f7;--fg:#080808;--fg-2:#363636;--muted:#5a5a5a;--border:#d8d8d8;--border-soft:#e8e8e8;--accent:#146ef5;--accent-fill:#146ef5;--accent-on:#ffffff;--success:#067a1c;--warn:#8a5a00;--danger:#d3122b;--focus:0 0 0 3px color-mix(in oklab,var(--accent),transparent 70%);font-family:system-ui,-apple-system,"PingFang SC",sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#080808;--surface:#101010;--surface-2:#161616;--fg:#f5f5f5;--fg-2:#d4d4d4;--muted:#a3a3a3;--border:#2a2a2a;--border-soft:#222222;--accent:#3b89ff;--accent-fill:#2a6fd0;--success:#35e35f;--warn:#ffb020;--danger:#ff5c68}}
*{box-sizing:border-box}
body{max-width:720px;margin:48px auto;padding:0 20px;background:var(--bg);color:var(--fg);font-size:16px;line-height:1.7}
h1{font-size:32px;line-height:1.15;font-weight:600;margin:0 0 8px;letter-spacing:0}
h3{font-size:20px;line-height:1.3;font-weight:600;margin:28px 0 8px}
a{color:var(--accent);text-underline-offset:3px}
.card{border:1px solid var(--border-soft);border-radius:4px;padding:16px 20px;margin:16px 0;background:var(--surface)}
.state{display:flex;align-items:center;gap:8px;font-weight:600;padding:10px 12px;border:1px solid var(--border-soft);border-radius:4px;background:var(--surface-2)}
.state::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
.ok{color:var(--success);background:color-mix(in oklab,var(--success),transparent 92%)}
.ok::before{background:var(--success)}
.warn{color:var(--warn);background:color-mix(in oklab,var(--warn),transparent 92%)}
.warn::before{background:var(--warn)}
.err{color:var(--danger);background:color-mix(in oklab,var(--danger),transparent 92%)}
.err::before{background:var(--danger)}
ol{padding-left:22px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;background:var(--surface-2);padding:2px 6px;border-radius:4px}
button{min-height:36px;padding:8px 16px;border:1px solid transparent;border-radius:4px;background:var(--accent-fill);color:var(--accent-on);font:inherit;font-weight:600;cursor:pointer}
button:hover{background:color-mix(in oklab,var(--accent-fill),#000 8%)}
button:focus-visible{outline:none;box-shadow:var(--focus)}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body>
<h1>Eterna 浏览器执行面 · 安装指引</h1>
<div class="state" id="state">检测中…</div>
<h3>安装步骤</h3>
<ol>
<li>下载扩展包：<a href="/companion/download.zip">eterna-companion.zip</a> 并解压；</li>
<li>打开 Chrome，进入 <code>chrome://extensions</code>，开启右上角「开发者模式」；</li>
<li>点击「加载已解压的扩展程序」，选择解压后的文件夹；</li>
<li>点击扩展图标，确认中继地址为 <code>${displayWsUrl}</code>（企业/远程部署还需在地址旁填入运维下发的访问令牌）；</li>
<li>回到 Eterna 会话说「打开 example.com」即可让 agent 驱动你的浏览器（登录态直接复用）。</li>
</ol>
<h3>企业用户</h3>
<p>无需开发者模式：IT 通过 ExtensionSettings 策略静默安装（见部署文档），本页将直接显示「已连接」。</p>
<h3>实时状态</h3>
<div class="state" id="live">读取中…</div>
<script>
function render(s){
  var el=document.getElementById('state'),lv=document.getElementById('live')
  var ok=s.extensionConnected===true
  el.className='state '+(ok?'ok':'err')
  el.textContent=ok?'已连接 · 版本 '+String(s.extVersion||'?')+' · Chrome '+String(s.chromeVersion||'?'):'未连接（扩展未安装或未启动）'
  lv.textContent=JSON.stringify(s)
}
fetch('/api/status').then(r=>r.json()).then(render).catch(function(){document.getElementById('state').textContent='状态获取失败'})
setInterval(function(){fetch('/api/status').then(r=>r.json()).then(render).catch(function(){})},5000)
</script>
</body></html>`
}

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
  /** 监听地址：缺省 127.0.0.1（本机开发/验收）；容器生产绑 0.0.0.0（经反代暴露 /extension） */
  host?: string
  token?: string
  /**
   * 用户 token 清单文件（access 端 /access/api/companion 按用户生成，JSON
   * `{ "<userId>": { token, createdAt } }`；文件缺失/损坏=仅主 token 有效）。
   * ws 与 /api/tools 均校验「主 token OR 清单任一 token」——清单未命中时每次重读
   * （连接频率低，免 watch；access 侧重置 token 后旧值即刻失效）。
   */
  tokensFile?: string
  /** companion 扩展 zip 包路径（/companion/download.zip 下发；缺省 404） */
  companionZipPath?: string
  /** 生产扩展连接地址（如 wss://域名/relay/extension）：guide 页与报错文案按它展示；缺省按本机端口 */
  publicWsUrl?: string
  log?: (line: string) => void
}

export class RelayServer {
  readonly core: RelayCore
  private tools: BrowserTools | null = null
  private wss: WebSocketServer | null = null
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
    // 主命名空间=主 token（无 token 开发形态 '__local__'）；/cdp 腿与无凭据工具调用落这里
    this.core = new RelayCore(opts.token !== undefined && opts.token !== '' ? opts.token : '__local__')
    this.core.onEventLog = this.log
    this.tools = new BrowserTools(this.core, guideUrlOf(opts))
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ noServer: true })
    this.httpServer.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })
    const host = this.opts.host ?? '127.0.0.1'
    await new Promise<void>(resolve => this.httpServer.listen(this.opts.port, host, resolve))
    this.log(`relay 监听 http://${host}:${String(this.opts.port)}（/extension /cdp /api/tools /fixture）`)
  }

  async stop(): Promise<void> {
    this.cdpSocket?.close()
    this.wss?.close()
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => {
        resolve()
      })
    })
  }

  private tokenOk(url: string): boolean {
    const q = new URL(url, 'http://x').searchParams.get('token')
    return this.credentialOk(q)
  }

  /** /api/tools 等 HTTP 端点的凭据校验：header 优先，query 兜底（ws 用 query，HTTP 用 header）。 */
  private httpTokenOk(req: IncomingMessage, url: string): boolean {
    const header = req.headers['x-relay-token']
    const presented = typeof header === 'string' && header !== '' ? header : new URL(url, 'http://x').searchParams.get('token')
    return this.credentialOk(presented)
  }

  /**
   * 凭据判定：主 token 匹配，或命中用户清单文件中的任一 token。
   * 完全未配置（无主 token 且清单文件缺失/空）= 放行（本机开发形态；
   * 生产 entrypoint 必带 token，见红线 9）。
   */
  private credentialOk(presented: string | null): boolean {
    const primary = this.opts.token
    const hasPrimary = primary !== undefined && primary !== ''
    if (hasPrimary && presented === primary) return true
    const list = this.readUserTokens()
    if (list.size === 0) return !hasPrimary && presented === null
    if (presented === null) return false
    for (const entry of list.values()) {
      if (entry.token === presented) return true
    }
    return false
  }

  /** 读用户 token 清单（每次重读：access 侧重置后旧 token 即刻失效；文件频率低可容忍）。 */
  private readUserTokens(): Map<string, { token: string; createdAt?: string }> {
    const path = this.opts.tokensFile
    if (path === undefined || path === '') return new Map()
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { token?: unknown; createdAt?: unknown }>
      const out = new Map<string, { token: string; createdAt?: string }>()
      for (const [userId, entry] of Object.entries(raw)) {
        if (typeof entry.token === 'string' && entry.token !== '') {
          const entry2: { token: string; createdAt?: string } = { token: entry.token }
          if (typeof entry.createdAt === 'string') entry2.createdAt = entry.createdAt
          out.set(userId, entry2)
        }
      }
      return out
    } catch {
      return new Map()
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = req.url ?? ''
    if (!this.tokenOk(url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.startsWith('/extension')) {
      // 命名空间=凭据原串（tokenOk 已验）；无 token 开发形态落主域
      const presented = new URL(url.startsWith('/') ? `ws://x${url}` : url, 'http://x').searchParams.get('token')
      const ns = presented ?? '__local__'
      if (this.core.nsConnected(ns)) {
        socket.write('HTTP/1.1 409 Conflict\r\n\r\n')
        socket.destroy()
        return
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data) => {
          this.onExtMessage(rawText(data), ns, ws)
        })
        ws.on('close', () => {
          this.core.setExt(ns, null)
          this.log(`扩展断开（${ns === '__local__' ? 'primary' : 'user'} 域）`)
        })
        this.log(`扩展已连接（${ns === '__local__' ? 'primary' : 'user'} 域，当前 ${String(this.core.connectedCount)} 台浏览器在线）`)
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

  private onExtMessage(text: string, ns: string, ws: WebSocket): void {
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
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f))
        },
        extVersion: frame.extVersion,
        chromeVersion: frame.chromeVersion,
      }
      this.core
        .onExtHello(link, frame, ns)
        .catch((err: unknown) => {
          this.log(`握手被拒：${err instanceof Error ? err.message : String(err)}`)
          ws.close(4002, 'proto-mismatch')
        })
      return
    }
    if (frame.t === 'event') this.log(`EXT event ← ${frame.method} tab=${String(frame.tabId)}`)
    this.core.onExtFrame(frame, ns).catch((err: unknown) => {
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
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', 'content-type')
      sendJson(res, 200, {
        // 向后兼容：extensionConnected=任一域有连接；多用户视图见 browsers/connectedBrowsers
        extensionConnected: this.core.extensionConnected,
        extVersion: this.core.connections()[0]?.extVersion ?? null,
        chromeVersion: this.core.connections()[0]?.chromeVersion ?? null,
        tabCount: this.core.listTabs(this.core.defaultNs).length,
        cdpConnected: this.cdpSocket !== null,
        connectedBrowsers: this.core.connectedCount,
        browsers: this.core.connections(),
        proto: PROTO_VERSION,
      })
      return
    }
    if (url === '/api/tools' && req.method === 'POST') {
      // 工具执行面凭据校验（公网反代透传形态下 /api/tools 与扩展腿同端口暴露——
      // 无鉴权=任意访问者可驱动已连接浏览器；本机开发形态（无主 token 且无清单）放行）
      if (!this.httpTokenOk(req, rawUrl)) {
        sendJson(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: '缺少或无效的访问令牌（x-relay-token 头或 ?token=）' } })
        return
      }
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
    if (url === '/companion/download.zip') {
      const zipPath = this.opts.companionZipPath
      if (zipPath === undefined || !existsSyncFn(zipPath)) {
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end('扩展包未构建（先跑 extension-companion build）')
        return
      }
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="eterna-companion.zip"',
        'cache-control': 'no-store',
      })
      createReadStream(zipPath).pipe(res)
      return
    }
    if (url === '/companion/guide') {
      const ws = this.opts.publicWsUrl ?? `ws://127.0.0.1:${String(this.opts.port)}/extension`
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(companionGuideHtml(ws))
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
